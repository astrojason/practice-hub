#!/usr/bin/env bash
# Builds practice-hub-notifier.app — a copy of terminal-notifier with its own
# bundle id and the Practice Hub icon, so nightly_gp_scan.py's notifications
# get a distinct icon and don't stack under the generic osascript/"Script
# Editor" identity every other launchd script on this Mac uses.
#
# Re-run this any time terminal-notifier is upgraded (brew upgrade
# terminal-notifier) or the app icon changes — it always rebuilds from
# scratch and replaces whatever is at APPDIR.
#
#   scripts/build-notifier.sh
#
# After it finishes, notifications are OFF by default for a bundle id macOS
# has never seen before. Run:
#   open /Applications/practice-hub-notifier.app
# once, then enable it in System Settings > Notifications — that's a one-time
# manual step; macOS gives no command-line way to grant it.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$SCRIPT_DIR/.."
ICON="$REPO_ROOT/src-tauri/icons/icon.icns"
APP_NAME="practice-hub-notifier"
DISPLAY_NAME="Practice Hub Notifications"
APPDIR="/Applications"

if ! command -v terminal-notifier >/dev/null 2>&1; then
  echo "terminal-notifier isn't installed — run: brew install terminal-notifier" >&2
  exit 1
fi
if [ ! -f "$ICON" ]; then
  echo "Icon not found: $ICON" >&2
  exit 1
fi

WORK_DIR="$(mktemp -d)"
trap 'rm -rf "$WORK_DIR"' EXIT

echo "==> Cloning terminal-notifier source"
git clone --quiet --depth 1 https://github.com/julienXX/terminal-notifier.git "$WORK_DIR/src"

echo "==> Building $APP_NAME.app with the Practice Hub icon"
make -C "$WORK_DIR/src" icon ICON="$ICON" APP_NAME="$APP_NAME"

BUILT_APP="$WORK_DIR/src/build/$APP_NAME.app"

# `make icon` names the app after APP_NAME; give it a human-readable display
# name too so System Settings > Notifications doesn't just show the slug.
/usr/libexec/PlistBuddy -c "Set :CFBundleName $DISPLAY_NAME" "$BUILT_APP/Contents/Info.plist"
if ! /usr/libexec/PlistBuddy -c "Set :CFBundleDisplayName $DISPLAY_NAME" "$BUILT_APP/Contents/Info.plist" 2>/dev/null; then
  /usr/libexec/PlistBuddy -c "Add :CFBundleDisplayName string $DISPLAY_NAME" "$BUILT_APP/Contents/Info.plist"
fi
codesign --force --sign - "$BUILT_APP"

echo "==> Installing to $APPDIR"
rm -rf "$APPDIR/$APP_NAME.app"
cp -R "$BUILT_APP" "$APPDIR/"
/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister -f "$APPDIR/$APP_NAME.app"

echo "==> Done: $APPDIR/$APP_NAME.app"
echo "    If this is the first build, run:"
echo "      open $APPDIR/$APP_NAME.app"
echo "    then enable it in System Settings > Notifications."
