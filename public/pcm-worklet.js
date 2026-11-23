// AudioWorklet that downmixes the captured tab audio to mono and posts it to the
// offscreen document in blocks of 2048 samples (~43 ms at 48 kHz).
const BLOCK = 2048;

class PcmCapture extends AudioWorkletProcessor {
  constructor() {
    super();
    this.buf = new Float32Array(BLOCK);
    this.len = 0;
  }

  process(inputs) {
    const input = inputs[0];
    if (input && input.length > 0) {
      const left = input[0];
      const right = input[1];
      for (let i = 0; i < left.length; i++) {
        this.buf[this.len++] = right ? (left[i] + right[i]) * 0.5 : left[i];
        if (this.len === BLOCK) {
          this.port.postMessage(this.buf, [this.buf.buffer]);
          this.buf = new Float32Array(BLOCK);
          this.len = 0;
        }
      }
    }
    return true;
  }
}

registerProcessor('pcm-capture', PcmCapture);
