import { XMarkIcon } from "@heroicons/react/16/solid";
import { useMetronomeEngine } from "./useMetronomeEngine";

interface Props {
  onClose: () => void;
}

export function Metronome({ onClose }: Props) {
  const { bpm, setBpm, beats, setBeats, enabled, beatFlash, toggle, handleTapTempo } = useMetronomeEngine({
    restartOnChange: true,
  });

  return (
    <div className="metronome-panel" data-testid="metronome-panel">
      <div className="metronome-panel__header">
        <span className="metronome-panel__title">Metronome</span>
        <button className="btn-ghost" onClick={onClose} title="Close metronome">
          <XMarkIcon style={{ width: 14, height: 14 }} />
        </button>
      </div>

      <div className="metronome-panel__controls">
        <div className="metronome-panel__bpm-group">
          <input
            type="number"
            className="metronome-panel__bpm-input"
            min="40"
            max="260"
            value={bpm}
            onChange={(e) => setBpm(Math.max(40, Math.min(260, parseInt(e.target.value) || 120)))}
            aria-label="BPM"
          />
          <span className="metronome-panel__bpm-label">BPM</span>
          <button className="btn-ghost btn-xs" onClick={handleTapTempo} title="Tap to set BPM">
            Tap
          </button>
        </div>

        <select
          className="metronome-panel__timesig"
          value={beats}
          onChange={(e) => setBeats(parseInt(e.target.value))}
          aria-label="Time signature"
        >
          <option value={2}>2/4</option>
          <option value={3}>3/4</option>
          <option value={4}>4/4</option>
          <option value={6}>6/8</option>
          <option value={0}>No accent</option>
        </select>

        <div
          className={`metronome-panel__beat-indicator ${beatFlash ? "is-flashing" : ""}`}
          aria-label="Beat indicator"
          aria-live="polite"
        />

        <button
          className={`btn-primary ${!enabled ? "" : "is-active"}`}
          onClick={toggle}
          title={enabled ? "Stop" : "Start"}
          style={{ minWidth: 64 }}
        >
          {enabled ? "Stop" : "Start"}
        </button>
      </div>
    </div>
  );
}
