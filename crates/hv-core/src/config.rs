use serde::{Deserialize, Serialize};
use std::path::PathBuf;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default)]
pub struct Sources {
    pub mpris: bool,
    pub focus: bool,
    pub browser: bool,
    pub llm: bool,
    pub ollama: bool,
}

impl Default for Sources {
    fn default() -> Self {
        Self { mpris: true, focus: true, browser: true, llm: true, ollama: true }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default)]
pub struct Categories {
    pub work: Vec<String>,
    pub watch: Vec<String>,
    pub social: Vec<String>,
    pub read: Vec<String>,
}

fn v(xs: &[&str]) -> Vec<String> {
    xs.iter().map(|s| s.to_string()).collect()
}

impl Default for Categories {
    fn default() -> Self {
        Self {
            work: v(&[
                "code", "terminal", "kitty", "alacritty", "ptyxis", "konsole", "wezterm", "foot",
                "cursor", "windsurf", "jetbrains", "zed", "nvim", "vim", "github.com", "gitlab.com",
                "localhost", "stackoverflow.com", "linear.app", "figma",
            ]),
            watch: v(&["youtube.com", "netflix", "twitch.tv", "primevideo", "hotstar", "vlc", "mpv"]),
            social: v(&[
                "twitter.com", "x.com", "reddit.com", "instagram.com", "facebook.com", "discord",
                "whatsapp", "telegram", "linkedin.com", "tiktok.com", "threads.net",
            ]),
            read: v(&["medium.com", "wikipedia.org", "news.ycombinator.com", "docs.", "substack.com", "evince", "okular", "zathura"]),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default)]
pub struct Llm {
    /// Daily tokens that fill the "food" meter.
    pub daily_token_goal: u64,
    pub claude_dir: String,
    pub codex_dir: String,
}

impl Default for Llm {
    fn default() -> Self {
        Self { daily_token_goal: 2_000_000, claude_dir: "~/.claude/projects".into(), codex_dir: "~/.codex/sessions".into() }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default)]
pub struct Ollama {
    pub host: String,
    pub model: String,
    /// Minutes between spoken one-liners. 0 disables speech.
    pub speak_every_min: u64,
}

impl Default for Ollama {
    fn default() -> Self {
        Self { host: "127.0.0.1:11434".into(), model: String::new(), speak_every_min: 0 }
    }
}

/// Weather is the one signal that leaves the machine (your coordinates go to
/// Open-Meteo), so it is off unless you turn it on.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default)]
pub struct Weather {
    pub enabled: bool,
    pub lat: f64,
    pub lon: f64,
    /// "metric" (Celsius) or "imperial" (Fahrenheit).
    pub units: String,
}

impl Default for Weather {
    fn default() -> Self {
        Self { enabled: false, lat: 0.0, lon: 0.0, units: "metric".into() }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default)]
pub struct Config {
    pub sources: Sources,
    pub categories: Categories,
    pub llm: Llm,
    pub ollama: Ollama,
    pub weather: Weather,
}

impl Default for Config {
    fn default() -> Self {
        Self {
            sources: Sources::default(),
            categories: Categories::default(),
            llm: Llm::default(),
            ollama: Ollama::default(),
            weather: Weather::default(),
        }
    }
}

impl Config {
    pub fn path() -> PathBuf {
        let base = std::env::var_os("XDG_CONFIG_HOME")
            .map(PathBuf::from)
            .or_else(|| std::env::var_os("HOME").map(|h| PathBuf::from(h).join(".config")))
            .unwrap_or_else(|| PathBuf::from("."));
        base.join("homeview").join("config.toml")
    }

    pub fn parse(s: &str) -> Result<Self, toml::de::Error> {
        toml::from_str(s)
    }

    /// Missing or broken file falls back to defaults; the error is returned
    /// so the caller can log it.
    pub fn load() -> (Self, Option<String>) {
        match std::fs::read_to_string(Self::path()) {
            Ok(s) => match Self::parse(&s) {
                Ok(c) => (c, None),
                Err(e) => (Self::default(), Some(format!("config parse error: {e}"))),
            },
            Err(_) => (Self::default(), None),
        }
    }
}

pub fn expand_home(p: &str) -> PathBuf {
    if let Some(rest) = p.strip_prefix("~/") {
        if let Some(h) = std::env::var_os("HOME") {
            return PathBuf::from(h).join(rest);
        }
    }
    PathBuf::from(p)
}

pub fn socket_path() -> PathBuf {
    std::env::var_os("XDG_RUNTIME_DIR")
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from("/tmp"))
        .join("homeview.sock")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn empty_is_default() {
        let c = Config::parse("").unwrap();
        assert!(c.sources.mpris);
    }

    #[test]
    fn partial_override() {
        let c = Config::parse("[sources]\nbrowser = false\n").unwrap();
        assert!(!c.sources.browser);
        assert!(c.sources.focus);
    }
}
