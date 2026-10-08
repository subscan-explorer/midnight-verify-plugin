import assert from 'node:assert/strict';
import test from 'node:test';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import { temporary } from './helpers.mjs';

const execute = promisify(execFile);
const checker = path.resolve('scripts/check-release.mjs');

test('release source check accepts English docs and ignores private runtime directories', async t => {
  const root = await temporary(t);
  await fs.mkdir(path.join(root, 'docs'));
  await fs.mkdir(path.join(root, 'managed'));
  await fs.writeFile(path.join(root, 'README.md'), '# Client\n\n[Guide](docs/guide.md#usage)\n');
  await fs.writeFile(path.join(root, 'docs', 'guide.md'), '# Guide\n\n## Usage\n');
  await fs.writeFile(path.join(root, 'managed', 'private.json'), String.fromCodePoint(0x4e2d));
  const result = await execute(process.execPath, [checker, '--source-only', '--root', root]);
  assert.equal(JSON.parse(result.stdout).status, 'passed');
  assert.equal(JSON.parse(result.stdout).sourceFiles, 2);
});

test('release source check rejects CJK prose and broken local links', async t => {
  const root = await temporary(t);
  const file = path.join(root, 'README.md');
  await fs.writeFile(file, '# ' + String.fromCodePoint(0x4e2d) + '\n');
  await assert.rejects(execute(process.execPath, [checker, '--source-only', '--root', root]), error => {
    assert.match(error.stderr, /Non-English CJK text: README.md:1/);
    return true;
  });
  await fs.writeFile(file, '# Client\n\n[Guide](missing.md)\n');
  await assert.rejects(execute(process.execPath, [checker, '--source-only', '--root', root]), error => {
    assert.match(error.stderr, /Broken local link/);
    return true;
  });
});

test('release source check rejects machine-specific paths', async t => {
  const root = await temporary(t);
  await fs.writeFile(path.join(root, 'README.md'), 'cd /' + ['Users', 'developer', 'project'].join('/') + '\n');
  await assert.rejects(execute(process.execPath, [checker, '--source-only', '--root', root]), error => {
    assert.match(error.stderr, /Machine-specific path: README.md:1/);
    return true;
  });
});

test('release source check rejects credential literals without printing their values', async t => {
  const root = await temporary(t);
  const file = path.join(root, 'README.md');
  const synthetic = 'a1'.repeat(32);
  for (const text of ['SUBSCAN_API_KEY="' + synthetic + '"', 'MIDNIGHT_PREVIEW_SEED=' + synthetic,
    'SUBSCAN_API_KEY="' + synthetic + '" ']) {
    await fs.writeFile(file, text + '\n');
    await assert.rejects(execute(process.execPath, [checker, '--source-only', '--root', root]), error => {
      assert.match(error.stderr, /(?:Hardcoded .*credential|Trailing whitespace): README.md:1/);
      assert.ok(!error.stderr.includes(synthetic));
      assert.ok(!error.stdout.includes(synthetic));
      return true;
    });
  }
});

test('release source check rejects private keys and provider tokens', async t => {
  const root = await temporary(t);
  for (const value of ['-----BEGIN ' + 'PRIVATE KEY-----', 'gh' + 'p_' + 'a'.repeat(36)]) {
    await fs.writeFile(path.join(root, 'README.md'), value + '\n');
    await assert.rejects(execute(process.execPath, [checker, '--source-only', '--root', root]), error => {
      assert.match(error.stderr, /Credential material/);
      assert.ok(!error.stderr.includes(value));
      return true;
    });
  }
});

test('release source check rejects sensitive files and wallet identities', async t => {
  const root = await temporary(t);
  for (const name of ['credentials.json', '.env.preview', 'wallet-backup.json', 'signing.pem']) {
    const file = path.join(root, name);
    await fs.writeFile(file, 'fixture');
    await assert.rejects(execute(process.execPath, [checker, '--source-only', '--root', root]), error => {
      assert.match(error.stderr, /Sensitive file in publication candidates/);
      return true;
    });
    await fs.rm(file);
  }
  const identity = 'fixture-wallet-identity';
  await fs.writeFile(path.join(root, 'receipt.json'), JSON.stringify({ walletAddress: identity }));
  await assert.rejects(execute(process.execPath, [checker, '--source-only', '--root', root]), error => {
    assert.match(error.stderr, /Wallet identity in public text/);
    assert.ok(!error.stderr.includes(identity));
    return true;
  });
});

test('release source check includes force-added files from ignored runtime directories', async t => {
  const root = await temporary(t);
  await execute('git', ['init', '--quiet', root]);
  await fs.writeFile(path.join(root, '.gitignore'), 'managed/\n');
  await fs.mkdir(path.join(root, 'managed'));
  await fs.writeFile(path.join(root, 'managed', 'receipt.json'), '{}');
  await execute('git', ['add', '--force', 'managed/receipt.json'], { cwd: root });
  await assert.rejects(execute(process.execPath, [checker, '--source-only', '--root', root]), error => {
    assert.match(error.stderr, /Sensitive file in publication candidates: managed/);
    return true;
  });
});

test('release source check examines older staged contents after the worktree is sanitized', async t => {
  const root = await temporary(t);
  await execute('git', ['init', '--quiet', root]);
  const file = path.join(root, 'config.mjs');
  const synthetic = 'ab'.repeat(32);
  await fs.writeFile(file, 'export const API_KEY="' + synthetic + '";\n');
  await execute('git', ['add', 'config.mjs'], { cwd: root });
  await fs.writeFile(file, 'export const API_KEY=process.env.SUBSCAN_API_KEY;\n');
  await assert.rejects(execute(process.execPath, [checker, '--source-only', '--root', root]), error => {
    assert.match(error.stderr, /Hardcoded credential: config.mjs \(Git index\):1/);
    assert.ok(!error.stderr.includes(synthetic));
    return true;
  });
  await execute('git', ['add', 'config.mjs'], { cwd: root });
  assert.equal(JSON.parse((await execute(process.execPath, [checker, '--source-only', '--root', root])).stdout).status, 'passed');
});

test('release source check rejects internal endpoints and keeps public evidence', async t => {
  const root = await temporary(t);
  const file = path.join(root, 'README.md');
  const endpoint = 'https://' + ['10', '20', '30', '40'].join('.');
  await fs.writeFile(file, endpoint + '\n');
  await assert.rejects(execute(process.execPath, [checker, '--source-only', '--root', root]), error => {
    assert.match(error.stderr, /Internal endpoint/);
    assert.ok(!error.stderr.includes(endpoint));
    return true;
  });
  await fs.writeFile(file, '# Public evidence\n\nSource digest: ' + 'ab'.repeat(32) + '\nSUBSCAN_API_KEY=<your-api-key>\nNode 22.16.0, npm 10.9.2\n');
  assert.equal(JSON.parse((await execute(process.execPath, [checker, '--source-only', '--root', root])).stdout).status, 'passed');
});
