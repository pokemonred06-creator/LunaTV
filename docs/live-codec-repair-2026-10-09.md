# Live player follow-up — 9 October 2026

The focused repairs are deployed to [the live site](https://tv.fishred.duckdns.org/live). The final image is `sha256:40c14e5642f2d7da314236f0b840fbcd350d32a070c2a20e2aacdbd0a6412c48`, healthy, with the existing environment, bind mounts, networks and source configuration preserved.

## Fixed failure paths

- FFmpeg requests `bytes=0-` for playlists. The proxy now inspects and rewrites these responses, including nested HLS disguised as images, while preserving genuine partial binary ranges.
- HLS can silently discard an unsupported HEVC video track and keep playing audio. The player now switches to compatibility playback when the advertised video codec is unsupported and no video is rendering. Playable video and audio-only renditions are excluded.
- Subtitle rendition context now reaches nested manifests. Image-disguised WebVTT segments receive a `.vtt` proxy suffix, while encryption-key suffixes are preserved. Both compiled copies of the shared manifest helper were synchronized.
- Starting conversions are counted once toward the two-session limit. A regression test reproduces the former false busy response; two real lighter conversions started successfully and a third was correctly blocked.

These were narrow patches layered onto the exact serving image. New player/runtime asset names avoid stale immutable browser caches. No unrelated dirty-worktree code was deployed, and no commit or push was made.

## Verification and limits

All **50 tests**, type checking and web lint passed. Actual guarded conversion decoded Jade and Pearl output as 720p H.264, 50 frames in a bounded segment. Public browser checks require advancing playback time and decoded frames; HTTP 200 and a playing event alone are insufficient.

Public-site evidence covers Jade automatic compatibility, Pearl normal playback, Pearl compatibility recovery, and representative HLS, FLV and MP4 playback. See [final browser evidence](live-final-browser-evidence-2026-10-09.json), [earlier codec evidence](live-codec-browser-evidence-2026-10-08.json) and [format regressions](live-codec-format-regressions-2026-10-08.json). The two-session test qualifies startup of lighter feeds; simultaneous HEVC conversion performance is not certified, and one heavier two-stream startup timed out.

The full transport audit on 8 October checked **1,225 channels: 324 delivered media, 901 failed**. It includes first HLS media segments, rather than per-channel browser decoding. Provider availability changes over time; this audit was completed before the final session-count patch and was not rerun after it. [Complete results](live-range-repair-audit-2026-10-08.json).

Direct provider diagnostics reproduced a refused connection, a TLS handshake failure, upstream 404/500 pages and HTML replacing a playlist. Other groups include timeouts and access/target-policy blocks. Player support cannot supply missing upstream media. Some failed entries have other existing entries with identical display names; [53 such candidates](live-same-name-alternatives-2026-10-08.json) were recorded without silently switching broadcasts or claiming broadcast equivalence.

Private addresses and unapproved ports remain blocked. Approved public ports 98, 2096 and 14311 remain configured. [Live policy checks](live-port-policy-check-2026-10-08.json) and [direct provider evidence](live-provider-evidence-2026-10-08.json).

## Deployment and rollback

- Final image: `lunatv:custom` → `sha256:40c14e5642f2d7da314236f0b840fbcd350d32a070c2a20e2aacdbd0a6412c48`.
- Immediate rollback: `lunatv:rollback-slots-20261009` → `sha256:cde71189750e75ffa3f7db5cf3d8030c863fdec32e40f7d3e146a32c5550df32`.
- Previous codec rollback: `lunatv:rollback-codec-20261008` → `sha256:b3263922bce43b03388a82fdbdc15a0e3a28f1db3ffa3f7229fcc3243850dc80`.
- Previous range rollback: `lunatv:rollback-range-20261008` → `sha256:56f1e63246ff5a6c438d662ea39583aac9e3e4e21776a54fcee9b271ed122f92`.

Only LunaTV was recreated, with `--no-deps --pull never --force-recreate` from the existing NAS Compose project. The guard initially restored the preceding image because the bind-mount array order differed; comparing all mount properties sorted by destination confirmed the same configuration before the successful deployment. Existing data, Redis and other services were retained. [Codec asset manifest](live-codec-patch-manifest-2026-10-08.json) and [session patch manifest](live-session-patch-manifest-2026-10-09.json).

For rollback, retain the current image, retag the chosen rollback as `lunatv:custom`, and recreate only LunaTV from `/volume5/docker`. Do not replace the whole Compose file or source configuration.
