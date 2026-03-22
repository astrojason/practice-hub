# practice-hub — Architecture & Feature Specification

_Consolidates: practice.astrojason.com (Instrumenta) · practice-player · practice-tracker · practice-planner · video-player · guitar-difficulty_

---

## Overview

practice-hub is a **desktop companion app** to Instrumenta (practice.astrojason.com). It does not replace the web app — Instrumenta remains the web frontend unchanged except where explicitly noted below.

**Instrumenta (web)** — remains the source of truth. Catalog management, session history, playlist management, settings, recommendation engine, cron jobs. No architectural changes except the two additions noted in the Web App Changes section.

**practice-hub (Tauri desktop)** — the focused daily practice session interface. Talks to Instrumenta's existing API. Adds an integrated media player for local files with enhanced playback controls. This is the primary session surface when at the desktop.

---

## Tech Stack

| Layer | Technology |
|---|---|
| Backend | Instrumenta's existing Flask API (unchanged) |
| New API additions | Added as new routes in the existing Flask app |
| Desktop frontend | Tauri + React + TypeScript |
| AI (chat + weighting) | OpenAI API |
| Auth | Firebase Auth — Tauri opens the system browser for the Google OAuth flow, receives the token via a local redirect, and stores it for subsequent API calls |

No new backend, no new database, no migration. practice-hub is a consumer of the existing API.

---

## Data Model

The existing Instrumenta data model is used as-is. No new entities, no schema changes, except two additive changes to session logging.

### Existing Session Fields (Song)

| Field | Type | Notes |
|---|---|---|
| Focus | enum | Control, Clarity, Consistency, Musicality, Playthrough |
| BPM | number | Tempo practiced at |
| Rating | enum | Awful / Bad / Neutral / Good / Great |
| From memory | boolean | Played without reference material |
| Duration | number | Seconds (manually editable) |
| Notes | text | Free-form |

The existing Instrumenta data model is used as-is. All changes below are additive — no existing fields removed, no existing tables restructured.

### Additive Change 1 — Song Session: Playing Mode Checkboxes

Add three boolean fields to the song session log. These are non-exclusive — any combination is valid.

| Field | Type | Default |
|---|---|---|
| rhythm | boolean | false |
| lead | boolean | false |
| singing | boolean | false |

**Migration:** Additive column addition to the song session table. No existing data is affected. All three default to false on existing records.

### Additive Change 2 — Duration is Manually Editable

The duration field already exists. The desktop app surfaces it as an editable field (pre-filled from the timer) rather than a read-only computed value. No data model change required — this is a UI change only.

### Additive Change 3 — Difficulty Score on Song

A new `difficulty_score` field is added to the Song entity. Populated by the guitar difficulty pipeline when a Guitar Pro file is attached. Null when no GP file is present.

### Additive Change 4 — Stretch Pick Flag on UserSongList

A new boolean `stretch_pick` field is added to the `UserSongList` record for Recommended To Learn entries. Flags the one song per weekly generation selected as the difficulty stretch. Defaults to false on all existing records.

### No Changes To

- Exercise session fields (BPM, rating, duration, notes)
- Study material session fields (rating, duration, notes)
- The `user_entity` model — exercises and study materials surface on the dashboard via their presence in `user_entity`, not an active flag. The desktop app respects this exactly.
- Playlist system (Repertoire, To Learn, Project, Repertoire Review, Recommended To Learn are system lists; custom lists unchanged)
- Recommendation engine weights and logic

---

## Daily Practice Session (Desktop App)

### Opening the App

On launch, the desktop app loads today's dashboard state from Instrumenta's existing dashboard API endpoint. This gives the same data the web dashboard shows:

- Today's Repertoire Review list
- Project playlist songs
- User's exercises (from `user_entity`)
- User's study materials (from `user_entity`)
- Overdue songs

If the daily generation has not run yet (early morning edge case), the app shows a loading/pending state and polls until it resolves.

### Session View Layout

Items are presented in four groups, in this order:

1. **Exercises** — from `user_entity`, same as dashboard Exercises tab
2. **Study Materials** — from `user_entity`, same as dashboard Study Materials tab
3. **Project Songs** — from the Project system playlist
4. **Repertoire Review** — from today's generated Repertoire Review list

The user can jump to any item freely — order is a suggestion, not enforced.

A session timer runs from first interaction and tracks total elapsed practice time for the day. This feeds the same daily goal progress shown on the Instrumenta dashboard (circular progress indicator).

**Cross-surface timer accuracy:** The timer does not start from zero — on load it fetches all session logs for today from the API and initializes from the sum of logged durations. This ensures that time logged on the web app is reflected immediately when the desktop opens. After every session submission, both surfaces recalculate total daily time from the API response — so if the web app is open while a desktop session is submitted, the web app's next submission will calculate correctly against all prior logs from both surfaces.

### Completion State

An item is considered **completed for the day** if a session log exists for it for today. A second (or third) session on the same item is fully supported — the "completed" state just means at least one log exists. Multiple logs per item per day are valid and expected.

### Working an Item — Song

1. Start per-item timer (manual)
2. Stop timer when done
3. Log fields:
   - Focus (Control / Clarity / Consistency / Musicality / Playthrough)
   - **Playing mode checkboxes: Rhythm / Lead / Singing** _(new)_
   - BPM
   - Rating (Awful / Bad / Neutral / Good / Great)
   - From memory (checkbox)
   - Duration (pre-filled from timer, **manually editable**)
   - Notes (optional)
4. Submit → POST to existing `/user-song-session/` endpoint

### Working an Item — Exercise

Same flow as Instrumenta. Log: BPM, rating, duration (editable), notes.
POST to existing `/user-exercise-session/` endpoint.

Child exercises surface grouped under their parent, same as the dashboard. User-level exercise settings (Randomize sub-exercises, Use keys, Use scales) are respected and displayed per exercise, matching Instrumenta's behavior exactly.

### Working an Item — Study Material

Log: rating, duration (editable), notes.
POST to existing `/user-study-material-session/` endpoint.

### Open Session (Unstructured Practice)

An Open Session can be logged at any time from the session view — it does not require an item. Use case: noodling, jamming, or any practice that doesn't map to a specific catalog item.

Log fields: duration (editable), notes.
POST to the existing open session endpoint.

Open session time counts toward the daily goal progress total.

### Visual State Shifts

Two independent states. Neither ends the session.

| State | Trigger | Visual |
|---|---|---|
| **Time goal reached** | Session timer hits daily goal (from user settings) | Animated confetti burst; progress bar fills |
| **All suggested items completed** | Every item in all four groups has at least one session log for today | Distinct celebratory animation (different from confetti); visual flair on completion banner |

Both can be active simultaneously. Both are subtle — the session remains fully usable after either fires.

### Quick Add

A Quick Add control surfaces items not currently in today's plan. Candidates are drawn from:

- Overdue songs (from Instrumenta's Overdue tab — songs past `max_days_no_review`)
- Any song, exercise, or study material in the user's catalog not already in today's groups

Candidates are ordered to logically extend the day's focus: items sharing techniques or genre tags with today's project songs and exercises surface first. This ordering is computed by the same AI weighting logic used for repertoire review enrichment (see below).

Added items are logged normally. They do not alter the generated plan.

### Rebuild

Mirrors the Rebuild button on the Instrumenta dashboard. Calls the same endpoint. Regenerates today's recommendations (Repertoire Review list, To Learn shortlist, theory cards). Already-logged sessions are unaffected.

---

## Integrated Media Player (Desktop Only)

Accessible from any item that has a resource attached. Resources are opened as follows:

- **URL / YouTube / external link** → opens in the system default browser
- **Local file** → opens in the integrated in-app player

The player is a panel within the session view. It provides:

- Audio and video playback of local files
- Variable playback speed (slow down for learning difficult sections)
- Loop controls (set loop start/end points on a timeline)
- Metronome (BPM control, time signature, visual and audio beat)

---

## Repertoire Review — AI Similarity Enrichment

The existing repertoire review algorithm in `api/generator.py` is **not changed**. The existing weights are:

- `0.75` if last session rated Good
- `0.50` if last session rated Great
- `2.0` if learned within last 7 days
- `1.5` if last session rated below Neutral
- `2.0` if not reviewed in the last half-cycle
- `1.25` if not played from memory

A new **similarity weight multiplier** is added on top of these existing weights before the weighted random sampling step. It does not replace any existing weight — it compounds with them.

**Similarity weight logic (OpenAI API):**

- Songs that share technique tags with the user's current exercises receive a multiplier > 1.0 (e.g., working on legato exercises → legato repertoire songs rank higher)
- Songs that share genre/style tags with current Project songs receive a multiplier > 1.0 (e.g., "Heartbreaker" as a project song → blues rock repertoire songs surface more)
- Songs with neither tag overlap receive a multiplier of 1.0 (no change to existing weight)

This enrichment runs as part of the daily generation cron, after the existing weights are computed, before the final weighted sample is drawn. It is added as a new step in `api/generator.py`.

---

## To Learn Weekly Suggestions — Difficulty Enrichment

The existing To Learn generation runs every Monday and selects from the To Learn system playlist. Priority playlist seeding (e.g., "Lick Library") is unchanged.

A new **difficulty-based stretch pick** is added to the existing output:

- One song per weekly generation is flagged as the **stretch pick**
- Selected by the guitar difficulty pipeline: the candidate with the highest difficulty score that is meaningfully above the user's current average project song difficulty
- Clearly distinguished in the UI from the regular weekly suggestions

This is an additive field on the existing `UserSongList` record for the Recommended To Learn list. No structural change to the playlist system.

**Phase 2:** ML-based difficulty scoring may require changes to when/how this runs. Deferred.

---

## Guitar Difficulty Pipeline

Ported from `experiments/guitar-difficulty` into a shared module consumed by the Instrumenta backend.

When a Guitar Pro file is attached to a song as a resource, the pipeline analyzes it and computes a difficulty score stored on the Song record. Factors:

- Tempo
- Note density
- Position shifts / fret span
- Technique markers in the file (bends, hammer-ons, slides, etc.)

This score is used by:
1. The To Learn stretch pick selection
2. The scoped AI chat for suggesting adjacent songs (see below)

---

## Reporting

Both surfaces (web and desktop) expose these reports, backed by existing session log data.

### Practice Time Report

- Total practice time by day / week / month
- Streak tracking
- Breakdown by item type (exercise / song / study material)

### Per-Entity Session Rating Report

- Rating trend chart over time for any Song, Exercise, or Study Material
- Average rating displayed prominently
- Recent trend (last N sessions) used to drive the struggling item indicator

---

## Scoped AI Chat (Per Entity)

### Access

Every Song, Exercise, and Study Material has a chat button. It is always visible. When an item's last 3 or more sessions are rated Awful or Bad, the button is visually highlighted (pulsing indicator or color shift).

### Scope

The chat is powered by OpenAI. The system prompt restricts the model to the context of the entity and the user's practice data. It will not engage with off-topic requests.

### Context Injected Per Session

- Entity name, type, artist (if song)
- Technique tags, genre/style tags (if song)
- Difficulty score (if available)
- Recent session ratings and notes for this item
- All exercises in the user's catalog (active and inactive) with technique tags — inactive exercises are still relevant as targeted remediation
- All study materials in the user's catalog (active and inactive) with tags and parent references
- User's current Project songs and their tags
- To Learn playlist songs with difficulty scores (for adjacent song suggestions)

### Example Flow — Struggling with "Master of Puppets"

> **App:** I see you've been having a rough time with this one. What part is giving you trouble?

> **User:** I can't seem to get the rhythm up to speed.

> **App:** Have you tried using the player to slow it down to 60–70% and isolating the gallop pattern? Even a few minutes at reduced tempo can lock in the feel before pushing the BPM back up. You also have a "Berth Legato" exercise in your catalog and "Quick Licks - In The Style of Zakk Wylde" as a study material — both target the picking mechanics that drive this song.

> **User:** Yeah, what about something to work toward in the meantime?

> **App:** Based on difficulty and technique overlap, Disposable Heroes is a natural next step — similar tempo and rhythmic feel. From your To Learn list, Ace of Spades is a bit more forgiving on the rhythm but shares the aggressive picking attack.

### Chat Persistence

Chat history is not persisted. Each time the chat is opened it starts a fresh session. The injected context (session history, catalog data) ensures the model has full awareness of the user's practice history even without conversational memory.

---

## Web App Changes (Instrumenta)

Instrumenta's web frontend is modified only where necessary. Changes are additive.

### Changes

1. **Playing mode checkboxes on song session form** — add Rhythm / Lead / Singing checkboxes to the existing session logging UI. Displays in session history.
2. **Duration field editable** — make the duration input editable on the session form (currently read-only or auto-computed in some flows).
3. **Difficulty score display** — show computed difficulty score on song detail page when available.
4. **Stretch pick indicator** — visually distinguish the stretch pick on the Recommended To Learn dashboard tab.
5. **Per-entity rating report** — new view accessible from song/exercise/study material detail pages.
6. **Practice time report** — new page under History.
7. **AI chat button** — added to song/exercise/study material detail pages (same chat as desktop, same API).

### Not Changed

- Theory cards (Scale, Key Signature, Chord, Chord Progression, Interval) — present in Instrumenta web, not surfaced in the desktop app
- Recommendation engine logic (except the additive similarity weight)
- Dashboard layout and tabs
- Playlist management
- Catalog CRUD
- Auth flow
- Deployment

---

## Project Structure (New Repo)

```
practice-hub/
├── src-tauri/          # Tauri Rust backend (file access, local player)
├── src/
│   ├── components/     # React components
│   │   ├── session/    # Session view, item cards, timer
│   │   ├── player/     # Integrated media player + metronome
│   │   ├── chat/       # Scoped AI chat panel
│   │   └── reports/    # Rating trend charts, practice time charts
│   ├── api/            # Instrumenta API client (typed wrappers)
│   ├── hooks/          # Session state, timer, auth
│   └── main.tsx
├── tests/              # Playwright E2E tests
└── README.md
```

---

## Source Projects — Disposition

| Project | What carries over | Fate |
|---|---|---|
| `practice.astrojason.com` | Unchanged — remains web frontend | **Active, not archived** |
| `practice-tracker` | Zod validation patterns for any new API routes | Archive |
| `practice-player` | Audio playback, speed control, loop controls | Archive |
| `video-player` | Metronome, video playback, Playwright E2E test patterns | Archive |
| `practice-planner` | AI weighting prompt logic | Archive |
| `guitar-difficulty` | Difficulty scoring pipeline, GP file parsing | Ported into Instrumenta backend |
