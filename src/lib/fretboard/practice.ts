// Practice routines: each builds a list of steps (what to show and play), then a
// timed sequence with a metronome that can drop beats. Ported from the Craft app.

import type { SeqEvent } from "./audio";
import {
  CHORDS,
  KEYS,
  NUM_FRETS,
  SCALES,
  chordIndex,
  chordScale,
  chromaticLabel,
  degreeNumber,
  diatonicChords,
  followPosition,
  plainName,
  roman,
  scalePositions,
  toneFor,
  windowNotes,
  type ChordDef,
  type FretNote,
  type PositionInfo,
  type ScaleDef,
  type Tone,
} from "./theory";

export type Routine = "ladder" | "caged" | "changes" | "extended" | "sequences" | "circle" | "relay" | "metronome";

export const ROUTINES: { id: Routine; name: string; help: string }[] = [
  { id: "ladder", name: "Position ladder", help: "Every position of the scale in turn, low to high: up one, down the next." },
  { id: "caged", name: "CAGED", help: "The five CAGED shapes of the key's chord along the neck. For each shape: strum the chord, play its arpeggio, then play the scale around it." },
  { id: "changes", name: "Chord changes in one position", help: "Play each chord of the progression without leaving your position — its arpeggio or its scale." },
  { id: "extended", name: "Extended arpeggios", help: "Stacked thirds past the octave: 7th, 9th, 11th and 13th arpeggios on each chord of the key." },
  { id: "sequences", name: "Scale sequences", help: "The chosen position in patterns: thirds, groups of three, groups of four." },
  { id: "circle", name: "Circle of fifths", help: "The scale in all 12 keys around the circle of fifths (C G D A…) or fourths (C F Bb Eb…), without moving your hand." },
  { id: "relay", name: "Chord relay", help: "Every chord of the key in order, each in the next shape up the neck on one set of strings, then back down." },
  { id: "metronome", name: "Time keeping", help: "Just the click — set it to drop beats and keep the time yourself." },
];

export type LadderStyle = "alternate" | "updown";
export type SeqPattern = "thirds" | "threes" | "fours";
export const SEQ_PATTERNS: { id: SeqPattern; name: string }[] = [
  { id: "thirds", name: "In thirds" },
  { id: "threes", name: "Groups of 3" },
  { id: "fours", name: "Groups of 4" },
];

export type Extension = 7 | 9 | 11 | 13;
export const EXTENSIONS: { id: Extension; name: string; thirds: number }[] = [
  { id: 7, name: "7th", thirds: 4 },
  { id: 9, name: "9th", thirds: 5 },
  { id: 11, name: "11th", thirds: 6 },
  { id: 13, name: "13th", thirds: 7 },
];

export type Clicks = "off" | "all" | "twofour" | "one" | "bars-1-1" | "bars-2-2" | "bars-1-3" | "rand-25" | "rand-50";
export const CLICK_CHOICES: { id: Clicks; name: string }[] = [
  { id: "off", name: "No click" },
  { id: "all", name: "Every beat" },
  { id: "twofour", name: "Beats 2 and 4 only" },
  { id: "one", name: "Beat 1 only" },
  { id: "bars-1-1", name: "1 bar on, 1 bar silent" },
  { id: "bars-2-2", name: "2 bars on, 2 bars silent" },
  { id: "bars-1-3", name: "1 bar on, 3 bars silent" },
  { id: "rand-25", name: "Drop 25% of beats at random" },
  { id: "rand-50", name: "Drop 50% of beats at random" },
];

export interface PracticeSettings {
  routine: Routine;
  ladder: LadderStyle;
  pattern: SeqPattern;
  extension: Extension;
  everyChord: boolean;
  cagedMinor: boolean;
  changesScale: boolean;
  backing: boolean;
  clicks: Clicks;
  metronomeBars: number;
  /** Speed bursts: groups of this many notes at double speed, each followed by a rest (0 = off). */
  burst: number;
  /** Circle of fifths: go down in fourths (C F Bb…) instead of up in fifths. */
  fourths: boolean;
  relaySevenths: boolean;
  relaySet: number;
  relayBeats: number;
  relayBroken: boolean;
  /** What each note is called as it plays. */
  callouts: "off" | "note" | "interval" | "degree";
  /** Say the call-outs, and the next key in the circle of fifths, out loud. */
  speak: boolean;
  /** Raise the tempo every few loops. */
  speedUp: boolean;
  speedStep: number;
  speedEvery: number;
  speedMax: number;
}

export const DEFAULT_PRACTICE: PracticeSettings = {
  routine: "ladder",
  ladder: "alternate",
  pattern: "thirds",
  extension: 7,
  everyChord: true,
  cagedMinor: false,
  changesScale: false,
  backing: true,
  clicks: "all",
  metronomeBars: 4,
  burst: 0,
  fourths: false,
  relaySevenths: false,
  relaySet: 3,
  relayBeats: 2,
  relayBroken: false,
  callouts: "off",
  speak: false,
  speedUp: false,
  speedStep: 5,
  speedEvery: 2,
  speedMax: 140,
};

/** One step of a routine: what the neck shows and what gets played. */
export interface PracticeStep {
  title: string;
  /** Root and tones the labels are measured from. */
  root: number;
  tones: Tone[];
  /** Notes shown as the current shape. */
  show: FretNote[];
  /** A chord strummed at the start of the step. */
  chord: FretNote[] | null;
  /** Notes played one after another. */
  notes: FretNote[];
  /** Length in beats. */
  beats: number;
}

export interface Plan {
  steps: PracticeStep[];
  message: string | null;
}

/** One chord of a progression, for the chord-changes routine. */
export interface ProgItem {
  root: number;
  chord: number;
  beats: number;
  name: string;
  voicing: FretNote[] | null;
}

const mod = (n: number, m: number) => ((n % m) + m) % m;
const minFret = (n: FretNote[]) => (n.length ? Math.min(...n.map((x) => x[1])) : 0);
const maxFret = (n: FretNote[]) => (n.length ? Math.max(...n.map((x) => x[1])) : 0);

function byPitch(tun: number[], notes: FretNote[]): FretNote[] {
  const sorted = [...notes].sort((a, b) => tun[a[0]] + a[1] - (tun[b[0]] + b[1]) || a[0] - b[0]);
  return sorted.filter((n, i) => i === 0 || tun[n[0]] + n[1] !== tun[sorted[i - 1][0]] + sorted[i - 1][1]);
}

const beatsFor = (notes: number, lead: number, perBeat: number) => Math.max(1, lead + Math.ceil(notes / Math.max(1, perBeat)));

function upDown(up: FretNote[]): FretNote[] {
  const v = [...up];
  if (up.length > 1) v.push(...up.slice(0, up.length - 1).reverse());
  return v;
}

// Standard-tuning CAGED templates for a major chord: [name, root string, fret offset per string].
const CAGED: [string, number, (number | null)[]][] = [
  ["C shape", 1, [null, 0, -1, -3, -2, -3]],
  ["A shape", 1, [null, 0, 2, 2, 2, 0]],
  ["G shape", 0, [0, -1, -3, -3, -3, 0]],
  ["E shape", 0, [0, 2, 2, 1, 0, 0]],
  ["D shape", 2, [null, null, 0, 2, 3, 2]],
];

/** The five CAGED shapes of a major (or minor) chord, low to high on the neck. */
export function cagedShapes(tun: number[], root: number, minor: boolean): { name: string; chord: FretNote[]; arp: FretNote[] }[] {
  const tones = CHORDS[chordIndex(minor ? "m" : "")].tones;
  const out: { name: string; chord: FretNote[]; arp: FretNote[] }[] = [];
  for (const [name, rs, offs] of CAGED) {
    const lowest = Math.min(...offs.filter((o): o is number => o !== null));
    let r = mod(root - tun[rs], 12);
    if (r + lowest < 0) r += 12;
    const chord: FretNote[] = [];
    offs.forEach((o, s) => {
      if (o === null) return;
      let f = r + o;
      // In minor, the major 3rd comes down a fret.
      if (minor && mod(tun[s] + f - root, 12) === 4) f -= 1;
      if (f >= 0) chord.push([s, f]);
    });
    const lo = minFret(chord);
    const hi = maxFret(chord);
    const arp = byPitch(tun, windowNotes(tun, root, tones, Math.max(lo - 1, 0), hi + 1));
    out.push({ name: minor ? name.replace(" shape", "m shape") : name, chord, arp });
  }
  return out.sort((a, b) => minFret(a.chord) - minFret(b.chord));
}

/** The scale CAGED practice plays around each shape: the chosen scale when it holds the chord, otherwise major or natural minor. */
export function cagedScale(chosen: ScaleDef, minor: boolean): ScaleDef {
  const third = minor ? 3 : 4;
  const has = (semi: number) => chosen.tones.some((t) => t.semis === semi);
  if (has(third) && has(7)) return chosen;
  const want = minor ? "Natural Minor (Aeolian)" : "Major (Ionian)";
  return SCALES.find((s) => s.name === want) ?? chosen;
}

/** The scale's notes around a chord shape (a fret either side), at most three per string, nearest the shape first. */
function cagedScaleNotes(tun: number[], root: number, tones: Tone[], lo: number, hi: number): FretNote[] {
  const centre2 = lo + hi;
  const out: FretNote[] = [];
  for (let s = 0; s < 6; s++) {
    const on = windowNotes(tun, root, tones, Math.max(lo - 1, 0), hi + 1).filter((n) => n[0] === s);
    while (on.length > 3) {
      let far = 0;
      on.forEach((n, i) => {
        if (Math.abs(2 * n[1] - centre2) > Math.abs(2 * on[far][1] - centre2)) far = i;
      });
      on.splice(far, 1);
    }
    out.push(...on);
  }
  return byPitch(tun, out);
}

function extLabel(index: number, diff: number): string {
  const L = [
    ["bb1", "b1", "1", "#1", "##1"],
    ["bb3", "b3", "3", "#3", "##3"],
    ["bb5", "b5", "5", "#5", "##5"],
    ["bb7", "b7", "7", "#7", "##7"],
    ["bb9", "b9", "9", "#9", "##9"],
    ["bb11", "b11", "11", "#11", "##11"],
    ["bb13", "b13", "13", "#13", "##13"],
  ];
  return diff >= -2 && diff <= 2 ? L[index][diff + 2] : chromaticLabel(diff);
}

/** Stacked thirds of the scale from one of its degrees: semitones above that degree and label. */
export function stackedThirds(scale: Tone[], degree: number, count: number): Tone[] {
  const MAJOR = [0, 4, 7, 11, 14, 17, 21];
  const n = scale.length;
  const base = scale[degree % n].semis;
  const out: Tone[] = [];
  for (let k = 0; k < Math.min(count, 7); k++) {
    const idx = degree + 2 * k;
    const semis = scale[idx % n].semis + 12 * Math.floor(idx / n) - base;
    out.push({ semis, label: extLabel(k, semis - MAJOR[k]) });
  }
  return out;
}

/** Place ascending pitches on the neck: at most two per string, moving across and up. */
function fingerLine(tun: number[], pitches: number[]): FretNote[] {
  const out: FretNote[] = [];
  let string = 0;
  let onString = 0;
  for (const p of pitches) {
    let best: [number, number, number] | null = null;
    for (let st = string; st < 6; st++) {
      const f = p - tun[st];
      if (f < 0 || f > NUM_FRETS || (st === string && onString >= 2 && out.length > 0)) continue;
      const last = out[out.length - 1];
      const cost = last ? Math.abs(f - last[1]) + 3 * (st - string) : st;
      if (!best || cost < best[0]) best = [cost, st, f];
    }
    if (!best) break;
    if (best[1] !== string) {
      string = best[1];
      onString = 0;
    }
    onString++;
    out.push([best[1], best[2]]);
  }
  return out;
}

function fillBeats(line: FretNote[], count: number): FretNote[] {
  if (!line.length) return [];
  let cycle = upDown(line);
  if (cycle.length > 1) cycle = cycle.slice(0, -1);
  return Array.from({ length: count }, (_, i) => cycle[i % cycle.length]);
}

/** The string sets a chord relay can use: three strings for triads, four for 7th chords. */
export function relayStringSets(sevenths: boolean): { name: string; strings: number[] }[] {
  return sevenths
    ? [
        { name: "Strings 6-5-4-3", strings: [0, 1, 2, 3] },
        { name: "Strings 5-4-3-2", strings: [1, 2, 3, 4] },
        { name: "Strings 4-3-2-1", strings: [2, 3, 4, 5] },
      ]
    : [
        { name: "Strings 6-5-4", strings: [0, 1, 2] },
        { name: "Strings 5-4-3", strings: [1, 2, 3] },
        { name: "Strings 4-3-2", strings: [2, 3, 4] },
        { name: "Strings 3-2-1", strings: [3, 4, 5] },
      ];
}

/** Close-voiced shapes of a chord on adjacent strings: one note per string, every chord tone once, within four frets. */
export function closedVoicings(tun: number[], strings: number[], root: number, tones: Tone[]): FretNote[][] {
  const pcs = tones.map((t) => mod(root + t.semis, 12));
  const out: FretNote[][] = [];
  for (let lo = 0; lo <= NUM_FRETS; lo++) {
    const options = strings.map((s) => {
      const o: number[] = [];
      for (let f = lo; f <= Math.min(lo + 4, NUM_FRETS); f++) if (pcs.includes(mod(tun[s] + f, 12))) o.push(f);
      return o;
    });
    if (options.some((o) => o.length === 0)) continue;
    const idx = options.map(() => 0);
    for (;;) {
      const v: FretNote[] = strings.map((s, k) => [s, options[k][idx[k]]]);
      const got = new Set(v.map(([s, f]) => mod(tun[s] + f, 12)));
      const fr = v.map((n) => n[1]);
      const span = Math.max(...fr) - Math.min(...fr);
      if (got.size === pcs.length && span <= 4 && !out.some((o) => o.every((n, i) => n[0] === v[i][0] && n[1] === v[i][1]))) out.push(v);
      let k = 0;
      for (; k < idx.length; k++) {
        idx[k]++;
        if (idx[k] < options[k].length) break;
        idx[k] = 0;
      }
      if (k === idx.length) break;
    }
  }
  return out.sort((a, b) => a.reduce((s, n) => s + n[1], 0) - b.reduce((s, n) => s + n[1], 0));
}

export function buildPlan(
  set: PracticeSettings,
  perBeat: number,
  tun: number[],
  standard: boolean,
  key: number,
  scale: ScaleDef,
  position: number,
  prog: ProgItem[],
): Plan {
  const root = key;
  const pb = Math.max(1, perBeat);
  const positions = scalePositions(tun, root, scale.tones);
  const window = (p: PositionInfo): [number, number] => (p.notes.length ? [minFret(p.notes), maxFret(p.notes)] : [0, 4]);
  const chosen = positions[position] ?? positions[0];
  const steps: PracticeStep[] = [];
  let message: string | null = null;
  const cycleStep = (up: FretNote[], i: number): { notes: FretNote[]; dir: string } =>
    set.ladder === "alternate" && i % 2 === 1
      ? { notes: [...up].reverse(), dir: "down" }
      : set.ladder === "alternate"
        ? { notes: up, dir: "up" }
        : { notes: upDown(up), dir: "up and down" };

  switch (set.routine) {
    case "ladder": {
      const ps = positions.map((p, n) => ({ p, num: n + 1 })).sort((a, b) => window(a.p)[0] - window(b.p)[0]);
      ps.forEach(({ p, num }, i) => {
        const up = byPitch(tun, p.notes);
        const { notes, dir } = cycleStep(up, i);
        const [lo, hi] = window(p);
        steps.push({ title: `Position ${num} ${dir} · frets ${lo}–${hi}`, root, tones: scale.tones, show: p.notes, chord: null, beats: beatsFor(notes.length, 0, pb), notes });
      });
      break;
    }
    case "caged": {
      if (!standard) {
        message = "CAGED shapes are built for standard tuning — switch the tuning to Standard to use them.";
        break;
      }
      const tones = CHORDS[chordIndex(set.cagedMinor ? "m" : "")].tones;
      const sc = cagedScale(scale, set.cagedMinor);
      const nameKey = `${KEYS[key]}${set.cagedMinor ? "m" : ""}`;
      for (const { name, chord, arp } of cagedShapes(tun, root, set.cagedMinor)) {
        const lo = minFret(chord);
        const hi = maxFret(chord);
        steps.push({ title: `${nameKey} — ${name} (fret ${lo}): chord`, root, tones, show: chord, chord, beats: 2, notes: [] });
        const arpNotes = upDown(arp);
        steps.push({ title: `${nameKey} — ${name}: arpeggio`, root, tones, show: arp, chord: null, beats: beatsFor(arpNotes.length, 0, pb), notes: arpNotes });
        const line = cagedScaleNotes(tun, root, sc.tones, lo, hi);
        const scaleNotes = upDown(line);
        steps.push({ title: `${nameKey} — ${name}: ${KEYS[key]} ${sc.name}`, root, tones: sc.tones, show: line, chord: null, beats: beatsFor(scaleNotes.length, 0, pb), notes: scaleNotes });
      }
      break;
    }
    case "changes": {
      if (prog.length === 0) message = "The progression is empty — pick or build one in the Progressions tab.";
      const [lo, hi] = chosen ? window(chosen) : [0, 4];
      for (const item of prog) {
        const chord = CHORDS[item.chord];
        const rel = mod(item.root - root, 12);
        let what = "arpeggio";
        let tones: Tone[] = chord.tones;
        if (set.changesScale) {
          const cs = chordScale(scale, rel, chord);
          what = cs.name;
          tones = cs.tones;
        }
        const line = byPitch(tun, followPosition(tun, item.root, tones, !set.changesScale, lo, hi));
        const notes = fillBeats(line, item.beats * pb);
        steps.push({ title: `${item.name} — ${what} in frets ${lo}–${hi}`, root: item.root, tones, show: line, chord: set.backing ? item.voicing : null, beats: item.beats, notes });
      }
      break;
    }
    case "extended": {
      const count = EXTENSIONS.find((e) => e.id === set.extension)?.thirds ?? 4;
      const degrees = set.everyChord ? Array.from({ length: Math.min(scale.tones.length, 7) }, (_, i) => i) : [0];
      const target = chosen ? window(chosen)[0] : 3;
      for (const d of degrees) {
        const tones = stackedThirds(scale.tones, d, count);
        const croot = mod(root + scale.tones[d % scale.tones.length].semis, 12);
        // Root on the low E or A string, near the chosen position.
        let start: [number, number] | null = null;
        for (const s of [0, 1]) {
          const r0 = mod(croot - tun[s], 12);
          for (const f of [r0, r0 + 12]) {
            if (f <= 15 && (!start || Math.abs(f - target) < Math.abs(start[1] - target))) start = [s, f];
          }
        }
        if (!start) continue;
        const base = tun[start[0]] + start[1];
        let pitches = tones.map((t) => base + t.semis);
        if (count === 4) pitches = [...pitches, ...tones.map((t) => base + 12 + t.semis), base + 24];
        else if (count === 7) pitches.push(base + 24);
        pitches = pitches.filter((p) => p <= tun[5] + NUM_FRETS);
        const line = fingerLine(tun, pitches);
        if (!line.length) continue;
        const notes = upDown(line);
        const name = EXTENSIONS.find((e) => e.id === set.extension)?.name ?? "7th";
        steps.push({ title: `${plainName(croot)} — ${name} arpeggio: ${tones.map((t) => t.label).join(" ")}`, root: croot, tones, show: line, chord: null, beats: beatsFor(notes.length, 0, pb), notes });
      }
      break;
    }
    case "sequences": {
      if (chosen) {
        const a = byPitch(tun, chosen.notes);
        const size = set.pattern === "thirds" ? 2 : set.pattern === "threes" ? 3 : 4;
        const n = a.length;
        const up: FretNote[] = [];
        const down: FretNote[] = [];
        if (n >= size) {
          for (let i = 0; i <= n - size; i++) {
            if (set.pattern === "thirds") {
              if (i + 2 < n) up.push(a[i], a[i + 2]);
            } else up.push(...a.slice(i, i + size));
          }
          for (let i = n - 1; i >= size - 1; i--) {
            if (set.pattern === "thirds") {
              if (i >= 2) down.push(a[i], a[i - 2]);
            } else down.push(...a.slice(i + 1 - size, i + 1).reverse());
          }
        }
        const [lo, hi] = window(chosen);
        const label = SEQ_PATTERNS.find((p) => p.id === set.pattern)?.name ?? "";
        for (const [dir, notes] of [["up", up], ["down", down]] as [string, FretNote[]][]) {
          if (notes.length) steps.push({ title: `${label} ${dir} · frets ${lo}–${hi}`, root, tones: scale.tones, show: chosen.notes, chord: null, beats: beatsFor(notes.length, 0, pb), notes });
        }
      }
      break;
    }
    case "relay": {
      const chords = diatonicChords(scale.tones, set.relaySevenths);
      const sets = relayStringSets(set.relaySevenths);
      const strings = sets[Math.min(set.relaySet, sets.length - 1)].strings;
      if (chords.length === 0) {
        message = "The chord relay needs a seven-note scale (like Major or a mode) to build the key's chords.";
        break;
      }
      // I ii iii IV V vi vii I, each voiced just above the last, then back down the same way.
      const order: [number, number][] = [...chords, chords[0]];
      const startFret = chosen ? window(chosen)[0] : 0;
      let prev: number | null = null;
      const up: { name: string; croot: number; ci: number; v: FretNote[] }[] = [];
      const centre = (v: FretNote[]) => v.reduce((s, n) => s + n[1], 0) / Math.max(1, v.length);
      for (const [d, ci] of order) {
        const croot = mod(root + scale.tones[d].semis, 12);
        const vs = closedVoicings(tun, strings, croot, CHORDS[ci].tones);
        let pick: FretNote[] | undefined;
        if (prev === null) {
          pick = [...vs].sort((a, b) => Math.abs(centre(a) - startFret) - Math.abs(centre(b) - startFret))[0];
        } else {
          const above = vs.filter((v) => centre(v) > (prev as number) + 0.01).sort((a, b) => centre(a) - centre(b));
          pick = above[0] ?? [...vs].sort((a, b) => centre(b) - centre(a))[0];
        }
        if (!pick) continue;
        prev = centre(pick);
        const bassTone = toneFor(CHORDS[ci].tones, croot, tun[pick[0][0]] + pick[0][1]);
        const bass = degreeNumber(bassTone?.label ?? "1");
        const inversion = bass === 1 ? "root position" : bass === 3 ? "1st inversion" : bass === 5 ? "2nd inversion" : "3rd inversion";
        up.push({ name: `${roman(d, CHORDS[ci])} ${plainName(croot)}${CHORDS[ci].symbol} · ${inversion}`, croot, ci, v: pick });
      }
      const down = [...up].reverse().slice(1);
      for (const [dir, list] of [["up", up], ["down", down]] as const) {
        for (const { name, croot, ci, v } of list) {
          const notes = set.relayBroken ? v : [];
          steps.push({
            title: `${name} · ${dir}`,
            root: croot,
            tones: CHORDS[ci].tones,
            show: v,
            chord: set.relayBroken ? null : v,
            beats: set.relayBroken ? Math.max(beatsFor(notes.length, 0, pb), set.relayBeats) : set.relayBeats,
            notes,
          });
        }
      }
      break;
    }
    case "circle": {
      // Stay in the chosen position: every key's scale is played in the same frets (give or take two).
      const [lo, hi] = chosen ? window(chosen) : [0, 4];
      const stepSemis = set.fourths ? 5 : 7;
      for (let i = 0; i < 12; i++) {
        const k = (key + i * stepSemis) % 12;
        const up = byPitch(tun, followPosition(tun, k, scale.tones, false, lo, hi));
        if (!up.length) continue;
        const { notes, dir } = cycleStep(up, i);
        steps.push({ title: `${KEYS[k]} ${dir} · ${scale.name} in frets ${minFret(up)}–${maxFret(up)}`, root: k, tones: scale.tones, show: up, chord: null, beats: beatsFor(notes.length, 0, pb), notes });
      }
      break;
    }
    case "metronome": {
      steps.push({ title: `${set.metronomeBars} bars of time keeping`, root, tones: scale.tones, show: chosen?.notes ?? [], chord: null, notes: [], beats: set.metronomeBars * 4 });
      break;
    }
  }
  if (steps.length === 0 && message === null) message = "Nothing to practise with these settings.";
  return { steps, message };
}

/** A plan of one run: the given notes up and back down, as one step. */
export function singleRun(tun: number[], title: string, root: number, tones: Tone[], show: FretNote[], perBeat: number): Plan {
  const up = byPitch(tun, show);
  if (!up.length) return { steps: [], message: "There are no notes to play here — pick a position." };
  const notes = upDown(up);
  return { steps: [{ title, root, tones, show, chord: null, notes, beats: beatsFor(notes.length, 0, perBeat) }], message: null };
}

/** How many beats the speed-burst pass of a run takes: whole bursts with their rests. */
export function burstBeats(notes: number, burst: number, perBeat: number): number {
  const b = Math.max(1, burst);
  return Math.ceil((Math.ceil(notes / b) * b) / Math.max(1, perBeat));
}

export interface BuiltPractice {
  events: SeqEvent[];
  length: number;
  totalBeats: number;
}

/** The timed sequence for a plan: step markers, strums, notes and the metronome. */
export function practiceEvents(plan: Plan, set: PracticeSettings, perBeat: number, tun: number[], beat: number, seed = 1): BuiltPractice {
  const stepT = beat / Math.max(1, perBeat);
  const ev: SeqEvent[] = [];
  let t0 = 0;
  let totalBeats = 0;
  const note = (s: number, f: number, t: number, vel: number): SeqEvent => ({
    time: t,
    kind: { type: "note", midi: tun[s] + f, string: s, velocity: vel, highlight: `${s}:${f}` },
  });
  plan.steps.forEach((st, i) => {
    ev.push({ time: t0, kind: { type: "marker", code: `p:${i}` } });
    if (set.routine === "circle") {
      // Announce the key two beats before it starts, so there's time to say it.
      ev.push({ time: Math.max(t0 - 2 * beat, 0), kind: { type: "marker", code: `a:${i}` } });
    }
    if (st.chord) {
      const soft = set.routine === "changes";
      st.chord.forEach(([s, f], k) => ev.push(note(s, f, t0 + k * 0.02, soft ? 0.45 : 0.8)));
    }
    st.notes.forEach(([s, f], k) => ev.push(note(s, f, t0 + k * stepT, k % Math.max(1, perBeat) === 0 ? 0.85 : 0.68)));
    let beats = st.beats;
    if (set.burst > 1 && st.notes.length > 0) {
      // Then the same notes again as speed bursts: groups at double speed, each followed by a rest as long as the burst.
      const b0 = t0 + st.beats * beat;
      ev.push({ time: b0, kind: { type: "marker", code: `b:${i}` } });
      st.chord?.forEach(([s, f], k) => ev.push(note(s, f, b0 + k * 0.02, 0.45)));
      st.notes.forEach(([s, f], k) => {
        const g = Math.floor(k / set.burst);
        const j = k % set.burst;
        ev.push(note(s, f, b0 + g * set.burst * stepT + j * stepT * 0.5, j === 0 ? 0.85 : 0.68));
      });
      beats += burstBeats(st.notes.length, set.burst, perBeat);
    }
    t0 += beats * beat;
    totalBeats += beats;
  });
  if (set.routine === "circle" && totalBeats > 1) {
    // When the routine loops, announce the first key again at the end.
    ev.push({ time: Math.max(totalBeats - 2, 0) * beat, kind: { type: "marker", code: "a:0" } });
  }
  // Metronome
  let rng = (seed | 1) >>> 0;
  const next = () => {
    rng ^= rng << 13;
    rng >>>= 0;
    rng ^= rng >>> 7;
    rng ^= rng << 17;
    rng >>>= 0;
    return rng;
  };
  for (let b = 0; b < totalBeats; b++) {
    const bar = Math.floor(b / 4);
    const inBar = b % 4;
    let play: boolean;
    switch (set.clicks) {
      case "off": play = false; break;
      case "all": play = true; break;
      case "twofour": play = inBar === 1 || inBar === 3; break;
      case "one": play = inBar === 0; break;
      case "bars-1-1": play = bar % 2 < 1; break;
      case "bars-2-2": play = bar % 4 < 2; break;
      case "bars-1-3": play = bar % 4 < 1; break;
      case "rand-25": play = next() % 100 >= 25 || b === 0; break;
      case "rand-50": play = next() % 100 >= 50 || b === 0; break;
    }
    if (play) ev.push({ time: b * beat, kind: { type: "click", accent: inBar === 0 } });
  }
  ev.sort((a, b) => a.time - b.time);
  return { events: ev, length: totalBeats * beat, totalBeats };
}

export type { ChordDef };
