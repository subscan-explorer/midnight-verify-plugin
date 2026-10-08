# Publication safety review

Reviewed on October 8, 2026 before the first GitHub submission. This review covers the project's code, tests, examples, configuration, documentation, public test receipt, screenshot and actual npm tarball. No credential material was found in the reviewed publication candidates or package after sanitization.

## Findings and changes

| Area | Review result and action |
| --- | --- |
| Credentials | Redacted Gitleaks 8.30.0 scans found no API tokens, wallet seeds, mnemonics or private keys in the publication candidates or unpacked package |
| Test wallet identity | Removed the real wallet address from the published Preview receipt; the harness no longer persists or prints wallet addresses, and resume strips the field from older receipts |
| Personal paths and endpoints | No machine-specific paths, personal contact details or internal infrastructure endpoints were found in the publication candidates; supported public service URLs and loopback test URLs remain |
| Internal service review | Public design documentation now states generic acceptance requirements without internal implementation names or reproduction details; this does not resolve outstanding service requirements |
| Screenshot | Visually reviewed: no account login, wallet identity, credential or local machine path is visible; no EXIF, XMP, IPTC or comment metadata markers were present |
| Git history | The repository had zero commits and no remote configured; there was no commit history to scan or rewrite |
| Runtime outputs | Local build outputs, SDK logs and live-run artifacts are ignored; they are excluded from publication candidates and the npm package |
| Package contents | Inspected the actual tarball and scanned its unpacked contents; credentials, wallet state and local configuration were absent |
| Checker diagnostics | Format errors and credential findings report only filenames and line numbers; regression tests prevent scanned values from appearing in diagnostics |

Contract addresses, transaction/block hashes, compiler versions and source digests remain as public validation evidence. They are not credentials. Public chain evidence can still be correlated with on-chain transaction participants; removing an embedded wallet address does not anonymize the chain.

Test authentication values are deliberately synthetic and used with local fixtures. Secret-scanner findings are reviewed without printing their values. The language/path check previously used for release preparation was not a credential scanner; the broader review and safeguards below were added for publication safety.

## Repeatable safeguards

```bash
npm run check
npm test
npm run check:release
npm pack --dry-run
```

The release checker reads Git's tracked and non-ignored untracked candidates, including force-added ignored files, and checks older staged text when the working copy differs. It rejects sensitive file paths and symlinks, common credential literals and provider-token formats, wallet identity literals, private/internal endpoints and machine-specific paths. The same content checks apply to packaged text. CI invokes this checker. Private files and directories are also covered by `.gitignore`; ignoring a file is not sufficient if it has been force-added to Git.

Use an independent redacted secret scanner before submission. Gitleaks 8.30.0 was run on an isolated copy of `git ls-files --cached --others --exclude-standard` and on the unpacked tarball, with default rules and inline allow comments disabled. Once commits exist, scan the Git history too. Keep temporary reports outside the repository and never publish raw scanner output.

Review new binary assets visually and check their metadata. Pattern-based checks do not prove the absence of every possible encoded secret or sensitive image. Review unfamiliar values and changed files before committing, and repeat this audit whenever publication inputs change.

## Validation

On macOS arm64 with Node.js 22.16.0 and npm 10.9.2, TypeScript checking and all 43 local tests passed. Regression tests cover credential diagnostics without value disclosure, private key/provider-token detection, sensitive files, wallet identities, force-added ignored files, staged/worktree differences, internal endpoints, public hashes/placeholders and legacy receipt sanitization. Package/consumer checks and redacted source/package scans passed. No live deployment, Git submission or npm publication was performed during this review.

The [release checklist](release.md) separately tracks publication metadata and service/network acceptance. Sanitization does not establish those requirements or complete a general security audit.
