# Playback repair — 23 October 2026

The public site https://tv.fishred.duckdns.org is running `lunatv:playback-fix-20261023`, image `sha256:b882ed7f895f00d0b0ef14f3318e18baddade3d697f42f63958540c67e3e3837`, on Node 22.23.4 / Next.js 16.4.2. Docker is healthy with zero restarts or OOM events.

## Confirmed causes and repair

VOD playback and source probes sent provider keys or content IDs through `moontv-source`, which media authorization checked only against live-TV sources. Authenticated requests returned 401. A second failure accessed `localStorage` while the server rendered a Douban cover; the response could be HTTP 200 while carrying an SSR error.

VOD now uses `moontv-vod-source` with the actual provider key and its own source ACL. The player, initial/fallback probes and quality checks use the same URL builder, preserving native media formats. Signed HLS variants, keys and segments retain VOD permission context; mixed contexts, revoked sources and tampering remain rejected. Browser image preferences now have an SSR-safe default.

## Verification and progress

- [x] Reproduced both production failures before the patch; the saved full-page check failed despite status 200.
- [x] 113 tests across 14 suites pass with frozen dependencies, including regressions that failed before the fix.
- [x] Full web ESLint, TypeScript and Linux/amd64 production build pass.
- [x] Six isolated candidate checks pass, including SSR and authorization/private-address controls.
- [x] Public VOD playlist and cookie-less signed segment return 200; 16 KiB sampled.
- [x] Public browser VOD advances from 19.65 s / 414 frames to 42.48 s / 984 frames at 720×1280, ready state 4, no video error.
- [x] CGTN live browser playback renders 701 frames at 1280×720 after 27.88 s, ready state 4, no video error.
- [x] All 1,225 exported IPTV URLs remain signed; sampled CGTN playlist and segment return 200, tampered target 401.
- [x] 23 HTTP/auth/backup checks pass; six users, 25 enabled VOD sources and one live source preserved. Encrypted backup export/decryption succeeds.
- [x] Only LunaTV replaced; all 51 other NAS containers, including Redis, retain their previous identity/image/start time. Environment, mounts, networks, resources and healthcheck are unchanged.
- [x] Narrow source fix committed as `142ecee68757a53a001ca1590e718ede29bc5d11` on `codex/playback-repair-20261023`; original checked-out branch/index and unrelated edits preserved. Matching files are present in `/Users/server/Github/LunaTV`.

Evidence: [deployment and playback receipt](playback-repair-2026-10-23.json), `output/playwright/vod-repaired-20261023.png`, and `output/playwright/live-repaired-20261023.png`. These are representative real playback checks, not certification of every upstream provider or physical device. No OrionTV APK was rebuilt.

## Recovery

Protected snapshots and helper: `/volume5/docker/.lunatv-playback-repair-20261023` (0700, private files 0600). Immediate rollback image `lunatv-playback-rollback/lunatv:20261023` retains the previous `9af77a8d7c22` release; older recovery tags remain intact.

```sh
ssh synology 'python3 /volume5/docker/.lunatv-playback-repair-20261023/rollout.py rollback lunatv --root /volume5/docker/.lunatv-playback-repair-20261023'
```

Rollback changes the application image only and reintroduces these playback defects. The existing generic `deploy.sh` assumes a different image reference; use the image-aware helper for this release.
