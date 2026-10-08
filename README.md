# midnight-verify-plugin

Source verification for Midnight Compact contracts, available as a CLI and TypeScript/JavaScript functions. Freeze and compile the source, then submit the same snapshot to Subscan and wait for the verification result.

This is an **unpublished npm prototype**. The `private: true` setting prevents accidental npm publication; it does not describe Git repository visibility. Verification reuses the existing Subscan backend and midnight-go. The verification client requires no wallet, Blockfrost endpoint or additional service deployment. See [design and release boundaries](docs/design.md) and the [release checklist](docs/release.md).

See the [Usage Guide](docs/guide.md) for compilation, deployment, verification, DApp integration and receipt-based recovery.

## Local development

Requires Node.js >= 22.16 and npm. Actual Compact builds also require an installed compiler and its key-generation tools. File-system and HTTP tests use local fixtures and require neither a compiler installation nor an API key.

```bash
npm ci
npm run check
npm test
npm run check:release
```

`npm test` builds the TypeScript output. Use `npm run build` to build it separately. There are no runtime npm dependencies; development dependencies are locked in `package-lock.json`. Release checks validate English text and documentation links, inspect the package contents, and install the tarball into an isolated consumer to test its exports, CLI and TypeScript declarations. They do not deploy contracts or publish packages.

CI checks Linux and macOS with Node.js 22.16.0 and 24. Artifact publication reserves a new output directory and copies its contents without overwriting existing targets; this also supports Node 24's stricter directory-copy checks. See [GitHub Actions](https://github.com/subscan-explorer/midnight-verify-plugin/actions) for current results.

Before public submission, release checks also reject credential literals, wallet identities, internal endpoints and sensitive files, including force-added ignored files. Keep wallet state and authentication files outside publication inputs. See the [publication safety review](docs/publication-safety.md) for scope, evidence and repeatable checks.

## Build and inspect

The following command freezes the source, compiles the snapshot in a temporary directory, checks compiler metadata and required prover/verifier keys, and writes deployment artifacts with `verification.json`:

```bash
node dist/cli.js build \
  --source-dir examples/hello-world \
  --entry main.compact \
  --compiler-version "$MIDNIGHT_COMPACT_VERSION" \
  --out managed/hello-world

node dist/cli.js inspect \
  --build-info managed/hello-world/verification.json
```

Set `MIDNIGHT_COMPACT_VERSION` in your shell or CI to an exact version, or replace the flag value with that version. There is no implicit version default. `0.31.1` is the version validated on Preview, not a fixed client allowlist. **The output directory must not exist.** Use a new directory for another build; existing deployment artifacts are never overwritten. Deploy with the artifacts from that directory and verify with its bundle. Do not use `pragma language_version` as the compiler version.

The multi-file example preserves relative imports:

```bash
node dist/cli.js build \
  --source-dir examples/multi-file \
  --entry main.compact \
  --compiler-version "$MIDNIGHT_COMPACT_VERSION" \
  --out managed/multi-file
```

Only `.compact` files in the selected directory are collected. The `.git`, `node_modules`, `managed`, `dist` and `target` directories are excluded. Unused Compact files in the selected directory are included, so choose a clearly scoped contract directory. The `inspect` command prints the version, entry file, digest and filenames without networking or source contents.

The first version supports default compiler arguments, relative imports and the built-in standard library. Nonempty `COMPACT_PATH` is rejected; arbitrary compiler flags are not forwarded. The compiler must produce `compiler/contract-info.json` with an exact `compiler-version` and `circuits` metadata. Older versions lacking these fields cannot produce a verification bundle. Actual compilation has been validated with **Compact 0.31.1**; an API-supported version is not automatically a tested version.

Use `--compiler-mode compact` (default) for `compact compile +<version>`, or `--compiler-mode compactc` to invoke a compiler directly. Set `--compiler-bin` to override the executable. Environment fallbacks are `MIDNIGHT_COMPACT_VERSION`, `MIDNIGHT_COMPACT_MODE` and `MIDNIGHT_COMPACT_BIN`; explicit flags take precedence. Both modes check the actual version in the generated metadata and reject mismatches. The E2E `--deploy` mode accepts these settings; `--resume` preserves the bundle and receipt's recorded version.

## Submit verification

Verification publishes the Compact source in the bundle. Set `SUBSCAN_API_KEY` through your shell or CI secrets. Never put it in source files, bundles or command-line arguments. Verification does not require deployment private state.

```bash
# Set SUBSCAN_API_KEY and assign the public deployed address to MIDNIGHT_CONTRACT_ADDRESS.
node dist/cli.js verify \
  --network preview \
  --address "$MIDNIGHT_CONTRACT_ADDRESS" \
  --build-info managed/hello-world/verification.json
```

The `network` option accepts `preview`, `preprod` and `mainnet`. Hex addresses may have a `0x` prefix; Bech32 addresses are not yet supported. Default API hosts:

| Network | Subscan API |
| --- | --- |
| preview | `https://midnight-preview.api.subscan.io` |
| preprod | `https://midnight-preprod.api.subscan.io` |
| mainnet | `https://midnight.api.subscan.io` |

The client first queries `/api/scan/midnight/compact/version` and waits for the contract to be indexed. It does not resubmit an existing successful or running verification. Otherwise, it submits once to `/api/scan/midnight/verify`, then queries `/api/scan/midnight/contract`.

A response with `code: 0` means only that the request was accepted. The CLI succeeds only after observing a success record whose exact compiler version and complete source match the local snapshot. An existing record for different source returns `matchesBundle: false`.

If the submission acknowledgement is lost, the client continues reading status. A total timeout returns `pending`, without another POST or deployment. The service currently provides no job ID: `verified` means a matching address-level success record was observed after a submission attempt. It does not prove ownership of an individual job, constitute a security audit, or establish verification after a maintenance update.

| Exit code | Meaning |
| --- | --- |
| 0 | Build/inspect succeeded, or a matching verification record was observed |
| 1 | Input, compilation, API or explicit verification error |
| 2 | Pending confirmation; JSON `phase` is `indexing`, `submission-unknown` or `verifying` |
| 4 | A success record exists for different source or compiler version |
| 130 | User cancellation or compilation cancelled by timeout |

Persist the public deployment receipt before invoking verification. Verification failure must never trigger automatic redeployment or transaction rebroadcast.

## Deployment script integration

After installing the built package into your DApp from a local path or tarball, call it from the existing Midnight.js deployment script:

```ts
import { verifyContract } from 'midnight-verify-plugin';

// deployed comes from deployContract; its public receipt has already been persisted.
const abortController = new AbortController();
const result = await verifyContract({
  network: 'preview',
  address: deployed.deployTxData.public.contractAddress,
  buildInfo: './managed/hello-world/verification.json',
  signal: abortController.signal,
});

if (result.status === 'pending') {
  console.log('Awaiting confirmation', result.contractUrl);
} else if (!result.matchesBundle) {
  throw new Error('Existing verification does not match this source snapshot');
} else {
  console.log(result.status, result.contractUrl);
}
```

Exports include `buildVerificationBundle`, `loadVerificationBundle`, `validateBundle`, `normalizeAddress`, `verifyContract`, `PluginError` and their TypeScript types. The library and CLI share the same implementation. The verification client is independent of a specific Midnight.js SDK version.

## Limits and controls

| Item | Current setting |
| --- | --- |
| Source files | At most 128 files, 256 KiB per file and 2 MiB total |
| Verification bundle | At most 4 MiB of serialized JSON |
| Scanning | At most 4096 entries and 32 levels; symlinks and noncanonical relative paths rejected |
| Compilation | 120-second default; configurable with `--timeout-ms`; `--compiler-mode` selects `compact` / `compactc`, and `--compiler-bin` overrides the trusted executable |
| Verification | 10-minute default; 30-second request timeout; polling backs off from 1 to 10 seconds |
| HTTP responses | At most 8 MiB; redirects rejected to prevent forwarding authentication headers |
| API override | `--api-url` / `apiUrl` accepts an HTTPS origin; HTTP is restricted to local test addresses |
| Library controls | `AbortSignal`, `timeoutMs`, `requestTimeoutMs`, `pollIntervalMs`, `maxPollIntervalMs` |

Cancellation controls the directly started compiler process; it does not guarantee termination of every descendant of a custom compiler on every platform. Client-side path and size checks do not replace independent server-side controls.

## Validation status

Local tests cover frozen source, relative paths, digests and limits, missing keys, stale errors, concurrent tasks, lost acknowledgements, timeouts, cancellation, rate limiting, key redaction and CLI exit codes. Single-file and multi-file examples have compiled with Compact 0.31.1 and generated keys and bundles.

On October 3, 2026, 27 local tests passed, followed by a real Preview run using an authorized test wallet: frozen multi-file compilation, deployment, Subscan verification, independent persisted-result checks and public-page confirmation. Verification returned `verified` and `matchesBundle: true`. After stopping the local proof server, receipt-based verification returned `already-verified` without another deployment. See the [Preview E2E report](docs/e2e/preview-2026-10-03.md).

Compiler version, mode and executable configuration subsequently increased the local suite to 34 passing tests. These cover flag/environment precedence, different versions, direct `compactc` arguments, mismatch rejection, API version preflight and preserving the deployment version during resume. A real direct `compactc` 0.31.1 build also generated complete keys with the same source digest as the Preview deployment. Other compiler versions were exercised through local fixtures, not live network acceptance.

Release preparation increased the local suite to **37 passing tests**, adding checks for English text, portable paths and documentation links. TypeScript checking, tarball inspection and isolated consumer API, CLI and declaration checks passed on macOS arm64 with Node.js 22.16.0. The Linux/macOS CI matrix is configured but has not yet run in a remote repository. See the [release checklist](docs/release.md) for unresolved metadata and acceptance requirements.

The October 8 publication review increased the suite to **43 passing tests**, added credential/file safeguards and sanitized wallet identity from receipts and harness output. Redacted scans covered all publication candidates and the actual npm package. These checks do not establish a general security audit or network acceptance.

Preprod and Mainnet acceptance and server-side release requirements remain outstanding. No npm package or backend/helper service has been released through this project.

See the [protocol](docs/protocol.md), [engineering decisions](docs/ai/TASTE.md), [Subscan verification guide](https://support.subscan.io/doc-2430000), [Compact compiler usage](https://docs.midnight.network/compact/compilation-and-tooling/compiler-usage) and [Midnight deployment interfaces](https://docs.midnight.network/guides/deploy-and-operate).

Instructions for the opt-in live compile, deploy and verify test are in [e2e/README.md](e2e/README.md). Ordinary `npm test` uses local fixtures only.
