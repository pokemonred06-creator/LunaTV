import { NextRequest, NextResponse } from 'next/server';

import { getAuthInfoFromCookie } from '@/lib/auth/server';
import { getAvailableLiveSources } from '@/lib/config';
import { getCachedLiveChannels } from '@/lib/live';
import { getLiveRelay, readLiveRelay } from '@/lib/live-relay';
import { guessLiveStreamType } from '@/lib/live-stream';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const auth = await getAuthInfoFromCookie(request);
  if (!auth?.username) return new NextResponse('Unauthorized', { status: 401 });
  const allowedSources = (await getAvailableLiveSources(auth.username)).map(
    (s) => s.key,
  );
  const query = request.nextUrl.searchParams;
  let session = query.get('session');
  const file = query.get('file') || 'index.m3u8';
  try {
    if (!session) {
      const source = query.get('source') || '';
      const channelId = query.get('channel') || '';
      if (!allowedSources.includes(source))
        return new NextResponse('Forbidden', { status: 403 });
      const data = await getCachedLiveChannels(source);
      const channel = data?.channels.find(
        (channel) => channel.id === channelId,
      );
      if (!channel)
        return new NextResponse('Channel not found', { status: 404 });
      const port = Number(process.env.PORT || request.nextUrl.port || 3000);
      const input = new URL(
        `/api/proxy/${guessLiveStreamType(channel.url)}`,
        `http://127.0.0.1:${port}`,
      );
      input.search = new URLSearchParams({
        url: channel.url,
        'moontv-source': source,
        'moontv-channel': channel.id,
      }).toString();
      // FFmpeg reads through our local proxy; each upstream redirect/segment stays validated.
      session = await getLiveRelay(
        JSON.stringify([auth.username, source, channelId]),
        input.toString(),
        request.headers.get('cookie') || '',
      );
    }
    const data = await readLiveRelay(
      session,
      file,
      auth.username,
      allowedSources,
    );
    if (!data)
      return new NextResponse('Relay expired or segment unavailable', {
        status: 404,
      });
    if (file === 'index.m3u8') {
      const manifest = data
        .toString()
        .replace(
          /^segment-(\d+)\.ts$/gm,
          (name) =>
            `/api/live/relay?session=${encodeURIComponent(session!)}&file=${name}`,
        );
      return new NextResponse(manifest, {
        headers: {
          'content-type': 'application/vnd.apple.mpegurl',
          'cache-control': 'no-store',
        },
      });
    }
    return new NextResponse(new Uint8Array(data), {
      headers: { 'content-type': 'video/mp2t', 'cache-control': 'no-store' },
    });
  } catch (error) {
    return new NextResponse(
      error instanceof Error ? error.message : 'Compatibility playback failed',
      { status: 502 },
    );
  }
}
