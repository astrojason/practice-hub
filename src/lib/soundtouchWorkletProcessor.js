/*
 * AudioWorkletProcessor wrapper around the same SoundTouch/SimpleFilter DSP
 * pipeline soundtouch.js's old ScriptProcessorNode-based PitchShifter used —
 * reused verbatim (zero Web Audio API dependencies in the DSP classes
 * themselves), just driven from the audio rendering thread instead of the
 * main thread. See soundtouch.js's PitchShifterWorklet for the main-thread
 * wrapper this pairs with, and the plan doc for why: ScriptProcessorNode is
 * a well-documented source of extra (200-300ms-plausible) latency that
 * AudioWorkletNode avoids by running directly on the audio thread.
 */
import { SoundTouch, SimpleFilter } from "./soundtouch.js";

// AudioBuffer.getChannelData() isn't available inside the worklet global
// scope (and AudioBuffer itself isn't structured-cloneable across the
// port), so the main thread transfers plain Float32Array channel data
// instead. This mirrors WebAudioBufferSource's extract() contract exactly.
class WorkletBufferSource {
  constructor(left, right) {
    this.left = left;
    this.right = right;
    this._position = 0;
  }
  get position() {
    return this._position;
  }
  set position(value) {
    this._position = value;
  }
  extract(target, numFrames = 0, position = 0) {
    this.position = position;
    const left = this.left;
    const right = this.right;
    let i = 0;
    for (; i < numFrames; i++) {
      target[i * 2] = left[i + position] ?? 0;
      target[i * 2 + 1] = right[i + position] ?? 0;
    }
    return Math.min(numFrames, Math.max(0, left.length - position));
  }
}

// The Web Audio spec fixes the render quantum at 128 frames — process() is
// called once per quantum and must return exactly that many frames.
const QUANTUM_FRAMES = 128;
// Position updates are throttled (not sent every ~2.9ms quantum) since the
// cursor's actual accuracy comes from ctx.currentTime tracking the audio
// thread tightly now, not from high-frequency position messages — those
// only matter for seek/UI-sync precision. ~20 quanta is ~60ms at 44.1kHz.
const POSITION_REPORT_INTERVAL_QUANTA = 20;

class SoundTouchProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();
    this._soundtouch = new SoundTouch();
    this._filter = null;
    this._scratch = new Float32Array(QUANTUM_FRAMES * 2);
    this._quantaSinceReport = 0;

    const opts = (options && options.processorOptions) || {};
    if (opts.left && opts.right) {
      this._load(opts.left, opts.right);
    }

    this.port.onmessage = (event) => {
      const msg = event.data;
      switch (msg.type) {
        case "load":
          this._load(msg.left, msg.right);
          break;
        case "tempo":
          this._soundtouch.tempo = msg.value;
          break;
        case "pitch":
          this._soundtouch.pitch = msg.value;
          break;
        case "seek":
          if (this._filter) this._filter.sourcePosition = msg.sourcePosition;
          break;
      }
    };
  }

  _load(left, right) {
    const source = new WorkletBufferSource(left, right);
    this._filter = new SimpleFilter(source, this._soundtouch, () => {
      this.port.postMessage({ type: "ended" });
    });
  }

  process(_inputs, outputs) {
    const output = outputs[0];
    if (!this._filter || !output || output.length < 2) {
      return true;
    }

    const framesExtracted = this._filter.extract(this._scratch, QUANTUM_FRAMES);
    // Matches the old getWebAudioNode's onaudioprocess: extract() itself
    // doesn't call onEnd — the caller must, when nothing more comes out.
    if (framesExtracted === 0) {
      this._filter.onEnd();
    }

    const left = output[0];
    const right = output[1];
    for (let i = 0; i < QUANTUM_FRAMES; i++) {
      left[i] = i < framesExtracted ? this._scratch[i * 2] : 0;
      right[i] = i < framesExtracted ? this._scratch[i * 2 + 1] : 0;
    }

    this._quantaSinceReport++;
    if (this._quantaSinceReport >= POSITION_REPORT_INTERVAL_QUANTA) {
      this._quantaSinceReport = 0;
      this.port.postMessage({ type: "position", sourcePosition: this._filter.sourcePosition });
    }

    return true;
  }
}

registerProcessor("soundtouch-processor", SoundTouchProcessor);
