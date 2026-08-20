## Bugs

- [ ] Audio "Skip forward/back" (`jumpByPercent` → `audioActions.seek` → engine restart while playing) doesn't register at all under WebKit — confirmed via the new `webkit` Playwright project; `tests/media-player-region-sequence.spec.ts` is skipped on WebKit until this is fixed. Doesn't affect the video seek path.

## Features

## Enhancements

### Ratings & Difficulty Engine — Phase 2 (all auto-population of difficulty)

- [ ] Nightly Guitar Pro tab analysis job (reuses the existing `useGpScanner`/`analyze_gp_file` pipeline) computing rhythm/lead difficulty from separate GP tracks — no vocal-track equivalent, singing stays manual-only.
- [ ] True unattended overnight execution via macOS launchd — opt-in settings toggle installs/removes the launchd agent; not just "run on next app open."
- [ ] Headless run writes `rhythm_difficulty`/`lead_difficulty` directly to the DB (bypassing the HTTP/Firebase-auth API), skipping any aspect flagged `rhythm_difficulty_manual`/`lead_difficulty_manual`.
- [ ] Computed score is calibrated against the user's own demonstrated proficiency (inferred from their rating history on other technically-analyzed songs), not just raw note-density from the tab — see practice.astrojason.com/TODO.md for the full writeup.

### Section-level aspect ratings — Phase 3

- [ ] Rate rhythm/lead/singing specifically within a song's sections, not just the whole song. Blocked on `SongSection` data coverage — very few songs currently have sections broken out.