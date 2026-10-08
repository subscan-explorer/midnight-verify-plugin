# Release checklist

Version `0.1.0` is an unpublished candidate. The repository's public documentation and examples use English and portable paths. The package remains `private: true` and `UNLICENSED` until its publishing metadata and release requirements are resolved. Repository visibility and npm publication are separate settings.

## Local validation

Run from the repository root with Node.js 22.16 or later:

```bash
npm ci
npm run check
npm test
npm run check:release
npm pack --dry-run
```

`npm run check:release` checks source text for CJK content, machine-specific paths and trailing whitespace; checks local Markdown links, heading anchors and code fences; builds an actual tarball; inspects its file list and text; and installs it into an isolated temporary consumer. The consumer checks public exports, CLI help, the installed binary entry and TypeScript declaration resolution. Temporary package and consumer files are removed after the check.

Publication safeguards also inspect tracked and non-ignored untracked Git candidates, including force-added ignored files and older staged text when the working copy differs, and reject sensitive file paths, symlinks, common credential literals, wallet identities and internal endpoints. These checks apply to packaged text as well. An independent redacted scanner and visual/metadata review were completed in the [October 8 publication safety review](publication-safety.md); repeat them when release inputs change.

The tarball consumer uses an offline installation with lifecycle scripts disabled. The package has no runtime npm dependencies. These checks require no wallet, API key, compiler installation or online contract submission. `npm ci` requires dependencies to be available in the npm cache or registry.

The checker reports unresolved package metadata under `metadataPending`. A `status: "passed"` result means the local technical checks passed; it does not mark the package ready for publication.

Local validation on October 3, 2026 passed on macOS arm64 with Node.js 22.16.0 and npm 10.9.2: dependency installation, TypeScript checking, all 37 tests, release checks and the package dry run. Release checks covered source and documentation text, local links and package contents, including isolated consumer API, CLI and type checks. All 19 shell examples passed `bash -n`, and the CI workflow passed YAML syntax parsing. Remote CI and additional platform/runtime acceptance are still pending.

On October 8, publication safeguards and legacy receipt sanitization increased the local suite to 43 passing tests. TypeScript, release/package consumer checks and redacted Gitleaks source/package scans passed again. No commit history or remote existed at review time. These local results do not establish remote CI or publishing permission.

## Continuous integration

The repository's `.github/workflows/ci.yml` runs dependency installation, TypeScript checking, local tests and release checks on Linux and macOS with Node.js 22.16.0 and 24. It does not use credentials, run the live deployment harness or publish a package. The workflow configuration must pass in the actual repository before release; adding the file does not establish a successful CI run.

## Publishing metadata

| Item | Current state | Required before publishing |
| --- | --- | --- |
| Repository URL | [subscan-explorer/midnight-verify-plugin](https://github.com/subscan-explorer/midnight-verify-plugin); repository, homepage and issue links configured | Confirm repository access and visibility for the intended release |
| License | `UNLICENSED`; no license grant | Select an SPDX identifier and add the corresponding `LICENSE` with the confirmed copyright holder |
| Package name | `midnight-verify-plugin` | Confirm name availability, ownership and publishing permissions on the intended registry |
| Version | `0.1.0` candidate | Confirm the release version and update the [changelog](../CHANGELOG.md) |
| Publication control | `private: true` | Remove the flag only after metadata, service and network release requirements pass and publication is explicitly requested |
| Registry and access | npm public registry; public access configured | Confirm these settings match the intended release destination |

Do not infer a license or repository URL from a local checkout. npm's [`private` and license fields](https://docs.npmjs.com/cli/v10/configuring-npm/package-json/) describe publication control and license metadata. The [`npm pack` command](https://docs.npmjs.com/cli/v10/commands/npm-pack/) produces the tarball used for consumer validation.

## Service and network acceptance

Local packaging success does not replace the service requirements in the [design document](design.md#server-side-requirements-before-npm-release): independent source boundaries, bounded compilation resources, complete generated/on-chain key-set matching, correct job state ordering and maintenance-version binding.

The [Preview E2E report](e2e/preview-2026-10-03.md) records successful multi-file compilation, deployment, verification, persisted-result checks, public-page confirmation and receipt-based resume. That evidence applies to the recorded Preview contract and toolchain. Preprod and Mainnet acceptance remain outstanding; configurable compiler versions require their own runtime and network compatibility evidence.

## Final preparation

1. Resolve the metadata above and complete the service and network requirements.
2. Run all local commands again from a clean checkout and inspect the packed file list. Confirm that source snapshots, wallet state, credentials and runtime outputs are absent.
3. Confirm that the actual CI matrix passes and that the release version and changelog match the candidate.
4. Perform npm publication as a separate, explicitly requested action using the validated candidate.

The [usage guide](guide.md) describes supported build and verification flows. The [protocol](protocol.md) defines bundle and API behavior. Neither live deployments nor npm publication are part of ordinary release checks.
