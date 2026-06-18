# Claude Code Guidelines

## Definition of done

A task is **not done** until:

1. The TypeScript build passes: `npm run build` (runs `tsc && vite build`).
2. Any new behaviour has a corresponding Playwright test that was written **before** the implementation (see below).
3. Any relevant TODO.md item is marked complete (`- [x]`).

Never report a task as complete without running `npm run build` and confirming it exits cleanly.

## Test-driven workflow

All bugs and feature work must follow this cycle:

1. Write a Playwright test (or tests) in `tests/` that **fail** against the current code — confirming the bug exists or the new behaviour is missing.
2. Implement the fix or feature.
3. Repeat steps 1–2 until every test passes (`npm run test:e2e`).
4. Confirm the build succeeds (`npm run build`).
5. If the work corresponds to a TODO.md item, mark it complete (`- [x]`).

E2E tests require the Vite dev server running on port 1420 (`npm run dev` in a separate terminal). The Playwright config launches it automatically via `webServer`.

## Error handling

Nothing is allowed to fail silently. All errors must be surfaced in the UI with a visible message containing enough detail to diagnose the problem.

## Rust / Tauri commands

- Tauri commands live in `src-tauri/src/lib.rs`.
- After changing Rust code, confirm the full Tauri build succeeds: `npm run tauri build`.
- Rust compile errors are not caught by `npm run build` (frontend-only) — always run the Tauri build when Rust is touched.

## TODO.md

Keep `TODO.md` up to date:

- Mark items complete (`- [x]`) once the work, tests, and build all pass.
- Add new bugs or planned features as they are identified.
