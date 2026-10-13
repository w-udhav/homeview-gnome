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
    Track { title: String, artist: String, playing: bool },
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
            Event::Track { .. } | Event::Playback { .. } => Source::Mpris,
            Event::Focus { .. } | Event::Idle { .. } => Source::Focus,
            Event::Site { .. } => Source::Browser,
            Event::Llm { .. } | Event::Tokens { .. } => Source::Llm,
            Event::Cursor { .. } | Event::Hide { .. } | Event::Speech { .. } => Source::Always,
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
