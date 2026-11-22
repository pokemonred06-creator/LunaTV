# Episode handoff

Hongguo prepares each episode before it supplies a playback URL. Video.js kept the previous source when given an empty URL, and the autoplay attempt restarted it. The player now waits for a source and invalidates outgoing autoplay work at the end of an episode. The Next button selects the new episode before playback begins.

## Build inputs

The deployment was built from the verified 19 November episode-slide release. From that build source's root, run `git apply /path/to/player.patch`. The application files in this branch carry the same fix for the repository's default-branch source. [Deployment patch](player.patch) · [Source audit](source-audit.json)

## Browser regression

Run against a disposable LunaTV container with a `canary-handoff` account. The script uses Chromium, FFmpeg, and the repository's Playwright dependency. The fixtures provide distinct decoded frames for each episode. They exercise delayed Hongguo preparation, MP4 and HLS auto-advance, the Next button at the end of an HLS episode, and selection of another episode while Hongguo prepares the next one.

```sh
CANARY_ORIGIN="http://your-canary:8899" \
CANARY_PASSWORD_FILE="/path/to/disposable-password-file" \
node deployment/episode-handoff-20261122/browser-test.cjs
```

Set `EXPECT_REPLAY=1` when running the same script against the 19 November baseline.

[Browser verification](browser-verification.json)

## Release verification

- [x] Verify the 353 baseline input files and audit the three changed files.
- [x] Pass 908 tests, TypeScript, and the production webpack build.
- [x] Verify five Chromium handoffs, 13 fullscreen and gesture checks, and decoded EightMovie playback.
- [x] Verify healthy production and match both public player bundles against the tested build. [Release record](RELEASE.json)
- [x] Retain the previous image and a cold data backup. [Rollback script](ROLLBACK.sh)
