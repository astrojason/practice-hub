//! Writes a [`Song`] as a Guitar Pro 7/8 file (`.gp`): a zip archive holding
//! `Content/score.gpif`. Only what the tab holds is written (notes, rhythm, ties, chord names,
//! section markers, time signatures, tempo and tuning); the rest of a Guitar Pro score
//! (effects, dynamics, layout) is not kept, so this is meant for saving a *new* file.

use std::collections::HashMap;
use std::io::{Cursor, Write};
use std::path::{Path, PathBuf};

use super::model::{Beat, Instrument, Song};

fn esc(s: &str) -> String {
    s.replace('&', "&amp;").replace('<', "&lt;").replace('>', "&gt;").replace('"', "&quot;")
}

fn cdata(s: &str) -> String {
    format!("<![CDATA[{}]]>", s.replace("]]>", "]]]]><![CDATA[>"))
}

fn note_value(dur: u8) -> Result<&'static str, String> {
    Ok(match dur {
        1 => "Whole",
        2 => "Half",
        4 => "Quarter",
        8 => "Eighth",
        16 => "16th",
        32 => "32nd",
        other => return Err(format!("A beat has the note value 1/{other}, which can't be written.")),
    })
}

/// General MIDI drum sounds the five drum lines hold, with their names.
fn drum_name(midi: u8) -> &'static str {
    match midi {
        35 | 36 => "Kick",
        37 => "Side Stick",
        38 | 40 => "Snare",
        41 | 43 | 45 | 47 | 48 | 50 => "Tom",
        42 => "Hi-Hat (closed)",
        44 => "Hi-Hat (pedal)",
        46 => "Hi-Hat (open)",
        49 | 57 => "Crash",
        51 | 59 => "Ride",
        _ => "Percussion",
    }
}

struct NoteOut {
    string: u8,
    fret: u8,
    articulation: usize,
    tie_origin: bool,
    tie_destination: bool,
}

pub fn gpif(song: &Song) -> Result<String, String> {
    if song.tracks.is_empty() {
        return Err("The tab has no tracks to write.".into());
    }
    let bars = song.tracks[0].measures.len();
    if bars == 0 || song.tracks.iter().any(|t| t.measures.len() != bars) {
        return Err("Every track needs the same number of bars (and at least one).".into());
    }

    // Distinct rhythms, shared by every beat that uses them.
    let mut rhythms: Vec<String> = Vec::new();
    let mut rhythm_ids: HashMap<String, usize> = HashMap::new();
    let mut rhythm_for = |b: &Beat| -> Result<usize, String> {
        let dots = if b.double_dotted { 2 } else if b.dotted { 1 } else { 0 };
        let tuplet = if b.triplet { Some([3, 2]) } else { b.tuplet };
        let mut xml = format!("<NoteValue>{}</NoteValue>", note_value(b.dur)?);
        if dots > 0 {
            xml.push_str(&format!("<AugmentationDot count=\"{dots}\"/>"));
        }
        if let Some([num, den]) = tuplet {
            xml.push_str(&format!("<PrimaryTuplet num=\"{num}\" den=\"{den}\"/>"));
        }
        if let Some(&id) = rhythm_ids.get(&xml) {
            return Ok(id);
        }
        let id = rhythms.len();
        rhythms.push(format!("<Rhythm id=\"{id}\">{xml}</Rhythm>"));
        rhythm_ids.insert(xml, id);
        Ok(id)
    };

    let mut tracks_xml = String::new();
    let mut bars_xml = String::new();
    let mut voices_xml = String::new();
    let mut beats_xml = String::new();
    let mut notes_xml = String::new();
    let mut bar_ids: Vec<Vec<usize>> = vec![Vec::new(); bars];
    let (mut next_bar, mut next_voice, mut next_beat, mut next_note) = (0usize, 0usize, 0usize, 0usize);

    for (ti, track) in song.tracks.iter().enumerate() {
        let drums = track.instrument == Instrument::Drums;
        // The drum sounds this track uses, in order of first use.
        let mut articulations: Vec<u8> = Vec::new();
        if drums {
            for m in &track.measures {
                for b in &m.beats {
                    for n in &b.notes {
                        if !articulations.contains(&n.fret) {
                            articulations.push(n.fret);
                        }
                    }
                }
            }
            if articulations.is_empty() {
                articulations.push(38);
            }
        }
        let mut chord_names: Vec<String> = Vec::new();
        // Per string, the id of the last plucked note, so a tie can mark where it starts.
        let mut last_on_string: HashMap<u8, usize> = HashMap::new();
        let mut note_flags: HashMap<usize, bool> = HashMap::new(); // note id -> is a tie origin

        // First pass over the notes to find tie origins.
        struct PendingBeat {
            rhythm: usize,
            chord: Option<usize>,
            notes: Vec<usize>,
        }
        let mut all_notes: Vec<(usize, NoteOut)> = Vec::new();
        let mut per_bar: Vec<Vec<PendingBeat>> = Vec::new();
        for m in &track.measures {
            let mut beats_here = Vec::new();
            for b in &m.beats {
                let rhythm = rhythm_for(b)?;
                let chord = match &b.chord {
                    Some(c) if !c.trim().is_empty() => {
                        let pos = chord_names.iter().position(|x| x == c).unwrap_or_else(|| {
                            chord_names.push(c.clone());
                            chord_names.len() - 1
                        });
                        Some(pos)
                    }
                    _ => None,
                };
                let mut ids = Vec::new();
                for n in &b.notes {
                    let id = next_note;
                    next_note += 1;
                    let articulation = if drums { articulations.iter().position(|&a| a == n.fret).unwrap_or(0) } else { 0 };
                    if n.tie {
                        if let Some(&prev) = last_on_string.get(&n.string) {
                            note_flags.insert(prev, true);
                        }
                    }
                    last_on_string.insert(n.string, id);
                    all_notes.push((id, NoteOut { string: n.string, fret: n.fret, articulation, tie_origin: false, tie_destination: n.tie }));
                    ids.push(id);
                }
                beats_here.push(PendingBeat { rhythm, chord, notes: ids });
            }
            per_bar.push(beats_here);
        }
        for (id, n) in &mut all_notes {
            n.tie_origin = note_flags.get(id).copied().unwrap_or(false);
        }
        let count = track.strings.len();
        for (id, n) in &all_notes {
            let mut props = String::new();
            if !drums {
                if n.string == 0 || n.string as usize > count {
                    return Err(format!("A note in '{}' is on string {}, but the track has {count} strings.", track.name, n.string));
                }
                // Guitar Pro counts strings from the lowest, starting at 0.
                props.push_str(&format!(
                    "<Property name=\"String\"><String>{}</String></Property><Property name=\"Fret\"><Fret>{}</Fret></Property>",
                    count - n.string as usize,
                    n.fret
                ));
            }
            let tie = if n.tie_origin || n.tie_destination {
                format!("<Tie origin=\"{}\" destination=\"{}\"/>", n.tie_origin, n.tie_destination)
            } else {
                String::new()
            };
            let art = if drums { format!("<InstrumentArticulation>{}</InstrumentArticulation>", n.articulation) } else { String::new() };
            notes_xml.push_str(&format!("<Note id=\"{id}\">{tie}<Properties>{props}</Properties>{art}</Note>\n"));
        }
        for (mi, beats_here) in per_bar.iter().enumerate() {
            let mut beat_ids = Vec::new();
            for b in beats_here {
                let id = next_beat;
                next_beat += 1;
                let chord = b.chord.map(|c| format!("<Chord>{c}</Chord>")).unwrap_or_default();
                let notes = if b.notes.is_empty() {
                    String::new()
                } else {
                    format!("<Notes>{}</Notes>", b.notes.iter().map(|n| n.to_string()).collect::<Vec<_>>().join(" "))
                };
                beats_xml.push_str(&format!("<Beat id=\"{id}\"><Dynamic>MF</Dynamic>{chord}<Rhythm ref=\"{}\"/>{notes}</Beat>\n", b.rhythm));
                beat_ids.push(id.to_string());
            }
            let vid = next_voice;
            next_voice += 1;
            voices_xml.push_str(&format!("<Voice id=\"{vid}\"><Beats>{}</Beats></Voice>\n", beat_ids.join(" ")));
            let bid = next_bar;
            next_bar += 1;
            bars_xml.push_str(&format!(
                "<Bar id=\"{bid}\"><Clef>{}</Clef><Voices>{vid} -1 -1 -1</Voices></Bar>\n",
                if drums { "Neutral" } else if track.instrument == Instrument::Bass { "F4" } else { "G2" }
            ));
            bar_ids[mi].push(bid);
        }

        let diagrams = if chord_names.is_empty() {
            String::new()
        } else {
            let items: String = chord_names.iter().enumerate().map(|(i, c)| format!("<Item id=\"{i}\" name=\"{}\"/>", esc(c))).collect();
            format!("<Property name=\"DiagramCollection\"><Items>{items}</Items></Property>")
        };
        let (set, staff_props) = if drums {
            let arts: String = articulations
                .iter()
                .map(|&a| {
                    format!(
                        "<Articulation><Name>{}</Name><StaffLine>0</StaffLine><Noteheads>noteheadBlack</Noteheads><Direction>Up</Direction><OutputMidiNumber>{a}</OutputMidiNumber></Articulation>",
                        drum_name(a)
                    )
                })
                .collect();
            (
                format!("<InstrumentSet><Name>Drums</Name><Type>drumKit</Type><LineCount>5</LineCount><Elements><Element><Name>Drum Kit</Name><Type>drumKit</Type><SoundbankName>Drums</SoundbankName><Articulations>{arts}</Articulations></Element></Elements></InstrumentSet>"),
                String::new(),
            )
        } else {
            let (set_name, set_type, program) = if track.instrument == Instrument::Bass { ("Bass", "electricBass", 33) } else { ("Electric Guitar", "electricGuitar", 29) };
            let pitches: Vec<String> = track.strings.iter().rev().map(|p| p.to_string()).collect();
            (
                format!("<InstrumentSet><Name>{set_name}</Name><Type>{set_type}</Type><LineCount>{count}</LineCount></InstrumentSet><Sounds><Sound><Name>{set_name}</Name><Label>{set_name}</Label><Path>{set_name}</Path><Role>Factory</Role><MIDI><LSB>0</LSB><MSB>0</MSB><Program>{program}</Program></MIDI></Sound></Sounds>"),
                format!("<Property name=\"Tuning\"><Pitches>{}</Pitches><Flat/><Instrument>Guitar</Instrument><Label></Label></Property>", pitches.join(" ")),
            )
        };
        tracks_xml.push_str(&format!(
            "<Track id=\"{ti}\"><Name>{}</Name><ShortName>{}</ShortName>{set}<Staves><Staff id=\"{ti}\"><Properties>{staff_props}</Properties></Staff></Staves><Properties>{diagrams}</Properties><MidiConnection><Port>0</Port><PrimaryChannel>{}</PrimaryChannel><SecondaryChannel>{}</SecondaryChannel><ForeOneProgram>true</ForeOneProgram></MidiConnection></Track>\n",
            cdata(&track.name),
            cdata(&track.name.chars().take(4).collect::<String>()),
            if drums { 9 } else { (ti * 2) % 16 },
            if drums { 9 } else { (ti * 2 + 1) % 16 },
        ));
    }

    let mut master_bars = String::new();
    let mut last_time = song.time;
    for mi in 0..bars {
        let m0 = &song.tracks[0].measures[mi];
        let time = m0.time.unwrap_or(if mi == 0 { song.time } else { last_time });
        last_time = time;
        let section = m0.marker.as_deref().filter(|s| !s.is_empty()).map(|s| format!("<Section><Letter></Letter><Text>{}</Text></Section>", cdata(s))).unwrap_or_default();
        master_bars.push_str(&format!(
            "<MasterBar><Key><AccidentalCount>0</AccidentalCount><Mode>Major</Mode><TransposeAs>Sharp</TransposeAs></Key><Time>{}/{}</Time>{section}<Bars>{}</Bars></MasterBar>\n",
            time[0],
            time[1],
            bar_ids[mi].iter().map(|b| b.to_string()).collect::<Vec<_>>().join(" ")
        ));
    }

    let mut autos = String::new();
    let tempo_cell = |bar: u32, position: f64, bpm: f64, linear: bool| {
        format!("<Automation><Type>Tempo</Type><Linear>{linear}</Linear><Bar>{bar}</Bar><Position>{position}</Position><Visible>true</Visible><Value>{bpm} 2</Value></Automation>")
    };
    if song.tempo_map.is_empty() {
        autos.push_str(&tempo_cell(0, 0.0, song.tempo as f64, false));
    } else {
        for c in &song.tempo_map {
            autos.push_str(&tempo_cell(c.bar, c.position, c.bpm, c.linear));
        }
    }
    let track_list = (0..song.tracks.len()).map(|i| i.to_string()).collect::<Vec<_>>().join(" ");

    Ok(format!(
        "<?xml version=\"1.0\" encoding=\"utf-8\"?>\n<GPIF><GPVersion>7.5.0.0</GPVersion><GPRevision required=\"12024\" recommended=\"12024\">12024</GPRevision><Encoding><EncodingDescription>GP7</EncodingDescription></Encoding>\n\
<Score><Title>{}</Title><SubTitle></SubTitle><Artist>{}</Artist><Album></Album><Words></Words><Music></Music><WordsAndMusic></WordsAndMusic><Copyright></Copyright><Tabber>{}</Tabber><Instructions></Instructions><Notices></Notices></Score>\n\
<MasterTrack><Tracks>{track_list}</Tracks><Automations>{autos}</Automations></MasterTrack>\n\
<Tracks>\n{tracks_xml}</Tracks>\n<MasterBars>\n{master_bars}</MasterBars>\n<Bars>\n{bars_xml}</Bars>\n<Voices>\n{voices_xml}</Voices>\n<Beats>\n{beats_xml}</Beats>\n<Notes>\n{notes_xml}</Notes>\n<Rhythms>{}</Rhythms>\n</GPIF>\n",
        cdata(&song.title),
        cdata(&song.artist),
        cdata(&song.author),
        rhythms.join("")
    ))
}

/// Where a saved copy of `original` goes: next to it as "<name> (edited).gp", or "(edited 2)" and
/// so on when that name is taken, so nothing is ever overwritten.
pub fn copy_path(original: &Path, taken: impl Fn(&Path) -> bool) -> PathBuf {
    let dir = original.parent().unwrap_or_else(|| Path::new("."));
    let stem = original.file_stem().map(|s| s.to_string_lossy().to_string()).unwrap_or_else(|| "Untitled".into());
    let mut n = 1;
    loop {
        let label = if n == 1 { "edited".to_string() } else { format!("edited {n}") };
        let candidate = dir.join(format!("{stem} ({label}).gp"));
        if !taken(&candidate) {
            return candidate;
        }
        n += 1;
    }
}

/// The bytes of a `.gp` file for the song.
pub fn write_gp(song: &Song) -> Result<Vec<u8>, String> {
    let xml = gpif(song)?;
    let mut out = Cursor::new(Vec::new());
    {
        let mut zip = zip::ZipWriter::new(&mut out);
        let opts = zip::write::SimpleFileOptions::default().compression_method(zip::CompressionMethod::Deflated);
        zip.start_file("Content/score.gpif", opts).map_err(|e| format!("The file couldn't be built: {e}"))?;
        zip.write_all(xml.as_bytes()).map_err(|e| format!("The file couldn't be built: {e}"))?;
        zip.finish().map_err(|e| format!("The file couldn't be built: {e}"))?;
    }
    Ok(out.into_inner())
}

#[cfg(test)]
mod tests {
    use super::super::gp::read_gp;
    use super::super::model::{Measure, Note, TempoChange, Track};
    use super::*;

    fn beat(dur: u8, notes: Vec<Note>) -> Beat {
        Beat { dur, dotted: false, triplet: false, double_dotted: false, tuplet: None, notes, chord: None }
    }
    fn note(string: u8, fret: u8) -> Note {
        Note { string, fret, tie: false }
    }

    fn sample() -> Song {
        let mut b2 = beat(8, vec![note(2, 5), note(5, 3)]);
        b2.dotted = true;
        b2.chord = Some("Am".into());
        let mut tied = note(2, 5);
        tied.tie = true;
        let mut trip = beat(8, vec![note(1, 0)]);
        trip.triplet = true;
        let mut quint = beat(16, vec![note(1, 2)]);
        quint.tuplet = Some([5, 4]);
        let guitar = Track {
            name: "Lead & <Rhythm>".into(),
            instrument: Instrument::Guitar,
            tuning: "standard".into(),
            strings: vec![64, 59, 55, 50, 45, 40],
            difficulty: 1,
            measures: vec![
                Measure { beats: vec![beat(4, vec![note(1, 3)]), b2, beat(4, vec![tied]), beat(4, vec![])], marker: Some("Intro".into()), time: None },
                Measure { beats: vec![trip.clone(), trip.clone(), trip, beat(2, vec![]), quint], marker: None, time: None },
                Measure { beats: vec![beat(2, vec![note(3, 7)]), beat(4, vec![])], marker: None, time: Some([3, 4]) },
            ],
        };
        let bass = Track {
            name: "Bass".into(),
            instrument: Instrument::Bass,
            tuning: "bass-standard".into(),
            strings: vec![43, 38, 33, 28],
            difficulty: 1,
            measures: (0..3).map(|i| Measure { beats: vec![beat(1, vec![note(4, i)])], marker: if i == 0 { Some("Intro".into()) } else { None }, time: if i == 2 { Some([3, 4]) } else { None } }).collect(),
        };
        let drums = Track {
            name: "Drums".into(),
            instrument: Instrument::Drums,
            tuning: "drums".into(),
            strings: vec![49, 42, 38, 45, 36],
            difficulty: 1,
            measures: (0..3)
                .map(|i| Measure {
                    beats: vec![beat(4, vec![Note { string: 2, fret: 42, tie: false }, Note { string: 5, fret: 36, tie: false }]), beat(4, vec![Note { string: 3, fret: 38, tie: false }]), beat(2, vec![])],
                    marker: if i == 0 { Some("Intro".into()) } else { None },
                    time: if i == 2 { Some([3, 4]) } else { None },
                })
                .collect(),
        };
        let mut s = Song {
            id: "x".into(),
            title: "Round & Trip".into(),
            artist: "The <Testers>".into(),
            tempo: 100,
            tempo_map: vec![],
            time: [4, 4],
            tracks: vec![guitar, bass, drums],
            source: "folder".into(),
            author: "Me".into(),
            revised: String::new(),
        };
        s.tracks[1].measures[1].beats = vec![beat(1, vec![note(4, 1)])];
        s
    }

    #[test]
    fn written_files_read_back_the_same() {
        let song = sample();
        let bytes = write_gp(&song).unwrap();
        let back = read_gp(&bytes, "x", "fallback").unwrap();
        assert_eq!(back.title, song.title);
        assert_eq!(back.artist, song.artist);
        assert_eq!(back.author, song.author);
        assert_eq!(back.tempo, 100);
        assert_eq!(back.time, [4, 4]);
        assert_eq!(back.tracks.len(), 3);
        for (a, b) in song.tracks.iter().zip(&back.tracks) {
            assert_eq!(a.name, b.name);
            assert_eq!(a.instrument, b.instrument);
            assert_eq!(a.strings, b.strings);
            assert_eq!(a.measures, b.measures, "track {}", a.name);
        }
    }

    #[test]
    fn tempo_changes_are_kept() {
        let mut song = sample();
        song.tempo_map = vec![
            TempoChange { bar: 0, position: 0.0, bpm: 100.0, linear: false },
            TempoChange { bar: 2, position: 0.5, bpm: 140.0, linear: true },
        ];
        let back = read_gp(&write_gp(&song).unwrap(), "x", "f").unwrap();
        assert_eq!(back.tempo_map, song.tempo_map);
    }

    #[test]
    fn copies_go_next_to_the_original_and_never_overwrite() {
        let orig = Path::new("/music/Song.gp");
        assert_eq!(copy_path(orig, |_| false), Path::new("/music/Song (edited).gp"));
        let taken = |p: &Path| p.ends_with("Song (edited).gp") || p.ends_with("Song (edited 2).gp");
        assert_eq!(copy_path(orig, taken), Path::new("/music/Song (edited 3).gp"));
    }

    #[test]
    fn rejects_tracks_with_different_bar_counts() {
        let mut song = sample();
        song.tracks[1].measures.pop();
        assert!(write_gp(&song).unwrap_err().contains("same number of bars"));
    }
}
