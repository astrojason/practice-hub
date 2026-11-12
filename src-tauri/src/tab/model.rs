//! The data a tab is made of: songs, tracks, measures, beats and notes.

use serde::{Deserialize, Serialize};

/// Ticks in a whole note. A quarter note is 960 ticks.
pub const WHOLE: u32 = 3840;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Hash)]
#[serde(rename_all = "lowercase")]
pub enum Instrument {
    Guitar,
    Bass,
    Drums,
}

/// One note. For guitar and bass `string` counts from 1 (the highest string) and `fret` is the
/// fret. For drums `string` is the line it sits on and `fret` is the General MIDI drum number.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Note {
    pub string: u8,
    pub fret: u8,
    /// Held over from the note before on the same string: it isn't plucked again.
    #[serde(default, skip_serializing_if = "is_false")]
    pub tie: bool,
}

fn is_false(b: &bool) -> bool {
    !*b
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Beat {
    /// 1 whole, 2 half, 4 quarter, 8 eighth, 16 sixteenth, 32 thirty-second.
    pub dur: u8,
    #[serde(default)]
    pub dotted: bool,
    /// Plays three in the time of two.
    #[serde(default)]
    pub triplet: bool,
    #[serde(default, skip_serializing_if = "is_false")]
    pub double_dotted: bool,
    /// Any other tuplet: `num` notes in the time of `den`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub tuplet: Option<[u8; 2]>,
    /// Empty means a rest.
    #[serde(default)]
    pub notes: Vec<Note>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub chord: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Measure {
    pub beats: Vec<Beat>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub marker: Option<String>,
    /// A time signature for this bar when it differs from the song's.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub time: Option<[u8; 2]>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Track {
    pub name: String,
    pub instrument: Instrument,
    /// Tuning id from [`super::tunings`] (`drums` for a drum kit).
    pub tuning: String,
    /// Open-string MIDI pitches from string 1 (highest) down; drum line pitches for drums.
    pub strings: Vec<u8>,
    /// 1 (easiest) to 8 (hardest).
    pub difficulty: u8,
    pub measures: Vec<Measure>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Song {
    pub id: String,
    pub title: String,
    pub artist: String,
    /// Quarter notes per minute.
    pub tempo: u16,
    /// Tempo changes during the song (empty: `tempo` throughout).
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub tempo_map: Vec<TempoChange>,
    /// Beats per bar and the note value of a beat, e.g. [6, 8].
    pub time: [u8; 2],
    pub tracks: Vec<Track>,
    /// `catalog` for the built-in songs, `user` for tabs made in the app.
    pub source: String,
    #[serde(default)]
    pub author: String,
    /// Date of the last change, YYYY-MM-DD.
    #[serde(default)]
    pub revised: String,
}

/// A change of tempo at a place in the song.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TempoChange {
    /// Bar index (0-based, in playing order).
    pub bar: u32,
    /// How far into the bar, 0 to 1.
    pub position: f64,
    /// Quarter notes a minute from here.
    pub bpm: f64,
    /// The tempo glides from here to the next change instead of jumping.
    #[serde(default)]
    pub linear: bool,
}
