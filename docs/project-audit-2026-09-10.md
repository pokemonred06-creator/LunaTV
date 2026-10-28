# Project audit — 10 September 2026

Reviewed the current LunaTV web checkout, including dependency advisories,
search/detail retrieval, caching, outbound URL validation, build configuration,
CI, and deployment packaging. Existing working-tree changes were preserved.
This review does not certify the entire repository or its production deployment.

## Implemented findings

| Finding                                                                                                                | Change                                                                                                                                  | Evidence                                                                                                   |
| ---------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| Next.js 16.3.2 has two critical advisories; its installed sharp dependency also has a high advisory.                   | Upgraded Next.js and its ESLint packages to 16.3.3 and sharp to 0.35.4.                                                                 | Production dependency audit now reports zero advisories; production build passes.                          |
| Unused next-pwa package brings obsolete build dependencies into the production dependency tree.                        | Removed it after confirming no active configuration or source import uses it.                                                           | Audited production dependency entries decreased from 616 to 223.                                           |
| Search aggregation mutates the cached first-page array, accumulating later-page duplicates.                            | Copy the first-page array before aggregation.                                                                                           | Repeated multi-page searches against a frozen cached array return stable results.                          |
| Cache limits were enforced only during periodic cleanup, and persistent reads could backfill without starting cleanup. | Enforce the 1,000 search / 500 detail entry limits at every insertion; start cleanup for backfills too.                                 | Burst-write and persistent-backfill tests verify eviction for both caches.                                 |
| Detail timeouts ended at response headers, allowing stalled bodies to hang; failed HTML fetches leaked timers.         | Keep deadlines active through body consumption and clear timers in finally blocks. Failed proxy JSON can fall back to direct retrieval. | JSON/HTML stall, failure cleanup, and fallback tests pass.                                                 |
| Cancellation during a search-cache lookup could still initiate a network request.                                      | Check cancellation again after the lookup.                                                                                              | Cancellation regression verifies no network request occurs.                                                |
| String-based IPv6 filtering missed mapped private addresses and some reserved ranges.                                  | Use Node's IP-aware BlockList, preserving each guard's IPv4 policy; reject empty DNS responses.                                         | Mapped loopback/private, link-local, multicast, reserved, hostname-resolution, and public IPv6 cases pass. |
| CI hard-coded pnpm 10.28.0 while package.json and Docker use 10.33.0.                                                  | Let pnpm/action-setup read the declared packageManager version.                                                                         | Frozen pnpm lockfile validation passes.                                                                    |

## Validation

- `pnpm lint --max-warnings=0`: passes across the repository.
- `pnpm typecheck`: passes; the updated production build also passes TypeScript.
- `pnpm test --runInBand`: 28 tests across four suites pass (25 new regression cases).
- `pnpm build`: passes using Next.js 16.3.3.
- `pnpm install --lockfile-only --offline --frozen-lockfile --ignore-scripts`: passes.
- `pnpm audit --prod --json`: zero reported advisories, down from two critical,
  six high, and two low. This is a registry snapshot, not a security guarantee.
- `go test ./...` in `scripts/proxy` with a writable temporary build cache:
  passes compilation; that package has no test files.

## Remaining boundaries

- Changes are local and have not been deployed to Synology.
- Real-provider playback, browser interaction, Android TV, and load testing were
  not exercised. No end-user latency or memory-byte reduction is claimed.
- Cache limits count entries, not bytes; a provider can still return large
  individual entries. A byte budget needs workload measurements.
- Outbound hostname validation and connection resolution remain separate;
  closing DNS-rebinding gaps requires connection-level address pinning or an
  egress policy. The existing intentional Clash FakeIP exception is preserved.
- Detail candidates have individual deadlines, not one shared total deadline.
  Multiple failures can still delay a request; changing this should preserve
  provider fallback behavior and propagate caller cancellation end to end.
- pnpm remains the canonical package manager for CI and Docker.
  The secondary npm lockfile was regenerated from the same manifest after its
  existing resolution failed; its Next.js/sharp versions match the patched
  pnpm tree. npm installation and runtime behavior were not separately tested.


## Full-codebase review remediation — 22 October 2026

The nine confirmed findings from the Alibaba OpenCodeReview v1.13.2 host-delegated
review are fixed locally in LunaTV and its nested OrionTV repository. The review
used OCR's inventory/rule delegation and targeted manual inspection; no separate
OCR-managed LLM run is claimed. Existing uncommitted work was preserved.

- [x] Image and logo proxies buffer at most 20 MiB and accept recognized PNG,
  JPEG, GIF, WebP or AVIF signatures. They emit a fixed image MIME type,
  `nosniff` and a sandbox CSP; HTML and SVG are rejected. Stream responses also
  use fixed media types and browser safeguards.
- [x] Backup encryption/import has a separate 64 MiB token policy; the 8 KiB
  authentication-token policy remains. Both export and decompression enforce a
  64 MiB JSON limit. A large backup round-trips through the actual HTTP handlers.
- [x] Import validates nested configuration, users, records, favorites, history,
  credential hashes and skip settings before clearing storage. It saves a
  flushed, mode-0600 encrypted recovery archive first, restores the previous
  snapshot on write failure, and retains recovery data when import fails.
- [x] The Next.js media handler requires an active session or a signed URL bound
  to the path, query/target, username, source and expiry. HLS variants, keys and
  segments inherit signed access. The separate Go listener also rejects unsigned
  initial manifests.
- [x] Session verification rejects expired, invalid and excessively future-dated
  timestamps; the server enforces the seven-day lifetime.
- [x] Banned and removed accounts lose server-side access and VOD/live sources.
  Revoked or empty tag grants fail closed.
- [x] Live listing, channels, EPG, precheck, playlist export, media and compatibility
  relay paths enforce source permissions. Relay reads also enforce ownership.
  OrionTV authenticates the configured LunaTV playlist endpoint and uses signed
  playback URLs; it sends no session cookie to external playlists/redirect paths.
- [x] Both Compose examples require `PROXY_SECRET` before container creation.
- [x] OrionTV's TCP HTTP server waits for the declared body byte count, decodes
  UTF-8 after reassembly, rejects duplicate/invalid lengths and transfer encoding,
  enforces its 16 KiB cap and dispatches only once per connection.

Validation:

- Web: 81 tests across 10 suites, full ESLint, TypeScript and `pnpm build` pass.
- OrionTV: 76 tests across 6 suites and one snapshot, full ESLint and TypeScript pass.
- Go proxy: `go test ./...` (including signature regression) and `go vet ./...` pass.
- Both Compose examples reject a missing secret and validate with a test secret.
- Seven production HTTP smoke checks pass using isolated temporary local data:
  anonymous media/M3U/precheck/source requests return 401, current owner access
  returns 200, expired owner access returns 401, and upstream HTML is rejected
  by the image proxy with 415.
- Baseline comparison found no edits outside the remediation files. No service
  was deployed or restarted and no APK was rebuilt/installed. Physical TV,
  provider playback and an actual Redis outage were not exercised; restore
  failure regressions use an in-memory mocked storage boundary.

Operational notes for the eventual release:

- Generate a strong `PROXY_SECRET` once (`openssl rand -hex 32`) and persist it
  in the deployment environment. The Compose samples deliberately contain no key.
- Playlist download now requires login. Refresh exported IPTV playlists before
  their signed URLs expire (within seven days of the issuing session). Deploy
  the matching OrionTV playlist-auth change with the server change.
- Failed imports leave `data/recovery/before-import-<uuid>.dat`, encrypted with
  the password supplied to the attempted import. If automatic rollback fails,
  preserve that file, restore storage availability and import it with the same
  password. A process crash during replacement also requires this recovery path;
  the restore is recoverable, not a database-wide transaction. Concurrent user
  writes during a restore should be avoided. Recovery needs writable persistent
  `/app/data`; failure to create the archive aborts before storage is cleared.
- Both working trees remain on `codex/review-remediation-20261022`. Remediation
  patches and validation logs are under `/tmp/lunatv-ocr-20261022/`. The existing
  mixed working trees have not been staged, committed or pushed wholesale.


## Synology release — 22 October 2026

The web remediation is deployed at https://tv.fishred.duckdns.org using
`lunatv:review-fixes-20261021T205429Z` (`sha256:769c4eeccdaaf963118d0eed4c466835cd041b4f3fc5a8525fa940c0511a654a`), with Node 22.23.4 and Next.js 16.3.6. The build used an
isolated copy of the tested working tree, excluding local data, environment
files, cookies, generated output and OrionTV. Node was pinned to 22.23.4 for
this release. Only LunaTV's image reference changed in NAS Compose.

- [x] Fresh linux/amd64 production Docker build and seven isolated-container checks.
- [x] Image archive checksum and all 15 filesystem layers match the tested image.
- [x] Healthy NAS service, zero restarts, no OOM; public HTTPS login and protected
  home/live/short-drama page access pass.
- [x] 23 real HTTP checks verify session expiry/future timestamp rejection,
  unknown-user rejection, anonymous media/playlist/precheck denial, Go signature
  enforcement, image HTML rejection and private-address blocking.
- [x] Real 80,498-byte encrypted backup exports and decrypts successfully for
  all six users; no production import or destructive restore was performed.
- [x] All 1,225 exported IPTV entries are signed. A changed target is rejected
  with 401; anonymous signed CGTN英语 playlist and child segment requests return
  200, with 16 KiB read from the segment. This verifies transport, not decoding.
- [x] All 25 enabled VOD sources remain. Redis, the environment file, data mounts,
  attached networks and all 51 other containers retain their prior state.

Rollback image: `lunatv:rollback-review-20261021T205429Z` (the previous Node 22.23.4 application image).
Protected Redis/data/configuration snapshots and rollback helper:
`/volume5/docker/.lunatv-review-20261021T205429Z` (directory 700; private snapshots 600).
The helper restores only LunaTV's image; no data migration was run.

Deployment evidence: [review-remediation-deployment-2026-10-22.json](review-remediation-deployment-2026-10-22.json).
OrionTV fixes remain in its local source; no APK was built or installed. Existing
restricted-live user verification was unavailable because none is configured;
source ACL cases pass in the regression suite. Physical-device decoding and
production restore/rollback outage scenarios were not tested.


## Playback repair — 23 October 2026

Completed and deployed as `lunatv:playback-fix-20261023`. Fixed VOD requests being checked against live-source permissions and a server-rendered Douban cover crash. 113 tests, TypeScript, full web lint and production build pass. Public browser VOD and live TV both decode advancing frames without video errors. Only LunaTV changed; six users, 25 VOD sources and one live source are retained. Source fix `142ecee` is committed on `codex/playback-repair-20261023`; unrelated working changes remain preserved.

- [x] Reproduction, regression tests, isolated candidate, rollout and public playback verification.
- [x] Release receipt, source checkpoint and protected rollback snapshot saved.

See [playback release and recovery](playback-repair-2026-10-23.md).


## Safari and dependency release — 23 October 2026

- [x] Reproduced the exact iPhone-Safari report in WebKit (`ffzy/99489`): two-byte HLS range probes caused 415; complete manifest fetching now preserves playback and binary ranges.
- [x] Updated 23 compatible direct dependency versions and pnpm 12; synchronized both locks, migrated ESLint/he/workspace settings and retained unsupported major versions with documented reasons.
- [x] 119 tests, typecheck, lint, frozen installs and production builds pass in the release and dedicated source checkout. Production audit: zero advisories.
- [x] Deployed `lunatv:dependencies-20261023`; healthy, zero restarts/OOM. Exact public WebKit playback advances at 1280×640; 19 Safari, 23 auth/backup and signed live-stream checks pass.
- [x] Users/sources/configuration and all 51 other containers preserved; immediate rollback retains the Safari fix.

Source commits `6198b7a` and `59a3d05`, branch `codex/safari-dependencies-20261023`. See [final release and recovery](safari-dependency-release-2026-10-23.md).


## Mobile Pause-label repair — 23 October 2026

- [x] Confirmed the mobile plugin's unstyled duplicate PlayToggle caused the visible label; disabled its touch overlay while retaining custom controls and rotation settings.
- [x] 119 tests, typecheck, web lint, production image build and isolated startup/auth checks pass.
- [x] Deployed `lunatv:pause-fix-20261023`, healthy with no restarts/OOM; all 51 other NAS containers preserved.
- [x] Public mobile WebKit playback, custom pause/resume and rotated fullscreen pass; duplicate overlay absent.
- [x] Source checkpoint `f2ce6ff`, protected rollback, screenshots and [release receipt](pause-label-release-2026-10-23.md) saved. Physical iPhone verification remains separate.
