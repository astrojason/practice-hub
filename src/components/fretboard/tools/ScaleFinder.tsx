import { useMemo, useState } from "react";
import { Neck, type NeckMark } from "../Neck";
import { engine } from "../../../lib/fretboard/audio";
import { NOTE_NAMES, chordsPcs, identifyScales, keyDegrees, parseChords, type SongKey } from "../../../lib/fretboard/identify";
import { KEYS, NUM_FRETS, SCALES, chromaticLabel, toneFor } from "../../../lib/fretboard/theory";
import type { ToolProps } from "./TheoryTools";

const mod = (n: number, m: number) => ((n % m) + m) % m;
const MINOR_NAMES = ["C", "C#", "D", "Eb", "E", "F", "F#", "G", "G#", "A", "Bb", "B"];

// "-1" is "I don't know the key"; majors are 0-11, minors 12-23.
const keyFromValue = (v: number): SongKey | null => (v < 0 ? null : { root: v % 12, minor: v >= 12 });
const keyName = (k: SongKey) => (k.minor ? `${MINOR_NAMES[k.root]} minor` : `${KEYS[k.root]} major`);

/** Pick the notes of a melody, or type a song's chords, and find the scale they come from. */
export function ScaleFinder({ tuning, scheme, highOnTop, dim, hear, onError, onOpenScale }: ToolProps) {
  const [picked, setPicked] = useState<number[]>([]);
  const [keyValue, setKeyValue] = useState(-1);
  // The home note when the notes came from typed chords (the first chord's root).
  const [home, setHome] = useState<number | null>(null);
  const [chordText, setChordText] = useState("");
  const [fromChords, setFromChords] = useState<string | null>(null);
  const [shown, setShown] = useState<number | null>(null);

  const key = keyFromValue(keyValue);
  const results = useMemo(() => identifyScales(picked, key, home ?? picked[0]), [picked, keyValue, home]);
  const top = results.slice(0, key ? 5 : 8);
  const lead = shown !== null ? top[shown] : top[0];
  const degrees = key ? keyDegrees(picked, key) : [];

  function setNotes(next: number[]) {
    setPicked(next);
    setHome(null);
    setFromChords(null);
    setShown(null);
  }

  function toggle(pc: number, midi: number) {
    const has = picked.includes(pc);
    setNotes(has ? picked.filter((p) => p !== pc) : [...picked, pc]);
    if (!has) hear(() => engine.pluck(midi), `scale identifier, ${NOTE_NAMES[pc]}`);
  }

  function findFromChords() {
    let parsed;
    try {
      parsed = parseChords(chordText);
    } catch (err) {
      onError(err instanceof Error ? err.message : String(err));
      return;
    }
    if (parsed.length === 0) {
      onError("Type the song's chords first, for example: Am F C G");
      return;
    }
    setPicked(chordsPcs(parsed));
    setHome(parsed[0].root);
    setFromChords(parsed.map((c) => c.text).join(" "));
    setShown(null);
  }

  function playNotes() {
    // Upwards from the key's root (or the first note picked), within an octave from the 3rd octave.
    const root = key?.root ?? picked[0];
    const steps = picked.map((pc) => mod(pc - root, 12)).sort((a, b) => a - b);
    const names = steps.map((s) => NOTE_NAMES[mod(root + s, 12)]).join(" ");
    hear(() => engine.playLater(steps.map((s, i) => ({ midi: 48 + root + s, at: i * 0.35 }))), `scale identifier, played ${names}`);
  }

  // Root and degree labels on the neck follow the leading result (or the key, or the first note).
  const labelRoot = lead?.root ?? key?.root ?? picked[0] ?? 0;
  const leadTones = lead ? SCALES[lead.scale].tones : [];
  const marks: NeckMark[] = [];
  tuning.forEach((open, s) => {
    for (let f = 0; f <= NUM_FRETS; f++) {
      const midi = open + f;
      const pc = mod(midi, 12);
      const isPicked = picked.includes(pc);
      const isExtra = shown !== null && lead?.extra.includes(pc);
      if (!isPicked && !isExtra) continue;
      const label = toneFor(leadTones, labelRoot, midi)?.label ?? chromaticLabel(midi - labelRoot);
      marks.push({ string: s, fret: f, midi, label, semis: mod(midi - labelRoot, 12), inPosition: isPicked, neighbor: !isPicked });
    }
  });

  return (
    <div className="fb-tool fb-scale-finder">
      <div className="fretboard-controls">
        <label>
          Song key
          <select aria-label="Song key" value={keyValue} onChange={(e) => { setKeyValue(parseInt(e.target.value)); setShown(null); }}>
            <option value={-1}>I don't know the key</option>
            <optgroup label="Major">
              {KEYS.map((k, i) => <option key={k} value={i}>{k} major</option>)}
            </optgroup>
            <optgroup label="Minor">
              {MINOR_NAMES.map((k, i) => <option key={k} value={12 + i}>{k} minor</option>)}
            </optgroup>
          </select>
        </label>
        <button className="btn-secondary" disabled={picked.length === 0} onClick={playNotes}>Play my notes</button>
        <button className="btn-ghost" disabled={picked.length === 0} onClick={() => setNotes([])}>Clear</button>
      </div>
      <p className="fb-dim">The key is usually the chord a song starts and ends on. Knowing it narrows the answer to one best scale and numbers each note in the key.</p>

      <div className="fb-chip-row fb-pc-chips" role="group" aria-label="Your notes">
        {NOTE_NAMES.map((n, pc) => (
          <button key={n} className={`fb-chip fb-pc-chip ${picked.includes(pc) ? "fb-chip--on" : ""}`} aria-pressed={picked.includes(pc)} onClick={() => toggle(pc, 60 + pc)}>
            {n}
          </button>
        ))}
      </div>

      <form className="fretboard-controls fb-song-chords" onSubmit={(e) => { e.preventDefault(); findFromChords(); }}>
        <label className="fb-song-chords__field">
          Or a song's chords
          <input type="text" aria-label="Song chords" placeholder="Am F C G" value={chordText} onChange={(e) => setChordText(e.target.value)} />
        </label>
        <button type="submit" className="btn-secondary" disabled={chordText.trim() === ""}>Find the scale</button>
      </form>
      {fromChords && <p className="fb-dim">Notes from the chords {fromChords}; the first chord is taken as home.</p>}

      <Neck
        marks={marks}
        title="Scale identifier"
        tuning={tuning}
        labelFor={(m) => m.label}
        scheme={scheme}
        highOnTop={highOnTop}
        dimOpacity={dim}
        onNote={(m) => toggle(mod(m.midi, 12), m.midi)}
      />
      <p className="fb-dim">Tap any fret to add or remove that note; every place it sits lights up.</p>

      <div className="fb-tool-columns">
        <section className="fretboard-about">
          <h3>{key ? `Best scale in ${keyName(key)}` : "Scales that fit"}</h3>
          {picked.length < 2 && <p className="fb-dim">Pick two or more notes to start.</p>}
          {picked.length >= 2 && top.length === 0 && <p className="fb-dim">No scale in this app holds all of these notes{key ? ` with ${keyName(key)} as home` : ""}.</p>}
          {top.map((r, i) => (
            <div key={`${r.root}-${r.scale}`} className={`fb-scale-result ${i === 0 ? "fb-scale-result--best" : ""}`}>
              <strong>{r.name}</strong>
              <span className="fb-dim">{r.extra.length === 0 ? "exactly your notes" : `+${r.extra.length}: ${r.extra.map((p) => NOTE_NAMES[p]).join(", ")}`}</span>
              {r.extra.length > 0 && (
                <button className="btn-ghost" aria-pressed={shown === i} title="Show this scale's other notes on the neck, faded" onClick={() => setShown(shown === i ? null : i)}>
                  {shown === i ? "Hide" : "Show"}
                </button>
              )}
              <button className="btn-ghost" title="Open this scale on the Scales page" onClick={() => onOpenScale(r.root, r.scale)}>Open</button>
            </div>
          ))}
        </section>
        {key && picked.length > 0 && (
          <section className="fretboard-about">
            <h3>Your notes in {keyName(key)}</h3>
            <ul className="fb-note-list">
              {degrees.map((d) => (
                <li key={d.pc} className={`fb-key-degree ${d.inKey ? "" : "fb-key-degree--out"}`}>
                  <strong>{NOTE_NAMES[d.pc]}</strong> — {d.label}{d.inKey ? "" : " (outside the key)"}
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
    </div>
  );
}
