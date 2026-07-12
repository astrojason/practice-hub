## Bugs
- [x] GP viewer playhead drifts further behind the audio the longer a track plays (`useAudioEngine.ts`)
  - [x] `getCurrentTime()` extrapolated purely from `performance.now()` since playback start, so any rate mismatch between the JS timer and the real audio hardware clock (`ctx.currentTime`) compounded over the whole track instead of self-correcting. Fixed by extracting `resolvePlaybackPosition()`, which anchors elapsed time to `ctx.currentTime` and only uses `performance.now()` to interpolate within the current buffer period (~93ms), resyncing every time the audio clock ticks forward.
  - [x] Playwright tests in `tests/gp-audio-clock.spec.ts` call the pure resolver directly to prove drift immunity and buffer-period interpolation without needing a real audio pipeline.
- [ ] Guitar Pro files scanning has to be re-run on every app launch, even if the files haven't changed (gp-library.ts)
- [x] Opening a media resource (audio/video/GP) during a session closed the session modal for good and, in the sequential-session flow, cancelled the whole session and discarded the running timer.
  - [x] Sequential sessions: `SessionModal`'s auto-close-on-open-media was wired to `onCancelReturn`. Fixed by adding a distinct `onMediaOpen` callback that hides the sequential modal and restores it (with the timer intact) once the media closes.
  - [x] Normal (single-item) sessions: the existing `isMediaActive`/`mediaWasOpenedRef` auto-reopen mechanism only tracked the audio/video player, not the GP viewer, so opening a GP tab left the modal closed with no way back (timer kept running in the background, just invisible). Fixed by threading `isGpViewerActive` from `App.tsx` down through `SessionView` to `ExerciseCard`/`StudyMaterialCard`/`SongCard`, and marking `onGpView` opens the same way as `onOpenFile`.
  - [x] Quick-Added songs specifically: the `SongCard` rendered for `additionalSongs` (the "Additional" group populated via Quick Add) was missing the `isMediaActive`/`isGpViewerActive` props entirely, so opening *any* media (audio/video/GP) from a quick-added song's modal closed it for good — it never reopened, making the running timer look stopped even though it kept counting in the background. Fixed by passing both props on that card instance in `SessionView.tsx`.

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