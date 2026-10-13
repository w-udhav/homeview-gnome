use serde::{Deserialize, Serialize};

/// Where an LLM agent is in its turn.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum LlmState {
    Started,
    Finished,
    Input,
}

/// Everything that can happen. Collectors, the CLI, the shell extension and
/// the browser extension all speak this one JSON-lines vocabulary.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "t", rename_all = "snake_case")]
pub enum Event {
    Track {
        title: String,
        artist: String,
        playing: bool,
        #[serde(default)]
        art_url: String,
        #[serde(default)]
        length: f32,
    },
    /// Playback position in seconds, about once a second while a player exists.
    Progress { pos: f32, len: f32 },
    /// Transport command for the active player: play_pause, next, previous, seek_to:<secs>.
    Media { cmd: String },
    /// Timer control: start (secs), pause, resume, toggle, cancel, add (secs).
    Timer { action: String, #[serde(default)] secs: f32 },
    /// Switch a data source on or off (and persist it).
    Toggle { source: String, on: bool },
    Weather { temp: f32, code: u32, hi: f32, lo: f32 },
    Playback { playing: bool },
    Focus { app: String, #[serde(default)] title: String },
    Idle { idle: bool },
    Site { domain: String },
    Llm { agent: String, state: LlmState },
    Tokens { agent: String, count: u64 },
    /// Pointer position relative to the face, each axis clamped to -1..1.
    Cursor { x: f32, y: f32 },
    /// `None` toggles.
    Hide { #[serde(default)] hidden: Option<bool> },
    Speech { text: String },
}

impl Event {
    /// Which config source switch gates this event.
    pub fn source(&self) -> Source {
        match self {
            Event::Track { .. } | Event::Playback { .. } | Event::Progress { .. } | Event::Media { .. } => Source::Mpris,
            Event::Focus { .. } | Event::Idle { .. } => Source::Focus,
            Event::Site { .. } => Source::Browser,
            Event::Llm { .. } | Event::Tokens { .. } => Source::Llm,
            Event::Cursor { .. }
            | Event::Hide { .. }
            | Event::Speech { .. }
            | Event::Timer { .. }
            | Event::Toggle { .. }
            | Event::Weather { .. } => Source::Always,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Source {
    Mpris,
    Focus,
    Browser,
    Llm,
    Always,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn roundtrip() {
        let e = Event::Llm { agent: "claude".into(), state: LlmState::Started };
        let s = serde_json::to_string(&e).unwrap();
        assert_eq!(s, r#"{"t":"llm","agent":"claude","state":"started"}"#);
        assert_eq!(serde_json::from_str::<Event>(&s).unwrap(), e);
    }

    #[test]
    fn track_extras_optional() {
        let e: Event = serde_json::from_str(r#"{"t":"track","title":"a","artist":"b","playing":true}"#).unwrap();
        assert_eq!(e, Event::Track { title: "a".into(), artist: "b".into(), playing: true, art_url: String::new(), length: 0.0 });
    }

    #[test]
    fn timer_command_parses() {
        let e: Event = serde_json::from_str(r#"{"t":"timer","action":"start","secs":900}"#).unwrap();
        assert_eq!(e, Event::Timer { action: "start".into(), secs: 900.0 });
    }

    #[test]
    fn focus_title_optional() {
        let e: Event = serde_json::from_str(r#"{"t":"focus","app":"kitty"}"#).unwrap();
        assert_eq!(e, Event::Focus { app: "kitty".into(), title: String::new() });
    }

    #[test]
    fn hide_toggle_default() {
        let e: Event = serde_json::from_str(r#"{"t":"hide"}"#).unwrap();
        assert_eq!(e, Event::Hide { hidden: None });
    }
}
