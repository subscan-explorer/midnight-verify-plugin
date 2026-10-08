import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import * as fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

export const API_KEY = 'local-test-key-not-a-credential';
export const ADDRESS = 'ab'.repeat(32);

export function bundle(sources = { 'main.compact': 'pragma language_version 0.23;\n' }, entryFile = 'main.compact', compilerVersion = '0.31.1') {
  const sorted = Object.fromEntries(Object.entries(sources).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0));
  return {
    schemaVersion: 1, compilerVersion, entryFile, sources: sorted,
    sourceDigest: createHash('sha256').update(JSON.stringify({ entryFile, sources: sorted })).digest('hex'),
  };
}

export function status(extra = {}) {
  return { verify_time: 0, verifying: false, last_verify_error: '', ...extra };
}

export function verified(input, extra = {}) {
  return status({
    verify_time: 123,
    compiler_version: input.compilerVersion,
    source_type: Object.keys(input.sources).length === 1 ? 'single_file' : 'multi_file',
    source_code: Object.keys(input.sources).length === 1 ? input.sources[input.entryFile]
      : JSON.stringify({ contracts: input.sources, 'entry-file': input.entryFile }),
    ...extra,
  });
}

export async function temporary(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'midnight-verify-test-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  return root;
}

export async function compiler(root, body, mode = 'compact') {
  const file = path.join(root, 'compact-fixture.mjs');
  await fs.writeFile(file, '#!/usr/bin/env node\n' +
    "import * as fs from 'node:fs/promises';\nimport path from 'node:path';\n" +
    (mode === 'compactc' ? 'const [entry, out] = process.argv.slice(2);\n' : 'const [command, version, entry, out] = process.argv.slice(2);\n') +
    body + '\n', { mode: 0o700 });
  return file;
}

export const compileSuccessfully = `
if (command !== 'compile') throw new Error('Unexpected command');
await fs.mkdir(path.join(out, 'compiler'), { recursive: true });
await fs.mkdir(path.join(out, 'contract'), { recursive: true });
await fs.mkdir(path.join(out, 'keys'), { recursive: true });
await fs.writeFile(path.join(out, 'compiler', 'contract-info.json'), JSON.stringify({ 'compiler-version': version.slice(1), circuits: [{ name: 'demo', proof: true }] }));
await fs.writeFile(path.join(out, 'keys', 'demo.prover'), 'fixture prover');
await fs.writeFile(path.join(out, 'keys', 'demo.verifier'), 'fixture verifier');
await fs.writeFile(path.join(out, 'contract', 'index.js'), await fs.readFile(entry, 'utf8'));
`;

export async function apiServer(t, handle) {
  const requests = [];
  const failures = [];
  const server = createServer(async (req, res) => {
    try {
      let bytes = '';
      for await (const chunk of req) bytes += chunk;
      const request = { endpoint: req.url?.split('/').at(-1), path: req.url, body: JSON.parse(bytes), headers: req.headers };
      requests.push(request);
      const reply = (data, message = '', code = 0) => {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ code, message, data }));
      };
      if (request.endpoint === 'version') reply(['0.31.1']);
      else await handle(request, reply, res);
    } catch (error) {
      failures.push(error);
      res.writeHead(500);
      res.end();
    }
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  t.after(async () => {
    server.closeAllConnections();
    await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    if (failures.length) throw failures[0];
  });
  return { origin: 'http://127.0.0.1:' + server.address().port, requests };
}

export function verifyOptions(origin, input = bundle(), extra = {}) {
  return { network: 'preview', address: ADDRESS, buildInfo: input, apiKey: API_KEY, apiUrl: origin,
    timeoutMs: 1000, requestTimeoutMs: 200, pollIntervalMs: 5, maxPollIntervalMs: 20, ...extra };
}
