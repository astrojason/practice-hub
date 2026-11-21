import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { useState } from "react";
import { PositiveIntInput } from "../player/PositiveIntInput";
import { EXERCISES, mmss, phases, totalSecs, type Exercise, type SpeedLog, type SpeedSetup, type Phase } from "../../lib/fretboard/speed";
import { SEQ_PATTERNS, type SeqPattern } from "../../lib/fretboard/practice";
import { CHORDS } from "../../lib/fretboard/theory";

export interface SpeedRun {
  phases: Phase[];
  startedAt: number;
  phase: number;
  topBpm: number;
  startBpm: number;
  exercise: Exercise;
  detail: string;
  when: number;
}

interface Props {
  setup: SpeedSetup;
  onSetup: (p: Partial<SpeedSetup>) => void;
  burst: number;
  onBurst: (n: number) => void;
  chordIdx: number;
  onChord: (i: number) => void;
  pattern: SeqPattern;
  onPattern: (p: SeqPattern) => void;
  detail: string;
  run: SpeedRun | null;
  nowMs: number;
  logs: SpeedLog[];
  onStart: () => void;
  onStop: () => void;
  notice: string | null;
}

const dateLabel = (secs: number) => new Date(secs * 1000).toLocaleDateString(undefined, { month: "short", day: "numeric" });

export function SpeedPanel({ setup, onSetup, burst, onBurst, chordIdx, onChord, pattern, onPattern, detail, run, nowMs, logs, onStart, onStop, notice }: Props) {
  const [filter, setFilter] = useState<Exercise | "all">("all");
  const ph = phases(setup);
  const rounds = ph.filter((p) => p.kind === "work").length;
  const total = totalSecs(ph);
  const step = rounds > 1 ? (setup.targetBpm - setup.startBpm) / (rounds - 1) : 0;

  const shown = logs.filter((l) => filter === "all" || l.exercise === EXERCISES.find((e) => e.id === filter)?.name);
  const chart = shown.slice(-24).map((l) => ({ date: dateLabel(l.when), top: l.topBpm, start: l.startBpm }));

  let live: JSX.Element | null = null;
  if (run) {
    const elapsed = (nowMs - run.startedAt) / 1000;
    const runTotal = totalSecs(run.phases);
    const idx = Math.min(run.phase, run.phases.length - 1);
    const startOf = totalSecs(run.phases.slice(0, idx));
    const cur = run.phases[idx];
    const left = Math.max(0, startOf + cur.secs - elapsed);
    const roundNo = run.phases.slice(0, idx + 1).filter((p) => p.kind === "work").length;
    const roundTotal = run.phases.filter((p) => p.kind === "work").length;
    const next = run.phases[idx + 1];
    const hi = Math.max(run.startBpm + 1, ...run.phases.map((p) => (p.kind === "work" ? p.bpm : 0)));
    live = (
      <div className="fb-speed-run" aria-live="polite">
        <div className="fb-speed-run__head">
          {cur.kind === "work" ? (
            <>
              <span className="fb-speed-run__round">Round {roundNo} of {roundTotal}</span>
              <span className="fb-speed-run__bpm">{cur.bpm} bpm</span>
              <span className="fb-dim">{mmss(left)} left in this round</span>
            </>
          ) : (
            <>
              <span className="fb-speed-run__rest">Rest</span>
              <span className="fb-dim">{mmss(left)} — next round at {next && next.kind === "work" ? next.bpm : 0} bpm</span>
            </>
          )}
          <span className="fb-speed-run__done fb-dim">{mmss(Math.min(elapsed, runTotal))} of {mmss(runTotal)} done</span>
          <button className="btn-secondary fb-danger" onClick={onStop} title="Stops and saves what you've done so far">Stop session</button>
        </div>
        <div className="fb-speed-strip" aria-label="Session">
          {run.phases.map((p, i) => (
            <span
              key={i}
              className={`fb-speed-seg ${p.kind === "rest" ? "fb-speed-seg--rest" : ""} ${i < idx ? "fb-speed-seg--done" : ""} ${i === idx ? "fb-speed-seg--now" : ""}`}
              style={{
                flexGrow: p.secs,
                height: p.kind === "work" ? 12 + (20 * (p.bpm - run.startBpm)) / (hi - run.startBpm) : 6,
              }}
            />
          ))}
        </div>
        <p className="fb-dim">Playing: {run.detail}</p>
      </div>
    );
  }

  return (
    <div className="fb-speed">
      {notice && <p className="fb-notice" role="status">{notice}</p>}
      {live}
      {!run && (
        <>
          <div className="fretboard-controls">
            <label>
              Play
              <select aria-label="Speed exercise" value={setup.exercise} onChange={(e) => onSetup({ exercise: e.target.value as Exercise })}>
                {EXERCISES.map((e) => (
                  <option key={e.id} value={e.id}>{e.name}</option>
                ))}
              </select>
            </label>
            {setup.exercise === "arpeggio" && (
              <label>
                Chord
                <select aria-label="Speed chord" value={chordIdx} onChange={(e) => onChord(parseInt(e.target.value))}>
                  {CHORDS.map((c, i) => (
                    <option key={c.name} value={i}>{c.name}</option>
                  ))}
                </select>
              </label>
            )}
            {setup.exercise === "sequence" && (
              <label>
                Pattern
                <select aria-label="Speed pattern" value={pattern} onChange={(e) => onPattern(e.target.value as SeqPattern)}>
                  {SEQ_PATTERNS.map((p) => (
                    <option key={p.id} value={p.id}>{p.name}</option>
                  ))}
                </select>
              </label>
            )}
            <label>
              Session
              <select aria-label="Session length" value={setup.minutes} onChange={(e) => onSetup({ minutes: parseInt(e.target.value) })}>
                {[...new Set([5, 10, 15, 20, 30, setup.minutes])].sort((a, b) => a - b).map((m) => (
                  <option key={m} value={m}>{m} min</option>
                ))}
              </select>
            </label>
            <label>
              Tempo from
              <PositiveIntInput min="30" max="300" clampMin={30} clampMax={300} value={setup.startBpm} onCommit={(v) => onSetup({ startBpm: v, targetBpm: Math.max(v, setup.targetBpm) })} aria-label="Start tempo (bpm)" />
            </label>
            <label>
              up to
              <PositiveIntInput min="30" max="320" clampMin={30} clampMax={320} value={setup.targetBpm} onCommit={(v) => onSetup({ targetBpm: Math.max(v, setup.startBpm) })} aria-label="Target tempo (bpm)" />
            </label>
            <label>
              Rounds
              <select aria-label="Round length" value={setup.workSecs} onChange={(e) => onSetup({ workSecs: parseInt(e.target.value) })}>
                {[...new Set([30, 45, 60, 90, 120, setup.workSecs])].sort((a, b) => a - b).map((w) => (
                  <option key={w} value={w}>{w} s</option>
                ))}
              </select>
            </label>
            <label>
              Rest
              <select aria-label="Rest length" value={setup.restSecs} onChange={(e) => onSetup({ restSecs: parseInt(e.target.value) })}>
                {[...new Set([0, 10, 20, 30, 60, setup.restSecs])].sort((a, b) => a - b).map((r) => (
                  <option key={r} value={r}>{r === 0 ? "None" : `${r} s`}</option>
                ))}
              </select>
            </label>
            <label title="After each run at the round's tempo, play it again in groups of notes at double the tempo, each followed by a rest as long as the burst">
              Speed bursts
              <select aria-label="Speed bursts" value={burst} onChange={(e) => onBurst(parseInt(e.target.value))}>
                <option value={0}>Off</option>
                {[3, 4, 6, 8].map((b) => (
                  <option key={b} value={b}>{b} notes</option>
                ))}
              </select>
            </label>
          </div>
          <p className="fb-dim">
            Plays {detail} — chosen with the Key, Scale and Position above{setup.exercise === "changes" ? " and the Progressions page" : ""}.
            {burst > 0 && " Each run plays once normally, then again in bursts at twice the tempo."}
          </p>
          <div className="fretboard-actions fb-speed-start">
            <button className="btn-primary" onClick={onStart}>▶ Start session</button>
            <span className="fb-speed-summary fb-dim">
              {rounds} round{rounds === 1 ? "" : "s"} of {setup.workSecs} s{setup.restSecs > 0 ? ` with ${setup.restSecs} s rests` : ""}: {setup.startBpm} to {setup.targetBpm} bpm
              {step > 0 ? `, about +${Math.round(step)} a round` : ""} · {mmss(total)} in all
            </span>
          </div>
        </>
      )}

      <section className="fb-speed-progress">
        <div className="fretboard-controls">
          <strong>Progress</strong>
          <label className="fb-playbar__check">
            <input type="radio" name="speed-filter" checked={filter === "all"} onChange={() => setFilter("all")} /> All runs
          </label>
          {EXERCISES.map((e) => (
            <label key={e.id} className="fb-playbar__check">
              <input type="radio" name="speed-filter" checked={filter === e.id} onChange={() => setFilter(e.id)} /> {e.name}
            </label>
          ))}
        </div>
        {shown.length === 0 ? (
          <p className="fb-dim fb-speed-empty">No sessions yet. Each session you play is saved here with its start tempo, the highest tempo reached and the time spent.</p>
        ) : (
          <div className="fb-speed-progress__grid">
            <div className="fb-speed-chart" aria-label="Tempo trend">
              <ResponsiveContainer width="100%" height={140}>
                <LineChart data={chart}>
                  <CartesianGrid stroke="var(--border-dim)" />
                  <XAxis dataKey="date" stroke="var(--muted)" fontSize={10} />
                  <YAxis stroke="var(--muted)" fontSize={10} domain={["dataMin - 5", "dataMax + 5"]} width={34} />
                  <Tooltip contentStyle={{ background: "var(--surface)", border: "1px solid var(--border)" }} />
                  <Line type="monotone" dataKey="start" stroke="var(--muted)" dot={{ r: 3 }} name="Start tempo" isAnimationActive={false} />
                  <Line type="monotone" dataKey="top" stroke="var(--accent)" strokeWidth={2.5} dot={{ r: 4 }} name="Highest tempo" isAnimationActive={false} />
                </LineChart>
              </ResponsiveContainer>
              <p className="fb-dim">Purple: highest tempo reached · grey: start tempo</p>
            </div>
            <table className="fb-speed-log">
              <thead>
                <tr><th>When</th><th>Run</th><th>Tempo</th><th>Time</th></tr>
              </thead>
              <tbody>
                {[...shown].reverse().slice(0, 6).map((l, i) => (
                  <tr key={`${l.when}-${i}`} title={l.detail}>
                    <td>{dateLabel(l.when)}</td>
                    <td>{l.exercise}</td>
                    <td>{l.startBpm} to {l.topBpm}{l.finished ? "" : " (stopped)"}</td>
                    <td>{mmss(l.secs)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
