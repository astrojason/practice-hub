import { useMemo, useState } from "react";
import { ArrowLeftIcon } from "@heroicons/react/16/solid";
import { ErrorModal } from "../ErrorModal";
import { playNote, strum } from "../../lib/fretboard/audio";
import { colourNotes, scaleInfo } from "../../lib/fretboard/scaleInfo";
import {
  CHORDS,
  KEYS,
  NUM_FRETS,
  SCALES,
  TUNINGS,
  chordVoicings,
  degreeNumber,
  diatonicChords,
  differenceFromNatural,
  intervalShort,
  isAltered,
  roman,
  scalePositions,
  spell,
  tonality,
  voicingNotes,
  wholeNeck,
} from "../../lib/fretboard/theory";
import { logTrainerActivity } from "../../lib/trainerSession";

type LabelMode = "degree" | "note" | "both" | "interval" | "none";

interface Props {
  onBack: () => void;
}

// Neck geometry (SVG units).
const FRET_W = 56;
const STRING_GAP = 32;
const NUT_X = 44;
const TOP = 24;
const MARKER_FRETS = [3, 5, 7, 9, 12, 15, 17, 19, 21];

const SCALE_GROUPS = SCALES.reduce<Record<string, typeof SCALES>>((acc, s) => {
  (acc[s.group] ??= []).push(s);
  return acc;
}, {});

export function FretboardView({ onBack }: Props) {
  const [key, setKey] = useState(0);
  const [scaleIdx, setScaleIdx] = useState(0);
  const [posIdx, setPosIdx] = useState(0);
  const [labelMode, setLabelMode] = useState<LabelMode>("degree");
  const [error, setError] = useState<string | null>(null);

  const tuning = TUNINGS[0].strings;
  const scale = SCALES[scaleIdx];
  const tones = scale.tones;
  const rootPc = key;

  const positions = useMemo(() => scalePositions(tuning, rootPc, tones), [tuning, rootPc, tones]);
  const position = positions[Math.min(posIdx, positions.length - 1)];
  const inPosition = useMemo(() => new Set(position.notes.map(([s, f]) => `${s}:${f}`)), [position]);
  const marks = useMemo(() => wholeNeck(tuning, rootPc, tones), [tuning, rootPc, tones]);
  const colour = useMemo(() => colourNotes(scale.name, tones), [scale, tones]);
  const info = scaleInfo(scale.name);
  const diff = useMemo(() => differenceFromNatural(tones), [tones]);
  const chords = useMemo(() => diatonicChords(tones, false), [tones]);

  const title = `${KEYS[key]} ${scale.name}`;
  const width = NUT_X + (NUM_FRETS + 1) * FRET_W;
  const height = TOP + 5 * STRING_GAP + 30;
  const stringY = (s: number) => TOP + (5 - s) * STRING_GAP;
  const noteX = (f: number) => (f === 0 ? NUT_X - 22 : NUT_X + (f - 0.5) * FRET_W);

  function hear(action: () => void, what: string) {
    try {
      action();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      return;
    }
    logTrainerActivity(`Fretboard Trainer — ${what}: ${title}, ${position.title.split(" — ")[0]}`);
  }

  function labelFor(m: { label: string; semis: number }): string {
    const note = spell(key, m.semis, m.label);
    switch (labelMode) {
      case "degree": return m.label;
      case "note": return note;
      case "both": return `${m.label} ${note}`;
      case "interval": return intervalShort(m.label);
      default: return "";
    }
  }

  function changeKey(k: number) {
    setKey(k);
  }

  function changeScale(i: number) {
    setScaleIdx(i);
    setPosIdx(0);
  }

  function playChord(degreeIdx: number, chordIdx: number) {
    const chord = CHORDS[chordIdx];
    const root = (rootPc + tones[degreeIdx].semis) % 12;
    const v = chordVoicings(tuning, root, chord.tones)[0];
    if (!v) throw new Error(`No playable shape found for ${chord.name}.`);
    strum(voicingNotes(v).map(([s, f]) => tuning[s] + f));
  }

  const changeNotes = diff.changes.map(([t]) => t).join(", ");

  return (
    <div className="fretboard-view" data-testid="fretboard-view">
      <header className="browse-header">
        <button className="btn-ghost" onClick={onBack} title="Back to session">
          <ArrowLeftIcon className="icon-sm" /> Back
        </button>
        <h1 className="browse-title">Fretboard Trainer</h1>
      </header>

      <div className="fretboard-body">
        <div className="fretboard-main">
          <div className="fretboard-keys" role="group" aria-label="Key">
            {KEYS.map((k, i) => (
              <button key={k} className={`fb-key ${i === key ? "active" : ""}`} onClick={() => changeKey(i)}>
                {k}
              </button>
            ))}
          </div>

          <div className="fretboard-controls">
            <label>
              Scale
              <select aria-label="Scale" value={scaleIdx} onChange={(e) => changeScale(parseInt(e.target.value))}>
                {Object.entries(SCALE_GROUPS).map(([group, list]) => (
                  <optgroup key={group} label={group}>
                    {list.map((s) => (
                      <option key={s.name} value={SCALES.indexOf(s)}>{s.name}</option>
                    ))}
                  </optgroup>
                ))}
              </select>
            </label>
            <label>
              Position
              <select aria-label="Position" value={Math.min(posIdx, positions.length - 1)} onChange={(e) => setPosIdx(parseInt(e.target.value))}>
                {positions.map((p, i) => (
                  <option key={i} value={i}>{p.title}</option>
                ))}
              </select>
            </label>
            <label>
              Labels
              <select aria-label="Labels" value={labelMode} onChange={(e) => setLabelMode(e.target.value as LabelMode)}>
                <option value="degree">Degree (1, b3, 5)</option>
                <option value="note">Note name</option>
                <option value="both">Degree and note</option>
                <option value="interval">Interval (R, m3, P5)</option>
                <option value="none">None</option>
              </select>
            </label>
          </div>

          <h2 className="fretboard-title">{title}</h2>
          <p className="fretboard-tonality">
            {tonality(tones)} —{" "}
            {diff.changes.length === 0
              ? `the ${diff.parent.toLowerCase()} scale itself`
              : `compared with ${diff.parent}: ${changeNotes}`}
          </p>

          <div className="fretboard-neck-wrap">
            <svg className="fretboard-neck" viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`${title} on the guitar neck`}>
              <rect x={NUT_X} y={TOP - 10} width={NUM_FRETS * FRET_W} height={5 * STRING_GAP + 20} className="fb-board" />
              {MARKER_FRETS.map((f) => (
                <circle key={f} cx={NUT_X + (f - 0.5) * FRET_W} cy={TOP + 2.5 * STRING_GAP} r={f === 12 ? 0 : 5} className="fb-inlay" />
              ))}
              <circle cx={NUT_X + 11.5 * FRET_W} cy={TOP + 1.5 * STRING_GAP} r={5} className="fb-inlay" />
              <circle cx={NUT_X + 11.5 * FRET_W} cy={TOP + 3.5 * STRING_GAP} r={5} className="fb-inlay" />
              {Array.from({ length: NUM_FRETS + 1 }, (_, f) => (
                <line key={f} x1={NUT_X + f * FRET_W} x2={NUT_X + f * FRET_W} y1={TOP - 10} y2={TOP + 5 * STRING_GAP + 10} className={f === 0 ? "fb-nut" : "fb-fret"} />
              ))}
              {Array.from({ length: 6 }, (_, s) => (
                <line key={s} x1={NUT_X} x2={NUT_X + NUM_FRETS * FRET_W} y1={stringY(s)} y2={stringY(s)} className="fb-string" strokeWidth={0.8 + (6 - s) * 0.35} />
              ))}
              {Array.from({ length: NUM_FRETS }, (_, i) => (
                <text key={i} x={NUT_X + (i + 0.5) * FRET_W} y={height - 6} className="fb-fretnum" textAnchor="middle">{i + 1}</text>
              ))}

              {marks.map((m) => {
                const inPos = inPosition.has(`${m.string}:${m.fret}`);
                const isRoot = m.label === "1";
                const isColour = colour.labels.includes(m.label);
                const classes = [
                  "fb-note",
                  `fb-deg-${((degreeNumber(m.label) - 1) % 7) + 1}`,
                  isAltered(m.label) ? "fb-note--alt" : "",
                  isRoot ? "fb-note--root" : "",
                  isColour ? "fb-note--colour" : "",
                  inPos ? "" : "fb-note--dim",
                ].join(" ");
                const text = labelFor(m);
                return (
                  <g
                    key={`${m.string}:${m.fret}`}
                    className={classes}
                    data-in-position={inPos}
                    data-degree={m.label}
                    data-string={m.string}
                    data-fret={m.fret}
                    onClick={() => hear(() => playNote(m.midi), "Note")}
                  >
                    <circle cx={noteX(m.fret)} cy={stringY(m.string)} r={inPos ? 12 : 8} className="fb-note__dot" />
                    {text && inPos && (
                      <text x={noteX(m.fret)} y={stringY(m.string) + 4} textAnchor="middle" className="fb-note__label">{text}</text>
                    )}
                  </g>
                );
              })}
            </svg>
          </div>
        </div>

        <aside className="fretboard-side">
          <section className="fretboard-about">
            <h3>About this scale</h3>
            {info ? (
              <>
                <p>{info.sound}</p>
                <p><strong>Use it:</strong> {info.useIt}</p>
                {info.heardIn.length > 0 && (
                  <p><strong>Heard in:</strong> {info.heardIn.join(" · ")}</p>
                )}
              </>
            ) : (
              <p className="fb-dim">{scale.group}.</p>
            )}
            {colour.labels.length > 0 && (
              <p>
                <strong>Colour notes:</strong> {colour.labels.join(", ")} (ringed in gold on the neck)
              </p>
            )}
            {colour.explanation && <p>{colour.explanation}</p>}
          </section>

          {chords.length > 0 && (
            <section className="fretboard-chords">
              <h3>Chords in this key</h3>
              <div className="fb-chord-chips">
                {chords.map(([d, c]) => {
                  const chord = CHORDS[c];
                  const name = spell(key, tones[d].semis, tones[d].label) + chord.symbol;
                  return (
                    <button
                      key={d}
                      className="fb-chord-chip"
                      title={`Hear ${name}`}
                      onClick={() => hear(() => playChord(d, c), `Chord ${name}`)}
                    >
                      {name}
                      <span className="fb-chord-chip__roman">{roman(d, chord)}</span>
                    </button>
                  );
                })}
              </div>
            </section>
          )}
        </aside>
      </div>

      {error && <ErrorModal error={error} onDismiss={() => setError(null)} />}
    </div>
  );
}
