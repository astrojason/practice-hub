// Drives the tab from a recording: the audio element sets the pace and the tab cursor follows
// it. `offset` is the recording time (seconds) at which bar 1 starts; sync points pin later bars
// to recording times, and the tab follows the recording in straight lines between them.

import { barStarts, type BarTiming } from "./tabRender";
import { songClock, type SongClock } from "./clock";
import type { Transport, TransportCallbacks } from "./transport";
import type { TabSong } from "./types";

export interface SyncPoint {
  /** 0-based bar. */
  bar: number;
  /** Recording time (seconds) at which the bar starts. */
  time: number;
}

/** Straight lines through the [x, y] pairs; the nearest slope continues beyond the ends. */
export function warp(points: [number, number][], x: number, xi: 0 | 1, yi: 0 | 1): number {
  const pts = points.map((p) => [p[xi], p[yi]]);
  if (pts.length === 1) return pts[0][1] + (x - pts[0][0]);
  let i = 0;
  while (i < pts.length - 2 && x > pts[i + 1][0]) i++;
  const [x0, y0] = pts[i];
  const [x1, y1] = pts[i + 1];
  const slope = (y1 - y0) / (x1 - x0);
  return y0 + (x - x0) * slope;
}

export class RecordingTransport implements Transport {
  playing = false;
  offset = 0;
  sync: SyncPoint[] = [];

  private audio: HTMLAudioElement;
  private cb: TransportCallbacks;
  private clock: SongClock;
  private timing: BarTiming;
  private loop: [number, number] | null = null;
  private raf = 0;
  private ctx: AudioContext | null = null;
  private shifter: AudioWorkletNode | null = null;
  private pitch = 0;
  private onEnded = () => {
    this.playing = false;
    cancelAnimationFrame(this.raf);
    this.cb.onState(false);
    this.cb.onTick(this.currentTick());
  };

  constructor(audio: HTMLAudioElement, song: TabSong, cb: TransportCallbacks) {
    this.audio = audio;
    this.cb = cb;
    this.clock = songClock(song);
    this.timing = barStarts(song);
    audio.addEventListener("ended", this.onEnded);
  }

  /**
   * Sends the recording's sound through the pitch shifter (a worklet in public/), which changes
   * the pitch without changing the speed. Resolves once it is wired up; rejects, leaving the
   * recording playing at its own pitch, when the system can't do it.
   */
  async enablePitchShift(): Promise<void> {
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) throw new Error("This system has no Web Audio, so the recording can't be pitch shifted.");
    const ctx = new AC();
    this.ctx = ctx;
    const source = ctx.createMediaElementSource(this.audio);
    try {
      await ctx.audioWorklet.addModule(`${import.meta.env.BASE_URL}tabPitchWorklet.js`);
      const shifter = new AudioWorkletNode(ctx, "pitch-shifter", { outputChannelCount: [2] });
      source.connect(shifter);
      shifter.connect(ctx.destination);
      this.shifter = shifter;
      this.applyPitch();
    } catch (err) {
      source.connect(ctx.destination);
      throw new Error(`Pitch shifting of the recording isn't available here, so it plays at its own pitch (${err instanceof Error ? err.message : String(err)}).`);
    }
  }

  /** Semitones, with cents as hundredths. */
  setPitchShift(semitones: number): void {
    this.pitch = semitones;
    this.applyPitch();
  }

  private applyPitch(): void {
    if (!this.shifter || !this.ctx) return;
    this.shifter.parameters.get("ratio")!.setValueAtTime(2 ** (this.pitch / 12), this.ctx.currentTime);
  }

  /** [song seconds, recording seconds] pairs: the sync points, else bar 1 at the offset. */
  private anchors(): [number, number][] {
    const sync = this.sync.filter((p) => p.bar < this.timing.starts.length);
    if (!sync.length) return [[0, this.offset]];
    return sync.map((p) => [this.clock.secAt(this.timing.starts[p.bar]), p.time]);
  }

  /** The recording's playhead, in seconds. */
  mediaTime(): number {
    return this.audio.currentTime;
  }

  currentTick(): number {
    const sec = warp(this.anchors(), this.audio.currentTime, 1, 0);
    return Math.max(0, Math.min(this.clock.tickAt(sec), this.timing.total - 1));
  }

  private mediaTimeAt(tick: number): number {
    return Math.max(0, warp(this.anchors(), this.clock.secAt(tick), 0, 1));
  }

  private loopTicks(): [number, number] | null {
    if (!this.loop) return null;
    const { starts, total } = this.timing;
    const end = this.loop[1] + 1;
    return [starts[Math.max(0, this.loop[0])], end >= starts.length ? total : starts[end]];
  }

  async play(): Promise<void> {
    if (this.playing) return;
    if (this.ctx && this.ctx.state === "suspended") await this.ctx.resume();
    const lt = this.loopTicks();
    const tick = this.currentTick();
    if (lt && (tick < lt[0] || tick >= lt[1])) this.audio.currentTime = this.mediaTimeAt(lt[0]);
    await this.audio.play();
    this.playing = true;
    const frame = () => {
      if (!this.playing) return;
      const cur = this.currentTick();
      const bounds = this.loopTicks();
      if (bounds && cur >= bounds[1]) this.audio.currentTime = this.mediaTimeAt(bounds[0]);
      this.cb.onTick(cur);
      this.raf = requestAnimationFrame(frame);
    };
    this.raf = requestAnimationFrame(frame);
    this.cb.onState(true);
  }

  pause(): void {
    if (!this.playing) return;
    this.playing = false;
    cancelAnimationFrame(this.raf);
    this.audio.pause();
    this.cb.onState(false);
    this.cb.onTick(this.currentTick());
  }

  seekTick(tick: number): void {
    this.audio.currentTime = this.mediaTimeAt(tick);
    this.cb.onTick(this.currentTick());
  }

  setSpeed(pct: number): void {
    this.audio.playbackRate = pct / 100;
  }

  setLoop(range: [number, number] | null): void {
    this.loop = range;
    const lt = this.loopTicks();
    if (lt) {
      const t = this.currentTick();
      if (t < lt[0] || t >= lt[1]) this.seekTick(lt[0]);
    }
  }

  dispose(): void {
    this.playing = false;
    cancelAnimationFrame(this.raf);
    this.audio.removeEventListener("ended", this.onEnded);
    this.audio.pause();
    if (this.ctx) {
      const ctx = this.ctx;
      this.ctx = null;
      void ctx.close();
    }
  }
}
