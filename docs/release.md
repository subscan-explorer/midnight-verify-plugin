# Release checklist

Version `0.1.0` is the initial public client release under [MIT](../LICENSE), copyright Subscan. The user explicitly requested npm publication and confirmed the license on October 10, 2026. The package distributes the CLI and JavaScript/TypeScript library; service deployment and network acceptance are separate.

The recorded live workflow covers Preview with Compact 0.31.1. Preprod, Mainnet, other compiler versions and independent service-side requirements remain unvalidated. Accepting a network or compiler configuration does not establish compatibility or production readiness for it.

## Local validation

Run from the repository root with Node.js 22.16 or later:

```bash
npm ci
npm run check
npm test
npm run check:release
npm pack --dry-run
```

`npm run check:release` checks English/portable text, local Markdown links, heading anchors and code fences; builds an actual tarball; inspects its file list and text; and installs it into an isolated temporary consumer. The consumer checks public exports, CLI help, the installed binary entry and TypeScript declaration resolution. The MIT `LICENSE` must be included. Temporary package and consumer files are removed after the check.

Publication safeguards inspect tracked and non-ignored untracked Git candidates, including force-added ignored files and older staged text when the working copy differs. They reject sensitive paths, symlinks, common credential literals, wallet identities and internal endpoints. These checks also apply to packaged text. Repeat the independent redacted source, Git-history and unpacked-package secret scans described in the [publication safety review](publication-safety.md) when release inputs change.

The tarball consumer uses an offline installation with lifecycle scripts disabled. The package has no runtime npm dependencies. These checks require no wallet, API key, compiler installation or online contract submission. `npm ci` requires dependencies in the npm cache or registry.

The checker reports unresolved package metadata under `metadataPending`; this must be empty for publication. A `status: "passed"` result establishes local technical checks, not service or network acceptance. `prepublishOnly` repeats TypeScript, tests and release checks when publishing from the source directory.

## Continuous integration

The repository's `.github/workflows/ci.yml` runs dependency installation, TypeScript checking, local tests and release checks on Linux and macOS with Node.js 22.16.0 and 24. It uses no credentials and does not run the live deployment harness or publish a package.

The public repository's validation matrix passed for the pre-release source, including the Node 24 artifact-copy fix. Check the CI result for the final release commit separately; prior green runs do not establish that result. Current runs are available in [GitHub Actions](https://github.com/subscan-explorer/midnight-verify-plugin/actions).

## Publishing metadata

| Item | Release setting |
| --- | --- |
| Repository | [subscan-explorer/midnight-verify-plugin](https://github.com/subscan-explorer/midnight-verify-plugin), public |
| License | `MIT`; copyright `2026 Subscan`; license included in the package |
| Package name | `midnight-verify-plugin`, unscoped |
| Version | `0.1.0`; see the [changelog](../CHANGELOG.md) |
| Publication control | Explicitly requested by the user; the prototype `private` flag is removed |
| Registry and access | `https://registry.npmjs.org/`, public |
| Distribution tag | `latest` |

Authenticate through `npm login --auth-type=web`; do not commit authentication files, print tokens or put credentials in command arguments. Confirm the logged-in account's publishing permission. A registry lookup returning 404 establishes only that the package name is currently absent; it does not reserve the name.

## Service and network boundaries

The [design document](design.md#service-acceptance-requirements) tracks independent source boundaries, bounded compilation resources, complete generated/on-chain key-set matching, correct job state ordering and maintenance-version binding. Client publication does not establish these service guarantees.

The [Preview E2E report](e2e/preview-2026-10-03.md) records successful multi-file compilation, deployment, verification, persisted-result checks, public-page confirmation and receipt-based resume. That evidence applies to the recorded Preview contract and toolchain. No additional contract deployment or backend/helper deployment is part of this npm release.

## Publish and verify

1. Validate the final source and CI, scan Git history and publication candidates, and inspect the actual package file list. Source snapshots, wallet state, credentials, runtime outputs and tutorial videos must be absent from the tarball.
2. Commit the release inputs. Pack into an external temporary directory, record the tarball's integrity and install that exact artifact into an isolated consumer.
3. Publish the validated tarball with `npm publish <tarball> --access public --tag latest --registry=https://registry.npmjs.org/`. Complete npm's browser or two-factor authentication if requested; never paste credentials into repository files.
4. Read the version, license, distribution tag, tarball integrity and repository metadata back from the public registry. Install `midnight-verify-plugin@0.1.0` into a fresh consumer and check API imports, the installed CLI and TypeScript declarations.
5. Create the matching `v0.1.0` Git tag and release only after registry publication is confirmed. If publication fails, report the failure without claiming the version is released.

The [usage guide](guide.md) describes supported build and verification flows. The [protocol](protocol.md) defines bundle and API behavior. Package validation does not establish a security audit or verification after contract maintenance.
