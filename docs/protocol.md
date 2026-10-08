# Verification bundle and API protocol

## verification.json v1

```json
{
  "schemaVersion": 1,
  "compilerVersion": "0.31.1",
  "entryFile": "main.compact",
  "sources": {
    "main.compact": "pragma language_version 0.23;\n..."
  },
  "sourceDigest": "<64-character lowercase SHA256>"
}
```

Paths must be canonical relative POSIX `.compact` paths. Absolute paths, `..`, backslashes, colons and control characters are rejected. Scanned source files must be valid UTF-8.

The `sourceDigest` input is the UTF-8 encoding of `JSON.stringify({ entryFile, sources: sortedSources })`. Filenames are sorted using JavaScript string `<` / `>` ordering. The digest checks entry-file and source integrity; it does not cover `compilerVersion`, constitute a signature or prove on-chain verification. The build separately checks the exact compiler version in generated metadata.

The JSON contains no API key, wallet, SDK providers or initial private state. Filenames and source are materials the developer selects for publication. Never embed credentials in Compact source.

## Current API

All requests use POST with `Content-Type: application/json` and `X-API-Key`. Responses use `{ code, message, data }`; only `code === 0` indicates that an API request was accepted.

| Path | Request | Purpose |
| --- | --- | --- |
| `/api/scan/midnight/compact/version` | `{}` | Supported exact Compact versions |
| `/api/scan/midnight/contract` | `{"contract":"0x<64hex>"}` | Indexing and verification status |
| `/api/scan/midnight/verify` | Source request below | Asynchronous verification submission |

Single-file request:

```json
{
  "contract_address": "0x<64hex>",
  "compiler_version": "0.31.1",
  "source_type": "single_file",
  "source_code": "<Compact source>"
}
```

For multiple files, `source_type` is `multi_file`, and `source_code` is a **JSON string** containing:

```json
{
  "contracts": {
    "main.compact": "<entry source>",
    "lib/message.compact": "<dependency source>"
  },
  "entry-file": "main.compact"
}
```

The client does not submit verifier MD5 digests or `verification_keys`. The existing service matches keys using indexed on-chain data.

Contract queries must provide a nonnegative integer `verify_time`, boolean `verifying` and string `last_verify_error`. Comparing a success record also requires `compiler_version`, `source_type` and `source_code`. Missing comparison fields produce `matchesBundle: false`; the client never assumes source equality.

## Result interpretation

| Status | Evidence |
| --- | --- |
| `verified` | This invocation attempted submission, then observed a success record with matching version and complete source |
| `already-verified` | A record already existed, an existing task was awaited, or a different-source success record was observed; always check `matchesBundle` |
| `pending` | The total deadline expired while awaiting indexing, submission confirmation or verification |
| `VERIFICATION_FAILED` | A terminal error followed an observed running state, or the error changed after submission |

If the contract is already `verifying`, the client waits without submitting another request. Stale errors during a running task or without an observed state change do not directly establish failure of this invocation. After a lost acknowledgement, the client only reads status; an invocation never submits twice.

These results are address-level evidence. There is no job ID, request idempotency key or deployment/maintenance-version binding. Two independent failures with identical errors may conservatively return `pending` if their intervening running state was not observed. The library does not automatically resubmit based on that evidence.
