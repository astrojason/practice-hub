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

## Step 1 — Manual-flag suppression in `nightly_gp_scan.py`

**TODO.md item:** *"`scripts/nightly_gp_scan.py` doesn't yet suppress
rhythm/lead for songs already locked as canonical... just needs the
`rhythm_difficulty_manual`/`lead_difficulty_manual` check added, matching what
`useGpScanner.ts` already does."*

This is now purely a display-suppression fix for the nightly script's local
cache (the script still doesn't write anywhere — the completed write-back is an
in-app-only action for now, since the nightly script running unattended has
no interactive confirmation step; don't fold Turso *writes* into the nightly
script as part of this plan). Implementation:

1. In `get_song_catalog()` (`scripts/nightly_gp_scan.py`), extend the `SELECT`
   to also pull `song.rhythm_difficulty_manual, song.lead_difficulty_manual`,
   and include them in each catalog entry dict.
2. In `main()`'s per-file loop, after `analyze_file()` returns `rhythm`/`lead`
   and a `song` match was found, null out `rhythm` when
   `song["rhythm_difficulty_manual"]` is truthy and `lead` when
   `song["lead_difficulty_manual"]` is truthy — mirroring
   `suppressManualAspects()` in `useGpScanner.ts` exactly (same precedence:
   suppression only applies when there's a matched song; unmatched files are
   unaffected).
3. Update the misleading docstring on `analyze_file()` (currently says this
   script "does not yet suppress rhythm/lead... tracked as a follow-up in
   TODO.md") to reflect the fix.

### Tests

`nightly_gp_scan.py` has no existing automated test coverage (it's invoked
via launchd/manually, not through Playwright, and isn't part of `npm run
test:e2e`). Since CLAUDE.md's TDD mandate is scoped to Playwright tests under
`tests/` for behavior reachable from the app, and this script is a standalone
CLI with its own concerns:
- Add a small `scripts/test_nightly_gp_scan.py` (plain `unittest`, no pytest
  dependency assumed unless one already exists — check
  `requirements.txt`/imports first) covering the new suppression logic as a
  pure function extracted from `main()` — e.g. factor the "should this aspect
  be suppressed" check into a standalone `suppress_manual(rhythm, lead, song)`
  function so it's unit-testable without a live Turso connection, matching
  how `parse_filename`/`compute_raw_fingerprint`/`dedupe` are already
  standalone functions in this file.
- This doesn't replace the Playwright-first workflow for anything reachable
  from the React app — it's additive because this fix lives entirely outside
  the app.

---

## Step 2 — Unattended overnight execution via launchd

**TODO.md item:** *"True unattended overnight execution via macOS launchd —
opt-in settings toggle installs/removes the launchd agent; not just 'run on
next app open.'"*

There is currently no in-app Settings view — this step creates one.

1. **launchd plist template**: `src-tauri/sidecar/com.astrojason.practicehub.nightly-gp-scan.plist`
   (or generate it in Rust as a string — a static template file is simpler to
   review/edit). Should invoke
   `~/Projects/astrojason/practice.astrojason.com/.venv/bin/python3
   <resolved-scripts-dir>/nightly_gp_scan.py --env production`, run on a
   `StartCalendarInterval` (pick a late-night hour, e.g. 3am — expose it as a
   fixed default, not a user-configurable schedule unless asked), with
   `StandardOutPath`/`StandardErrorPath` pointed at a log file under
   `~/Library/Logs/practice-hub/nightly-gp-scan.log` so failures are
   inspectable.
   - Note `scripts/nightly_gp_scan.py` resolves `ANALYZE_SIDECAR` relative to
     its own file location (`Path(__file__).resolve().parent.parent /
     "src-tauri/sidecar/analyze_gp.py"`) — the plist must invoke the script
     from its real repo path (`~/Projects/astrojason/practice-hub/scripts/nightly_gp_scan.py`),
     not a copied/bundled location, or that relative resolution breaks.

2. **Two new Tauri commands** in `lib.rs`:
   - `install_launchd_agent(app) -> Result<(), String>`: writes the plist
     (with the real repo path substituted in) to
     `~/Library/LaunchAgents/com.astrojason.practicehub.nightly-gp-scan.plist`,
     then runs `launchctl load -w <path>`.
   - `uninstall_launchd_agent() -> Result<(), String>`: runs `launchctl
     unload -w <path>` then removes the plist file. Tolerate "already
     unloaded"/file-not-found as a non-error (idempotent toggle-off).
   - Both surface real stderr/error text on failure — same rule as everywhere
     else in this codebase.
   - Consider a third `is_launchd_agent_installed() -> Result<bool, String>`
     (checks file existence, or `launchctl list | grep`) so the Settings
     toggle reflects real state on load rather than trusting local store
     state that could drift (e.g. user manually removed the plist).

3. **New Settings UI**: there's no existing Settings component — add
   `src/components/SettingsView.tsx` (or fold the toggle into
   `GpLibraryView.tsx`'s settings bar if a full Settings view feels like
   overreach for one toggle — your call, but a dedicated view scales better
   if more toggles get added later). Needs:
   - A checkbox/switch: "Run nightly scan automatically (launchd)".
   - On enable: call `install_launchd_agent`; on disable: call
     `uninstall_launchd_agent`. Reflect actual failures via `ErrorModal`.
   - On mount, call `is_launchd_agent_installed` (if implemented) to set the
     toggle's initial state from ground truth, not cached preference.
   - Persist the user's intent in the `gp-library` store too (e.g.
     `launchdEnabled: boolean`) purely for UI responsiveness — ground truth
     stays the actual plist/launchctl state.

### Tests

`tests/settings-launchd-toggle.spec.ts` (or add to an existing settings spec
if one gets created for other reasons first):
- Toggling on invokes `install_launchd_agent`; toggling off invokes
  `uninstall_launchd_agent`.
- A rejected install/uninstall call surfaces via `ErrorModal` with the actual
  error text and the toggle visually reverts to its prior state (don't leave
  the UI claiming "enabled" when the install call failed).
- Initial toggle state on mount reflects what `is_launchd_agent_installed`
  returns, not a locally-cached guess.

---

## Step 3 — Proficiency-calibrated scoring (proposed design — confirm before building)

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

Steps 1 → 2 are independent of each other and can be done in either order,
but are listed in priority order. Step 3 comes last and is a re-scoping
checkpoint, not a ready-to-build spec.

Remove each of the two TODO.md bullets (Steps 1–2) from `TODO.md` in the
commit that lands it. Leave the Step 3 bullet in TODO.md until it has its own
confirmed plan — don't remove it as part of this work.
