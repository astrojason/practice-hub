import * as alphaTab from "@coderline/alphatab";

// Re-exported so callers (and tests running via dynamic import in a browser
// eval context, which can't resolve bare package specifiers on their own)
// can reach alphaTab's parsing-only API without a second import.
export { alphaTab };

const FILE_SERVER = "http://127.0.0.1:17865";

export interface BeatTiming {
  startMs: number;
  durationMs: number;
}

/**
 * Parses Guitar Pro / MusicXML bytes into a Score. Uses alphaTab purely as a
 * file-format parser — no renderer, player, or worker involved.
 */
export function parseScoreBytes(bytes: Uint8Array): alphaTab.model.Score {
  return alphaTab.importer.ScoreLoader.loadScoreFromBytes(bytes);
}

export async function loadScoreFromFile(filePath: string): Promise<alphaTab.model.Score> {
  const url = `${FILE_SERVER}/asset?path=${encodeURIComponent(filePath)}`;
  let res: Response;
  try {
    res = await fetch(url);
  } catch (err) {
    throw new Error(`Couldn't reach the tab file server for "${filePath}". (${err instanceof Error ? err.message : String(err)})`);
  }
  if (!res.ok) {
    throw new Error(`Couldn't load tab file "${filePath}": server responded ${res.status} ${res.statusText}`);
  }
  const bytes = new Uint8Array(await res.arrayBuffer());
  try {
    return parseScoreBytes(bytes);
  } catch (err) {
    throw new Error(`Couldn't parse "${filePath}" as a Guitar Pro / MusicXML file. (${err instanceof Error ? err.message : String(err)})`);
  }
}

interface TempoTimeline {
  tickToMs: (tick: number) => number;
  tickLookup: alphaTab.midi.MidiTickLookup;
}

/**
 * Builds the tick -> ms conversion for a score, honoring mid-song tempo
 * changes (MasterBar.tempoAutomations).
 *
 * MIDI ticks are tempo-independent (a fixed count per quarter note); tempo
 * automations describe "this many BPM from this tick onward". We build the
 * tick timeline once via alphaTab's own MidiFileGenerator (so bar/beat tick
 * positions match exactly what alphaTab's own player would use), then
 * integrate tick -> ms ourselves across tempo segments.
 *
 * Shared by buildBeatTiming (the tab's own notated-tempo timeline) and
 * buildAudioSyncPoints (converting sync-point bar positions into that same
 * timeline for calibration against real audio time).
 */
function buildTempoTimeline(score: alphaTab.model.Score): TempoTimeline {
  const settings = new alphaTab.Settings();
  const midiFile = new alphaTab.midi.MidiFile();
  const handler = new alphaTab.midi.AlphaSynthMidiFileHandler(midiFile);
  const generator = new alphaTab.midi.MidiFileGenerator(score, settings, handler);
  generator.generate();

  const division = midiFile.division;
  const tickLookup = generator.tickLookup;

  const tempoPoints: { tick: number; bpm: number }[] = [{ tick: 0, bpm: score.tempo }];
  for (const masterBar of score.masterBars) {
    const barStartTick = tickLookup.getMasterBarStart(masterBar);
    for (const automation of masterBar.tempoAutomations) {
      // ratioPosition is 0..1 within the bar; masterBar.calculateDuration()
      // gives the bar's length in ticks at the *original* time signature,
      // which is what ratioPosition is relative to.
      const barDurationTicks = masterBar.calculateDuration();
      const tick = barStartTick + Math.round(automation.ratioPosition * barDurationTicks);
      tempoPoints.push({ tick, bpm: automation.value });
    }
  }
  tempoPoints.sort((a, b) => a.tick - b.tick);

  function tickToMs(targetTick: number): number {
    let ms = 0;
    for (let i = 0; i < tempoPoints.length; i++) {
      const point = tempoPoints[i];
      if (point.tick >= targetTick) break;
      const next = tempoPoints[i + 1];
      const segmentEndTick = next ? Math.min(next.tick, targetTick) : targetTick;
      const segmentTicks = segmentEndTick - point.tick;
      ms += (segmentTicks / division) * (60000 / point.bpm);
    }
    return ms;
  }

  return { tickToMs, tickLookup };
}

/**
 * Computes a beat.id -> {startMs, durationMs} lookup for every beat in the
 * score, in the tab's own notated-tempo timeline (see buildTempoTimeline).
 */
export function buildBeatTiming(score: alphaTab.model.Score): Map<number, BeatTiming> {
  const { tickToMs, tickLookup } = buildTempoTimeline(score);

  const timing = new Map<number, BeatTiming>();
  for (const track of score.tracks) {
    for (const staff of track.staves) {
      for (const bar of staff.bars) {
        for (const voice of bar.voices) {
          for (const beat of voice.beats) {
            const startTick = tickLookup.getBeatStart(beat);
            const startMs = tickToMs(startTick);
            const endMs = tickToMs(startTick + beat.playbackDuration);
            timing.set(beat.id, { startMs, durationMs: endMs - startMs });
          }
        }
      }
    }
  }
  return timing;
}

// ─── Audio sync points ─────────────────────────────────────────────────────
//
// Guitar Pro lets you attach a real backing-track recording to a score and
// place "sync points" (MasterBar.syncPoints) calibrating specific bars
// against that recording's real timestamps — exactly the mechanism needed
// to keep the tab cursor locked to a real, humanly-performed recording
// instead of assuming it was played back exactly on the notated tempo map.
// Sites like Songsterr rely on this same idea for their licensed audio.
//
// Without sync points, the cursor's position is just "raw elapsed seconds
// in the loaded audio file," which only matches the tab's notated-tempo
// timeline if the recording happens to follow that tempo map exactly — real
// recordings essentially never do. With sync points, we instead calibrate:
// convert each sync point's bar position into the tab's own timeline (via
// the same tempo map used for note layout), pair it with the real audio
// millisecond offset the file already tells us it corresponds to, and
// interpolate between those checkpoints.

export interface AudioSyncPoint {
  audioMs: number;
  tabMs: number;
}

/**
 * Builds a calibration curve from the score's sync points, sorted by
 * audioMs. Returns null if the score has none, so callers can fall back to
 * using raw audio time directly (unchanged behavior for files without
 * sync points).
 */
export function buildAudioSyncPoints(score: alphaTab.model.Score): AudioSyncPoint[] | null {
  const { tickToMs, tickLookup } = buildTempoTimeline(score);

  const points: AudioSyncPoint[] = [];
  for (const masterBar of score.masterBars) {
    if (!masterBar.syncPoints) continue;
    const barStartTick = tickLookup.getMasterBarStart(masterBar);
    const barDurationTicks = masterBar.calculateDuration();
    for (const sync of masterBar.syncPoints) {
      // syncPointValue is guaranteed set here: buildTempoTimeline() (above)
      // already ran the score through alphaTab's own MidiFileGenerator,
      // which itself reads every syncPoints entry's syncPointValue and
      // throws if one is missing — a malformed entry can't survive to
      // reach this loop.
      const tick = barStartTick + Math.round(sync.ratioPosition * barDurationTicks);
      points.push({ audioMs: sync.syncPointValue!.millisecondOffset, tabMs: tickToMs(tick) });
    }
  }
  if (points.length === 0) return null;
  points.sort((a, b) => a.audioMs - b.audioMs);
  return points;
}

/**
 * Converts real elapsed audio-track milliseconds into the tab's own
 * notated-tempo timeline, using sync points (see buildAudioSyncPoints) as
 * calibration checkpoints. Piecewise-linear between checkpoints; the first
 * and last segments' slopes extrapolate outside the checkpoint range.
 */
export function audioMsToTabMs(syncPoints: AudioSyncPoint[], audioMs: number): number {
  if (syncPoints.length === 1) {
    const only = syncPoints[0];
    return only.tabMs + (audioMs - only.audioMs);
  }
  let i = 0;
  while (i < syncPoints.length - 2 && audioMs > syncPoints[i + 1].audioMs) i++;
  const a = syncPoints[i];
  const b = syncPoints[i + 1];
  const audioSpan = b.audioMs - a.audioMs;
  const ratio = audioSpan === 0 ? 0 : (b.tabMs - a.tabMs) / audioSpan;
  return a.tabMs + (audioMs - a.audioMs) * ratio;
}
