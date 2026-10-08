import { setTimeout as sleep } from 'node:timers/promises';
import { loadVerificationBundle, validateBundle } from './build.js';
import { MidnightNetwork, PluginError, VerificationBundle, VerifyOptions, VerifyResult } from './types.js';

const NETWORKS = {
  preview: 'midnight-preview',
  preprod: 'midnight-preprod',
  mainnet: 'midnight',
} as const;

interface ContractRecord {
  verify_time: number;
  verifying: boolean;
  last_verify_error: string;
  compiler_version?: string;
  source_type?: string;
  source_code?: string;
}

class ApiError extends PluginError {
  constructor(message: string, public readonly httpStatus?: number, public readonly serverMessage?: string) {
    super('API_ERROR', message);
  }
}

function object(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** normalizeAddress accepts SDK hex output and the Subscan 0x-prefixed representation. */
export function normalizeAddress(address: string): string {
  if (!/^(?:0x)?[0-9a-fA-F]{64}$/.test(address)) {
    throw new PluginError('INVALID_INPUT', 'Address must contain 64 hexadecimal digits; Bech32 is not yet supported');
  }
  return `0x${address.replace(/^0x/, '').toLowerCase()}`;
}

function positive(value: number | undefined, fallback: number): number {
  const result = value ?? fallback;
  if (!Number.isSafeInteger(result) || result <= 0 || result > 2_147_483_647) {
    throw new PluginError('INVALID_INPUT', 'Timeouts and polling intervals must be positive integers');
  }
  return result;
}

function apiOrigin(value: string): string {
  let url: URL;
  try { url = new URL(value); } catch { throw new PluginError('INVALID_INPUT', 'Invalid API URL'); }
  const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if ((url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback)) ||
      url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
    throw new PluginError('INVALID_INPUT', 'API URL must be an HTTPS origin, or local HTTP origin for tests');
  }
  return url.origin;
}

async function responseBody(response: Response): Promise<unknown> {
  if (!response.body) throw new ApiError('Empty API response', response.status);
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const item = await reader.read();
      if (item.done) break;
      size += item.value.byteLength;
      if (size > 8 * 1024 * 1024) {
        await reader.cancel();
        throw new ApiError('API response exceeds size limit', response.status);
      }
      chunks.push(item.value);
    }
    try { return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown; }
    catch { throw new ApiError('API returned invalid JSON', response.status); }
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError('API response could not be read');
  } finally {
    reader.releaseLock();
  }
}

function sourcePayload(bundle: VerificationBundle): { source_type: string; source_code: string } {
  if (Object.keys(bundle.sources).length === 1) {
    return { source_type: 'single_file', source_code: bundle.sources[bundle.entryFile]! };
  }
  return { source_type: 'multi_file', source_code: JSON.stringify({ contracts: bundle.sources, 'entry-file': bundle.entryFile }) };
}

function matches(record: ContractRecord, bundle: VerificationBundle): boolean {
  if (record.compiler_version !== bundle.compilerVersion) return false;
  const payload = sourcePayload(bundle);
  if (record.source_type !== payload.source_type || typeof record.source_code !== 'string') return false;
  if (payload.source_type === 'single_file') return record.source_code === payload.source_code;
  try {
    const parsed = JSON.parse(record.source_code) as unknown;
    if (!object(parsed) || parsed['entry-file'] !== bundle.entryFile || !object(parsed.contracts)) return false;
    const stored = parsed.contracts;
    return Object.keys(stored).length === Object.keys(bundle.sources).length &&
      Object.entries(bundle.sources).every(([name, text]) => stored[name] === text);
  } catch { return false; }
}

/** verifyContract submits once and conservatively waits for address-level verification evidence. */
export async function verifyContract(options: VerifyOptions): Promise<VerifyResult> {
  if (!Object.hasOwn(NETWORKS, options.network)) throw new PluginError('INVALID_INPUT', 'Network must be preview, preprod or mainnet');
  const network = NETWORKS[options.network as MidnightNetwork];
  const address = normalizeAddress(options.address);
  const bundle = typeof options.buildInfo === 'string' ? await loadVerificationBundle(options.buildInfo) : validateBundle(options.buildInfo);
  const apiKey = options.apiKey ?? process.env.SUBSCAN_API_KEY;
  if (!apiKey?.trim() || /[\r\n]/.test(apiKey)) throw new PluginError('INVALID_INPUT', 'Set SUBSCAN_API_KEY or supply an API key');
  const origin = apiOrigin(options.apiUrl ?? `https://${network}.api.subscan.io`);
  const contractUrl = `https://${network}.subscan.io/contract/${address}?tab=contract`;
  const timeoutMs = positive(options.timeoutMs, 600_000);
  const requestTimeoutMs = positive(options.requestTimeoutMs, 30_000);
  let interval = positive(options.pollIntervalMs, 1000);
  const maxInterval = positive(options.maxPollIntervalMs, 10_000);
  if (maxInterval < interval) throw new PluginError('INVALID_INPUT', 'Maximum polling interval must be at least the initial interval');
  const deadline = AbortSignal.timeout(timeoutMs);
  const signal = AbortSignal.any([deadline, ...(options.signal ? [options.signal] : [])]);
  const redact = (text: string): string => text.replaceAll(apiKey, '[redacted]');
  let phase: 'indexing' | 'submission-unknown' | 'verifying' = 'indexing';
  let acknowledged = false;
  let attempted = false;
  let seenRunning = false;
  let baselineError = '';
  const pending = (): VerifyResult => ({ status: 'pending', address, contractUrl, phase });
  const wait = async (): Promise<void> => {
    await sleep(interval, undefined, { signal });
    interval = Math.min(maxInterval, Math.ceil(interval * 1.5));
  };
  const request = async (endpoint: string, body: unknown): Promise<unknown> => {
    let response: Response;
    try {
      response = await fetch(`${origin}/api/scan/midnight/${endpoint}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'X-API-Key': apiKey },
        body: JSON.stringify(body), redirect: 'error',
        signal: AbortSignal.any([signal, AbortSignal.timeout(requestTimeoutMs)]),
      });
    } catch {
      throw new ApiError('API request could not be completed');
    }
    if (!response.ok) {
      await response.body?.cancel();
      throw new ApiError(`API returned HTTP ${response.status}`, response.status);
    }
    const data = await responseBody(response);
    if (!object(data) || typeof data.code !== 'number') throw new ApiError('Unexpected Subscan response envelope');
    if (data.code !== 0) {
      const message = typeof data.message === 'string' ? redact(data.message) : 'API rejected request';
      throw new ApiError(message, response.status, message);
    }
    return data.data;
  };
  const readContract = async (): Promise<ContractRecord | null> => {
    let value: unknown;
    try { value = await request('contract', { contract: address }); }
    catch (error) {
      if (error instanceof ApiError && error.serverMessage?.toLowerCase() === 'contract not found') return null;
      throw error;
    }
    if (!object(value) || !Number.isSafeInteger(value.verify_time) || Number(value.verify_time) < 0 ||
        typeof value.verifying !== 'boolean' || typeof value.last_verify_error !== 'string') {
      throw new ApiError('Unexpected contract status response');
    }
    return value as unknown as ContractRecord;
  };
  try {
    signal.throwIfAborted();
    const versions = await request('compact/version', {});
    if (!Array.isArray(versions) || !versions.every(v => typeof v === 'string')) throw new ApiError('Unexpected compiler version response');
    if (!versions.includes(bundle.compilerVersion)) throw new PluginError('UNSUPPORTED_BUILD', 'Compiler version is not supported by this network');
    let baseline: ContractRecord | null = null;
    while (!baseline) {
      signal.throwIfAborted();
      baseline = await readContract();
      if (!baseline) await wait();
    }
    if (baseline.verify_time > 0) return { status: 'already-verified', address, contractUrl, matchesBundle: matches(baseline, bundle) };
    baselineError = baseline.last_verify_error;
    seenRunning = baseline.verifying;
    phase = 'verifying';
    if (!baseline.verifying) {
      attempted = true;
      try {
        await request('verify', { contract_address: address, compiler_version: bundle.compilerVersion, ...sourcePayload(bundle) });
        acknowledged = true;
      } catch (error) {
        if (!(error instanceof ApiError)) throw error;
        const rejected = error.serverMessage?.toLowerCase();
        if (['unsupported compiler version', 'invalid contract address', 'contract not found'].includes(rejected ?? '') ||
            (error.httpStatus !== undefined && error.httpStatus >= 400 && error.httpStatus < 500)) throw error;
        phase = 'submission-unknown'; // A dropped acknowledgement never justifies another submit.
      }
    }
    while (true) {
      signal.throwIfAborted();
      let current: ContractRecord | null;
      try { current = await readContract(); }
      catch (error) {
        if (!(error instanceof ApiError) || (error.httpStatus !== undefined && error.httpStatus >= 400 && error.httpStatus < 500 && error.httpStatus !== 429)) throw error;
        await wait();
        continue;
      }
      if (current?.verify_time && current.verify_time > 0) {
        const matching = matches(current, bundle);
        return { status: attempted && matching ? 'verified' : 'already-verified', address, contractUrl, matchesBundle: matching };
      }
      if (current?.verifying) { seenRunning = true; phase = 'verifying'; }
      if (current && !current.verifying && current.last_verify_error &&
          (seenRunning || current.last_verify_error !== baselineError)) {
        throw new PluginError('VERIFICATION_FAILED', `${attempted ? 'Verification' : 'Existing verification job'} failed: ${redact(current.last_verify_error)}`);
      }
      if (acknowledged) phase = 'verifying';
      await wait();
    }
  } catch (error) {
    if (options.signal?.aborted) throw new PluginError('CANCELLED', 'Verification cancelled');
    if (deadline.aborted) return pending();
    if (error instanceof PluginError) throw error;
    throw new PluginError('API_ERROR', 'Could not complete verification', { cause: error });
  }
}
