# Project instructions

- Use Node 22.16 or later and npm. Commands: `npm ci`, `npm run check`, `npm test`, `npm run check:release`, `npm pack --dry-run`.
- Keep source, comments, examples, test descriptions and documentation in English. Use portable paths in public examples. Release checks validate repository text, local documentation links and an isolated tarball consumer.
- Keep CLI and programmatic verification on the same implementation path.
- Freeze Compact sources before compilation. Never infer compiler version from language_version.
- Compiler versions are explicit configuration. Support the compact launcher and direct compactc argument conventions; check generated metadata and preserve the deployment's recorded version when resuming verification.
- Bound file access, API responses, requests, polling and compilation; honor AbortSignal.
- Do not log API keys or collect wallet/private-state files. Verification publishes the selected Compact source.
- Before public submission, review Git publication candidates, images and package contents with redacted secret-scanner output. Release checks must include staged ignored files and reject sensitive paths, credential literals, internal endpoints and wallet identities. Preserve public contract evidence without embedding wallet addresses or internal review details.
- Ordinary tests use local files and local HTTP fixtures. The opt-in test:live harness can compile, deploy and verify on Preview or Preprod only when the user explicitly requests live testing. Online submissions and package publishing require explicit user instructions.
- This is an unpublished npm prototype. The package.json private flag prevents accidental npm publication; it does not describe repository visibility. Server-side path/resource limits, complete key matching, job state ordering and maintenance-version semantics remain npm release gates.
- Record reusable engineering decisions in docs/ai/TASTE.md using docs/ai/taste_template.md.
