/**
 * GpLibraryView — Guitar Pro library scanner.
 *
 * Layout:
 *   [Settings bar: root path + Scan & Analyze + Force Rescan buttons]
 *   [Status/progress with step indicator]
 *   [Review table: matched files with expandable vector breakdown]
 *   [Unmatched files]
 *   [Confirm button → push scores + resources to Instrumenta]
 */

import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useGpScanner } from "../hooks/useGpScanner";
import { pushDifficultyScore, registerGpResource } from "../api/client";
import type { GpMatch, GpUnmatched, DifficultyVector } from "../api/types";

interface Props {
  token: string;
  onBack: () => void;
  onGpView: (path: string, audioPath?: string) => void;
}

export function GpLibraryView({ token, onBack, onGpView }: Props) {
  const {
    rootPath,
    setRootPath,
    loadSettings,
    scanResult,
    status,
    statusMessage,
    progress,
    scan,
    persistSeenEntries,
    dismissUnmatched,
    clearSeenCache,
    updateMatchScore,
  } = useGpScanner(token);

  const [pathInput, setPathInput] = useState(rootPath);
  const [pushing, setPushing] = useState(false);
  const [pushStatus, setPushStatus] = useState("");

  useEffect(() => {
    loadSettings().then(() => setPathInput(rootPath));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    setPathInput(rootPath);
  }, [rootPath]);

  async function handleSaveAndScan() {
    if (pathInput !== rootPath) {
      await setRootPath(pathInput);
    }
    scan();
  }

  async function handleForceRescan() {
    if (pathInput !== rootPath) {
      await setRootPath(pathInput);
    }
    await clearSeenCache();
    scan();
  }

  async function handleOpenFile(path: string) {
    await invoke("open_with_default", { path });
  }

  async function handleConfirm() {
    if (!scanResult) return;
    const newMatches = scanResult.matches.filter((m) => m.difficulty_score !== null);

    setPushing(true);
    setPushStatus("Pushing to Instrumenta…");

    let pushed = 0;
    const errors: string[] = [];

    for (const match of newMatches) {
      try {
        const score = match.manual_score ?? match.difficulty_score;
        if (score !== null) {
          await pushDifficultyScore(token, match.song_id, score);
        }
        const resourceName = match.file.filename.replace(/\.[^.]+$/, "");
        await registerGpResource(token, match.song_id, match.file.path, resourceName);
        pushed++;
      } catch (err) {
        errors.push(`${match.file.filename}: ${err}`);
      }
    }

    await persistSeenEntries(newMatches);

    if (errors.length === 0) {
      setPushStatus(`Done — pushed ${pushed} songs to Instrumenta.`);
    } else {
      setPushStatus(`Pushed ${pushed}, ${errors.length} errors:\n${errors.join("\n")}`);
    }
    setPushing(false);
  }

  const isScanning = status === "scanning" || status === "analyzing";
  const newMatches = scanResult?.matches.filter((m) => m.difficulty_score !== null) ?? [];
  const hasNewResults = newMatches.length > 0;

  function stepState(step: "scan" | "match" | "analyze") {
    if (status === "idle") return "pending";
    if (step === "scan") return status === "scanning" ? "active" : "done";
    if (step === "match") {
      if (status === "scanning") return "pending";
      return status === "analyzing" ? "active" : "done";
    }
    if (step === "analyze") {
      return status === "analyzing" ? "active" : status === "done" || status === "error" ? "done" : "pending";
    }
    return "pending";
  }

  return (
    <div className="gp-library-view">
      {/* ── Header ── */}
      <div className="gp-library-header">
        <button className="back-button" onClick={onBack} disabled={isScanning || pushing}>
          ← Back
        </button>
        <h2>Guitar Pro Library</h2>
      </div>

      {/* ── Settings bar ── */}
      <div className="gp-library-settings">
        <label htmlFor="gp-root-path">Library folder</label>
        <input
          id="gp-root-path"
          type="text"
          value={pathInput}
          onChange={(e) => setPathInput(e.target.value)}
          disabled={isScanning}
          placeholder="/path/to/Sheet Music"
        />
        <button
          className="scan-button"
          onClick={handleSaveAndScan}
          disabled={isScanning || !pathInput.trim()}
        >
          {isScanning ? "Scanning…" : "Scan & Analyze"}
        </button>
        <button
          className="btn-secondary"
          onClick={handleForceRescan}
          disabled={isScanning || !pathInput.trim()}
          title="Clear seen-file cache and re-analyze all files"
        >
          Force Rescan
        </button>
      </div>

      {/* ── Progress / status ── */}
      {status !== "idle" && (
        <div className="gp-status">
          <div className="gp-scan-steps">
            {(
              [
                { key: "scan", label: "Scan files" },
                { key: "match", label: "Match catalog" },
                { key: "analyze", label: "Analyze" },
              ] as const
            ).map(({ key, label }, i) => {
              const state = stepState(key);
              return (
                <>
                  {i > 0 && <span key={`arrow-${key}`} className="gp-scan-step-arrow">›</span>}
                  <span key={key} className={`gp-scan-step ${state === "active" ? "active" : state === "done" ? "done" : ""}`}>
                    <span className="gp-scan-step-dot" />
                    {label}
                  </span>
                </>
              );
            })}
          </div>
          {status === "analyzing" && progress.total > 0 && (
            <div className="gp-progress-bar">
              <div
                className="gp-progress-fill"
                style={{ width: `${(progress.current / progress.total) * 100}%` }}
              />
            </div>
          )}
          <p className="gp-status-message">{statusMessage}</p>
        </div>
      )}

      {/* ── Results ── */}
      {scanResult && (
        <>
          {/* Matched files */}
          {scanResult.matches.length > 0 && (
            <section className="gp-section">
              <h3>Matched ({scanResult.matches.length})</h3>
              <table className="gp-table">
                <thead>
                  <tr>
                    <th></th>
                    <th>File</th>
                    <th>Song</th>
                    <th>Artist</th>
                    <th>Date</th>
                    <th>BPM</th>
                    <th>Difficulty</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {scanResult.matches.map((m) => (
                    <GpMatchRow
                      key={m.file.path}
                      match={m}
                      onOpen={handleOpenFile}
                      onView={(path) => onGpView(path)}
                      onScoreChange={(score) => updateMatchScore(m.file.filename, score)}
                    />
                  ))}
                </tbody>
              </table>
            </section>
          )}

          {/* Unmatched files */}
          {scanResult.unmatched.length > 0 && (
            <section className="gp-section">
              <h3>Unmatched ({scanResult.unmatched.length})</h3>
              <p className="gp-hint">
                These files could not be matched to any song in your Instrumenta catalog.
                Check the filename format: <code>Artist-Song Title-MM-DD-YYYY.gp</code>
              </p>
              <table className="gp-table">
                <thead>
                  <tr>
                    <th>File</th>
                    <th>Parsed Artist</th>
                    <th>Parsed Title</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {scanResult.unmatched.map((u) => (
                    <GpUnmatchedRow
                      key={u.file.path}
                      entry={u}
                      onDismiss={() => dismissUnmatched(u.file.filename)}
                      onOpen={() => handleOpenFile(u.file.path)}
                      onView={() => onGpView(u.file.path)}
                    />
                  ))}
                </tbody>
              </table>
            </section>
          )}

          {/* Push confirmation */}
          {hasNewResults && (
            <div className="gp-confirm">
              <p>
                {newMatches.length} file{newMatches.length !== 1 ? "s" : ""} ready to push.
                Difficulty scores and file paths will be saved to Instrumenta.
              </p>
              <button
                className="confirm-button"
                onClick={handleConfirm}
                disabled={pushing}
              >
                {pushing ? "Pushing…" : `Push to Instrumenta (${newMatches.length})`}
              </button>
              {pushStatus && <p className="gp-push-status">{pushStatus}</p>}
            </div>
          )}

          {!hasNewResults && status === "done" && (
            <p className="gp-hint">Nothing new to push — all files are up to date.</p>
          )}
        </>
      )}

    </div>
  );
}

// ── Sub-components ────────────────────────────────────────────────────────────

function GpMatchRow({
  match,
  onOpen,
  onView,
  onScoreChange,
}: {
  match: GpMatch;
  onOpen: (path: string) => void;
  onView: (path: string) => void;
  onScoreChange: (score: number | null) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editValue, setEditValue] = useState("");

  const displayScore = match.manual_score ?? match.difficulty_score;
  const isManual = match.manual_score !== null;

  function startEdit() {
    setEditValue(displayScore !== null ? String(displayScore.toFixed(1)) : "");
    setEditing(true);
  }

  function commitEdit() {
    const val = parseFloat(editValue);
    if (!isNaN(val) && val >= 0 && val <= 100) {
      onScoreChange(Math.round(val * 10) / 10);
    } else if (editValue.trim() === "") {
      onScoreChange(null);
    }
    setEditing(false);
  }

  return (
    <>
      <tr className={match.is_newer_version ? "gp-row-updated" : ""}>
        <td className="gp-expand-cell">
          {match.difficulty_vector && (
            <button
              className="gp-expand-btn"
              onClick={() => setExpanded((v) => !v)}
              title={expanded ? "Hide breakdown" : "Show score breakdown"}
            >
              {expanded ? "▾" : "▸"}
            </button>
          )}
        </td>
        <td className="gp-file-cell">
          <button
            className="gp-filename-link"
            title="Open in Guitar Pro"
            onClick={() => onOpen(match.file.path)}
          >
            {match.file.filename}
          </button>
          <button
            className="gp-view-btn"
            title="View tab"
            onClick={() => onView(match.file.path)}
          >
            ♩
          </button>
        </td>
        <td>{match.song_name}</td>
        <td>{match.artist_name}</td>
        <td>{match.file.parsed_date}</td>
        <td className="gp-tempo">{match.tempo_bpm ? `${Math.round(match.tempo_bpm)}` : "—"}</td>
        <td>
          {editing ? (
            <input
              className="gp-score-input"
              type="number"
              min={0}
              max={100}
              step={0.1}
              value={editValue}
              onChange={(e) => setEditValue(e.target.value)}
              onBlur={commitEdit}
              onKeyDown={(e) => { if (e.key === "Enter") commitEdit(); if (e.key === "Escape") setEditing(false); }}
              autoFocus
            />
          ) : displayScore !== null ? (
            <span className="gp-score-clickable" onClick={startEdit} title="Click to override score">
              <DifficultyPill score={displayScore} />
              {isManual && <span className="gp-badge-manual">manual</span>}
            </span>
          ) : (
            <span className="gp-score-na" onClick={startEdit} title="Click to set score" style={{ cursor: "pointer" }}>—</span>
          )}
        </td>
        <td>
          {match.is_newer_version ? (
            <span className="gp-badge-updated">updated</span>
          ) : match.difficulty_score !== null ? (
            <span className="gp-badge-new">new</span>
          ) : (
            <span className="gp-score-na">unchanged</span>
          )}
        </td>
      </tr>
      {expanded && match.difficulty_vector && (
        <tr className="gp-vector-row">
          <td />
          <td colSpan={7}>
            <VectorBreakdown vector={match.difficulty_vector} />
          </td>
        </tr>
      )}
    </>
  );
}

function VectorBreakdown({ vector }: { vector: DifficultyVector }) {
  const axes: { key: keyof DifficultyVector; label: string; desc: string }[] = [
    { key: "speed",             label: "Speed",       desc: "Peak attack rate (notes/sec)" },
    { key: "fret_complexity",   label: "Fret",        desc: "Reach, stretch, position shifts" },
    { key: "pick_complexity",   label: "Picking",     desc: "String skips, direction changes" },
    { key: "rhythm_complexity", label: "Rhythm",      desc: "Time sigs, tuplets, note value variety" },
    { key: "technique_density", label: "Technique",   desc: "Bends, harmonics, tremolo, vibrato" },
    { key: "stamina",           label: "Stamina",     desc: "Duration × intensity" },
  ];

  return (
    <div className="gp-vector-breakdown">
      {axes.map(({ key, label, desc }) => {
        const val = vector[key] as number;
        return (
          <div key={key} className="gp-vector-row-item" title={desc}>
            <span className="gp-vector-label">{label}</span>
            <div className="gp-vector-bar-track">
              <div className="gp-vector-bar-fill" style={{ width: `${Math.min(100, val)}%` }} />
            </div>
            <span className="gp-vector-value">{val.toFixed(0)}</span>
          </div>
        );
      })}
    </div>
  );
}

function GpUnmatchedRow({
  entry,
  onDismiss,
  onOpen,
  onView,
}: {
  entry: GpUnmatched;
  onDismiss: () => void;
  onOpen: () => void;
  onView: () => void;
}) {
  return (
    <tr className="gp-row-unmatched">
      <td className="gp-file-cell">
        <button className="gp-filename-link" onClick={onOpen}>
          {entry.file.filename}
        </button>
        <button className="gp-view-btn" title="View tab" onClick={onView}>
          ♩
        </button>
      </td>
      <td>{entry.file.parsed_artist}</td>
      <td>{entry.file.parsed_title}</td>
      <td>
        <button className="gp-dismiss-button" onClick={onDismiss}>
          Dismiss
        </button>
      </td>
    </tr>
  );
}

function DifficultyPill({ score }: { score: number }) {
  const level =
    score >= 75 ? "hard" : score >= 50 ? "medium" : score >= 25 ? "easy" : "beginner";
  return (
    <span className={`gp-difficulty-pill gp-difficulty-${level}`}>
      {score.toFixed(1)}
    </span>
  );
}
