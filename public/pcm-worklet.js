// AudioWorklet: downmixes the captured tab audio to mono, resamples it to
// 16 kHz on the audio thread and posts 16-bit PCM blocks (50 ms) with their
// level. Doing this here means the recorder only ever holds 16 kHz 16-bit
// audio — about 6x less memory than 48 kHz float — and never copies it again
// before encoding.
const TARGET_RATE = 16000;
const BLOCK = 800; // 50 ms at 16 kHz

class PcmCapture extends AudioWorkletProcessor {
  constructor() {
    super();
    // `sampleRate` is the context's rate (usually 48 kHz, sometimes 44.1 kHz).
    this.ratio = sampleRate / TARGET_RATE;
    this.acc = 0; // box-filter accumulator: averaging also low-passes
    this.count = 0;
    this.pos = 0;
    this.block = new Int16Array(BLOCK);
    this.len = 0;
    this.sumSq = 0;
  }

  process(inputs) {
    const input = inputs[0];
    if (!input || input.length === 0) return true;
    const left = input[0];
    const right = input[1];
    for (let i = 0; i < left.length; i++) {
      this.acc += right ? (left[i] + right[i]) * 0.5 : left[i];
      this.count++;
      if (++this.pos < this.ratio) continue;
      this.pos -= this.ratio;
      const v = this.acc / this.count;
      this.acc = 0;
      this.count = 0;
      this.sumSq += v * v;
      const s = v < -1 ? -1 : v > 1 ? 1 : v;
      this.block[this.len++] = s < 0 ? s * 0x8000 : s * 0x7fff;
      if (this.len === BLOCK) {
        this.port.postMessage({ pcm: this.block, level: Math.sqrt(this.sumSq / BLOCK) }, [this.block.buffer]);
        this.block = new Int16Array(BLOCK);
        this.len = 0;
        this.sumSq = 0;
      }
    }
    return true;
  }
}

registerProcessor('pcm-capture', PcmCapture);
