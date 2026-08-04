# Claude Code Guidelines

## Definition of done

A task is **not done** until:

1. The TypeScript build passes: `npm run build` (runs `tsc && vite build`).
2. Any new behaviour has a corresponding Playwright test that was written **before** the implementation (see below).
3. Any relevant TODO.md item is removed from TODO.md — the git log is the record.

Never report a task as complete without running `npm run build` and confirming it exits cleanly.

## Test-driven workflow

All bugs and feature work must follow this cycle:

1. Write a Playwright test (or tests) in `tests/` that **fail** against the current code — confirming the bug exists or the new behaviour is missing.
2. Implement the fix or feature.
3. Repeat steps 1–2 until every test passes (`npm run test:e2e`).
4. Confirm the build succeeds (`npm run build`).
5. If the work corresponds to a TODO.md item, remove it from TODO.md — the git log is the record.

E2E tests require the Vite dev server running on port 1420 (`npm run dev` in a separate terminal). The Playwright config launches it automatically via `webServer`.

## Error handling

Nothing is allowed to fail silently. Every `catch` block — including `.catch()` chains — **must** surface the error in the UI. No empty `catch {}`, no `catch(() => {})`, no `console.error`-only handlers.

Rules:
- Show the **actual error message** (`err instanceof Error ? err.message : String(err)`), not a generic "Something went wrong."
- Use the `ErrorModal` component (`src/components/ErrorModal.tsx`) to display errors — it renders as a centered, dismissable overlay (Escape or click-outside closes it). The error text inside is selectable/copyable by default.
- `/* non-critical */` is only acceptable for truly fire-and-forget side effects (e.g. analytics pings) that have no user-visible impact if they fail. When in doubt, surface it.

## TODO.md

Keep `TODO.md` up to date:

- Remove items from TODO.md once the work has been committed — do not leave them checked off. The git log is the record.
- Add new bugs or planned features as they are identified.

## Versioning

The app version lives in `package.json` and must be displayed in the app UI.

- Any commit touching files other than `CLAUDE.md` must include a version bump — patch for fixes, minor for new features, major for breaking changes. CLAUDE.md-only commits may use `--no-verify` to skip the bump.
- The version displayed must be a clickable link to a changelog view. The changelog view renders the git log — each entry shows the short hash and commit message (`git log --pretty=format:"%h %s" -n 50`). Implement as a Tauri command returning the log output if not already present.
