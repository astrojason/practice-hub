import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeftIcon } from "@heroicons/react/16/solid";
import { ErrorModal } from "../ErrorModal";
import { ChordBox } from "./ChordBox";
import { FretSettingsModal } from "./FretSettingsModal";
import { Neck } from "./Neck";
import { PlayBar } from "./PlayBar";
import { ProgressionPanel } from "./ProgressionPanel";
import { useSoundFont } from "./useSoundFont";
import { engine } from "../../lib/fretboard/audio";
import { buildChordSequence, buildSequence, orderSteps, type Step } from "../../lib/fretboard/playback";
import { buildProgression, chordRoot, progVoicings, suitedProgression, type ProgChord } from "../../lib/fretboard/progression";
import { colourNotes, scaleInfo } from "../../lib/fretboard/scaleInfo";
import { useFretSettings } from "../../lib/fretboard/settings";
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
  type Voicing,
} from "../../lib/fretboard/theory";
import { useProgression } from "../../lib/fretboard/useProgression";
import { computeView, type Page } from "../../lib/fretboard/view";
import { logTrainerActivity } from "../../lib/trainerSession";

const PAGES: { id: Page; label: string }[] = [
  { id: "scales", label: "Scales" },
  { id: "arpeggios", label: "Arpeggios" },
  { id: "chords", label: "Chords" },
  { id: "progressions", label: "Progressions" },
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
  const [focus, setFocus] = useState(false);
  const [systemDark, setSystemDark] = useState(() => window.matchMedia?.("(prefers-color-scheme: dark)").matches ?? true);
  const [error, setError] = useState<string | null>(null);
  const [playing, setPlaying] = useState(false);
  const [playingNote, setPlayingNote] = useState<string | null>(null);
  const [markerIdx, setMarkerIdx] = useState<number | null>(null);
  const [selectedChord, setSelectedChord] = useState<number | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const { settings, update, error: settingsError, clearError } = useFretSettings();
  const prog = useProgression();
  const showError = useCallback((m: string) => setError(m), []);
  const font = useSoundFont(settings, update, showError);

  const tuning = TUNINGS[settings.tuning]?.strings ?? TUNINGS[0].strings;
  const labelMode = settings.labels;
  const scale = SCALES[scaleIdx];
  const chord = CHORDS[chordIdx];
  const scaleLike = page === "scales" || page === "progressions";

  const scalePos = useMemo(() => scalePositions(tuning, key, scale.tones), [tuning, key, scale]);
  const arpPos = useMemo(() => arpeggioPositions(tuning, key, chord.tones), [tuning, key, chord]);
  const voicings = useMemo(() => chordVoicings(tuning, key, chord.tones), [tuning, key, chord]);

  // The choices the Position/Shape select offers on the current page.
  const choices: string[] = useMemo(() => {
    if (scaleLike) return scalePos.map((p) => p.title);
    if (page === "arpeggios") return arpPos.map((p) => p.title);
    return voicings.map((v, i) => {
      const fr = voicingNotes(v).map((n) => n[1]);
      return `Shape ${i + 1} — bass on the ${["6th", "5th", "4th"][v.bassString]} string, frets ${Math.min(...fr)}–${Math.max(...fr)}`;
    });
  }, [page, scaleLike, scalePos, arpPos, voicings]);
  const idx = Math.min(posIdx, Math.max(choices.length - 1, 0));

  // The progression under this page: the one on the Progressions page, or on the
  // Scales page one that suits the scale.
  const overlay = page !== "progressions" && settings.playOver;
  const progMode = page === "progressions" || overlay;
  const suited = useMemo(() => suitedProgression(scaleIdx), [scaleIdx]);
  const activeProg: ProgChord[] = page === "scales" && overlay && settings.suitScale ? suited : prog.chords;

  const curIdx = progMode ? (playing ? markerIdx : page === "progressions" ? selectedChord : null) : null;
  const chordNow = curIdx !== null ? activeProg[curIdx] : undefined;

  const view = useMemo(
    () =>
      computeView({
        page, key, scaleIdx, chordIdx, idx, tuning, scalePos, arpPos, voicings, chordNow,
        overlay: overlay && playing, follow: settings.follow, focus: settings.focus,
        hiddenDegrees: settings.hiddenDegrees, hiddenStrings: settings.hiddenStrings, ghosts: settings.ghosts,
        showPrev: settings.showPrev, showNext: settings.showNext, connect: settings.connect, connectStrings: settings.connectStrings,
        blendScale: settings.blendScale, blendRoot: settings.blendRoot,
      }),
    [page, key, scaleIdx, chordIdx, idx, tuning, scalePos, arpPos, voicings, chordNow, overlay, playing, settings.follow, settings.focus, settings.hiddenDegrees, settings.hiddenStrings, settings.ghosts, settings.showPrev, settings.showNext, settings.connect, settings.connectStrings, settings.blendScale, settings.blendRoot],
  );
  const voicing: Voicing | undefined = view.voicing;

  const colour = useMemo(() => colourNotes(scale.name, scale.tones), [scale]);
  const info = scaleInfo(scale.name);
  const diff = useMemo(() => differenceFromNatural(scale.tones), [scale]);
  const keyChords = useMemo(() => diatonicChords(scale.tones, false), [scale]);

  const title =
    scaleLike ? `${KEYS[key]} ${scale.name}` : page === "arpeggios" ? `${KEYS[key]} ${chord.name} arpeggio` : `${KEYS[key]} ${chord.name}`;
  const posShort = (choices[idx] ?? "").split(" — ")[0];
  const pageLabel = PAGES.find((p) => p.id === page)?.label;

  function hear(action: () => void, detail?: string) {
    try {
      action();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      return;
    }
    logTrainerActivity(`Fretboard Trainer — ${pageLabel}: ${title}, ${posShort}${detail ? ` (${detail})` : ""}`);
  }

  function labelFor(m: { label: string; semis: number }): string {
    switch (labelMode) {
      case "degree": return m.label;
      case "note": return spell(view.root, m.semis, m.label);
      case "both": return `${m.label} ${spell(view.root, m.semis, m.label)}`;
      case "interval": return intervalShort(m.label);
      default: return "";
    }
  }

  function strumVoicing(v: Voicing) {
    engine.strumNow(voicingNotes(v).map(([s, f]) => ({ midi: tuning[s] + f, string: s })));
  }

  function playKeyChord(degreeIdx: number, chordI: number) {
    const c = CHORDS[chordI];
    const root = (key + scale.tones[degreeIdx].semis) % 12;
    const v = chordVoicings(tuning, root, c.tones)[0];
    if (!v) throw new Error(`No playable shape found for ${c.name}.`);
    strumVoicing(v);
  }

  function hearProgChord(i: number) {
    const c = prog.chords[i];
    if (!c) return;
    const v = progVoicings({ tuning, key, chords: [c], nearFret: 3 })[0];
    if (!v) {
      setError(`No playable shape found for ${plainName(chordRoot(key, c))}${CHORDS[c.chord].symbol}.`);
      return;
    }
    hear(() => strumVoicing(v), `chord ${plainName(chordRoot(key, c))}${CHORDS[c.chord].symbol}`);
  }

  function openChord(degreeIdx: number, chordI: number) {
    setKey((key + scale.tones[degreeIdx].semis) % 12);
    setChordIdx(chordI);
    setPosIdx(0);
    setPage("chords");
  }

  function goPage(p: Page) {
    if (playing) stopPlayback();
    setPage(p);
    setPosIdx(0);
  }

  function stepsOf(notes: [number, number][]): Step[] {
    return notes.map(([s, f]) => ({ midi: tuning[s] + f, string: s, fret: f }));
  }

  // The fret the hand is around, so progression shapes stay close to it.
  function anchorFret(): number {
    if (page === "chords" && voicings[idx]) return voicingMinFret(voicings[idx]);
    const notes = scaleLike ? scalePos[idx]?.notes : arpPos[idx]?.notes;
    return notes?.length ? Math.min(...notes.map((n) => n[1])) : 3;
  }

  // What Play should sound for the current page and selection.
  function buildCurrent(countInBars: number) {
    if (progMode) {
      if (activeProg.length === 0) throw new Error("The progression has no chords. Choose a preset or add some chords first.");
      const voicingsNow = progVoicings({ tuning, key, chords: activeProg, nearFret: anchorFret() });
      return buildProgression(
        {
          tuning, key, chords: activeProg, defaultBeats: settings.beatsPerChord, bpm: settings.bpm, notesPerBeat: settings.notesPerBeat,
          comp: settings.comp, drums: settings.drums, click: settings.click, countInBars,
        },
        voicingsNow,
      );
    }
    if (page === "chords") {
      if (!voicing) throw new Error("There is no chord shape to play.");
      return buildChordSequence({ notes: stepsOf(voicingNotes(voicing)), bpm: settings.bpm, notesPerBeat: settings.notesPerBeat, countInBars, click: settings.click });
    }
    const notes = page === "scales" ? view.runNotes : page === "arpeggios" ? arpPos[idx]?.notes : scalePos[idx]?.notes;
    if (!notes?.length) throw new Error("There are no notes to play in this position.");
    return buildSequence({ steps: orderSteps(stepsOf(notes), settings.direction), bpm: settings.bpm, notesPerBeat: settings.notesPerBeat, countInBars, click: settings.click });
  }

  // The scale's root chord held softly under scale runs: root, 5th and the scale's own 3rd.
  function droneNotes(): number[] | null {
    if (page !== "scales" || !settings.drone || progMode) return null;
    const root = 36 + key;
    const third = scale.tones.find((t) => t.label === "3" || t.label === "b3");
    return [root, root + 7, ...(third ? [root + third.semis] : [])];
  }

  const stopPlayback = useCallback(() => {
    engine.stop();
    engine.drone(null);
    setPlaying(false);
    setMarkerIdx(null);
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
        onMarker: (code) => setMarkerIdx(parseInt(code)),
        onEnd: () => {
          engine.drone(null);
          setPlaying(false);
          setMarkerIdx(null);
        },
      });
    } catch (err) {
      engine.stop();
      setPlaying(false);
      setError(err instanceof Error ? err.message : String(err));
      return;
    }
    if (log) {
      const over = progMode ? ` over ${prog.name || "a progression"}` : "";
      logTrainerActivity(`Fretboard Trainer — ${pageLabel}: ${title}, ${posShort} at ${settings.bpm} bpm${over}`);
    }
  }

  function togglePlayback() {
    if (engine.playing) stopPlayback();
    else startPlayback(settings.countIn);
  }

  // Follow changes while playing: restart on the new notes or tempo without another count-in.
  const playingRef = useRef(false);
  playingRef.current = playing;
  const restartKey = [
    page, key, scaleIdx, chordIdx, idx, settings.bpm, settings.notesPerBeat, settings.direction, settings.loop, settings.click, settings.drone,
    settings.comp, settings.drums, settings.beatsPerChord, settings.playOver, settings.suitScale, JSON.stringify(activeProg),
  ].join("|");
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

  // Space plays and stops; Left/Right step through positions or shapes.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const t = e.target as HTMLElement | null;
      if (t && ["INPUT", "TEXTAREA", "SELECT"].includes(t.tagName)) return;
      if (e.code === "Space") {
        e.preventDefault();
        if (e.type === "keydown" && !e.repeat) togglePlayback();
      } else if (e.type === "keydown" && (e.key === "f" || e.key === "F") && !e.metaKey && !e.ctrlKey && !e.altKey) setFocus((f) => !f);
      else if (e.type === "keydown" && e.key === "Escape" && focus) setFocus(false);
      else if (e.type === "keydown" && e.key === "ArrowRight") setPosIdx(Math.min(idx + 1, choices.length - 1));
      else if (e.type === "keydown" && e.key === "ArrowLeft") setPosIdx(Math.max(idx - 1, 0));
    }
    window.addEventListener("keydown", onKey);
    window.addEventListener("keyup", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("keyup", onKey);
    };
  });

  useEffect(() => {
    const mq = window.matchMedia?.("(prefers-color-scheme: dark)");
    if (!mq) return;
    const on = () => setSystemDark(mq.matches);
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);
  const theme = settings.theme === "system" ? (systemDark ? "dark" : "light") : settings.theme;

  function stepPosition(delta: number) {
    setPosIdx(Math.max(0, Math.min(idx + delta, choices.length - 1)));
  }

  const changeNotes = diff.changes.map(([t]) => t).join(", ");
  const chordNotes = chord.tones.map((t) => ({
    note: spell(key, t.semis, t.label),
    label: t.label,
    interval: intervalName(t.label),
  }));

  return (
    <div className="fretboard-view" data-testid="fretboard-view" data-theme={theme}>
      {focus && (
        <div className="fb-focusbar" role="toolbar" aria-label="Focus mode">
          <button className="btn-secondary" onClick={() => setFocus(false)}>Leave focus (Esc)</button>
          <button className={playing ? "btn-secondary" : "btn-primary"} onClick={togglePlayback}>{playing ? "Stop" : "Play"}</button>
          <label className="fb-playbar__bpm">
            <input type="number" min={30} max={300} aria-label="Focus tempo (bpm)" value={settings.bpm} onChange={(e) => update({ bpm: Math.max(30, Math.min(300, parseInt(e.target.value) || settings.bpm)) })} />
            bpm
          </label>
          {page !== "progressions" && (
            <>
              <button className="btn-ghost" onClick={() => stepPosition(-1)} aria-label="Previous position">◀</button>
              <button className="btn-ghost" onClick={() => stepPosition(1)} aria-label="Next position">▶</button>
            </>
          )}
          {page === "progressions" && (
            <label className="fb-playbar__field">
              Follow the chords
              <select aria-label="Focus follow" value={settings.follow} onChange={(e) => update({ follow: e.target.value as typeof settings.follow })}>
                <option value="off">Off</option>
                <option value="chordscale">Scale</option>
                <option value="arpeggio">Arpeggio</option>
              </select>
            </label>
          )}
          <span className="fb-focusbar__label">FOCUS MODE</span>
        </div>
      )}
      {!focus && (
      <header className="browse-header">
        <button className="btn-ghost" onClick={onBack} title="Back to session">
          <ArrowLeftIcon className="icon-sm" /> Back
        </button>
        <h1 className="browse-title">Fretboard Trainer</h1>
        <button className="btn-secondary fb-focus-btn" onClick={() => setFocus(true)} title="Hide everything but the neck and play controls (F)">
          Focus
        </button>
      </header>
      )}

      {!focus && (
      <div className="browse-tabs">
        {PAGES.map((p) => (
          <button key={p.id} className={`browse-tab fb-tab ${page === p.id ? "active" : ""}`} onClick={() => goPage(p.id)}>
            {p.label}
          </button>
        ))}
      </div>
      )}

      <div className="fretboard-body">
        <div className="fretboard-main">
          {!focus && (
          <div className="fretboard-keys" role="group" aria-label="Key">
            {KEYS.map((k, i) => (
              <button key={k} className={`fb-key ${i === key ? "active" : ""}`} onClick={() => { setKey(i); setPosIdx(0); }}>
                {k}
              </button>
            ))}
          </div>
          )}

          {!focus && (
          <div className="fretboard-controls">
            {scaleLike ? (
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
              <select aria-label="Labels" value={labelMode} onChange={(e) => update({ labels: e.target.value as typeof settings.labels })}>
                <option value="degree">Degree (1, b3, 5)</option>
                <option value="note">Note name</option>
                <option value="both">Degree and note</option>
                <option value="interval">Interval (R, m3, P5)</option>
                <option value="none">None</option>
              </select>
            </label>
            {page === "chords" && voicing && (
              <div className="fretboard-actions">
                <button className="btn-secondary" onClick={() => hear(() => strumVoicing(voicing))}>Strum</button>
                <button className="btn-primary" onClick={togglePlayback}>{playing ? "Stop" : "Play"}</button>
              </div>
            )}
          </div>
          )}

          {!focus && page !== "chords" && (
            <div className="fretboard-controls fb-neck-controls">
              <label className="fb-playbar__check">
                <input type="checkbox" checked={settings.showPrev} onChange={(e) => update({ showPrev: e.target.checked })} /> Show previous
              </label>
              <label className="fb-playbar__check">
                <input type="checkbox" checked={settings.showNext} onChange={(e) => update({ showNext: e.target.checked })} /> Show next
              </label>
              {page === "scales" && (
                <>
                  <label>
                    Connect to
                    <select aria-label="Connect to" value={settings.connect} onChange={(e) => update({ connect: e.target.value as typeof settings.connect })}>
                      <option value="off">Nothing</option>
                      <option value="next">Next position</option>
                      <option value="prev">Previous position</option>
                    </select>
                  </label>
                  {settings.connect !== "off" && (
                    <div className="fb-chip-row" role="group" aria-label="Connect along">
                      {tuning.map((open, s) => {
                        const on = settings.connectStrings.includes(s);
                        return (
                          <button
                            key={s}
                            className={`fb-chip ${on ? "fb-chip--on" : ""}`}
                            aria-label={`Connect along string ${s + 1}`}
                            aria-pressed={on}
                            onClick={() => update({ connectStrings: on ? settings.connectStrings.filter((x) => x !== s) : [...settings.connectStrings, s] })}
                          >
                            {plainName(open)}
                          </button>
                        );
                      })}
                    </div>
                  )}
                  <label>
                    Blend with
                    <select aria-label="Blend with" value={settings.blendScale} onChange={(e) => update({ blendScale: parseInt(e.target.value) })}>
                      <option value={-1}>None</option>
                      {SCALE_GROUPS.map(([group, list]) => (
                        <optgroup key={group} label={group}>
                          {list.map((sc) => (
                            <option key={sc.name} value={SCALES.indexOf(sc)}>{sc.name}</option>
                          ))}
                        </optgroup>
                      ))}
                    </select>
                  </label>
                  {settings.blendScale >= 0 && (
                    <label>
                      Blend root
                      <select aria-label="Blend root" value={settings.blendRoot} onChange={(e) => update({ blendRoot: parseInt(e.target.value) })}>
                        {KEYS.map((_, semis) => (
                          <option key={semis} value={semis}>{plainName(key + semis)}</option>
                        ))}
                      </select>
                    </label>
                  )}
                </>
              )}
            </div>
          )}

          {!focus && page === "progressions" && (
            <ProgressionPanel
              prog={prog}
              keyIdx={key}
              scaleIdx={scaleIdx}
              onScale={(i) => { setScaleIdx(i); setPosIdx(0); }}
              settings={settings}
              update={update}
              selected={selectedChord}
              onSelect={setSelectedChord}
              playingIndex={playing ? markerIdx : null}
              onHear={hearProgChord}
            />
          )}

          <h2 className="fretboard-title">{title}</h2>
          <p className="fretboard-tonality">
            {scaleLike ? (
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
          <p className="fb-prog-now">{view.nowLine ?? ""}</p>

          <Neck
            marks={view.marks}
            title={title}
            tuning={tuning}
            labelFor={labelFor}
            colourLabels={view.plainScale ? colour.labels : []}
            playing={playingNote}
            scheme={settings.scheme}
            highOnTop={settings.highOnTop}
            zoomWindow={settings.zoom ? view.window : null}
            dimOpacity={settings.dim}
            onNote={(m) => hear(() => engine.pluck(m.midi, m.string))}
          />

          {focus && page === "progressions" && (
            <div className="fb-chord-cards" aria-label="Progression">
              {activeProg.map((c, i) => (
                <span key={i} className={`fb-chord-card ${playing && markerIdx === i ? "fb-chord-card--playing" : ""}`}>
                  <span className="fb-chord-card__name">{plainName(chordRoot(key, c)) + CHORDS[c.chord].symbol}</span>
                </span>
              ))}
            </div>
          )}
        </div>

        {!focus && (
        <aside className="fretboard-side">
          {page === "chords" && voicing && (
            <section className="fretboard-about">
              <h3>Chord shape</h3>
              <ChordBox voicing={voicing} names={tuning.map((_, s) => (voicing.frets[s] === null ? "" : plainName(tuning[s] + (voicing.frets[s] ?? 0))))} />
              <p className="fb-dim">Lowest fret {voicingMinFret(voicing)}</p>
            </section>
          )}

          <section className="fretboard-about">
            {scaleLike ? (
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
        )}
      </div>

      <PlayBar
        page={page}
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
      {prog.error && <ErrorModal error={prog.error} onDismiss={prog.clearError} />}
      {error && <ErrorModal error={error} onDismiss={() => setError(null)} />}
    </div>
  );
}
