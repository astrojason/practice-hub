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

/**
 * Computes a beat.id -> {startMs, durationMs} lookup for every beat in the
 * score, honoring mid-song tempo changes (MasterBar.tempoAutomations).
 *
 * MIDI ticks are tempo-independent (a fixed count per quarter note); tempo
 * automations describe "this many BPM from this tick onward". We build the
 * tick timeline once via alphaTab's own MidiFileGenerator (so bar/beat tick
 * positions match exactly what alphaTab's own player would use), then
 * integrate tick -> ms ourselves across tempo segments.
 */
export function buildBeatTiming(score: alphaTab.model.Score): Map<number, BeatTiming> {
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
