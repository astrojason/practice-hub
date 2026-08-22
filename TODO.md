## Bugs

## Features

## Enhancements

### Ratings & Difficulty Engine — Phase 2 (all auto-population of difficulty)

- [ ] True unattended overnight execution via macOS launchd — opt-in settings toggle installs/removes the launchd agent; not just "run on next app open."
- [ ] Write computed `rhythm`/`lead` to `song.rhythm_difficulty`/`song.lead_difficulty` — the shared/canonical per-song values (Instrumenta moved these off `UserSongMeta`, which is now a purely personal per-user pick with no manual flag of its own). Per Instrumenta's own TODO.md, this should bypass the HTTP/Firebase-auth API entirely and write directly to Turso (plaintext local DB credential, matching today's `tauri-plugin-store` pattern for `rootPath`, and the direct-Turso-read pattern already used by `scripts/nightly_gp_scan.py`), skipping any aspect where `song.rhythm_difficulty_manual`/`lead_difficulty_manual` is already true (admin-locked via the website's "set as master" checkbox). Note: an earlier pass at this mistakenly pushed the computed value through the ordinary per-user `PUT /song/<id>` — under the current schema that endpoint writes to the user's personal `UserSongMeta.rhythm_difficulty` instead, so that approach was reverted before shipping. The in-app scanner already computes and displays rhythm/lead and suppresses them in the UI when `song.rhythm_difficulty_manual`/`lead_difficulty_manual` is set (`useGpScanner.ts`); only the actual write-to-DB step remains.
- [ ] `scripts/nightly_gp_scan.py` doesn't yet suppress rhythm/lead for songs already locked as canonical. Since the manual flags now live on `song` (which the script already reads directly from Turso) rather than the old per-user `UserSongMeta`, there's no longer an identity blocker here — just needs the `rhythm_difficulty_manual`/`lead_difficulty_manual` check added, matching what `useGpScanner.ts` already does via `GET /song/<id>`.
- [ ] Computed score is calibrated against the user's own demonstrated proficiency (inferred from their rating history on other technically-analyzed songs), not just raw note-density from the tab — see practice.astrojason.com/TODO.md for the full writeup.

### Section-level aspect ratings — Phase 3

- [ ] Rate rhythm/lead/singing specifically within a song's sections, not just the whole song. Blocked on `SongSection` data coverage — very few songs currently have sections broken out.