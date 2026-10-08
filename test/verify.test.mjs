import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeAddress, verifyContract } from '../dist/index.js';
import { ADDRESS, API_KEY, bundle, status, verified, apiServer, verifyOptions } from './helpers.mjs';

test('normalizes SDK hex addresses and rejects unsupported representations', () => {
  assert.equal(normalizeAddress(ADDRESS.toUpperCase()), `0x${ADDRESS}`);
  assert.equal(normalizeAddress(`0x${ADDRESS}`), `0x${ADDRESS}`);
  for (const address of ['', 'xyz', 'mn_addr1example', '0x' + 'a'.repeat(63), 'a'.repeat(65), '../file']) {
    assert.throws(() => normalizeAddress(address), { code: 'INVALID_INPUT' });
  }
});

test('waits for indexing, submits multi-file input once, then confirms matching verification', async t => {
  const input = bundle({ 'main.compact': 'include "lib/types";\n', 'lib/types.compact': 'export struct State { value: Boolean; }\n' });
  let reads = 0;
  const api = await apiServer(t, (request, reply) => {
    assert.equal(request.headers['x-api-key'], API_KEY);
    if (request.endpoint === 'verify') {
      assert.equal(request.body.contract_address, `0x${ADDRESS}`);
      assert.equal(request.body.compiler_version, '0.31.1');
      assert.equal(request.body.source_type, 'multi_file');
      assert.deepEqual(JSON.parse(request.body.source_code), { contracts: input.sources, 'entry-file': input.entryFile });
      assert.ok(!Object.hasOwn(request.body, 'verification_keys'));
      reply(null);
    } else {
      assert.deepEqual(request.body, { contract: `0x${ADDRESS}` });
      reads++;
      if (reads === 1) reply(null, 'Contract not found', 1);
      else if (reads === 2) reply(status());
      else if (reads === 3) reply(status({ verifying: true }));
      else reply(verified(input));
    }
  });
  const result = await verifyContract(verifyOptions(api.origin, input));
  assert.equal(result.status, 'verified');
  assert.equal(result.matchesBundle, true);
  assert.equal(result.contractUrl, `https://midnight-preview.subscan.io/contract/0x${ADDRESS}?tab=contract`);
  assert.equal(api.requests.filter(r => r.endpoint === 'verify').length, 1);
  assert.equal(api.requests.filter(r => r.endpoint === 'version').length, 1);
});

test('returns existing verification with explicit source equality and never submits', async t => {
  const input = bundle();
  for (const [network, extra, matching] of [
    ['preview', {}, true],
    ['preprod', { source_code: 'other source' }, false],
    ['mainnet', { compiler_version: '0.30.0' }, false],
  ]) {
    const api = await apiServer(t, (request, reply) => {
      assert.equal(request.endpoint, 'contract');
      reply(verified(input, extra));
    });
    const result = await verifyContract(verifyOptions(api.origin, input, { network }));
    assert.equal(result.status, 'already-verified');
    assert.equal(result.matchesBundle, matching);
    assert.equal(api.requests.filter(r => r.endpoint === 'verify').length, 0);
    assert.ok(result.contractUrl.includes(network === 'mainnet' ? 'midnight.subscan.io' : `midnight-${network}.subscan.io`));
  }
});

test('compares multi-file records independent of JSON map order but requires the entire source set', async t => {
  const input = bundle({ 'main.compact': 'MAIN', 'lib.compact': 'LIB' });
  const api = await apiServer(t, (request, reply) => reply(verified(input, {
    source_code: JSON.stringify({ 'entry-file': 'main.compact', contracts: { 'main.compact': 'MAIN', 'lib.compact': 'LIB' } }),
  })));
  assert.equal((await verifyContract(verifyOptions(api.origin, input))).matchesBundle, true);
  const incomplete = await apiServer(t, (request, reply) => reply(verified(input, {
    source_code: JSON.stringify({ 'entry-file': 'main.compact', contracts: { 'main.compact': 'MAIN' } }),
  })));
  assert.equal((await verifyContract(verifyOptions(incomplete.origin, input))).matchesBundle, false);
});

test('ignores unchanged old errors, but reports failure after a running transition', async t => {
  const api = await apiServer(t, (request, reply) => reply(request.endpoint === 'verify' ? null : status({ last_verify_error: 'old failure' })));
  const pending = await verifyContract(verifyOptions(api.origin, bundle(), { timeoutMs: 120 }));
  assert.equal(pending.status, 'pending');
  assert.equal(pending.phase, 'verifying');
  assert.equal(api.requests.filter(r => r.endpoint === 'verify').length, 1);
  let reads = 0;
  const failed = await apiServer(t, (request, reply) => {
    if (request.endpoint === 'verify') reply(null);
    else {
      reads++;
      reply(status({ verifying: reads === 2, last_verify_error: 'old failure' }));
    }
  });
  await assert.rejects(verifyContract(verifyOptions(failed.origin)), { code: 'VERIFICATION_FAILED' });
});

test('joins an existing running job without resubmitting or attributing its verification to a new submit', async t => {
  const input = bundle();
  let reads = 0;
  const api = await apiServer(t, (request, reply) => {
    assert.equal(request.endpoint, 'contract');
    reply(++reads === 1 ? status({ verifying: true, last_verify_error: 'previous attempt' }) : verified(input));
  });
  const result = await verifyContract(verifyOptions(api.origin, input));
  assert.equal(result.status, 'already-verified');
  assert.equal(result.matchesBundle, true);
  assert.equal(api.requests.filter(r => r.endpoint === 'verify').length, 0);
});

test('lost submission acknowledgement is reconciled through reads, never through another submit', async t => {
  const input = bundle();
  let submitted = false;
  const api = await apiServer(t, (request, reply, response) => {
    if (request.endpoint === 'verify') { submitted = true; response.destroy(); }
    else reply(submitted ? verified(input) : status());
  });
  assert.equal((await verifyContract(verifyOptions(api.origin, input))).status, 'verified');
  assert.equal(api.requests.filter(r => r.endpoint === 'verify').length, 1);
});

test('a stalled acknowledgement body becomes pending submission uncertainty', async t => {
  const api = await apiServer(t, (request, reply, response) => {
    if (request.endpoint === 'verify') {
      response.writeHead(200, { 'Content-Type': 'application/json' });
      response.write('{"code":');
    } else reply(status());
  });
  const result = await verifyContract(verifyOptions(api.origin, bundle(), { requestTimeoutMs: 40, timeoutMs: 180 }));
  assert.equal(result.status, 'pending');
  assert.equal(result.phase, 'submission-unknown');
  assert.equal(api.requests.filter(r => r.endpoint === 'verify').length, 1);
});

test('retries rate-limited status reads within the deadline and without resubmission', async t => {
  const input = bundle();
  let reads = 0;
  const api = await apiServer(t, (request, reply, response) => {
    if (request.endpoint === 'verify') reply(null);
    else if (++reads === 2) { response.writeHead(429); response.end(); }
    else reply(reads > 2 ? verified(input) : status());
  });
  assert.equal((await verifyContract(verifyOptions(api.origin, input))).status, 'verified');
  assert.equal(api.requests.filter(r => r.endpoint === 'verify').length, 1);
});

test('indexing deadline returns pending and does not submit', async t => {
  const api = await apiServer(t, (request, reply) => reply(null, 'Contract not found', 1));
  const result = await verifyContract(verifyOptions(api.origin, bundle(), { timeoutMs: 100 }));
  assert.equal(result.status, 'pending');
  assert.equal(result.phase, 'indexing');
  assert.equal(api.requests.filter(r => r.endpoint === 'verify').length, 0);
});

test('unsupported compiler, invalid network, unsafe URL and missing credentials fail before submit', async t => {
  const api = await apiServer(t, (request, reply) => reply(status()));
  await assert.rejects(verifyContract(verifyOptions(api.origin, bundle(undefined, undefined, '0.30.0'))), { code: 'UNSUPPORTED_BUILD' });
  for (const options of [
    { network: 'devnet' }, { apiUrl: 'http://example.org' }, { apiUrl: 'https://user:password@example.org' },
    { apiUrl: 'https://example.org/path' }, { apiUrl: 'https://example.org?secret=value' },
    { apiKey: '' }, { apiKey: ['key', 'value'].join('\n') }, { timeoutMs: 0 }, { pollIntervalMs: 10, maxPollIntervalMs: 5 },
  ]) {
    await assert.rejects(verifyContract(verifyOptions(api.origin, bundle(), options)), { code: 'INVALID_INPUT' });
  }
  assert.equal(api.requests.filter(r => r.endpoint === 'verify').length, 0);
});

test('API error messages and terminal job errors redact the caller API key', async t => {
  const api = await apiServer(t, (request, reply) => reply(null, `invalid API key ${API_KEY}`, 1));
  await assert.rejects(verifyContract(verifyOptions(api.origin)), error => {
    assert.equal(error.code, 'API_ERROR');
    assert.ok(error.message.includes('[redacted]'));
    assert.ok(!error.message.includes(API_KEY));
    return true;
  });
  let reads = 0;
  const failed = await apiServer(t, (request, reply) => {
    if (request.endpoint === 'verify') reply(null);
    else reply(status({ last_verify_error: ++reads > 1 ? `failure ${API_KEY}` : '' }));
  });
  await assert.rejects(verifyContract(verifyOptions(failed.origin)), error => {
    assert.equal(error.code, 'VERIFICATION_FAILED');
    assert.ok(!error.message.includes(API_KEY));
    return true;
  });
});

test('caller cancellation aborts a stalled HTTP request', async t => {
  let entered;
  const requestStarted = new Promise(resolve => { entered = resolve; });
  const api = await apiServer(t, () => { entered(); });
  const controller = new AbortController();
  const result = verifyContract(verifyOptions(api.origin, bundle(), { signal: controller.signal }));
  await requestStarted;
  controller.abort();
  await assert.rejects(result, { code: 'CANCELLED' });
});

test('rejects redirects rather than forwarding API credentials', async t => {
  const destination = await apiServer(t, (request, reply) => reply(status()));
  const api = await apiServer(t, (request, reply, response) => {
    response.writeHead(307, { Location: destination.origin + request.path });
    response.end();
  });
  await assert.rejects(verifyContract(verifyOptions(api.origin)), { code: 'API_ERROR' });
  assert.equal(destination.requests.length, 0);
});
