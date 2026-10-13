//! MPRIS over D-Bus. Polls once a second: simple, and robust against players
//! appearing and disappearing. YouTube Music in a browser, or the th-ch
//! YouTube Music app, shows up as an `org.mpris.MediaPlayer2.*` name.

use hv_core::Event;
use std::collections::HashMap;
use std::time::Duration;
use tokio::sync::mpsc::{Receiver, Sender};
use zbus::zvariant::{OwnedValue, Value};
use zbus::{proxy, Connection};

#[proxy(interface = "org.mpris.MediaPlayer2.Player", default_path = "/org/mpris/MediaPlayer2")]
trait Player {
    #[zbus(property)]
    fn playback_status(&self) -> zbus::Result<String>;
    #[zbus(property)]
    fn metadata(&self) -> zbus::Result<HashMap<String, OwnedValue>>;
    #[zbus(property)]
    fn position(&self) -> zbus::Result<i64>;
    fn play_pause(&self) -> zbus::Result<()>;
    fn play(&self) -> zbus::Result<()>;
    fn pause(&self) -> zbus::Result<()>;
    fn next(&self) -> zbus::Result<()>;
    fn previous(&self) -> zbus::Result<()>;
    fn seek(&self, offset: i64) -> zbus::Result<()>;
}

#[derive(Debug, Clone, PartialEq, Default)]
pub struct Now {
    pub title: String,
    pub artist: String,
    pub playing: bool,
    pub art_url: String,
    /// seconds
    pub length: f32,
}

fn as_string(v: &Value<'_>) -> Option<String> {
    match v {
        Value::Str(s) => Some(s.to_string()),
        Value::Value(inner) => as_string(inner),
        _ => None,
    }
}

fn as_joined(v: &Value<'_>) -> Option<String> {
    match v {
        Value::Array(a) => {
            let parts: Vec<String> = a.iter().filter_map(as_string).collect();
            Some(parts.join(", "))
        }
        Value::Value(inner) => as_joined(inner),
        other => as_string(other),
    }
}

fn as_micros(v: &Value<'_>) -> Option<i64> {
    match v {
        Value::I64(n) => Some(*n),
        Value::U64(n) => Some(*n as i64),
        Value::I32(n) => Some(*n as i64),
        Value::U32(n) => Some(*n as i64),
        Value::Value(inner) => as_micros(inner),
        _ => None,
    }
}

pub fn parse_metadata(md: &HashMap<String, OwnedValue>) -> (String, String) {
    let title = md.get("xesam:title").and_then(|v| as_string(v)).unwrap_or_default();
    let artist = md.get("xesam:artist").and_then(|v| as_joined(v)).unwrap_or_default();
    (title, artist)
}

/// (art url, length in seconds)
pub fn parse_extras(md: &HashMap<String, OwnedValue>) -> (String, f32) {
    let art = md.get("mpris:artUrl").and_then(|v| as_string(v)).unwrap_or_default();
    let len = md.get("mpris:length").and_then(|v| as_micros(v)).map(|us| us as f32 / 1e6).unwrap_or(0.0);
    (art, len)
}

/// Turn a UI command into a concrete action on the player.
#[derive(Debug, PartialEq)]
pub enum Cmd {
    PlayPause,
    Next,
    Previous,
    SeekTo(f32),
}

pub fn parse_cmd(s: &str) -> Option<Cmd> {
    match s {
        "play_pause" => Some(Cmd::PlayPause),
        "next" => Some(Cmd::Next),
        "previous" | "prev" => Some(Cmd::Previous),
        _ => s.strip_prefix("seek_to:").and_then(|n| n.parse::<f32>().ok()).map(Cmd::SeekTo),
    }
}

pub async fn run(tx: Sender<Event>, mut cmds: Receiver<String>) {
    loop {
        if let Err(e) = run_inner(&tx, &mut cmds).await {
            eprintln!("mpris: {e}; retrying in 5s");
        }
        tokio::time::sleep(Duration::from_secs(5)).await;
    }
}

struct Active {
    name: String,
    now: Now,
}

async fn poll_players(conn: &Connection, dbus: &zbus::fdo::DBusProxy<'_>) -> zbus::Result<Option<Active>> {
    let names = dbus.list_names().await?;
    let mut best: Option<Active> = None;
    for name in names.iter().map(|n| n.to_string()).filter(|n| n.starts_with("org.mpris.MediaPlayer2.")) {
        let proxy = match PlayerProxy::builder(conn).destination(name.clone())?.build().await {
            Ok(p) => p,
            Err(_) => continue,
        };
        let status = proxy.playback_status().await.unwrap_or_default();
        let md = proxy.metadata().await.unwrap_or_default();
        let (title, artist) = parse_metadata(&md);
        if title.is_empty() {
            continue;
        }
        let (art_url, length) = parse_extras(&md);
        let now = Now { title, artist, playing: status == "Playing", art_url, length };
        match &best {
            Some(b) if b.now.playing || !now.playing => {}
            _ => best = Some(Active { name, now }),
        }
    }
    Ok(best)
}

async fn position_of(conn: &Connection, name: &str) -> Option<f32> {
    let p = PlayerProxy::builder(conn).destination(name.to_string()).ok()?.build().await.ok()?;
    p.position().await.ok().map(|us| us as f32 / 1e6)
}

async fn control(conn: &Connection, name: &str, cmd: Cmd) -> zbus::Result<()> {
    let p = PlayerProxy::builder(conn).destination(name.to_string())?.build().await?;
    match cmd {
        Cmd::PlayPause => p.play_pause().await,
        Cmd::Next => p.next().await,
        Cmd::Previous => p.previous().await,
        Cmd::SeekTo(target) => {
            // Seek is relative, so go through the current position.
            let cur = p.position().await.unwrap_or(0) as f64 / 1e6;
            p.seek(((target as f64 - cur) * 1e6) as i64).await
        }
    }
}

async fn run_inner(tx: &Sender<Event>, cmds: &mut Receiver<String>) -> zbus::Result<()> {
    let conn = Connection::session().await?;
    let dbus = zbus::fdo::DBusProxy::new(&conn).await?;
    let mut last = Now::default();
    let mut active_name: Option<String> = None;
    loop {
        let active = poll_players(&conn, &dbus).await?;
        let cur = active.as_ref().map(|a| a.now.clone()).unwrap_or_default();
        active_name = active.as_ref().map(|a| a.name.clone()).or(active_name);
        if cur != last {
            let track_changed = cur.title != last.title || cur.artist != last.artist || cur.art_url != last.art_url;
            let ev = if track_changed && !cur.title.is_empty() {
                Event::Track {
                    title: cur.title.clone(),
                    artist: cur.artist.clone(),
                    playing: cur.playing,
                    art_url: cur.art_url.clone(),
                    length: cur.length,
                }
            } else {
                Event::Playback { playing: cur.playing }
            };
            if tx.send(ev).await.is_err() {
                return Ok(());
            }
            last = cur;
        }
        if let (Some(a), true) = (&active, last.playing) {
            if let Some(pos) = position_of(&conn, &a.name).await {
                if tx.send(Event::Progress { pos, len: last.length }).await.is_err() {
                    return Ok(());
                }
            }
        }
        // Sleep one second, but wake for commands so buttons feel instant.
        let deadline = tokio::time::sleep(Duration::from_secs(1));
        tokio::pin!(deadline);
        loop {
            tokio::select! {
                _ = &mut deadline => break,
                Some(c) = cmds.recv() => {
                    if let (Some(cmd), Some(name)) = (parse_cmd(&c), &active_name) {
                        if let Err(e) = control(&conn, name, cmd).await {
                            eprintln!("mpris control: {e}");
                        }
                        break; // re-poll right away to reflect the change
                    }
                }
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_metadata() {
        let mut md: HashMap<String, OwnedValue> = HashMap::new();
        md.insert("xesam:title".into(), Value::from("Song").try_into().unwrap());
        md.insert("xesam:artist".into(), Value::from(vec!["A", "B"]).try_into().unwrap());
        let (t, a) = parse_metadata(&md);
        assert_eq!(t, "Song");
        assert_eq!(a, "A, B");
    }

    #[test]
    fn parses_art_and_length() {
        let mut md: HashMap<String, OwnedValue> = HashMap::new();
        md.insert("mpris:artUrl".into(), Value::from("https://x/y.jpg").try_into().unwrap());
        md.insert("mpris:length".into(), Value::from(215_000_000i64).try_into().unwrap());
        let (art, len) = parse_extras(&md);
        assert_eq!(art, "https://x/y.jpg");
        assert!((len - 215.0).abs() < 1e-3);
    }

    #[test]
    fn parses_commands() {
        assert_eq!(parse_cmd("play_pause"), Some(Cmd::PlayPause));
        assert_eq!(parse_cmd("prev"), Some(Cmd::Previous));
        assert_eq!(parse_cmd("seek_to:42.5"), Some(Cmd::SeekTo(42.5)));
        assert_eq!(parse_cmd("nonsense"), None);
    }
}
