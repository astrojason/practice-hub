// The song model produced by the Rust `read_tab_file` command (src-tauri/src/tab/model.rs).

export type Instrument = "guitar" | "bass" | "drums";

export interface TabNote {
  /** 1 is the highest string. For drums: the line the note sits on. */
  string: number;
  /** The fret. For drums: the General MIDI drum number. */
  fret: number;
  tie?: boolean;
}

export interface TabBeat {
  /** 1 whole, 2 half, 4 quarter, 8 eighth, 16 sixteenth, 32 thirty-second. */
  dur: number;
  dotted?: boolean;
  triplet?: boolean;
  doubleDotted?: boolean;
  tuplet?: [number, number];
  /** Empty means a rest. */
  notes: TabNote[];
  chord?: string;
}

export interface TabMeasure {
  beats: TabBeat[];
  marker?: string;
  time?: [number, number];
}

export interface TabTrack {
  name: string;
  instrument: Instrument;
  tuning: string;
  /** Open-string MIDI pitches from string 1 (highest) down. */
  strings: number[];
  difficulty: number;
  measures: TabMeasure[];
}

export interface TempoChange {
  bar: number;
  position: number;
  bpm: number;
  linear?: boolean;
}

export interface TabSong {
  id: string;
  title: string;
  artist: string;
  tempo: number;
  tempoMap?: TempoChange[];
  time: [number, number];
  tracks: TabTrack[];
  source: string;
  author?: string;
  revised?: string;
}
