## Bugs

- [ ] 24 Playwright tests fail on Chromium (also on `main` before the AI-challenges change): clicking `.item-group-header` for the Exercises group times out ("element is visible, enabled and stable" but the click never lands), in item-usage-staleness, parent-total-practice-time, session-view-alphabetical, skip-auto-completes-parent, media-player-child-title-timer, rebuild-blocked-during-sequential and sequential-start-no-incomplete-children specs. Something is likely intercepting pointer events over the group header.
- [ ] More Chromium Playwright failures present on `main` as of 2.37.0, not covered above: gp-library-fast-path, gp-library-rhythm-lead-difficulty, gp-library-scan-cache, gp-library-turso-write, gp-library-undated-resource, gp-list-sort and item-streak specs (25 tests). Not yet investigated.

## Features

- [ ] Undo for all player actions, not just region edits: region create/update/delete, region settings (tempo, etc.), and any other state-changing action in the player. Motivated by the region-update bug above, but should cover every case. History is scoped to the current resource and session: ending the session or switching to a different resource clears the undo stack (in-memory only, nothing persisted).

## Enhancements

- [ ] Sync a region's bpm to the backend SongSection (needs a `practice.astrojason.com` migration + API field), so it survives clearing local storage / syncs across devices for songs. Exercises/study materials already persist region bpm locally via the player preset — no backend concept exists for their sections at all.

### Ratings & Difficulty Engine — Phase 2 (all auto-population of difficulty)

- [ ] Computed score is calibrated against the user's own demonstrated proficiency (inferred from their rating history on other technically-analyzed songs), not just raw note-density from the tab. The per-aspect skill estimate this needs already exists on the backend — `User.rhythm_skill`/`lead_skill`/`singing_skill` (practice.astrojason.com's `core/models_turso.py`), computed nightly by `compute_user_skill()` (`api/generator.py`) via `core/skill_stats.py`'s `compute_skill_estimate()` — but that function is a documented no-op until canonical `song.rhythm_difficulty`/`lead_difficulty` exists broadly. Per `PLAN.md`'s Step 1, applying that skill estimate to calibrate the displayed score still needs its own confirmed design (a re-scoping checkpoint, not a ready-to-build spec) before implementation starts.

### Section-level aspect ratings — Phase 3

- [ ] Rate rhythm/lead/singing specifically within a song's sections, not just the whole song. Blocked on `SongSection` data coverage — very few songs currently have sections broken out.
