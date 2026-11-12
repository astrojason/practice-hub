// The chord-sheet display: one cell per bar with the chords played in it. Ported from Tabline.

import { noteName } from "./tabRender";
import type { TabSong } from "./types";

const CHORD_SHAPES: [string, number[]][] = [
  ["", [0, 4, 7]],
  ["m", [0, 3, 7]],
  ["7", [0, 4, 7, 10]],
  ["maj7", [0, 4, 7, 11]],
  ["m7", [0, 3, 7, 10]],
  ["5", [0, 7]],
  ["dim", [0, 3, 6]],
  ["sus4", [0, 5, 7]],
];

/** Names the chord a set of MIDI pitches makes, or "" when they don't form one. */
export function detectChord(pitches: number[]): string {
  if (pitches.length < 2) return "";
  const pcs = [...new Set(pitches.map((p) => ((Math.round(p) % 12) + 12) % 12))];
  const bass = ((Math.round(Math.min(...pitches)) % 12) + 12) % 12;
  let best = "";
  let bestScore = 0;
  for (let root = 0; root < 12; root++) {
    for (const [suffix, shape] of CHORD_SHAPES) {
      const want = shape.map((i) => (root + i) % 12);
      if (!pcs.every((pc) => want.includes(pc))) continue;
      const covered = want.filter((pc) => pcs.includes(pc)).length;
      if (covered < Math.min(2, want.length)) continue;
      const score = covered / want.length + (root === bass ? 0.5 : 0) + (shape.length === 3 ? 0.05 : 0);
      if (score > bestScore) {
        bestScore = score;
        best = noteName(root) + suffix;
      }
    }
  }
  return best;
}

/** The chords of each bar: the written names first, else what the notes of the bar make. */
export function barChords(song: TabSong, trackIndex: number, transpose = 0): string[][] {
  return song.tracks[trackIndex].measures.map((m, mi) => {
    const named = m.beats.filter((b) => b.chord).map((b) => b.chord as string);
    if (named.length) return named;
    const pitches: number[] = [];
    for (const t of song.tracks) {
      if (t.instrument === "drums") continue;
      for (const b of t.measures[mi]?.beats ?? []) for (const n of b.notes) pitches.push(t.strings[n.string - 1] + n.fret + transpose);
    }
    const c = detectChord(pitches);
    return c ? [c] : [];
  });
}

export interface ChordSheetLayout {
  bars: { el: HTMLElement }[];
}

export function renderChordSheet(host: HTMLElement, song: TabSong, trackIndex: number, transpose = 0): ChordSheetLayout {
  host.replaceChildren();
  const grid = document.createElement("div");
  grid.className = "chord-sheet";
  const chords = barChords(song, trackIndex, transpose);
  const bars: { el: HTMLElement }[] = [];
  song.tracks[trackIndex].measures.forEach((m, i) => {
    const cell = document.createElement("div");
    cell.className = "chord-bar";
    cell.dataset.bar = String(i);
    const no = document.createElement("div");
    no.className = "bar-no";
    no.textContent = String(i + 1);
    const names = document.createElement("div");
    names.className = "chords";
    for (const c of chords[i].length ? chords[i] : ["–"]) {
      const span = document.createElement("span");
      span.textContent = c;
      names.appendChild(span);
    }
    cell.append(no, names);
    if (m.marker) {
      const mk = document.createElement("div");
      mk.className = "marker";
      mk.textContent = m.marker;
      cell.appendChild(mk);
    }
    grid.appendChild(cell);
    bars.push({ el: cell });
  });
  host.appendChild(grid);
  return { bars };
}
