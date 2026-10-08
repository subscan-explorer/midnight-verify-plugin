#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { buildVerificationBundle, loadVerificationBundle } from './build.js';
import { verifyContract } from './verify.js';
import { BuildOptions, MidnightNetwork, PluginError } from './types.js';

const help = `midnight-verify (unpublished npm prototype)

  build   --source-dir contracts --entry main.compact --compiler-version <x.y.z> --out managed/main
  inspect --build-info managed/main/verification.json
  verify  --network preview --address 0x... --build-info managed/main/verification.json

Build options: --compiler-mode compact|compactc, --compiler-bin <path>, --timeout-ms <integer>
Build environment: MIDNIGHT_COMPACT_VERSION, MIDNIGHT_COMPACT_MODE, MIDNIGHT_COMPACT_BIN (flags take precedence)
Verify options: --api-url <origin>, --timeout-ms <integer>
Verification publishes the selected Compact source. Set SUBSCAN_API_KEY through your shell or CI.
Exit codes: 0 matching verification/build; 1 failure; 2 pending; 4 existing source differs; 130 cancelled.
`;

async function main(): Promise<void> {
  const { values, positionals } = parseArgs({ allowPositionals: true, options: {
    help: { type: 'boolean', short: 'h' },
    'source-dir': { type: 'string' }, entry: { type: 'string' }, 'compiler-version': { type: 'string' },
    out: { type: 'string' }, 'compiler-bin': { type: 'string' }, 'compiler-mode': { type: 'string' }, 'build-info': { type: 'string' },
    network: { type: 'string' }, address: { type: 'string' }, 'timeout-ms': { type: 'string' }, 'api-url': { type: 'string' },
  } });
  if (values.help || !positionals.length) { process.stdout.write(help); return; }
  if (positionals.length !== 1) throw new PluginError('INVALID_INPUT', 'Specify exactly one command');
  const required = (key: keyof typeof values): string => {
    const value = values[key];
    if (typeof value !== 'string' || !value) throw new PluginError('INVALID_INPUT', `Missing --${key}`);
    return value;
  };
  const timeoutMs = values['timeout-ms'] === undefined ? undefined : Number(values['timeout-ms']);
  const controller = new AbortController();
  const interrupt = (): void => controller.abort();
  process.once('SIGINT', interrupt);
  try {
    switch (positionals[0]) {
      case 'build': {
        const bundle = await buildVerificationBundle({ sourceDir: required('source-dir'), entryFile: required('entry'),
          compilerVersion: values['compiler-version'] ?? process.env.MIDNIGHT_COMPACT_VERSION ?? required('compiler-version'), outputDir: required('out'),
          compilerMode: (values['compiler-mode'] ?? process.env.MIDNIGHT_COMPACT_MODE) as BuildOptions['compilerMode'],
          compilerBin: values['compiler-bin'] ?? process.env.MIDNIGHT_COMPACT_BIN, timeoutMs, signal: controller.signal });
        process.stdout.write(JSON.stringify({ compilerVersion: bundle.compilerVersion, entryFile: bundle.entryFile,
          sourceDigest: bundle.sourceDigest, files: Object.keys(bundle.sources) }, null, 2) + '\n');
        break;
      }
      case 'inspect': {
        const bundle = await loadVerificationBundle(required('build-info'));
        process.stdout.write(JSON.stringify({ compilerVersion: bundle.compilerVersion, entryFile: bundle.entryFile,
          sourceDigest: bundle.sourceDigest, files: Object.keys(bundle.sources) }, null, 2) + '\n');
        break;
      }
      case 'verify': {
        const result = await verifyContract({ network: required('network') as MidnightNetwork, address: required('address'),
          buildInfo: required('build-info'), apiUrl: values['api-url'], timeoutMs, signal: controller.signal });
        process.stdout.write(JSON.stringify(result, null, 2) + '\n');
        process.exitCode = result.status === 'pending' ? 2 : result.matchesBundle === false ? 4 : 0;
        break;
      }
      default: throw new PluginError('INVALID_INPUT', 'Unknown command; use --help');
    }
  } finally {
    process.removeListener('SIGINT', interrupt);
  }
}

main().catch((error: unknown) => {
  const known = error instanceof PluginError;
  process.stderr.write(`${known ? error.code : 'INVALID_INPUT'}: ${known ? error.message : 'Invalid command arguments; use --help'}\n`);
  process.exitCode = known && error.code === 'CANCELLED' ? 130 : 1;
});
