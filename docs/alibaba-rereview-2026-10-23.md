# Outbound connection checks — deployed23October2026

Alibaba Open Code Review v1.13.3 delegation selected files and resolved rules; Codex performed analysis. A DNS rebinding regression proves that preflight validation alone cannot protect a second lookup. Guarded Undici8.12.3 transport now validates actual socket addresses and numeric destinations, and keeps redirects explicit. Media FakeIP and approved-port policies remain intact; config subscriptions use the stricter policy. Initial non-HTTP relay targets are pinned; arbitrary FFmpeg protocol redirects/nested connections are not covered by this change.

91 tests, TypeScript, full web lint and Linux production build pass. Production audit reports no advisories. Seven isolated candidate HTTP/auth checks and23live checks pass. All1,225 IPTV entries are signed; CGTN playlist/segment returned200 with16KiB sampled. Six users/25enabled VOD sources/one live source remain; an encrypted backup was exported and decrypted without restoring data.

Release source branch: codex/alibaba-rereview-20261023, fix d8089deee7ee4bf973954225e19fbc147767611a. This separate branch snapshots previously deployed build inputs and then commits the fix, retaining the original checked-out branch/index and unrelated mixed working-tree edits. Deployed image alibaba-rereview/lunatv:20261023, config ID9af77a8d7c22, Node22.23.4/Next16.4.2. Final healthy, zero restarts/OOM.

Rollback uses /volume5/docker/.alibaba-rereview-20261023/rollout.py with the dedicated alibaba-rereview-rollback/lunatv:20261023 tag. Image-only rollback does not restore data and reintroduces the DNS gap. Full report: /Users/server/Documents/Codex/2026-10-23/alibaba-rereview/REPORT.md.
