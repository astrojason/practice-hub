## Bugs

## Features
- [ ] Enable opening resources for editing (section information), without being in a session.

## Enhancements

- [ ] Sync a region's bpm to the backend SongSection (needs a `practice.astrojason.com` migration + API field), so it survives clearing local storage / syncs across devices for songs. Exercises/study materials already persist region bpm locally via the player preset — no backend concept exists for their sections at all.

### Ratings & Difficulty Engine — Phase 2 (all auto-population of difficulty)

- [ ] Computed score is calibrated against the user's own demonstrated proficiency (inferred from their rating history on other technically-analyzed songs), not just raw note-density from the tab. The per-aspect skill estimate this needs already exists on the backend — `User.rhythm_skill`/`lead_skill`/`singing_skill` (practice.astrojason.com's `core/models_turso.py`), computed nightly by `compute_user_skill()` (`api/generator.py`) via `core/skill_stats.py`'s `compute_skill_estimate()` — but that function is a documented no-op until canonical `song.rhythm_difficulty`/`lead_difficulty` exists broadly. Per `PLAN.md`'s Step 1, applying that skill estimate to calibrate the displayed score still needs its own confirmed design (a re-scoping checkpoint, not a ready-to-build spec) before implementation starts.

### Section-level aspect ratings — Phase 3

- [ ] Rate rhythm/lead/singing specifically within a song's sections, not just the whole song. Blocked on `SongSection` data coverage — very few songs currently have sections broken out.
