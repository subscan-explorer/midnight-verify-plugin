# Engineering decision records

Timestamps use Asia/Shanghai (UTC+08:00). Historical results describe the evidence available when each decision was recorded.

```yaml
- timestamp: "2026-10-03 11:27:23"
  confidence_score: 0.95
  source_event: "Request to create midnight-verify-plugin; local Compact 0.31.1 compilation and client integration tests"
  contextual_triple:
    context: "Source, compiler version and deployment artifacts are separate; collecting source after compilation may capture changed files"
    action_judgment: "Freeze Compact source before compiling in an independent TypeScript package, record the exact version, and output deployment artifacts with the bundle; reject unsupported search paths and arguments"
    feedback_result: "Mutation tests confirmed that output matches the snapshot, and real single-file and multi-file compilation succeeded; API-supported versions are not automatically validated client versions"
  potential_ontology_impact: "BuildSnapshot and ExactCompilerVersion validation rules"
- timestamp: "2026-10-03 11:27:23"
  confidence_score: 0.9
  source_event: "Address-level asynchronous API review and tests for lost acknowledgements, stale errors, existing tasks and exit codes"
  contextual_triple:
    context: "The API has no job ID, stores errors and success records by address, and may lose submission acknowledgements"
    action_judgment: "Submit at most once per invocation, compare complete source and status, distinguish pending results and different-source records, and never trigger redeployment from a timeout"
    feedback_result: "Local HTTP and CLI tests passed; evidence proves a matching address-level record, while job ownership and post-maintenance state require server support"
  potential_ontology_impact: "VerificationAttempt and AddressLevelEvidence boundaries"
- timestamp: "2026-10-03 11:27:23"
  confidence_score: 0.9
  source_event: "Existing-service reuse requirements and review of paths, resources, key sets, state ordering and maintenance versions"
  contextual_triple:
    context: "A CLI reduces source preparation effort but cannot repair server-side input handling or verification gaps"
    action_judgment: "Keep the client free of runtime npm dependencies and reuse the backend/helper without a new Deployment; deliver an unpublished npm prototype with separate service and network release gates"
    feedback_result: "The project and local tests were complete; server changes, full Subscan network acceptance and npm publication had not been performed"
  potential_ontology_impact: "ReleaseReadiness separates client, service and network acceptance"
- timestamp: "2026-10-03 11:54:14"
  confidence_score: 0.98
  source_event: "Authorized test-wallet compilation, deployment and verification; live Preview E2E and public-page confirmation"
  contextual_triple:
    context: "Initial wallet synchronization is slow, and verification may fail after deployment; restarting the entire script risks duplicate deployment"
    action_judgment: "Separate explicit deploy and resume modes, check the derived wallet address before synchronization, checkpoint public broadcast and confirmation receipts, and resume verification without loading a wallet or broadcasting"
    feedback_result: "The Compact 0.31.1 multi-file example deployed and verified on Preview; resume after stopping the proof server returned already-verified with matching source and no redeployment"
  potential_ontology_impact: "DeploymentReceipt and VerificationResume separate chain actions from address-level verification"
- timestamp: "2026-10-03 11:54:14"
  confidence_score: 0.98
  source_event: "27 local tests, independent persisted-result assertions and a public Verified page"
  contextual_triple:
    context: "A successful live workflow proves client integration but does not cover malicious input, maintenance events or other networks"
    action_judgment: "Preserve the source snapshot, public receipt, full source/version comparisons and page evidence; record Preview success separately from server release gates and Preprod/Mainnet acceptance"
    feedback_result: "Initial verification returned verified and the public page confirmed success with verifying=false; path, resource, complete-key-set, ordering and maintenance-version requirements remained unproven, so npm publication stayed disabled"
  potential_ontology_impact: "NetworkHappyPathAcceptance and ReleaseReadiness require independent evidence"
- timestamp: "2026-10-03 12:09:12"
  confidence_score: 0.98
  source_event: "Request to remove machine-specific paths from public documentation and make compactc and compiler versions configurable"
  contextual_triple:
    context: "The Compact launcher and direct compactc have different argument conventions; configuration changes must not alter the version used to resume an existing deployment"
    action_judgment: "Configure exact version, mode and executable with flags taking precedence over environment variables; check actual metadata and API support, preserve bundle/receipt versions during resume, and use portable paths and independent credential files in examples"
    feedback_result: "34 local tests passed for version selection, both modes, precedence, mismatch rejection, API preflight and resume version preservation; real compactc 0.31.1 produced complete keys with the original snapshot digest; other versions still require live acceptance"
  potential_ontology_impact: "CompilerInvocation and DeploymentToolchainIdentity separate configuration from network acceptance"
- timestamp: "2026-10-03 12:28:58"
  confidence_score: 0.98
  source_event: "Request to make public code and documentation English and prepare for release"
  contextual_triple:
    context: "Passing repository tests does not establish that the packed package works for consumers, and successful packaging does not resolve publication metadata or service acceptance"
    action_judgment: "Keep public text and paths portable, validate an actual tarball in an isolated offline consumer, add local language/link checks and CI configuration, and report unresolved release metadata separately from technical check results"
    feedback_result: "37 local tests, TypeScript checks and installed-consumer API, CLI and declaration checks passed; repository URL, license, remote CI and existing service/network requirements remained unresolved, so npm publication stayed disabled"
  potential_ontology_impact: "PackageConsumerAcceptance and PublicationReadiness require distinct evidence"
- timestamp: "2026-10-08 12:04:57"
  confidence_score: 0.98
  source_event: "Request to sanitize all publication inputs before submitting the public library to GitHub"
  contextual_triple:
    context: "Language/path checks do not detect all credentials, ignored directories can contain force-added files, and a public deployment receipt can unnecessarily expose wallet identity"
    action_judgment: "Review actual Git candidates and package contents with redacted secret scans, reject sensitive files even when force-added, remove wallet identity from public receipts and harness output, and retain only public contract evidence and generic service acceptance requirements"
    feedback_result: "43 local tests and package consumer checks passed; source/package scans found no credential material, the published wallet address was removed and legacy receipt updates stripped it; no commit history existed, and future changes still require fresh review"
  potential_ontology_impact: "PublicationPrivacy separates public chain evidence, wallet identity and credential material"
- timestamp: "2026-10-10 16:15:00"
  confidence_score: 0.98
  source_event: "Explicit user request to publish midnight-verify-plugin to npm and confirmation of MIT with Subscan as copyright holder"
  contextual_triple:
    context: "The client has Preview workflow evidence and package/consumer validation, while the prototype documentation still holds publication on broader service and network acceptance"
    action_judgment: "Distribute the initial client as version 0.1.0 under the confirmed MIT license, supersede the prototype publication hold for this explicit request, and document unvalidated service guarantees, Preprod/Mainnet and other compiler versions separately; validate the exact tarball and recheck the registry before claiming publication"
    feedback_result: "The existing 43-test suite, local API/CLI/type consumer checks and the public Linux/macOS CI matrix passed before release preparation; publication and final-commit validation require their own evidence, and no additional chain or service deployment is authorized by packaging"
  potential_ontology_impact: "ClientDistribution separates explicit publication authority, license choice and package acceptance from service/network guarantees"
```
