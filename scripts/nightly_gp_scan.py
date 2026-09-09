#!/usr/bin/env python3
"""Nightly GP library scan.

Runs the same match/analyze pipeline as the in-app "Scan & Analyze" button in
GpLibraryView, but standalone (outside Tauri) so it can run on a schedule via
launchd even when practice-hub isn't open. Caches results into the local
tauri-plugin-store file so the app shows them next time it's opened, AND
writes computed rhythm/lead difficulty straight to Turso for matched songs —
mirroring src-tauri/sidecar/write_song_difficulty.py's direct-write mechanism
(same manual-lock respect, re-checked at write time). It does NOT push the
overall difficulty_score or register the GP file as a resource on the song —
those go through Instrumenta's HTTP API, which needs a logged-in user token
that this unattended script doesn't have; that part still requires opening
the app and clicking Confirm.

Usage:
    <instrumenta-repo>/.venv/bin/python3 nightly_gp_scan.py [--env production|development] [--root PATH] [--dry-run]
"""

import argparse
import json
import os
import re
import subprocess
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

GP_EXTENSIONS = {".gp", ".gpx", ".gp7", ".gp8"}
STORE_PATH = Path.home() / "Library/Application Support/com.astrojason.practicehub/gp-library"
DEFAULT_ROOT = Path.home() / "Documents/Sheet Music"
INSTRUMENTA_REPO = Path.home() / "Projects/astrojason/practice.astrojason.com"
ANALYZE_SIDECAR = Path(__file__).resolve().parent.parent / "src-tauri/sidecar/analyze_gp.py"

ISO_SUFFIX_RE = re.compile(r"-\d{4}-\d{2}-\d{2}$")


# ─── Notification Center ──────────────────────────────────────────────────────
# launchd runs this headless (no terminal), so a notification is the only way
# the user sees the scan happened at all without opening the app or a log file.
# LimitLoadToSessionType=Aqua in the plist keeps this in the GUI session that
# both mechanisms below need.
#
# Plain osascript notifications are all attributed to the same "Script
# Editor" identity as every other display-notification script on this Mac,
# so they stack into one indistinguishable group and can't carry a custom
# icon (macOS has no API to override it — the icon always comes from the
# calling app's own bundle). practice-hub-notifier.app is a copy of
# terminal-notifier built with its own bundle id and the Practice Hub icon
# (see scripts/build-notifier.sh) specifically so this scan's notifications
# are visually distinct and don't nest under anything else. Fall back to
# plain osascript if that copy is ever missing, rather than going silent.
NOTIFIER_APP = Path("/Applications/practice-hub-notifier.app/Contents/MacOS/terminal-notifier")


def _applescript_string(value: str) -> str:
    # AppleScript string literals only understand \" and \\ — NOT the \uXXXX
    # escapes json.dumps() would produce, which osascript rejects outright.
    # Everything else (including UTF-8 like the em dash in our summaries)
    # passes through as a literal character.
    return '"' + value.replace("\\", "\\\\").replace('"', '\\"') + '"'


def _notify_command(message: str, title: str, group: str, notifier_path: Path) -> list:
    if notifier_path.is_file():
        return [str(notifier_path), "-title", title, "-message", message, "-group", group]
    script = f"display notification {_applescript_string(message)} with title {_applescript_string(title)}"
    return ["osascript", "-e", script]


def notify(message: str, title: str = "Practice Hub", group: str = "nightly-gp-scan") -> None:
    # Fire-and-forget: a notification failure (no GUI session, notifier
    # missing, etc.) must never take down the scan itself.
    try:
        subprocess.run(_notify_command(message, title, group, NOTIFIER_APP), check=False, timeout=10)
    except Exception:
        pass


# ─── Filename parser ──────────────────────────────────────────────────────────
# Mirrors parseFilename() in src/hooks/useGpScanner.ts exactly (see
# tests/gp-filename-parse.spec.ts for the behavior this must match):
#   - Canonical naming: {Artist}-{Song Title}-{MM-DD-YYYY}.gp
#   - Backup copies with a trailing ISO -YYYY-MM-DD suffix are ignored.
#   - Anything else that doesn't fit the convention is ignored.

def parse_filename(filename: str):
    stem = re.sub(r"\.[^.]+$", "", filename)

    if ISO_SUFFIX_RE.search(stem):
        return None

    parts = stem.split("-")
    if len(parts) < 4:
        return None

    yyyy, dd, mm = parts[-1], parts[-2], parts[-3]
    if not re.fullmatch(r"\d{4}", yyyy) or not re.fullmatch(r"\d{2}", dd) or not re.fullmatch(r"\d{2}", mm):
        return None

    try:
        date_obj = datetime(int(yyyy), int(mm), int(dd), tzinfo=timezone.utc)
    except ValueError:
        return None

    remaining = parts[:-3]
    if len(remaining) < 2:
        return None

    artist = remaining[0].strip()
    title = "-".join(remaining[1:]).strip()
    if not artist or not title:
        return None

    return {
        "artist": artist,
        "title": title,
        "date": f"{mm}-{dd}-{yyyy}",
        "date_ms": int(date_obj.timestamp() * 1000),
    }


def norm_key(s: str) -> str:
    return re.sub(r"\s+", " ", s.lower()).strip()


# ─── Directory scan ───────────────────────────────────────────────────────────

def scan_dir(root: Path):
    entries = []
    for dirpath, _dirnames, filenames in os.walk(root):
        for fn in filenames:
            if Path(fn).suffix.lower() not in GP_EXTENSIONS:
                continue
            full = Path(dirpath) / fn
            try:
                stat = full.stat()
            except OSError:
                continue
            entries.append({
                "path": str(full),
                "filename": fn,
                "modified_ms": int(stat.st_mtime * 1000),
                "size_bytes": stat.st_size,
            })
    return entries


def compute_raw_fingerprint(entries: list) -> str:
    """Mirrors computeRawFingerprint() in useGpScanner.ts."""
    return "\n".join(sorted(f"{e['path']}|{e['modified_ms']}|{e['size_bytes']}" for e in entries))


def dedupe(parsed_files):
    version_map = {}
    for f in parsed_files:
        key = f"{norm_key(f['parsed_artist'])}|||{norm_key(f['parsed_title'])}"
        existing = version_map.get(key)
        if not existing or f["date_ms"] > existing["date_ms"]:
            version_map[key] = f
    return list(version_map.values())


# ─── Undated "current" alias resolution ───────────────────────────────────────
# Mirrors resolveUndatedResource() in src/hooks/useGpScanner.ts: cleanup_
# duplicates.py copies the newest dated file to an undated "current" alias
# in the same folder and trashes older dated duplicates once a newer version
# arrives, so a resource path pinned to a specific dated filename will
# eventually 404. Prefer the undated alias (path/filename/modified_ms/
# size_bytes) when it exists, keeping the parsed artist/title/date (from the
# dated file) for version tracking.

def resolve_undated_resource(f: dict, raw_entries_by_path: dict) -> dict:
    ext = Path(f["filename"]).suffix
    stem = f["filename"][: len(f["filename"]) - len(ext)] if ext else f["filename"]
    date_suffix = f"-{f['parsed_date']}"
    if not stem.endswith(date_suffix):
        return f

    undated_filename = stem[: -len(date_suffix)] + ext
    dir_path = f["path"][: len(f["path"]) - len(f["filename"])]
    undated_path = dir_path + undated_filename

    alias = raw_entries_by_path.get(undated_path)
    if not alias:
        return f  # alias doesn't exist yet — fall back to the dated file itself

    return {
        **f,
        "path": alias["path"],
        "filename": alias["filename"],
        "modified_ms": alias["modified_ms"],
        "size_bytes": alias["size_bytes"],
    }


# ─── Instrumenta catalog + direct Turso writes ────────────────────────────────

def load_env_file(env_path: Path) -> dict:
    if not env_path.exists():
        raise FileNotFoundError(f"Instrumenta env file not found: {env_path}")
    creds = {}
    for line in env_path.read_text().splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        creds[key.strip()] = value.strip().strip('"').strip("'")
    return creds


def open_turso_connection(env: str):
    creds = load_env_file(INSTRUMENTA_REPO / f".env.{env}")
    db_url = creds["TURSO_DATABASE_URL"]
    auth_token = creds["TURSO_AUTH_TOKEN"]

    import libsql_experimental as libsql

    return libsql.connect(db_url, auth_token=auth_token)


def get_song_catalog(conn) -> dict:
    cursor = conn.cursor()
    # Mirrors the WHERE clause in api/song.py's song_list endpoint
    # (EntityStatus.APPROVED == 1) — only approved songs are matchable.
    cursor.execute(
        "SELECT song.id, song.name, artist.name, "
        "song.rhythm_difficulty_manual, song.lead_difficulty_manual FROM song "
        "JOIN artist ON song.artist_id = artist.id WHERE song.status = 1"
    )
    rows = cursor.fetchall()

    return {
        f"{norm_key(artist_name)}|||{norm_key(song_name)}": {
            "id": song_id,
            "name": song_name,
            "artist_name": artist_name,
            "rhythm_difficulty_manual": rhythm_manual,
            "lead_difficulty_manual": lead_manual,
        }
        for song_id, song_name, artist_name, rhythm_manual, lead_manual in rows
    }


def write_difficulty(conn, song_id: int, rhythm_score, lead_score) -> tuple:
    """Writes unlocked rhythm/lead difficulty straight to Turso.

    Mirrors src-tauri/sidecar/write_song_difficulty.py: re-checks the manual
    lock flags at write time rather than trusting the catalog snapshot from
    the top of the run, so a lock flipped mid-run is still respected.
    """
    cursor = conn.cursor()
    cursor.execute(
        "SELECT rhythm_difficulty_manual, lead_difficulty_manual FROM song WHERE id = ?",
        (song_id,),
    )
    row = cursor.fetchone()
    if row is None:
        return False, False

    rhythm_written = rhythm_score is not None and not bool(row[0])
    lead_written = lead_score is not None and not bool(row[1])

    if rhythm_written:
        cursor.execute("UPDATE song SET rhythm_difficulty = ? WHERE id = ?", (rhythm_score, song_id))
    if lead_written:
        cursor.execute("UPDATE song SET lead_difficulty = ? WHERE id = ?", (lead_score, song_id))
    if rhythm_written or lead_written:
        conn.commit()

    return rhythm_written, lead_written


def push_seen_entry_to_turso(conn, entry: dict, filename: str) -> bool:
    """Writes a seen-entry's unlocked rhythm/lead scores to Turso, once.

    No-ops for unmatched files, entries already pushed, or entries with
    nothing unlocked to write (suppress_manual already nulled locked
    aspects). Returns whether a write actually happened.
    """
    song_id = entry.get("song_id")
    if not song_id or entry.get("turso_pushed"):
        return False

    rhythm = entry.get("rhythm")
    lead = entry.get("lead")
    if rhythm is None and lead is None:
        return False

    try:
        write_difficulty(
            conn,
            song_id,
            rhythm["difficulty_score"] if rhythm else None,
            lead["difficulty_score"] if lead else None,
        )
    except Exception as exc:
        print(f"  turso write failed for {filename}: {exc}", file=sys.stderr)
        return False

    entry["turso_pushed"] = True
    return True


# ─── Analysis sidecar ─────────────────────────────────────────────────────────

def analyze_file(path: str):
    """
    Returns (difficulty_score, vector, tempo_bpm, rhythm, lead). rhythm/lead
    are the per-aspect breakdowns from separate GP tracks (see analyze_gp.py's
    _select_role_tracks) — each is {difficulty_score, vector, track_name} or
    None when the file has no distinguishable track for that aspect.

    The caller suppresses an aspect before caching it when the matched song's
    canonical value is protected by its corresponding *_difficulty_manual
    flag. Unmatched files retain every computed aspect.
    """
    try:
        result = subprocess.run(
            ["python3", str(ANALYZE_SIDECAR), path],
            capture_output=True, text=True, timeout=120,
        )
        if result.returncode != 0:
            print(f"  analyze failed for {path}: {result.stderr.strip()}", file=sys.stderr)
            return None, None, None, None, None
        data = json.loads(result.stdout)
        return (
            data.get("difficulty_score"), data.get("vector"), data.get("tempo_bpm"),
            data.get("rhythm"), data.get("lead"),
        )
    except Exception as exc:
        print(f"  analyze error for {path}: {exc}", file=sys.stderr)
        return None, None, None, None, None


def suppress_manual(rhythm, lead, song: dict | None):
    """Remove computed aspects protected by canonical manual locks."""
    if song is None:
        return rhythm, lead
    return (
        None if song.get("rhythm_difficulty_manual") else rhythm,
        None if song.get("lead_difficulty_manual") else lead,
    )


# ─── Result shaping (matches GpMatch / GpUnmatched in src/api/types.ts) ───────

def file_dict(f: dict) -> dict:
    return {
        "path": f["path"],
        "filename": f["filename"],
        "modified_ms": f["modified_ms"],
        "size_bytes": f["size_bytes"],
        "parsed_artist": f["parsed_artist"],
        "parsed_title": f["parsed_title"],
        "parsed_date": f["parsed_date"],
        "date_ms": f["date_ms"],
    }


def to_match(f: dict, song: dict, seen_entry: dict, is_newer_version: bool) -> dict:
    return {
        "file": file_dict(f),
        "song_id": song["id"],
        "song_name": song["name"],
        "artist_name": song["artist_name"],
        "difficulty_score": seen_entry.get("difficulty_score"),
        "difficulty_vector": seen_entry.get("difficulty_vector"),
        "tempo_bpm": seen_entry.get("tempo_bpm"),
        "manual_score": seen_entry.get("manual_score"),
        "rhythm": seen_entry.get("rhythm"),
        "lead": seen_entry.get("lead"),
        "is_newer_version": is_newer_version,
        "pushed": seen_entry.get("pushed", False),
    }


def to_unmatched(f: dict, seen_entry: dict | None) -> dict:
    return {
        "file": file_dict(f),
        "assigned_song_id": (seen_entry or {}).get("song_id"),
    }


# ─── Main ─────────────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--env", choices=["development", "production"], default="production",
                        help="Which Instrumenta .env file to read Turso credentials from (default: production)")
    parser.add_argument("--root", help="Override the scan root (defaults to the saved rootPath in the practice-hub store)")
    parser.add_argument("--dry-run", action="store_true", help="Scan/analyze/match but don't write the store file")
    args = parser.parse_args()

    store = json.loads(STORE_PATH.read_text()) if STORE_PATH.exists() else {}
    root_path = Path(args.root) if args.root else Path(store.get("rootPath") or DEFAULT_ROOT)
    seen = dict(store.get("seen", {}))

    print(f"Scanning {root_path} ...")
    raw_entries = scan_dir(root_path)

    # Fast path: if the directory listing is byte-for-byte identical to the
    # last run, nothing could have changed — skip the catalog fetch, dedup,
    # and analysis entirely (and skip touching Turso at all).
    fingerprint = compute_raw_fingerprint(raw_entries)
    if store.get("rawFingerprint") == fingerprint and store.get("lastScan"):
        print(f"No changes since last scan ({len(raw_entries)} files) — skipping catalog fetch/analysis.")
        notify(f"No changes since last scan ({len(raw_entries)} files).")
        return

    parsed = []
    for entry in raw_entries:
        p = parse_filename(entry["filename"])
        if not p:
            continue
        parsed.append({
            **entry,
            "parsed_artist": p["artist"], "parsed_title": p["title"],
            "parsed_date": p["date"], "date_ms": p["date_ms"],
        })

    deduped = dedupe(parsed)
    raw_entries_by_path = {e["path"]: e for e in raw_entries}
    deduped = [resolve_undated_resource(f, raw_entries_by_path) for f in deduped]
    print(f"Found {len(raw_entries)} GP files, {len(deduped)} after version dedup.")

    print(f"Fetching Instrumenta song catalog ({args.env})...")
    turso_conn = open_turso_connection(args.env)
    try:
        catalog = get_song_catalog(turso_conn)

        matches = []
        unmatched = []
        skipped_count = 0
        analyzed_count = 0
        pushed_count = 0

        for f in deduped:
            key = f"{norm_key(f['parsed_artist'])}|||{norm_key(f['parsed_title'])}"
            song = catalog.get(key)
            prev = seen.get(f["filename"])
            unchanged = bool(prev) and prev["modified_ms"] == f["modified_ms"]

            if unchanged:
                skipped_count += 1
                entry = prev
            else:
                analyzed_count += 1
                print(f"  analyzing {f['filename']} ...")
                score, vector, tempo, rhythm, lead = analyze_file(f["path"])
                rhythm, lead = suppress_manual(rhythm, lead, song)

                is_newer_version = bool(prev)
                entry = {
                    "modified_ms": f["modified_ms"],
                    "song_id": song["id"] if song else None,
                    "difficulty_score": score,
                    "difficulty_vector": vector,
                    "tempo_bpm": tempo,
                    "manual_score": None,
                    "rhythm": rhythm,
                    "lead": lead,
                    "resource_path": f["path"],
                    "dismissed": False,
                    "pushed": False if is_newer_version else (prev.get("pushed", False) if prev else False),
                    "turso_pushed": False if is_newer_version else (prev.get("turso_pushed", False) if prev else False),
                }
                seen[f["filename"]] = entry

            if not args.dry_run and push_seen_entry_to_turso(turso_conn, entry, f["filename"]):
                pushed_count += 1

            if song:
                matches.append(to_match(f, song, entry, is_newer_version=not unchanged and bool(prev)))
            else:
                unmatched.append(to_unmatched(f, entry))
    finally:
        turso_conn.close()

    summary = (
        f"Done — {len(matches)} matched, {len(unmatched)} unmatched, "
        f"{skipped_count} skipped, {analyzed_count} analyzed, {pushed_count} pushed to Turso."
    )
    print(summary)

    if args.dry_run:
        print("(dry run — not writing store file)")
        return

    store["seen"] = seen
    store["lastScan"] = {
        "matches": matches,
        "unmatched": unmatched,
        "skipped_count": skipped_count,
        "timestamp": int(time.time() * 1000),
    }
    store["rawFingerprint"] = fingerprint
    STORE_PATH.parent.mkdir(parents=True, exist_ok=True)
    STORE_PATH.write_text(json.dumps(store, indent=2))
    print(f"Wrote {STORE_PATH}")
    notify(summary)


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        notify(f"Nightly scan failed: {exc}")
        raise
