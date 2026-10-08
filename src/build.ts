import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { constants } from 'node:fs';
import * as fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { BuildOptions, PluginError, VerificationBundle } from './types.js';

const execute = promisify(execFile);
const MAX_FILES = 128;
const MAX_FILE_BYTES = 256 * 1024;
const MAX_SOURCE_BYTES = 2 * 1024 * 1024;
const MAX_BUNDLE_BYTES = 4 * 1024 * 1024;
const EXCLUDED = new Set(['.git', 'node_modules', 'managed', 'dist', 'target']);

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function sourcePath(value: unknown): asserts value is string {
  if (typeof value !== 'string' || value.length > 512 || !value.endsWith('.compact') ||
      /[\\:\x00-\x1f]/.test(value) || path.posix.isAbsolute(value) ||
      path.posix.normalize(value) !== value || value.split('/').some(p => p === '..' || p === '.') ||
      value.split('/').length > 32) {
    throw new PluginError('INVALID_INPUT', 'Compact paths must be normalized relative .compact paths');
  }
}

function version(value: unknown): asserts value is string {
  if (typeof value !== 'string' || !/^\d+\.\d+\.\d+$/.test(value)) {
    throw new PluginError('INVALID_INPUT', 'An exact Compact compiler version is required');
  }
}

function digest(entryFile: string, sources: Record<string, string>): string {
  const sorted = Object.fromEntries(Object.entries(sources).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0));
  return createHash('sha256').update(JSON.stringify({ entryFile, sources: sorted })).digest('hex');
}

/** validateBundle rejects tampered input and unsafe paths before any network request. */
export function validateBundle(value: unknown): VerificationBundle {
  if (!record(value) || value.schemaVersion !== 1 || !record(value.sources)) {
    throw new PluginError('INVALID_INPUT', 'Expected a version 1 verification bundle');
  }
  version(value.compilerVersion);
  sourcePath(value.entryFile);
  const entries = Object.entries(value.sources);
  if (entries.length === 0 || entries.length > MAX_FILES) {
    throw new PluginError('INVALID_INPUT', `Bundle must contain 1-${MAX_FILES} Compact files`);
  }
  let total = 0;
  const sources: Record<string, string> = Object.create(null) as Record<string, string>;
  for (const [name, text] of entries) {
    sourcePath(name);
    if (typeof text !== 'string' || Buffer.byteLength(text) > MAX_FILE_BYTES) {
      throw new PluginError('INVALID_INPUT', 'Source file exceeds the allowed size or is not text');
    }
    total += Buffer.byteLength(text);
    sources[name] = text;
  }
  if (total > MAX_SOURCE_BYTES || !Object.hasOwn(sources, value.entryFile)) {
    throw new PluginError('INVALID_INPUT', 'Missing entry file or excessive total source size');
  }
  if (value.sourceDigest !== digest(value.entryFile, sources)) {
    throw new PluginError('INVALID_INPUT', 'Source snapshot digest does not match its contents');
  }
  const bundle: VerificationBundle = { schemaVersion: 1, compilerVersion: value.compilerVersion, entryFile: value.entryFile, sources, sourceDigest: value.sourceDigest as string };
  if (Buffer.byteLength(JSON.stringify(bundle, null, 2) + '\n') > MAX_BUNDLE_BYTES) {
    throw new PluginError('INVALID_INPUT', 'Serialized verification bundle exceeds the allowed size');
  }
  return bundle;
}

async function readBounded(file: string, limit: number): Promise<Buffer> {
  const handle = await fs.open(file, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const stat = await handle.stat();
    if (!stat.isFile() || stat.size > limit) throw new PluginError('INVALID_INPUT', 'Input file exceeds the allowed size or is not a regular file');
    const bytes = Buffer.alloc(limit + 1);
    let size = 0;
    while (size < bytes.length) {
      const read = await handle.read(bytes, size, bytes.length - size, null);
      if (!read.bytesRead) break;
      size += read.bytesRead;
    }
    if (size > limit) throw new PluginError('INVALID_INPUT', 'Input file exceeds the allowed size');
    return bytes.subarray(0, size);
  } finally {
    await handle.close();
  }
}

/** loadVerificationBundle validates a bounded JSON file without following symlinks. */
export async function loadVerificationBundle(file: string): Promise<VerificationBundle> {
  try {
    return validateBundle(JSON.parse((await readBounded(file, MAX_BUNDLE_BYTES)).toString('utf8')));
  } catch (error) {
    if (error instanceof PluginError) throw error;
    throw new PluginError('INVALID_INPUT', 'Cannot read verification bundle', { cause: error });
  }
}

async function captureSources(root: string, signal: AbortSignal): Promise<Record<string, string>> {
  if (!(await fs.lstat(root)).isDirectory()) throw new PluginError('INVALID_INPUT', 'Source root must be a real directory');
  const sources: Record<string, string> = Object.create(null) as Record<string, string>;
  let visited = 0;
  let total = 0;
  const walk = async (relative: string, depth: number): Promise<void> => {
    if (depth > 32) throw new PluginError('INVALID_INPUT', 'Source directory nesting is too deep');
    const directory = await fs.opendir(path.join(root, relative));
    for await (const entry of directory) {
      signal.throwIfAborted();
      if (++visited > 4096) throw new PluginError('INVALID_INPUT', 'Source directory contains too many entries');
      if (EXCLUDED.has(entry.name)) continue;
      if (entry.isSymbolicLink()) throw new PluginError('INVALID_INPUT', 'Symlinks are not allowed in the source tree');
      const name = relative ? `${relative}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        await walk(name, depth + 1);
      } else if (entry.isFile() && entry.name.endsWith('.compact')) {
        sourcePath(name);
        if (Object.keys(sources).length >= MAX_FILES) throw new PluginError('INVALID_INPUT', 'Too many Compact source files');
        const bytes = await readBounded(path.join(root, name), MAX_FILE_BYTES);
        total += bytes.length;
        if (total > MAX_SOURCE_BYTES) throw new PluginError('INVALID_INPUT', 'Excessive total source size');
        sources[name] = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
      }
    }
  };
  await walk('', 0);
  return Object.fromEntries(Object.entries(sources).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0));
}

/** buildVerificationBundle compiles frozen inputs and writes deployable assets plus verification.json. */
export async function buildVerificationBundle(options: BuildOptions): Promise<VerificationBundle> {
  version(options.compilerVersion);
  sourcePath(options.entryFile);
  const compilerMode = options.compilerMode ?? 'compact';
  if (compilerMode !== 'compact' && compilerMode !== 'compactc') {
    throw new PluginError('INVALID_INPUT', 'Compiler mode must be compact or compactc');
  }
  if (process.env.COMPACT_PATH?.trim()) throw new PluginError('UNSUPPORTED_BUILD', 'COMPACT_PATH is unsupported by the current verification API');
  const timeoutMs = options.timeoutMs ?? 120_000;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0 || timeoutMs > 2_147_483_647) {
    throw new PluginError('INVALID_INPUT', 'Build timeout must be a positive integer within the timer limit');
  }
  const signal = AbortSignal.any([AbortSignal.timeout(timeoutMs), ...(options.signal ? [options.signal] : [])]);
  const root = path.resolve(options.sourceDir);
  const output = path.resolve(options.outputDir);
  let temporary: string | undefined;
  let ownsOutput = false;
  try {
    signal.throwIfAborted();
    try {
      await fs.lstat(output);
      throw new PluginError('INVALID_INPUT', 'Output directory already exists; choose an unused path');
    } catch (error) {
      if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error;
    }
    const sources = await captureSources(root, signal);
    const bundle = validateBundle({ schemaVersion: 1, compilerVersion: options.compilerVersion,
      entryFile: options.entryFile, sources, sourceDigest: digest(options.entryFile, sources) });
    temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'midnight-verify-build-'));
    const frozen = path.join(temporary, 'sources');
    const compiled = path.join(temporary, 'managed');
    for (const [name, text] of Object.entries(bundle.sources)) {
      signal.throwIfAborted();
      const destination = path.join(frozen, name);
      await fs.mkdir(path.dirname(destination), { recursive: true });
      await fs.writeFile(destination, text, { flag: 'wx', mode: 0o600 });
    }
    const compilerArgs = compilerMode === 'compact' ? ['compile', `+${bundle.compilerVersion}`] : [];
    compilerArgs.push(path.join(frozen, bundle.entryFile), compiled);
    await execute(options.compilerBin ?? compilerMode, compilerArgs,
      { signal, timeout: timeoutMs, maxBuffer: 1024 * 1024, env: { ...process.env, COMPACT_PATH: '' } });
    const metadata = JSON.parse((await readBounded(path.join(compiled, 'compiler', 'contract-info.json'), MAX_FILE_BYTES)).toString('utf8')) as unknown;
    if (!record(metadata) || metadata['compiler-version'] !== bundle.compilerVersion) {
      throw new PluginError('BUILD_FAILED', 'Compiler metadata does not match the requested exact version');
    }
    if (!Array.isArray(metadata.circuits)) throw new PluginError('BUILD_FAILED', 'Compiler metadata must describe its circuits');
    // Compact can exit successfully after warning that zkir was missing; never expose incomplete proof assets.
    for (const circuit of metadata.circuits) {
      if (!record(circuit) || typeof circuit.proof !== 'boolean' || typeof circuit.name !== 'string' ||
          !circuit.name || circuit.name === '.' || circuit.name === '..' || /[\\/:\x00-\x1f]/.test(circuit.name)) {
        throw new PluginError('BUILD_FAILED', 'Unexpected circuit metadata');
      }
      if (!circuit.proof) continue;
      for (const extension of ['prover', 'verifier']) {
        const key = await fs.lstat(path.join(compiled, 'keys', `${circuit.name}.${extension}`));
        if (!key.isFile() || key.size === 0) throw new PluginError('BUILD_FAILED', 'Compiler did not generate complete proving and verifier keys');
      }
    }
    signal.throwIfAborted();
    await fs.mkdir(path.dirname(output), { recursive: true });
    await fs.mkdir(output); // Never overwrite an existing deployment artifact directory.
    ownsOutput = true;
    await fs.cp(compiled, output, { recursive: true, errorOnExist: true, force: false });
    signal.throwIfAborted();
    await fs.writeFile(path.join(output, 'verification.json'), JSON.stringify(bundle, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
    ownsOutput = false;
    return bundle;
  } catch (error) {
    if (signal.aborted) throw new PluginError('CANCELLED', 'Build cancelled or timed out', { cause: error });
    if (error instanceof PluginError) throw error;
    throw new PluginError('BUILD_FAILED', 'Build failed; check the compiler, relative imports and unused output directory', { cause: error });
  } finally {
    if (ownsOutput) await fs.rm(output, { recursive: true, force: true });
    if (temporary) await fs.rm(temporary, { recursive: true, force: true });
  }
}
