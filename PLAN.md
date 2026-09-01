# Ratings & Difficulty Engine — Phase 2 implementation plan

Handoff doc for Codex. This finishes the "Ratings & Difficulty Engine — Phase 2
(all auto-population of difficulty)" section of `TODO.md`. Read that section
first — this plan implements it item by item, in dependency order.

**Follow the repo's TDD workflow for every step** (see `CLAUDE.md`): write a
failing Playwright test first, then implement, then `npm run test:e2e`, then
`npm run build`. If a step touches `src-tauri/src/lib.rs`, also run
`npm run tauri build` (per `src-tauri/CLAUDE.md` — Rust errors don't show up
in `npm run build`). Remove each TODO.md bullet in the same commit that lands
its fix — never leave it "for reference." Bump `package.json` version on every
commit that touches non-CLAUDE.md files.

## Context you need before starting

- `song.rhythm_difficulty` / `song.lead_difficulty` (Instrumenta's
  `core/models_turso.py`) are the **shared, canonical** per-song values.
  `UserSongMeta.rhythm_difficulty` / `lead_difficulty` are a separate,
  purely-personal per-user pick with no manual flag — don't confuse the two.
- `song.rhythm_difficulty_manual` / `lead_difficulty_manual` (booleans) mark a
  value as admin-locked via Instrumenta's "set as master" checkbox. Once set,
  nothing computed may overwrite that aspect until an admin clears it.
- Instrumenta's HTTP `PUT /song/<id>` (`api/song.py:_build_song_master_difficulty`)
  only lets an **admin**, explicitly opting in via the manual flag, write
  `song.rhythm_difficulty`/`lead_difficulty`. There is deliberately no HTTP
  path for a computed value to reach the canonical field — an earlier attempt
  to route the computed score through this endpoint actually landed in
  `UserSongMeta.rhythm_difficulty` instead (the personal field) and was
  reverted. **Do not use the HTTP API for the computed write** — the direct
  Turso writer is now implemented.
- The in-app scanner (`src/hooks/useGpScanner.ts`, `src/components/GpLibraryView.tsx`)
  already computes rhythm/lead per file (via `src-tauri/sidecar/analyze_gp.py`,
  invoked from `src-tauri/src/lib.rs:analyze_gp_file`) and already suppresses
  display of an aspect when `song.rhythm_difficulty_manual`/`lead_difficulty_manual`
  is set (`suppressManualAspects` in `useGpScanner.ts`). The direct write-to-DB
  path is now implemented too.
- `scripts/nightly_gp_scan.py` mirrors the in-app scanner so it can run
  headless via a scheduled job. It reads the Instrumenta song catalog directly
  from Turso via `libsql_experimental`, using credentials from
  `~/Projects/astrojason/practice.astrojason.com/.env.{development,production}`.
  It is read-only today — it only writes to the local `tauri-plugin-store`
  cache file, never to Turso or Instrumenta.
- Existing Playwright mock pattern for Tauri IPC + `tauri-plugin-store`: see
  `tests/gp-library-rhythm-lead-difficulty.spec.ts`'s `setupPage()` —
  `window.__TAURI_INTERNALS__.invoke` is monkey-patched per test to fake
  `plugin:store|*` calls and any `analyze_gp_file`/custom `invoke()` calls.
  Reuse this pattern for every new Tauri command introduced below.

---

## Step 1 — Proficiency-calibrated scoring (proposed design — confirm before building)

**TODO.md item:** *"Computed score is calibrated against the user's own
demonstrated proficiency (inferred from their rating history on other
technically-analyzed songs), not just raw note-density from the tab."* Full
writeup referenced at `practice.astrojason.com/TODO.md`, which adds: the
calibration must be **per-aspect** (rhythm/lead/singing), mirroring the
existing `UserSongMeta.rhythm_difficulty`/`lead_difficulty`/`singing_difficulty`
split — not a single blended number.

This item is materially more open-ended than the preceding implementation
steps (it's a statistical design problem, not a wiring job) and depends on
the direct Turso writer having shipped — there's no point calibrating a score
you can't yet persist. **Treat this as its own follow-up plan once the
preceding work is live and you have real rhythm/lead data flowing**, rather
than speccing the algorithm sight-unseen here. Sketch
of the shape, for whoever picks it up:

- Input: for the current user, their `UserSongMeta.rhythm_difficulty` (their
  own *rating*, i.e. how hard they personally found it) paired with that
  song's `song.rhythm_difficulty` (the raw computed/canonical score) across
  every song they've rated, per aspect.
- Goal: fit a per-user, per-aspect offset/scale (e.g. "this user rates
  technically-dense songs consistently easier than the raw score implies —
  shift future raw rhythm scores down for them specifically") and apply it
  when *displaying* a computed score to that user, without mutating the
  canonical `song.rhythm_difficulty` (which stays the shared, uncalibrated
  value other users still see).
- Needs a minimum-sample-size guard (don't calibrate off 1–2 data points) and
  a place to surface the calibrated number distinctly from the raw one in the
  UI — neither exists yet.
- Do not start implementation on this step without re-confirming scope and
  the exact statistical approach — this plan intentionally stops short of
  prescribing one.

---

## Order of work

Step 1 is a re-scoping checkpoint, not a ready-to-build spec.

Leave the Step 1 bullet in TODO.md until it has its own confirmed plan.
