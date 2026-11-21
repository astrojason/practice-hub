#!/usr/bin/env bash
# Builds Practice Hub as a universal macOS app (Apple silicon + Intel).
#
#   scripts/build.sh
#
# The bundle version always comes from package.json (tauri.conf.json points at it), so the
# app's version and the bundle's version cannot drift apart.
#
# To sign (and notarize) the build so other people's Macs open it without warnings, set these
# first (they need a paid Apple Developer account):
#
#   export APPLE_SIGNING_IDENTITY="Developer ID Application: Your Name (TEAMID)"
#   export APPLE_ID="you@example.com"            # for notarization
#   export APPLE_PASSWORD="app-specific-password" # appleid.apple.com > App-Specific Passwords
#   export APPLE_TEAM_ID="TEAMID"
#
# Without APPLE_SIGNING_IDENTITY the app is built unsigned: fine for you, but other Macs will
# show "can't be verified" (right-click > Open gets past it once).

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR/.."

TARGET="universal-apple-darwin"

for t in aarch64-apple-darwin x86_64-apple-darwin; do
  if ! rustup target list --installed | grep -qx "$t"; then
    echo "Adding the Rust target $t…"
    rustup target add "$t"
  fi
done

if [[ -n "${APPLE_SIGNING_IDENTITY:-}" ]]; then
  echo "Signing as: $APPLE_SIGNING_IDENTITY"
  if [[ -z "${APPLE_ID:-}" || -z "${APPLE_PASSWORD:-}" || -z "${APPLE_TEAM_ID:-}" ]]; then
    echo "Note: APPLE_ID, APPLE_PASSWORD and APPLE_TEAM_ID are not all set, so the app will be signed but not notarized."
  fi
else
  echo "Note: APPLE_SIGNING_IDENTITY is not set, so this build is unsigned (see the top of this script)."
fi

npm run tauri build -- --target "$TARGET"

echo
echo "Built version $(node -p "require('./package.json').version"):"
ls -d "src-tauri/target/$TARGET/release/bundle/macos/"*.app "src-tauri/target/$TARGET/release/bundle/dmg/"*.dmg 2>/dev/null
