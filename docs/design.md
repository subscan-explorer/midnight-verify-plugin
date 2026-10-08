# Design and release boundaries

## Current implementation

An independent TypeScript package provides CLI and function entry points. Its integration model follows the usability of [hardhat-verify](https://hardhat.org/docs/plugins/hardhat-verify), with explicit npm-script and deployment-script calls. It does not register a plugin with the official Compact CLI.

The client freezes inputs, records exact compiler versions, prepares single-file or multi-file requests, normalizes addresses and waits for results. Verification computation and on-chain key queries reuse the Subscan backend, queue and midnight-go. There are no runtime npm dependencies, new Deployments or developer-provided Blockfrost endpoints.

Builds write selected Compact files into a temporary snapshot before compiling. Deployment artifacts and the verification bundle are published together to avoid submitting source changed after compilation. Only default compiler arguments and relative imports are supported; nonempty `COMPACT_PATH` is rejected. Generated metadata and required prover/verifier keys are checked before exposing the output.

Compiler versions are explicit configuration. The launcher and direct `compactc` modes use separate argument conventions through `compilerMode`; `compilerBin` overrides the executable. Generated metadata must match the selected version. E2E preflight checks API support for that version, while resume preserves the original deployment's version. Configurability does not establish compatibility across every runtime, ledger and SDK combination.

Verification receives only the public deployed address and bundle, without binding to a wallet SDK. Callers persist the public deployment receipt before invoking `verifyContract`. Failure or timeout must never automatically trigger redeployment.

## Intentional limitations

| Scope | First-version behavior |
| --- | --- |
| Build provenance | A frozen source build is required; missing source cannot be recovered from generated JavaScript |
| External dependencies and flags | External search paths and arbitrary arguments are unsupported; a future server-side allowlist protocol is required |
| Older compilers | Exact version and circuit metadata are required; actual compilation has been validated only with 0.31.1 |
| Addresses | 64-character hex with optional `0x`; Bech32 support requires separate validation |
| Task identity | At most one submission per invocation and address-level polling; individual job ownership is unproven |
| Verified addresses | Returned source and version are compared explicitly; the client cannot force reverification |
| Maintenance updates | Deployment/maintenance-version binding is required; current records do not prove matching updated circuits |
| Audit meaning | Source verification does not establish witness correctness, full DApp correctness or a security audit |

## Server-side requirements before npm release

Service owners must independently validate the acceptance conditions below before npm release. Client validation and a successful network pilot do not establish these service guarantees. Internal review evidence and implementation details are outside this public package's documentation.

| Requirement | Acceptance condition |
| --- | --- |
| Source boundaries | The service independently restricts paths, file counts and byte counts, including requests made without this client |
| Compilation resources | Context cancellation, timeout, output limits and concurrency controls are required |
| Complete key set | The complete generated circuit/key set equals the indexed on-chain set |
| State ordering | Job state transitions remain correct under concurrency; individual job identity and request idempotency are desirable |
| Maintenance versions | Refresh key projections and bind or invalidate verification records after maintenance events; prior success does not prove continued matching |

These changes belong in the existing service repositories. Until these requirements are met, `private: true` prevents accidental npm publication; it does not restrict public access to the Git repository.

## Acceptance sequence

1. Client: local file-system, compiler and HTTP fixtures pass; bundles exclude non-Compact files and credentials, each invocation submits at most once, and result classifications and exit codes are correct.
2. Local compilation: single-file and multi-file examples compile with Compact 0.31.1 and generate keys, metadata and bundles.
3. Services: implement and test path limits, resource limits, complete-set matching, state ordering and version binding.
4. Controlled network pilots: independently validate Preview and Preprod through the client, Subscan API, queue, helper, persistence and public page, including at least one multi-file contract on each.
5. Mainnet: separately verify an explicitly authorized contract after service configuration, network capability and server-side requirements pass.
6. npm release: select the license, package name and publishing permissions, then publish separately after service and network requirements pass.

Project initialization on October 3, 2026 completed the first two steps: 24 local tests and real single-file/multi-file compilation. The user then authorized direct compile, deploy and verify testing. The manual harness increased the suite to 27 tests, and the Preview multi-file workflow passed through Subscan persistence and its public page. Receipt-based resume also passed; see the [Preview E2E report](e2e/preview-2026-10-03.md). Subsequent compiler configuration work increased the local suite to 34 tests.

The early Preview pilot does not replace step 3. Preprod and Mainnet remain unvalidated, and the npm package is unpublished. Only a Preview test contract was deployed; no backend/helper services were deployed by this project. Preparation and remaining release conditions are recorded in the [release checklist](release.md).
