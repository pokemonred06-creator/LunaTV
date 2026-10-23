import dns from 'node:dns/promises';
import net from 'node:net';
import { Agent, fetch as transportFetch } from 'undici';

import { isBlockedRemoteIp } from '@/lib/request-security';
import { isBlockedIp } from '@/lib/ssrf-guard';

// Check the addresses actually returned to the socket, not a separate preflight
// lookup. Keep the URL hostname intact for HTTP Host, TLS SNI and certificates.
export function createGuardedAgent(blocked: (address: string) => boolean) {
  return new Agent({
    connect: {
      lookup(hostname, options, callback) {
        dns.lookup(hostname, { all: true, verbatim: true }).then(
          (records) => {
            if (
              !records.length ||
              records.some((record) => blocked(record.address))
            ) {
              callback(new Error('SSRF blocked connection address'), [], 0);
              return;
            }
            const selected = options.family
              ? records.filter((record) => record.family === options.family)
              : records;
            if (!selected.length) {
              callback(new Error('No address for requested family'), [], 0);
            } else if (options.all) {
              callback(null, selected);
            } else {
              callback(null, selected[0].address, selected[0].family);
            }
          },
          (error: Error) => callback(error, [], 0),
        );
      },
    },
  });
}

const mediaAgent = createGuardedAgent(isBlockedIp);
const remoteAgent = createGuardedAgent(isBlockedRemoteIp);

export async function guardedFetch(
  input: string | URL,
  init: RequestInit = {},
  policy: 'media' | 'remote' = 'media',
): Promise<Response> {
  const url = new URL(input);
  const blocked = policy === 'remote' ? isBlockedRemoteIp : isBlockedIp;
  const hostname = url.hostname.replace(/^\[|\]$/g, '');
  if (
    !['http:', 'https:'].includes(url.protocol) ||
    url.username ||
    url.password ||
    !hostname ||
    (net.isIP(hostname) && blocked(hostname))
  ) {
    throw new Error('SSRF blocked target');
  }
  // Redirects must be checked by the caller. Never let the transport follow one
  // internally, since numeric addresses do not invoke the DNS lookup callback.
  if (init.redirect && !['manual', 'error'].includes(init.redirect)) {
    throw new Error('Guarded requests require explicit redirect handling');
  }
  const response = await transportFetch(url, {
    method: init.method,
    headers: new Headers(init.headers),
    signal: init.signal,
    redirect: init.redirect ?? 'manual',
    dispatcher: policy === 'remote' ? remoteAgent : mediaAgent,
  });
  const wrapped = new Response(
    response.body as ReadableStream<Uint8Array> | null,
    {
      status: response.status,
      statusText: response.statusText,
      headers: new Headers(Array.from(response.headers.entries())),
    },
  );
  Object.defineProperty(wrapped, 'url', { value: response.url });
  return wrapped;
}
