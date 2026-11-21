import { PositiveIntInput } from "../player/PositiveIntInput";
import {
  CLICK_CHOICES,
  EXTENSIONS,
  ROUTINES,
  SEQ_PATTERNS,
  relayStringSets,
  type Clicks,
  type Extension,
  type Plan,
  type PracticeSettings,
  type Routine,
  type SeqPattern,
} from "../../lib/fretboard/practice";

interface Props {
  set: PracticeSettings;
  onChange: (patch: Partial<PracticeSettings>) => void;
  plan: Plan;
  selected: number | null;
  playingStep: number | null;
  onStep: (i: number) => void;
  standardTuning: boolean;
}

export function PracticePanel({ set, onChange, plan, selected, playingStep, onStep, standardTuning }: Props) {
  const help = ROUTINES.find((r) => r.id === set.routine)?.help ?? "";
  const sets = relayStringSets(set.relaySevenths);

  return (
    <div className="fb-practice">
      <div className="fretboard-controls">
        <label>
          Routine
          <select aria-label="Routine" value={set.routine} onChange={(e) => onChange({ routine: e.target.value as Routine })}>
            {ROUTINES.map((r) => (
              <option key={r.id} value={r.id}>{r.name}</option>
            ))}
          </select>
        </label>

        {(set.routine === "ladder" || set.routine === "circle") && (
          <label>
            Direction
            <select aria-label="Run style" value={set.ladder} onChange={(e) => onChange({ ladder: e.target.value as PracticeSettings["ladder"] })}>
              <option value="alternate">Up one, down the next</option>
              <option value="updown">Up and down each</option>
            </select>
          </label>
        )}
        {set.routine === "circle" && (
          <label className="fb-playbar__check">
            <input type="checkbox" checked={set.fourths} onChange={(e) => onChange({ fourths: e.target.checked })} /> Fourths (C F Bb Eb…)
          </label>
        )}
        {set.routine === "caged" && (
          <label>
            Chord
            <select aria-label="CAGED chord" value={set.cagedMinor ? "minor" : "major"} onChange={(e) => onChange({ cagedMinor: e.target.value === "minor" })}>
              <option value="major">Major</option>
              <option value="minor">Minor</option>
            </select>
          </label>
        )}
        {set.routine === "changes" && (
          <>
            <label>
              Play
              <select aria-label="Changes play" value={set.changesScale ? "scale" : "arpeggio"} onChange={(e) => onChange({ changesScale: e.target.value === "scale" })}>
                <option value="arpeggio">Each chord's arpeggio</option>
                <option value="scale">Each chord's scale</option>
              </select>
            </label>
            <label className="fb-playbar__check">
              <input type="checkbox" checked={set.backing} onChange={(e) => onChange({ backing: e.target.checked })} /> Strum the chord too
            </label>
          </>
        )}
        {set.routine === "extended" && (
          <>
            <label>
              Extension
              <select aria-label="Extension" value={set.extension} onChange={(e) => onChange({ extension: parseInt(e.target.value) as Extension })}>
                {EXTENSIONS.map((x) => (
                  <option key={x.id} value={x.id}>{x.name}</option>
                ))}
              </select>
            </label>
            <label>
              On
              <select aria-label="Extended chords" value={set.everyChord ? "every" : "one"} onChange={(e) => onChange({ everyChord: e.target.value === "every" })}>
                <option value="every">Every chord of the key</option>
                <option value="one">Just the I chord</option>
              </select>
            </label>
          </>
        )}
        {set.routine === "sequences" && (
          <label>
            Pattern
            <select aria-label="Pattern" value={set.pattern} onChange={(e) => onChange({ pattern: e.target.value as SeqPattern })}>
              {SEQ_PATTERNS.map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
          </label>
        )}
        {set.routine === "relay" && (
          <>
            <label>
              Chords
              <select aria-label="Relay chords" value={set.relaySevenths ? "sevenths" : "triads"} onChange={(e) => onChange({ relaySevenths: e.target.value === "sevenths", relaySet: 0 })}>
                <option value="triads">Triads</option>
                <option value="sevenths">7th chords</option>
              </select>
            </label>
            <label>
              Strings
              <select aria-label="Relay strings" value={Math.min(set.relaySet, sets.length - 1)} onChange={(e) => onChange({ relaySet: parseInt(e.target.value) })}>
                {sets.map((s, i) => (
                  <option key={s.name} value={i}>{s.name}</option>
                ))}
              </select>
            </label>
            <label>
              Beats per chord
              <select aria-label="Relay beats" value={set.relayBeats} onChange={(e) => onChange({ relayBeats: parseInt(e.target.value) })}>
                {[1, 2, 4].map((b) => (
                  <option key={b} value={b}>{b}</option>
                ))}
              </select>
            </label>
            <label className="fb-playbar__check">
              <input type="checkbox" checked={set.relayBroken} onChange={(e) => onChange({ relayBroken: e.target.checked })} /> One note at a time
            </label>
          </>
        )}
        {set.routine === "metronome" && (
          <label>
            Bars
            <select aria-label="Bars" value={set.metronomeBars} onChange={(e) => onChange({ metronomeBars: parseInt(e.target.value) })}>
              {[1, 2, 4, 8].map((b) => (
                <option key={b} value={b}>{b}</option>
              ))}
            </select>
          </label>
        )}

        <label>
          Click pattern
          <select aria-label="Click pattern" value={set.clicks} onChange={(e) => onChange({ clicks: e.target.value as Clicks })}>
            {CLICK_CHOICES.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
        </label>
        <label>
          Speed bursts
          <select aria-label="Speed bursts" value={set.burst} onChange={(e) => onChange({ burst: parseInt(e.target.value) })}>
            <option value={0}>Off</option>
            {[3, 4, 6, 8].map((b) => (
              <option key={b} value={b}>{b} notes</option>
            ))}
          </select>
        </label>
        {set.burst > 1 && (
          <label>
            Bursts
            <select aria-label="Burst placement" value={set.burstMix ? "mixed" : "after"} onChange={(e) => onChange({ burstMix: e.target.value === "mixed" })}>
              <option value="after">Repeat the run in bursts afterwards</option>
              <option value="mixed">Mix bursts into the run</option>
            </select>
          </label>
        )}
        <label>
          Call-outs
          <select aria-label="Call-outs" value={set.callouts} onChange={(e) => onChange({ callouts: e.target.value as PracticeSettings["callouts"] })}>
            <option value="off">Off</option>
            <option value="note">Note names</option>
            <option value="interval">Intervals</option>
            <option value="degree">Degrees</option>
          </select>
        </label>
        <label className="fb-playbar__check" title="Say the call-outs, and the next key of the circle of fifths, out loud">
          <input type="checkbox" checked={set.speak} onChange={(e) => onChange({ speak: e.target.checked })} /> Speak call-outs
        </label>
      </div>

      <p className="fb-routine-help fb-dim">{help}</p>

      <div className="fretboard-controls fb-speedup">
        <label className="fb-playbar__check">
          <input type="checkbox" checked={set.speedUp} onChange={(e) => onChange({ speedUp: e.target.checked })} /> Speed trainer
        </label>
        <label>
          Raise tempo by
          <PositiveIntInput min="1" max="50" clampMin={1} clampMax={50} value={set.speedStep} onCommit={(v) => onChange({ speedStep: v })} aria-label="Raise tempo by" />
        </label>
        <label>
          Raise every (loops)
          <PositiveIntInput min="1" max="20" clampMin={1} clampMax={20} value={set.speedEvery} onCommit={(v) => onChange({ speedEvery: v })} aria-label="Raise every (loops)" />
        </label>
        <label>
          Up to (bpm)
          <PositiveIntInput min="30" max="300" clampMin={30} clampMax={300} value={set.speedMax} onCommit={(v) => onChange({ speedMax: v })} aria-label="Up to (bpm)" />
        </label>
      </div>

      {plan.message && <p className="fb-practice-message">{plan.message}</p>}
      {set.routine === "caged" && !standardTuning && <p className="fb-practice-message">CAGED shapes need standard tuning.</p>}

      <div className="fb-step-chips" role="list" aria-label="Steps">
        {plan.steps.map((st, i) => (
          <button
            key={i}
            role="listitem"
            className={`fb-step-chip ${selected === i ? "fb-step-chip--selected" : ""} ${playingStep === i ? "fb-step-chip--playing" : ""}`}
            onClick={() => onStep(i)}
            title="See and hear this step"
          >
            {st.title}
          </button>
        ))}
      </div>
    </div>
  );
}
