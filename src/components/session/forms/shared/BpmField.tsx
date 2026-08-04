import { ChevronLeftIcon, ChevronRightIcon } from "@heroicons/react/16/solid";

interface Props {
  value: string;
  onChange: (value: string) => void;
  /** Fixed comparison point (e.g. the catalog's reference BPM) — shown as a % badge when set. */
  referenceBpm?: number | null;
}

export function BpmField({ value, onChange, referenceBpm }: Props) {
  function adjustBpm(direction: 1 | -1) {
    const current = Number(value) || 120;
    const next = Math.max(1, Math.min(400, Math.round(current * (1 + direction * 0.05))));
    onChange(String(next));
  }

  const bpmPct = referenceBpm && value
    ? Math.round(Number(value) / referenceBpm * 100)
    : null;

  return (
    <div className="bpm-field">
      <label className="bpm-field-label">BPM</label>
      <input
        type="number"
        min={1}
        max={400}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="—"
        className="bpm-number"
      />
      {bpmPct != null && (
        <span className="bpm-pct">{bpmPct}%</span>
      )}
      <button type="button" className="bpm-arrow" onClick={() => adjustBpm(-1)}>
        <ChevronLeftIcon className="icon-sm" />
      </button>
      <input
        type="range"
        min={20}
        max={240}
        value={value ? Math.min(240, Math.max(20, Number(value))) : 120}
        onChange={(e) => onChange(e.target.value)}
        className="bpm-slider"
      />
      <button type="button" className="bpm-arrow" onClick={() => adjustBpm(1)}>
        <ChevronRightIcon className="icon-sm" />
      </button>
    </div>
  );
}
