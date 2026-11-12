// A pitch shifter for the attached recording: two read heads sweep a short delay line at a
// different speed than it is written, cross-fading so the joins can't be heard. It changes the
// pitch by `ratio` without changing the speed. Runs in the audio thread.

const WINDOW_SECONDS = 0.07;
const SIZE = 1 << 15;

class PitchShifter extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [{ name: 'ratio', defaultValue: 1, minValue: 0.25, maxValue: 4, automationRate: 'k-rate' }];
  }

  constructor() {
    super();
    this.window = Math.round(WINDOW_SECONDS * sampleRate);
    this.buffers = [];
    this.write = 0;
    this.phase = 0;
  }

  process(inputs, outputs, parameters) {
    const input = inputs[0];
    const output = outputs[0];
    if (!input || !input.length) return true;
    const ratio = parameters.ratio[0];
    const frames = input[0].length;
    while (this.buffers.length < input.length) this.buffers.push(new Float32Array(SIZE));
    const bypass = Math.abs(ratio - 1) < 1e-4;
    const W = this.window;
    const step = (1 - ratio) / W;
    let phase = this.phase;
    let write = this.write;
    for (let i = 0; i < frames; i++) {
      // Delays of the two heads, half a window apart, each faded in and out (sin² + cos² = 1).
      let p1 = phase;
      let p2 = phase + 0.5;
      if (p2 >= 1) p2 -= 1;
      const g1 = Math.sin(Math.PI * p1) ** 2;
      const g2 = 1 - g1;
      const d1 = 2 + p1 * W;
      const d2 = 2 + p2 * W;
      for (let c = 0; c < input.length; c++) {
        const buf = this.buffers[c];
        const x = input[c][i];
        buf[write] = x;
        if (bypass) {
          output[c][i] = x;
          continue;
        }
        output[c][i] = g1 * read(buf, write - d1) + g2 * read(buf, write - d2);
      }
      write = (write + 1) & (SIZE - 1);
      phase += step;
      phase -= Math.floor(phase);
    }
    this.phase = phase;
    this.write = write;
    return true;
  }
}

function read(buf, pos) {
  let p = pos;
  while (p < 0) p += SIZE;
  const i = Math.floor(p);
  const f = p - i;
  const a = buf[i & (SIZE - 1)];
  const b = buf[(i + 1) & (SIZE - 1)];
  return a + (b - a) * f;
}

registerProcessor('pitch-shifter', PitchShifter);
