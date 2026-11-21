// Audio engine for the Fretboard Trainer, on the Web Audio API.
//
// Built-in instruments are synthesised (Karplus-Strong strings, FM keys) and
// rendered to cached buffers; real guitar samples come from a SoundFont played
// by spessasynth. Everything is scheduled against the audio clock so playback
// stays in time, and a lookahead scheduler runs sequences (scale runs, count-ins,
// metronome clicks, drums and drones).

import { WorkletSynthesizer } from "spessasynth_lib";

// ── Instruments ────────────────────────────────────────────────────────────

export interface InstrumentDef {
  id: string;
  name: string;
  kind: "string" | "fm";
  t60: number;
  damp: number;
  pick: number;
  body: number;
  drive: number;
  cab: number;
  level: number;
  fmRatio?: number;
  fmIndex?: number;
}

export const INSTRUMENTS: InstrumentDef[] = [
  { id: "steel", name: "Steel-string acoustic", kind: "string", t60: 7, damp: 0.3, pick: 0.14, body: 0.75, drive: 0, cab: 0, level: 0.95 },
  { id: "nylon", name: "Nylon classical", kind: "string", t60: 4.5, damp: 0.45, pick: 0.2, body: 0.85, drive: 0, cab: 0, level: 1.1 },
  { id: "jazz", name: "Warm jazz archtop", kind: "string", t60: 5.5, damp: 0.47, pick: 0.22, body: 0.35, drive: 0, cab: 2600, level: 1.3 },
  { id: "clean", name: "Clean electric", kind: "string", t60: 9, damp: 0.36, pick: 0.11, body: 0, drive: 0, cab: 5200, level: 1.0 },
  { id: "crunch", name: "Crunch electric", kind: "string", t60: 10, damp: 0.34, pick: 0.1, body: 0, drive: 6, cab: 3600, level: 0.6 },
  { id: "epiano", name: "Electric piano", kind: "fm", t60: 3.2, damp: 0, pick: 0, body: 0, drive: 0, cab: 0, level: 0.75, fmRatio: 1, fmIndex: 2.2 },
  { id: "mallets", name: "Soft mallets (vibes)", kind: "fm", t60: 2.6, damp: 0, pick: 0, body: 0, drive: 0, cab: 0, level: 0.7, fmRatio: 4, fmIndex: 0.9 },
];

export interface SoundSettings {
  /** An INSTRUMENTS id, or "sf" to use a SoundFont preset. */
  instrument: string;
  /** SoundFont id ("bundled" or an added file's name) and the preset's [bank, program]. */
  soundFont: string;
  preset: [number, number];
  volume: number;
  reverb: number;
  /** 0 warm and dark, 1 bright. */
  brightness: number;
  fingers: boolean;
  droneVolume: number;
  drumVolume: number;
}

export const DEFAULT_SOUND: SoundSettings = {
  instrument: "steel",
  soundFont: "bundled",
  preset: [0, 25],
  volume: 0.8,
  reverb: 0.2,
  brightness: 0.55,
  fingers: false,
  droneVolume: 0.35,
  drumVolume: 0.7,
};

export interface SoundFontPreset {
  name: string;
  bank: number;
  program: number;
  guitar: boolean;
}

export const midiToHz = (midi: number) => 440 * Math.pow(2, (midi - 69) / 12);

// ── Sequences ──────────────────────────────────────────────────────────────

export type SeqKind =
  | { type: "note"; midi: number; string: number; velocity?: number; highlight?: string }
  | { type: "click"; accent: boolean }
  | { type: "drum"; note: number; velocity?: number }
  | { type: "marker"; code: string };

export interface SeqEvent {
  /** Seconds from the start of the sequence. */
  time: number;
  kind: SeqKind;
}

export interface SeqOptions {
  events: SeqEvent[];
  /** Length of one pass in seconds. When `loop` is set, playback wraps here. */
  length: number;
  loop: boolean;
  /** Where each loop restarts from (so a count-in plays only once). */
  loopFrom?: number;
  onHighlight?: (code: string | null) => void;
  onMarker?: (code: string) => void;
  /** Called each time the sequence wraps round to loop again. */
  onLoop?: () => void;
  onEnd?: () => void;
}

class Engine {
  ctx: AudioContext | null = null;
  private master!: GainNode;
  private tone!: BiquadFilterNode;
  private dry!: GainNode;
  private wet!: GainNode;
  private reverbNode!: ConvolverNode;
  private droneBus!: GainNode;
  private sf: WorkletSynthesizer | null = null;
  private sfPreset: [number, number] | null = null;
  private noiseBuf: AudioBuffer | null = null;
  private bufferCache = new Map<string, AudioBuffer>();
  private lastVoice = new Map<number, GainNode>();
  private settings: SoundSettings = { ...DEFAULT_SOUND };
  private droneNodes: { osc: OscillatorNode; gain: GainNode }[] = [];
  private seq: SeqOptions | null = null;
  private timer: number | null = null;
  private raf: number | null = null;
  private pendingHighlights: { at: number; code: string | null }[] = [];
  private cursor = { index: 0, base: 0, start: 0 };
  private endAt = 0;
  /** Set when the audio device changes or stops, so the UI can say so. */
  onProblem: ((message: string) => void) | null = null;

  // ── Setup ────────────────────────────────────────────────────────────────

  private ensure(): AudioContext {
    if (!this.ctx) {
      const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) throw new Error("This webview has no Web Audio support, so nothing can be played.");
      const ctx = new Ctor({ latencyHint: "interactive" });
      this.ctx = ctx;
      this.master = ctx.createGain();
      this.tone = ctx.createBiquadFilter();
      this.tone.type = "lowpass";
      this.tone.Q.value = 0.5;
      this.dry = ctx.createGain();
      this.wet = ctx.createGain();
      this.reverbNode = ctx.createConvolver();
      this.reverbNode.buffer = this.impulse(ctx, 1.8);
      this.droneBus = ctx.createGain();
      this.tone.connect(this.dry).connect(this.master);
      this.tone.connect(this.reverbNode).connect(this.wet).connect(this.master);
      this.droneBus.connect(this.master);
      this.master.connect(ctx.destination);
      this.applySettings();
      ctx.onstatechange = () => {
        if (ctx.state === "interrupted" || ctx.state === "closed") this.onProblem?.(`The audio output stopped (${ctx.state}). Press Play again to reconnect.`);
      };
    }
    if (this.ctx.state === "suspended") void this.ctx.resume();
    return this.ctx;
  }

  private impulse(ctx: AudioContext, seconds: number): AudioBuffer {
    const len = Math.floor(ctx.sampleRate * seconds);
    const buf = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let c = 0; c < 2; c++) {
      const d = buf.getChannelData(c);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3);
    }
    return buf;
  }

  private noise(ctx: AudioContext): AudioBuffer {
    if (!this.noiseBuf) {
      const len = ctx.sampleRate;
      this.noiseBuf = ctx.createBuffer(1, len, ctx.sampleRate);
      const d = this.noiseBuf.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    }
    return this.noiseBuf;
  }

  configure(s: SoundSettings) {
    const instrumentChanged = s.instrument !== this.settings.instrument || s.fingers !== this.settings.fingers;
    this.settings = { ...s };
    if (instrumentChanged) this.bufferCache.clear();
    if (this.ctx) this.applySettings();
  }

  private applySettings() {
    const ctx = this.ctx;
    if (!ctx) return;
    const s = this.settings;
    const t = ctx.currentTime;
    this.master.gain.setTargetAtTime(s.volume, t, 0.02);
    this.tone.frequency.setTargetAtTime(900 * Math.pow(18, s.brightness), t, 0.02);
    this.wet.gain.setTargetAtTime(s.reverb * 1.2, t, 0.02);
    this.dry.gain.setTargetAtTime(1 - s.reverb * 0.3, t, 0.02);
    this.droneBus.gain.setTargetAtTime(s.droneVolume * 0.5, t, 0.05);
  }

  // ── SoundFont ────────────────────────────────────────────────────────────

  /** Load a SoundFont (bytes) as the sample source. Resolves with its presets. */
  async loadSoundFont(data: ArrayBuffer, id: string): Promise<SoundFontPreset[]> {
    const ctx = this.ensure();
    if (!this.sf) {
      await ctx.audioWorklet.addModule(`${import.meta.env.BASE_URL}spessasynth_processor.min.js`);
      this.sf = new WorkletSynthesizer(ctx);
      this.sf.connect(this.tone);
      await this.sf.isReady;
    }
    const sf = this.sf;
    for (const existing of sf.soundBankManager.priorityOrder) await sf.soundBankManager.deleteSoundBank(existing);
    await sf.soundBankManager.addSoundBank(data, id);
    await sf.isReady;
    // Presets arrive asynchronously after the bank is added.
    await new Promise((r) => setTimeout(r, 150));
    this.sfPreset = null;
    return sf.presetList
      .filter((p) => !p.isDrum)
      .map((p) => ({
        name: p.name.trim(),
        bank: p.bankMSB,
        program: p.program,
        guitar: p.bankMSB === 0 && p.program >= 24 && p.program <= 31,
      }));
  }

  get soundFontReady(): boolean {
    return this.sf !== null && this.sf.soundBankManager.priorityOrder.length > 0;
  }

  private useSoundFont(): boolean {
    return this.settings.instrument === "sf" && this.soundFontReady;
  }

  private selectPreset() {
    if (!this.sf) return;
    const [bank, program] = this.settings.preset;
    if (this.sfPreset && this.sfPreset[0] === bank && this.sfPreset[1] === program) return;
    this.sf.controllerChange(0, 0, bank);
    this.sf.programChange(0, program);
    this.sfPreset = [bank, program];
  }

  // ── Voices ───────────────────────────────────────────────────────────────

  private stringBuffer(ctx: AudioContext, inst: InstrumentDef, midi: number): AudioBuffer {
    const key = `${inst.id}:${midi}:${this.settings.fingers}`;
    const hit = this.bufferCache.get(key);
    if (hit) return hit;
    const sr = ctx.sampleRate;
    const seconds = Math.min(inst.t60, 6);
    const buf = ctx.createBuffer(1, Math.floor(sr * seconds), sr);
    const data = buf.getChannelData(0);
    const hz = midiToHz(midi);

    if (inst.kind === "fm") {
      const ratio = inst.fmRatio ?? 1;
      const index = inst.fmIndex ?? 1;
      for (let i = 0; i < data.length; i++) {
        const t = i / sr;
        const env = Math.exp((-6.9 * t) / inst.t60);
        const mod = Math.sin(2 * Math.PI * hz * ratio * t) * index * Math.exp(-3 * t);
        data[i] = Math.sin(2 * Math.PI * hz * t + mod) * env * 0.6;
      }
    } else {
      const period = Math.max(2, Math.round(sr / hz));
      const line = new Float32Array(period);
      let seed = midi * 7919 + 13;
      let prev = 0;
      // Fingers give a softer, duller pluck; a pick a brighter one.
      const soften = this.settings.fingers ? 0.55 : 0.15 + inst.pick;
      for (let i = 0; i < period; i++) {
        seed = (seed * 1664525 + 1013904223) >>> 0;
        const n = (seed / 0xffffffff) * 2 - 1;
        prev = prev * soften + n * (1 - soften);
        line[i] = prev;
      }
      // Loss per pass chosen so the string rings for about t60 seconds.
      const passes = (hz * inst.t60);
      const loss = Math.pow(0.001, 1 / Math.max(passes, 1));
      const blend = 0.5 - inst.damp * 0.12;
      let p = 0;
      for (let i = 0; i < data.length; i++) {
        const next = (p + 1) % period;
        const v = line[p];
        data[i] = v;
        line[p] = (v * blend + line[next] * (1 - blend)) * loss * 1.0;
        p = next;
      }
      const fade = Math.floor(sr * 0.05);
      for (let i = 0; i < fade; i++) data[data.length - 1 - i] *= i / fade;
    }
    this.bufferCache.set(key, buf);
    return buf;
  }

  private driveCurve(amount: number): Float32Array {
    const n = 1024;
    const c = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const x = (i / (n - 1)) * 2 - 1;
      c[i] = Math.tanh(x * amount) / Math.tanh(amount);
    }
    return c;
  }

  /** Sound one note at audio time `when` (seconds, audio clock). */
  noteAt(midi: number, when: number, velocity = 0.85, string = -1): void {
    const ctx = this.ensure();
    const t = Math.max(when, ctx.currentTime);
    if (this.useSoundFont()) {
      this.selectPreset();
      const vel = Math.round(Math.min(1, velocity) * 127);
      this.sf!.noteOn(0, midi, vel, { time: t });
      this.sf!.noteOff(0, midi, { time: t + 2.4 });
      return;
    }
    const inst = INSTRUMENTS.find((i) => i.id === this.settings.instrument) ?? INSTRUMENTS[0];
    const src = ctx.createBufferSource();
    src.buffer = this.stringBuffer(ctx, inst, midi);
    const g = ctx.createGain();
    g.gain.setValueAtTime(velocity * inst.level, t);
    // A new note on the same string stops the previous one, as a real string would.
    if (string >= 0) {
      const prev = this.lastVoice.get(string);
      if (prev) {
        prev.gain.cancelScheduledValues(t);
        prev.gain.setTargetAtTime(0, t, 0.015);
      }
      this.lastVoice.set(string, g);
    }
    let node: AudioNode = src;
    if (inst.drive > 0) {
      const ws = ctx.createWaveShaper();
      ws.curve = this.driveCurve(inst.drive) as Float32Array<ArrayBuffer>;
      node.connect(ws);
      node = ws;
    }
    if (inst.cab > 0) {
      const lp = ctx.createBiquadFilter();
      lp.type = "lowpass";
      lp.frequency.value = inst.cab;
      node.connect(lp);
      node = lp;
    }
    if (inst.body > 0) {
      const pk = ctx.createBiquadFilter();
      pk.type = "peaking";
      pk.frequency.value = 110;
      pk.gain.value = inst.body * 5;
      node.connect(pk);
      node = pk;
    }
    node.connect(g).connect(this.tone);
    src.start(t);
    src.stop(t + src.buffer.duration);
  }

  /** Play a note now. */
  pluck(midi: number, string = -1, velocity = 0.85): void {
    this.noteAt(midi, 0, velocity, string);
  }

  strumNow(notes: { midi: number; string: number }[], gap = 0.035): void {
    const ctx = this.ensure();
    notes.forEach((n, i) => this.noteAt(n.midi, ctx.currentTime + i * gap, 0.8, n.string));
  }

  clickAt(when: number, accent: boolean): void {
    const ctx = this.ensure();
    const t = Math.max(when, ctx.currentTime);
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.frequency.value = accent ? 1760 : 1175;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(accent ? 0.6 : 0.4, t + 0.002);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.05);
    osc.connect(g).connect(this.master);
    osc.start(t);
    osc.stop(t + 0.06);
  }

  /** A drum hit by General MIDI drum number (36 kick, 38 snare, 42 closed hat, 46 open hat...). */
  drumAt(note: number, when: number, velocity = 0.8): void {
    const ctx = this.ensure();
    const t = Math.max(when, ctx.currentTime);
    const vol = velocity * this.settings.drumVolume;
    const out = ctx.createGain();
    out.gain.value = vol;
    out.connect(this.master);
    const burst = (type: BiquadFilterType, freq: number, len: number, level: number) => {
      const src = ctx.createBufferSource();
      src.buffer = this.noise(ctx);
      const f = ctx.createBiquadFilter();
      f.type = type;
      f.frequency.value = freq;
      const g = ctx.createGain();
      g.gain.setValueAtTime(level, t);
      g.gain.exponentialRampToValueAtTime(0.0001, t + len);
      src.connect(f).connect(g).connect(out);
      src.start(t);
      src.stop(t + len + 0.02);
    };
    const tone = (from: number, to: number, len: number, level: number) => {
      const osc = ctx.createOscillator();
      osc.frequency.setValueAtTime(from, t);
      osc.frequency.exponentialRampToValueAtTime(to, t + len);
      const g = ctx.createGain();
      g.gain.setValueAtTime(level, t);
      g.gain.exponentialRampToValueAtTime(0.0001, t + len);
      osc.connect(g).connect(out);
      osc.start(t);
      osc.stop(t + len + 0.02);
    };
    if (note === 35 || note === 36) tone(150, 45, 0.28, 1.1);
    else if (note === 38 || note === 40) {
      tone(220, 140, 0.12, 0.45);
      burst("highpass", 1800, 0.18, 0.7);
    } else if (note === 37) {
      tone(800, 600, 0.03, 0.5);
      burst("highpass", 3000, 0.04, 0.4);
    } else if (note === 42 || note === 44) burst("highpass", 7000, 0.05, 0.5);
    else if (note === 46) burst("highpass", 7000, 0.3, 0.45);
    else if (note === 51 || note === 59) burst("highpass", 6000, 0.6, 0.3);
    else if (note === 49 || note === 57) burst("highpass", 4500, 1.0, 0.5);
    else if (note >= 41 && note <= 50) tone(60 + (note - 41) * 14, 40 + (note - 41) * 8, 0.3, 0.8);
    else burst("highpass", 5000, 0.08, 0.4);
  }

  // ── Drone ────────────────────────────────────────────────────────────────

  /** Hold these notes softly under the playing, or let the drone fade (null). */
  drone(midis: number[] | null): void {
    const ctx = this.ensure();
    const t = ctx.currentTime;
    for (const d of this.droneNodes) {
      d.gain.gain.cancelScheduledValues(t);
      d.gain.gain.setTargetAtTime(0, t, 0.25);
      d.osc.stop(t + 1.5);
    }
    this.droneNodes = [];
    if (!midis) return;
    for (const m of midis) {
      const osc = ctx.createOscillator();
      osc.type = "triangle";
      osc.frequency.value = midiToHz(m);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0, t);
      g.gain.setTargetAtTime(0.35 / midis.length, t, 0.4);
      osc.connect(g).connect(this.droneBus);
      osc.start(t);
      this.droneNodes.push({ osc, gain: g });
    }
  }

  // ── Sequencer ────────────────────────────────────────────────────────────

  get playing(): boolean {
    return this.seq !== null;
  }

  play(opts: SeqOptions): void {
    this.stop(false);
    const ctx = this.ensure();
    if (this.useSoundFont()) this.selectPreset();
    this.seq = { ...opts, events: [...opts.events].sort((a, b) => a.time - b.time) };
    this.cursor = { index: 0, base: 0, start: ctx.currentTime + 0.12 };
    this.pendingHighlights = [];
    this.endAt = 0;
    this.timer = window.setInterval(() => this.tick(), 25);
    const frame = () => {
      this.flushHighlights();
      this.raf = this.seq ? requestAnimationFrame(frame) : null;
    };
    this.raf = requestAnimationFrame(frame);
    this.tick();
  }

  private tick() {
    const seq = this.seq;
    const ctx = this.ctx;
    if (!seq || !ctx) return;
    const horizon = ctx.currentTime + 0.2;
    const { events, length, loop } = seq;
    const loopFrom = seq.loopFrom ?? 0;
    for (;;) {
      if (this.cursor.index >= events.length) {
        if (loop && length > loopFrom) {
          this.cursor.base += length - loopFrom;
          seq.onLoop?.();
          this.cursor.index = events.findIndex((e) => e.time >= loopFrom);
          if (this.cursor.index < 0) this.cursor.index = events.length;
          // If a whole pass is already due, the loop continues next tick.
          if (this.cursor.start + this.cursor.base + loopFrom > horizon) return;
          continue;
        }
        if (this.endAt === 0) this.endAt = this.cursor.start + length + 1.2;
        if (ctx.currentTime >= this.endAt) {
          const done = seq.onEnd;
          this.stop(true);
          done?.();
        }
        return;
      }
      const ev = events[this.cursor.index];
      const at = this.cursor.start + this.cursor.base + ev.time;
      if (at > horizon) return;
      this.cursor.index++;
      this.fire(ev.kind, at);
    }
  }

  private fire(kind: SeqKind, at: number) {
    switch (kind.type) {
      case "note":
        this.noteAt(kind.midi, at, kind.velocity ?? 0.85, kind.string);
        if (kind.highlight !== undefined) this.pendingHighlights.push({ at, code: kind.highlight });
        break;
      case "click":
        this.clickAt(at, kind.accent);
        break;
      case "drum":
        this.drumAt(kind.note, at, kind.velocity ?? 0.8);
        break;
      case "marker":
        this.pendingHighlights.push({ at, code: `marker:${kind.code}` });
        break;
    }
  }

  private flushHighlights() {
    const ctx = this.ctx;
    const seq = this.seq;
    if (!ctx || !seq) return;
    const now = ctx.currentTime;
    while (this.pendingHighlights.length && this.pendingHighlights[0].at <= now) {
      const h = this.pendingHighlights.shift()!;
      if (h.code?.startsWith("marker:")) seq.onMarker?.(h.code.slice(7));
      else seq.onHighlight?.(h.code);
    }
  }

  /** Stop the sequence and silence what is ringing. */
  stop(silence = true): void {
    if (this.timer !== null) window.clearInterval(this.timer);
    this.timer = null;
    const seq = this.seq;
    this.seq = null;
    this.pendingHighlights = [];
    if (this.raf !== null) cancelAnimationFrame(this.raf);
    this.raf = null;
    if (seq) seq.onHighlight?.(null);
    if (silence && this.ctx) {
      for (const g of this.lastVoice.values()) g.gain.setTargetAtTime(0, this.ctx.currentTime, 0.02);
      this.lastVoice.clear();
      this.sf?.stopAll(true);
    }
  }

  // ── Output ───────────────────────────────────────────────────────────────

  async outputDevices(): Promise<{ id: string; label: string }[]> {
    if (!navigator.mediaDevices?.enumerateDevices) throw new Error("This webview cannot list audio outputs.");
    const all = await navigator.mediaDevices.enumerateDevices();
    return all.filter((d) => d.kind === "audiooutput").map((d, i) => ({ id: d.deviceId, label: d.label || `Output ${i + 1}` }));
  }

  get canChooseOutput(): boolean {
    return typeof AudioContext !== "undefined" && "setSinkId" in AudioContext.prototype;
  }

  async setOutput(id: string): Promise<void> {
    const ctx = this.ensure() as AudioContext & { setSinkId?: (id: string) => Promise<void> };
    if (!ctx.setSinkId) throw new Error("This webview always uses the system's sound output; change it in System Settings.");
    await ctx.setSinkId(id === "default" ? "" : id);
  }

  /** A short test strum. */
  test(): void {
    this.strumNow([40, 47, 52, 56, 59, 64].map((midi, string) => ({ midi, string })), 0.05);
  }
}

export const engine = new Engine();
