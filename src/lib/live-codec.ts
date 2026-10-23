interface LiveRenditionAttributes {
  CODECS?: string;
}

// HLS can silently discard an unsupported video track and keep playing audio.
// Only fall back when a video codec is advertised and MSE rejects that codec.
export function needsLiveCodecCompatibility(
  attributes: LiveRenditionAttributes | undefined,
  videoWidth: number,
  isTypeSupported: (mime: string) => boolean,
): boolean {
  if (videoWidth > 0) return false;
  const videoCodec = attributes?.CODECS?.split(',')
    .map((codec) => codec.trim())
    .find((codec) => /^(avc[13]|hev1|hvc1|vp09|av01)\./i.test(codec));
  return !!videoCodec && !isTypeSupported(`video/mp4; codecs="${videoCodec}"`);
}
