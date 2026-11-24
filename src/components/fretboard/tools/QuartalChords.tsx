import { useMemo, useState } from "react";
import { ChordBox } from "../ChordBox";
import { engine } from "../../../lib/fretboard/audio";
import { identifyChord, shapeText } from "../../../lib/fretboard/identify";
import { quartalShape, quartalStack } from "../../../lib/fretboard/quartal";
import { KEYS, chromaticLabel, type Tone } from "../../../lib/fretboard/theory";
import type { ToolProps } from "./TheoryTools";

type Kind = "4ths" | "5ths";
const PERFECT: Record<Kind, number> = { "4ths": 500, "5ths": 700 };

/** Stack 4ths (or 5ths) instead of 3rds, and bend their size to hear the drift. */
export function QuartalChords({ tuning, scheme, hear }: ToolProps) {
  const [root, setRoot] = useState(0);
  const [count, setCount] = useState(5);
  const [kind, setKind] = useState<Kind>("4ths");
  const [cents, setCents] = useState(500);

  const perfect = PERFECT[kind];
  const semis = perfect / 100;
  const stack = useMemo(() => quartalStack(root, count, cents), [root, count, cents]);
  const exactStack = useMemo(() => quartalStack(root, count, perfect), [root, count, perfect]);
  const heardAs = useMemo(() => identifyChord(exactStack.map((n) => n.midi)).slice(0, 3), [exactStack]);
  const shape = useMemo(() => quartalShape(tuning, root, count, semis), [tuning, root, count, semis]);
  const shapeTones: Tone[] = exactStack.map((n) => ({ semis: n.midi - exactStack[0].midi, label: chromaticLabel(n.midi - exactStack[0].midi) }));
  const step = cents - perfect;
  const top = stack[stack.length - 1];

  function playStack() {
    const gap = 0.4;
    hear(() => {
      engine.playLater([
        ...stack.map((n, i) => ({ midi: n.exact, at: i * gap })),
        ...stack.map((n) => ({ midi: n.exact, at: stack.length * gap + 0.3 })),
      ]);
    }, `quartal chords, ${count} ${kind} from ${KEYS[root]} at ${cents}¢`);
  }

  function strumShape() {
    if (!shape) return;
    const notes = shape.frets.flatMap((f, s) => (f === null ? [] : [{ midi: tuning[s] + f, string: s }]));
    hear(() => engine.strumNow(notes), `quartal chords, shape ${shapeText(shape.frets)}`);
  }

  return (
    <div className="fb-tool fb-quartal">
      <div className="fretboard-keys" role="group" aria-label="Root">
        {KEYS.map((k, i) => (
          <button key={k} className={`fb-key ${i === root ? "active" : ""}`} onClick={() => setRoot(i)}>{k}</button>
        ))}
      </div>
      <div className="fretboard-controls">
        <label>
          Stack
          <select aria-label="Stack" value={kind} onChange={(e) => { const k = e.target.value as Kind; setKind(k); setCents(PERFECT[k]); }}>
            <option value="4ths">4ths (quartal)</option>
            <option value="5ths">5ths (quintal)</option>
          </select>
        </label>
        <label>
          Notes
          <select aria-label="Notes in the stack" value={count} onChange={(e) => setCount(parseInt(e.target.value))}>
            {[2, 3, 4, 5, 6].map((n) => <option key={n} value={n}>{n}</option>)}
          </select>
        </label>
        <button className="btn-primary" onClick={playStack}>Play the stack</button>
      </div>

      <ol className="fb-quartal-notes" aria-label="Notes of the stack">
        {stack.map((n, i) => (
          <li key={i} className={`fb-quartal-note ${n.off !== 0 ? "fb-quartal-note--off" : ""}`}>
            <strong>{n.name}</strong>
            {n.off !== 0 && <span className="fb-quartal-note__off">{n.off > 0 ? "+" : ""}{n.off}¢</span>}
          </li>
        ))}
      </ol>

      <section className="fretboard-about">
        <h3>Shrink the {kind} and hear them drift</h3>
        <p>
          A perfect {kind === "4ths" ? "4th" : "5th"} is {perfect} cents ({semis} half steps of 100 cents). Change the size of each one and the error adds up as you stack them.
        </p>
        <label className="fb-quartal-slider">
          Size of each {kind === "4ths" ? "4th" : "5th"}: <strong>{cents}¢</strong>
          <input type="range" aria-label="Size of each interval (cents)" min={perfect - 50} max={perfect + 50} step={1} value={cents} onChange={(e) => setCents(parseInt(e.target.value))} />
        </label>
        <p className="fb-dim">
          {step === 0
            ? `Every ${kind === "4ths" ? "4th" : "5th"} is exactly ${perfect} cents, so each note lands right on a piano key.`
            : `Each step is ${Math.abs(step)}¢ ${step < 0 ? "small" : "big"}, so the top note, ${top.name}, is ${Math.abs(top.off)}¢ ${top.off < 0 ? "flat" : "sharp"} of its piano key.`}
        </p>
        <button className="btn-ghost" disabled={step === 0} onClick={() => setCents(perfect)}>Back to perfect</button>
      </section>

      <div className="fb-tool-columns">
        <section className="fretboard-about">
          <h3>Heard as</h3>
          {heardAs.length > 0 ? (
            <p>{heardAs.map((c) => c.name + (c.missing.length ? ` (no ${c.missing.join(", ")})` : "")).join(" · ")}</p>
          ) : (
            <p className="fb-dim">No ordinary chord name: that's the open, unresolved sound of stacked {kind}.</p>
          )}
          <p className="fb-dim">Chords built from 3rds sound major or minor. Stacked 4ths have no 3rd, so they float between both: modal jazz, fusion and film scores lean on them.</p>
        </section>
        <section className="fretboard-about">
          <h3>On the neck</h3>
          {shape ? (
            <>
              <ChordBox voicing={shape} tones={shapeTones} root={exactStack[0].midi % 12} tuning={tuning} scheme={scheme} onClick={strumShape} />
              <p className="fb-dim">{shapeText(shape.frets)}: one note per string. Click it to strum.</p>
            </>
          ) : (
            <p className="fb-dim">This stack doesn't fit under one hand on neighbouring strings in this tuning.</p>
          )}
        </section>
      </div>
    </div>
  );
}
