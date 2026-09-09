import tempfile
import unittest
from pathlib import Path

from nightly_gp_scan import (
    _applescript_string,
    _notify_command,
    push_seen_entry_to_turso,
    suppress_manual,
    write_difficulty,
)


class FakeCursor:
    def __init__(self, conn):
        self.conn = conn

    def execute(self, sql, params=()):
        self.conn.queries.append((sql, params))
        if sql.startswith("SELECT"):
            self._result = self.conn.rows_by_song_id.get(params[0])
        else:
            self._result = None
        return self

    def fetchone(self):
        return self._result


class FakeConnection:
    def __init__(self, rows_by_song_id):
        self.rows_by_song_id = rows_by_song_id
        self.queries = []
        self.commits = 0

    def cursor(self):
        return FakeCursor(self)

    def commit(self):
        self.commits += 1


class SuppressManualTests(unittest.TestCase):
    def setUp(self):
        self.rhythm = {"difficulty_score": 42.5, "track_name": "Rhythm Guitar"}
        self.lead = {"difficulty_score": 78.3, "track_name": "Lead Guitar"}

    def test_suppresses_only_locked_rhythm(self):
        song = {
            "rhythm_difficulty_manual": True,
            "lead_difficulty_manual": False,
        }

        rhythm, lead = suppress_manual(self.rhythm, self.lead, song)

        self.assertIsNone(rhythm)
        self.assertIs(lead, self.lead)

    def test_suppresses_only_locked_lead(self):
        song = {
            "rhythm_difficulty_manual": False,
            "lead_difficulty_manual": True,
        }

        rhythm, lead = suppress_manual(self.rhythm, self.lead, song)

        self.assertIs(rhythm, self.rhythm)
        self.assertIsNone(lead)

    def test_suppresses_both_locked_aspects(self):
        song = {
            "rhythm_difficulty_manual": True,
            "lead_difficulty_manual": True,
        }

        rhythm, lead = suppress_manual(self.rhythm, self.lead, song)

        self.assertIsNone(rhythm)
        self.assertIsNone(lead)

    def test_does_not_suppress_unmatched_file(self):
        rhythm, lead = suppress_manual(self.rhythm, self.lead, None)

        self.assertIs(rhythm, self.rhythm)
        self.assertIs(lead, self.lead)


class ApplescriptStringTests(unittest.TestCase):
    def test_escapes_backslashes_and_quotes(self):
        self.assertEqual(
            _applescript_string('could not read "weird\\path" file'),
            '"could not read \\"weird\\\\path\\" file"',
        )

    def test_passes_utf8_through_unescaped(self):
        # osascript understands literal UTF-8; it does NOT understand the
        # \uXXXX escapes json.dumps() would produce for the same character.
        self.assertEqual(_applescript_string("Done — 3 matched"), '"Done — 3 matched"')


class NotifyCommandTests(unittest.TestCase):
    def test_uses_the_custom_notifier_when_installed(self):
        with tempfile.NamedTemporaryFile() as notifier:
            command = _notify_command("hi", "Practice Hub", "nightly-gp-scan", Path(notifier.name))

        self.assertEqual(
            command,
            [notifier.name, "-title", "Practice Hub", "-message", "hi", "-group", "nightly-gp-scan"],
        )

    def test_falls_back_to_osascript_when_the_notifier_is_missing(self):
        missing = Path("/no/such/notifier")

        command = _notify_command("hi", "Practice Hub", "nightly-gp-scan", missing)

        self.assertEqual(command[0], "osascript")
        self.assertIn('"hi"', command[2])
        self.assertIn('"Practice Hub"', command[2])


class WriteDifficultyTests(unittest.TestCase):
    def test_writes_both_when_unlocked(self):
        conn = FakeConnection({7: (False, False)})

        rhythm_written, lead_written = write_difficulty(conn, 7, 42.5, 78.3)

        self.assertTrue(rhythm_written)
        self.assertTrue(lead_written)
        self.assertIn(
            ("UPDATE song SET rhythm_difficulty = ? WHERE id = ?", (42.5, 7)),
            conn.queries,
        )
        self.assertIn(
            ("UPDATE song SET lead_difficulty = ? WHERE id = ?", (78.3, 7)),
            conn.queries,
        )
        self.assertEqual(conn.commits, 1)

    def test_skips_locked_rhythm(self):
        conn = FakeConnection({7: (True, False)})

        rhythm_written, lead_written = write_difficulty(conn, 7, 42.5, 78.3)

        self.assertFalse(rhythm_written)
        self.assertTrue(lead_written)
        self.assertNotIn(
            ("UPDATE song SET rhythm_difficulty = ? WHERE id = ?", (42.5, 7)),
            conn.queries,
        )

    def test_skips_locked_lead(self):
        conn = FakeConnection({7: (False, True)})

        rhythm_written, lead_written = write_difficulty(conn, 7, 42.5, 78.3)

        self.assertTrue(rhythm_written)
        self.assertFalse(lead_written)
        self.assertNotIn(
            ("UPDATE song SET lead_difficulty = ? WHERE id = ?", (78.3, 7)),
            conn.queries,
        )

    def test_does_not_commit_when_nothing_written(self):
        conn = FakeConnection({7: (True, True)})

        rhythm_written, lead_written = write_difficulty(conn, 7, 42.5, 78.3)

        self.assertFalse(rhythm_written)
        self.assertFalse(lead_written)
        self.assertEqual(conn.commits, 0)

    def test_returns_false_false_when_song_not_found(self):
        conn = FakeConnection({})

        rhythm_written, lead_written = write_difficulty(conn, 99, 42.5, 78.3)

        self.assertFalse(rhythm_written)
        self.assertFalse(lead_written)
        self.assertEqual(conn.commits, 0)

    def test_skips_aspect_with_no_score(self):
        conn = FakeConnection({7: (False, False)})

        rhythm_written, lead_written = write_difficulty(conn, 7, None, 78.3)

        self.assertFalse(rhythm_written)
        self.assertTrue(lead_written)


class PushSeenEntryToTursoTests(unittest.TestCase):
    def test_writes_and_marks_pushed_on_success(self):
        conn = FakeConnection({7: (False, False)})
        entry = {
            "song_id": 7,
            "rhythm": {"difficulty_score": 42.5},
            "lead": {"difficulty_score": 78.3},
            "turso_pushed": False,
        }

        result = push_seen_entry_to_turso(conn, entry, "song.gp")

        self.assertTrue(result)
        self.assertTrue(entry["turso_pushed"])
        self.assertEqual(conn.commits, 1)

    def test_noop_for_unmatched_file(self):
        conn = FakeConnection({})
        entry = {"song_id": None, "rhythm": {"difficulty_score": 42.5}, "lead": None}

        result = push_seen_entry_to_turso(conn, entry, "song.gp")

        self.assertFalse(result)
        self.assertEqual(conn.queries, [])

    def test_noop_when_already_pushed(self):
        conn = FakeConnection({7: (False, False)})
        entry = {
            "song_id": 7,
            "rhythm": {"difficulty_score": 42.5},
            "lead": None,
            "turso_pushed": True,
        }

        result = push_seen_entry_to_turso(conn, entry, "song.gp")

        self.assertFalse(result)
        self.assertEqual(conn.queries, [])

    def test_noop_when_no_aspects_to_write(self):
        conn = FakeConnection({7: (False, False)})
        entry = {"song_id": 7, "rhythm": None, "lead": None, "turso_pushed": False}

        result = push_seen_entry_to_turso(conn, entry, "song.gp")

        self.assertFalse(result)
        self.assertEqual(conn.queries, [])

    def test_leaves_pushed_false_when_write_raises(self):
        class RaisingConnection(FakeConnection):
            def cursor(self):
                raise RuntimeError("network error")

        conn = RaisingConnection({7: (False, False)})
        entry = {
            "song_id": 7,
            "rhythm": {"difficulty_score": 42.5},
            "lead": None,
            "turso_pushed": False,
        }

        result = push_seen_entry_to_turso(conn, entry, "song.gp")

        self.assertFalse(result)
        self.assertFalse(entry["turso_pushed"])


if __name__ == "__main__":
    unittest.main()
