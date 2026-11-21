import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ConfirmModal } from "../ConfirmModal";
import { ErrorModal } from "../ErrorModal";
import { INSTRUMENTS, engine, type SoundFontPreset } from "../../lib/fretboard/audio";
import { availableVoices, speak, voiceBackend } from "../../lib/fretboard/voice";
import { SCHEMES } from "../../lib/fretboard/schemes";
import type { FretSettings, LabelMode } from "../../lib/fretboard/settings";
import { TUNINGS, plainName } from "../../lib/fretboard/theory";
import { QUIZ_KINDS } from "../../lib/fretboard/quiz";
import type { Weakness } from "../../lib/fretboard/weakness";
import { degreeColour } from "../../lib/fretboard/schemes";

interface Props {
  settings: FretSettings;
  update: (p: Partial<FretSettings>) => void;
  presets: SoundFontPreset[];
  fontLoading: boolean;
  userFonts: string[];
  onAddFont: (file: File) => void;
  onRemoveFont: (name: string) => void;
  weak: Weakness;
  onClose: () => void;
}

export function FretSettingsModal({ settings, update, presets, fontLoading, userFonts, onAddFont, onRemoveFont, weak, onClose }: Props) {
  const [error, setError] = useState<string | null>(null);
  const [confirmRemove, setConfirmRemove] = useState<string | null>(null);
  const [outputs, setOutputs] = useState<{ id: string; label: string }[]>([]);
  const [output, setOutput] = useState("default");
  const [mics, setMics] = useState<{ inputs: string[]; default: string | null } | null>(null);
  const lookForMics = () =>
    voiceBackend()
      .inputs()
      .then(setMics)
      .catch((err) => setMicNote(err instanceof Error ? err.message : String(err)));
  const [micNote, setMicNote] = useState<string | null>(null);
  useEffect(() => {
    void lookForMics();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>(() => availableVoices());
  useEffect(() => {
    // Voices can arrive after the page loads.
    const synth = window.speechSynthesis;
    if (!synth) return;
    const on = () => setVoices(availableVoices());
    synth.addEventListener("voiceschanged", on);
    return () => synth.removeEventListener("voiceschanged", on);
  }, []);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape" && !error && !confirmRemove) onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, error, confirmRemove]);

  useEffect(() => {
    if (!engine.canChooseOutput) return;
    engine.outputDevices().then(setOutputs).catch((err) => setError(err instanceof Error ? err.message : String(err)));
  }, []);

  function fail(err: unknown) {
    setError(err instanceof Error ? err.message : String(err));
  }

  const soundValue = settings.instrument === "sf" ? "sf" : settings.instrument;
  const guitarPresets = presets.filter((p) => p.guitar);
  const otherPresets = presets.filter((p) => !p.guitar);

  return createPortal(
    <div className="error-modal-overlay" onClick={onClose}>
      <div className="error-modal fb-settings" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-label="Fretboard settings">
        <div className="error-modal-header">
          <h3 className="error-modal-title" style={{ color: "var(--text)" }}>Fretboard settings</h3>
          <button className="error-modal-close" onClick={onClose} aria-label="Close settings">✕</button>
        </div>

        <section className="fb-settings__section">
          <h4>Appearance</h4>
          <label>
            Theme
            <select aria-label="Theme" value={settings.theme} onChange={(e) => update({ theme: e.target.value as FretSettings["theme"] })}>
              <option value="dark">Dark</option>
              <option value="light">Light</option>
              <option value="system">Same as the computer</option>
            </select>
          </label>
          <label>
            Degree colours
            <select aria-label="Degree colours" value={settings.scheme} onChange={(e) => update({ scheme: parseInt(e.target.value) })}>
              {SCHEMES.map((sc, i) => (
                <option key={sc.name} value={i}>{sc.name}</option>
              ))}
            </select>
            <span className="fb-swatches">
              {[1, 2, 3, 4, 5, 6, 7].map((f) => (
                <span key={f} className="fb-swatch" style={{ background: degreeColour(settings.scheme, f, false).fill }} />
              ))}
            </span>
          </label>
          <label>
            Note labels
            <select aria-label="Note labels" value={settings.labels} onChange={(e) => update({ labels: e.target.value as LabelMode })}>
              <option value="degree">Degree (1, b3, 5)</option>
              <option value="note">Note name</option>
              <option value="both">Degree and note</option>
              <option value="interval">Interval (R, m3, P5)</option>
              <option value="none">None</option>
            </select>
          </label>
        </section>

        <section className="fb-settings__section">
          <h4>The neck</h4>
          <label>
            Tuning
            <select aria-label="Tuning" value={settings.tuning} onChange={(e) => update({ tuning: parseInt(e.target.value) })}>
              {TUNINGS.map((t, i) => (
                <option key={t.name} value={i}>{t.name}</option>
              ))}
            </select>
          </label>
          <label className="fb-settings__check">
            <input type="checkbox" checked={settings.highOnTop} onChange={(e) => update({ highOnTop: e.target.checked })} />
            High E string on top
          </label>
          <label className="fb-settings__check">
            <input type="checkbox" checked={settings.zoom} onChange={(e) => update({ zoom: e.target.checked })} />
            Give the chosen position more room
          </label>
          <label className="fb-settings__check">
            <input type="checkbox" checked={settings.ghosts} onChange={(e) => update({ ghosts: e.target.checked })} />
            Show the scale's other notes, faintly
          </label>
          <label className="fb-settings__check">
            <input type="checkbox" checked={settings.showWeak} onChange={(e) => update({ showWeak: e.target.checked })} />
            Mark my weak spots from the quiz (!)
          </label>
          <label>
            Dim the rest
            <input type="range" min={0} max={1} step={0.01} aria-label="Dim the rest" value={settings.dim} onChange={(e) => update({ dim: parseFloat(e.target.value) })} />
          </label>
          <div className="fb-settings__row">
            <span className="fb-settings__label">Show degrees</span>
            {[1, 2, 3, 4, 5, 6, 7].map((f) => {
              const on = !settings.hiddenDegrees.includes(f);
              return (
                <button
                  key={f}
                  className={`fb-chip ${on ? "fb-chip--on" : ""}`}
                  aria-label={`Show degree ${f}`}
                  aria-pressed={on}
                  style={on ? { borderColor: degreeColour(settings.scheme, f, false).fill } : undefined}
                  onClick={() => update({ hiddenDegrees: on ? [...settings.hiddenDegrees, f] : settings.hiddenDegrees.filter((d) => d !== f) })}
                >
                  {f === 1 ? "R" : f}
                </button>
              );
            })}
          </div>
          <div className="fb-settings__row">
            <span className="fb-settings__label">Show strings</span>
            {TUNINGS[settings.tuning].strings.map((open, s) => {
              const on = !settings.hiddenStrings.includes(s);
              const name = s === 5 && open % 12 === TUNINGS[settings.tuning].strings[0] % 12 ? plainName(open).toLowerCase() : plainName(open);
              return (
                <button
                  key={s}
                  className={`fb-chip ${on ? "fb-chip--on" : ""}`}
                  aria-label={`Show string ${s + 1}`}
                  aria-pressed={on}
                  onClick={() => update({ hiddenStrings: on ? [...settings.hiddenStrings, s] : settings.hiddenStrings.filter((x) => x !== s) })}
                >
                  {name}
                </button>
              );
            })}
          </div>
        </section>

        <section className="fb-settings__section">
          <h4>Sound</h4>
          <label>
            Guitar sound
            <select aria-label="Guitar sound" value={soundValue} onChange={(e) => update({ instrument: e.target.value })}>
              <optgroup label="Built-in (synthesised)">
                {INSTRUMENTS.map((i) => (
                  <option key={i.id} value={i.id}>{i.name}</option>
                ))}
              </optgroup>
              <optgroup label="Real instruments">
                <option value="sf">Real guitar samples (SoundFont)</option>
              </optgroup>
            </select>
          </label>

          {settings.instrument === "sf" && (
            <>
              <label>
                SoundFont
                <select aria-label="SoundFont" value={settings.soundFont} onChange={(e) => update({ soundFont: e.target.value })}>
                  <option value="bundled">GeneralUser GS (bundled)</option>
                  {userFonts.map((f) => (
                    <option key={f} value={f}>{f}</option>
                  ))}
                </select>
              </label>
              <label>
                Instrument
                <select
                  aria-label="SoundFont instrument"
                  value={`${settings.preset[0]}:${settings.preset[1]}`}
                  disabled={fontLoading || presets.length === 0}
                  onChange={(e) => {
                    const [bank, program] = e.target.value.split(":").map(Number);
                    update({ preset: [bank, program], presetName: presets.find((p) => p.bank === bank && p.program === program)?.name ?? "" });
                  }}
                >
                  {guitarPresets.length > 0 && (
                    <optgroup label="Guitars">
                      {guitarPresets.map((p) => (
                        <option key={`${p.bank}:${p.program}`} value={`${p.bank}:${p.program}`}>{p.name}</option>
                      ))}
                    </optgroup>
                  )}
                  <optgroup label="Everything else">
                    {otherPresets.map((p) => (
                      <option key={`${p.bank}:${p.program}`} value={`${p.bank}:${p.program}`}>{p.name}</option>
                    ))}
                  </optgroup>
                </select>
              </label>
              {fontLoading && <p className="fb-dim" role="status">Loading the SoundFont…</p>}
              <div className="fb-settings__row">
                <input
                  ref={fileRef}
                  type="file"
                  accept=".sf2"
                  hidden
                  aria-label="Add a SoundFont file"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) onAddFont(f);
                    e.target.value = "";
                  }}
                />
                <button className="btn-secondary" onClick={() => fileRef.current?.click()}>+ Add SoundFont (.sf2)</button>
                {settings.soundFont !== "bundled" && (
                  <button className="btn-ghost" onClick={() => setConfirmRemove(settings.soundFont)}>Remove this SoundFont</button>
                )}
                <a className="fb-dim" href="https://musical-artifacts.com/artifacts?formats=sf2&tags=guitar" target="_blank" rel="noreferrer">Free guitar SoundFonts</a>
              </div>
            </>
          )}

          <label>
            Tone (warm to bright)
            <input type="range" min={0} max={1} step={0.01} aria-label="Tone" value={settings.brightness} onChange={(e) => update({ brightness: parseFloat(e.target.value) })} />
          </label>
          <label>
            Room reverb
            <input type="range" min={0} max={1} step={0.01} aria-label="Room reverb" value={settings.reverb} onChange={(e) => update({ reverb: parseFloat(e.target.value) })} />
          </label>
          <label className="fb-settings__check">
            <input type="checkbox" checked={settings.fingers} onChange={(e) => update({ fingers: e.target.checked })} />
            Fingers instead of a pick (built-in guitars)
          </label>
          <label>
            Drone volume
            <input type="range" min={0} max={1} step={0.01} aria-label="Drone volume" value={settings.droneVolume} onChange={(e) => update({ droneVolume: parseFloat(e.target.value) })} />
          </label>
          <label>
            Voice
            <select
              aria-label="Voice"
              value={settings.voiceName}
              onChange={(e) => {
                update({ voiceName: e.target.value });
                try {
                  speak("G major", settings.voiceRate, e.target.value);
                } catch (err) {
                  fail(err);
                }
              }}
            >
              <option value="">System default</option>
              {voices.map((v) => (
                <option key={v.voiceURI} value={v.name}>{v.name} ({v.lang})</option>
              ))}
            </select>
            <span className="fb-dim">More voices: System Settings &gt; Accessibility &gt; Spoken Content &gt; System Voice &gt; Manage Voices.</span>
          </label>
          <label>
            Voice speed
            <input
              type="range"
              min={90}
              max={260}
              step={5}
              aria-label="Voice speed"
              value={settings.voiceRate}
              onChange={(e) => update({ voiceRate: parseInt(e.target.value) })}
              onMouseUp={() => {
                try {
                  speak("G major", settings.voiceRate, settings.voiceName);
                } catch (err) {
                  fail(err);
                }
              }}
            />
          </label>
          <label>
            Drum volume
            <input type="range" min={0} max={1} step={0.01} aria-label="Drum volume" value={settings.drumVolume} onChange={(e) => update({ drumVolume: parseFloat(e.target.value) })} />
          </label>
        </section>

        <section className="fb-settings__section">
          <h4>Output</h4>
          <div className="fb-settings__row">
            {engine.canChooseOutput ? (
              <select
                aria-label="Audio output"
                value={output}
                onChange={(e) => {
                  setOutput(e.target.value);
                  engine.setOutput(e.target.value).catch(fail);
                }}
              >
                <option value="default">System default</option>
                {outputs.filter((o) => o.id !== "default").map((o) => (
                  <option key={o.id} value={o.id}>{o.label}</option>
                ))}
              </select>
            ) : (
              <span className="fb-dim">Uses the system's sound output (change it in System Settings).</span>
            )}
            {engine.canChooseOutput && (
              <button className="btn-ghost" onClick={() => engine.outputDevices().then(setOutputs).catch(fail)}>Look for outputs again</button>
            )}
            <button
              className="btn-secondary"
              onClick={() => {
                try {
                  engine.test();
                } catch (err) {
                  fail(err);
                }
              }}
            >
              Test
            </button>
          </div>
        </section>

        <section className="fb-settings__section">
          <h4>Quiz and weak spots</h4>
          <label className="fb-settings__check" title="A weak spot clears after 3 right answers in a row at this pace or faster">
            <input type="radio" name="pace" checked={settings.pace.type === "average"} onChange={() => update({ pace: { type: "average" } })} />
            My typical time for each kind of question over my last 5 sessions, plus 30% (speed isn't judged until I've answered 10 of that kind)
          </label>
          <div className="fb-settings__row">
            <label className="fb-settings__check">
              <input type="radio" name="pace" checked={settings.pace.type === "fixed"} onChange={() => update({ pace: { type: "fixed", ms: 2500 } })} />
              A fixed time:
            </label>
            <input
              type="number"
              aria-label="Fixed pace (seconds)"
              min={0.5}
              max={15}
              step={0.1}
              disabled={settings.pace.type !== "fixed"}
              value={settings.pace.type === "fixed" ? settings.pace.ms / 1000 : 2.5}
              onChange={(e) => {
                const v = parseFloat(e.target.value);
                if (Number.isFinite(v) && v >= 0.5 && v <= 15) update({ pace: { type: "fixed", ms: Math.round(v * 1000) } });
              }}
            />
            s
          </div>
          {settings.pace.type === "average" &&
            ["naming notes", "degrees", "intervals", "ear intervals", "ear chords"].map((name, k) => {
              const src = weak.paceSource(k);
              return (
                <span key={name} className="fb-dim">
                  {src.ms !== null ? `${name}: ${(src.ms / 1000).toFixed(1)} s (your pace)` : `${name}: speed not judged yet — ${src.need} more answer${src.need === 1 ? "" : "s"} first`}
                </span>
              );
            })}
          <label>
            Microphone (for answering out loud)
            <select aria-label="Microphone" value={settings.micName} onChange={(e) => update({ micName: e.target.value })}>
              <option value="">System default{mics?.default ? ` (${mics.default})` : ""}</option>
              {(mics?.inputs ?? []).map((n) => (
                <option key={n} value={n}>{n}</option>
              ))}
              {settings.micName && !(mics?.inputs ?? []).includes(settings.micName) && <option value={settings.micName}>{settings.micName} (not connected)</option>}
            </select>
          </label>
          <div className="fb-settings__row">
            <button className="btn-ghost" onClick={() => void lookForMics()}>Look for microphones again</button>
            {micNote && <span className="fb-dim">{micNote}</span>}
          </div>
          <span className="fb-dim">{QUIZ_KINDS.length} kinds of question are tracked.</span>
        </section>

        <section className="fb-settings__section">
          <h4>Playback</h4>
          <label>
            Count-in
            <select aria-label="Count-in" value={settings.countIn} onChange={(e) => update({ countIn: parseInt(e.target.value) })}>
              <option value={0}>Off</option>
              <option value={1}>1 bar</option>
              <option value={2}>2 bars</option>
            </select>
          </label>
        </section>

        <div className="error-modal-footer">
          <button className="btn-primary" onClick={onClose}>Done</button>
        </div>
      </div>
      {error && <ErrorModal error={error} onDismiss={() => setError(null)} />}
      {confirmRemove && (
        <ConfirmModal
          title="Remove SoundFont?"
          message={`Remove ${confirmRemove} from the Fretboard Trainer? The file you added stays wherever you got it from.`}
          confirmLabel="Remove"
          onConfirm={() => {
            onRemoveFont(confirmRemove);
            setConfirmRemove(null);
          }}
          onCancel={() => setConfirmRemove(null)}
        />
      )}
    </div>,
    document.body,
  );
}
