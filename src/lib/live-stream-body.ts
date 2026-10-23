/** Inspect a bounded prefix without dropping bytes needed by the media decoder. */
export async function inspectStreamResponse(response: Response, limit = 1024) {
  const reader = response.body?.getReader();
  if (!reader) throw new Error('Empty upstream stream');
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (size < limit) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      size += value.length;
    }
  } catch (error) {
    await reader.cancel().catch(() => {});
    throw error;
  }
  const prefix = new Uint8Array(Math.min(size, limit));
  let position = 0;
  for (const chunk of chunks) {
    const part = chunk.subarray(0, prefix.length - position);
    prefix.set(part, position);
    position += part.length;
    if (position === prefix.length) break;
  }
  let index = 0;
  const body = new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        if (index < chunks.length) {
          controller.enqueue(chunks[index++]);
          return;
        }
        const { done, value } = await reader.read();
        if (done) controller.close();
        else controller.enqueue(value);
      } catch (error) {
        controller.error(error);
      }
    },
    cancel(reason) {
      return reader.cancel(reason);
    },
  });
  return { prefix, body };
}

export async function readLiveManifest(
  body: ReadableStream<Uint8Array>,
  maxBytes = 2 * 1024 * 1024,
) {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let text = '';
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > maxBytes) throw new Error('Manifest exceeds size limit');
      text += decoder.decode(value, { stream: true });
    }
    return text + decoder.decode();
  } finally {
    await reader.cancel().catch(() => {});
  }
}
