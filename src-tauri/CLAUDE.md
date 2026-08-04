## Rust / Tauri commands

- Tauri commands live in `src-tauri/src/lib.rs`.
- After changing Rust code, confirm the full Tauri build succeeds: `npm run tauri build`.
- Rust compile errors are not caught by `npm run build` (frontend-only) — always run the Tauri build when Rust is touched.
