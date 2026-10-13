# Homeview

A pair of expressive eyes in your GNOME panel that react to what you are actually doing: the song playing, the app and site in focus, Claude Code / Codex / Ollama activity, and whether you have gone idle. Hover for a frosted-glass card (follows your light/dark setting) with music controls, a timer, weather, AI activity and a picture of your day. Almost everything stays on your machine (see Privacy).

```
 GNOME Shell extension (draws the eyes and the popup, reports focus/idle/pointer)
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

## The popup

A bento grid of frosted-glass tiles. The glass blurs whatever is behind it, windows included, and follows your light/dark setting.

The daemon ranks what matters right now and decides which tile gets the big slot, so the popup changes with what you are doing:

| Right now | Big tile |
|---|---|
| A timer is running | Timer (the orange tick ring) |
| Music is playing | Now Playing |
| An AI agent is working | AI activity |
| You are in a work app | Focus (current streak, today's work) |
| You are idle | Your day |

The next most relevant tiles fill the remaining slots (a tall one and two squares, then a strip). Weather only appears once you turn it on. The layout is decided when you open the popup, so tiles never move under your pointer.

Tiles: **Now Playing** (art, scrubber, transport over MPRIS), **Timer** (`hv timer 15m`), **Focus**, **AI activity**, **Your day**, **Weather** (opt in under `[weather]`), and a strip of toggles for music, browser and AI signals (saved to `config.toml`) plus hide.

## Developing the UI without logging out

GNOME caches extension code until you log in again. The popup works around that:

```bash
scripts/reload-ui.sh
```

copies your edited files over and tells the running shell to load them from a fresh location. It covers `card.js`, `face.js`, `robot.js`, `ui/*.js` and `stylesheet.css`. Edits to `extension.js` itself still need a logout. Daemon changes (`cargo`, the ranking rules in `crates/hv-core/src/layout.rs`) need only `scripts/install.sh`.

## Hide for screen sharing

`hv toggle` hides the face. Bind it in GNOME: Settings → Keyboard → Custom Shortcuts → command `hv toggle`.

## Config

`~/.config/homeview/config.toml`, see `config.example.toml`. Toggle any source, set categories, and optional Ollama one-liners. Reloads live.

## Privacy

- Aggregates only (minutes per category, token totals, focus blocks, hourly mood). No raw activity log.
- Domains, never URLs. Window titles are used for classification in memory and never stored.
- Every source can be switched off; the socket is user-only (0600).
- **Weather** is the one exception: when you enable it, your coordinates go to Open-Meteo. It is off by default.
- **Album art** is fetched from the image URL your player already advertises (e.g. a video site's thumbnail CDN) and cached under `~/.cache/homeview/art`.

## CLI

`hv emit …`, `hv timer <15m|pause|resume|cancel|add 5m>`, `hv media <play|next|prev|seek N>`, `hv source <mpris|focus|browser|llm|ollama> <on|off>`, `hv hide|show|toggle`, `hv say <text>`, `hv today`, `hv status`, `hv reload`.

## Test

```bash
cargo test --workspace
```
