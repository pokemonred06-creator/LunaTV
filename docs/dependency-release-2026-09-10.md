# Dependency update and Synology release — 10 September 2026

Updated 26 direct web-project dependencies within their existing major versions. ESLint 9 and TypeScript 5 remain in place; their major migrations were excluded from this release. The Android TV companion was not changed.

## Deployed state

- Service: LunaTV at https://tv.fishred.duckdns.org.
- Image: `sha256:5cc52749f3cd6217e14742eb3b23cef094a6b5b0118d80230af12ca4b55b13f9`.
- Rollback: `lunatv:rollback-20260910T091139Z`.
- Runtime: Node.js 22.23.2, Next.js 16.3.4; React 19.3.0 in the build.
- Container is running and healthy. Redis image and persistent data were retained.
- Docker build refreshes base images with `--pull` and uses the frozen pnpm lockfile.
- Existing working-tree changes, including the earlier audit fixes, were included.
- Docker Desktop was stopped on the Mac after successful deployment; its app/backend processes are no longer running.

## Verification

- TypeScript, repository-wide lint, and all 28 tests passed. Jest/jsdom 30.5.1 is working.
- Production dependency registry audit: zero reported vulnerabilities (222 dependency entries).
- Both dependency lockfiles match the updated manifest.
- The linux/amd64 Docker production build, its TypeScript check, and all 41 static-page builds passed.
- NAS smoke checks: login page 200; unauthenticated search 401; owner login 200; authenticated home, empty search, and server-config 200.
- Public HTTPS login: 200, valid TLS. Full playback and real-provider searches were not exercised.

## Dependency changes

| Package                          | Before   | After    |
| -------------------------------- | -------- | -------- |
| @upstash/redis                   | ^1.38.2  | ^1.38.4  |
| framer-motion                    | ^13.1.1  | ^13.2.0  |
| hls.js                           | ^1.7.1   | ^1.7.2   |
| lucide-react                     | ^1.33.0  | ^1.44.0  |
| next                             | 16.3.3   | 16.3.4   |
| opencc-js                        | ^1.4.1   | ^1.4.2   |
| react                            | ^19.2.8  | ^19.3.0  |
| react-dom                        | ^19.2.8  | ^19.3.0  |
| swiper                           | ^14.1.0  | ^14.2.0  |
| zod                              | ^4.4.3   | ^4.6.1   |
| @eslint/eslintrc                 | ^3.3.6   | ^3.3.7   |
| @next/eslint-plugin-next         | 16.3.3   | 16.3.4   |
| @playwright/test                 | ^1.62.1  | ^1.63.0  |
| @testing-library/react           | ^16.3.2  | ^16.3.3  |
| @types/react                     | ^19.2.18 | ^19.3.0  |
| @types/react-dom                 | ^19.2.4  | ^19.3.0  |
| @typescript-eslint/eslint-plugin | ^8.67.0  | ^8.70.0  |
| @typescript-eslint/parser        | ^8.67.0  | ^8.70.0  |
| autoprefixer                     | ^10.5.4  | ^10.5.5  |
| eslint-config-next               | 16.3.3   | 16.3.4   |
| globals                          | ^17.11.0 | ^17.12.0 |
| jest                             | ^30.2.0  | ^30.5.1  |
| jest-environment-jsdom           | ^30.2.0  | ^30.5.1  |
| lint-staged                      | ^17.3.0  | ^17.5.0  |
| postcss                          | ^8.5.26  | ^8.5.28  |
| typescript-eslint                | ^8.67.0  | ^8.70.0  |
