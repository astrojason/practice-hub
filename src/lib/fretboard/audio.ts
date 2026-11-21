// Plucked-string audio for the Fretboard Trainer (Karplus-Strong synthesis on
// the Web Audio API). Later phases add scheduling, SoundFonts and effects on
// top of this.

let ctx: AudioContext | null = null;
let master: GainNode | null = null;
const cache = new Map<number, AudioBuffer>();

function context(): AudioContext {
  if (!ctx) {
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) throw new Error("This webview has no Web Audio support, so notes cannot be played.");
    ctx = new Ctor();
    master = ctx.createGain();
    master.gain.value = 0.7;
    master.connect(ctx.destination);
  }
  if (ctx.state === "suspended") void ctx.resume();
  return ctx;
}

export function midiToHz(midi: number): number {
  return 440 * Math.pow(2, (midi - 69) / 12);
}

/** A plucked string: a burst of noise circulating through a damped delay line. */
function pluckBuffer(c: AudioContext, midi: number): AudioBuffer {
  const hit = cache.get(midi);
  if (hit) return hit;
  const sr = c.sampleRate;
  const period = Math.max(2, Math.round(sr / midiToHz(midi)));
  const seconds = 3;
  const buf = c.createBuffer(1, sr * seconds, sr);
  const data = buf.getChannelData(0);
  const line = new Float32Array(period);
  let seed = midi * 7919 + 1;
  for (let i = 0; i < period; i++) {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    line[i] = (seed / 0xffffffff) * 2 - 1;
  }
  // Higher notes ring a little less so the tone stays even across the neck.
  const decay = 0.9985 - Math.min(0.0015, midi * 0.00001);
  let p = 0;
  for (let i = 0; i < data.length; i++) {
    const next = (p + 1) % period;
    const v = line[p];
    data[i] = v;
    line[p] = (v + line[next]) * 0.5 * decay;
    p = next;
  }
  cache.set(midi, buf);
  return buf;
}

/** Play one note now (or `delay` seconds from now). Throws if audio cannot start. */
export function playNote(midi: number, delay = 0, volume = 1): void {
  const c = context();
  const src = c.createBufferSource();
  src.buffer = pluckBuffer(c, midi);
  const g = c.createGain();
  const t = c.currentTime + delay;
  g.gain.setValueAtTime(volume, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + 2.8);
  src.connect(g).connect(master as GainNode);
  src.start(t);
  src.stop(t + 3);
}

/** Strum several notes low to high. */
export function strum(midis: number[], gap = 0.035): void {
  midis.forEach((m, i) => playNote(m, i * gap, 0.85));
}
