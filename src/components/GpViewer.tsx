import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { GpViewData, GpViewTrack, GpViewMeasure } from "../api/types";

interface Props {
  filePath: string;
  onClose: () => void;
}

// ─── Tab layout constants ────────────────────────────────────────────────────

const LABEL_W = 22;     // px for string letter labels on left of each row
const BEAT_W = 44;      // px per beat unit (quarter note = 1 beat)
const STRING_H = 20;    // px between string lines
const SYS_PAD = 10;     // top/bottom padding within each SVG row
const BAR_LABEL_H = 14; // px above each row for measure number labels
const MEASURES_PER_ROW = 4;

// Standard tuning labels by string count (string 1 = highest pitch = top row).
const STRING_LABELS: Record<number, string[]> = {
  4: ["G", "D", "A", "E"],
  5: ["B", "G", "D", "A", "E"],
  6: ["e", "B", "G", "D", "A", "E"],
  7: ["e", "B", "G", "D", "A", "E", "B"],
};

function getLabels(stringCount: number): string[] {
  return STRING_LABELS[stringCount] ?? Array.from({ length: stringCount }, (_, i) => String(i + 1));
}

// Technique indicator color and symbol (displayed as a superscript after fret).
const TECH_COLOR: Record<string, string> = {
  h: "#9b8dff", p: "#9b8dff", b: "#f59e0b",
  vib: "#34d399", pm: "#a8a8c0", x: "#f87171",
  t: "#60a5fa", harm: "#34d399",
};

function techniqueLabel(techniques: string[]): string {
  if (techniques.includes("h")) return "h";
  if (techniques.includes("p")) return "p";
  if (techniques.includes("b")) return "b";
  if (techniques.includes("x")) return "x";
  if (techniques.includes("t")) return "t";
  if (techniques.includes("harm")) return "◇";
  if (techniques.includes("pm")) return "·";
  if (techniques.includes("vib")) return "~";
  return "";
}

// ─── Tab row SVG renderer ────────────────────────────────────────────────────

function TabRow({ measures, track }: { measures: GpViewMeasure[]; track: GpViewTrack }) {
  const labels = getLabels(track.string_count);
  const systemH = BAR_LABEL_H + SYS_PAD + (track.string_count - 1) * STRING_H + SYS_PAD;

  // Compute measure widths and x positions
  let x = LABEL_W;
  const measureLayouts = measures.map((m) => {
    const width = m.beats_per_bar * BEAT_W;
    const layout = { x, width, measure: m };
    x += width + 1; // +1 for bar separator gap
    return layout;
  });
  const totalWidth = x;

  return (
    <svg
      width={totalWidth}
      height={systemH}
      className="gp-tab-system"
      style={{ display: "block", overflow: "visible" }}
    >
      {/* String labels */}
      {labels.map((label, sIdx) => (
        <text
          key={sIdx}
          x={LABEL_W - 4}
          y={BAR_LABEL_H + SYS_PAD + sIdx * STRING_H + 5}
          textAnchor="end"
          fontSize={10}
          fontFamily="monospace"
          fill="#686880"
        >
          {label}
        </text>
      ))}

      {/* Measures */}
      {measureLayouts.map(({ x: mx, width, measure }) => (
        <g key={measure.index} transform={`translate(${mx}, ${BAR_LABEL_H})`}>
          {/* Measure number */}
          <text
            x={0}
            y={-2}
            fontSize={9}
            fontFamily="monospace"
            fill="#686880"
          >
            {measure.index + 1}
          </text>

          {/* Opening bar line */}
          <line
            x1={0} y1={SYS_PAD}
            x2={0} y2={SYS_PAD + (track.string_count - 1) * STRING_H}
            stroke="#32324a" strokeWidth={1}
          />

          {/* String lines */}
          {Array.from({ length: track.string_count }, (_, sIdx) => (
            <line
              key={sIdx}
              x1={0} y1={SYS_PAD + sIdx * STRING_H}
              x2={width} y2={SYS_PAD + sIdx * STRING_H}
              stroke="#32324a" strokeWidth={0.8}
            />
          ))}

          {/* Notes */}
          {measure.beats.flatMap((beat) =>
            beat.notes.map((note, nIdx) => {
              const beatX = (beat.position / measure.beats_per_bar) * width;
              const noteY = SYS_PAD + (note.string - 1) * STRING_H;
              const isDead = note.techniques.includes("x");
              const fretStr = isDead ? "x" : String(note.fret);
              const techLabel = techniqueLabel(note.techniques);
              const techColor = note.techniques.length > 0
                ? (TECH_COLOR[note.techniques[0]] ?? "#eaeaf2")
                : "#eaeaf2";
              const charW = fretStr.length === 1 ? 8 : fretStr.length === 2 ? 14 : 20;
              const bgW = charW + 3;

              return (
                <g key={`${beat.position}-${nIdx}`}>
                  {/* Clear string line behind fret number */}
                  <rect
                    x={beatX - bgW / 2} y={noteY - 7}
                    width={bgW} height={13}
                    fill="var(--bg)"
                  />
                  <text
                    x={beatX} y={noteY + 4}
                    textAnchor="middle"
                    fontSize={11}
                    fontFamily="monospace"
                    fill={techColor}
                  >
                    {fretStr}
                  </text>
                  {techLabel && (
                    <text
                      x={beatX + bgW / 2 + 1} y={noteY + 2}
                      fontSize={8}
                      fontFamily="monospace"
                      fill={techColor}
                    >
                      {techLabel}
                    </text>
                  )}
                </g>
              );
            })
          )}

          {/* Closing bar line (only on last measure in row) */}
        </g>
      ))}

      {/* Final closing bar line */}
      {measureLayouts.length > 0 && (() => {
        const last = measureLayouts[measureLayouts.length - 1];
        return (
          <line
            x1={last.x + last.width} y1={BAR_LABEL_H + SYS_PAD}
            x2={last.x + last.width} y2={BAR_LABEL_H + SYS_PAD + (track.string_count - 1) * STRING_H}
            stroke="#32324a" strokeWidth={1}
          />
        );
      })()}
    </svg>
  );
}

// ─── Track renderer ───────────────────────────────────────────────────────────

function TrackView({ track }: { track: GpViewTrack }) {
  // Group measures into rows
  const rows: GpViewMeasure[][] = [];
  for (let i = 0; i < track.measures.length; i += MEASURES_PER_ROW) {
    rows.push(track.measures.slice(i, i + MEASURES_PER_ROW));
  }

  if (rows.length === 0) {
    return <p className="gp-viewer-empty">No note data available for this track.</p>;
  }

  return (
    <div className="gp-viewer-track-content">
      {rows.map((rowMeasures, rowIdx) => (
        <TabRow key={rowIdx} measures={rowMeasures} track={track} />
      ))}
    </div>
  );
}

// ─── Main viewer component ────────────────────────────────────────────────────

export function GpViewer({ filePath, onClose }: Props) {
  const [data, setData] = useState<GpViewData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedTrack, setSelectedTrack] = useState(0);
  const backdropRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setData(null);
    setError(null);

    invoke<string>("parse_gp_file", { filePath })
      .then((raw) => {
        if (cancelled) return;
        const parsed = JSON.parse(raw) as GpViewData;
        setData(parsed);
        setSelectedTrack(0);
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => { cancelled = true; };
  }, [filePath]);

  // Close on Escape
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  function handleBackdropClick(e: React.MouseEvent) {
    if (e.target === backdropRef.current) onClose();
  }

  const filename = filePath.split("/").pop() ?? filePath;
  const track = data?.tracks[selectedTrack] ?? null;

  return (
    <div className="gp-viewer" ref={backdropRef} onClick={handleBackdropClick}>
      <div className="gp-viewer-card">
        {/* Header */}
        <div className="gp-viewer-header">
          <div className="gp-viewer-meta">
            {loading ? (
              <span className="gp-viewer-loading">Loading…</span>
            ) : data ? (
              <>
                <span className="gp-viewer-title">
                  {data.title ?? filename}
                </span>
                {data.artist && (
                  <span className="gp-viewer-artist">{data.artist}</span>
                )}
                <span className="gp-viewer-tempo">{Math.round(data.tempo_bpm)} BPM</span>
              </>
            ) : (
              <span className="gp-viewer-title">{filename}</span>
            )}
          </div>

          <div className="gp-viewer-controls">
            {data && data.tracks.length > 1 && (
              <select
                className="gp-viewer-track-select"
                value={selectedTrack}
                onChange={(e) => setSelectedTrack(Number(e.target.value))}
              >
                {data.tracks.map((t, i) => (
                  <option key={i} value={i}>
                    {t.name}{t.instrument ? ` (${t.instrument})` : ""}
                  </option>
                ))}
              </select>
            )}
            <button className="gp-viewer-close" onClick={onClose} title="Close viewer">
              ✕
            </button>
          </div>
        </div>

        {/* Body */}
        <div className="gp-viewer-body">
          {loading && (
            <div className="gp-viewer-spinner">
              <div className="loading-spinner" />
            </div>
          )}

          {!loading && error && (
            <p className="gp-viewer-error">Failed to load: {error}</p>
          )}

          {!loading && data && track && (
            <TrackView track={track} />
          )}
        </div>
      </div>

    </div>
  );
}
