# Live playback repair — 8 October 2026

The initial repair below was followed by [the 9 October codec/proxy repair](live-codec-repair-2026-10-09.md). The current NAS image is `sha256:40c14e5642f2d7da314236f0b840fbcd350d32a070c2a20e2aacdbd0a6412c48`, healthy. Jade compatibility and automatic codec fallback now work; subtitle handling and conversion startup accounting were also repaired. Current validation: 50 tests, type checking and web lint passed. The later full transport audit found media from 324 of 1,225 channels, with 901 failures; this is not per-channel decoding certification.

## Result and limits

The player now detects stream formats from response bytes and handles HLS, HTTP FLV, MPEG-TS, MP4 and recognized audio streams. A server compatibility mode converts decodable HTTP streams to browser-compatible H.264/AAC HLS. Real browser decoding was verified for the four video formats and compatibility mode.

This does **not** establish that every configured channel plays. The complete NAS audit checked 1,225 channels; 309 delivered data through the guarded media path and 916 failed. The audit checks transport and the first HLS media segment, rather than browser decoding for every channel. Provider availability is a point-in-time observation.

[Complete per-channel audit](live-playback-audit-2026-10-08.json) · [Final public playback screenshot](../output/playwright/live-playback-final-20261008.png) · [Approved port update](live-stream-port-approval-2026-10-08.md)

## Changes

- Share byte-based format detection between precheck and playback; route FLV and MPEG-TS through `mpegts.js`.
- Preserve M3U channels separated by VLC/Kodi directives; resolve relative URLs and approved User-Agent, Referer and Origin pipe headers.
- Rewrite HLS variants, renditions, encryption keys and initialization segments, including extensionless resources. Preserve file suffixes needed by FFmpeg.
- Allow the original public ports of registered channels while retaining private-address checks and redirect/segment validation.
- Remove background channel probing and unexpected automatic channel switching; fix repeated initialization when URL selection clears.
- Add authenticated compatibility playback through the guarded local proxy, capped at two simultaneous sessions with idle cleanup, up to 720p H.264/AAC output. FFmpeg 8.0.1 is present in the deployed image.
- Display playback errors and a retry button. Stop ordinary HTTP 403 failures from reconnecting indefinitely.

## Verification

Type checking, web lint, all 37 tests and production Docker builds passed. Browser verification used the Playwright skill and actual decoded frames, not only HTTP status or a playing event.

| Path | Sample | Observed decoding |
| --- | --- | --- |
| HLS | CGTN英语 | 1280 × 720; public HTTPS test decoded 1,971 frames over 78 seconds |
| FLV | 明珠台 | 1920 × 1080 |
| MPEG-TS | 台视 | 1280-pixel video width |
| MP4 | 1994年春晚 | 982-pixel video width |
| Compatibility HLS | CGTN英语 | H.264/AAC; verified locally and on public HTTPS |

After the final deployment, public HTTPS CGTN playback decoded 54 frames at 1280 × 720 with playback time advancing beyond 2 seconds. Switching to compatibility playback decoded 6,197 frames at 1280 × 720 with playback time at 247.72 seconds and ready state 4. Both had no video-element error. The latest UI also passed a controlled FLV 403 test: the error and retry button appeared, and removing the mock and retrying restored 1920-pixel playback with 53 decoded frames.

Audio-only sources, every codec/device combination and sustained concurrent-transcode load were not individually qualified.

## Remaining source failures

NAS transport audit timestamp: `2026-10-08T12:04:31.441Z`.

| Failure | Channels |
| --- | ---: |
| Timeout | 264 |
| HTTP 403 | 188 |
| HTTP 502 | 135 |
| HTTP 404 | 106 |
| HTTP 409 | 65 |
| HTTP 415 | 42 |
| HTTP 302 | 33 |
| HLS media HTTP 403 | 23 |
| HTTP 500 | 20 |
| HLS media HTTP 429 | 10 |
| HTTP 418 | 8 |
| HTTP 523 | 6 |
| HLS media HTTP 404 | 6 |
| HTTP 503 | 5 |
| HLS media HTTP 415 | 3 |
| HTTP 400 | 1 |
| HTTP 429 | 1 |

Some failures are provider responses; others are proxy or media-validation errors. A failed audit response alone does not prove the provider is permanently offline. HTTP 409 responses in this proxy path are forwarded upstream responses; target-policy blocks return HTTP 403 with `Blocked upstream target`.

The user subsequently approved public stream ports **98, 2096 and 14311**. These are now active through `PROXY_ALLOWED_PORTS=98,2096,14311` in the existing NAS LunaTV service. The running image is unchanged; only LunaTV was recreated. Type checking, web lint and 43 tests passed. Live checks confirmed private addresses and unapproved ports remain blocked.

A [focused public HTTPS audit](live-approved-ports-audit-2026-10-08.json) retested 100 channels previously seen hitting port blocks: 16 delivered media and 84 still failed. This includes first-segment transport checks, not per-channel decoding. The full 1,225-channel snapshot above was not rerun. See the [approved port update](live-stream-port-approval-2026-10-08.md) for exact configuration, live policy evidence and rollback.

The newly unblocked 明珠台 channel was confirmed decoding at 1920×1080 with 7,555 frames over 175 seconds. The sampled 翡翠台 channel still failed browser and compatibility decoding despite returning TS data. No additional decoder configuration was deployed after an isolated test failed to produce a complete segment within 45 seconds. The 16 transport successes must not be presented as 16 fully verified playable channels.

Unavailable, expired, restricted or invalid upstream media needs a working provider URL or an authorized alternative. The player cannot manufacture missing media or bypass provider access controls.

## Deployment and rollback

Only the NAS LunaTV service was recreated. Its Redis service and `/volume5/docker/lunatv/cache` bind mount were preserved. Existing NAS Compose and environment configuration were retained.

- Current: `lunatv:custom` → `sha256:40c14e5642f2d7da314236f0b840fbcd350d32a070c2a20e2aacdbd0a6412c48` (9 October follow-up).
- Immediate rollback: `lunatv:rollback-slots-20261009` → `sha256:cde71189750e75ffa3f7db5cf3d8030c863fdec32e40f7d3e146a32c5550df32`. Earlier rollback tags remain retained.
- Pre-task rollback: `lunatv:rollback-live-20261008` → `sha256:baf70428c471ad82579f60aa9ec6454ed306420a6e18fd95468b821c501bcf72`.

For rollback, retag the chosen rollback image as `lunatv:custom` and recreate only `lunatv` from `/volume5/docker` with `--no-deps --pull never`. Retain the current image separately first. Do not replace the whole Compose file.

The repository had extensive unrelated local changes before this task. They were preserved; no commit or push was made as part of this repair.
