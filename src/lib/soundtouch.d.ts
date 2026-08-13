export class PitchShifterWorklet {
  constructor(
    context: AudioContext,
    buffer: AudioBuffer,
    onEnd?: () => void
  );
  tempo: number;
  pitch: number;
  percentagePlayed: number;
  readonly lastReportedPositionSeconds: number | null;
  readonly lastReportedContextTime: number;
  connect(node: AudioNode): void;
  disconnect(): void;
}

export function loadSoundTouchWorklet(context: AudioContext): Promise<void>;
