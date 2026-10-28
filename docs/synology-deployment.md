# Synology deployment

Run `bash deploy.sh` from the repository root after `pnpm typecheck`,
`pnpm lint:web`, and `pnpm test --runInBand` pass. Docker Desktop must be
running. The script builds the current working tree, including uncommitted
changes, for `linux/amd64` with the pnpm frozen lockfile. Base images are refreshed
with `--pull` while reusable build layers remain cached.

The deployment uses SSH alias `synology`, compose project `/volume5/docker`,
and Synology Container Manager binaries. It replaces only service `lunatv`;
the NAS compose file, environment file, Redis container, and persistent data
are retained. The existing NAS health check must report healthy within three
minutes. A successful deployment also verifies the running image ID.

The previous image receives a timestamped `lunatv:rollback-...` tag before
loading the new image. The script automatically restores that image if
recreation or health verification fails. It does not prune NAS images.
Retain the rollback image until the deployment has been accepted. Image
rollback does not roll back data; changes involving database migrations need
a separate backup and migration plan.

For a manual rollback on the NAS, select the timestamped tag reported by the
script, tag it as `lunatv:custom`, then run the existing compose configuration
with `up -d --no-deps --force-recreate lunatv`. Verify container health and
HTTP access again.

## September 2026 review

- Search requests now abort upstream work when the aggregate deadline expires
  or the client disconnects, and clean up timers and listeners after completion.
- The eight-second upstream timeout remains active while reading response
  bodies, preventing a provider from stalling indefinitely after sending headers.
- Already-cancelled downstream searches skip cache and network access.
- Regression tests cover stalled bodies, user cancellation without caching a
  provider failure, and pre-cancelled requests.
- Jest and its jsdom environment were updated together to 30.5.1 on September 10;
  all 28 regression tests pass. The previously problematic 30.4.x release is
  superseded.
- The full Docker build uses a dedicated ignore file to exclude local data,
  cookies, environment files, build outputs, and unrelated mobile app sources.
- Docker layer caching is enabled and dependency installation uses the frozen
  pnpm lockfile. pnpm is the package manager declared by this project.

These changes address unnecessary background search work and deployment
reliability. They do not establish an end-user latency improvement without
measurements against the same upstream providers and cache state.


## Previous deployment — 22 October 2026

The reviewed web build is live as `lunatv:review-fixes-20261021T205429Z` on Node 22.23.4 / Next.js 16.3.6.
Runtime and rollback evidence is recorded in
[review-remediation-deployment-2026-10-22.json](review-remediation-deployment-2026-10-22.json).
Only the LunaTV Compose image line changed; environment, Redis, volumes,
networks, port 8899 and the approved stream ports were retained.

The generic `deploy.sh` above assumes Compose uses `lunatv:custom`. The current
Compose image is a unique release tag, so this release used the image-aware,
targeted helper retained with the protected snapshots rather than that script.
For this exact release, rollback with:

```sh
ssh synology python3 /volume5/docker/.lunatv-review-20261021T205429Z/rollout.py --rollback
```

This restores the previous application image on the same patched Node version;
it does not restore or clear Redis/data. Private recovery snapshots are beside
the helper. Keep them until the release is accepted. Signed IPTV exports now
require login and expire within seven days of the issuing session. The companion
OrionTV playlist-auth change needs an app update; it is not installed by a NAS
container deployment.


## Previous deployment — 23 October 2026 playback repair

`lunatv:playback-fix-20261023` is healthy on Node 22.23.4 / Next.js 16.4.2. VOD source permissions and the server-side cover rendering failure are fixed. Real public-browser VOD and live-TV playback pass. Only LunaTV was replaced; environment, Redis, mounts, networks and other containers are preserved.

Use the image-aware helper for rollback:

```sh
ssh synology 'python3 /volume5/docker/.lunatv-playback-repair-20261023/rollout.py rollback lunatv --root /volume5/docker/.lunatv-playback-repair-20261023'
```

The rollback tag is `lunatv-playback-rollback/lunatv:20261023`; rollback retains data and reintroduces the playback defects. See [release evidence](playback-repair-2026-10-23.md).


## Previous deployment — 23 October 2026 Safari and dependencies

`lunatv:dependencies-20261023` is healthy on Node 22.23.4 / Next.js 16.4.2. It includes the native Safari HLS Range repair and 23 compatible dependency updates. Exact reported-fixture WebKit playback and 119 tests pass; configuration/data/other services are retained.

Immediate rollback retains the Safari fix:

```sh
ssh synology 'python3 /volume5/docker/.lunatv-dependencies-20261023/rollout.py rollback lunatv --root /volume5/docker/.lunatv-dependencies-20261023'
```

Use the image-aware helper; generic `deploy.sh` assumes another tag. See [release receipt and pnpm 12 bootstrap](safari-dependency-release-2026-10-23.md).


## Current deployment — 23 October 2026 mobile Pause label

`lunatv:pause-fix-20261023` is healthy and removes the duplicate mobile playback overlay. Custom play/pause and rotated fullscreen pass on the exact public video page in mobile WebKit. Existing Safari/dependency fixes and application configuration/data are retained; only LunaTV changed.

Immediate rollback: `lunatv-pause-rollback/lunatv:20261023`. Use:

```sh
ssh synology 'python3 /volume5/docker/.lunatv-pause-fix-20261023/rollout.py rollback lunatv --root /volume5/docker/.lunatv-pause-fix-20261023'
```

See [release verification and recovery](pause-label-release-2026-10-23.md).
