/**
 * GpLibraryView — Guitar Pro library scanner.
 *
 * Layout:
 *   [Settings bar: root path + Scan & Analyze button]
 *   [Status/progress]
 *   [Review table: matched files]
 *   [Unmatched files]
 *   [Confirm button → push scores + resources to Instrumenta]
 */

import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useGpScanner } from "../hooks/useGpScanner";
import { pushDifficultyScore, registerGpResource } from "../api/client";
import type { GpMatch, GpUnmatched } from "../api/types";

interface Props {
  token: string;
  onBack: () => void;
}

export function GpLibraryView({ token, onBack }: Props) {
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
  } = useGpScanner(token);

  const [pathInput, setPathInput] = useState(rootPath);
  const [pushing, setPushing] = useState(false);
  const [pushStatus, setPushStatus] = useState("");

  useEffect(() => {
    loadSettings().then(() => setPathInput(rootPath));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Keep input in sync when rootPath is restored from store
  useEffect(() => {
    setPathInput(rootPath);
  }, [rootPath]);

  async function handleSaveAndScan() {
    if (pathInput !== rootPath) {
      await setRootPath(pathInput);
    }
    scan();
  }

  async function handleOpenFile(path: string) {
    await invoke("open_with_default", { path });
  }

  async function handleConfirm() {
    if (!scanResult) return;
    const newMatches = scanResult.matches.filter(
      (m) => m.difficulty_score !== null
    );

    setPushing(true);
    setPushStatus("Pushing to Instrumenta…");

    let pushed = 0;
    const errors: string[] = [];

    for (const match of newMatches) {
      try {
        if (match.difficulty_score !== null) {
          await pushDifficultyScore(token, match.song_id, match.difficulty_score);
        }
        // Register the GP file path as a guitar_pro resource
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
      </div>

      {/* ── Progress / status ── */}
      {status !== "idle" && (
        <div className="gp-status">
          {isScanning && progress.total > 0 && (
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
                    <th>File</th>
                    <th>Song</th>
                    <th>Artist</th>
                    <th>Date</th>
                    <th>Score</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {scanResult.matches.map((m) => (
                    <GpMatchRow key={m.file.path} match={m} onOpen={handleOpenFile} />
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
}: {
  match: GpMatch;
  onOpen: (path: string) => void;
}) {
  return (
    <tr className={match.is_newer_version ? "gp-row-updated" : ""}>
      <td>
        <button
          className="gp-filename-link"
          title="Open in Guitar Pro"
          onClick={() => onOpen(match.file.path)}
        >
          {match.file.filename}
        </button>
        {match.is_newer_version && (
          <span className="gp-badge-updated">updated</span>
        )}
      </td>
      <td>{match.song_name}</td>
      <td>{match.artist_name}</td>
      <td>{match.file.parsed_date}</td>
      <td>
        {match.difficulty_score !== null ? (
          <DifficultyPill score={match.difficulty_score} />
        ) : (
          <span className="gp-score-na">—</span>
        )}
      </td>
      <td></td>
    </tr>
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
      <td>
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
