//! Named tunings. Pitches are MIDI numbers from string 1 (the highest) down.

use serde::Serialize;

use super::model::Instrument;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Tuning {
    pub id: &'static str,
    pub name: &'static str,
    pub instrument: Instrument,
    pub strings: &'static [u8],
}

pub const TUNINGS: &[Tuning] = &[
    Tuning { id: "standard", name: "Standard 6-string (E A D G B E)", instrument: Instrument::Guitar, strings: &[64, 59, 55, 50, 45, 40] },
    Tuning { id: "eb-standard", name: "Eb/D# standard (D# G# C# F# A# D#)", instrument: Instrument::Guitar, strings: &[63, 58, 54, 49, 44, 39] },
    Tuning { id: "d-standard", name: "D standard (D G C F A D)", instrument: Instrument::Guitar, strings: &[62, 57, 53, 48, 43, 38] },
    Tuning { id: "cs-standard", name: "C# standard (C# F# B E G# C#)", instrument: Instrument::Guitar, strings: &[61, 56, 52, 47, 42, 37] },
    Tuning { id: "c-standard", name: "C standard (C F A# D# G C)", instrument: Instrument::Guitar, strings: &[60, 55, 51, 46, 41, 36] },
    Tuning { id: "b-standard", name: "B standard (B E A D F# B)", instrument: Instrument::Guitar, strings: &[59, 54, 50, 45, 40, 35] },
    Tuning { id: "as-standard", name: "A# standard (A# D# G# C# F A#)", instrument: Instrument::Guitar, strings: &[58, 53, 49, 44, 39, 34] },
    Tuning { id: "a-standard", name: "A standard (A D G C E A)", instrument: Instrument::Guitar, strings: &[57, 52, 48, 43, 38, 33] },
    Tuning { id: "drop-d", name: "Drop D (D A D G B E)", instrument: Instrument::Guitar, strings: &[64, 59, 55, 50, 45, 38] },
    Tuning { id: "drop-cs", name: "Drop C# (C# G# C# F# A# D#)", instrument: Instrument::Guitar, strings: &[63, 58, 54, 49, 44, 37] },
    Tuning { id: "drop-c", name: "Drop C (C G C F A D)", instrument: Instrument::Guitar, strings: &[62, 57, 53, 48, 43, 36] },
    Tuning { id: "drop-b", name: "Drop B (B F# B E G# C#)", instrument: Instrument::Guitar, strings: &[61, 56, 52, 47, 42, 35] },
    Tuning { id: "open-g", name: "Open G (D G D G B D)", instrument: Instrument::Guitar, strings: &[62, 59, 55, 50, 43, 38] },
    Tuning { id: "dadgad", name: "DADGAD (D A D G A D)", instrument: Instrument::Guitar, strings: &[62, 57, 55, 50, 45, 38] },
    Tuning { id: "bass-standard", name: "Standard 4-string bass (E A D G)", instrument: Instrument::Bass, strings: &[43, 38, 33, 28] },
    Tuning { id: "bass-drop-d", name: "Drop D bass (D A D G)", instrument: Instrument::Bass, strings: &[43, 38, 33, 26] },
    Tuning { id: "bass-d-standard", name: "D standard bass (D G C F)", instrument: Instrument::Bass, strings: &[41, 36, 31, 26] },
    Tuning { id: "bass-5", name: "Standard 5-string bass (B E A D G)", instrument: Instrument::Bass, strings: &[43, 38, 33, 28, 23] },
    Tuning { id: "drums", name: "Drum kit", instrument: Instrument::Drums, strings: &[49, 42, 38, 45, 36] },
];

pub fn find(id: &str) -> Option<&'static Tuning> {
    TUNINGS.iter().find(|t| t.id == id)
}
