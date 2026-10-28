# Security dependency update — 23 October 2026

Next.js and its matching lint packages are 16.4.2. pnpm/npm overrides select sharp 0.35.5, source-map-js 1.2.2 and webpack 5.112.1. Both lockfiles were refreshed. This fixes the image-optimizer SSRF affected-version match and the other reported dependency advisories while retaining the deployed application source and Node 22.23.4.

The production image was rebuilt from the preserved 22 October deployment context, with only these dependency manifests/lockfiles replaced. Its src files were verified byte-identical to the canonical working tree. Existing uncommitted UI, media, authentication and other application changes remain unstaged; the dependency commit was constructed against the clean Git base so it does not absorb them.

Validation: 81 tests, TypeScript, web lint, production Docker build and isolated sharp image encoding passed. The installed candidate inventory (81 package/version combinations) has zero matches against npm's live advisory endpoint. Remote image hosts remain configurable; the fixed framework retains the existing private-IP protection.

The pnpm lockfile is canonical for builds. npm's secondary lockfile was regenerated with --legacy-peer-deps because the pre-existing ESLint peer ranges conflict during npm-only resolution; pnpm installation, lint and build pass normally.

Deployment and rollback evidence: `/Users/server/Documents/Codex/2026-10-23/javascript-security-deployment/`. Cold data backup is retained privately on the NAS. Live login, access controls and provider transport are checked after rollout; physical decoder playback is not qualified by these checks.
