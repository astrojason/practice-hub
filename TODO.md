## Bugs

- [ ] Check a tab saved by the tab editor (`<name> (edited).gp`) opens correctly in the real Guitar Pro 7/8 app. The writer (`src-tauri/src/tab/gpwrite.rs`) only round-trips through this app's own reader; it has not been opened in Guitar Pro itself.

## Features

- [ ] Undo for all player actions, not just region edits: region create/update/delete, region settings (tempo, etc.), and any other state-changing action in the player. Motivated by the region-update bug above, but should cover every case. History is scoped to the current resource and session: ending the session or switching to a different resource clears the undo stack (in-memory only, nothing persisted).

### Fretboard Trainer (port of the Craft "visual scale, arpeggio, chord" app)

Source: `/Users/jasonsylvester/Documents/Craft Anything/a-visual-scale-arpeggio-chord` (Rust/egui; `app/src/help.rs` lists every feature). Port the features, **not** the UI: everything must use this app's own styling/components (overlay view like Browse, `btn-*` classes, `ErrorModal`, `ConfirmModal`). Audio is Web Audio in the webview (no new Rust audio engine). Starting any practice item in the trainer (first Play of a routine, a speed-trainer session, a quiz) starts the app's **Open Session** timer with pre-filled notes describing what is being practised (key, scale, position, tempo…). Do the phases in order; remove each when committed.

- [ ] Phase 7 — Speed trainer: setup, timed rounds with rests, session strip, saved log and trend chart.
- [ ] Phase 8 — Quiz: note/degree/interval/hear-interval/chord-quality quizzes, timing, keyboard answers, both-note-names, history, report, weak spots (badges on neck, panel, focus mode), clear history with confirm, fret limits.
- [ ] Phase 9 — Voice: spoken call-outs (speechSynthesis) and answering quizzes out loud (needs speech recognition working in the Tauri webview; may need a Rust helper).
- [ ] Phase 10 — Fretboard Trainer help topics in the in-app help.

## Enhancements

- [ ] Standard notation (tab player): no key signatures (accidentals are always sharps), ties and slurs aren't drawn, beams are flat and aren't carried across rests, and it isn't shown while editing a standard-only view (the editor switches to tab + standard).
- [ ] Tab editor: it edits notes, note values, dots, rests, beats and bars only. Still missing from Tabline-style editing: tuplets and triplets, ties, chord names, section markers, time-signature and tempo changes, and adding/removing tracks. Saving always makes a new `(edited)` copy; it never updates a previous copy or the original.
- [ ] Tab player: YouTube links can't be used as the backing recording (only local audio/video files); the tab editor's saved copy keeps only notes, rhythm, ties, chord names, markers, time signatures, tempo and tunings (no effects, dynamics or layout).

- [ ] Sync a region's bpm to the backend SongSection (needs a `practice.astrojason.com` migration + API field), so it survives clearing local storage / syncs across devices for songs. Exercises/study materials already persist region bpm locally via the player preset — no backend concept exists for their sections at all.

### Ratings & Difficulty Engine — Phase 2 (all auto-population of difficulty)

- [ ] Computed score is calibrated against the user's own demonstrated proficiency (inferred from their rating history on other technically-analyzed songs), not just raw note-density from the tab. The per-aspect skill estimate this needs already exists on the backend — `User.rhythm_skill`/`lead_skill`/`singing_skill` (practice.astrojason.com's `core/models_turso.py`), computed nightly by `compute_user_skill()` (`api/generator.py`) via `core/skill_stats.py`'s `compute_skill_estimate()` — but that function is a documented no-op until canonical `song.rhythm_difficulty`/`lead_difficulty` exists broadly. Per `PLAN.md`'s Step 1, applying that skill estimate to calibrate the displayed score still needs its own confirmed design (a re-scoping checkpoint, not a ready-to-build spec) before implementation starts.

### Section-level aspect ratings — Phase 3

- [ ] Rate rhythm/lead/singing specifically within a song's sections, not just the whole song. Blocked on `SongSection` data coverage — very few songs currently have sections broken out.
