import assert from 'node:assert/strict';
import test from 'node:test';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import { buildVerificationBundle, loadVerificationBundle, validateBundle } from '../dist/index.js';
import { bundle, temporary, compiler, compileSuccessfully } from './helpers.mjs';

test('compiles frozen multi-file input and publishes that snapshot with deployable assets', async t => {
  const root = await temporary(t);
  const sourceDir = path.join(root, 'contracts');
  await fs.mkdir(path.join(sourceDir, 'src'), { recursive: true });
  await fs.mkdir(path.join(sourceDir, 'lib'));
  await fs.mkdir(path.join(sourceDir, 'node_modules'));
  const original = 'pragma language_version 0.23;\ninclude "../lib/types";\n';
  const entry = path.join(sourceDir, 'src', 'main.compact');
  await fs.writeFile(entry, original);
  await fs.writeFile(path.join(sourceDir, 'lib', 'types.compact'), 'export struct State { value: Boolean; }\n');
  await fs.writeFile(path.join(sourceDir, '.env'), 'wallet_seed=DO_NOT_COLLECT');
  await fs.writeFile(path.join(sourceDir, 'node_modules', 'excluded.compact'), 'DO_NOT_COLLECT');
  const compilerBin = await compiler(root, `
await fs.writeFile(${JSON.stringify(entry)}, 'CHANGED_AFTER_CAPTURE');
if (!(await fs.readFile(path.join(path.dirname(entry), '../lib/types.compact'), 'utf8')).includes('State')) throw new Error('Relative source missing');
${compileSuccessfully}`);
  const outputDir = path.join(root, 'managed', 'contract');
  const result = await buildVerificationBundle({ sourceDir, entryFile: 'src/main.compact', compilerVersion: '0.31.1', outputDir, compilerBin });
  assert.deepEqual(Object.keys(result.sources), ['lib/types.compact', 'src/main.compact']);
  assert.equal(result.sources['src/main.compact'], original);
  assert.equal(await fs.readFile(entry, 'utf8'), 'CHANGED_AFTER_CAPTURE');
  assert.equal(await fs.readFile(path.join(outputDir, 'contract', 'index.js'), 'utf8'), original);
  assert.deepEqual(await loadVerificationBundle(path.join(outputDir, 'verification.json')), result);
  const serialized = await fs.readFile(path.join(outputDir, 'verification.json'), 'utf8');
  assert.ok(!serialized.includes('DO_NOT_COLLECT'));
});

test('validates exact compiler versions, normalized paths and snapshot integrity', () => {
  const valid = bundle();
  assert.equal(validateBundle(valid).compilerVersion, '0.31.1');
  for (const input of [
    { ...valid, compilerVersion: '0.23' },
    { ...valid, compilerVersion: 'latest' },
    { ...valid, sources: { ...valid.sources, 'main.compact': 'tampered' } },
    bundle({ '../escape.compact': '' }, '../escape.compact'),
    bundle({ '/absolute.compact': '' }, '/absolute.compact'),
    bundle({ 'a\\b.compact': '' }, 'a\\b.compact'),
    bundle({ './main.compact': '' }, './main.compact'),
    bundle({}, 'missing.compact'),
    bundle({ 'main.compact': 'x'.repeat(256 * 1024 + 1) }),
    bundle(Object.fromEntries(Array.from({ length: 129 }, (_, i) => [`${i}.compact`, ''])), '0.compact'),
  ]) {
    assert.throws(() => validateBundle(input), { code: 'INVALID_INPUT' });
  }
});

test('launcher builds honor configurable exact versions beyond the validated Preview version', async t => {
  const root = await temporary(t);
  await fs.writeFile(path.join(root, 'main.compact'), 'fixture source');
  const compilerBin = await compiler(root, compileSuccessfully);
  for (const compilerVersion of ['0.31.0', '0.35.0']) {
    const outputDir = path.join(root, 'output-' + compilerVersion);
    const result = await buildVerificationBundle({ sourceDir: root, entryFile: 'main.compact', compilerVersion, outputDir, compilerBin });
    assert.equal(result.compilerVersion, compilerVersion);
    assert.equal((await loadVerificationBundle(path.join(outputDir, 'verification.json'))).compilerVersion, compilerVersion);
  }
});

test('direct compactc receives source and output arguments and still rejects a version mismatch', async t => {
  const root = await temporary(t);
  await fs.writeFile(path.join(root, 'main.compact'), 'fixture source');
  const compilerBin = await compiler(root, `
if (process.argv.slice(2).length !== 2 || !entry.endsWith('main.compact')) throw new Error('Unexpected compactc arguments');
const command = 'compile', version = '+0.35.0';
${compileSuccessfully}`, 'compactc');
  const options = { sourceDir: root, entryFile: 'main.compact', compilerMode: 'compactc', compilerBin };
  const result = await buildVerificationBundle({ ...options, compilerVersion: '0.35.0', outputDir: path.join(root, 'native') });
  assert.equal(result.compilerVersion, '0.35.0');
  const mismatch = path.join(root, 'mismatch');
  await assert.rejects(buildVerificationBundle({ ...options, compilerVersion: '0.31.0', outputDir: mismatch }), { code: 'BUILD_FAILED' });
  await assert.rejects(fs.stat(mismatch), { code: 'ENOENT' });
  await assert.rejects(buildVerificationBundle({ ...options, compilerMode: 'unknown', compilerVersion: '0.35.0', outputDir: mismatch }), { code: 'INVALID_INPUT' });
});

test('bounds total source bytes and escaped JSON bundle bytes', () => {
  const large = Object.fromEntries(Array.from({ length: 9 }, (_, i) => [`${i}.compact`, 'x'.repeat(256 * 1024)]));
  assert.throws(() => validateBundle(bundle(large, '0.compact')), { code: 'INVALID_INPUT' });
  const escaped = Object.fromEntries(Array.from({ length: 4 }, (_, i) => [`${i}.compact`, '\0'.repeat(256 * 1024)]));
  assert.throws(() => validateBundle(bundle(escaped, '0.compact')), /Serialized verification bundle/);
});

test('rejects symlinks and oversized bundle files without following them', async t => {
  const root = await temporary(t);
  const sourceDir = path.join(root, 'sources');
  await fs.mkdir(sourceDir);
  await fs.writeFile(path.join(root, 'outside.compact'), 'outside');
  await fs.symlink(path.join(root, 'outside.compact'), path.join(sourceDir, 'main.compact'));
  await assert.rejects(buildVerificationBundle({ sourceDir, entryFile: 'main.compact', compilerVersion: '0.31.1',
    outputDir: path.join(root, 'output'), compilerBin: '/must-not-run' }), { code: 'INVALID_INPUT' });
  const jsonFile = path.join(root, 'bundle.json');
  await fs.writeFile(jsonFile, JSON.stringify(bundle()));
  await fs.symlink(jsonFile, path.join(root, 'link.json'));
  await assert.rejects(loadVerificationBundle(path.join(root, 'link.json')), { code: 'INVALID_INPUT' });
  await fs.writeFile(jsonFile, 'x'.repeat(4 * 1024 * 1024 + 1));
  await assert.rejects(loadVerificationBundle(jsonFile), { code: 'INVALID_INPUT' });
});

test('refuses existing output before invoking the compiler and preserves it', async t => {
  const root = await temporary(t);
  const outputDir = path.join(root, 'output');
  await fs.mkdir(outputDir);
  await fs.writeFile(path.join(outputDir, 'keep'), 'existing deployment');
  await assert.rejects(buildVerificationBundle({ sourceDir: '/missing', entryFile: 'main.compact', compilerVersion: '0.31.1',
    outputDir, compilerBin: '/must-not-run' }), { code: 'INVALID_INPUT' });
  assert.equal(await fs.readFile(path.join(outputDir, 'keep'), 'utf8'), 'existing deployment');
});

test('compiler metadata mismatch and compile failure expose no partial output', async t => {
  const root = await temporary(t);
  await fs.writeFile(path.join(root, 'main.compact'), 'pragma language_version 0.23;\n');
  for (const [name, body] of [
    ['mismatch', compileSuccessfully + "\nawait fs.writeFile(path.join(out, 'compiler', 'contract-info.json'), JSON.stringify({ 'compiler-version': '0.30.0' }));"],
    ['failure', 'process.exitCode = 1;'],
    ['missing-keys', compileSuccessfully + "\nawait fs.rm(path.join(out, 'keys', 'demo.verifier'));"],
  ]) {
    const compilerBin = await compiler(root, body);
    const outputDir = path.join(root, name);
    await assert.rejects(buildVerificationBundle({ sourceDir: root, entryFile: 'main.compact', compilerVersion: '0.31.1', outputDir, compilerBin }), { code: 'BUILD_FAILED' });
    await assert.rejects(fs.stat(outputDir), { code: 'ENOENT' });
  }
});

test('cancels compilation and rejects external search paths', async t => {
  const root = await temporary(t);
  await fs.writeFile(path.join(root, 'main.compact'), 'pragma language_version 0.23;\n');
  const compilerBin = await compiler(root, 'await new Promise(resolve => setTimeout(resolve, 30_000));');
  const options = { sourceDir: root, entryFile: 'main.compact', compilerVersion: '0.31.1', outputDir: path.join(root, 'output'), compilerBin, timeoutMs: 100 };
  await assert.rejects(buildVerificationBundle(options), { code: 'CANCELLED' });
  await assert.rejects(fs.stat(options.outputDir), { code: 'ENOENT' });
  const previous = process.env.COMPACT_PATH;
  try {
    process.env.COMPACT_PATH = root;
    await assert.rejects(buildVerificationBundle(options), { code: 'UNSUPPORTED_BUILD' });
  } finally {
    if (previous === undefined) delete process.env.COMPACT_PATH;
    else process.env.COMPACT_PATH = previous;
  }
});
