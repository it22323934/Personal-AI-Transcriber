// Audio helpers for the offscreen recorder. The worklet already delivers
// 16 kHz mono 16-bit PCM, so a chunk is encoded with a single allocation.

/** Largest absolute sample across the blocks (0–32768). */
export function peak(blocks: Int16Array[]): number {
  let max = 0;
  for (const b of blocks) {
    for (let i = 0; i < b.length; i++) {
      const v = b[i] < 0 ? -b[i] : b[i];
      if (v > max) max = v;
    }
  }
  return max;
}

/** Gain that lifts quiet recordings to a healthy level for the transcriber (max ×4). */
export function normalizeGain(peakValue: number): number {
  if (peakValue === 0 || peakValue >= 16384) return 1;
  return Math.min(4, 29491 / peakValue); // 29491 ≈ 0.9 of full scale
}

/**
 * 16-bit mono PCM WAV written straight into one buffer (~1.9 MB per minute at
 * 16 kHz). Int16Array uses the platform's byte order, which is little-endian
 * on every platform Chrome runs on — the order WAV requires.
 */
export function encodeWav(blocks: Int16Array[], length: number, sampleRate: number, gain = 1): Blob {
  const bytes = length * 2;
  const buffer = new ArrayBuffer(44 + bytes);
  const view = new DataView(buffer);
  const ascii = (offset: number, s: string) => {
    for (let i = 0; i < s.length; i++) view.setUint8(offset + i, s.charCodeAt(i));
  };
  ascii(0, 'RIFF');
  view.setUint32(4, 36 + bytes, true);
  ascii(8, 'WAVE');
  ascii(12, 'fmt ');
  view.setUint32(16, 16, true); // fmt chunk size
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true); // byte rate
  view.setUint16(32, 2, true); // block align
  view.setUint16(34, 16, true); // bits per sample
  ascii(36, 'data');
  view.setUint32(40, bytes, true);

  const out = new Int16Array(buffer, 44, length);
  let o = 0;
  for (const b of blocks) {
    if (gain === 1) {
      out.set(b, o);
    } else {
      for (let i = 0; i < b.length; i++) {
        const v = b[i] * gain;
        out[o + i] = v > 32767 ? 32767 : v < -32768 ? -32768 : v;
      }
    }
    o += b.length;
  }
  return new Blob([buffer], { type: 'audio/wav' });
}
