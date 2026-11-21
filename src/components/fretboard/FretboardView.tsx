import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeftIcon } from "@heroicons/react/16/solid";
import { ErrorModal } from "../ErrorModal";
import { ChordBox } from "./ChordBox";
import { Neck } from "./Neck";
import { engine } from "../../lib/fretboard/audio";
import { buildChordSequence, buildSequence, orderSteps, type Step } from "../../lib/fretboard/playback";
import { useFretSettings } from "../../lib/fretboard/settings";
import { FretSettingsModal } from "./FretSettingsModal";
import { PlayBar } from "./PlayBar";
import { useSoundFont } from "./useSoundFont";
import { colourNotes, scaleInfo } from "../../lib/fretboard/scaleInfo";
import {
  CHORDS,
  KEYS,
  SCALES,
  TUNINGS,
  arpeggioPositions,
  chordVoicings,
  diatonicChords,
  differenceFromNatural,
  intervalName,
  intervalShort,
  plainName,
  roman,
  scalePositions,
  spell,
  tonality,
  voicingMinFret,
  voicingNotes,
  wholeNeck,
  type Mark,
  type Voicing,
} from "../../lib/fretboard/theory";
import { logTrainerActivity } from "../../lib/trainerSession";

type Page = "scales" | "arpeggios" | "chords";
type LabelMode = "degree" | "note" | "both" | "interval" | "none";

const PAGES: { id: Page; label: string }[] = [
  { id: "scales", label: "Scales" },
  { id: "arpeggios", label: "Arpeggios" },
  { id: "chords", label: "Chords" },
];

function groupBy<T extends { group: string }>(list: T[]): [string, T[]][] {
  const map = new Map<string, T[]>();
  for (const item of list) {
    const arr = map.get(item.group) ?? [];
    arr.push(item);
    map.set(item.group, arr);
  }
  return [...map.entries()];
}

const SCALE_GROUPS = groupBy(SCALES);
const CHORD_GROUPS = groupBy(CHORDS);

interface Props {
  onBack: () => void;
}

export function FretboardView({ onBack }: Props) {
  const [page, setPage] = useState<Page>("scales");
  const [key, setKey] = useState(0);
  const [scaleIdx, setScaleIdx] = useState(0);
  const [chordIdx, setChordIdx] = useState(0);
  const [posIdx, setPosIdx] = useState(0);
  const [labelMode, setLabelMode] = useState<LabelMode>("degree");
  const [error, setError] = useState<string | null>(null);
  const [playing, setPlaying] = useState(false);
  const [playingNote, setPlayingNote] = useState<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const { settings, update, error: settingsError, clearError } = useFretSettings();
  const showError = useCallback((m: string) => setError(m), []);
  const font = useSoundFont(settings, update, showError);

  const tuning = TUNINGS[0].strings;
  const scale = SCALES[scaleIdx];
  const chord = CHORDS[chordIdx];
  const tones = page === "scales" ? scale.tones : chord.tones;

  const scalePos = useMemo(() => scalePositions(tuning, key, scale.tones), [tuning, key, scale]);
  const arpPos = useMemo(() => arpeggioPositions(tuning, key, chord.tones), [tuning, key, chord]);
  const voicings = useMemo(() => chordVoicings(tuning, key, chord.tones), [tuning, key, chord]);

  // The choices the Position/Shape select offers on the current page.
  const choices: string[] = useMemo(() => {
    if (page === "scales") return scalePos.map((p) => p.title);
    if (page === "arpeggios") return arpPos.map((p) => p.title);
    return voicings.map((v, i) => {
      const fr = voicingNotes(v).map((n) => n[1]);
      return `Shape ${i + 1} — bass on the ${["6th", "5th", "4th"][v.bassString]} string, frets ${Math.min(...fr)}–${Math.max(...fr)}`;
    });
  }, [page, scalePos, arpPos, voicings]);
  const idx = Math.min(posIdx, Math.max(choices.length - 1, 0));

  const voicing: Voicing | undefined = page === "chords" ? voicings[idx] : undefined;
  const active = useMemo(() => {
    const notes = page === "scales" ? scalePos[idx]?.notes : page === "arpeggios" ? arpPos[idx]?.notes : voicing ? voicingNotes(voicing) : [];
    return new Set((notes ?? []).map(([s, f]) => `${s}:${f}`));
  }, [page, idx, scalePos, arpPos, voicing]);

  const marks: Mark[] = useMemo(
    () => wholeNeck(tuning, key, tones).map((m) => ({ ...m, inPosition: active.has(`${m.string}:${m.fret}`) })),
    [tuning, key, tones, active],
  );

  const colour = useMemo(() => colourNotes(scale.name, scale.tones), [scale]);
  const info = scaleInfo(scale.name);
  const diff = useMemo(() => differenceFromNatural(scale.tones), [scale]);
  const keyChords = useMemo(() => diatonicChords(scale.tones, false), [scale]);

  const title =
    page === "scales" ? `${KEYS[key]} ${scale.name}` : page === "arpeggios" ? `${KEYS[key]} ${chord.name} arpeggio` : `${KEYS[key]} ${chord.name}`;
  const posShort = (choices[idx] ?? "").split(" — ")[0];

  function hear(action: () => void, detail?: string) {
    try {
      action();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      return;
    }
    const label = PAGES.find((p) => p.id === page)?.label;
    logTrainerActivity(`Fretboard Trainer — ${label}: ${title}, ${posShort}${detail ? ` (${detail})` : ""}`);
  }

  function labelFor(m: { label: string; semis: number }): string {
    switch (labelMode) {
      case "degree": return m.label;
      case "note": return spell(key, m.semis, m.label);
      case "both": return `${m.label} ${spell(key, m.semis, m.label)}`;
      case "interval": return intervalShort(m.label);
      default: return "";
    }
  }

  function stepsOf(notes: [number, number][]): Step[] {
    return notes.map(([s, f]) => ({ midi: tuning[s] + f, string: s, fret: f }));
  }

  // What Play should sound for the current page and selection.
  function buildCurrent(countInBars: number) {
    if (page === "chords") {
      if (!voicing) throw new Error("There is no chord shape to play.");
      return buildChordSequence({ notes: stepsOf(voicingNotes(voicing)), bpm: settings.bpm, notesPerBeat: settings.notesPerBeat, countInBars, click: settings.click });
    }
    const notes = page === "scales" ? scalePos[idx]?.notes : arpPos[idx]?.notes;
    if (!notes?.length) throw new Error("There are no notes to play in this position.");
    return buildSequence({ steps: orderSteps(stepsOf(notes), settings.direction), bpm: settings.bpm, notesPerBeat: settings.notesPerBeat, countInBars, click: settings.click });
  }

  // The scale's root chord held softly under scale runs: root, 5th and the scale's own 3rd.
  function droneNotes(): number[] | null {
    if (page !== "scales" || !settings.drone) return null;
    const root = 36 + key;
    const third = scale.tones.find((t) => t.label === "3" || t.label === "b3");
    return [root, root + 7, ...(third ? [root + third.semis] : [])];
  }

  const stopPlayback = useCallback(() => {
    engine.stop();
    engine.drone(null);
    setPlaying(false);
  }, []);

  function startPlayback(countInBars: number, log = true) {
    try {
      const built = buildCurrent(countInBars);
      setPlaying(true);
      engine.drone(droneNotes());
      engine.play({
        events: built.events,
        length: built.length,
        loopFrom: built.loopFrom,
        loop: settings.loop,
        onHighlight: setPlayingNote,
        onEnd: () => {
          engine.drone(null);
          setPlaying(false);
        },
      });
    } catch (err) {
      engine.stop();
      setPlaying(false);
      setError(err instanceof Error ? err.message : String(err));
      return;
    }
    if (log) {
      const label = PAGES.find((p) => p.id === page)?.label;
      logTrainerActivity(`Fretboard Trainer — ${label}: ${title}, ${posShort} at ${settings.bpm} bpm`);
    }
  }

  function togglePlayback() {
    if (engine.playing) stopPlayback();
    else startPlayback(settings.countIn);
  }

  // Follow changes while playing: restart on the new notes or tempo without another count-in.
  const playingRef = useRef(false);
  playingRef.current = playing;
  const restartKey = [page, key, scaleIdx, chordIdx, idx, settings.bpm, settings.notesPerBeat, settings.direction, settings.loop, settings.click, settings.drone].join("|");
  const lastKey = useRef(restartKey);
  useEffect(() => {
    if (lastKey.current === restartKey) return;
    lastKey.current = restartKey;
    if (playingRef.current) startPlayback(0, false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [restartKey]);

  useEffect(() => {
    engine.onProblem = (m) => setError(m);
    return () => {
      engine.onProblem = null;
      engine.stop();
      engine.drone(null);
    };
  }, []);

  // Space plays and stops.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const t = e.target as HTMLElement | null;
      if (e.code !== "Space" || (t && ["INPUT", "TEXTAREA", "SELECT"].includes(t.tagName))) return;
      e.preventDefault();
      if (e.type === "keydown" && !e.repeat) togglePlayback();
    }
    window.addEventListener("keydown", onKey);
    window.addEventListener("keyup", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("keyup", onKey);
    };
  });

  function playKeyChord(degreeIdx: number, chordI: number) {
    const c = CHORDS[chordI];
    const root = (key + scale.tones[degreeIdx].semis) % 12;
    const v = chordVoicings(tuning, root, c.tones)[0];
    if (!v) throw new Error(`No playable shape found for ${c.name}.`);
    engine.strumNow(voicingNotes(v).map(([s, f]) => ({ midi: tuning[s] + f, string: s })));
  }

  function openChord(degreeIdx: number, chordI: number) {
    setKey((key + scale.tones[degreeIdx].semis) % 12);
    setChordIdx(chordI);
    setPosIdx(0);
    setPage("chords");
  }

  function goPage(p: Page) {
    setPage(p);
    setPosIdx(0);
  }

  // Left/Right arrows step through positions or shapes.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const t = e.target as HTMLElement | null;
      if (t && ["INPUT", "TEXTAREA", "SELECT"].includes(t.tagName)) return;
      if (e.key === "ArrowRight") setPosIdx(Math.min(idx + 1, choices.length - 1));
      else if (e.key === "ArrowLeft") setPosIdx(Math.max(idx - 1, 0));
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [idx, choices.length]);

  const changeNotes = diff.changes.map(([t]) => t).join(", ");
  const chordNotes = chord.tones.map((t) => ({
    note: spell(key, t.semis, t.label),
    label: t.label,
    interval: intervalName(t.label),
  }));

  return (
    <div className="fretboard-view" data-testid="fretboard-view">
      <header className="browse-header">
        <button className="btn-ghost" onClick={onBack} title="Back to session">
          <ArrowLeftIcon className="icon-sm" /> Back
        </button>
        <h1 className="browse-title">Fretboard Trainer</h1>
      </header>

      <div className="browse-tabs">
        {PAGES.map((p) => (
          <button key={p.id} className={`browse-tab fb-tab ${page === p.id ? "active" : ""}`} onClick={() => goPage(p.id)}>
            {p.label}
          </button>
        ))}
      </div>

      <div className="fretboard-body">
        <div className="fretboard-main">
          <div className="fretboard-keys" role="group" aria-label="Key">
            {KEYS.map((k, i) => (
              <button key={k} className={`fb-key ${i === key ? "active" : ""}`} onClick={() => { setKey(i); setPosIdx(0); }}>
                {k}
              </button>
            ))}
          </div>

          <div className="fretboard-controls">
            {page === "scales" ? (
              <label>
                Scale
                <select aria-label="Scale" value={scaleIdx} onChange={(e) => { setScaleIdx(parseInt(e.target.value)); setPosIdx(0); }}>
                  {SCALE_GROUPS.map(([group, list]) => (
                    <optgroup key={group} label={group}>
                      {list.map((s) => (
                        <option key={s.name} value={SCALES.indexOf(s)}>{s.name}</option>
                      ))}
                    </optgroup>
                  ))}
                </select>
              </label>
            ) : (
              <label>
                Chord type
                <select aria-label="Chord type" value={chordIdx} onChange={(e) => { setChordIdx(parseInt(e.target.value)); setPosIdx(0); }}>
                  {CHORD_GROUPS.map(([group, list]) => (
                    <optgroup key={group} label={group}>
                      {list.map((c) => (
                        <option key={c.name} value={CHORDS.indexOf(c)}>{c.name}</option>
                      ))}
                    </optgroup>
                  ))}
                </select>
              </label>
            )}
            <label>
              {page === "chords" ? "Shape" : "Position"}
              <select aria-label={page === "chords" ? "Shape" : "Position"} value={idx} onChange={(e) => setPosIdx(parseInt(e.target.value))}>
                {choices.map((c, i) => (
                  <option key={i} value={i}>{c}</option>
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
            {page === "chords" && voicing && (
              <div className="fretboard-actions">
                <button className="btn-secondary" onClick={() => hear(() => engine.strumNow(voicingNotes(voicing).map(([s, f]) => ({ midi: tuning[s] + f, string: s }))))}>Strum</button>
                <button className="btn-primary" onClick={togglePlayback}>{playing ? "Stop" : "Play"}</button>
              </div>
            )}
          </div>

          <h2 className="fretboard-title">{title}</h2>
          <p className="fretboard-tonality">
            {page === "scales" ? (
              <>
                {tonality(scale.tones)} —{" "}
                {diff.changes.length === 0 ? `the ${diff.parent.toLowerCase()} scale itself` : `compared with ${diff.parent}: ${changeNotes}`}
              </>
            ) : (
              <>
                {KEYS[key]}
                {chord.symbol} — {chord.group}
              </>
            )}
          </p>

          <Neck
            marks={marks}
            title={title}
            labelFor={labelFor}
            colourLabels={page === "scales" ? colour.labels : []}
            playing={playingNote}
            onNote={(m) => hear(() => engine.pluck(m.midi, m.string))}
          />
        </div>

        <aside className="fretboard-side">
          {page === "chords" && voicing && (
            <section className="fretboard-about">
              <h3>Chord shape</h3>
              <ChordBox voicing={voicing} names={tuning.map((_, s) => (voicing.frets[s] === null ? "" : plainName(tuning[s] + (voicing.frets[s] ?? 0))))} />
              <p className="fb-dim">Lowest fret {voicingMinFret(voicing)}</p>
            </section>
          )}

          <section className="fretboard-about">
            {page === "scales" ? (
              <>
                <h3>About this scale</h3>
                {info ? (
                  <>
                    <p>{info.sound}</p>
                    <p><strong>Use it:</strong> {info.useIt}</p>
                    {info.heardIn.length > 0 && <p><strong>Heard in:</strong> {info.heardIn.join(" · ")}</p>}
                  </>
                ) : (
                  <p className="fb-dim">{scale.group}.</p>
                )}
                {colour.labels.length > 0 && (
                  <p><strong>Colour notes:</strong> {colour.labels.join(", ")} (ringed in gold on the neck)</p>
                )}
                {colour.explanation && <p>{colour.explanation}</p>}
              </>
            ) : (
              <>
                <h3>Notes of {KEYS[key]}{chord.symbol}</h3>
                <ul className="fb-note-list">
                  {chordNotes.map((n) => (
                    <li key={n.label}>
                      <strong>{n.note}</strong> — {n.interval} <span className="fb-dim">({n.label})</span>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </section>

          {page === "scales" && keyChords.length > 0 && (
            <section className="fretboard-chords">
              <h3>Chords in this key</h3>
              <div className="fb-chord-chips">
                {keyChords.map(([d, c]) => {
                  const cd = CHORDS[c];
                  const name = spell(key, scale.tones[d].semis, scale.tones[d].label) + cd.symbol;
                  return (
                    <button
                      key={d}
                      className="fb-chord-chip"
                      title={`Click to hear ${name}, double-click to open it on the Chords page`}
                      onClick={() => hear(() => playKeyChord(d, c), `chord ${name}`)}
                      onDoubleClick={() => openChord(d, c)}
                    >
                      {name}
                      <span className="fb-chord-chip__roman">{roman(d, cd)}</span>
                    </button>
                  );
                })}
              </div>
            </section>
          )}
        </aside>
      </div>

      <PlayBar
        settings={settings}
        update={update}
        playing={playing}
        soundName={font.presets.find((p) => p.bank === settings.preset[0] && p.program === settings.preset[1])?.name ?? "SoundFont"}
        onToggle={togglePlayback}
        onSettings={() => setSettingsOpen(true)}
      />

      {settingsOpen && (
        <FretSettingsModal
          settings={settings}
          update={update}
          presets={font.presets}
          fontLoading={font.loading}
          userFonts={font.userFonts}
          onAddFont={font.add}
          onRemoveFont={font.remove}
          onClose={() => setSettingsOpen(false)}
        />
      )}
      {settingsError && <ErrorModal error={settingsError} onDismiss={clearError} />}
      {error && <ErrorModal error={error} onDismiss={() => setError(null)} />}
    </div>
  );
}
