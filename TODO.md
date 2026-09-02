## Bugs

## Features

## Enhancements

### Ratings & Difficulty Engine — Phase 2 (all auto-population of difficulty)

- [ ] The automated nightly path doesn't actually reach the DB yet: `scripts/nightly_gp_scan.py` is read-only (it only refreshes the local `tauri-plugin-store` cache — see its own docstring), and `write_song_difficulty.py` (the direct Turso writer, which does respect the manual-lock flags) is only invoked from the manual "push" button in `GpLibraryView.tsx`. Until the nightly script calls the writer itself, GP-computed difficulty never reaches `song.rhythm_difficulty`/`lead_difficulty` unattended — someone still has to open the app and click Confirm, which defeats the point of the launchd job.
- [ ] Computed score is calibrated against the user's own demonstrated proficiency (inferred from their rating history on other technically-analyzed songs), not just raw note-density from the tab. The per-aspect skill estimate this needs already exists on the backend — `User.rhythm_skill`/`lead_skill`/`singing_skill` (practice.astrojason.com's `core/models_turso.py`), computed nightly by `compute_user_skill()` (`api/generator.py`) via `core/skill_stats.py`'s `compute_skill_estimate()` — but that function is a documented no-op until canonical `song.rhythm_difficulty`/`lead_difficulty` exists broadly, which in turn needs the nightly-write gap above closed first. Per `PLAN.md`'s Step 1, applying that skill estimate to calibrate the displayed score still needs its own confirmed design (a re-scoping checkpoint, not a ready-to-build spec) before implementation starts.

### Section-level aspect ratings — Phase 3

- [ ] Rate rhythm/lead/singing specifically within a song's sections, not just the whole song. Blocked on `SongSection` data coverage — very few songs currently have sections broken out.
