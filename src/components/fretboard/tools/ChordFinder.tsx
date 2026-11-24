import { useEffect, useMemo, useState } from "react";
import { Neck, type NeckMark } from "../Neck";
import { ToneChips } from "../Aids";
import { engine } from "../../../lib/fretboard/audio";
import { identifyChord, shapeText, similarChords } from "../../../lib/fretboard/identify";
import { CHORDS, NUM_FRETS, chordPlayable, chordVoicings, chromaticLabel, plainName, toneFor, voicingMinFret } from "../../../lib/fretboard/theory";
import type { ToolProps } from "./TheoryTools";

const mod = (n: number, m: number) => ((n % m) + m) % m;

/** Tap a fret on each string to name the chord; tap it again to mute the string. */
export function ChordFinder({ tuning, scheme, highOnTop, dim, hear, onError, onOpenChord }: ToolProps) {
  const [frets, setFrets] = useState<(number | null)[]>(() => tuning.map(() => null));
  // The shape you made, kept while you try a similar chord.
  const [mine, setMine] = useState<(number | null)[] | null>(null);

  // A different instrument has a different number of strings: start again.
  useEffect(() => {
    setFrets(tuning.map(() => null));
    setMine(null);
  }, [tuning.join(",")]);

  const midis = useMemo(() => frets.flatMap((f, s) => (f === null ? [] : [tuning[s] + f])), [frets, tuning]);
  const matches = useMemo(() => identifyChord(midis), [midis]);
  const best = matches[0];
  const similar = useMemo(
    () => (best ? similarChords(best.root, best.chord).filter((c) => chordPlayable(tuning, c.root, c.chord)) : []),
    [best, tuning],
  );

  const marks: NeckMark[] = [];
  tuning.forEach((open, s) => {
    for (let f = 0; f <= NUM_FRETS; f++) {
      const midi = open + f;
      if (frets[s] === f) {
        const role = best ? toneFor(CHORDS[best.chord].tones, best.root, midi) : undefined;
        const label = role?.label ?? (best ? chromaticLabel(midi - best.root) : "1");
        marks.push({ string: s, fret: f, midi, label, semis: mod(midi - (best?.root ?? 0), 12), inPosition: true, text: plainName(midi) });
      } else {
        marks.push({ string: s, fret: f, midi, label: "1", semis: 0, inPosition: false, pickable: true });
      }
    }
  });

  function strum(shape: (number | null)[], detail: string) {
    const notes = shape.flatMap((f, s) => (f === null ? [] : [{ midi: tuning[s] + f, string: s }]));
    if (notes.length === 0) return;
    hear(() => engine.strumNow(notes), detail);
  }

  function tap(m: NeckMark) {
    const next = [...frets];
    next[m.string] = frets[m.string] === m.fret ? null : m.fret;
    setFrets(next);
    if (next[m.string] !== null) hear(() => engine.pluck(m.midi, m.string), `chord identifier, ${plainName(m.midi)}`);
  }

  function trySimilar(root: number, chordIdx: number, name: string) {
    const list = chordVoicings(tuning, root, CHORDS[chordIdx].tones);
    if (list.length === 0) {
      onError(`No playable shape for ${name} was found on this instrument.`);
      return;
    }
    const lowest = Math.min(...frets.filter((f): f is number => f !== null && f > 0), 99);
    const near = [...list].sort((a, b) => Math.abs(voicingMinFret(a) - lowest) - Math.abs(voicingMinFret(b) - lowest))[0];
    if (mine === null) setMine(frets);
    setFrets(near.frets);
    strum(near.frets, `chord identifier, similar chord ${name}`);
  }

  return (
    <div className="fb-tool fb-chord-finder">
      <div className="fretboard-controls">
        <span className="fb-id-shape" title="The shape, lowest string first (x is a muted string)">{shapeText(frets)}</span>
        <button className="btn-secondary" disabled={midis.length === 0} onClick={() => strum(frets, `chord identifier, strummed ${best?.name ?? shapeText(frets)}`)}>Strum</button>
        <button className="btn-ghost" disabled={midis.length === 0} onClick={() => { setFrets(tuning.map(() => null)); setMine(null); }}>Clear</button>
        {mine && (
          <button className="btn-ghost" onClick={() => { setFrets(mine); setMine(null); strum(mine, "chord identifier, back to my chord"); }}>Back to my chord</button>
        )}
      </div>
      <p className="fb-dim">Tap the fret you hold on each string (the dot left of the nut is the open string). Tap it again to mute that string. The lowest note decides the inversion.</p>

      <Neck
        marks={marks}
        title="Chord identifier"
        tuning={tuning}
        labelFor={(m) => m.label}
        scheme={scheme}
        highOnTop={highOnTop}
        dimOpacity={dim}
        onNote={tap}
      />

      <div className="fb-tool-columns">
        <section className="fretboard-about">
          <h3>Chord</h3>
          {midis.length === 0 && <p className="fb-dim">Tap some notes on the neck.</p>}
          {midis.length > 0 && matches.length === 0 && <p className="fb-dim">These notes don't make a chord this app knows. Add or change a note.</p>}
          {matches.slice(0, 5).map((c, i) => (
            <div key={c.name + i} className={`fb-id-result ${i === 0 ? "fb-id-result--best" : ""}`}>
              <strong className="fb-id-result__name">{c.name}</strong>
              <span className="fb-dim">
                {CHORDS[c.chord].name}
                {c.bass !== c.root ? `, ${plainName(c.bass)} in the bass` : ""}
                {c.missing.length > 0 ? ` (no ${c.missing.join(", ")})` : ""}
              </span>
              <button className="btn-ghost" title="Open this chord on the Chords page" onClick={() => onOpenChord(c.root, c.chord)}>Open</button>
            </div>
          ))}
          {best && (
            <ToneChips tones={CHORDS[best.chord].tones} root={best.root} scheme={scheme} onHear={(semis) => hear(() => engine.pluck(48 + mod(best.root + semis, 12)), `chord identifier, ${best.name} tone`)} />
          )}
        </section>
        {similar.length > 0 && (
          <section className="fretboard-chords">
            <h3>Similar chords</h3>
            <p className="fb-dim">One note away. Tap one to hear it and put it on the neck.</p>
            <div className="fb-chord-chips">
              {similar.map((c) => (
                <button key={c.chord} className="fb-chord-chip fb-similar-chip" title={c.how} onClick={() => trySimilar(c.root, c.chord, c.name)}>
                  {c.name}
                  <span className="fb-chord-chip__roman">{c.how}</span>
                </button>
              ))}
            </div>
          </section>
        )}
      </div>
    </div>
  );
}
