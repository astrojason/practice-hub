export class PitchShifterWorklet {
  constructor(
    context: AudioContext,
    buffer: AudioBuffer,
    onEnd?: () => void
  );
  tempo: number;
  pitch: number;
  percentagePlayed: number;
  connect(node: AudioNode): void;
  disconnect(): void;
}

export function loadSoundTouchWorklet(context: AudioContext): Promise<void>;
