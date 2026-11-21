import { useState } from "react";
import { ConfirmModal } from "../ConfirmModal";
import {
  COMPS,
  DRUM_STYLES,
  chordRoot,
  presetChords,
  presetScaleIndex,
  type ChordFocus,
  type Follow,
  type ProgChord,
} from "../../lib/fretboard/progression";
import type { FretSettings } from "../../lib/fretboard/settings";
import { CHORDS, KEYS, PROGRESSIONS, SCALES, chordPlayable, diatonicChords, plainName, romanFor } from "../../lib/fretboard/theory";
import type { useProgression } from "../../lib/fretboard/useProgression";

type Prog = ReturnType<typeof useProgression>;

interface Props {
  /** The instrument's strings: chords with no playable shape on it are left out of the lists. */
  tuning: number[];
  prog: Prog;
  keyIdx: number;
  scaleIdx: number;
  onScale: (i: number) => void;
  settings: FretSettings;
  update: (p: Partial<FretSettings>) => void;
  selected: number | null;
  onSelect: (i: number | null) => void;
  playingIndex: number | null;
  onHear: (i: number) => void;
}

type Pending =
  | { kind: "remove"; index: number }
  | { kind: "clear" }
  | { kind: "delete"; name: string }
  | { kind: "replace"; name: string };

const CHORD_GROUPS = (() => {
  const map = new Map<string, number[]>();
  CHORDS.forEach((c, i) => map.set(c.group, [...(map.get(c.group) ?? []), i]));
  return [...map.entries()];
})();

export function ProgressionPanel({ tuning, prog, keyIdx, scaleIdx, onScale, settings, update, selected, onSelect, playingIndex, onHear }: Props) {
  const { chords, setChords } = prog;
  const [pending, setPending] = useState<Pending | null>(null);
  const [savedPick, setSavedPick] = useState("");
  const [sevenths, setSevenths] = useState(false);
  const [anyRoot, setAnyRoot] = useState(0);
  const [anyChord, setAnyChord] = useState(0);
  const scale = SCALES[scaleIdx];

  const chordName = (c: ProgChord) => plainName(chordRoot(keyIdx, c)) + CHORDS[c.chord].symbol;
  const sel = selected !== null ? chords[selected] : undefined;
  // The preset the progression matches exactly, if any.
  const matchedPreset = PROGRESSIONS.findIndex((_, i) => {
    const p = presetChords(i);
    return p.length === chords.length && p.every((c, k) => c.semis === chords[k].semis && c.chord === chords[k].chord && c.beats === chords[k].beats);
  });
  const matchedValue = matchedPreset >= 0 ? String(matchedPreset) : "";

  function patch(i: number, change: Partial<ProgChord>) {
    setChords(chords.map((c, k) => (k === i ? { ...c, ...change } : c)));
  }

  function move(i: number, dir: -1 | 1) {
    const j = i + dir;
    if (j < 0 || j >= chords.length) return;
    const next = [...chords];
    [next[i], next[j]] = [next[j], next[i]];
    setChords(next);
    onSelect(j);
  }

  function add(c: ProgChord) {
    setChords([...chords, c]);
    onSelect(chords.length);
  }

  function saveNow(name: string) {
    prog.save({ name, chords, scale: scaleIdx });
    setSavedPick(name);
  }

  function trySave() {
    const name = prog.name.trim();
    if (!name) return;
    if (prog.saved.some((s) => s.name === name)) setPending({ kind: "replace", name });
    else saveNow(name);
  }

  function confirmPending() {
    const p = pending;
    setPending(null);
    if (!p) return;
    if (p.kind === "remove") {
      setChords(chords.filter((_, i) => i !== p.index));
      onSelect(null);
    } else if (p.kind === "clear") {
      setChords([]);
      onSelect(null);
    } else if (p.kind === "delete") {
      prog.remove(p.name);
      setSavedPick("");
    } else saveNow(p.name);
  }

  const keyChords = diatonicChords(scale.tones, sevenths).filter(([d, ci]) => chordPlayable(tuning, keyIdx + scale.tones[d].semis, ci));

  return (
    <div className="fb-prog">
      <div className="fretboard-controls">
        <label>
          Preset
          <select
            aria-label="Preset"
            value={matchedValue}
            onChange={(e) => {
              const i = parseInt(e.target.value);
              if (Number.isNaN(i)) return;
              prog.setChords(presetChords(i), PROGRESSIONS[i].name);
              onScale(presetScaleIndex(i));
              onSelect(null);
              setSavedPick("");
            }}
          >
            <option value="">Choose a preset…</option>
            {PROGRESSIONS.map((p, i) => (
              <option key={p.name} value={i}>{p.name}</option>
            ))}
          </select>
        </label>
        <label>
          My progressions
          <select
            aria-label="My progressions"
            value={savedPick}
            onChange={(e) => {
              const found = prog.saved.find((s) => s.name === e.target.value);
              setSavedPick(e.target.value);
              if (!found) return;
              prog.setChords(found.chords, found.name);
              onScale(found.scale);
              onSelect(null);
            }}
          >
            <option value="">—</option>
            {prog.saved.map((s) => (
              <option key={s.name} value={s.name}>{s.name}</option>
            ))}
          </select>
        </label>
        <label>
          Name
          <input type="text" aria-label="Progression name" value={prog.name} placeholder="Name this progression" onChange={(e) => prog.setName(e.target.value)} />
        </label>
        <div className="fretboard-actions">
          <button className="btn-secondary" onClick={trySave} disabled={!prog.name.trim() || chords.length === 0}>Save</button>
          <button className="btn-ghost" disabled={!savedPick} onClick={() => setPending({ kind: "delete", name: savedPick })}>Delete saved</button>
        </div>
      </div>

      <div className="fb-chord-cards" role="list" aria-label="Progression">
        {chords.map((c, i) => (
          <button
            key={i}
            role="listitem"
            className={`fb-chord-card ${selected === i ? "fb-chord-card--selected" : ""} ${playingIndex === i ? "fb-chord-card--playing" : ""}`}
            onClick={() => {
              onSelect(i);
              onHear(i);
            }}
          >
            <span className="fb-chord-card__name">{chordName(c)}</span>
            <span className="fb-chord-card__roman">{romanFor(c.semis, CHORDS[c.chord])}</span>
            <span className="fb-chord-card__beats">{c.beats || settings.beatsPerChord} beats</span>
          </button>
        ))}
        {chords.length === 0 && <span className="fb-dim">No chords yet — choose a preset or add chords below.</span>}
      </div>

      {sel && selected !== null && (
        <div className="fb-chord-editor">
          <label>
            Root
            <select aria-label="Root" value={chordRoot(keyIdx, sel)} onChange={(e) => patch(selected, { semis: (parseInt(e.target.value) - keyIdx + 12) % 12 })}>
              {KEYS.map((k, pc) => (
                <option key={k} value={pc}>{k}</option>
              ))}
            </select>
          </label>
          <label>
            Chord type
            <select aria-label="Chord type" value={sel.chord} onChange={(e) => patch(selected, { chord: parseInt(e.target.value) })}>
              {CHORD_GROUPS.map(([g, list]) => (
                <optgroup key={g} label={g}>
                  {list.filter((ci) => ci === sel.chord || chordPlayable(tuning, chordRoot(keyIdx, sel), ci)).map((ci) => (
                    <option key={ci} value={ci}>{CHORDS[ci].name}</option>
                  ))}
                </optgroup>
              ))}
            </select>
          </label>
          <label>
            Beats
            <select aria-label="Beats" value={sel.beats} onChange={(e) => patch(selected, { beats: parseInt(e.target.value) })}>
              <option value={0}>Default ({settings.beatsPerChord})</option>
              {[1, 2, 3, 4, 6, 8].map((b) => (
                <option key={b} value={b}>{b}</option>
              ))}
            </select>
          </label>
          <div className="fretboard-actions">
            <button className="btn-secondary" onClick={() => move(selected, -1)} disabled={selected === 0}>Move left</button>
            <button className="btn-secondary" onClick={() => move(selected, 1)} disabled={selected === chords.length - 1}>Move right</button>
            <button className="btn-secondary" onClick={() => { setChords([...chords.slice(0, selected + 1), { ...sel }, ...chords.slice(selected + 1)]); onSelect(selected + 1); }}>Duplicate</button>
            <button className="btn-ghost" onClick={() => setPending({ kind: "remove", index: selected })}>Remove</button>
          </div>
        </div>
      )}

      <div className="fb-prog-add">
        <div className="fb-add-key">
          <span className="fb-prog-add__label">Add from the key</span>
          {keyChords.map(([d, ci]) => {
            const t = scale.tones[d];
            const c: ProgChord = { semis: t.semis, chord: ci, beats: 0 };
            return (
              <button key={`${d}-${ci}`} className="fb-chord-chip" onClick={() => add(c)}>
                {chordName(c)}
              </button>
            );
          })}
          <label className="fb-playbar__check">
            <input type="checkbox" checked={sevenths} onChange={(e) => setSevenths(e.target.checked)} /> Sevenths
          </label>
        </div>
        <div className="fb-add-any">
          <span className="fb-prog-add__label">Add any chord</span>
          <select aria-label="Root" value={anyRoot} onChange={(e) => setAnyRoot(parseInt(e.target.value))}>
            {KEYS.map((k, pc) => (
              <option key={k} value={pc}>{k}</option>
            ))}
          </select>
          <select aria-label="Chord type" value={anyChord} onChange={(e) => setAnyChord(parseInt(e.target.value))}>
            {CHORD_GROUPS.map(([g, list]) => (
              <optgroup key={g} label={g}>
                {list.filter((ci) => ci === anyChord || chordPlayable(tuning, anyRoot, ci)).map((ci) => (
                  <option key={ci} value={ci}>{CHORDS[ci].name}</option>
                ))}
              </optgroup>
            ))}
          </select>
          <button className="btn-secondary" onClick={() => add({ semis: (anyRoot - keyIdx + 12) % 12, chord: anyChord, beats: 0 })}>Add</button>
          <button className="btn-ghost" disabled={chords.length === 0} onClick={() => setPending({ kind: "clear" })}>Clear progression</button>
        </div>
      </div>

      <div className="fretboard-controls">
        <label>
          Beats per chord
          <select aria-label="Beats per chord" value={settings.beatsPerChord} onChange={(e) => update({ beatsPerChord: parseInt(e.target.value) })}>
            {[1, 2, 3, 4, 6, 8].map((b) => (
              <option key={b} value={b}>{b}</option>
            ))}
          </select>
        </label>
        <label>
          Guitar part
          <select aria-label="Guitar part" value={settings.comp} onChange={(e) => update({ comp: e.target.value as FretSettings["comp"] })}>
            {COMPS.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
        </label>
        <label>
          Drum style
          <select aria-label="Drum style" value={settings.drums} onChange={(e) => update({ drums: e.target.value as FretSettings["drums"] })}>
            {DRUM_STYLES.map((d) => (
              <option key={d.id} value={d.id}>{d.name}</option>
            ))}
          </select>
        </label>
        <label>
          Drum volume
          <input type="range" min={0} max={1} step={0.01} aria-label="Drum volume" value={settings.drumVolume} onChange={(e) => update({ drumVolume: parseFloat(e.target.value) })} />
        </label>
        <label>
          Follow the chords
          <select aria-label="Follow the chords" value={settings.follow} onChange={(e) => update({ follow: e.target.value as Follow })}>
            <option value="off">Off (keep the key's scale)</option>
            <option value="chordscale">Scale for each chord</option>
            <option value="arpeggio">Arpeggio of each chord</option>
          </select>
        </label>
        <label>
          Highlight
          <select aria-label="Highlight" value={settings.focus} onChange={(e) => update({ focus: e.target.value as ChordFocus })}>
            <option value="shape">Chord shape played</option>
            <option value="alltones">All chord tones</option>
          </select>
        </label>
      </div>

      {pending && (
        <ConfirmModal
          title={
            pending.kind === "remove" ? "Remove chord?" : pending.kind === "clear" ? "Clear the progression?" : pending.kind === "delete" ? "Delete saved progression?" : "Replace saved progression?"
          }
          message={
            pending.kind === "remove"
              ? `Remove ${chordName(chords[pending.index])} from the progression?`
              : pending.kind === "clear"
                ? `Remove all ${chords.length} chords from the progression?`
                : pending.kind === "delete"
                  ? `Delete the saved progression "${pending.name}"? This can't be undone.`
                  : `A saved progression called "${pending.name}" already exists. Replace it with this one?`
          }
          confirmLabel={pending.kind === "delete" ? "Delete" : pending.kind === "replace" ? "Replace" : pending.kind === "clear" ? "Clear" : "Remove"}
          onConfirm={confirmPending}
          onCancel={() => setPending(null)}
        />
      )}
    </div>
  );
}
