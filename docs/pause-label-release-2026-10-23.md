# Mobile Pause-label repair — 23 October 2026

The public site now runs `lunatv:pause-fix-20261023` (`sha256:ca2bf521c6249a40c236e2cf6d2a420f9fbb8e35ccda38af29fb619b10091fa7`), healthy with zero restarts/OOM. Source `f2ce6ffa67e1348b47e4dfa317b7e39ebad85eeb` is committed on `codex/mobile-overlay-fix-20261023`; the original checkout branch/index and unrelated changes remain preserved.

## Cause and change

`videojs-mobile-ui` injected a second PlayToggle into `.vjs-touch-overlay`, outside the hidden Video.js control bar. Its styles are not loaded in the custom player, so its control text appeared literally as “Pause” while video was playing. The exact public page reproduced this in mobile WebKit before deployment.

`src/app/play/page.tsx` now sets `touchControls.disabled: true`. The custom player retains its own buttons/gestures and the mobile plugin retains its existing fullscreen-rotation options. No dependency or data changes.

## Completed verification

- [x] Before: public `ffzy/99489` showed one visible mobile overlay with “Pause” while playing 1280×640 video.
- [x] 119 tests / 14 suites, typecheck, web lint and Linux/amd64 production build pass.
- [x] Isolated candidate login/play-page/auth-denial checks and NAS native/runtime smoke pass.
- [x] After: public mobile WebKit has zero duplicate overlays, seven custom buttons, 1280×640 video, ready state 4 and no media error; final sample 97.99 seconds / 2,419 frames.
- [x] Real custom-button clicks pause/resume playback; time advances after resume. Rotated page fullscreen enters/exits successfully with the duplicate overlay absent.
- [x] Only LunaTV changed; all 51 other NAS containers and application environment/mounts/networks/resources/healthcheck are preserved.
- [x] Protected snapshot and immediate rollback retained. No physical iPhone was directly instrumented.

Evidence: [sanitized receipt](pause-label-release-2026-10-23.json), `output/playwright/pause-label-before-20261023.png`, `output/playwright/pause-label-fixed-rotated-20261023.png`. Existing provider poster CORS and `/api/log` 404 errors were observed both before and after; they did not stop this playback check.

## Rollback

Previous dependency/Safari release is retained as `lunatv-pause-rollback/lunatv:20261023` (`sha256:ae4db2f62ae659b3fb4a521a40f71759edc3a5fbd7ce6faaf07c7b5fb2cf9a14`). Protected configuration/data snapshots and helper are `/volume5/docker/.lunatv-pause-fix-20261023`; older recovery roots remain intact.

```sh
ssh synology 'python3 /volume5/docker/.lunatv-pause-fix-20261023/rollout.py rollback lunatv --root /volume5/docker/.lunatv-pause-fix-20261023'
```

Rollback retains data and restores the visible-label defect. Use this image-aware helper instead of the generic deployment script.
