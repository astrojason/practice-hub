// What the tab player drives: either the built-in synth, or a recording that sets the pace.

export interface TransportCallbacks {
  /** Called every frame while playing, and after seeks/pauses, with the absolute tick. */
  onTick: (tick: number) => void;
  onState: (playing: boolean) => void;
  onError: (err: Error) => void;
}

export interface Transport {
  readonly playing: boolean;
  play(): Promise<void>;
  pause(): void;
  seekTick(tick: number): void;
  currentTick(): number;
  setSpeed(pct: number): void;
  /** Inclusive bar range to repeat, or null. */
  setLoop(range: [number, number] | null): void;
  dispose(): void;
}
