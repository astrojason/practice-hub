/**
 * useGpScanner — GP library scanning and state management.
 *
 * Responsibilities:
 * - Persist the library root path and per-file seen state via tauri-plugin-store
 * - Parse filenames: {Artist}-{Song Title}-{MM-DD-YYYY}.gp
 * - Match parsed artist+title against the Instrumenta song catalog (case-insensitive)
 * - Apply incremental logic: skip files unchanged since last scan
 * - Apply version deduplication: newer date wins for same artist+title
 * - Invoke the Rust analyze_gp_file command per new/updated file
 */

import { useState, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { load } from "@tauri-apps/plugin-store";
import type {
  GpFileEntry,
  GpFileParsed,
  GpMatch,
  GpUnmatched,
  GpScanResult,
  GpSeenEntry,
  DifficultyVector,
} from "../api/types";
import type { Song } from "../api/types";
import { getCatalogSongs } from "../api/client";

const STORE_KEY = "gp-library";
const DEFAULT_ROOT = "/Users/jasonsylvester/Documents/Sheet Music";

// ── Filename parser ───────────────────────────────────────────────────────────
// Format: {Artist}-{Song Title}-{MM-DD-YYYY}.gp
// We split on - and treat the last segment as the date (MM-DD-YYYY),
// the second-to-last as the title (may itself contain hyphens), and
// everything before that as the artist.

function parseFilename(filename: string): {
  artist: string;
  title: string;
  date: string;
  date_ms: number;
} | null {
  const stem = filename.replace(/\.[^.]+$/, ""); // strip extension
  const parts = stem.split("-");
  // Need at least 3 parts: artist, title, date (date = MM-DD-YYYY = 3 parts)
  // Date occupies the last 3 dash-separated parts: MM, DD, YYYY
  if (parts.length < 4) return null;

  const yyyy = parts[parts.length - 1];
  const dd = parts[parts.length - 2];
  const mm = parts[parts.length - 3];

  if (!/^\d{4}$/.test(yyyy) || !/^\d{2}$/.test(dd) || !/^\d{2}$/.test(mm)) {
    return null;
  }

  const dateStr = `${mm}-${dd}-${yyyy}`;
  const date_ms = new Date(`${yyyy}-${mm}-${dd}`).getTime();
  if (isNaN(date_ms)) return null;

  // Remaining parts: at least 2 (artist + title)
  const remaining = parts.slice(0, parts.length - 3);
  if (remaining.length < 2) return null;

  // First part is always the artist; the rest form the title
  const artist = remaining[0].trim();
  const title = remaining.slice(1).join("-").trim();

  if (!artist || !title) return null;
  return { artist, title, date: dateStr, date_ms };
}

function normKey(s: string): string {
  return s.toLowerCase().replace(/\s+/g, " ").trim();
}

// ── Hook ─────────────────────────────────────────────────────────────────────

export type ScanStatus = "idle" | "scanning" | "analyzing" | "done" | "error";

export interface GpScannerState {
  rootPath: string;
  scanResult: GpScanResult | null;
  status: ScanStatus;
  statusMessage: string;
  progress: { current: number; total: number };
}

export function useGpScanner(token: string) {
  const [rootPath, setRootPathState] = useState<string>(DEFAULT_ROOT);
  const [scanResult, setScanResult] = useState<GpScanResult | null>(null);
  const [status, setStatus] = useState<ScanStatus>("idle");
  const [statusMessage, setStatusMessage] = useState("");
  const [progress, setProgress] = useState({ current: 0, total: 0 });

  // ── Persist root path ───────────────────────────────────────────────────────

  const setRootPath = useCallback(async (path: string) => {
    setRootPathState(path);
    const store = await load(STORE_KEY);
    await store.set("rootPath", path);
    await store.save();
  }, []);

  const loadSettings = useCallback(async () => {
    const store = await load(STORE_KEY);
    const saved = await store.get<string>("rootPath");
    if (saved) setRootPathState(saved);
  }, []);

  // ── Seen-file state ─────────────────────────────────────────────────────────

  async function getSeenMap(): Promise<Record<string, GpSeenEntry>> {
    const store = await load(STORE_KEY);
    return (await store.get<Record<string, GpSeenEntry>>("seen")) ?? {};
  }

  async function saveSeenMap(seen: Record<string, GpSeenEntry>) {
    const store = await load(STORE_KEY);
    await store.set("seen", seen);
    await store.save();
  }

  // ── Main scan ───────────────────────────────────────────────────────────────

  const scan = useCallback(async () => {
    setStatus("scanning");
    setStatusMessage("Scanning directory…");
    setProgress({ current: 0, total: 0 });
    setScanResult(null);

    try {
      // 1. Get all GP files in the library
      const rawEntries: GpFileEntry[] = JSON.parse(
        await invoke<string>("scan_gp_directory", { rootPath })
      );

      // 2. Parse filenames
      const parsed: GpFileParsed[] = [];
      for (const entry of rawEntries) {
        const p = parseFilename(entry.filename);
        if (!p) continue; // skip files that don't match the naming convention
        parsed.push({ ...entry, parsed_artist: p.artist, parsed_title: p.title, parsed_date: p.date, date_ms: p.date_ms });
      }

      // 3. Version deduplication: per artist+title key, keep only the newest date
      const versionMap = new Map<string, GpFileParsed>();
      for (const file of parsed) {
        const key = `${normKey(file.parsed_artist)}|||${normKey(file.parsed_title)}`;
        const existing = versionMap.get(key);
        if (!existing || file.date_ms > existing.date_ms) {
          versionMap.set(key, file);
        }
      }
      const deduped = Array.from(versionMap.values());

      // 4. Fetch song catalog for matching
      setStatusMessage("Fetching song catalog…");
      let allSongs: Song[] = [];
      let page = 1;
      while (true) {
        const resp = await getCatalogSongs(token, page, 100);
        allSongs = allSongs.concat(resp.songs);
        if (allSongs.length >= resp.total) break;
        page++;
      }

      const songIndex = new Map<string, Song>();
      for (const song of allSongs) {
        const key = `${normKey(song.artist_name)}|||${normKey(song.name)}`;
        songIndex.set(key, song);
      }

      // 5. Load seen-file state
      const seen = await getSeenMap();

      // 6. Classify files: matched vs unmatched, new vs skipped
      const matches: GpMatch[] = [];
      const unmatched: GpUnmatched[] = [];
      let skippedCount = 0;

      setStatus("analyzing");
      const toAnalyze = deduped.filter((f) => {
        const prev = seen[f.filename];
        // Skip if we've already processed this exact modification time
        return !prev || prev.modified_ms !== f.modified_ms;
      });

      skippedCount = deduped.length - toAnalyze.length;

      setProgress({ current: 0, total: toAnalyze.length });

      for (let i = 0; i < toAnalyze.length; i++) {
        const file = toAnalyze[i];
        setStatusMessage(`Analyzing ${i + 1}/${toAnalyze.length}: ${file.filename}`);
        setProgress({ current: i + 1, total: toAnalyze.length });

        const key = `${normKey(file.parsed_artist)}|||${normKey(file.parsed_title)}`;
        const song = songIndex.get(key);

        let difficultyScore: number | null = null;
        let difficultyVector: DifficultyVector | null = null;
        let tempoBpm: number | null = null;
        try {
          const rawResult = await invoke<string>("analyze_gp_file", { filePath: file.path });
          const result = JSON.parse(rawResult);
          difficultyScore = typeof result.difficulty_score === "number" ? result.difficulty_score : null;
          difficultyVector = result.vector ?? null;
          tempoBpm = typeof result.tempo_bpm === "number" ? result.tempo_bpm : null;
        } catch {
          // Analysis failed for this file — continue with null score
        }

        // Check if this file is a newer version of a previously seen file
        const prevEntry = seen[file.filename];
        const isNewerVersion =
          !!prevEntry && prevEntry.modified_ms !== file.modified_ms;

        if (song) {
          matches.push({
            file,
            song_id: song.id,
            song_name: song.name,
            artist_name: song.artist_name,
            difficulty_score: difficultyScore,
            difficulty_vector: difficultyVector,
            tempo_bpm: tempoBpm,
            manual_score: null,
            is_newer_version: isNewerVersion,
          });
        } else {
          // Check if a previously dismissed/assigned version exists
          const seenEntry = seen[file.filename];
          unmatched.push({
            file,
            assigned_song_id: seenEntry?.song_id ?? null,
          });
        }
      }

      // Also include previously matched files that were skipped (for display)
      for (const file of deduped) {
        if (toAnalyze.some((f) => f.filename === file.filename)) continue;
        const key = `${normKey(file.parsed_artist)}|||${normKey(file.parsed_title)}`;
        const song = songIndex.get(key);
        const prev = seen[file.filename];
        if (song && prev) {
          matches.push({
            file,
            song_id: song.id,
            song_name: song.name,
            artist_name: song.artist_name,
            difficulty_score: prev.difficulty_score,
            difficulty_vector: prev.difficulty_vector ?? null,
            tempo_bpm: prev.tempo_bpm ?? null,
            manual_score: prev.manual_score ?? null,
            is_newer_version: false,
          });
        }
      }

      setScanResult({ matches, unmatched, skipped_count: skippedCount });
      setStatus("done");
      setStatusMessage(`Done — ${matches.length} matched, ${unmatched.length} unmatched, ${skippedCount} skipped.`);
    } catch (err) {
      setStatus("error");
      setStatusMessage(String(err));
    }
  }, [rootPath, token]);

  // ── Persist scan results after user confirms ────────────────────────────────

  const persistSeenEntries = useCallback(
    async (confirmedMatches: GpMatch[]) => {
      const seen = await getSeenMap();
      for (const match of confirmedMatches) {
        seen[match.file.filename] = {
          modified_ms: match.file.modified_ms,
          song_id: match.song_id,
          difficulty_score: match.manual_score ?? match.difficulty_score,
          difficulty_vector: match.difficulty_vector,
          tempo_bpm: match.tempo_bpm,
          manual_score: match.manual_score,
          resource_path: match.file.path,
          dismissed: false,
        };
      }
      await saveSeenMap(seen);
    },
    []
  );

  const clearSeenCache = useCallback(async () => {
    const store = await load(STORE_KEY);
    await store.set("seen", {});
    await store.save();
  }, []);

  const updateMatchScore = useCallback((filename: string, score: number | null) => {
    setScanResult((prev) =>
      prev
        ? {
            ...prev,
            matches: prev.matches.map((m) =>
              m.file.filename === filename ? { ...m, manual_score: score } : m
            ),
          }
        : prev
    );
  }, []);

  const dismissUnmatched = useCallback(async (filename: string) => {
    const seen = await getSeenMap();
    if (seen[filename]) {
      seen[filename].dismissed = true;
    } else {
      seen[filename] = {
        modified_ms: 0,
        song_id: null,
        difficulty_score: null,
        difficulty_vector: null,
        tempo_bpm: null,
        manual_score: null,
        resource_path: "",
        dismissed: true,
      };
    }
    await saveSeenMap(seen);
    setScanResult((prev) =>
      prev
        ? {
            ...prev,
            unmatched: prev.unmatched.filter((u) => u.file.filename !== filename),
          }
        : prev
    );
  }, []);

  return {
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
  };
}
