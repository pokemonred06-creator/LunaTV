/* global test, expect */
import { needsLiveCodecCompatibility } from '@/lib/live-codec';

test('detects HLS video that the browser discards while continuing to play audio', () => {
  const supported = (mime) => !mime.includes('hvc1');
  expect(
    needsLiveCodecCompatibility(
      { CODECS: 'hvc1.2.4.L153.B0,mp4a.40.2' },
      0,
      supported,
    ),
  ).toBe(true);
  expect(
    needsLiveCodecCompatibility(
      { CODECS: 'avc1.640028,mp4a.40.2' },
      0,
      supported,
    ),
  ).toBe(false);
});

test('keeps playable video and audio-only HLS out of compatibility mode', () => {
  const unsupported = () => false;
  expect(
    needsLiveCodecCompatibility(
      { CODECS: 'hvc1.2.4.L153.B0' },
      1920,
      unsupported,
    ),
  ).toBe(false);
  expect(
    needsLiveCodecCompatibility({ CODECS: 'mp4a.40.2' }, 0, unsupported),
  ).toBe(false);
  expect(needsLiveCodecCompatibility(undefined, 0, unsupported)).toBe(false);
});
