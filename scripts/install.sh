#!/usr/bin/env bash
# Per-user install: binaries into ~/.cargo/bin, the GNOME extension, and the
# systemd user service.
set -euo pipefail
cd "$(dirname "$0")/.."

cargo install --path crates/hv-daemon --locked
cargo install --path crates/hv-cli --locked

EXT="$HOME/.local/share/gnome-shell/extensions/homeview@local"
mkdir -p "$(dirname "$EXT")"
rm -rf "$EXT"
cp -r extension/homeview@local "$EXT"

UNIT="$HOME/.config/systemd/user/homeviewd.service"
mkdir -p "$(dirname "$UNIT")"
sed "s|@BINDIR@|$HOME/.cargo/bin|" packaging/homeviewd.service.in > "$UNIT"
systemctl --user daemon-reload
systemctl --user enable homeviewd.service
systemctl --user restart homeviewd.service

cat <<'EOF'

Installed.
 - Log out and back in once (Wayland loads new shell extensions at login), then:
     gnome-extensions enable homeview@local
 - Optional: copy config.example.toml to ~/.config/homeview/config.toml
 - Claude Code hooks: see README.md ("Claude Code hooks").
EOF
