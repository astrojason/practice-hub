#!/usr/bin/env python3
"""
Guitar Pro difficulty analyzer — self-contained sidecar for practice-hub.

Usage:
    python3 analyze_gp.py <path-to-file.gp>

Output (stdout): JSON object
    {
        "difficulty_score": float,        # 0-100 overall score
        "vector": {                        # per-dimension breakdown
            "speed": float,
            "fret_complexity": float,
            "pick_complexity": float,
            "technique_density": float,
            "stamina": float,
            "overall": float
        },
        "title": str | null,
        "artist": str | null,
        "tempo_bpm": float | null,
        "tracks": [
            {
                "name": str,
                "instrument": str | null,
                "difficulty_score": float,
                "vector": {...}
            }
        ]
    }

Errors are written to stderr; exit code is non-zero on failure.

Supports Guitar Pro 7/8 (.gp, .gpx, .gp7, .gp8) — zip archives containing
GPIF XML.  Legacy binary formats (.gp3/.gp4/.gp5) are not supported without
the pyguitarpro library and are skipped with a warning.

Bug fixed vs original experiment: beat attack counts now reflect actual picked
notes per beat (excluding hammer-ons/pull-offs) rather than always counting
each beat as 1 attack.
"""

from __future__ import annotations

import io
import json
import sys
import xml.etree.ElementTree as ET
import zipfile
from dataclasses import dataclass, field
from pathlib import Path
from typing import Dict, List, Optional, Tuple


# ──────────────────────────────────────────────────────────────────────────────
# Data structures
# ──────────────────────────────────────────────────────────────────────────────

@dataclass
class BendInfo:
    semitones: float
    is_release: bool = False
    is_prebend: bool = False


@dataclass
class NoteEvent:
    string: int
    fret: int
    beat_position: float
    duration_beats: float = 0.25
    bend: Optional[BendInfo] = None
    hammer_on: bool = False
    pull_off: bool = False
    vibrato: bool = False
    palm_mute: bool = False
    tremolo_picking: bool = False
    is_tap: bool = False
    harmonic: bool = False
    ghost_note: bool = False
    dead_note: bool = False


@dataclass
class BeatEvent:
    beat_position: float
    notes: List[NoteEvent] = field(default_factory=list)
    is_rest: bool = False


@dataclass
class TrackData:
    name: str
    instrument: Optional[str]
    string_count: int
    beats: List[BeatEvent] = field(default_factory=list)
    bar_count: int = 0


@dataclass
class ParsedSong:
    title: Optional[str]
    artist: Optional[str]
    tempo_bpm: Optional[float]
    tracks: List[TrackData] = field(default_factory=list)


# ──────────────────────────────────────────────────────────────────────────────
# GPIF parser (Guitar Pro 7/8 — zip archive containing XML)
# ──────────────────────────────────────────────────────────────────────────────

class GPIFParserError(RuntimeError):
    pass


GPIF_EXTENSIONS = {".gp", ".gpx", ".gp7", ".gp8"}


def parse_gpif_file(path: Path) -> ParsedSong:
    xml_bytes = _read_gpif_xml(path)
    root = ET.parse(io.BytesIO(xml_bytes)).getroot()
    return _extract_song(root)


def _read_gpif_xml(path: Path) -> bytes:
    try:
        with zipfile.ZipFile(path) as archive:
            for entry in ("Content/score.gpif", "score.gpif"):
                try:
                    return archive.read(entry)
                except KeyError:
                    continue
        raise GPIFParserError(f"No GPIF payload found in {path.name}")
    except zipfile.BadZipFile as exc:
        raise GPIFParserError("Invalid Guitar Pro archive") from exc


def _extract_song(root: ET.Element) -> ParsedSong:
    score = root.find("Score")
    if score is None:
        raise GPIFParserError("Missing <Score> element")

    master_bars = list(root.find("MasterBars") or [])
    bars = _id_lookup(root.find("Bars"))
    voices = _id_lookup(root.find("Voices"))
    beats_map = _id_lookup(root.find("Beats"))
    notes_map = _id_lookup(root.find("Notes"))
    rhythms = _id_lookup(root.find("Rhythms"))

    tempo = _extract_tempo(root)

    tracks = []
    for idx, track_elem in enumerate(root.findall("./Tracks/Track")):
        track = _parse_track(idx, track_elem, master_bars, bars, voices, beats_map, notes_map, rhythms)
        tracks.append(track)

    return ParsedSong(
        title=_clean(score.findtext("Title")),
        artist=_clean(score.findtext("Artist")) or _clean(score.findtext("WordsAndMusic")),
        tempo_bpm=tempo,
        tracks=tracks,
    )


def _id_lookup(container: Optional[ET.Element]) -> Dict[str, ET.Element]:
    if container is None:
        return {}
    return {el.attrib["id"]: el for el in container if "id" in el.attrib}


def _extract_tempo(root: ET.Element) -> Optional[float]:
    for auto in root.findall("./MasterTrack/Automations/Automation"):
        if auto.findtext("Type") == "Tempo":
            raw = auto.findtext("Value")
            if raw:
                try:
                    return float(raw.split()[0])
                except (ValueError, IndexError):
                    pass
    return None


def _parse_track(
    idx: int,
    track_elem: ET.Element,
    master_bars: List[ET.Element],
    bars: Dict[str, ET.Element],
    voices: Dict[str, ET.Element],
    beats_map: Dict[str, ET.Element],
    notes_map: Dict[str, ET.Element],
    rhythms: Dict[str, ET.Element],
) -> TrackData:
    name = _clean(track_elem.findtext("Name")) or "Unknown"
    string_count = 6
    sc = track_elem.findtext("StringCount")
    if sc and sc.isdigit():
        string_count = int(sc)
    instrument = _clean(track_elem.findtext("GeneralMidi/Name")) or \
                 _clean(track_elem.findtext("Instrument/Description"))

    beat_events: List[BeatEvent] = []
    beat_position = 0.0
    bar_count = 0

    for master_bar in master_bars:
        ts_text = master_bar.findtext("Time") or "4/4"
        beats_in_bar = _time_sig_to_beats(ts_text)
        bar_ids = (master_bar.findtext("Bars") or "").split()
        if idx >= len(bar_ids):
            beat_position += beats_in_bar
            continue

        bar_elem = bars.get(bar_ids[idx])
        if bar_elem is None:
            beat_position += beats_in_bar
            continue

        bar_count += 1
        voice_ids = (bar_elem.findtext("Voices") or "").split()
        for voice_id in voice_ids:
            if voice_id == "-1":
                continue
            voice_elem = voices.get(voice_id)
            if voice_elem is None:
                continue

            beat_ids = (voice_elem.findtext("Beats") or "").split()
            local_pos = beat_position
            for beat_id in beat_ids:
                if beat_id == "-1":
                    continue
                beat_elem = beats_map.get(beat_id)
                if beat_elem is None:
                    continue

                beat_event = _parse_beat(beat_elem, local_pos, notes_map, rhythms)
                beat_events.append(beat_event)

                rhythm_ref = beat_elem.find("Rhythm")
                rhythm_id = rhythm_ref.attrib.get("ref") if rhythm_ref is not None else None
                dur = _rhythm_duration(rhythm_id, rhythms) if rhythm_id else 0.25
                local_pos += dur

        beat_position += beats_in_bar

    return TrackData(
        name=name,
        instrument=instrument,
        string_count=string_count,
        beats=beat_events,
        bar_count=bar_count,
    )


def _parse_beat(
    beat_elem: ET.Element,
    position: float,
    notes_map: Dict[str, ET.Element],
    rhythms: Dict[str, ET.Element],
) -> BeatEvent:
    note_ids = [n for n in (beat_elem.findtext("Notes") or "").split() if n != "-1"]
    is_rest = not note_ids

    # Detect tap/slap/pop from XProperties
    is_tap = is_slap = is_pop = False
    xprops = beat_elem.find("XProperties")
    if xprops:
        for xp in xprops.findall("XProperty"):
            if xp.attrib.get("id") == "687935489":
                val = xp.findtext("Int")
                if val == "1":
                    is_slap = True
                elif val == "2":
                    is_pop = True
                elif val == "3":
                    is_tap = True

    rhythm_ref = beat_elem.find("Rhythm")
    rhythm_id = rhythm_ref.attrib.get("ref") if rhythm_ref is not None else None
    duration = _rhythm_duration(rhythm_id, rhythms) if rhythm_id else 0.25

    notes: List[NoteEvent] = []
    for note_id in note_ids:
        note_elem = notes_map.get(note_id)
        if note_elem is None:
            continue
        note = _parse_note(note_elem, position, duration, is_tap, is_slap, is_pop)
        if note:
            notes.append(note)

    return BeatEvent(beat_position=position, notes=notes, is_rest=is_rest)


def _parse_note(
    note_elem: ET.Element,
    position: float,
    duration: float,
    is_tap: bool,
    is_slap: bool,
    is_pop: bool,
) -> Optional[NoteEvent]:
    props = note_elem.find("Properties")
    if props is None:
        return None

    string_num = fret_num = None
    bend_info = None
    hammer_on = pull_off = vibrato = palm_mute = tremolo = ghost = dead = False
    harmonic = False

    for prop in props.findall("Property"):
        name = prop.attrib.get("name", "")
        if name == "String":
            v = prop.findtext("String")
            if v and v.isdigit():
                string_num = int(v) + 1
        elif name == "Fret":
            v = prop.findtext("Fret")
            if v and v.lstrip("-").isdigit():
                fret_num = int(v)
        elif name == "Bended":
            bend_info = _parse_bend(prop)
        elif name == "HopoOrigin":
            hammer_on = True
        elif name == "HopoDestination":
            pull_off = True
        elif name == "Vibrato":
            vibrato = True
        elif name == "PalmMuted":
            palm_mute = True
        elif name == "Harmonic":
            harmonic = True
        elif name == "Muted":
            dead = True
        elif name == "Ghost":
            ghost = True

    if note_elem.find("TremoloPicking") is not None:
        tremolo = True

    if string_num is None or fret_num is None:
        return None

    return NoteEvent(
        string=string_num,
        fret=fret_num,
        beat_position=position,
        duration_beats=duration,
        bend=bend_info,
        hammer_on=hammer_on,
        pull_off=pull_off,
        vibrato=vibrato,
        palm_mute=palm_mute,
        tremolo_picking=tremolo,
        is_tap=is_tap,
        harmonic=harmonic,
        ghost_note=ghost,
        dead_note=dead,
    )


def _parse_bend(prop: ET.Element) -> Optional[BendInfo]:
    max_val = 0.0
    for pt in prop.findall(".//Point"):
        v = pt.findtext("Value")
        if v:
            try:
                val = float(v)
                if abs(val) > abs(max_val):
                    max_val = val
            except ValueError:
                pass
    if max_val > 0:
        return BendInfo(semitones=max_val / 100.0)
    return None


def _rhythm_duration(rhythm_id: Optional[str], rhythms: Dict[str, ET.Element]) -> float:
    if not rhythm_id:
        return 0.25
    rhythm = rhythms.get(rhythm_id)
    if rhythm is None:
        return 0.25
    note_value = rhythm.findtext("NoteValue")
    base_durations = {
        "Whole": 4.0, "Half": 2.0, "Quarter": 1.0,
        "Eighth": 0.5, "16th": 0.25, "32nd": 0.125, "64th": 0.0625,
    }
    base = base_durations.get(note_value or "", 0.25)
    aug = rhythm.find("AugmentationDot")
    if aug is not None:
        count = int(aug.attrib.get("count", "1"))
        base *= 1.5 if count == 1 else 1.75
    tuplet = rhythm.find("PrimaryTuplet")
    if tuplet is not None:
        num = int(tuplet.attrib.get("num", "1"))
        den = int(tuplet.attrib.get("den", "1"))
        if den > 0:
            base *= den / num
    return base


def _time_sig_to_beats(ts: str) -> float:
    try:
        num, den = ts.split("/")
        return int(num) * (4.0 / int(den))
    except (ValueError, ZeroDivisionError):
        return 4.0


def _clean(value: Optional[str]) -> Optional[str]:
    if value is None:
        return None
    s = value.strip()
    return s if s else None


# ──────────────────────────────────────────────────────────────────────────────
# Difficulty algorithm (ported from experiments/guitar-difficulty with bug fix)
# ──────────────────────────────────────────────────────────────────────────────

@dataclass
class DifficultyVector:
    speed: float = 0.0
    fret_complexity: float = 0.0
    pick_complexity: float = 0.0
    technique_density: float = 0.0
    stamina: float = 0.0
    overall: float = 0.0

    def to_dict(self) -> dict:
        return {k: round(v, 2) for k, v in {
            "speed": self.speed,
            "fret_complexity": self.fret_complexity,
            "pick_complexity": self.pick_complexity,
            "technique_density": self.technique_density,
            "stamina": self.stamina,
            "overall": self.overall,
        }.items()}


@dataclass
class _Metrics:
    total_notes: int = 0
    total_beats: int = 0
    duration_beats: float = 0.0
    max_notes_per_beat: int = 0
    avg_notes_per_beat: float = 0.0
    peak_attacks_per_second: float = 0.0
    max_fret_stretch: int = 0
    avg_fret_distance: float = 0.0
    position_shift_count: int = 0
    string_skip_count: int = 0
    max_string_skip: int = 0
    direction_changes: int = 0
    bend_count: int = 0
    legato_count: int = 0
    vibrato_count: int = 0
    harmonic_count: int = 0
    tap_count: int = 0
    tremolo_count: int = 0
    palm_mute_count: int = 0


def compute_difficulty_vector(beats: List[BeatEvent], tempo_bpm: float) -> DifficultyVector:
    if not beats or tempo_bpm <= 0:
        return DifficultyVector()

    m = _collect_metrics(beats, tempo_bpm)
    speed = _speed(m, tempo_bpm)
    fret = _fret(m)
    pick = _pick(m)
    technique = _technique(m)
    stamina = _stamina(m, tempo_bpm)

    speed_component = speed * 0.90
    complexity = (fret / 100.0) * 3 + (pick / 100.0) * 3 + (technique / 100.0) * 2 + (stamina / 100.0) * 2
    overall = speed_component + complexity

    return DifficultyVector(
        speed=speed,
        fret_complexity=fret,
        pick_complexity=pick,
        technique_density=technique,
        stamina=stamina,
        overall=overall,
    )


def _collect_metrics(beats: List[BeatEvent], tempo_bpm: float) -> _Metrics:
    m = _Metrics()
    prev_note: Optional[NoteEvent] = None
    prev_string: Optional[int] = None
    beat_data: List[Tuple[float, float, int]] = []  # (position, duration, attack_count)

    for beat in beats:
        if beat.is_rest:
            continue

        m.total_beats += 1
        beat_note_count = len(beat.notes)
        m.total_notes += beat_note_count
        if beat_note_count > m.max_notes_per_beat:
            m.max_notes_per_beat = beat_note_count

        if beat.notes:
            duration = beat.notes[0].duration_beats
            m.duration_beats += duration

            # FIX: count actual picked notes per beat, not always 1.
            # Hammer-ons and pull-offs don't require a pick stroke, so they
            # don't contribute to peak-speed demand.
            picked_attacks = sum(
                1 for n in beat.notes if not (n.hammer_on or n.pull_off)
            )
            if picked_attacks > 0:
                beat_data.append((beat.beat_position, duration, picked_attacks))

            # Fret stretch within chord
            if len(beat.notes) > 1:
                frets = [n.fret for n in beat.notes if n.fret > 0]
                if len(frets) > 1:
                    stretch = max(frets) - min(frets)
                    if stretch > m.max_fret_stretch:
                        m.max_fret_stretch = stretch

            for note in beat.notes:
                if note.bend:
                    m.bend_count += 1
                if note.hammer_on or note.pull_off:
                    m.legato_count += 1
                if note.vibrato:
                    m.vibrato_count += 1
                if note.harmonic:
                    m.harmonic_count += 1
                if note.is_tap:
                    m.tap_count += 1
                if note.tremolo_picking:
                    m.tremolo_count += 1
                if note.palm_mute:
                    m.palm_mute_count += 1

                if prev_note is not None:
                    fret_dist = abs(note.fret - prev_note.fret)
                    m.avg_fret_distance += fret_dist
                    if fret_dist > 4:
                        m.position_shift_count += 1

                if prev_string is not None:
                    string_skip = abs(note.string - prev_string)
                    if string_skip > 1:
                        m.string_skip_count += 1
                    if string_skip > m.max_string_skip:
                        m.max_string_skip = string_skip
                    if string_skip >= 1:
                        m.direction_changes += 1

                prev_note = note
                prev_string = note.string

    if m.total_beats > 0:
        m.avg_notes_per_beat = m.total_notes / m.total_beats
    if m.total_notes > 1:
        m.avg_fret_distance /= m.total_notes - 1

    m.peak_attacks_per_second = _peak_speed(beat_data, tempo_bpm, window_beats=8.0)
    return m


def _peak_speed(beat_data: List[Tuple[float, float, int]], tempo_bpm: float, window_beats: float) -> float:
    if not beat_data or tempo_bpm <= 0:
        return 0.0
    beats_per_second = tempo_bpm / 60.0
    window_seconds = window_beats / beats_per_second
    beat_data = sorted(beat_data, key=lambda x: x[0])
    max_aps = 0.0
    for i, (start_pos, _, _) in enumerate(beat_data):
        window_end = start_pos + window_beats
        attacks = sum(a for pos, _, a in beat_data[i:] if pos < window_end)
        if window_seconds > 0:
            aps = attacks / window_seconds
            if aps > max_aps:
                max_aps = aps
    return max_aps


def _normalize(value: float, min_val: float, max_val: float) -> float:
    if max_val <= min_val:
        return 0.0
    return max(0.0, min(1.0, (value - min_val) / (max_val - min_val)))


def _speed(m: _Metrics, tempo_bpm: float) -> float:
    if m.total_beats == 0 or m.duration_beats == 0:
        return 0.0
    return _normalize(m.peak_attacks_per_second, 4, 14) * 100


def _fret(m: _Metrics) -> float:
    if m.total_notes == 0:
        return 0.0
    stretch_score = _normalize(m.max_fret_stretch, 0, 6) * 100
    shift_rate = m.position_shift_count / max(m.total_notes, 1)
    shift_score = _normalize(shift_rate, 0, 0.15) * 100
    distance_score = _normalize(m.avg_fret_distance, 0, 4) * 100
    tap_ratio = m.tap_count / max(m.total_notes, 1)
    tap_reduction = tap_ratio * 0.3
    base = (stretch_score * 0.25 + shift_score * 0.45 + distance_score * 0.30)
    base = max(0, base * (1 - tap_reduction))
    speed_mult = 0.4 + 0.6 * _normalize(m.peak_attacks_per_second, 4, 10)
    return base * speed_mult


def _pick(m: _Metrics) -> float:
    if m.total_notes == 0:
        return 0.0
    picked_notes = m.total_notes - m.legato_count
    pick_ratio = picked_notes / max(m.total_notes, 1)
    skip_rate = m.string_skip_count / max(picked_notes, 1)
    skip_score = _normalize(skip_rate, 0, 0.2) * 100
    max_skip_score = _normalize(m.max_string_skip, 1, 4) * 100
    cross_rate = m.direction_changes / max(picked_notes, 1)
    cross_score = _normalize(cross_rate, 0, 0.6) * 100
    base = skip_score * 0.45 + cross_score * 0.35 + max_skip_score * 0.20
    base = base * (0.3 + 0.7 * pick_ratio)
    speed_mult = 0.3 + 0.7 * _normalize(m.peak_attacks_per_second, 4, 10)
    return base * speed_mult


def _technique(m: _Metrics) -> float:
    if m.total_notes == 0:
        return 0.0
    hard = (
        m.bend_count * 2.0
        + m.harmonic_count * 1.5
        + m.tremolo_count * 1.5
        + m.vibrato_count * 0.3
    )
    density = hard / m.total_notes
    return _normalize(density, 0, 0.4) * 100


def _stamina(m: _Metrics, tempo_bpm: float) -> float:
    if m.duration_beats == 0 or m.total_beats == 0:
        return 0.0
    bps = tempo_bpm / 60.0
    duration_seconds = m.duration_beats / bps
    intensity = m.total_beats / duration_seconds if duration_seconds > 0 else 0
    stamina_raw = (duration_seconds * intensity) ** 0.5
    return _normalize(stamina_raw, 0, 100) * 100


# ──────────────────────────────────────────────────────────────────────────────
# Track selection: prefer the hardest guitar/lead track
# ──────────────────────────────────────────────────────────────────────────────

_GUITAR_KEYWORDS = ("guitar", "lead", "solo", "gtr", "electric", "rhythm", "riff")
_BASS_KEYWORDS = ("bass",)
_DRUM_KEYWORDS = ("drum", "percussion", "kit", "snare")


def _is_guitar_track(track: TrackData) -> bool:
    name = (track.name or "").lower()
    instr = (track.instrument or "").lower()
    combined = name + " " + instr
    if any(k in combined for k in _DRUM_KEYWORDS):
        return False
    if any(k in combined for k in _BASS_KEYWORDS):
        return False
    return any(k in combined for k in _GUITAR_KEYWORDS) or track.string_count in (6, 7, 8)


def _select_primary_track(tracks: List[TrackData]) -> Optional[TrackData]:
    """Return the guitar track with the most notes (proxy for lead/solo part)."""
    guitar_tracks = [t for t in tracks if _is_guitar_track(t)]
    if not guitar_tracks:
        guitar_tracks = tracks  # Fall back to all tracks
    if not guitar_tracks:
        return None
    return max(guitar_tracks, key=lambda t: sum(len(b.notes) for b in t.beats))


# ──────────────────────────────────────────────────────────────────────────────
# Entry point
# ──────────────────────────────────────────────────────────────────────────────

def main():
    if len(sys.argv) < 2:
        print(json.dumps({"error": "Usage: analyze_gp.py <file.gp>"}), file=sys.stderr)
        sys.exit(1)

    path = Path(sys.argv[1])
    if not path.exists():
        print(json.dumps({"error": f"File not found: {path}"}), file=sys.stderr)
        sys.exit(1)

    suffix = path.suffix.lower()
    if suffix not in GPIF_EXTENSIONS:
        print(json.dumps({"error": f"Unsupported format: {suffix}. Only {GPIF_EXTENSIONS} are supported."}), file=sys.stderr)
        sys.exit(1)

    try:
        song = parse_gpif_file(path)
    except GPIFParserError as exc:
        print(json.dumps({"error": str(exc)}), file=sys.stderr)
        sys.exit(1)

    tempo = song.tempo_bpm or 120.0

    # Score all tracks
    track_results = []
    for track in song.tracks:
        vec = compute_difficulty_vector(track.beats, tempo)
        track_results.append({
            "name": track.name,
            "instrument": track.instrument,
            "difficulty_score": round(vec.overall, 2),
            "vector": vec.to_dict(),
        })

    # Primary score = hardest guitar track
    primary = _select_primary_track(song.tracks)
    if primary:
        primary_vec = compute_difficulty_vector(primary.beats, tempo)
        primary_score = round(primary_vec.overall, 2)
        primary_vector = primary_vec.to_dict()
    else:
        primary_score = 0.0
        primary_vector = DifficultyVector().to_dict()

    result = {
        "difficulty_score": primary_score,
        "vector": primary_vector,
        "title": song.title,
        "artist": song.artist,
        "tempo_bpm": tempo,
        "tracks": track_results,
    }
    print(json.dumps(result))


if __name__ == "__main__":
    main()
