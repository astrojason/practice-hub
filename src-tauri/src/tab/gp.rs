//! Reads Guitar Pro 7 and 8 files (`.gp`): a zip archive holding `Content/score.gpif`, an XML
//! description of the score. Guitar, bass and drum tracks become [`Song`] tracks; repeats are
//! played out in order so the tab plays the way it is written.

use std::collections::HashMap;
use std::io::{Cursor, Read};

use roxmltree::{Document, Node};

use super::model::{Beat, Instrument, Measure, Note, Song, TempoChange, Track, WHOLE};
use super::tunings;

/// The most bars a song may have once its repeats are played out.
const MAX_BARS: usize = 4000;
/// The largest score.gpif read (uncompressed).
const MAX_XML_BYTES: u64 = 64 * 1024 * 1024;

pub fn read_gp(bytes: &[u8], id: &str, fallback_title: &str) -> Result<Song, String> {
    let mut zip = zip::ZipArchive::new(Cursor::new(bytes)).map_err(|e| {
        if bytes.starts_with(b"BCFZ") || bytes.starts_with(b"BCFS") {
            "This is a Guitar Pro 6 file (.gpx inside a .gp name); only Guitar Pro 7 and 8 .gp files can be read.".to_string()
        } else if bytes.starts_with(b"\x18FICHIER GUITAR PRO") || bytes.get(1..20) == Some(b"FICHIER GUITAR PRO ") {
            "This is an older Guitar Pro file (version 3, 4 or 5); only Guitar Pro 7 and 8 .gp files can be read.".to_string()
        } else {
            format!("This isn't a Guitar Pro 7/8 file (it isn't a zip archive): {e}")
        }
    })?;
    let mut entry = zip
        .by_name("Content/score.gpif")
        .map_err(|_| "This .gp file has no score inside (Content/score.gpif is missing).".to_string())?;
    if entry.size() > MAX_XML_BYTES {
        return Err(format!("The score inside is {} MB, more than this app reads.", entry.size() / 1_048_576));
    }
    let mut xml = String::new();
    entry.read_to_string(&mut xml).map_err(|e| format!("The score inside couldn't be unpacked: {e}"))?;
    parse_gpif(&xml, id, fallback_title)
}

fn child<'a, 'i>(n: Node<'a, 'i>, name: &str) -> Option<Node<'a, 'i>> {
    n.children().find(|c| c.has_tag_name(name))
}

fn children<'a, 'i>(n: Node<'a, 'i>, name: &'a str) -> impl Iterator<Item = Node<'a, 'i>> + 'a {
    n.children().filter(move |c| c.has_tag_name(name))
}

fn text(n: Option<Node>) -> String {
    n.map(|n| n.children().filter_map(|c| c.text()).collect::<String>().trim().to_string()).unwrap_or_default()
}

fn ids(s: &str) -> Vec<i64> {
    s.split_whitespace().filter_map(|x| x.parse().ok()).collect()
}

/// `<Property name="...">` among a node's descendants.
fn property<'a, 'i>(n: Node<'a, 'i>, name: &str) -> Option<Node<'a, 'i>> {
    n.descendants().find(|d| d.has_tag_name("Property") && d.attribute("name") == Some(name))
}

fn index_by_id<'a, 'i>(root: Node<'a, 'i>, group: &str, item: &'a str) -> HashMap<i64, Node<'a, 'i>> {
    let mut map = HashMap::new();
    if let Some(g) = child(root, group) {
        for n in children(g, item) {
            if let Some(id) = n.attribute("id").and_then(|v| v.parse().ok()) {
                map.insert(id, n);
            }
        }
    }
    map
}

struct TrackInfo<'a, 'i> {
    _node: Node<'a, 'i>,
    name: String,
    instrument: Instrument,
    /// Open-string pitches, highest string first (drums: the five drum lines).
    strings: Vec<u8>,
    tuning: String,
    staff_offset: usize,
    drum_articulations: Vec<u8>,
    chord_names: HashMap<String, String>,
}

pub fn parse_gpif(xml: &str, id: &str, fallback_title: &str) -> Result<Song, String> {
    let opts = roxmltree::ParsingOptions { allow_dtd: true, ..Default::default() };
    let doc = Document::parse_with_options(xml, opts).map_err(|e| format!("The score inside isn't valid XML: {e}"))?;
    let root = doc.root_element();
    if !root.has_tag_name("GPIF") {
        return Err(format!("The score inside isn't a Guitar Pro score (it starts with <{}>).", root.tag_name().name()));
    }
    let score = child(root, "Score");
    let title = score.map(|s| text(child(s, "Title"))).filter(|t| !t.is_empty()).unwrap_or_else(|| fallback_title.to_string());
    let artist = score.map(|s| text(child(s, "Artist"))).unwrap_or_default();
    let tabber = score.map(|s| text(child(s, "Tabber"))).unwrap_or_default();

    let master = child(root, "MasterTrack").ok_or("The score has no MasterTrack.")?;
    let tempo_points = read_tempo_points(master);
    let tempo = tempo_points.first().map(|p| p.bpm.round().clamp(20.0, 400.0) as u16).unwrap_or(120);
    let track_ids = ids(&text(child(master, "Tracks")));
    let track_nodes = index_by_id(root, "Tracks", "Track");
    let bars = index_by_id(root, "Bars", "Bar");
    let voices = index_by_id(root, "Voices", "Voice");
    let beats = index_by_id(root, "Beats", "Beat");
    let notes = index_by_id(root, "Notes", "Note");
    let rhythms = index_by_id(root, "Rhythms", "Rhythm");

    // Each track has one or more staves; master bars list one bar per staff, track by track.
    let mut infos: Vec<TrackInfo> = Vec::new();
    let mut skipped: Vec<String> = Vec::new();
    let mut staff_offset = 0usize;
    for tid in &track_ids {
        let node = *track_nodes.get(tid).ok_or_else(|| format!("Track {tid} is listed but missing."))?;
        let staves = child(node, "Staves").map(|s| children(s, "Staff").count()).unwrap_or(1).max(1);
        let name = text(child(node, "Name"));
        let set_type = child(node, "InstrumentSet").map(|s| text(child(s, "Type"))).unwrap_or_default();
        let tuning_pitches: Vec<u8> = property(node, "Tuning")
            .map(|p| text(child(p, "Pitches")))
            .map(|t| t.split_whitespace().filter_map(|x| x.parse::<u8>().ok()).collect())
            .unwrap_or_default();
        let info = if set_type == "drumKit" {
            let drum_articulations = child(node, "InstrumentSet")
                .and_then(|s| child(s, "Elements"))
                .map(|els| {
                    els.descendants()
                        .filter(|d| d.has_tag_name("Articulation"))
                        .map(|a| text(child(a, "OutputMidiNumber")).parse::<u8>().unwrap_or(38))
                        .collect()
                })
                .unwrap_or_default();
            Some(TrackInfo {
                _node: node,
                name: if name.is_empty() { "Drums".into() } else { name.clone() },
                instrument: Instrument::Drums,
                strings: tunings::find("drums").expect("drum kit tuning").strings.to_vec(),
                tuning: "drums".into(),
                staff_offset,
                drum_articulations,
                chord_names: HashMap::new(),
            })
        } else if !tuning_pitches.is_empty() {
            let strings: Vec<u8> = tuning_pitches.iter().rev().copied().collect();
            let lowered = set_type.to_ascii_lowercase();
            let instrument = if lowered.contains("bass") || (strings.len() <= 5 && strings.last().is_some_and(|&p| p < 36)) {
                Instrument::Bass
            } else {
                Instrument::Guitar
            };
            let tuning = tunings::TUNINGS
                .iter()
                .find(|t| t.strings == strings.as_slice())
                .map(|t| t.id.to_string())
                .unwrap_or_else(|| "custom".into());
            Some(TrackInfo {
                _node: node,
                name: if name.is_empty() { if instrument == Instrument::Bass { "Bass".into() } else { "Guitar".into() } } else { name.clone() },
                instrument,
                strings,
                tuning,
                staff_offset,
                drum_articulations: Vec::new(),
                chord_names: chord_names(node),
            })
        } else {
            None
        };
        match info {
            Some(i) => infos.push(i),
            None => skipped.push(if name.is_empty() { format!("track {tid}") } else { name }),
        }
        staff_offset += staves;
    }
    if infos.is_empty() {
        return Err(if skipped.is_empty() {
            "The score has no tracks.".to_string()
        } else {
            format!("The score has no guitar, bass or drum tracks (it has: {}).", skipped.join(", "))
        });
    }

    let master_bars: Vec<Node> = child(root, "MasterBars").map(|m| children(m, "MasterBar").collect()).unwrap_or_default();
    if master_bars.is_empty() {
        return Err("The score has no bars.".into());
    }
    let order = play_order(&master_bars)?;
    let first_time = bar_time(master_bars[0]).unwrap_or([4, 4]);

    let mut tracks: Vec<Track> = infos
        .iter()
        .map(|i| Track {
            name: i.name.clone(),
            instrument: i.instrument,
            tuning: i.tuning.clone(),
            strings: i.strings.clone(),
            difficulty: 1,
            measures: Vec::with_capacity(order.len()),
        })
        .collect();

    let mut last_time = first_time;
    for (pos, &mbi) in order.iter().enumerate() {
        let mb = master_bars[mbi];
        let time = bar_time(mb).unwrap_or(last_time);
        last_time = time;
        let section = child(mb, "Section").map(|s| {
            let t = text(child(s, "Text"));
            if t.is_empty() { text(child(s, "Letter")) } else { t }
        });
        // Mark a bar heard again because of a repeat only the first time it starts a section.
        let first_visit = !order[..pos].contains(&mbi);
        let marker = section.filter(|s| !s.is_empty() && first_visit);
        let bar_ids = ids(&text(child(mb, "Bars")));
        for (ti, info) in infos.iter().enumerate() {
            let bar_node = bar_ids.get(info.staff_offset).and_then(|id| bars.get(id)).copied();
            let mut beats_out = Vec::new();
            if let Some(bar_node) = bar_node {
                let voice_id = ids(&text(child(bar_node, "Voices"))).into_iter().find(|&v| v >= 0);
                if let Some(voice) = voice_id.and_then(|v| voices.get(&v)) {
                    for bid in ids(&text(child(*voice, "Beats"))) {
                        let Some(beat) = beats.get(&bid) else { continue };
                        if child(*beat, "GraceNotes").is_some() {
                            continue; // grace notes take no time in the bar
                        }
                        beats_out.push(read_beat(*beat, &rhythms, &notes, info)?);
                    }
                }
            }
            if beats_out.is_empty() {
                beats_out = rest_beats(time);
            }
            tracks[ti].measures.push(Measure {
                beats: beats_out,
                marker: if ti == 0 { marker.clone() } else { None },
                time: if time != first_time { Some(time) } else { None },
            });
        }
    }
    // Markers belong to every track's bar so any track shows them.
    let markers: Vec<Option<String>> = tracks[0].measures.iter().map(|m| m.marker.clone()).collect();
    for t in tracks.iter_mut().skip(1) {
        for (m, mk) in t.measures.iter_mut().zip(&markers) {
            m.marker = mk.clone();
        }
    }
    for t in &mut tracks {
        t.difficulty = estimate_difficulty(t, tempo, first_time);
    }
    // Tempo changes follow the bars as they are played (a repeated bar repeats its changes).
    let mut tempo_map = Vec::new();
    if tempo_points.len() > 1 || tempo_points.first().is_some_and(|p| p.linear) {
        for (pos, &mbi) in order.iter().enumerate() {
            for p in tempo_points.iter().filter(|p| p.bar == mbi) {
                tempo_map.push(TempoChange { bar: pos as u32, position: p.position, bpm: p.bpm, linear: p.linear });
            }
        }
    }

    Ok(Song {
        id: id.to_string(),
        title,
        artist,
        tempo,
        tempo_map,
        time: first_time,
        tracks,
        source: "folder".into(),
        author: tabber,
        revised: String::new(),
    })
}

/// A tempo automation of the score: master bar, place in the bar (0..1), quarter notes a
/// minute, and whether the tempo glides from here to the next change.
struct TempoPoint {
    bar: usize,
    position: f64,
    bpm: f64,
    linear: bool,
}

fn read_tempo_points(master: Node) -> Vec<TempoPoint> {
    let mut out = Vec::new();
    if let Some(autos) = child(master, "Automations") {
        for a in children(autos, "Automation") {
            if text(child(a, "Type")) != "Tempo" {
                continue;
            }
            let bar: usize = text(child(a, "Bar")).parse().unwrap_or(0);
            let position: f64 = text(child(a, "Position")).parse::<f64>().unwrap_or(0.0).clamp(0.0, 1.0);
            let value = text(child(a, "Value"));
            let mut parts = value.split_whitespace();
            let bpm: f64 = parts.next().and_then(|v| v.parse().ok()).unwrap_or(120.0);
            let unit: i64 = parts.next().and_then(|v| v.parse().ok()).unwrap_or(2);
            // The second number is the beat the tempo counts: 1 eighth, 2 quarter, 3 dotted
            // quarter, 4 half, 5 dotted half.
            let quarter = match unit {
                1 => bpm / 2.0,
                3 => bpm * 1.5,
                4 => bpm * 2.0,
                5 => bpm * 3.0,
                _ => bpm,
            };
            out.push(TempoPoint { bar, position, bpm: quarter.clamp(10.0, 600.0), linear: text(child(a, "Linear")) == "true" });
        }
    }
    out.sort_by(|a, b| (a.bar, a.position).partial_cmp(&(b.bar, b.position)).unwrap_or(std::cmp::Ordering::Equal));
    out
}

fn bar_time(mb: Node) -> Option<[u8; 2]> {
    let t = text(child(mb, "Time"));
    let (a, b) = t.split_once('/')?;
    let n: u8 = a.trim().parse().ok()?;
    let d: u8 = b.trim().parse().ok()?;
    if n == 0 || ![1, 2, 4, 8, 16, 32].contains(&d) {
        return None;
    }
    Some([n, d])
}

/// Master bar indices in playing order, with repeats and alternate endings played out.
fn play_order(master_bars: &[Node]) -> Result<Vec<usize>, String> {
    struct Rep {
        start: bool,
        end: bool,
        count: u32,
        endings: Vec<u32>,
    }
    let reps: Vec<Rep> = master_bars
        .iter()
        .map(|mb| {
            let r = child(*mb, "Repeat");
            let endings = text(child(*mb, "AlternateEndings")).split_whitespace().filter_map(|x| x.parse().ok()).collect();
            Rep {
                start: r.and_then(|r| r.attribute("start")) == Some("true"),
                end: r.and_then(|r| r.attribute("end")) == Some("true"),
                count: r.and_then(|r| r.attribute("count")).and_then(|c| c.parse().ok()).unwrap_or(2),
                endings,
            }
        })
        .collect();
    let mut order = Vec::new();
    let mut i = 0usize;
    let mut repeat_start = 0usize;
    let mut pass = 1u32;
    let mut jumped = false;
    while i < reps.len() {
        if order.len() > MAX_BARS {
            return Err(format!("The score is longer than {MAX_BARS} bars once its repeats are played."));
        }
        let r = &reps[i];
        if r.start && !jumped {
            repeat_start = i;
            pass = 1;
        }
        jumped = false;
        if !r.endings.is_empty() && !r.endings.contains(&pass) {
            i += 1;
            continue;
        }
        order.push(i);
        if r.end && pass < r.count.max(2) {
            pass += 1;
            i = repeat_start;
            jumped = true;
            continue;
        }
        if r.end {
            pass = 1;
        }
        i += 1;
    }
    Ok(order)
}

fn chord_names(track: Node) -> HashMap<String, String> {
    let mut map = HashMap::new();
    if let Some(p) = property(track, "DiagramCollection") {
        for item in p.descendants().filter(|d| d.has_tag_name("Item")) {
            if let (Some(id), Some(name)) = (item.attribute("id"), item.attribute("name")) {
                if !name.trim().is_empty() {
                    map.insert(id.to_string(), name.trim().to_string());
                }
            }
        }
    }
    map
}

fn read_beat(beat: Node, rhythms: &HashMap<i64, Node>, notes: &HashMap<i64, Node>, info: &TrackInfo) -> Result<Beat, String> {
    let rid: i64 = child(beat, "Rhythm").and_then(|r| r.attribute("ref")).and_then(|r| r.parse().ok()).unwrap_or(-1);
    let rhythm = rhythms.get(&rid).ok_or_else(|| format!("A beat uses rhythm {rid}, which is missing."))?;
    let dur = match text(child(*rhythm, "NoteValue")).as_str() {
        "Whole" => 1,
        "Half" => 2,
        "Quarter" => 4,
        "Eighth" => 8,
        "16th" => 16,
        "32nd" | "64th" | "128th" => 32,
        "DoubleWhole" => 1,
        other => return Err(format!("Unknown note value '{other}'.")),
    };
    let dots: u32 = child(*rhythm, "AugmentationDot").and_then(|d| d.attribute("count")).and_then(|c| c.parse().ok()).unwrap_or(0);
    let tuplet = child(*rhythm, "PrimaryTuplet").and_then(|t| {
        let num: u8 = t.attribute("num")?.parse().ok()?;
        let den: u8 = t.attribute("den")?.parse().ok()?;
        (num > 0 && den > 0 && num != den).then_some([num, den])
    });
    let (triplet, tuplet) = match tuplet {
        Some([3, 2]) => (true, None),
        other => (false, other),
    };
    let mut out = Vec::new();
    for nid in ids(&text(child(beat, "Notes"))) {
        let Some(n) = notes.get(&nid) else { continue };
        let tie = child(*n, "Tie").and_then(|t| t.attribute("destination")) == Some("true");
        if info.instrument == Instrument::Drums {
            let art: usize = text(child(*n, "InstrumentArticulation")).parse().unwrap_or(0);
            let midi = info.drum_articulations.get(art).copied().unwrap_or(38);
            out.push(Note { string: drum_line(midi), fret: midi, tie });
            continue;
        }
        let gp_string: usize = property(*n, "String").map(|p| text(child(p, "String"))).and_then(|s| s.parse().ok()).ok_or("A note has no string.")?;
        let fret: u8 = property(*n, "Fret").map(|p| text(child(p, "Fret"))).and_then(|s| s.parse().ok()).unwrap_or(0);
        let count = info.strings.len();
        if gp_string >= count {
            continue; // a string the tuning doesn't have
        }
        let string = (count - gp_string) as u8;
        if out.iter().any(|x: &Note| x.string == string) {
            continue;
        }
        out.push(Note { string, fret, tie });
    }
    out.sort_by_key(|n| n.string);
    let chord = text(child(beat, "Chord"));
    let chord = (!chord.is_empty()).then(|| info.chord_names.get(&chord).cloned()).flatten();
    Ok(Beat { dur, dotted: dots == 1, triplet, double_dotted: dots >= 2, tuplet, notes: out, chord })
}

/// The drum line (1 cymbals ... 5 kick) a General MIDI drum sound sits on.
fn drum_line(midi: u8) -> u8 {
    match midi {
        35 | 36 => 5,
        37..=40 => 3,
        41 | 43 | 45 | 47 | 48 | 50 => 4,
        42 | 44 | 46 => 2,
        _ => 1,
    }
}

/// Rests filling a bar of `time`.
fn rest_beats([n, d]: [u8; 2]) -> Vec<Beat> {
    let rest = |dur: u8, dotted: bool| Beat { dur, dotted, triplet: false, double_dotted: false, tuplet: None, notes: Vec::new(), chord: None };
    match (n, d) {
        (4, 4) | (2, 2) => vec![rest(1, false)],
        (3, 4) | (6, 8) => vec![rest(2, true)],
        (2, 4) => vec![rest(2, false)],
        _ => (0..n).map(|_| rest(d, false)).collect(),
    }
}

/// A rough 1-8 rating from how many notes a second, how high up the neck and how many chords.
pub fn estimate_difficulty(t: &Track, tempo: u16, time: [u8; 2]) -> u8 {
    let bar_ticks = time[0] as f64 * WHOLE as f64 / time[1] as f64;
    let seconds = t.measures.len() as f64 * bar_ticks / 960.0 * 60.0 / tempo.max(1) as f64;
    let mut onsets = 0usize;
    let mut chords = 0usize;
    let mut max_fret = 0u8;
    let mut fastest = 0u32;
    for m in &t.measures {
        for b in &m.beats {
            let fresh: Vec<&Note> = b.notes.iter().filter(|n| !n.tie).collect();
            if fresh.is_empty() {
                continue;
            }
            onsets += 1;
            if fresh.len() >= 3 {
                chords += 1;
            }
            fastest = fastest.max(b.dur as u32);
            if t.instrument != Instrument::Drums {
                max_fret = max_fret.max(fresh.iter().map(|n| n.fret).max().unwrap_or(0));
            }
        }
    }
    if onsets == 0 || seconds <= 0.0 {
        return 1;
    }
    let nps = onsets as f64 / seconds;
    let mut score = 0.6 + nps * 0.75;
    if max_fret > 12 {
        score += 1.0;
    } else if max_fret > 7 {
        score += 0.5;
    }
    score += chords as f64 / onsets as f64 * 1.2;
    if fastest >= 16 && tempo >= 120 {
        score += 0.6;
    }
    score.round().clamp(1.0, 8.0) as u8
}

#[cfg(test)]
mod tests {
    use super::*;

    const SAMPLE: &str = r#"<?xml version="1.0" encoding="utf-8"?>
<GPIF><Score><Title><![CDATA[Test Song]]></Title><Artist><![CDATA[Someone]]></Artist></Score>
<MasterTrack><Tracks>0</Tracks><Automations><Automation><Type>Tempo</Type><Bar>0</Bar><Position>0</Position><Value>90 2</Value></Automation></Automations></MasterTrack>
<Tracks><Track id="0"><Name><![CDATA[Lead]]></Name><InstrumentSet><Type>electricGuitar</Type></InstrumentSet>
<Staves><Staff><Properties><Property name="Tuning"><Pitches>40 45 50 55 59 64</Pitches></Property>
<Property name="DiagramCollection"><Items><Item id="0" name="Am"/></Items></Property></Properties></Staff></Staves></Track></Tracks>
<MasterBars>
<MasterBar><Time>4/4</Time><Repeat start="true" end="false" count="0"/><Section><Letter>A</Letter><Text>Intro</Text></Section><Bars>0</Bars></MasterBar>
<MasterBar><Time>4/4</Time><Repeat start="false" end="true" count="2"/><Bars>1</Bars></MasterBar>
<MasterBar><Time>3/4</Time><Bars>-1</Bars></MasterBar>
</MasterBars>
<Bars><Bar id="0"><Voices>0 -1 -1 -1</Voices></Bar><Bar id="1"><Voices>1 -1 -1 -1</Voices></Bar></Bars>
<Voices><Voice id="0"><Beats>0 1</Beats></Voice><Voice id="1"><Beats>2</Beats></Voice></Voices>
<Beats><Beat id="0"><Rhythm ref="0"/><Chord>0</Chord><Notes>0 1</Notes></Beat><Beat id="1"><Rhythm ref="0"/><Notes>2</Notes></Beat><Beat id="2"><Rhythm ref="1"/></Beat></Beats>
<Notes>
<Note id="0"><Properties><Property name="String"><String>4</String></Property><Property name="Fret"><Fret>1</Fret></Property></Properties></Note>
<Note id="1"><Properties><Property name="String"><String>1</String></Property><Property name="Fret"><Fret>0</Fret></Property></Properties></Note>
<Note id="2"><Tie origin="false" destination="true"/><Properties><Property name="String"><String>4</String></Property><Property name="Fret"><Fret>1</Fret></Property></Properties></Note>
</Notes>
<Rhythms><Rhythm id="0"><NoteValue>Half</NoteValue></Rhythm><Rhythm id="1"><NoteValue>Whole</NoteValue></Rhythm></Rhythms>
</GPIF>"#;

    #[test]
    fn reads_a_score() {
        let song = parse_gpif(SAMPLE, "file:test.gp", "test").unwrap();
        assert_eq!(song.title, "Test Song");
        assert_eq!(song.artist, "Someone");
        assert_eq!(song.tempo, 90);
        let t = &song.tracks[0];
        assert_eq!(t.tuning, "standard");
        // Bar 1, repeated bar 2 twice, then the 3/4 bar: 1 + 2 + 1 = 4 (bars 1-2 repeat: 1 2 1 2 3).
        assert_eq!(t.measures.len(), 5);
        assert_eq!(t.measures[0].marker.as_deref(), Some("Intro"));
        assert_eq!(t.measures[2].marker, None);
        assert_eq!(t.measures[4].time, Some([3, 4]));
        let first = &t.measures[0].beats[0];
        assert_eq!(first.chord.as_deref(), Some("Am"));
        // GP string 4 (B, counted from the low E) is string 2 counted from the top.
        assert_eq!(first.notes[0], Note { string: 2, fret: 1, tie: false });
        assert_eq!(first.notes[1], Note { string: 5, fret: 0, tie: false });
        assert!(t.measures[0].beats[1].notes[0].tie);
    }

    #[test]
    fn real_files_if_present() {
        // Optional: point TABLINE_GP_SAMPLES at a folder of .gp files to check them all.
        let Ok(dir) = std::env::var("TABLINE_GP_SAMPLES") else { return };
        let mut read = 0;
        for entry in std::fs::read_dir(&dir).unwrap() {
            let path = entry.unwrap().path();
            if path.extension().and_then(|e| e.to_str()) != Some("gp") {
                continue;
            }
            let bytes = std::fs::read(&path).unwrap();
            match read_gp(&bytes, "file:x", "x") {
                Ok(s) => {
                    read += 1;
                    eprintln!("{}: '{}' by '{}', {} tracks, {} bars, tempo {}", path.display(), s.title, s.artist, s.tracks.len(), s.tracks[0].measures.len(), s.tempo);
                }
                Err(e) => eprintln!("{}: ERROR {e}", path.display()),
            }
        }
        assert!(read > 0);
    }
}
