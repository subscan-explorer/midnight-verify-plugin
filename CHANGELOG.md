# Changelog

## 0.1.0 - 2026-10-10

- CLI and JavaScript/TypeScript APIs for frozen Compact builds and Subscan source verification.
- Exact compiler version, launcher/direct-compiler mode and executable-path configuration.
- Artifact publication compatible with Node 24's directory existence checks, while preserving exclusive output-directory creation and no-overwrite copying.
- Single-file and multi-file bundles with bounded file access, snapshot integrity checks and required-key checks.
- Address-level verification polling, cancellation, explicit pending results and at most one submission per invocation.
- Opt-in Preview / Preprod deployment harness with public receipts and wallet-free verification resume.
- Preview multi-file compilation, deployment and Subscan verification evidence for Compact 0.31.1.
- English documentation and examples with portable paths.
- Publication safeguards for credentials, sensitive files, internal endpoints and force-added ignored files; wallet identity removed from public receipts and live-harness output.
- Release checks for documentation, package contents, installed exports, CLI and TypeScript declarations; CI configuration for Linux/macOS and Node 22.16/24.
- Initial npm distribution under the MIT license, copyright Subscan, with npm installation instructions and validation before publication.

Live validation covers Preview with Compact 0.31.1. Preprod, Mainnet, other compiler versions and independent service-side acceptance are not established by this client release.
