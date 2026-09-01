import unittest

from nightly_gp_scan import suppress_manual


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


if __name__ == "__main__":
    unittest.main()
