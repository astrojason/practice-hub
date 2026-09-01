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
import { ErrorModal } from "./ErrorModal";
import type { GpMatch, GpUnmatched, DifficultyVector } from "../api/types";

type SortKey = "title" | "artist" | "date" | "difficulty";
type SortDir = "asc" | "desc";

interface Props {
  token: string;
  onBack: () => void;
}

export function GpLibraryView({ token, onBack }: Props) {
  const {
    rootPath,
    setRootPath,
    tursoDbUrl,
    tursoAuthToken,
    setTursoCredentials,
    loadSettings,
    scanResult,
    status,
    statusMessage,
    progress,
    scan,
    loadCachedScan,
    persistSeenEntries,
    dismissUnmatched,
    clearSeenCache,
    updateMatchScore,
  } = useGpScanner(token);

  const [pathInput, setPathInput] = useState(rootPath);
  const [dbUrlInput, setDbUrlInput] = useState(tursoDbUrl);
  const [authTokenInput, setAuthTokenInput] = useState(tursoAuthToken);
  const [pushing, setPushing] = useState(false);
  const [pushStatus, setPushStatus] = useState("");
  const [sortKey, setSortKey] = useState<SortKey | null>(null);
  const [sortDir, setSortDir] = useState<SortDir>("asc");
  const [openError, setOpenError] = useState<string | null>(null);

  useEffect(() => {
    loadSettings().then(() => setPathInput(rootPath));
    loadCachedScan();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    setPathInput(rootPath);
  }, [rootPath]);

  useEffect(() => {
    setDbUrlInput(tursoDbUrl);
    setAuthTokenInput(tursoAuthToken);
  }, [tursoDbUrl, tursoAuthToken]);

  async function saveSettings() {
    if (pathInput !== rootPath) {
      await setRootPath(pathInput);
    }
    if (dbUrlInput !== tursoDbUrl || authTokenInput !== tursoAuthToken) {
      await setTursoCredentials(dbUrlInput, authTokenInput);
    }
  }

  async function handleSaveAndScan() {
    try {
      await saveSettings();
      scan();
    } catch (err) {
      setOpenError(err instanceof Error ? err.message : String(err));
    }
  }

  async function handleForceRescan() {
    try {
      await saveSettings();
      await clearSeenCache();
      scan();
    } catch (err) {
      setOpenError(err instanceof Error ? err.message : String(err));
    }
  }

  async function handleOpenFile(path: string) {
    try {
      await invoke("open_with_default", { path });
    } catch (err) {
      setOpenError(err instanceof Error ? err.message : String(err));
    }
  }

  function handleSort(key: SortKey) {
    if (sortKey === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir("asc");
    }
  }

  function sortIndicator(key: SortKey) {
    if (sortKey !== key) return null;
    return <span className="gp-sort-arrow">{sortDir === "asc" ? "▲" : "▼"}</span>;
  }

  function sortMatches(matches: GpMatch[]): GpMatch[] {
    if (!sortKey) return matches;
    const dir = sortDir === "asc" ? 1 : -1;
    return [...matches].sort((a, b) => {
      switch (sortKey) {
        case "title":
          return dir * a.song_name.localeCompare(b.song_name);
        case "artist":
          return dir * a.artist_name.localeCompare(b.artist_name);
        case "date":
          return dir * (a.file.date_ms - b.file.date_ms);
        case "difficulty": {
          const av = a.manual_score ?? a.difficulty_score;
          const bv = b.manual_score ?? b.difficulty_score;
          if (av === null && bv === null) return 0;
          if (av === null) return 1; // nulls always sort last
          if (bv === null) return -1;
          return dir * (av - bv);
        }
      }
    });
  }

  function readyToPush(matches: GpMatch[]): GpMatch[] {
    // Exclude files that are already pushed and unchanged since — otherwise
    // every scan would re-offer (and re-push) the same unchanged score.
    return matches.filter((m) => m.difficulty_score !== null && (!m.pushed || m.is_newer_version));
  }

  async function handleConfirm() {
    if (!scanResult) return;
    const newMatches = readyToPush(scanResult.matches);
    const hasAspectScores = newMatches.some((match) => match.rhythm || match.lead);
    if (hasAspectScores && (!dbUrlInput.trim() || !authTokenInput.trim())) {
      setOpenError("Turso credentials not set — configure them in the scan settings");
      return;
    }
    if (dbUrlInput !== tursoDbUrl || authTokenInput !== tursoAuthToken) {
      try {
        await setTursoCredentials(dbUrlInput, authTokenInput);
      } catch (err) {
        setOpenError(err instanceof Error ? err.message : String(err));
        return;
      }
    }

    setPushing(true);
    setPushStatus("Pushing to Instrumenta…");

    let pushed = 0;
    const errors: string[] = [];
    const successfulMatches: GpMatch[] = [];

    for (const match of newMatches) {
      try {
        const score = match.manual_score ?? match.difficulty_score;
        if (score !== null) {
          await pushDifficultyScore(token, match.song_id, score);
        }
        if (match.rhythm || match.lead) {
          await invoke("write_song_difficulty", {
            dbUrl: dbUrlInput,
            authToken: authTokenInput,
            songId: match.song_id,
            ...(match.rhythm ? { rhythm: match.rhythm.difficulty_score } : {}),
            ...(match.lead ? { lead: match.lead.difficulty_score } : {}),
          });
        }
        const resourceName = match.file.filename.replace(/\.[^.]+$/, "");
        await registerGpResource(token, match.song_id, match.file.path, resourceName);
        pushed++;
        successfulMatches.push(match);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        errors.push(`${match.file.filename}: ${message}`);
      }
    }

    await persistSeenEntries(successfulMatches);

    if (errors.length === 0) {
      setPushStatus(`Done — pushed ${pushed} songs to Instrumenta.`);
    } else {
      setPushStatus(`Pushed ${pushed}, ${errors.length} errors:\n${errors.join("\n")}`);
      setOpenError(errors.join("\n"));
    }
    setPushing(false);
  }

  const isScanning = status === "scanning" || status === "analyzing";
  const newMatches = scanResult ? readyToPush(scanResult.matches) : [];
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
        <div className="gp-library-settings-row">
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
        <div className="gp-library-settings-row gp-turso-settings">
          <label htmlFor="gp-turso-db-url">Turso DB URL</label>
          <input
            id="gp-turso-db-url"
            type="text"
            value={dbUrlInput}
            onChange={(event) => setDbUrlInput(event.target.value)}
            disabled={isScanning}
            placeholder="libsql://database.turso.io"
          />
          <label htmlFor="gp-turso-auth-token">Auth token</label>
          <input
            id="gp-turso-auth-token"
            type="password"
            value={authTokenInput}
            onChange={(event) => setAuthTokenInput(event.target.value)}
            disabled={isScanning}
            autoComplete="off"
          />
        </div>
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
                    <th className="gp-sortable" onClick={() => handleSort("title")}>
                      Song{sortIndicator("title")}
                    </th>
                    <th className="gp-sortable" onClick={() => handleSort("artist")}>
                      Artist{sortIndicator("artist")}
                    </th>
                    <th className="gp-sortable" onClick={() => handleSort("date")}>
                      Date{sortIndicator("date")}
                    </th>
                    <th>BPM</th>
                    <th className="gp-sortable" onClick={() => handleSort("difficulty")}>
                      Difficulty{sortIndicator("difficulty")}
                    </th>
                    <th>Rhythm</th>
                    <th>Lead</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {sortMatches(scanResult.matches).map((m) => (
                    <GpMatchRow
                      key={m.file.path}
                      match={m}
                      onOpen={handleOpenFile}
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
            </div>
          )}

          {!hasNewResults && status === "done" && (
            <p className="gp-hint">Nothing new to push — all files are up to date.</p>
          )}

          {/* Kept outside the hasNewResults block so the confirmation stays
              visible even after a successful push clears the ready-to-push list. */}
          {pushStatus && <p className="gp-push-status">{pushStatus}</p>}
        </>
      )}

      {openError && <ErrorModal error={openError} onDismiss={() => setOpenError(null)} />}
    </div>
  );
}

// ── Sub-components ────────────────────────────────────────────────────────────

function GpMatchRow({
  match,
  onOpen,
  onScoreChange,
}: {
  match: GpMatch;
  onOpen: (path: string) => void;
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
          {(match.difficulty_vector || match.rhythm || match.lead) && (
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
        <td className="gp-aspect-cell" title={match.rhythm ? `Track: ${match.rhythm.track_name}` : undefined}>
          {match.rhythm ? <DifficultyPill score={match.rhythm.difficulty_score} /> : <span className="gp-score-na">—</span>}
        </td>
        <td className="gp-aspect-cell" title={match.lead ? `Track: ${match.lead.track_name}` : undefined}>
          {match.lead ? <DifficultyPill score={match.lead.difficulty_score} /> : <span className="gp-score-na">—</span>}
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
      {expanded && (match.difficulty_vector || match.rhythm || match.lead) && (
        <tr className="gp-vector-row">
          <td />
          <td colSpan={9}>
            {match.difficulty_vector && <VectorBreakdown label="Overall" vector={match.difficulty_vector} />}
            {match.rhythm && <VectorBreakdown label="Rhythm" vector={match.rhythm.vector} />}
            {match.lead && <VectorBreakdown label="Lead" vector={match.lead.vector} />}
          </td>
        </tr>
      )}
    </>
  );
}

function VectorBreakdown({ vector, label: sectionLabel }: { vector: DifficultyVector; label?: string }) {
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
      {sectionLabel && <div className="gp-vector-breakdown-label">{sectionLabel}</div>}
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
}: {
  entry: GpUnmatched;
  onDismiss: () => void;
  onOpen: () => void;
}) {
  return (
    <tr className="gp-row-unmatched">
      <td className="gp-file-cell">
        <button className="gp-filename-link" onClick={onOpen}>
          {entry.file.filename}
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
