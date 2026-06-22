#!/usr/bin/env python3
"""
Guitar Pro difficulty analyzer v2 — self-contained sidecar for practice-hub.

Changes from v1:
  - Rhythm complexity axis: time signatures, tuplets, dotted notes, duration variance
  - Neck position weighting via inverse fret width (logarithmic, physically accurate)
  - Tempo-dependent legato modifier (fast legato = easier, slow legato = harder)
  - Exponential reach compounding (fret stretch × string skip)
  - Technique transition cost (palm mute↔open, tap↔pick)
  - Learning system: --weights for custom axis weights, --correct for pairwise updates

Usage:
    python3 analyze_gp.py <file.gp> [--weights weights.json]
    python3 analyze_gp.py --correct <harder.gp> <easier.gp> [--weights weights.json]

Output (stdout): JSON object
    {
        "difficulty_score": float,        # 0-100 overall score
        "vector": {
            "speed": float,
            "fret_complexity": float,
            "pick_complexity": float,
            "rhythm_complexity": float,
            "technique_density": float,
            "stamina": float,
            "overall": float
        },
        "title": str | null,
        "artist": str | null,
        "tempo_bpm": float | null,
        "tracks": [...]
    }

    --correct mode outputs: {"weights": {...}, "was_violation": bool}

Errors → stderr; non-zero exit on failure.
Supports GP 7/8 (.gp, .gpx, .gp7, .gp8) zip archives containing GPIF XML.
"""

from __future__ import annotations

import io
import json
import math
import sys
import statistics
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
class RhythmInfo:
    """Parsed rhythm metadata for a beat."""
    note_value: str = "Quarter"
    is_dotted: bool = False
    is_tuplet: bool = False
    duration_beats: float = 1.0


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
    rhythm: RhythmInfo = field(default_factory=RhythmInfo)


@dataclass
class TrackData:
    name: str
    instrument: Optional[str]
    string_count: int
    beats: List[BeatEvent] = field(default_factory=list)
    bar_count: int = 0
    time_signatures: List[str] = field(default_factory=list)  # one per bar


@dataclass
class ParsedSong:
    title: Optional[str]
    artist: Optional[str]
    tempo_bpm: Optional[float]
    tracks: List[TrackData] = field(default_factory=list)


# ──────────────────────────────────────────────────────────────────────────────
# GPIF parser (Guitar Pro 7/8 — zip archive containing XML)
# Parsing layer is unchanged from v1 except:
#   - _rhythm_duration → _rhythm_info (returns RhythmInfo)
#   - BeatEvent now stores rhythm info
#   - TrackData now stores time_signatures per bar
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
    time_signatures: List[str] = []
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
        time_signatures.append(ts_text)
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
                ri = _rhythm_info(rhythm_id, rhythms) if rhythm_id else RhythmInfo()
                local_pos += ri.duration_beats

        beat_position += beats_in_bar

    return TrackData(
        name=name,
        instrument=instrument,
        string_count=string_count,
        beats=beat_events,
        bar_count=bar_count,
        time_signatures=time_signatures,
    )


def _parse_beat(
    beat_elem: ET.Element,
    position: float,
    notes_map: Dict[str, ET.Element],
    rhythms: Dict[str, ET.Element],
) -> BeatEvent:
    note_ids = [n for n in (beat_elem.findtext("Notes") or "").split() if n != "-1"]
    is_rest = not note_ids

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
    ri = _rhythm_info(rhythm_id, rhythms) if rhythm_id else RhythmInfo()

    notes: List[NoteEvent] = []
    for note_id in note_ids:
        note_elem = notes_map.get(note_id)
        if note_elem is None:
            continue
        note = _parse_note(note_elem, position, ri.duration_beats, is_tap, is_slap, is_pop)
        if note:
            notes.append(note)

    return BeatEvent(beat_position=position, notes=notes, is_rest=is_rest, rhythm=ri)


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


def _rhythm_info(rhythm_id: Optional[str], rhythms: Dict[str, ET.Element]) -> RhythmInfo:
    """Returns full rhythm metadata. Replaces v1's _rhythm_duration."""
    if not rhythm_id:
        return RhythmInfo()
    rhythm = rhythms.get(rhythm_id)
    if rhythm is None:
        return RhythmInfo()

    note_value = rhythm.findtext("NoteValue") or "Quarter"
    base_durations = {
        "Whole": 4.0, "Half": 2.0, "Quarter": 1.0,
        "Eighth": 0.5, "16th": 0.25, "32nd": 0.125, "64th": 0.0625,
    }
    base = base_durations.get(note_value, 0.25)

    is_dotted = False
    aug = rhythm.find("AugmentationDot")
    if aug is not None:
        is_dotted = True
        count = int(aug.attrib.get("count", "1"))
        base *= 1.5 if count == 1 else 1.75

    is_tuplet = False
    tuplet = rhythm.find("PrimaryTuplet")
    if tuplet is not None:
        is_tuplet = True
        num = int(tuplet.attrib.get("num", "1"))
        den = int(tuplet.attrib.get("den", "1"))
        if den > 0:
            base *= den / num

    return RhythmInfo(
        note_value=note_value,
        is_dotted=is_dotted,
        is_tuplet=is_tuplet,
        duration_beats=base,
    )


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
        guitar_tracks = tracks
    if not guitar_tracks:
        return None
    return max(guitar_tracks, key=lambda t: sum(len(b.notes) for b in t.beats))


# ──────────────────────────────────────────────────────────────────────────────
# Difficulty algorithm v2
# ──────────────────────────────────────────────────────────────────────────────

DEFAULT_WEIGHTS = {
    "speed":             0.28,
    "fret_complexity":   0.25,
    "pick_complexity":   0.18,
    "rhythm_complexity": 0.15,
    "technique_density": 0.09,
    "stamina":           0.05,
}


@dataclass
class DifficultyVector:
    speed: float = 0.0
    fret_complexity: float = 0.0
    pick_complexity: float = 0.0
    rhythm_complexity: float = 0.0
    technique_density: float = 0.0
    stamina: float = 0.0
    overall: float = 0.0

    def to_dict(self) -> dict:
        return {k: round(v, 2) for k, v in {
            "speed":             self.speed,
            "fret_complexity":   self.fret_complexity,
            "pick_complexity":   self.pick_complexity,
            "rhythm_complexity": self.rhythm_complexity,
            "technique_density": self.technique_density,
            "stamina":           self.stamina,
            "overall":           self.overall,
        }.items()}


@dataclass
class _Metrics:
    # Note counts
    total_notes: int = 0
    total_beats: int = 0
    duration_beats: float = 0.0
    max_notes_per_beat: int = 0
    avg_notes_per_beat: float = 0.0
    peak_attacks_per_second: float = 0.0

    # Fret / reach
    max_fret_stretch: int = 0          # largest chord stretch seen (frets)
    avg_fret_distance: float = 0.0     # average note-to-note fret movement
    position_shift_count: int = 0      # note-to-note moves > 5 frets
    cumulative_reach_cost: float = 0.0 # exponential compound reach score

    # Pick / string
    string_skip_count: int = 0
    max_string_skip: int = 0
    direction_changes: int = 0

    # Technique counts
    bend_count: int = 0
    legato_count: int = 0
    vibrato_count: int = 0
    harmonic_count: int = 0
    tap_count: int = 0
    tremolo_count: int = 0
    palm_mute_count: int = 0
    technique_transition_count: int = 0

    # Rhythm
    tuplet_count: int = 0
    dotted_count: int = 0
    note_durations: List[float] = field(default_factory=list)


def _fret_position_weight(fret: int) -> float:
    """
    Returns difficulty multiplier for a stretch at this neck position.
    Based on inverse fret spacing: each fret is 2^(-1/12) × the previous.
    Fret 1 = 1.0 (widest, hardest), Fret 12 ≈ 0.50, Fret 24 ≈ 0.25.
    """
    fret = max(1, fret)
    return 2 ** (-(fret - 1) / 12.0)


def _reach_cost(fret_dist: int, string_dist: int, fret_position: int) -> float:
    """
    Exponential compound cost for a reach event.
    - Fret stretch > 5 is penalized, scaled by neck position
    - String skip > 1 is penalized
    - Both together compound exponentially
    """
    pos_weight = _fret_position_weight(fret_position)
    fret_excess = max(0, fret_dist - 5) * pos_weight
    string_excess = max(0, string_dist - 1)

    if fret_excess > 0 and string_excess > 0:
        # Simultaneous stretch + skip: exponential compounding
        return (fret_excess + string_excess * 0.5) ** 1.6
    elif fret_excess > 0:
        return fret_excess ** 1.2
    elif string_excess > 0:
        return string_excess * 0.4
    return 0.0


def _legato_speed_modifier(legato_ratio: float, tempo_bpm: float) -> float:
    """
    Tempo-dependent legato modifier for the speed axis.
    Fast tempo + high legato = easier (modifier < 1.0, down to 0.65)
    Slow tempo + high legato = harder (modifier > 1.0, up to 1.25)
    Crossover around 100 bpm.
    """
    if legato_ratio == 0:
        return 1.0
    # Normalize: 0.0 at 60 bpm, 1.0 at 180 bpm
    tempo_factor = (tempo_bpm - 60.0) / 120.0
    tempo_factor = max(-0.5, min(1.0, tempo_factor))
    # At high tempo: legato ratio reduces speed difficulty
    # At low tempo: legato ratio increases speed difficulty
    raw = 1.0 - (legato_ratio * tempo_factor * 0.45)
    return max(0.65, min(1.25, raw))


def _collect_metrics(beats: List[BeatEvent], tempo_bpm: float) -> _Metrics:
    m = _Metrics()
    prev_note: Optional[NoteEvent] = None
    prev_string: Optional[int] = None
    prev_palm_mute: Optional[bool] = None
    prev_is_tap: Optional[bool] = None
    beat_data: List[Tuple[float, float, int]] = []

    for beat in beats:
        if beat.is_rest:
            continue

        m.total_beats += 1
        beat_note_count = len(beat.notes)
        m.total_notes += beat_note_count
        if beat_note_count > m.max_notes_per_beat:
            m.max_notes_per_beat = beat_note_count

        # Rhythm metadata
        if beat.rhythm.is_tuplet:
            m.tuplet_count += 1
        if beat.rhythm.is_dotted:
            m.dotted_count += 1
        if beat.notes:
            m.note_durations.append(beat.rhythm.duration_beats)

        if beat.notes:
            duration = beat.notes[0].duration_beats
            m.duration_beats += duration

            picked_attacks = sum(
                0.5 if (n.hammer_on or n.pull_off) else 1.0
                for n in beat.notes
            )
            if picked_attacks > 0:
                beat_data.append((beat.beat_position, duration, picked_attacks))

            # Chord fret stretch (position-weighted)
            if len(beat.notes) > 1:
                frets = [n.fret for n in beat.notes if n.fret > 0]
                if len(frets) > 1:
                    stretch = max(frets) - min(frets)
                    if stretch > m.max_fret_stretch:
                        m.max_fret_stretch = stretch
                    min_fret = min(frets)
                    cost = _reach_cost(stretch, 0, min_fret)
                    m.cumulative_reach_cost += cost

            # Technique transition detection
            beat_is_tap = any(n.is_tap for n in beat.notes)
            beat_palm_mute = any(n.palm_mute for n in beat.notes)
            if prev_palm_mute is not None and prev_palm_mute != beat_palm_mute:
                m.technique_transition_count += 1
            if prev_is_tap is not None and prev_is_tap != beat_is_tap:
                m.technique_transition_count += 1
            prev_palm_mute = beat_palm_mute
            prev_is_tap = beat_is_tap

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
                    if fret_dist > 5:
                        m.position_shift_count += 1

                if prev_string is not None:
                    string_skip = abs(note.string - prev_string)
                    if string_skip > 1:
                        m.string_skip_count += 1
                    if string_skip > m.max_string_skip:
                        m.max_string_skip = string_skip
                    if string_skip >= 1:
                        m.direction_changes += 1

                    # Note-to-note compound reach cost
                    if prev_note is not None:
                        fret_dist = abs(note.fret - prev_note.fret)
                        min_fret = min(note.fret, prev_note.fret)
                        cost = _reach_cost(fret_dist, string_skip, max(1, min_fret))
                        m.cumulative_reach_cost += cost

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


# ── Scoring functions ─────────────────────────────────────────────────────────

def _speed(m: _Metrics, tempo_bpm: float) -> float:
    if m.total_beats == 0 or m.duration_beats == 0:
        return 0.0
    legato_ratio = m.legato_count / max(m.total_notes, 1)
    modifier = _legato_speed_modifier(legato_ratio, tempo_bpm)
    raw = _normalize(m.peak_attacks_per_second, 4, 14) * 100
    return min(100.0, raw * modifier)


def _fret(m: _Metrics) -> float:
    if m.total_notes == 0:
        return 0.0
    # Cumulative reach cost normalized (tuned: FFwF-level playing ≈ 0.8 reach/note)
    reach_density = m.cumulative_reach_cost / max(m.total_notes, 1)
    reach_score = _normalize(reach_density, 0, 1.5) * 100

    shift_rate = m.position_shift_count / max(m.total_notes, 1)
    shift_score = _normalize(shift_rate, 0, 0.20) * 100

    distance_score = _normalize(m.avg_fret_distance, 0, 5) * 100

    # Tap reduces fret difficulty (two hands share the burden)
    tap_ratio = m.tap_count / max(m.total_notes, 1)
    tap_reduction = tap_ratio * 0.25

    base = (reach_score * 0.45 + shift_score * 0.35 + distance_score * 0.20)
    base = max(0, base * (1 - tap_reduction))
    return min(100.0, base)


def _pick(m: _Metrics) -> float:
    if m.total_notes == 0:
        return 0.0
    picked_notes = m.total_notes - m.legato_count
    pick_ratio = picked_notes / max(m.total_notes, 1)

    # String skips — exponential: skipping 3 strings is much harder than 3× skipping 1
    skip_rate = m.string_skip_count / max(picked_notes, 1)
    skip_score = _normalize(skip_rate, 0, 0.25) * 100
    max_skip_score = _normalize(m.max_string_skip ** 1.4, 1, 8) * 100

    cross_rate = m.direction_changes / max(picked_notes, 1)
    cross_score = _normalize(cross_rate, 0, 0.6) * 100

    base = skip_score * 0.40 + cross_score * 0.35 + max_skip_score * 0.25
    base = base * (0.3 + 0.7 * pick_ratio)
    speed_mult = 0.3 + 0.7 * _normalize(m.peak_attacks_per_second, 4, 12)
    return min(100.0, base * speed_mult)


def _rhythm(m: _Metrics, time_signatures: List[str]) -> float:
    """
    Stacked modifier model: baseline is 4/4 quarter notes = 0.
    Each divergence adds to the score.
    """
    score = 0.0
    total_notes = max(m.total_notes, 1)

    # Time signature divergence
    unique_sigs = set(time_signatures) if time_signatures else {"4/4"}
    non_standard = [s for s in unique_sigs if s != "4/4"]
    if non_standard:
        score += 0.30
    # Multiple time signature changes (each additional change adds more)
    if len(unique_sigs) > 1:
        score += 0.15 * (len(unique_sigs) - 1)

    # Note value complexity: 8ths, 16ths, 32nds are progressively harder
    note_value_scores = {
        "Whole": 0.0, "Half": 0.0, "Quarter": 0.0,
        "Eighth": 0.05, "16th": 0.15, "32nd": 0.30, "64th": 0.50,
    }
    if m.note_durations:
        # Use the most common short note value as the representative
        duration_counts: Dict[float, int] = {}
        for d in m.note_durations:
            duration_counts[d] = duration_counts.get(d, 0) + 1
        most_common_dur = max(duration_counts, key=duration_counts.__getitem__)
        # Map duration back to approximate note value score
        # Quarter=1.0, Eighth=0.5, 16th=0.25, 32nd=0.125
        if most_common_dur <= 0.125:
            score += 0.30
        elif most_common_dur <= 0.25:
            score += 0.15
        elif most_common_dur <= 0.5:
            score += 0.05

    # Duration variance (rhythmic irregularity)
    if len(m.note_durations) >= 4:
        try:
            variance = statistics.variance(m.note_durations)
            score += min(0.25, variance * 3)
        except statistics.StatisticsError:
            pass

    # Tuplets
    if m.tuplet_count > 0:
        tuplet_density = m.tuplet_count / total_notes
        score += min(0.30, tuplet_density * 2.5)

    # Dotted notes (rhythmic complexity without being as hard as tuplets)
    if m.dotted_count > 0:
        dot_density = m.dotted_count / total_notes
        score += min(0.10, dot_density * 0.8)

    # Technique transition cost feeds into rhythm: fast switches break the groove
    if m.technique_transition_count > 0:
        transition_density = m.technique_transition_count / total_notes
        score += min(0.20, transition_density * 3)

    return _normalize(score, 0, 1.8) * 100


def _technique(m: _Metrics) -> float:
    if m.total_notes == 0:
        return 0.0
    hard = (
        m.bend_count      * 2.0
        + m.harmonic_count * 1.5
        + m.tremolo_count  * 1.5
        + m.vibrato_count  * 0.3
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


def compute_difficulty_vector(
    beats: List[BeatEvent],
    tempo_bpm: float,
    time_signatures: Optional[List[str]] = None,
    weights: Optional[Dict[str, float]] = None,
) -> DifficultyVector:
    if not beats or tempo_bpm <= 0:
        return DifficultyVector()

    w = weights or DEFAULT_WEIGHTS
    ts = time_signatures or ["4/4"]

    m = _collect_metrics(beats, tempo_bpm)
    speed      = _speed(m, tempo_bpm)
    fret       = _fret(m)
    pick       = _pick(m)
    rhythm     = _rhythm(m, ts)
    technique  = _technique(m)
    stamina    = _stamina(m, tempo_bpm)

    overall = (
        speed     * w.get("speed",             0.28)
        + fret    * w.get("fret_complexity",   0.25)
        + pick    * w.get("pick_complexity",   0.18)
        + rhythm  * w.get("rhythm_complexity", 0.15)
        + technique * w.get("technique_density", 0.09)
        + stamina * w.get("stamina",           0.05)
    )

    return DifficultyVector(
        speed=speed,
        fret_complexity=fret,
        pick_complexity=pick,
        rhythm_complexity=rhythm,
        technique_density=technique,
        stamina=stamina,
        overall=overall,
    )


# ──────────────────────────────────────────────────────────────────────────────
# Learning system
# ──────────────────────────────────────────────────────────────────────────────

def load_weights(path: Optional[str]) -> Dict[str, float]:
    """Load weights from JSON file, falling back to defaults."""
    if path is None:
        return dict(DEFAULT_WEIGHTS)
    try:
        with open(path) as f:
            loaded = json.load(f)
        # Validate and fill missing keys with defaults
        w = dict(DEFAULT_WEIGHTS)
        w.update({k: float(v) for k, v in loaded.items() if k in DEFAULT_WEIGHTS})
        # Renormalize to sum to 1.0
        total = sum(w.values())
        if total > 0:
            w = {k: v / total for k, v in w.items()}
        return w
    except (FileNotFoundError, json.JSONDecodeError, ValueError) as exc:
        print(f"Warning: could not load weights from {path}: {exc}", file=sys.stderr)
        return dict(DEFAULT_WEIGHTS)


def correct_weights(
    vec_harder: DifficultyVector,
    vec_easier: DifficultyVector,
    current_weights: Dict[str, float],
    learning_rate: float = 0.05,
) -> Tuple[Dict[str, float], bool]:
    """
    Pairwise correction: harder_song should score higher than easier_song.
    If it doesn't (violation), nudge weights toward axes where harder > easier.
    Returns (new_weights, was_violation).
    """
    was_violation = vec_harder.overall <= vec_easier.overall

    if not was_violation:
        return current_weights, False

    axes = ["speed", "fret_complexity", "pick_complexity",
            "rhythm_complexity", "technique_density", "stamina"]
    harder_vals = vec_harder.to_dict()
    easier_vals = vec_easier.to_dict()

    new_weights = dict(current_weights)
    for axis in axes:
        diff = harder_vals.get(axis, 0) - easier_vals.get(axis, 0)
        if diff > 0:
            # Harder song scores higher on this axis — increase its weight
            new_weights[axis] = new_weights[axis] + learning_rate * (diff / 100.0)
        else:
            # Harder song scores lower on this axis — decrease its weight
            new_weights[axis] = max(0.01, new_weights[axis] + learning_rate * (diff / 100.0))

    # Renormalize
    total = sum(new_weights.values())
    if total > 0:
        new_weights = {k: v / total for k, v in new_weights.items()}

    return new_weights, True


# ──────────────────────────────────────────────────────────────────────────────
# Tab viewer: structured note export
# ──────────────────────────────────────────────────────────────────────────────

def _group_beats_into_measures(track: TrackData) -> list:
    """Group a track's flat beat list into per-measure beat lists, merging voices."""
    measures = []
    measure_start = 0.0

    for bar_idx, ts_text in enumerate(track.time_signatures):
        beats_per_bar = _time_sig_to_beats(ts_text)
        measure_end = measure_start + beats_per_bar

        # Collect and merge beats in this measure range, keyed by position-within-measure.
        # Multiple voices can produce beats at the same position — merge their notes.
        pos_map: Dict[float, dict] = {}
        for b in track.beats:
            if b.beat_position < measure_start or b.beat_position >= measure_end:
                continue
            pos = round(b.beat_position - measure_start, 4)
            if pos not in pos_map:
                pos_map[pos] = {
                    "position": pos,
                    "duration": round(b.rhythm.duration_beats, 4),
                    "is_rest": b.is_rest and not b.notes,
                    "notes": [],
                }
            entry = pos_map[pos]
            for n in b.notes:
                tech: list = []
                if n.hammer_on:      tech.append("h")
                if n.pull_off:       tech.append("p")
                if n.bend:           tech.append("b")
                if n.vibrato:        tech.append("vib")
                if n.palm_mute:      tech.append("pm")
                if n.dead_note:      tech.append("x")
                if n.is_tap:         tech.append("t")
                if n.harmonic:       tech.append("harm")
                entry["notes"].append({
                    "string": n.string,
                    "fret": n.fret,
                    "techniques": tech,
                })

        merged = sorted(pos_map.values(), key=lambda x: x["position"])
        measures.append({
            "index": bar_idx,
            "time_sig": ts_text,
            "beats_per_bar": beats_per_bar,
            "beats": merged,
        })
        measure_start = measure_end

    return measures


def view_song(path: Path) -> dict:
    """Parse GP file and return structured note data for the tab viewer."""
    song = parse_gpif_file(path)
    tempo = song.tempo_bpm or 120.0

    track_results = []
    for track in song.tracks:
        measures = _group_beats_into_measures(track)
        track_results.append({
            "name": track.name,
            "instrument": track.instrument,
            "string_count": track.string_count,
            "bar_count": track.bar_count,
            "measures": measures,
        })

    return {
        "title": song.title,
        "artist": song.artist,
        "tempo_bpm": tempo,
        "tracks": track_results,
    }


# ──────────────────────────────────────────────────────────────────────────────
# Entry point
# ──────────────────────────────────────────────────────────────────────────────

def analyze(path: Path, weights: Dict[str, float]) -> dict:
    song = parse_gpif_file(path)
    tempo = song.tempo_bpm or 120.0

    track_results = []
    for track in song.tracks:
        vec = compute_difficulty_vector(track.beats, tempo, track.time_signatures, weights)
        track_results.append({
            "name": track.name,
            "instrument": track.instrument,
            "difficulty_score": round(vec.overall, 2),
            "vector": vec.to_dict(),
        })

    primary = _select_primary_track(song.tracks)
    if primary:
        primary_vec = compute_difficulty_vector(primary.beats, tempo, primary.time_signatures, weights)
        primary_score = round(primary_vec.overall, 2)
        primary_vector = primary_vec.to_dict()
    else:
        primary_score = 0.0
        primary_vector = DifficultyVector().to_dict()

    return {
        "difficulty_score": primary_score,
        "vector": primary_vector,
        "title": song.title,
        "artist": song.artist,
        "tempo_bpm": tempo,
        "tracks": track_results,
    }


def main():
    args = sys.argv[1:]

    # Parse --weights flag
    weights_path = None
    if "--weights" in args:
        idx = args.index("--weights")
        if idx + 1 < len(args):
            weights_path = args[idx + 1]
            args = args[:idx] + args[idx + 2:]
        else:
            print(json.dumps({"error": "--weights requires a path argument"}), file=sys.stderr)
            sys.exit(1)

    weights = load_weights(weights_path)

    # --view mode: structured note export for the tab viewer
    if args and args[0] == "--view":
        if len(args) < 2:
            print(json.dumps({"error": "Usage: analyze_gp.py --view <file.gp>"}), file=sys.stderr)
            sys.exit(1)
        path = Path(args[1])
        if not path.exists():
            print(json.dumps({"error": f"File not found: {path}"}), file=sys.stderr)
            sys.exit(1)
        suffix = path.suffix.lower()
        if suffix not in GPIF_EXTENSIONS:
            print(json.dumps({"error": f"Unsupported format: {suffix}. Only {GPIF_EXTENSIONS} are supported."}), file=sys.stderr)
            sys.exit(1)
        try:
            result = view_song(path)
        except GPIFParserError as exc:
            print(json.dumps({"error": str(exc)}), file=sys.stderr)
            sys.exit(1)
        print(json.dumps(result))
        return

    # --correct mode: pairwise ranking correction
    if args and args[0] == "--correct":
        if len(args) < 3:
            print(json.dumps({"error": "Usage: --correct <harder.gp> <easier.gp>"}), file=sys.stderr)
            sys.exit(1)

        path_a = Path(args[1])
        path_b = Path(args[2])

        for p in (path_a, path_b):
            if not p.exists():
                print(json.dumps({"error": f"File not found: {p}"}), file=sys.stderr)
                sys.exit(1)

        try:
            song_a = parse_gpif_file(path_a)
            song_b = parse_gpif_file(path_b)
        except GPIFParserError as exc:
            print(json.dumps({"error": str(exc)}), file=sys.stderr)
            sys.exit(1)

        tempo_a = song_a.tempo_bpm or 120.0
        tempo_b = song_b.tempo_bpm or 120.0

        primary_a = _select_primary_track(song_a.tracks)
        primary_b = _select_primary_track(song_b.tracks)

        if not primary_a or not primary_b:
            print(json.dumps({"error": "Could not find a primary guitar track in one or both files"}), file=sys.stderr)
            sys.exit(1)

        vec_a = compute_difficulty_vector(primary_a.beats, tempo_a, primary_a.time_signatures, weights)
        vec_b = compute_difficulty_vector(primary_b.beats, tempo_b, primary_b.time_signatures, weights)

        new_weights, was_violation = correct_weights(vec_a, vec_b, weights)

        print(json.dumps({
            "weights": new_weights,
            "was_violation": was_violation,
            "score_harder": round(vec_a.overall, 2),
            "score_easier": round(vec_b.overall, 2),
            "vector_harder": vec_a.to_dict(),
            "vector_easier": vec_b.to_dict(),
        }))
        return

    # Standard analysis mode
    if not args:
        print(json.dumps({"error": "Usage: analyze_gp.py <file.gp> [--weights weights.json]"}), file=sys.stderr)
        sys.exit(1)

    path = Path(args[0])
    if not path.exists():
        print(json.dumps({"error": f"File not found: {path}"}), file=sys.stderr)
        sys.exit(1)

    suffix = path.suffix.lower()
    if suffix not in GPIF_EXTENSIONS:
        print(json.dumps({"error": f"Unsupported format: {suffix}. Only {GPIF_EXTENSIONS} are supported."}), file=sys.stderr)
        sys.exit(1)

    try:
        result = analyze(path, weights)
    except GPIFParserError as exc:
        print(json.dumps({"error": str(exc)}), file=sys.stderr)
        sys.exit(1)

    print(json.dumps(result))


if __name__ == "__main__":
    main()