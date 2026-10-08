/** MidnightNetwork identifies the public Subscan network, independently of node RPC. */
export type MidnightNetwork = 'preview' | 'preprod' | 'mainnet';

/** VerificationBundle binds immutable Compact input to the exact compiled toolchain. */
export interface VerificationBundle {
  schemaVersion: 1;
  compilerVersion: string;
  entryFile: string;
  sources: Record<string, string>;
  sourceDigest: string;
}

/** BuildOptions configures a compile from frozen sources; outputDir must not exist. */
export interface BuildOptions {
  sourceDir: string;
  entryFile: string;
  compilerVersion: string;
  outputDir: string;
  /** compilerMode selects the launcher or direct compiler argument convention; defaults to compact. */
  compilerMode?: 'compact' | 'compactc';
  /** compilerBin overrides the executable selected by compilerMode. */
  compilerBin?: string;
  timeoutMs?: number;
  signal?: AbortSignal;
}

/** VerifyOptions supplies only public deployment and build information. */
export interface VerifyOptions {
  network: MidnightNetwork;
  address: string;
  buildInfo: string | VerificationBundle;
  apiKey?: string;
  apiUrl?: string;
  timeoutMs?: number;
  requestTimeoutMs?: number;
  pollIntervalMs?: number;
  maxPollIntervalMs?: number;
  signal?: AbortSignal;
}

/** VerifyResult separates submission uncertainty from source verification success. */
export interface VerifyResult {
  status: 'verified' | 'already-verified' | 'pending';
  address: string;
  contractUrl: string;
  matchesBundle?: boolean;
  phase?: 'indexing' | 'submission-unknown' | 'verifying';
}

/** PluginError carries stable codes without credentials or raw request bodies. */
export class PluginError extends Error {
  constructor(
    public readonly code: 'INVALID_INPUT' | 'UNSUPPORTED_BUILD' | 'BUILD_FAILED' | 'API_ERROR' | 'VERIFICATION_FAILED' | 'CANCELLED',
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = 'PluginError';
  }
}
