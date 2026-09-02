import tempfile
import unittest
from pathlib import Path

from nightly_gp_scan import _applescript_string, _notify_command, suppress_manual


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


if __name__ == "__main__":
    unittest.main()
