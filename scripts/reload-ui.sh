#!/usr/bin/env bash
# Push edited extension files into the running shell without logging out.
# Needs the extension from this version (or later) to already be loaded once.
#
#   scripts/reload-ui.sh
#
# Covers card.js, face.js, robot.js, ui/*.js and stylesheet.css. Changes to
# extension.js itself (focus/idle reporting, the panel button) still need a
# logout, because GNOME keeps that one module cached.
set -euo pipefail
cd "$(dirname "$0")/.."
EXT="$HOME/.local/share/gnome-shell/extensions/homeview@local"
rm -rf "$EXT"
mkdir -p "$(dirname "$EXT")"
cp -r extension/homeview@local "$EXT"
hv reload-ui
echo "UI reloaded."
