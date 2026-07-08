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

- [x] Browse view: page/search full catalog of songs, exercises, study materials; edit any item in place; add child exercises/study materials to an existing parent
  - [x] `BrowseView` with Songs / Study Materials / Exercises tabs, debounced search, "load more" pagination (reuses `getCatalogSongs`/`getCatalogExercises`/`getCatalogStudyMaterials`)
  - [x] Browse nav button in session header (`onBrowse`)
  - [x] Row components reuse existing `SongEditForm`/`ExerciseEditForm`/`StudyMaterialEditForm` for edits
  - [x] `createExercise`/`createStudyMaterial` API client functions + `AddChildExerciseForm`/`AddChildStudyMaterialForm` for adding child items, with optimistic local append and 409-conflict surfaced via `ErrorModal`
  - [x] Shared `catalogExerciseToDashboard`/`catalogStudyMaterialToDashboard` converters extracted to `src/api/catalogConvert.ts`
  - [x] Playwright tests for browse/list, expand/collapse children, edit, add-child (exercise + study material), and 409 conflict handling

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
- [x] GP viewer loop control: loop in/out points set from playhead, loop enable toggle, persisted per file in localStorage; loop region overlay on progress bar