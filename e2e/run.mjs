import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import { parseArgs, parseEnv } from 'node:util';
import { register } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { buildVerificationBundle, loadVerificationBundle, normalizeAddress, verifyContract } from '../dist/index.js';

const project = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const { values } = parseArgs({ options: {
  help: { type: 'boolean', short: 'h' }, deploy: { type: 'boolean' }, network: { type: 'string' },
  'helper-dir': { type: 'string' }, 'env-file': { type: 'string' }, 'subscan-key-file': { type: 'string' },
  out: { type: 'string' }, resume: { type: 'string' },
  'compiler-version': { type: 'string' }, 'compiler-mode': { type: 'string' }, 'compiler-bin': { type: 'string' },
  'sync-timeout-ms': { type: 'string' }, 'verify-timeout-ms': { type: 'string' },
} });
const help = `Opt-in live test: compile -> testnet deploy -> Subscan verification
  npm run test:live -- --network preview --deploy --out managed/live-preview \
    --compiler-version <x.y.z> --compiler-mode compact \
    --helper-dir /path/to/midnight-go --env-file /path/to/.env.preview \
    --subscan-key-file /path/to/api-key.http
  npm run test:live -- --resume managed/live-preview/receipt.json \
    --subscan-key-file /path/to/api-key.http

Requires an existing funded test wallet, installed midnight-go E2E dependencies,
an explicitly configured compiler version and a running proof server.
Compiler flags: --compiler-version, --compiler-mode compact|compactc, --compiler-bin.
Environment fallbacks: MIDNIGHT_COMPACT_VERSION, MIDNIGHT_COMPACT_MODE, MIDNIGHT_COMPACT_BIN.
Never runs through npm test.
Resume reads the saved public receipt; it cannot deploy or broadcast.
`;

let key = '';
let receipt;
let receiptFile;

function timeout(value, fallback) {
  const result = value === undefined ? fallback : Number(value);
  if (!Number.isSafeInteger(result) || result <= 0 || result > 2_147_483_647) throw new Error('Timeout must be a positive integer within the timer limit');
  return result;
}

async function bounded(promise, milliseconds, label) {
  let timer;
  try {
    return await Promise.race([promise, new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(label + ' timed out; inspect the saved receipt before any further deployment')), milliseconds);
    })]);
  } finally {
    clearTimeout(timer);
  }
}

async function checkpoint(update) {
  receipt = { ...receipt, ...update, updatedAt: new Date().toISOString() };
  delete receipt.walletAddress; // Also sanitize receipts created by older harness versions.
  const temporary = receiptFile + '.tmp';
  await fs.writeFile(temporary, JSON.stringify(receipt, null, 2) + '\n', { mode: 0o600 });
  await fs.rename(temporary, receiptFile);
}

async function request(endpoint, body) {
  const host = receipt.network === 'preview' ? 'midnight-preview' : 'midnight-preprod';
  const response = await fetch(`https://${host}.api.subscan.io/api/scan/midnight/${endpoint}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'X-API-Key': key },
    body: JSON.stringify(body), redirect: 'error', signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) throw new Error('Subscan preflight returned HTTP ' + response.status);
  const envelope = await response.json();
  if (envelope.code !== 0) throw new Error('Subscan preflight rejected the request: ' + envelope.message);
  return envelope.data;
}

async function deploy(output) {
  const helper = path.resolve(values['helper-dir'] ?? process.env.MIDNIGHT_E2E_HELPER_DIR ?? '');
  if (!values['helper-dir'] && !process.env.MIDNIGHT_E2E_HELPER_DIR) throw new Error('Set --helper-dir to the existing compatible midnight-go checkout');
  if (values['env-file']) {
    const env = parseEnv(await fs.readFile(values['env-file'], 'utf8'));
    for (const name of [`MIDNIGHT_${receipt.network.toUpperCase()}_SEED`, `MIDNIGHT_${receipt.network.toUpperCase()}_MNEMONIC`,
      'MIDNIGHT_PROOF_SERVER', 'MIDNIGHT_EXPECTED_WALLET_ADDRESS']) {
      if (!process.env[name] && env[name]) process.env[name] = env[name];
    }
  }
  const seed = process.env[`MIDNIGHT_${receipt.network.toUpperCase()}_SEED`]?.trim();
  const mnemonic = process.env[`MIDNIGHT_${receipt.network.toUpperCase()}_MNEMONIC`]?.trim();
  if ((!seed && !mnemonic) || (seed && mnemonic)) throw new Error('Provide exactly one testnet seed or mnemonic through the environment or --env-file');
  const secret = seed ? { kind: 'seed', value: seed } : { kind: 'mnemonic', value: mnemonic };

  const anchor = pathToFileURL(path.join(helper, 'e2e/package.json')).href;
  register('./sdk-loader.mjs', import.meta.url, { data: {
    anchor, assets: pathToFileURL(output + path.sep).href,
    helperSources: pathToFileURL(path.join(helper, 'e2e/src') + path.sep).href,
  } });
  const sdk = name => import(import.meta.resolve(name, anchor));
  const [{ deployContract }, { CompiledContract }, { setNetworkId }, { waitForFunds }, { default: pino }, { WebSocket }] = await Promise.all([
    sdk('@midnight-ntwrk/midnight-js-contracts'), sdk('@midnight-ntwrk/midnight-js-protocol/compact-js'),
    sdk('@midnight-ntwrk/midnight-js-network-id'), sdk('@midnight-ntwrk/testkit-js'), sdk('pino'), sdk('ws'),
  ]);
  const [{ MidnightWalletProvider, syncWallet }, { buildProviders }, configModule] = await Promise.all([
    import(pathToFileURL(path.join(helper, 'e2e/src/wallet.ts')).href),
    import(pathToFileURL(path.join(helper, 'e2e/src/providers.ts')).href),
    import(pathToFileURL(path.join(helper, 'e2e/src/config.ts')).href),
  ]);
  const config = receipt.network === 'preview' ? configModule.PREVIEW_CONFIG : configModule.PREPROD_CONFIG;
  const metadata = JSON.parse(await fs.readFile(path.join(output, 'compiler/contract-info.json'), 'utf8'));
  const installedRuntime = JSON.parse(await fs.readFile(path.join(helper, 'e2e/node_modules/@midnight-ntwrk/compact-runtime/package.json'), 'utf8'));
  const sdkPackage = JSON.parse(await fs.readFile(path.join(helper, 'e2e/node_modules/@midnight-ntwrk/midnight-js-contracts/package.json'), 'utf8'));
  const walletPackage = JSON.parse(await fs.readFile(path.join(helper, 'e2e/node_modules/@midnight-ntwrk/wallet-sdk/package.json'), 'utf8'));
  assert.equal(sdkPackage.version, '4.1.1', 'This adapter is tested with Midnight.js 4.1.1');
  assert.equal(walletPackage.version, '1.2.0', 'This adapter is tested with Wallet SDK 1.2.0');
  assert.equal(metadata['runtime-version'], installedRuntime.version, 'Generated runtime must match installed SDK runtime');
  const { Contract, ledger } = await import(pathToFileURL(path.join(output, 'contract/index.js')).href);
  const compiled = CompiledContract.make('PluginLiveHelloWorld', Contract).pipe(
    CompiledContract.withVacantWitnesses, CompiledContract.withCompiledFileAssets(output),
  );
  globalThis.WebSocket = WebSocket;
  setNetworkId(config.networkId);
  const logger = pino({ level: 'info' }); // Never print seeds, mnemonics, providers or private transaction objects.
  const environment = { ...config, walletNetworkId: config.networkId };
  await checkpoint({ phase: 'wallet-syncing', sdkVersion: sdkPackage.version, walletSdkVersion: walletPackage.version,
    runtimeVersion: installedRuntime.version });
  const wallet = await MidnightWalletProvider.build(logger, environment, secret);
  const syncTimeout = timeout(values['sync-timeout-ms'], 1_200_000);
  try {
    const walletAddress = wallet.unshieldedKeystore.getBech32Address().asString();
    if (process.env.MIDNIGHT_EXPECTED_WALLET_ADDRESS && walletAddress !== process.env.MIDNIGHT_EXPECTED_WALLET_ADDRESS) {
      throw new Error('Derived wallet address does not match the expected test wallet address');
    }
    console.log(JSON.stringify({ phase: 'wallet-address-checked' }));
    await wallet.start();
    await bounded(syncWallet(logger, wallet.wallet, syncTimeout), syncTimeout, 'Wallet synchronization');
    await bounded(waitForFunds(wallet.wallet, environment, false, wallet.unshieldedKeystore), 300_000, 'Test wallet funds/DUST preparation');
    // Isolate private-state data inside the ignored live output, away from the existing helper's stores.
    const staticDir = path.join(output, 'state', 'static');
    await fs.mkdir(staticDir, { recursive: true });
    process.env.STATIC_DIR = staticDir;
    const providers = buildProviders(wallet, output, config);
    const originalSubmit = wallet.submitTx.bind(wallet);
    wallet.submitTx = async tx => {
      const transactionId = await originalSubmit(tx);
      await checkpoint({ phase: 'broadcast', submittedTransactionId: transactionId });
      console.log(JSON.stringify({ phase: 'broadcast', transactionId }));
      return transactionId;
    };
    await checkpoint({ phase: 'deploying' });
    console.log('Wallet ready; submitting exactly one deployment');
    const deployed = await bounded(deployContract(providers, {
      compiledContract: compiled, privateStateId: 'PluginLiveHWState', initialPrivateState: {},
    }), 600_000, 'Deployment confirmation');
    const publicReceipt = deployed.deployTxData.public;
    await checkpoint({
      phase: 'deployed', contractAddress: normalizeAddress(publicReceipt.contractAddress),
      deployBlockHash: '0x' + publicReceipt.blockHash.replace(/^0x/, ''), deployedAt: new Date().toISOString(),
    });
    console.log(JSON.stringify({ phase: 'deployed', contractAddress: receipt.contractAddress, deployBlockHash: receipt.deployBlockHash }));
    const state = await providers.publicDataProvider.queryContractState(publicReceipt.contractAddress);
    assert.ok(state, 'Deployed state must be queryable through the official Indexer');
    assert.equal(ledger(state.data).message, '');
    await checkpoint({ initialLedgerChecked: true });
  } finally {
    await wallet.stop();
  }
}

async function main() {
  if (values.help) { console.log(help); return; }
  if (Boolean(values.deploy) === Boolean(values.resume)) throw new Error('Choose exactly one: --deploy or --resume');
  key = process.env.SUBSCAN_API_KEY ?? '';
  if (!key && values['subscan-key-file']) {
    const text = await fs.readFile(values['subscan-key-file'], 'utf8');
    key = text.match(/^x-api-key\s*:\s*(\S+)/im)?.[1] ?? '';
  }
  if (!key) throw new Error('Set SUBSCAN_API_KEY or --subscan-key-file; values are never printed');
  let output;
  let bundle;
  if (values.resume) {
    receiptFile = path.resolve(values.resume);
    output = path.dirname(receiptFile);
    receipt = JSON.parse(await fs.readFile(receiptFile, 'utf8'));
    if (!receipt.contractAddress) throw new Error('Receipt has no confirmed contract address; do not automatically redeploy');
  } else {
    if (!values.out) throw new Error('Deployment requires an explicit unused --out directory');
    output = path.resolve(values.out);
    receipt = { schemaVersion: 1, network: values.network };
  }
  if (!['preview', 'preprod'].includes(receipt.network)) throw new Error('Live harness supports preview or preprod only');
  if (values.network && values.network !== receipt.network) throw new Error('Requested network differs from the saved receipt');
  let compilerVersion;
  if (values.resume) {
    bundle = await loadVerificationBundle(path.join(output, 'verification.json'));
    assert.equal(bundle.compilerVersion, receipt.compilerVersion, 'Saved deployment receipt must match the bundle compiler version');
    if (values['compiler-version'] && values['compiler-version'] !== bundle.compilerVersion) {
      throw new Error('Requested compiler version differs from the saved deployment; resume cannot change it');
    }
    if (values['compiler-mode'] || values['compiler-bin']) throw new Error('Compiler mode and executable apply only to --deploy');
    compilerVersion = bundle.compilerVersion; // Environment settings must never change a confirmed deployment's version.
  } else {
    compilerVersion = values['compiler-version'] ?? process.env.MIDNIGHT_COMPACT_VERSION;
    if (!compilerVersion || !/^\d+\.\d+\.\d+$/.test(compilerVersion)) {
      throw new Error('Set --compiler-version or MIDNIGHT_COMPACT_VERSION to an exact x.y.z version');
    }
  }
  const compilerMode = values['compiler-mode'] ?? process.env.MIDNIGHT_COMPACT_MODE ?? 'compact';
  if (values.deploy && !['compact', 'compactc'].includes(compilerMode)) throw new Error('Compiler mode must be compact or compactc');
  const versions = await request('compact/version', {});
  assert.ok(Array.isArray(versions) && versions.includes(compilerVersion), 'This network must support the selected Compact version ' + compilerVersion);
  if (values.deploy) {
    console.log('Freezing and compiling the two-file example with Compact ' + compilerVersion);
    bundle = await buildVerificationBundle({ sourceDir: path.join(project, 'examples/multi-file'), entryFile: 'main.compact',
      compilerVersion, compilerMode, compilerBin: values['compiler-bin'] ?? process.env.MIDNIGHT_COMPACT_BIN,
      outputDir: output, timeoutMs: 180_000 });
    receiptFile = path.join(output, 'receipt.json');
    await checkpoint({ phase: 'compiled', compilerVersion: bundle.compilerVersion, sourceDigest: bundle.sourceDigest,
      files: Object.keys(bundle.sources), createdAt: new Date().toISOString() });
    await deploy(output);
  }
  if (values.deploy) bundle = await loadVerificationBundle(path.join(output, 'verification.json'));
  assert.equal(bundle.compilerVersion, receipt.compilerVersion, 'Saved deployment receipt must match the bundle compiler version');
  assert.equal(bundle.sourceDigest, receipt.sourceDigest, 'Saved deployment receipt must identify this source snapshot');
  await checkpoint({ phase: 'verification-pending' });
  console.log('Confirmed deployment saved; verifying through the Subscan API');
  const verification = await verifyContract({ network: receipt.network, address: receipt.contractAddress, buildInfo: bundle,
    apiKey: key, timeoutMs: timeout(values['verify-timeout-ms'], 600_000) });
  await checkpoint({ phase: verification.status === 'pending' ? 'verification-pending' : 'verified', verification });
  console.log(JSON.stringify(verification, null, 2));
  if (verification.status === 'pending') { process.exitCode = 2; return; }
  assert.equal(verification.matchesBundle, true, 'Stored verified source must match the exact compiled bundle');
  const stored = await request('contract', { contract: receipt.contractAddress });
  assert.ok(stored.verify_time > 0, 'Independent Subscan read must show a persisted success record');
  assert.equal(stored.verifying, false, 'Finished verification must not remain stuck in the queue state');
  assert.equal(stored.compiler_version, bundle.compilerVersion);
  assert.equal(stored.source_type, 'multi_file');
  const source = JSON.parse(stored.source_code);
  assert.equal(source['entry-file'], bundle.entryFile);
  assert.deepEqual(source.contracts, { ...bundle.sources });
  await checkpoint({ persistedResultChecked: true, verifyTime: stored.verify_time, phase: 'verified' });
  console.log('PASS: frozen compile -> confirmed deployment -> Subscan persisted verification');
}

main().catch(async error => {
  let message = error instanceof Error ? error.message : 'Live test failed';
  for (const value of [key, ...Object.entries(process.env).filter(([name]) => /MIDNIGHT_.*_(SEED|MNEMONIC)$/.test(name)).map(([, value]) => value)]) {
    if (value) message = message.replaceAll(value, '[redacted]');
  }
  console.error('Live test failed:', message);
  if (receiptFile) await checkpoint({ lastError: message });
  process.exitCode = 1;
});
