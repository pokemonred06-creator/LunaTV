# Approved stream-port exception — applied 8 October 2026

The user explicitly approved ports **98, 2096 and 14311**. The live NAS service now has `PROXY_ALLOWED_PORTS=98,2096,14311`. Container health and the exact environment value were verified after recreating only LunaTV with the same deployed image (`sha256:56f1e63246ff5a6c438d662ea39583aac9e3e4e21776a54fcee9b271ed122f92`).

Only one environment line was added to the LunaTV service in `/volume5/docker/docker-compose.yml`. Backup: `/volume5/docker/docker-compose.yml.bak-lunatv-ports-20261008T205849`. Redis, data mounts and all other configuration were retained. Source defaults also include these ports for future builds.

The NAS audit observed configured channels redirecting to these public stream endpoints:

| Endpoint | Port |
| --- | --- |
| `http://1.14.99.136:98` | 98 |
| `https://php.jdshipin.com:2096` | 2096 |
| `http://httplive.slave.bfgd.com.cn:14311` | 14311 |

The approved setting adds `98`, `2096`, and `14311` to the proxy's public-port allowlist. It permits public destinations on these ports, including destinations other than the three above. Existing DNS, private-address, localhost, protocol, credential, and redirect validation remains active. It does not guarantee that a provider will accept playback requests.

The initial port change was held by automatic approval review until explicit user authorization. After approval, the full build/deploy command was rejected because it would deploy the entire dirty working tree. The approved ports were instead applied through the existing runtime setting without deploying unrelated code.

Read-only direct probes on 8 October also encountered a connection failure on port 98, HTTP 403 on port 2096, and HTTP 404 on port 14311. These sampled requests did not reproduce the full player header/redirect context. Allowing a port removes the proxy's port rejection; provider availability or access restrictions may still prevent playback.

Type checking, web lint and all **43 tests** passed, including approved-port redirects and retained private-address/credential restrictions. Public HTTPS checks confirmed private addresses and an unapproved port still return `Blocked upstream target`, while approved-port requests proceed to upstream fetching. The direct sample requests returned fetch failures on 98 and 14311 and upstream HTTP 400 on 2096.

The focused public-site audit retested **100** channels identified in earlier port-block logs: **16 delivered media**, **84 failed**. This includes a first HLS media segment, not decoding certification for every channel. Failures: 66 HTTP 502 fetch failures, 11 client timeouts, 4 upstream 404, 2 upstream 403 and 1 remaining target-policy block. The earlier 1,225-channel snapshot was not rerun and should not be recomputed by adding these successes.

Real public-browser playback was confirmed for newly unblocked **明珠台** (`github.com/suxuang/myIPTV-559`): 1920×1080, 7,555 decoded frames at 175 seconds, ready state 4 and no video-element error. [Playback screenshot](../output/playwright/live-port-recovered-pearl-20261008.png).

**翡翠台** (`github.com/suxuang/myIPTV-556`) returned MPEG-TS data but did not decode in this browser test; compatibility mode also failed. Media-tool diagnostics found an HLS segment-extension restriction. An isolated test relaxing those decoder options did not produce a complete output segment within 45 seconds, so no unverified decoder change was deployed. Some sources serve real TS/fMP4 bytes with `image/jpeg` headers; the MIME header alone must not be treated as proof that a stream is an image or invalid. These results do not establish that all 16 media responses are playable.

[Affected-channel results](live-approved-ports-audit-2026-10-08.json) · [Live policy checks](live-port-policy-check-2026-10-08.json)

To roll back only this port approval, remove the `PROXY_ALLOWED_PORTS=98,2096,14311` environment line from the LunaTV service and recreate only `lunatv` with `--no-deps --pull never --force-recreate`. Restoring the entire Compose backup could overwrite later changes. The source defaults would also need reverting before a future build if the port approval is withdrawn.
