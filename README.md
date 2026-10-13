# Homeview

A small companion in your GNOME panel. Its face reacts to what you are actually doing: the song playing, the app and site in focus, Claude Code / Codex / Ollama activity, and whether you have gone idle. Hover for a "today" card. Everything stays on your machine.

```
 GNOME Shell extension (draws face, reports focus/idle/pointer)
        │  JSON lines over $XDG_RUNTIME_DIR/homeview.sock
 homeviewd (mood engine, springs, day log)   ◄── hv emit … (hooks, scripts)
        ▲                                    ◄── browser extension → hv native-host
 collectors: MPRIS · Claude/Codex jsonl tail · Ollama
```

GNOME has no layer-shell, so the UI is a thin shell extension and all logic lives in the Rust daemon.

## Install

Needs Rust (`sudo pacman -S rustup && rustup default stable`), GNOME Shell 48–50.

```bash
scripts/install.sh
# log out/in once, then
gnome-extensions enable homeview@local
```

Develop without logging out (nested shell):

```bash
cargo run -p hv-daemon &
dbus-run-session -- gnome-shell --devkit --wayland   # older GNOME: --nested
```

## Claude Code hooks

Add to `~/.claude/settings.json` so the face reacts the moment Claude starts, finishes, or asks for input:

```json
{
  "hooks": {
    "UserPromptSubmit": [{"hooks": [{"type": "command", "command": "hv emit llm claude started"}]}],
    "Stop":             [{"hooks": [{"type": "command", "command": "hv emit llm claude finished"}]}],
    "Notification":     [{"hooks": [{"type": "command", "command": "hv emit llm claude input"}]}]
  }
}
```

`hv emit` exits 0 and stays silent when the daemon is down, so hooks never break.

## Browser

Load `browser/extension` (unpacked in Chromium-family, temporary add-on in Firefox), then `scripts/install-browser-host.sh [chromium-extension-id]`. Only the **domain** of the active tab is sent.

## Hide for screen sharing

`hv toggle` hides the face. Bind it in GNOME: Settings → Keyboard → Custom Shortcuts → command `hv toggle`.

## Config

`~/.config/homeview/config.toml`, see `config.example.toml`. Toggle any source, set categories, face style (`classic` / `round` / `minimal`), and optional Ollama one-liners. Reloads live.

## Privacy

- Aggregates only (minutes per category, token totals, focus blocks, hourly mood). No raw activity log.
- Domains, never URLs. Window titles are used for classification in memory and never stored.
- Every source can be switched off; the socket is user-only (0600).

## CLI

`hv emit …`, `hv hide|show|toggle`, `hv say <text>`, `hv today`, `hv status`, `hv reload`.

## Test

```bash
cargo test --workspace
```
