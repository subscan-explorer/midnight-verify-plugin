# Live network testing

This is an explicitly invoked manual E2E harness, excluded from `npm test`. It freezes and compiles the multi-file example, deploys the generated artifacts, submits source verification through Subscan, and independently reads the persisted result.

See the [Usage Guide](../docs/guide.md) for the overall workflow, DApp integration and recovery.

The harness supports Preview / Preprod only and requires an existing funded test wallet. It reuses wallet and provider configuration from a `midnight-go` checkout with E2E dependencies installed. The adapter requires Midnight.js 4.1.1 and Wallet SDK 1.2.0. The compiler version is configurable; the validated network run used Compact 0.31.1. The ordinary verification client has no wallet SDK runtime dependency.

Build this package, then start the local proof server from the existing E2E configuration:

```bash
npm run build
# Run from midnight-go/e2e; choose a project name for this test.
docker compose --project-name midnight-plugin-live up -d --wait proof-server
```

Keep wallet secrets in the shell environment or a private `.env.preview` file. Set `MIDNIGHT_EXPECTED_WALLET_ADDRESS` to check the derived address before network synchronization; a mismatch stops the run.

From this project directory, explicitly deploy:

```bash
npm run test:live -- \
  --network preview --deploy \
  --compiler-version "$MIDNIGHT_COMPACT_VERSION" \
  --out managed/live-preview \
  --helper-dir /path/to/midnight-go \
  --env-file /path/to/private/.env.preview \
  --subscan-key-file /path/to/api-key.http \
  --sync-timeout-ms 1200000 \
  --verify-timeout-ms 600000
```

All `/path/to/...` values are placeholders. Replace them before running. If `SUBSCAN_API_KEY` is set, omit `--subscan-key-file`; otherwise, supply your own private file containing an `X-API-Key` header. No Subscan backend checkout is required. The script does not print credentials. Wallet files are parsed using Node's environment parser, not executed as shell scripts. Preprod requires `--network preprod` and the corresponding test wallet file.

Set `MIDNIGHT_COMPACT_VERSION` to an exact `x.y.z` version or provide a literal `--compiler-version`. Use `--compiler-mode compact` to select that version through the launcher, or `--compiler-mode compactc --compiler-bin /path/to/toolchain/compactc` to invoke a compiler directly. Environment fallbacks are `MIDNIGHT_COMPACT_VERSION`, `MIDNIGHT_COMPACT_MODE` and `MIDNIGHT_COMPACT_BIN`; explicit flags take precedence. The wallet file does not supply these compiler settings. The harness checks Subscan support, generated metadata and SDK runtime compatibility; it is not pinned to 0.31.1.

The output directory must not already exist. It stores compiled artifacts and `receipt.json`; private state is isolated in its `state/` directory. These runtime files and SDK `logs/` are ignored and excluded from Git and npm packages.

After broadcast returns, the script saves the public transaction ID. After deployment confirmation, it immediately saves the contract address and block hash before verification. Receipts omit wallet addresses, secrets, wallet objects and private transaction contents. Resume also removes legacy wallet-address fields when updating an older receipt. Inspect the receipt after any failure; do not immediately deploy again.

Resume verification from the public receipt:

```bash
npm run test:live -- \
  --resume managed/live-preview/receipt.json \
  --subscan-key-file /path/to/api-key.http \
  --verify-timeout-ms 600000
```

The `--resume` mode does not load a wallet, deploy or broadcast. It invokes the verification client, which reads an existing result, waits for a running task, or submits source only if the contract is unverified and no task is running. A receipt without a confirmed address is rejected; manually confirm the original broadcast status.

Resume preserves the compiler version in the original `verification.json` and receipt, ignoring current compiler environment variables. A conflicting explicit version is rejected. Mode and executable settings apply only to `--deploy`.

Clean up from the original proof-server directory:

```bash
docker compose --project-name midnight-plugin-live down
```

Acceptance requires complete keys, confirmed deployment, initial ledger reads through the official Indexer, and persisted Subscan results with identical complete source and compiler version, `verify_time > 0` and `verifying === false`. Check the public page separately. Success does not establish server-side security controls or acceptance on other networks.

See the completed [October 3, 2026 Preview acceptance report](../docs/e2e/preview-2026-10-03.md).
