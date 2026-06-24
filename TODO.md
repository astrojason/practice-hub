## Bugs
- [ ] Guitar Pro files scanning has to be re-run on every app launch, even if the files haven't changed (gp-library.ts)

## Features

- [x] Interleaved practice calendar view (`InterleavedCalendarView`) with Plan and Today tabs
  - [x] Plan tab: plan list sidebar, calendar grid, day panel with block management (add/reorder/delete)
  - [x] Today tab: timed block rotation with countdown, start/pause, prev/next, auto-advance
  - [x] Calendar nav button in session header
  - [x] `activeSectionId` prop on MediaPlayer + `section_id` on Region interface
  - [x] Practice plan API client functions (`getPracticePlans`, `getTodaysPracticePlan`, etc.)
  - [x] Playwright tests for calendar view (nav button, tabs, empty state)

- [x] GP file viewer with alphaTab rendering + pitch controls
  - [x] alphaTab integration (no Vite plugin needed; useWorkers=false, font served from public/font/)
  - [x] Pitch controls: audio semitones, audio cents (fine tune), tab semitones, linked toggle
  - [x] Settings persisted to localStorage per file path (`gp-viewer-shifts:{path}`)
  - [x] GpViewer lifted to App level; accessible from GpLibraryView and all session card modals
  - [x] `guitar_pro` resource type opens GP viewer instead of system browser (SessionModal)
  - [x] Playwright tests for pitch controls, localStorage persistence, linked mode
  - [x] Audio player with SoundTouch pitch shift (load audio file, play/pause/seek, audioSemitones+audioCents applied live)

## Enhancements

- [x] GP viewer tempo control: interactive BPM control synced to audio engine speed, persisted per file in localStorage