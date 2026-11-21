import { Cog6ToothIcon, PlayIcon, StopIcon } from "@heroicons/react/16/solid";
import { PositiveIntInput } from "../player/PositiveIntInput";
import { INSTRUMENTS } from "../../lib/fretboard/audio";
import type { Direction, FretSettings } from "../../lib/fretboard/settings";

interface Props {
  settings: FretSettings;
  update: (p: Partial<FretSettings>) => void;
  playing: boolean;
  soundName: string;
  onToggle: () => void;
  onSettings: () => void;
}

/** The bar at the bottom: playback and sound controls shared by every page. */
export function PlayBar({ settings, update, playing, soundName, onToggle, onSettings }: Props) {
  return (
    <div className="fb-playbar" role="group" aria-label="Playback">
      <button data-testid="fb-play" className={playing ? "btn-secondary" : "btn-primary"} onClick={onToggle} title="Play or stop (space bar)">
        {playing ? <StopIcon className="icon-sm" /> : <PlayIcon className="icon-sm" />} {playing ? "Stop" : "Play"}
      </button>

      <label className="fb-playbar__field">
        Tempo
        <span className="fb-playbar__bpm">
          <PositiveIntInput
            min="30"
            max="300"
            clampMin={30}
            clampMax={300}
            value={settings.bpm}
            onCommit={(bpm) => update({ bpm })}
            aria-label="Tempo (bpm)"
          />
          bpm
        </span>
      </label>

      <label className="fb-playbar__field">
        Notes per beat
        <select aria-label="Notes per beat" value={settings.notesPerBeat} onChange={(e) => update({ notesPerBeat: parseInt(e.target.value) })}>
          <option value={1}>Quarters</option>
          <option value={2}>Eighths</option>
          <option value={3}>Triplets</option>
          <option value={4}>Sixteenths</option>
        </select>
      </label>

      <label className="fb-playbar__field">
        Direction
        <select aria-label="Direction" value={settings.direction} onChange={(e) => update({ direction: e.target.value as Direction })}>
          <option value="up">Up</option>
          <option value="down">Down</option>
          <option value="updown">Up and down</option>
        </select>
      </label>

      <label className="fb-playbar__check">
        <input type="checkbox" checked={settings.loop} onChange={(e) => update({ loop: e.target.checked })} /> Loop
      </label>
      <label className="fb-playbar__check">
        <input type="checkbox" checked={settings.click} onChange={(e) => update({ click: e.target.checked })} /> Click
      </label>
      <label className="fb-playbar__check" title="Hold the scale's root chord under scale runs">
        <input type="checkbox" checked={settings.drone} onChange={(e) => update({ drone: e.target.checked })} /> Drone
      </label>

      <label className="fb-playbar__field">
        Volume
        <input type="range" min={0} max={1} step={0.01} aria-label="Volume" value={settings.volume} onChange={(e) => update({ volume: parseFloat(e.target.value) })} />
      </label>

      <button className="btn-ghost fb-playbar__sound" onClick={onSettings} title="Change the guitar sound">
        {settings.instrument === "sf" ? soundName : (INSTRUMENTS.find((i) => i.id === settings.instrument)?.name ?? soundName)}
      </button>
      <button className="btn-ghost" onClick={onSettings} aria-label="Fretboard settings" title="Fretboard settings">
        <Cog6ToothIcon className="icon-sm" /> Settings
      </button>
    </div>
  );
}
