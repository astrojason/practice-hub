// Plays a song with the Web Audio API: plucked-string or synth voices, synthesised drums,
// speed, loop, count-in, metronome, mute, solo and per-track volume. Ported from Tabline.

import { beatTicks, barStarts, type BarTiming } from "./tabRender";
import { songClock, type SongClock } from "./clock";
import type { Transport, TransportCallbacks } from "./transport";
import type { TabBeat, TabSong } from "./types";

const LOOKAHEAD = 0.15; // seconds scheduled ahead
const TICK_MS = 25;

const midiFreq = (m: number) => 440 * 2 ** ((m - 69) / 12);

interface SongEvent {
  tick: number;
  len: number;
  track: number;
  beat: TabBeat;
}

interface Voice {
  src: AudioScheduledSourceNode;
  gain: GainNode;
}

export type VoiceKind = "pluck" | "synth";

export class SynthPlayer implements Transport {
  playing = false;
  speed = 1;
  voice: VoiceKind = "pluck";
  countIn = false;
  metronome = false;
  masterVolume = 0.8;

  private cb: TransportCallbacks;
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private clickGain!: GainNode;
  private trackGains: GainNode[] = [];
  private song: TabSong | null = null;
  private timing!: BarTiming;
  private clock!: SongClock;
  private barSet = new Set<number>();
  private totalTicks = 0;
  private events: SongEvent[] = [];
  private loop: [number, number] | null = null;
  private muted = new Set<number>();
  private solo = new Set<number>();
  private volumes: number[] = [];
  private positionTick = 0;
  private timer: ReturnType<typeof setInterval> | null = null;
  private raf = 0;
  private ringing = new Map<string, Voice>();
  private buffers = new Map<string, AudioBuffer>();
  private noise: AudioBuffer | null = null;
  private anchorTick = 0;
  private anchorTime = 0;
  private anchorSec = 0;
  private nextIndex = 0;
  private nextClick = 0;
  private endTimeout: ReturnType<typeof setTimeout> | null = null;

  constructor(cb: TransportCallbacks) {
    this.cb = cb;
  }

  private ensureContext(): AudioContext {
    if (this.ctx) return this.ctx;
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) throw new Error("This system has no audio output the app can use (Web Audio is missing).");
    const ctx = new AC();
    this.ctx = ctx;
    this.master = ctx.createGain();
    this.master.gain.value = this.masterVolume;
    const comp = ctx.createDynamicsCompressor();
    this.master.connect(comp);
    comp.connect(ctx.destination);
    this.clickGain = ctx.createGain();
    this.clickGain.gain.value = 0.5;
    this.clickGain.connect(this.master);
    this.rebuildTrackGains();
    return ctx;
  }

  load(song: TabSong): void {
    if (this.playing) this.pause();
    this.song = song;
    this.timing = barStarts(song);
    this.clock = songClock(song);
    this.barSet = new Set(this.timing.starts);
    this.totalTicks = this.timing.total;
    this.events = [];
    song.tracks.forEach((t, ti) => {
      t.measures.forEach((m, mi) => {
        let tick = this.timing.starts[mi];
        for (const b of m.beats) {
          const len = beatTicks(b);
          if (b.notes.some((n) => !n.tie)) this.events.push({ tick, len, track: ti, beat: b });
          tick += len;
        }
      });
    });
    this.events.sort((a, b) => a.tick - b.tick);
    this.volumes = song.tracks.map((_, i) => this.volumes[i] ?? 0.8);
    this.muted.clear();
    this.solo.clear();
    this.positionTick = 0;
    this.buffers.clear();
    if (this.ctx) this.rebuildTrackGains();
  }

  private rebuildTrackGains(): void {
    if (!this.ctx || !this.song) return;
    for (const g of this.trackGains) g.disconnect();
    this.trackGains = this.song.tracks.map(() => {
      const g = this.ctx!.createGain();
      g.connect(this.master);
      return g;
    });
    this.applyGains();
  }

  private applyGains(): void {
    if (!this.ctx) return;
    this.trackGains.forEach((g, i) => {
      const audible = this.solo.size ? this.solo.has(i) : !this.muted.has(i);
      g.gain.setTargetAtTime(audible ? this.volumes[i] : 0, this.ctx!.currentTime, 0.02);
    });
  }

  setVolume(i: number, v: number): void { this.volumes[i] = v; this.applyGains(); }
  setMuted(i: number, on: boolean): void { if (on) this.muted.add(i); else this.muted.delete(i); this.applyGains(); }
  setSolo(i: number, on: boolean): void { if (on) this.solo.add(i); else this.solo.delete(i); this.applyGains(); }

  setSpeed(pct: number): void {
    const tick = this.currentTick();
    this.speed = pct / 100;
    if (this.playing && this.ctx) this.anchor(tick, this.ctx.currentTime + 0.02);
  }

  setLoop(range: [number, number] | null): void {
    this.loop = range;
    if (range) {
      const start = this.barStart(range[0]);
      const end = this.barStart(range[1] + 1);
      const t = this.currentTick();
      if (t < start || t >= end) this.seekTick(start);
    }
  }

  /** Seconds from `fromTick` to `toTick` at the current speed. */
  private span(fromTick: number, toTick: number): number {
    return (this.clock.secAt(toTick) - this.clock.secAt(fromTick)) / this.speed;
  }

  /** When (audio clock) a tick sounds, from the anchor. */
  private whenAt(tick: number): number {
    return this.anchorTime + (this.clock.secAt(tick) - this.anchorSec) / this.speed;
  }

  private anchor(tick: number, time: number): void {
    this.anchorTick = tick;
    this.anchorTime = time;
    this.anchorSec = this.clock.secAt(tick);
    this.nextIndex = this.events.findIndex((e) => e.tick >= tick);
    if (this.nextIndex < 0) this.nextIndex = this.events.length;
    this.nextClick = Math.ceil(tick / this.clickTicks()) * this.clickTicks();
  }

  private clickTicks(): number {
    const [n, d] = this.song!.time;
    if (d === 8 && n % 3 === 0 && n > 3) return 1440;
    return 3840 / d;
  }

  private tickAt(time: number): number {
    return this.clock.tickAt(this.anchorSec + (time - this.anchorTime) * this.speed);
  }

  currentTick(): number {
    if (!this.playing || !this.ctx) return this.positionTick;
    return Math.max(this.anchorTick, this.tickAt(this.ctx.currentTime));
  }

  private barStart(bar: number): number {
    return bar >= this.timing.starts.length ? this.timing.total : this.timing.starts[Math.max(0, bar)];
  }

  seekTick(tick: number): void {
    this.stopRinging();
    this.positionTick = Math.max(0, Math.min(tick, this.totalTicks - 1));
    if (this.playing && this.ctx) this.anchor(this.positionTick, this.ctx.currentTime + 0.03);
    this.cb.onTick(this.positionTick);
  }

  async play(): Promise<void> {
    if (!this.song || this.playing) return;
    const ctx = this.ensureContext();
    if (ctx.state === "suspended") await ctx.resume();
    this.prepareBuffers();
    let start = this.positionTick >= this.totalTicks - 1 ? 0 : this.positionTick;
    if (this.loop) {
      const ls = this.barStart(this.loop[0]);
      const le = this.barStart(this.loop[1] + 1);
      if (start < ls || start >= le) start = ls;
    }
    let t0 = ctx.currentTime + 0.06;
    if (this.countIn) {
      const step = this.span(start, start + this.clickTicks());
      const count = Math.max(1, Math.round(this.timing.lengths[0] / this.clickTicks()));
      for (let i = 0; i < count; i++) this.click(t0 + i * step, i === 0);
      t0 += count * step;
    }
    this.playing = true;
    this.anchor(start, t0);
    this.timer = setInterval(() => this.schedule(), TICK_MS);
    this.schedule();
    const frame = () => {
      if (!this.playing) return;
      this.cb.onTick(this.currentTick());
      this.raf = requestAnimationFrame(frame);
    };
    this.raf = requestAnimationFrame(frame);
    this.cb.onState(true);
  }

  pause(): void {
    if (!this.playing) return;
    this.positionTick = Math.min(this.currentTick(), this.totalTicks - 1);
    this.halt();
    this.cb.onState(false);
    this.cb.onTick(this.positionTick);
  }

  private halt(): void {
    this.playing = false;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    if (this.endTimeout) clearTimeout(this.endTimeout);
    this.endTimeout = null;
    cancelAnimationFrame(this.raf);
    this.stopRinging();
  }

  private schedule(): void {
    if (!this.ctx) return;
    try {
      const horizon = this.ctx.currentTime + LOOKAHEAD;
      const loopEnd = this.loop ? this.barStart(this.loop[1] + 1) : this.totalTicks;
      for (;;) {
        const ev = this.events[this.nextIndex] as SongEvent | undefined;
        const evTick = ev ? ev.tick : Infinity;
        const clickTick = this.metronome ? this.nextClick : Infinity;
        const nextTick = Math.min(evTick, clickTick, loopEnd);
        const when = this.whenAt(nextTick);
        if (when > horizon) break;
        if (nextTick === loopEnd) {
          if (this.loop) {
            this.anchor(this.barStart(this.loop[0]), when);
            this.stopRinging(when);
            continue;
          }
          // End of the song.
          const delay = Math.max(0, (when - this.ctx.currentTime) * 1000);
          if (this.timer) clearInterval(this.timer);
          this.timer = null;
          this.endTimeout = setTimeout(() => {
            if (!this.playing) return;
            this.positionTick = 0;
            this.halt();
            this.cb.onState(false);
            this.cb.onTick(0);
          }, delay + 400);
          break;
        }
        if (nextTick === clickTick) {
          this.click(when, this.barSet.has(nextTick));
          this.nextClick += this.clickTicks();
          continue;
        }
        if (ev) this.playEvent(ev, Math.max(when, this.ctx.currentTime), this.span(ev.tick, ev.tick + ev.len));
        this.nextIndex++;
      }
    } catch (e) {
      this.pause();
      this.cb.onError(e instanceof Error ? e : new Error(String(e)));
    }
  }

  dispose(): void {
    this.halt();
    this.playing = false;
    if (this.ctx) {
      const ctx = this.ctx;
      this.ctx = null;
      void ctx.close();
    }
  }

  // ----- Sounds -----

  private noiseBuffer(): AudioBuffer {
    if (!this.noise) {
      const ctx = this.ctx!;
      const len = Math.floor(ctx.sampleRate * 1.5);
      const buf = ctx.createBuffer(1, len, ctx.sampleRate);
      const d = buf.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
      this.noise = buf;
    }
    return this.noise;
  }

  /** Karplus-Strong plucked string, rendered once per pitch. */
  private pluckBuffer(midi: number, bass: boolean): AudioBuffer {
    const key = `${bass ? "b" : "g"}${midi}`;
    const hit = this.buffers.get(key);
    if (hit) return hit;
    const ctx = this.ctx!;
    const sr = ctx.sampleRate;
    const seconds = bass ? 2.2 : 2.6;
    const len = Math.floor(sr * seconds);
    const buf = ctx.createBuffer(1, len, sr);
    const out = buf.getChannelData(0);
    const period = sr / midiFreq(midi);
    const n = Math.max(2, Math.floor(period));
    const frac = period - n;
    const ring = new Float32Array(n + 1);
    let seed = midi * 9301 + 49297;
    const rand = () => ((seed = (seed * 9301 + 49297) % 233280) / 233280) * 2 - 1;
    // A softer pick for the bass; brighter for the guitar.
    let prev = 0;
    for (let i = 0; i <= n; i++) {
      const r = rand();
      prev = bass ? prev * 0.6 + r * 0.4 : prev * 0.15 + r * 0.85;
      ring[i] = prev;
    }
    const decay = bass ? 0.996 : 0.9965 - Math.max(0, midi - 60) * 0.00008;
    let idx = 0;
    let last = 0;
    for (let i = 0; i < len; i++) {
      const a = ring[idx];
      const nextIdx = idx + 1 > n ? 0 : idx + 1;
      const b = ring[nextIdx];
      const v = decay * ((1 - frac * 0.5) * 0.5 * (a + b) + frac * 0.25 * (b - last));
      last = a;
      ring[idx] = v;
      out[i] = a * (bass ? 0.9 : 0.6);
      idx = nextIdx;
    }
    // Fade the tail out.
    const fade = Math.floor(sr * 0.05);
    for (let i = 0; i < fade; i++) out[len - fade + i] *= 1 - i / fade;
    this.buffers.set(key, buf);
    return buf;
  }

  private prepareBuffers(): void {
    if (this.voice !== "pluck" || !this.song) return;
    for (const t of this.song.tracks) {
      if (t.instrument === "drums") continue;
      const seen = new Set<number>();
      for (const m of t.measures) for (const b of m.beats) for (const n of b.notes) seen.add(Math.round(t.strings[n.string - 1] + n.fret));
      for (const midi of seen) this.pluckBuffer(midi, t.instrument === "bass");
    }
  }

  private stopRinging(at?: number): void {
    if (!this.ctx) return;
    const t = at ?? this.ctx.currentTime;
    for (const v of this.ringing.values()) {
      v.gain.gain.cancelScheduledValues(t);
      v.gain.gain.setTargetAtTime(0, t, 0.015);
      // A later stop() replaces the earlier scheduled one.
      v.src.stop(t + 0.1);
    }
    this.ringing.clear();
  }

  private playEvent(ev: SongEvent, when: number, dur: number): void {
    const ctx = this.ctx!;
    const track = this.song!.tracks[ev.track];
    const out = this.trackGains[ev.track];
    if (track.instrument === "drums") {
      for (const n of ev.beat.notes) if (!n.tie) this.drum(n.fret, when, out);
      return;
    }
    const bass = track.instrument === "bass";
    for (const n of ev.beat.notes) {
      if (n.tie) continue;
      const midi = track.strings[n.string - 1] + n.fret;
      const key = `${ev.track}:${n.string}`;
      const prev = this.ringing.get(key);
      if (prev) {
        prev.gain.gain.setTargetAtTime(0, when, 0.012);
        prev.src.stop(when + 0.08);
      }
      const g = ctx.createGain();
      g.connect(out);
      let src: AudioScheduledSourceNode;
      if (this.voice === "pluck") {
        const bs = ctx.createBufferSource();
        // Buffers are made per semitone; cents come from playing it slightly faster or slower.
        const base = Math.round(midi);
        bs.buffer = this.pluckBuffer(base, bass);
        bs.playbackRate.value = 2 ** ((midi - base) / 12);
        bs.connect(g);
        g.gain.setValueAtTime(bass ? 0.9 : 0.75, when);
        const ringFor = Math.max(dur * 1.05, Math.min(1.6, dur * 3));
        g.gain.setTargetAtTime(0, when + ringFor, 0.08);
        bs.start(when);
        bs.stop(when + ringFor + 0.5);
        src = bs;
      } else {
        const osc = ctx.createOscillator();
        osc.type = bass ? "sawtooth" : "triangle";
        osc.frequency.value = midiFreq(midi);
        const f = ctx.createBiquadFilter();
        f.type = "lowpass";
        f.frequency.value = bass ? 700 : 2600;
        osc.connect(f);
        f.connect(g);
        const peak = bass ? 0.35 : 0.3;
        g.gain.setValueAtTime(0, when);
        g.gain.linearRampToValueAtTime(peak, when + 0.012);
        g.gain.setTargetAtTime(peak * 0.6, when + 0.02, 0.15);
        g.gain.setTargetAtTime(0, when + dur * 0.95, 0.05);
        osc.start(when);
        osc.stop(when + dur + 0.4);
        src = osc;
      }
      const voice: Voice = { src, gain: g };
      this.ringing.set(key, voice);
      src.onended = () => {
        if (this.ringing.get(key) === voice) this.ringing.delete(key);
        g.disconnect();
      };
    }
  }

  private drum(piece: number, when: number, out: AudioNode): void {
    const ctx = this.ctx!;
    const g = ctx.createGain();
    g.connect(out);
    const noise = (filterType: BiquadFilterType, freq: number, length: number, level: number, q = 0.8) => {
      const src = ctx.createBufferSource();
      src.buffer = this.noiseBuffer();
      const f = ctx.createBiquadFilter();
      f.type = filterType;
      f.frequency.value = freq;
      f.Q.value = q;
      const ng = ctx.createGain();
      ng.gain.setValueAtTime(level, when);
      ng.gain.exponentialRampToValueAtTime(0.001, when + length);
      src.connect(f);
      f.connect(ng);
      ng.connect(g);
      src.start(when);
      src.stop(when + length + 0.05);
    };
    const tone = (from: number, to: number, length: number, level: number) => {
      const o = ctx.createOscillator();
      o.type = "sine";
      o.frequency.setValueAtTime(from, when);
      o.frequency.exponentialRampToValueAtTime(to, when + length * 0.6);
      const og = ctx.createGain();
      og.gain.setValueAtTime(level, when);
      og.gain.exponentialRampToValueAtTime(0.001, when + length);
      o.connect(og);
      og.connect(g);
      o.start(when);
      o.stop(when + length + 0.05);
    };
    // General MIDI drum numbers, grouped into the sounds made here.
    if (piece === 35 || piece === 36) tone(150, 45, 0.4, 1.0); // kick
    else if (piece === 37) noise("bandpass", 2500, 0.05, 0.5, 2); // side stick
    else if (piece >= 38 && piece <= 40) { tone(190, 150, 0.12, 0.5); noise("bandpass", 1800, 0.18, 0.7, 0.6); } // snare
    else if (piece === 42 || piece === 44) noise("highpass", 7500, 0.05, 0.35); // closed hi-hat
    else if (piece === 46) noise("highpass", 7000, 0.35, 0.3); // open hi-hat
    else if ([41, 43, 45, 47, 48, 50].includes(piece)) { const f = 90 + (piece - 41) * 18; tone(f * 1.8, f, 0.32, 0.7); } // toms, low to high
    else if ([51, 53, 59].includes(piece)) noise("bandpass", 5200, 0.6, 0.25, 1.5); // ride
    else if ([49, 52, 55, 57].includes(piece)) noise("highpass", 4500, 1.4, 0.35, 0.5); // crash, china, splash
    else noise("bandpass", 3000, 0.12, 0.3); // other percussion
    setTimeout(() => g.disconnect(), (when - ctx.currentTime + 2) * 1000);
  }

  private click(when: number, accent: boolean): void {
    const ctx = this.ctx!;
    const o = ctx.createOscillator();
    o.type = "square";
    o.frequency.value = accent ? 1760 : 1320;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, when);
    g.gain.exponentialRampToValueAtTime(accent ? 0.5 : 0.3, when + 0.002);
    g.gain.exponentialRampToValueAtTime(0.0001, when + 0.05);
    o.connect(g);
    g.connect(this.clickGain);
    o.start(when);
    o.stop(when + 0.06);
  }
}
