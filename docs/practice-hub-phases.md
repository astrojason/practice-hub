# practice-hub — Build Phases

_This document is the instruction set for Claude Code. The full feature specification is in SPEC.md. Read both before starting any phase._

---

## Ground Rules for Every Phase

- Read SPEC.md before starting work
- Read the Instrumenta repo for any API route, data shape, or auth pattern before implementing anything that touches them — do not guess
- Each phase must be independently runnable before moving to the next
- Do not implement features beyond the current phase scope
- Mac only (Tauri target: `aarch64-apple-darwin` + `x86_64-apple-darwin` universal binary)

---

## Phase 1 — Project Scaffold + Auth + API Client

**Goal:** Empty repo → running Tauri app shell that can authenticate and make an authenticated API call to Instrumenta.

### Tasks

1. Initialize the repo:
   - Tauri 2 + React + TypeScript (Vite)
   - Copy SPEC.md into `docs/`
   - Configure for Mac universal binary target

2. Firebase Auth (Tauri):
   - On first launch, open the system browser to the Firebase Google OAuth flow
   - Listen on a local redirect URI for the token callback
   - Store the Firebase ID token securely (Tauri's secure storage)
   - Refresh token silently on subsequent launches
   - Reference Instrumenta's Firebase config and auth setup for provider/project details

3. Instrumenta API client (`src/api/`):
   - Typed TypeScript wrappers for every endpoint practice-hub will call
   - Read Instrumenta's `api/` routes to get exact paths, request shapes, and response shapes — do not infer
   - All requests attach the Firebase ID token as a Bearer header (matching Instrumenta's auth middleware)
   - Endpoints needed in Phase 1: dashboard endpoint, user settings

4. Basic app shell:
   - Authenticated state: show placeholder session view
   - Unauthenticated state: show sign-in screen with Google login button
   - Loading state between auth check and dashboard load

### Done When
- App launches on Mac
- Google sign-in works end-to-end
- Authenticated API call to Instrumenta dashboard endpoint succeeds and logs the response

---

## Phase 2 — Session View (Core)

**Goal:** The full session view with all four item groups, per-item logging, and the session timer.

### Tasks

1. Load today's dashboard data from Instrumenta API:
   - Exercises (from `user_entity`)
   - Study Materials (from `user_entity`)
   - Project playlist songs
   - Repertoire Review list
   - Today's existing session logs (to initialize timer and completion state)

2. Session timer:
   - Initialize from sum of all session log durations for today (fetched from API on load)
   - Runs as elapsed time from app open, added to already-logged time
   - Read Instrumenta's daily goal progress logic in `core/utils.py` — match the timezone handling exactly

3. Per-item cards for all four groups:
   - Completed state (at least one log exists for today)
   - Active state (timer running)
   - Idle state
   - Per-item timer (manual start/stop)

4. Session log forms:
   - **Song:** Focus, Rhythm/Lead/Singing checkboxes (new fields), BPM, Rating, From memory, Duration (editable, pre-filled from timer), Notes
   - **Exercise:** BPM, Rating, Duration (editable), Notes. Child exercises grouped under parent. Respect user settings (Randomize sub-exercises, Use keys, Use scales)
   - **Study Material:** Rating, Duration (editable), Notes
   - POST to existing Instrumenta endpoints on submit
   - Recalculate total daily time from API response after every submission

5. Visual state shifts:
   - Time goal reached → confetti animation + progress bar fill
   - All suggested items completed → distinct animation + completion banner
   - Both are independent; neither locks the UI

6. Rebuild button → calls Instrumenta's existing rebuild endpoint

### Done When
- All four groups load and display correctly
- Per-item logging posts successfully to Instrumenta and data appears in Instrumenta's History
- Timer initializes from prior logged time and recalculates on submission
- Both visual state shifts fire correctly

---

## Phase 3 — Quick Add + Open Session

**Goal:** Surface overdue items and allow adding anything from the catalog mid-session. Support open/unstructured sessions.

### Tasks

1. Quick Add:
   - Fetch overdue songs from Instrumenta API (songs past `max_days_no_review`)
   - Fetch full catalog (songs, exercises, study materials) filtered to exclude items already in today's groups
   - Order candidates: items sharing technique or genre tags with today's project songs and exercises first
   - Added items append to the appropriate group in the session view, marked as user-added (not suggested)

2. Open Session:
   - Accessible from the session view at any time
   - Log fields: Duration (editable), Notes
   - POST to Instrumenta's existing open session endpoint
   - Duration counts toward daily goal total (recalculate from API on submit)

### Done When
- Quick Add surfaces overdue items first, correctly ordered by tag overlap
- Added items log successfully and appear in Instrumenta History
- Open session logs correctly and affects daily goal progress

---

## Phase 4 — Integrated Media Player + Metronome

**Goal:** Local file resources open in an in-app player. External resources open in the browser. Metronome available at all times.

### Tasks

1. Resource link handling:
   - Detect resource type on click: `local_file` → in-app player, all others → system browser (`tauri::api::shell::open`)
   - Read Instrumenta's resource model to confirm all resource types (`url`, `local_file`, `youtube`, `guitar_pro`)

2. In-app player panel:
   - Audio playback (mp3, wav, flac, m4a)
   - Video playback (mp4, mov)
   - Variable speed control (0.25x – 2.0x)
   - Loop controls: set start/end points on a waveform/timeline scrubber
   - Reference `practice-player` repo for audio timing and loop implementation patterns
   - Reference `video-player` repo for video playback and metronome implementation

3. Metronome:
   - BPM control (tap tempo + manual entry)
   - Time signature selector
   - Visual beat indicator + audio click
   - Available as a standalone panel independent of the player (usable without a loaded file)
   - Port metronome logic from `video-player`

4. Player state:
   - Player panel opens inline within the session view, does not replace it
   - Current item context shown in the player header

### Done When
- External links open in the browser
- Local audio and video files play in the app with speed and loop controls
- Metronome works independently
- Playwright E2E test for player open/close (reference `video-player` test patterns)

---

## Phase 5 — Reporting + AI Chat

**Goal:** Per-entity rating reports, practice time report, and the scoped OpenAI chat.

### Tasks

1. Per-entity rating report:
   - Fetch session log history for a song/exercise/study material from Instrumenta API
   - Render as a rating trend chart over time
   - Show average rating
   - Struggling item indicator: if last 3+ sessions rated Awful or Bad, highlight the chat button (pulsing indicator)

2. Practice time report:
   - Fetch all session logs for the user from Instrumenta API
   - Total time by day / week / month (charts)
   - Streak tracking
   - Breakdown by item type

3. Scoped AI chat:
   - OpenAI API key stored in Tauri secure storage (user provides on first launch)
   - System prompt scopes the model to the entity and the user's practice data — will not engage off-topic
   - Context injected per session (see SPEC.md — Scoped AI Chat section for full context list)
   - Chat button always visible on every item card; highlighted when struggling threshold is met
   - Chat opens as a panel within the session view
   - No persistence — chat resets on close

### Done When
- Rating trend chart renders correctly for a song with multiple historical sessions
- Struggling item indicator fires correctly after 3+ Awful/Bad sessions
- Practice time report shows accurate totals matching Instrumenta's History data
- Chat opens, sends context, and receives a relevant response
- Chat will not engage with off-topic prompts (test with an unrelated question)

---

## Phase 6 — Guitar Difficulty Pipeline (Instrumenta backend addition)

_Note: This phase modifies the Instrumenta repo, not practice-hub._

**Goal:** Guitar Pro file analysis integrated into Instrumenta. Difficulty scores stored on Song records. Stretch pick added to weekly To Learn generation.

### Tasks

1. Port `experiments/guitar-difficulty` into Instrumenta:
   - Create `core/difficulty.py` (or equivalent module)
   - Read the existing `guitar-difficulty` codebase fully before porting — preserve scoring logic exactly
   - Fix the known scoring bug documented in the roadmap before integrating

2. Trigger on Guitar Pro resource upload:
   - When a resource of type `guitar_pro` is saved for a song, run the difficulty pipeline
   - Store the result as `difficulty_score` on the Song entity (additive field)

3. Weekly To Learn generation — stretch pick:
   - After existing generation logic in `api/generator.py`, identify the stretch pick candidate
   - Candidate: song from the To Learn playlist with difficulty score meaningfully above the user's current average project song difficulty
   - Set `stretch_pick = true` on that `UserSongList` record (additive field)
   - If no GP files exist yet (no difficulty scores), skip the stretch pick gracefully

4. Instrumenta web UI updates (minimal):
   - Display `difficulty_score` on song detail page when present
   - Visually distinguish the stretch pick on the Recommended To Learn dashboard tab

### Done When
- Uploading a GP file to a song computes and stores a difficulty score
- Weekly generation correctly flags one stretch pick
- Stretch pick is visually distinct on the Instrumenta dashboard
- Existing generator tests still pass

---

## Suggested Handoff to Claude Code

Start each phase with this prompt pattern:

> "We are building practice-hub, a Tauri desktop companion to Instrumenta. Read docs/SPEC.md in this repo and the full Instrumenta repo before starting. We are on Phase N. Here are the goals and tasks for this phase: [paste phase section]. Do not implement anything outside this phase. Ask me before making any assumptions about Instrumenta's API shape — read the source."
