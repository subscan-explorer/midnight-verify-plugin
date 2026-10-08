import assert from 'node:assert/strict';
import test from 'node:test';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import { API_KEY, ADDRESS, bundle, status, verified, temporary, apiServer, compiler, compileSuccessfully } from './helpers.mjs';

const execute = promisify(execFile);
const cli = path.resolve('dist/cli.js');

test('CLI help and inspect work without networking and inspect prints no source content', async t => {
  assert.match((await execute(process.execPath, [cli, '--help'])).stdout, /midnight-verify/);
  const root = await temporary(t);
  const file = path.join(root, 'verification.json');
  const input = bundle({ 'main.compact': 'SOURCE_CONTENT_MARKER' });
  await fs.writeFile(file, JSON.stringify(input));
  const result = await execute(process.execPath, [cli, 'inspect', '--build-info', file]);
  const preview = JSON.parse(result.stdout);
  assert.equal(preview.compilerVersion, '0.31.1');
  assert.deepEqual(preview.files, ['main.compact']);
  assert.ok(!result.stdout.includes('SOURCE_CONTENT_MARKER'));
  await assert.rejects(execute(process.execPath, [cli, 'verify']), error => error.code === 1 && error.stderr.includes('INVALID_INPUT'));
});

test('CLI compiler settings support environment fallbacks and explicit flag overrides', async t => {
  const root = await temporary(t);
  await fs.writeFile(path.join(root, 'main.compact'), 'fixture source');
  const direct = await compiler(root, `const command = 'compile', version = '+0.35.0';\n${compileSuccessfully}`, 'compactc');
  const env = { ...process.env, MIDNIGHT_COMPACT_VERSION: '0.35.0', MIDNIGHT_COMPACT_MODE: 'compactc', MIDNIGHT_COMPACT_BIN: direct };
  const base = ['build', '--source-dir', root, '--entry', 'main.compact'];
  const native = await execute(process.execPath, [cli, ...base, '--out', path.join(root, 'native')], { env });
  assert.equal(JSON.parse(native.stdout).compilerVersion, '0.35.0');
  const launcher = await compiler(root, compileSuccessfully);
  const overridden = await execute(process.execPath, [cli, ...base, '--out', path.join(root, 'launcher'),
    '--compiler-version', '0.31.0', '--compiler-mode', 'compact', '--compiler-bin', launcher], { env });
  assert.equal(JSON.parse(overridden.stdout).compilerVersion, '0.31.0');
});

test('CLI exits 4 for existing different source and 2 for pending indexing', async t => {
  const root = await temporary(t);
  const file = path.join(root, 'verification.json');
  const input = bundle();
  await fs.writeFile(file, JSON.stringify(input));
  const different = await apiServer(t, (request, reply) => reply(verified(input, { source_code: 'other source' })));
  const pending = await apiServer(t, (request, reply) => reply(null, 'Contract not found', 1));
  for (const [api, code, expected] of [[different, 4, 'already-verified'], [pending, 2, 'pending']]) {
    await assert.rejects(execute(process.execPath, [cli, 'verify', '--network', 'preview', '--address', ADDRESS,
      '--build-info', file, '--api-url', api.origin, '--timeout-ms', '200'], {
      env: { ...process.env, SUBSCAN_API_KEY: API_KEY },
    }), error => {
      assert.equal(error.code, code);
      assert.equal(JSON.parse(error.stdout).status, expected);
      assert.ok(!error.stdout.includes(API_KEY));
      return true;
    });
  }
});

test('CLI verify success uses the same one-submit library workflow', async t => {
  const root = await temporary(t);
  const file = path.join(root, 'verification.json');
  const input = bundle();
  await fs.writeFile(file, JSON.stringify(input));
  let submitted = false;
  const api = await apiServer(t, (request, reply) => {
    if (request.endpoint === 'verify') { submitted = true; reply(null); }
    else reply(submitted ? verified(input) : status());
  });
  const result = await execute(process.execPath, [cli, 'verify', '--network', 'preview', '--address', ADDRESS,
    '--build-info', file, '--api-url', api.origin], { env: { ...process.env, SUBSCAN_API_KEY: API_KEY } });
  assert.equal(JSON.parse(result.stdout).status, 'verified');
  assert.equal(api.requests.filter(r => r.endpoint === 'verify').length, 1);
});
