# Safari repair and dependency release — 23 October 2026

The public site runs `lunatv:dependencies-20261023`, image `sha256:ae4db2f62ae659b3fb4a521a40f71759edc3a5fbd7ce6faaf07c7b5fb2cf9a14`. Node remains 22.23.4 and Next.js remains the registry stable release 16.4.2. Docker is healthy with zero restarts or OOM events.

## Safari failure and repair

The exact reported fixture is VOD source `ffzy`, video `99489`. WebKit reproduced the same “当前集所有播放源都不可用” error. The stream itself is H.264/AAC and available. Safari first probes native HLS with `Range: bytes=0-1`; forwarding that header returned only the first two playlist bytes, which the proxy rejected as invalid HLS with HTTP 415. Both master and nested playlists also failed nonzero ranges.

The proxy now fetches and rewrites complete playlists, returning 200 for these probes. If a generic ranged target is discovered to be HLS, it is refetched without Range. Binary media still returns correct 206 responses and byte ranges. Signed VOD/live authorization and guarded transport remain enforced. The narrow fix was deployed first as `lunatv:safari-fix-20261023` and is included in this dependency release.

## Dependency scope

Updated 23 existing direct versions, added the official ESLint compatibility helper, and upgraded pnpm to 12.15.0. Both npm and pnpm locks are synchronized. Changes include React 19.3.1, Framer Motion 14.6, he 2, Redis 6.3 and ESLint 10.13. pnpm 12 workspace settings, the he ESM import/transpilation and the new lint rule were migrated.

TypeScript 6.0.3 and Video.js 8.24.1 are retained because the latest major APIs are incompatible with this Next/player integration. `media-icons` 1.1.5 is retained because its `latest` tag points to an older 0.10.0 release. Android TV dependencies/APK are unchanged. See [all versions and compatibility details](dependency-update-2026-10-23.md).

## Verified completion

- [x] Exact production Safari failure reproduced, with regression tests failing before the fix.
- [x] 119 tests across 14 suites, typecheck and web lint pass in both release context and actual dedicated checkout.
- [x] Frozen pnpm install, npm lock dry run, production build and Linux/amd64 Docker build pass.
- [x] Six isolated candidate checks and native runtime smoke pass.
- [x] All 19 exact-fixture HTTP checks pass: master/nested full and Safari range probes, signed children, binary ranges and rejection cases.
- [x] Final public WebKit native-HLS playback advances from 29.00 s / 707 frames to 65.08 s / 1,606 frames at 1280×640, ready state 4, no media error. The preceding narrow Safari release also passed seek and sustained playback. No physical iPhone was directly instrumented.
- [x] 23 HTTP/auth/encrypted-backup checks pass. Six users, 25 enabled VOD sources and one live source retained.
- [x] 1,225 signed IPTV entries; sampled CGTN playlist and segment 200, tampered target 401.
- [x] Only LunaTV replaced. All 51 other NAS containers and application environment/mounts/networks/resources/healthcheck remain unchanged.
- [x] Final production audit reports zero advisories. The development braces warning is a stale advisory officially withdrawn on 23 October; no patched version exists. The raw/withdrawal evidence is retained in the dependency receipt.

Source commits in `/Users/server/Github/LunaTV`: Safari fix `6198b7a`, dependency integration `59a3d05`, release branch `codex/safari-dependencies-20261023`. Existing checked-out branch/index and unrelated working edits are preserved. The tested release Dockerfile pins runtime versions; the original checkout's unrelated base-image choices are retained while dependency changes are applied in place.

Evidence: [sanitized release receipt](safari-dependency-release-2026-10-23.json), `output/playwright/safari-before-20261023.png`, `output/playwright/safari-dependencies-final-20261023.png`. Representative stream/browser checks do not certify every provider or physical device.

## Recovery and local development

Immediate rollback is the already-fixed Safari image `lunatv-dependencies-rollback/lunatv:20261023` (`a394b160c9c5`). Protected snapshots/helper are `/volume5/docker/.lunatv-dependencies-20261023` (0700, private files 0600).

```sh
ssh synology 'python3 /volume5/docker/.lunatv-dependencies-20261023/rollout.py rollback lunatv --root /volume5/docker/.lunatv-dependencies-20261023'
```

This restores the preceding dependency set while retaining the Safari fix and data. Older playback/rereview rollback tags remain intact. Generic `deploy.sh` assumes a different image reference; use the image-aware helper.

The host-global pnpm 10 wrapper fails to execute its auto-downloaded pnpm 12 binary. No global tooling was changed. The verified project bootstrap is:

```sh
npm exec --yes --package=pnpm@12.15.0 -- pnpm install --frozen-lockfile
npm exec --yes --package=pnpm@12.15.0 -- pnpm run build
```
