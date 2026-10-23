# Web dependency update — 23 October 2026

Upgraded 23 existing direct dependency versions, pinned the supported Video.js version, and added the official ESLint compatibility helper. pnpm is now 12.15.0; both lockfiles are synchronized. The Android TV companion is unchanged.

| Package | Before | After |
| --- | --- | --- |
| `framer-motion` | `^13.4.2` | `^14.6.0` |
| `he` | `^1.2.0` | `^2.0.0` |
| `lucide-react` | `^1.47.0` | `^1.61.0` |
| `react` | `^19.3.0` | `^19.3.1` |
| `react-dom` | `^19.3.0` | `^19.3.1` |
| `redis` | `^6.2.1` | `^6.3.0` |
| `swiper` | `^14.2.0` | `^14.3.0` |
| `video.js` | `^8.24.1` | `8.24.1` |
| `zod` | `^4.6.5` | `^4.6.7` |
| `@commitlint/cli` | `^21.2.3` | `^21.2.4` |
| `@commitlint/config-conventional` | `^21.2.3` | `^21.2.4` |
| `@eslint/compat` | `added` | `^2.1.1` |
| `@eslint/js` | `^9.39.5` | `^10.0.1` |
| `@next/eslint-plugin-next` | `16.4.2` | `16.4.3` |
| `@playwright/test` | `^1.63.0` | `^1.64.1` |
| `@types/node` | `^26.6.2` | `^26.6.5` |
| `@typescript-eslint/eslint-plugin` | `^8.70.1` | `^8.72.0` |
| `@typescript-eslint/parser` | `^8.70.1` | `^8.72.0` |
| `eslint` | `^9.39.5` | `^10.13.0` |
| `eslint-config-next` | `16.4.2` | `16.4.3` |
| `globals` | `^17.12.0` | `^17.13.0` |
| `lint-staged` | `^17.5.1` | `^17.6.0` |
| `postcss` | `^8.5.28` | `^8.5.31` |
| `prettier` | `^3.9.9` | `^3.9.10` |
| `typescript-eslint` | `^8.70.1` | `^8.72.0` |

## Compatibility

- TypeScript remains 6.0.3: latest TypeScript 7.0.2 removes the classic compiler API; current typescript-eslint supports versions below 6.1.
- Video.js is pinned to stable 8.24.1: latest 10.2.0 rejects the existing player API and requires a separate player migration.
- media-icons remains 1.1.5: its latest tag points backward to the 2023 version 0.10.0; the current official package is newer.
- Next.js latest remains 16.4.2; its ESLint packages have independently advanced to 16.4.3.
- he 2 uses named ESM exports. The namespace import and Next transpilePackages keep runtime and Jest resolution consistent.
- ESLint 10 uses the official compatibility wrapper for the legacy React plugin. Narrow peer overrides apply to React/import/jsx-a11y plugins; the former pnpm-only patch is removed. The new recommended rule also removes redundant canvas variable initializers.
- pnpm settings moved from package.json to pnpm-workspace.yaml. Existing transport/build overrides and skipped-script decisions are preserved; release-age exceptions name only exact verified new versions. Docker installs the matching package manager and copies its workspace settings.

## Verification

TypeScript, full lint, 113 tests in 14 suites, and the production Next.js build pass. Frozen pnpm install and npm ci lockfile dry run pass. Final production npm audit reports zero advisories. An initially stale braces advisory was independently verified withdrawn upstream on 23 October. See the JSON receipt for exact versions, exceptions and check results.

The existing host-global pnpm 10.33 wrapper cannot automatically install the native pnpm 12 executable (ENOEXEC). A local supported bootstrap avoids modifying global tooling:

```sh
npm exec --yes --package=pnpm@12.15.0 -- pnpm install --frozen-lockfile
npm exec --yes --package=pnpm@12.15.0 -- pnpm run build
```

Docker uses pnpm 12 directly. This receipt verifies dependencies before the combined Safari release; final deployment and device playback checks are tracked in that release receipt.
