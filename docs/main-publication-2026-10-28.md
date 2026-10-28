# Main branch publication — 28 October 2026

## Scope

- [x] Consolidate all LunaTV release commits through `43a28ae`: security review fixes, guarded outbound connections, VOD permissions, native Safari HLS, supported dependencies, and duplicate mobile overlay repair.
- [x] Compare the dedicated checkout with the latest release: application source and dependency files already match the reviewed release.
- [x] Restore repository CI, image publication, deployment scripts, example Compose configurations, and remaining release documentation.
- [x] Retain the reviewed Docker base version pins; align CI with the proxy's Go 1.26 minimum.
- [x] Exclude local databases, cookies, environment files, binary output, generated screenshots/test results, editor state, and the separately managed OrionTV repository. Preserve the original working checkout.
- [x] Clean frozen dependency installation, 119 tests / 14 suites, type checking, repository lint with zero warnings, Go tests/vet/gofmt, shell syntax checks, and production build all pass.

Publication target: GitHub `main`, using a normal fast-forward push; remote commit identity is checked after publication.

This publication updates the source repository and triggers its configured GitHub workflows. It does not replace the running Synology container. OrionTV source remains in its own repository.
