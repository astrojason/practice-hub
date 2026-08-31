#!/usr/bin/env bash
# Builds the Tauri app (tauri.conf.json's beforeBuildCommand runs the
# frontend tsc + vite build first, then bundles the native app).
#
#   scripts/build.sh

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR/.."

npm run tauri build
