#!/usr/bin/env bash
# Installs the nightly GP library scan as a launchd agent, following the same
# pattern as ~/Library/LaunchAgents/com.jasonsylvester.sheetmusic-cleanup.plist.
#
# This does NOT run automatically as part of any build or test step — run it
# yourself when you're ready to turn the nightly scan on:
#   scripts/install-nightly-scan.sh
#
# To undo:
#   launchctl unload ~/Library/LaunchAgents/com.jasonsylvester.gp-nightly-scan.plist
#   rm ~/Library/LaunchAgents/com.jasonsylvester.gp-nightly-scan.plist

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PLIST_NAME="com.jasonsylvester.gp-nightly-scan.plist"
SRC="$SCRIPT_DIR/$PLIST_NAME"
DEST="$HOME/Library/LaunchAgents/$PLIST_NAME"

cp "$SRC" "$DEST"
echo "Copied $PLIST_NAME to $DEST"

launchctl unload "$DEST" 2>/dev/null || true
launchctl load "$DEST"
echo "Loaded launchd agent com.jasonsylvester.gp-nightly-scan (runs nightly at 2:15 AM)."
echo "Logs: ~/Library/Logs/gp-nightly-scan.log and gp-nightly-scan-error.log"
