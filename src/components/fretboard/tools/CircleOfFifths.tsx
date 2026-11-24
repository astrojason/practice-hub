import { useMemo, useState } from "react";
import { ChordBox } from "../ChordBox";
import { engine } from "../../../lib/fretboard/audio";
import {
  CIRCLE,
  CIRCLE_ALT,
  CIRCLE_DIMS,
  CIRCLE_MAJORS,
  CIRCLE_MINORS,
  MODES,
  borrowedChords,
  keySignature,
  modeKey,
  relatedModes,
  secondaryDominants,
  type KeyChord,
} from "../../../lib/fretboard/circle";
import { CHORDS, KEYS, SCALES, chordVoicings, type Voicing } from "../../../lib/fretboard/theory";
import type { ToolProps } from "./TheoryTools";

const mod = (n: number, m: number) => ((n % m) + m) % m;

// Circle geometry (SVG units).
const C = 170;
const RINGS = { major: [165, 118], minor: [118, 78], dim: [78, 46] } as const;

function slicePath(i: number, outer: number, inner: number): string {
  const a0 = ((i * 30 - 105) * Math.PI) / 180;
  const a1 = ((i * 30 - 75) * Math.PI) / 180;
  const p = (r: number, a: number) => `${(C + r * Math.cos(a)).toFixed(2)} ${(C + r * Math.sin(a)).toFixed(2)}`;
  return `M ${p(outer, a0)} A ${outer} ${outer} 0 0 1 ${p(outer, a1)} L ${p(inner, a1)} A ${inner} ${inner} 0 0 0 ${p(inner, a0)} Z`;
}

function labelAt(i: number, r: number): [number, number] {
  const a = ((i * 30 - 90) * Math.PI) / 180;
  return [C + r * Math.cos(a), C + r * Math.sin(a)];
}

/** Tap a key, or pick a root and a mode: its signature, its seven chords, and the chords it borrows. */
export function CircleOfFifths({ tuning, hear, onOpenChord, onOpenScale }: ToolProps) {
  const [root, setRoot] = useState(0);
  const [mode, setMode] = useState("Ionian");
  const [sevenths, setSevenths] = useState(false);
  const [picked, setPicked] = useState<KeyChord | null>(null);

  const mk = useMemo(() => modeKey(root, mode, sevenths), [root, mode, sevenths]);
  const triads = useMemo(() => modeKey(root, mode, false), [root, mode]);
  const sig = keySignature(mk.parent);
  const borrowed = useMemo(() => borrowedChords(root, mode), [root, mode]);
  const secondary = useMemo(() => secondaryDominants(root, mode), [root, mode]);
  const related = relatedModes(mk.parent);
  const p = CIRCLE.indexOf(mk.parent);
  const slice = [mod(p - 1, 12), p, mod(p + 1, 12)];

  // Which cell is home: the mode's own chord in the parent key's slice.
  const home: { ring: "major" | "minor" | "dim"; i: number } =
    mode === "Lydian" ? { ring: "major", i: slice[0] } : mode === "Ionian" ? { ring: "major", i: p } : mode === "Mixolydian" ? { ring: "major", i: slice[2] }
      : mode === "Dorian" ? { ring: "minor", i: slice[0] } : mode === "Aeolian" ? { ring: "minor", i: p } : mode === "Phrygian" ? { ring: "minor", i: slice[2] }
        : { ring: "dim", i: p };

  // Roman numerals for the cells in the slice, from this mode's triads.
  const romanOf = (pc: number, kind: "" | "m" | "dim") => triads.chords.find((c) => c.root === pc && CHORDS[c.chord].symbol === kind)?.roman ?? "";

  function voicingFor(c: KeyChord): Voicing {
    const list = chordVoicings(tuning, c.root, CHORDS[c.chord].tones);
    if (list.length === 0) throw new Error(`No playable shape for ${c.name} was found on this instrument.`);
    return list[0];
  }

  const strumNotes = (v: Voicing) => v.frets.flatMap((f, s) => (f === null ? [] : [{ midi: tuning[s] + f, string: s }]));

  function playChord(c: KeyChord) {
    setPicked(c);
    hear(() => engine.strumNow(strumNotes(voicingFor(c))), `circle of fifths, ${c.name} in ${mk.name}`);
  }

  // Home, the 4th-degree chord, the 5th-degree chord, home (I–IV–V–I in major, i–iv–v–i in minor).
  const cadence = [0, 3, 4, 0].map((d) => triads.chords[d]).filter((c): c is KeyChord => c !== undefined);
  const cadenceLabel = cadence.map((c) => c.roman).join("–");

  function playCadence() {
    hear(() => {
      const events = cadence.flatMap((c, i) => strumNotes(voicingFor(c)).map((n, k) => ({ ...n, at: i * 1.1 + k * 0.035 })));
      engine.playLater(events);
    }, `circle of fifths, ${cadenceLabel} in ${mk.name}`);
  }

  function playScale() {
    const tones = [...mk.scale.tones.map((t) => t.semis), 12];
    hear(() => engine.playLater(tones.map((s, i) => ({ midi: 48 + root + s, at: i * 0.3 }))), `circle of fifths, ${mk.name} scale`);
  }

  function chooseCell(ring: "major" | "minor" | "dim", i: number) {
    const major = CIRCLE[i];
    if (ring === "major") { setRoot(major); setMode("Ionian"); }
    else if (ring === "minor") { setRoot(mod(major + 9, 12)); setMode("Aeolian"); }
    else { setRoot(mod(major + 11, 12)); setMode("Locrian"); }
    setPicked(null);
  }

  const chip = (c: KeyChord, key: string) => (
    <button key={key} className={`fb-chord-chip ${picked?.name === c.name ? "fb-chord-chip--on" : ""}`} title={`Click to hear ${c.name}, double-click to open it on the Chords page`} onClick={() => playChord(c)} onDoubleClick={() => onOpenChord(c.root, c.chord)}>
      {c.name}
      <span className="fb-chord-chip__roman">{c.roman}</span>
    </button>
  );

  let pickedVoicing: Voicing | null = null;
  if (picked) {
    const list = chordVoicings(tuning, picked.root, CHORDS[picked.chord].tones);
    pickedVoicing = list[0] ?? null;
  }

  return (
    <div className="fb-tool fb-circle5-tool">
      <div className="fb-tool-columns">
        <svg className="fb-circle5" viewBox="0 0 340 340" role="img" aria-label={`Circle of fifths with ${mk.name} highlighted`}>
          {CIRCLE.map((pc, i) => {
            const inSlice = slice.includes(i);
            const cell = (ring: "major" | "minor" | "dim", text: string, kind: "" | "m" | "dim", cellPc: number) => {
              const [outer, inner] = RINGS[ring];
              const isHome = home.ring === ring && home.i === i;
              const showSlice = inSlice && (ring !== "dim" || i === p);
              const [x, y] = labelAt(i, (outer + inner) / 2);
              return (
                <g
                  key={ring}
                  className={`fb-circle5__cell fb-circle5__${ring} ${showSlice ? "fb-circle5__cell--slice" : ""} ${isHome ? "fb-circle5__cell--home" : ""}`}
                  data-pc={ring === "major" ? pc : cellPc}
                  onClick={() => chooseCell(ring, i)}
                >
                  <path d={slicePath(i, outer, inner)} />
                  <text x={x} y={y - (showSlice ? 3 : -4)} textAnchor="middle" className="fb-circle5__name">{text}</text>
                  {showSlice && <text x={x} y={y + 10} textAnchor="middle" className="fb-circle5__roman">{romanOf(cellPc, kind)}</text>}
                  {ring === "major" && !showSlice && CIRCLE_ALT[pc] && <text x={x} y={y + 14} textAnchor="middle" className="fb-circle5__alt">{CIRCLE_ALT[pc]}</text>}
                </g>
              );
            };
            return (
              <g key={pc}>
                {cell("major", CIRCLE_MAJORS[i], "", pc)}
                {cell("minor", CIRCLE_MINORS[i], "m", mod(pc + 9, 12))}
                {cell("dim", CIRCLE_DIMS[i], "dim", mod(pc + 11, 12))}
              </g>
            );
          })}
          <text x={C} y={C - 4} textAnchor="middle" className="fb-circle5__centre">{mk.name}</text>
          <text x={C} y={C + 12} textAnchor="middle" className="fb-circle5__centre-sub">{sig.text}</text>
        </svg>

        <section className="fretboard-about fb-circle5-info">
          <h3>{mk.name}</h3>
          <p><strong>Key signature:</strong> {sig.text}{sig.notes.length > 0 ? ` (${sig.notes.join(" ")})` : ""}</p>
          {mode === "Ionian" && <p><strong>Relative minor:</strong> {modeKey(mod(root + 9, 12), "Aeolian", false).name}</p>}
          {mode === "Aeolian" && <p><strong>Relative major:</strong> {modeKey(mod(root + 3, 12), "Ionian", false).name}</p>}
          {mode !== "Ionian" && mode !== "Aeolian" && <p><strong>Same notes as:</strong> {modeKey(mk.parent, "Ionian", false).name}</p>}
          <p>{mk.mode.sound}</p>
          <ul className="fb-circle5-notes" aria-label="Scale notes">
            {mk.notes.map((n, i) => (
              <li key={n}><strong>{n}</strong><span className="fb-dim">{mk.scale.tones[i].label}</span></li>
            ))}
          </ul>
          <div className="fretboard-actions">
            <button className="btn-secondary" onClick={playCadence}>Play {cadenceLabel}</button>
            <button className="btn-secondary" onClick={playScale}>Play scale</button>
            <button className="btn-ghost" title="Open this scale on the Scales page" onClick={() => onOpenScale(root, SCALES.indexOf(mk.scale))}>Open on Scales</button>
          </div>
        </section>
      </div>

      <div className="fretboard-keys" role="group" aria-label="Root">
        {KEYS.map((k, i) => (
          <button key={k} className={`fb-key ${i === root ? "active" : ""}`} onClick={() => { setRoot(i); setPicked(null); }}>{k}</button>
        ))}
      </div>
      <div className="fb-chip-row" role="group" aria-label="Mode">
        {MODES.map((m) => (
          <button key={m.name} className={`fb-chip fb-mode-btn ${m.name === mode ? "fb-chip--on" : ""}`} aria-pressed={m.name === mode} onClick={() => { setMode(m.name); setPicked(null); }}>
            {m.name}{m.name === "Ionian" ? " (major)" : m.name === "Aeolian" ? " (natural minor)" : ""}
          </button>
        ))}
      </div>

      <div className="fb-tool-columns">
        <section className="fretboard-chords fb-circle5-chords">
          <h3>Chords in {mk.name}</h3>
          <label className="fb-playbar__check">
            <input type="checkbox" checked={sevenths} onChange={(e) => setSevenths(e.target.checked)} /> 7ths
          </label>
          <div className="fb-chord-chips fb-circle5-diatonic">{mk.chords.map((c, i) => chip(c, `d${i}`))}</div>
          {borrowed.length > 0 && (
            <div className="fb-circle5-borrowed">
              <h4>Borrowed from {mode === "Ionian" ? `${modeKey(root, "Aeolian", false).name}` : "harmonic minor and Dorian"}</h4>
              <p className="fb-dim">{mode === "Ionian" ? "Chords from the minor key on the same root: a bittersweet or rock colour without changing key." : "The major V pulls home much harder than the minor v; the major IV brightens a minor song."}</p>
              <div className="fb-chord-chips">{borrowed.map((c, i) => chip(c, `b${i}`))}</div>
            </div>
          )}
          {secondary.length > 0 && (
            <div className="fb-circle5-secondary">
              <h4>Secondary dominants</h4>
              <p className="fb-dim">The V7 of a chord in the key: one note from outside the key that leans hard into the chord it's named after.</p>
              <div className="fb-chord-chips">{secondary.map((c, i) => chip(c, `s${i}`))}</div>
            </div>
          )}
        </section>
        <section className="fretboard-about">
          {picked && pickedVoicing && (
            <>
              <h3>{picked.name} <span className="fb-dim">{picked.roman}</span></h3>
              <ChordBox voicing={pickedVoicing} tones={CHORDS[picked.chord].tones} root={picked.root} tuning={tuning} onClick={() => playChord(picked)} />
            </>
          )}
          {picked && !pickedVoicing && <p className="fb-dim">No playable shape for {picked.name} on this instrument.</p>}
          <h3>Modes with the same notes</h3>
          <div className="fb-chip-row">
            {related.map(([r, m]) => (
              <button key={m} className={`fb-chip ${r === root && m === mode ? "fb-chip--on" : ""}`} onClick={() => { setRoot(r); setMode(m); setPicked(null); }}>
                {modeKey(r, m, false).name}
              </button>
            ))}
          </div>
        </section>
      </div>

      <section className="fretboard-about">
        <h3>The seven modes, brightest to darkest</h3>
        <p className="fb-dim">Keep the root and step down the list: each mode has one more flat than the one above it, one step anticlockwise on the circle.</p>
        <table className="fb-mode-table">
          <thead>
            <tr><th>Mode</th><th>Formula</th><th>Flavour note</th><th>Sound</th><th>On {KEYS[root]}</th></tr>
          </thead>
          <tbody>
            {MODES.map((m) => (
              <tr key={m.name} className={m.name === mode ? "fb-mode-table__on" : ""}>
                <td>{m.name}</td>
                <td>{m.formula}</td>
                <td>{m.flavour}</td>
                <td>{m.sound}</td>
                <td>{keySignature(mod(root + m.parent, 12)).text}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  );
}
