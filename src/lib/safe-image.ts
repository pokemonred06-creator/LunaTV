// Buffer and sniff bounded raster data. Never serve provider-controlled active MIME types.
export async function safeImageResponse(upstream: Response): Promise<Response> {
  const limit = 20 * 1024 * 1024;
  const reader = upstream.body?.getReader();
  if (!reader) return new Response('Invalid image', { status: 415 });
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > limit) {
        await reader.cancel();
        return new Response('Image too large', { status: 413 });
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const data = Buffer.concat(chunks);
  let mime = '';
  if (
    data.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
  )
    mime = 'image/png';
  else if (data[0] === 255 && data[1] === 216 && data[2] === 255)
    mime = 'image/jpeg';
  else if (/^GIF8[79]a$/.test(data.subarray(0, 6).toString('ascii')))
    mime = 'image/gif';
  else if (
    data.subarray(0, 4).toString() === 'RIFF' &&
    data.subarray(8, 12).toString() === 'WEBP'
  )
    mime = 'image/webp';
  else if (
    data.subarray(4, 8).toString() === 'ftyp' &&
    /^(avif|avis)$/.test(data.subarray(8, 12).toString())
  )
    mime = 'image/avif';
  if (!mime) return new Response('Unsupported image', { status: 415 });
  return new Response(new Uint8Array(data), {
    headers: {
      'content-type': mime,
      'content-length': String(length),
      'cache-control': 'public, max-age=86400',
      'access-control-allow-origin': '*',
      'x-content-type-options': 'nosniff',
      'content-security-policy': "sandbox; default-src 'none'",
    },
  });
}
