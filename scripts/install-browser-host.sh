#!/usr/bin/env bash
# Registers the native-messaging host so the Homeview browser extension can
# reach the daemon. Run after installing `hv`.
#
#   scripts/install-browser-host.sh                    # Firefox-family only
#   scripts/install-browser-host.sh <chromium-ext-id>  # also Chromium-family
#
# For Chromium-family browsers: load browser/extension unpacked at
# chrome://extensions, copy its ID, and pass it here.
set -euo pipefail

HV="$(command -v hv || true)"
if [[ -z "$HV" ]]; then
  echo "hv not found on PATH; install it first (scripts/install.sh)" >&2
  exit 1
fi
NAME="dev.homeview.host"

# Native messaging needs the host to be an executable that speaks the
# protocol on stdin/stdout; `hv native-host` is run through a tiny wrapper.
WRAP="${XDG_DATA_HOME:-$HOME/.local/share}/homeview/native-host.sh"
mkdir -p "$(dirname "$WRAP")"
printf '#!/bin/sh\nexec "%s" native-host\n' "$HV" > "$WRAP"
chmod +x "$WRAP"

firefox_json() {
  cat <<EOF
{
  "name": "$NAME",
  "description": "Homeview native host",
  "path": "$WRAP",
  "type": "stdio",
  "allowed_extensions": ["homeview@local"]
}
EOF
}

chromium_json() {
  cat <<EOF
{
  "name": "$NAME",
  "description": "Homeview native host",
  "path": "$WRAP",
  "type": "stdio",
  "allowed_origins": ["chrome-extension://$1/"]
}
EOF
}

for d in "$HOME/.mozilla/native-messaging-hosts" "$HOME/.librewolf/native-messaging-hosts" "$HOME/.zen/native-messaging-hosts"; do
  mkdir -p "$d"; firefox_json > "$d/$NAME.json"; echo "wrote $d/$NAME.json"
done

if [[ $# -ge 1 ]]; then
  for d in "$HOME/.config/chromium/NativeMessagingHosts" "$HOME/.config/google-chrome/NativeMessagingHosts" \
           "$HOME/.config/BraveSoftware/Brave-Browser/NativeMessagingHosts" "$HOME/.config/vivaldi/NativeMessagingHosts"; do
    mkdir -p "$d"; chromium_json "$1" > "$d/$NAME.json"; echo "wrote $d/$NAME.json"
  done
fi
echo "Done. Load browser/extension in your browser, then restart it."
