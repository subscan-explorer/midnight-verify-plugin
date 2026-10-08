import assert from 'node:assert/strict';
import test from 'node:test';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import { API_KEY, ADDRESS, bundle, verified, temporary, compiler, compileSuccessfully } from './helpers.mjs';

const execute = promisify(execFile);
const runner = path.resolve('e2e/run.mjs');
const environment = { ...process.env, SUBSCAN_API_KEY: API_KEY };
for (const name of ['MIDNIGHT_COMPACT_VERSION', 'MIDNIGHT_COMPACT_MODE', 'MIDNIGHT_COMPACT_BIN']) delete environment[name];

async function networkFixture(root, versions, input) {
  const file = path.join(root, 'network-fixture.mjs');
  await fs.writeFile(file, `
const versions = ${JSON.stringify(versions)}, contract = ${JSON.stringify(input ? verified(input) : null)};
globalThis.fetch = async url => {
  const endpoint = new URL(url).pathname.split('/').at(-1);
  if (!['version', 'contract'].includes(endpoint)) throw new Error('Unexpected network request: ' + endpoint);
  return new Response(JSON.stringify({code: 0, message: '', data: endpoint === 'version' ? versions : contract}),
    {headers: {'Content-Type': 'application/json'}});
};
`);
  return file;
}

test('live harness help is offline and requires explicit deployment or resume', async () => {
  const result = await execute(process.execPath, [runner, '--help'], { env: environment });
  assert.match(result.stdout, /Resume reads the saved public receipt/);
  await assert.rejects(execute(process.execPath, [runner], { env: environment }), error => {
    assert.equal(error.code, 1);
    assert.match(error.stderr, /Choose exactly one/);
    assert.ok(!error.stderr.includes(API_KEY));
    return true;
  });
});

test('live harness rejects mainnet before SDK loading or remote requests', async t => {
  const root = await temporary(t);
  const output = path.join(root, 'output');
  await assert.rejects(execute(process.execPath, [runner, '--network', 'mainnet', '--deploy', '--out', output],
    { env: environment }), error => {
    assert.equal(error.code, 1);
    assert.match(error.stderr, /preview or preprod only/);
    return true;
  });
  await assert.rejects(fs.stat(output), { code: 'ENOENT' });
});

test('resume without a confirmed address refuses to deploy or submit verification', async t => {
  const root = await temporary(t);
  const file = path.join(root, 'receipt.json');
  await fs.writeFile(file, JSON.stringify({ schemaVersion: 1, network: 'preview', phase: 'broadcast', submittedTransactionId: 'public-test-transaction-id' }));
  await assert.rejects(execute(process.execPath, [runner, '--resume', file], { env: environment }), error => {
    assert.equal(error.code, 1);
    assert.match(error.stderr, /no confirmed contract address/);
    return true;
  });
  const receipt = JSON.parse(await fs.readFile(file, 'utf8'));
  assert.equal(receipt.phase, 'broadcast');
  assert.equal(receipt.submittedTransactionId, 'public-test-transaction-id');
  assert.equal(receipt.contractAddress, undefined);
  assert.ok(!JSON.stringify(receipt).includes(API_KEY));
});

test('deployment requires an exact configured compiler version before network or wallet access', async t => {
  const root = await temporary(t);
  for (const args of [[], ['--compiler-version', 'latest'], ['--compiler-version', '0.31']]) {
    await assert.rejects(execute(process.execPath, [runner, '--network', 'preview', '--deploy', '--out', path.join(root, 'output'), ...args],
      { env: environment }), error => {
      assert.equal(error.code, 1);
      assert.match(error.stderr, /exact x\.y\.z version/);
      return true;
    });
  }
  await assert.rejects(fs.stat(path.join(root, 'output')), { code: 'ENOENT' });
});

test('live deployment preflight and compilation use the configured version and executable', async t => {
  const root = await temporary(t);
  const preload = await networkFixture(root, ['0.35.0']);
  const compilerBin = await compiler(root, `
if (process.argv.slice(2).length !== 2) throw new Error('Unexpected compactc arguments');
const command = 'compile', version = '+0.35.0';
${compileSuccessfully}`, 'compactc');
  const output = path.join(root, 'output');
  await assert.rejects(execute(process.execPath, ['--import', preload, runner, '--network', 'preview', '--deploy', '--out', output],
    { env: { ...environment, MIDNIGHT_COMPACT_VERSION: '0.35.0', MIDNIGHT_COMPACT_MODE: 'compactc', MIDNIGHT_COMPACT_BIN: compilerBin,
      MIDNIGHT_E2E_HELPER_DIR: '' } }), error => {
    assert.equal(error.code, 1);
    assert.match(error.stderr, /Set --helper-dir/); // Stop before loading SDKs or wallets.
    return true;
  });
  assert.equal(JSON.parse(await fs.readFile(path.join(output, 'verification.json'), 'utf8')).compilerVersion, '0.35.0');
  assert.equal(JSON.parse(await fs.readFile(path.join(output, 'receipt.json'), 'utf8')).phase, 'compiled');
});

test('unsupported configured compiler versions stop before compilation or deployment', async t => {
  const root = await temporary(t);
  const preload = await networkFixture(root, ['0.31.0']);
  const output = path.join(root, 'output');
  await assert.rejects(execute(process.execPath, ['--import', preload, runner, '--network', 'preview', '--deploy', '--out', output,
    '--compiler-version', '0.35.0', '--compiler-bin', '/must-not-run'], { env: environment }), error => {
    assert.match(error.stderr, /must support the selected Compact version 0\.35\.0/);
    return true;
  });
  await assert.rejects(fs.stat(output), { code: 'ENOENT' });
});

test('resume uses the saved compiler version and rejects an explicit attempt to change it', async t => {
  const root = await temporary(t);
  const input = bundle({ 'main.compact': 'fixture entry', 'lib/message.compact': 'fixture dependency' }, 'main.compact', '0.35.0');
  await fs.writeFile(path.join(root, 'verification.json'), JSON.stringify(input));
  const receiptFile = path.join(root, 'receipt.json');
  const legacyWallet = 'legacy-fixture-wallet-address';
  await fs.writeFile(receiptFile, JSON.stringify({ network: 'preview', contractAddress: ADDRESS, compilerVersion: input.compilerVersion,
    sourceDigest: input.sourceDigest, walletAddress: legacyWallet }));
  const preload = await networkFixture(root, ['0.35.0'], input);
  const result = await execute(process.execPath, ['--import', preload, runner, '--resume', receiptFile],
    { env: { ...environment, MIDNIGHT_COMPACT_VERSION: '0.31.0', MIDNIGHT_COMPACT_MODE: 'invalid', MIDNIGHT_COMPACT_BIN: '/must-not-run' } });
  assert.match(result.stdout, /already-verified/);
  const receipt = JSON.parse(await fs.readFile(receiptFile, 'utf8'));
  assert.equal(receipt.compilerVersion, '0.35.0');
  assert.equal(receipt.verification.matchesBundle, true);
  assert.equal(receipt.walletAddress, undefined);
  assert.ok(!result.stdout.includes(legacyWallet));
  await assert.rejects(execute(process.execPath, ['--import', preload, runner, '--resume', receiptFile, '--compiler-version', '0.31.0'],
    { env: environment }), error => {
    assert.match(error.stderr, /resume cannot change it/);
    return true;
  });
});
