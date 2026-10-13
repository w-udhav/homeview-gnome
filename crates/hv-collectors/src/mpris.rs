//! MPRIS over D-Bus. Polls once a second: simple, and robust against players
//! appearing and disappearing. YouTube Music in a browser, or the th-ch
//! YouTube Music app, shows up as an `org.mpris.MediaPlayer2.*` name.

use hv_core::Event;
use std::collections::HashMap;
use std::time::Duration;
use tokio::sync::mpsc::Sender;
use zbus::zvariant::{OwnedValue, Value};
use zbus::{proxy, Connection};

#[proxy(interface = "org.mpris.MediaPlayer2.Player", default_path = "/org/mpris/MediaPlayer2")]
trait Player {
    #[zbus(property)]
    fn playback_status(&self) -> zbus::Result<String>;
    #[zbus(property)]
    fn metadata(&self) -> zbus::Result<HashMap<String, OwnedValue>>;
}

#[derive(Debug, Clone, PartialEq, Default)]
pub struct Now {
    pub title: String,
    pub artist: String,
    pub playing: bool,
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

pub fn parse_metadata(md: &HashMap<String, OwnedValue>) -> (String, String) {
    let title = md.get("xesam:title").and_then(|v| as_string(v)).unwrap_or_default();
    let artist = md.get("xesam:artist").and_then(|v| as_joined(v)).unwrap_or_default();
    (title, artist)
}

pub async fn run(tx: Sender<Event>) {
    loop {
        if let Err(e) = run_inner(&tx).await {
            eprintln!("mpris: {e}; retrying in 5s");
        }
        tokio::time::sleep(Duration::from_secs(5)).await;
    }
}

async fn poll_players(conn: &Connection, dbus: &zbus::fdo::DBusProxy<'_>) -> zbus::Result<Option<Now>> {
    let names = dbus.list_names().await?;
    let mut best: Option<Now> = None;
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
        let now = Now { title, artist, playing: status == "Playing" };
        match &best {
            Some(b) if b.playing || !now.playing => {}
            _ => best = Some(now),
        }
    }
    Ok(best)
}

async fn run_inner(tx: &Sender<Event>) -> zbus::Result<()> {
    let conn = Connection::session().await?;
    let dbus = zbus::fdo::DBusProxy::new(&conn).await?;
    let mut last = Now::default();
    loop {
        let cur = poll_players(&conn, &dbus).await?.unwrap_or_default();
        if cur != last {
            let track_changed = cur.title != last.title || cur.artist != last.artist;
            let ev = if track_changed && !cur.title.is_empty() {
                Event::Track { title: cur.title.clone(), artist: cur.artist.clone(), playing: cur.playing }
            } else {
                Event::Playback { playing: cur.playing }
            };
            if tx.send(ev).await.is_err() {
                return Ok(());
            }
            last = cur;
        }
        tokio::time::sleep(Duration::from_secs(1)).await;
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
}
