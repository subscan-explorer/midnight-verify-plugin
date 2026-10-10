import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import * as fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { parseArgs, promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

const execute = promisify(execFile);
const { values } = parseArgs({ options: { 'source-only': { type: 'boolean' }, root: { type: 'string' } } });
const root = values.root ? path.resolve(values.root) : fileURLToPath(new URL('..', import.meta.url));
const excluded = new Set(['.git', 'node_modules', 'dist', 'managed', 'logs', 'coverage']);
const cjk = /[\p{Script=Han}\u3000-\u303f\uff00-\uffef]/u;
const personalPath = /\/(?:Users\/[^/]+|home\/[^/]+|private\/tmp\/codex[^/]*|tmp\/codex[^/]*)\//;
const sensitiveFile = /(^|\/)(managed|logs|state|secrets|credentials|node_modules)(\/|$)|(^|\/)(\.npmrc|credentials\.json|wallet[^/]*\.json)$|\.(pem|key|p12|pfx|keystore|seed|mnemonic|http)$|(^|\/)\.env(?!\.example$)/i;
const credentialName = String.raw`(?:[A-Z][A-Z0-9_]*_(?:KEY|TOKEN|SECRET|SEED|MNEMONIC|PASSWORD)|api[_-]?key|api[_-]?token|access[_-]?token|client[_-]?secret|private[_-]?key|wallet[_-]?seed|wallet[_-]?address|MIDNIGHT_EXPECTED_WALLET_ADDRESS|seed|mnemonic|password|passwd)`;
const quotedCredential = new RegExp(String.raw`\b${credentialName}\b["']?\s*[:=]\s*["'\x60]([^"'\x60\r\n]+)["'\x60]`, 'gi');
const envCredential = new RegExp(String.raw`^\s*${credentialName}\s*=\s*(\S.*)$`, 'i');
const publicPlaceholder = /^(?:<[^<>]+>|\$[A-Z_][A-Z0-9_]*|\$\{[A-Z_][A-Z0-9_]*\}|local-test-key-not-a-credential|DO_NOT_COLLECT)$/;
const providerCredential = /\b(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{40,}|(?:AKIA|ASIA)[A-Z0-9]{16}|xox[baprs]-[A-Za-z0-9-]{20,}|sk-(?:proj-)?[A-Za-z0-9_-]{40,}|eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)\b/;

function checkPublicText(text, relative) {
  for (const [index, line] of text.split('\n').entries()) {
    const location = `${relative}:${index + 1}`;
    assert.ok(!cjk.test(line), `Non-English CJK text: ${location}`);
    assert.ok(!personalPath.test(line), `Machine-specific path: ${location}`);
    assert.ok(line === line.trimEnd(), `Trailing whitespace: ${location}`);
    assert.ok(!/-----BEGIN (?:[A-Z]+ )*PRIVATE KEY-----/.test(line) && !providerCredential.test(line), `Credential material: ${location}`);
    assert.ok(!/["']?walletAddress["']?\s*:\s*["'][^"']+["']/.test(line), `Wallet identity in public text: ${location}`);
    assert.ok(!/\b(?:10\.\d{1,3}|192\.168|172\.(?:1[6-9]|2\d|3[01]))\.\d{1,3}\.\d{1,3}\b|[a-z\d-]+\.(?:svc(?:\.cluster\.local)?|internal|corp|lan)\b/i.test(line), `Internal endpoint: ${location}`);
    for (const match of line.matchAll(quotedCredential)) {
      assert.ok(publicPlaceholder.test(match[1]), `Hardcoded credential: ${location}`);
    }
    const env = line.match(envCredential);
    if (env) assert.ok(publicPlaceholder.test(env[1]), `Hardcoded environment credential: ${location}`);
  }
}

async function checkSources() {
  const files = [];
  const changedIndexFiles = new Set();
  async function walk(directory) {
    for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
      if (excluded.has(entry.name)) continue;
      const file = path.join(directory, entry.name);
      if (entry.isDirectory()) await walk(file);
      else files.push(file);
    }
  }
  const git = await fs.lstat(path.join(root, '.git')).catch(error => {
    if (error.code !== 'ENOENT') throw error;
    return null;
  });
  if (git) {
    // Include force-added ignored files: a directory denylist alone can hide staged secrets.
    const { stdout } = await execute('git', ['ls-files', '--cached', '--others', '--exclude-standard', '-z'], { cwd: root });
    files.push(...new Set(stdout.split('\0').filter(Boolean).map(name => path.join(root, name))));
    const changed = await execute('git', ['diff', '--no-ext-diff', '--name-only', '-z'], { cwd: root });
    for (const name of changed.stdout.split('\0').filter(Boolean)) changedIndexFiles.add(name);
  } else await walk(root);
  let links = 0;
  let sourceFiles = 0;
  for (const file of files) {
    const relative = path.relative(root, file);
    assert.ok(!sensitiveFile.test(relative), `Sensitive file in publication candidates: ${relative}`);
    assert.ok(!(await fs.lstat(file)).isSymbolicLink(), `Symlink in publication candidates: ${relative}`);
    if (!/\.(md|[cm]?[jt]s|json|ya?ml|compact|txt|toml|ini|conf|sh)$/.test(file) && !['.env.example', '.gitignore'].includes(path.basename(file))) continue;
    if (changedIndexFiles.has(relative)) {
      // Cleaning a worktree file does not remove the older contents already staged for commit.
      const staged = await execute('git', ['show', ':' + relative], { cwd: root, maxBuffer: 4 * 1024 * 1024 });
      checkPublicText(staged.stdout, relative + ' (Git index)');
    }
    const text = await fs.readFile(file, 'utf8');
    checkPublicText(text, relative);
    sourceFiles++;
    if (!file.endsWith('.md')) continue;
    assert.equal((text.match(/^```/gm) ?? []).length % 2, 0, `Unclosed code fence: ${relative}`);
    for (const match of text.matchAll(/\]\(([^)]+)\)/g)) {
      const target = match[1];
      if (/^[a-z][a-z\d+.-]*:/i.test(target)) continue;
      const [local, anchor] = target.split('#');
      const destination = local ? path.resolve(path.dirname(file), local) : file;
      await fs.access(destination).catch(() => { throw new Error(`Broken local link: ${relative} -> ${target}`); });
      if (anchor) {
        const headings = (await fs.readFile(destination, 'utf8')).matchAll(/^#+\s+(.+)$/gm);
        const slugs = [...headings].map(heading => heading[1].toLowerCase().replace(/[^\p{L}\p{N}_\s-]/gu, '').replaceAll(' ', '-'));
        assert.ok(slugs.includes(anchor), `Broken heading link: ${relative} -> ${target}`);
      }
      links++;
    }
  }
  return { sourceFiles, publicationCandidates: files.length, localLinks: links };
}

async function run(command, args, cwd) {
  const { stdout } = await execute(command, args, { cwd, timeout: 120_000, maxBuffer: 4 * 1024 * 1024 });
  return stdout;
}

async function checkPackage() {
  assert.ok(!values.root, '--root is only supported with --source-only');
  assert.ok(process.env.npm_execpath, 'Run package checks through npm run check:release');
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'midnight-release-check-'));
  try {
    const packed = JSON.parse(await run(process.execPath, [process.env.npm_execpath, 'pack', '--json', '--pack-destination', temporary], root))[0];
    const names = packed.files.map(file => file.path);
    for (const required of ['dist/index.js', 'dist/index.d.ts', 'dist/cli.js', 'README.md', 'CHANGELOG.md', 'LICENSE', 'docs/guide.md', 'docs/protocol.md', 'docs/release.md']) {
      assert.ok(names.includes(required), `Missing package file: ${required}`);
    }
    for (const name of names) {
      assert.ok(!sensitiveFile.test(name) && !/(^|\/)(test|scripts|\.git|\.github)(\/|$)|\.tgz$/.test(name), `Unexpected package file: ${name}`);
      if (name.endsWith('.jpg')) continue;
      const text = await fs.readFile(path.join(root, name), 'utf8');
      checkPublicText(text, name);
    }
    const consumer = path.join(temporary, 'consumer');
    await fs.mkdir(consumer);
    await fs.writeFile(path.join(consumer, 'package.json'), JSON.stringify({ name: 'release-consumer', private: true, type: 'module' }));
    await run(process.execPath, [process.env.npm_execpath, 'install', '--offline', '--ignore-scripts', '--no-audit', '--no-fund', '--package-lock=false', path.join(temporary, packed.filename)], consumer);
    await run(process.execPath, ['--input-type=module', '--eval', `
      import assert from 'node:assert/strict';
      const client = await import('midnight-verify-plugin');
      for (const name of ['buildVerificationBundle','loadVerificationBundle','validateBundle','normalizeAddress','verifyContract','PluginError']) assert.equal(typeof client[name], 'function');
      assert.equal(client.normalizeAddress('ab'.repeat(32)), '0x' + 'ab'.repeat(32));
    `], consumer);
    const cli = path.join(consumer, 'node_modules', 'midnight-verify-plugin', 'dist', 'cli.js');
    const help = await run(process.execPath, [cli, '--help'], consumer);
    assert.ok(help.includes('--compiler-mode compact|compactc'));
    await fs.access(path.join(consumer, 'node_modules', '.bin', process.platform === 'win32' ? 'midnight-verify.cmd' : 'midnight-verify'));
    await fs.writeFile(path.join(consumer, 'consumer.ts'), `
      import {buildVerificationBundle, verifyContract, type BuildOptions, type VerifyOptions, type VerificationBundle} from 'midnight-verify-plugin';
      const build: BuildOptions = {sourceDir:'contracts', entryFile:'main.compact', compilerVersion:'0.31.1', compilerMode:'compactc', compilerBin:'compactc', outputDir:'managed/contract'};
      const bundle: Promise<VerificationBundle> = buildVerificationBundle(build);
      const verify: VerifyOptions = {network:'preview', address:'ab'.repeat(32), buildInfo:'managed/contract/verification.json'};
      void bundle; void verifyContract(verify);
    `);
    await fs.writeFile(path.join(consumer, 'tsconfig.json'), JSON.stringify({ compilerOptions: { strict: true, noEmit: true, target: 'ES2022', module: 'NodeNext', moduleResolution: 'NodeNext', types: [] }, files: ['consumer.ts'] }));
    await run(process.execPath, [path.join(root, 'node_modules', 'typescript', 'bin', 'tsc'), '-p', consumer], consumer);
    const pkg = JSON.parse(await fs.readFile(path.join(root, 'package.json'), 'utf8'));
    const metadataPending = [];
    if (!pkg.repository) metadataPending.push('repository URL');
    if (!pkg.license || pkg.license === 'UNLICENSED') metadataPending.push('license');
    if (pkg.private) metadataPending.push('npm publication remains disabled');
    return { packageFiles: names.length, consumerExports: true, consumerCli: true, consumerTypes: true, metadataPending };
  } finally {
    await fs.rm(temporary, { recursive: true, force: true });
  }
}

async function main() {
  const sources = await checkSources();
  const packaged = values['source-only'] ? {} : await checkPackage();
  console.log(JSON.stringify({ status: 'passed', ...sources, ...packaged }, null, 2));
}

main().catch(error => {
  console.error('Release checks failed:', error.message);
  process.exitCode = 1;
});
