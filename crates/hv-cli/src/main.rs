//! `hv`: talk to homeviewd from scripts, hooks and the browser.
//!
//! Plain std, no async: hooks call this on every prompt, so it must start
//! fast and never block or fail loudly when the daemon is down.

use serde_json::{json, Value};
use std::io::{BufRead, BufReader, Read, Write};
use std::os::unix::net::UnixStream;
use std::time::Duration;

fn socket_path() -> std::path::PathBuf {
    std::env::var_os("XDG_RUNTIME_DIR")
        .map(std::path::PathBuf::from)
        .unwrap_or_else(|| std::path::PathBuf::from("/tmp"))
        .join("homeview.sock")
}

fn connect() -> Option<UnixStream> {
    let s = UnixStream::connect(socket_path()).ok()?;
    s.set_write_timeout(Some(Duration::from_millis(500))).ok()?;
    s.set_read_timeout(Some(Duration::from_secs(3))).ok()?;
    Some(s)
}

fn send_line(v: &Value) -> bool {
    match connect() {
        Some(mut s) => writeln!(s, "{v}").is_ok(),
        None => false,
    }
}

fn request(v: &Value) -> Option<String> {
    let mut s = connect()?;
    writeln!(s, "{v}").ok()?;
    let mut line = String::new();
    BufReader::new(s).read_line(&mut line).ok()?;
    Some(line.trim().to_string())
}

fn usage() -> ! {
    eprintln!(
        "hv - control homeview

  hv emit llm <agent> <started|finished|input>
  hv emit focus <app> [title]
  hv emit track <title> [artist]
  hv emit site <domain>
  hv emit raw '<json>'
  hv timer <5m|90s|1h30m|pause|resume|cancel|add 5m>
  hv media <play|next|prev|seek <secs>>
  hv source <mpris|focus|browser|llm|ollama> <on|off>
  hv hide | show | toggle
  hv say <text>
  hv today            print today's summary (JSON)
  hv status           print one live frame (JSON)
  hv reload           re-read config.toml
  hv reload-ui        rebuild the popup from the installed extension files (no logout)
  hv native-host      browser native-messaging bridge (internal)"
    );
    std::process::exit(2)
}

/// "90", "90s", "15m", "1h30m", "1h" -> seconds.
fn parse_duration(s: &str) -> Option<f32> {
    let s = s.trim().to_lowercase();
    if let Ok(n) = s.parse::<f32>() {
        return Some(n * 60.0); // bare number means minutes
    }
    let (mut total, mut num) = (0.0f32, String::new());
    for ch in s.chars() {
        if ch.is_ascii_digit() || ch == '.' {
            num.push(ch);
        } else {
            let n: f32 = num.parse().ok()?;
            num.clear();
            total += n * match ch {
                'h' => 3600.0,
                'm' => 60.0,
                's' => 1.0,
                _ => return None,
            };
        }
    }
    if !num.is_empty() {
        return None;
    }
    (total > 0.0).then_some(total)
}

fn emit(args: &[String]) -> Value {
    let a = |i: usize| args.get(i).cloned().unwrap_or_default();
    match a(0).as_str() {
        "llm" if args.len() >= 3 => json!({"t": "llm", "agent": a(1), "state": a(2)}),
        "focus" if args.len() >= 2 => json!({"t": "focus", "app": a(1), "title": a(2)}),
        "track" if args.len() >= 2 => json!({"t": "track", "title": a(1), "artist": a(2), "playing": true}),
        "site" if args.len() >= 2 => json!({"t": "site", "domain": a(1)}),
        "raw" if args.len() >= 2 => serde_json::from_str(&a(1)).unwrap_or_else(|e| {
            eprintln!("hv: bad json: {e}");
            std::process::exit(2)
        }),
        _ => usage(),
    }
}

/// Chrome/Firefox native messaging: 4-byte native-endian length + JSON.
fn native_host() {
    let mut stdin = std::io::stdin().lock();
    loop {
        let mut len = [0u8; 4];
        if stdin.read_exact(&mut len).is_err() {
            return;
        }
        let n = u32::from_ne_bytes(len) as usize;
        if n == 0 || n > 1 << 20 {
            return;
        }
        let mut buf = vec![0u8; n];
        if stdin.read_exact(&mut buf).is_err() {
            return;
        }
        if let Ok(v) = serde_json::from_slice::<Value>(&buf) {
            // Only the site event is accepted from the browser, and only a bare domain.
            if v.get("t").and_then(Value::as_str) == Some("site") {
                if let Some(d) = v.get("domain").and_then(Value::as_str) {
                    let d: String = d.chars().take(253).collect();
                    send_line(&json!({"t": "site", "domain": d}));
                }
            }
        }
    }
}

fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    match args.first().map(String::as_str) {
        Some("emit") => {
            // Hooks must never fail: ignore a missing daemon.
            send_line(&emit(&args[1..]));
        }
        Some("hide") => {
            send_line(&json!({"t": "hide", "hidden": true}));
        }
        Some("show") => {
            send_line(&json!({"t": "hide", "hidden": false}));
        }
        Some("toggle") => {
            send_line(&json!({"t": "hide"}));
        }
        Some("timer") => {
            let a = args.get(1).map(String::as_str).unwrap_or("");
            let v = match a {
                "pause" | "resume" | "cancel" | "toggle" => json!({"t": "timer", "action": a}),
                "add" => match args.get(2).and_then(|d| parse_duration(d)) {
                    Some(secs) => json!({"t": "timer", "action": "add", "secs": secs}),
                    None => usage(),
                },
                d => match parse_duration(d) {
                    Some(secs) => json!({"t": "timer", "action": "start", "secs": secs}),
                    None => usage(),
                },
            };
            send_line(&v);
        }
        Some("media") => {
            let cmd = match (args.get(1).map(String::as_str), args.get(2)) {
                (Some("play" | "pause" | "toggle"), _) => "play_pause".to_string(),
                (Some("next"), _) => "next".to_string(),
                (Some("prev" | "previous"), _) => "previous".to_string(),
                (Some("seek"), Some(n)) => format!("seek_to:{n}"),
                _ => usage(),
            };
            send_line(&json!({"t": "media", "cmd": cmd}));
        }
        Some("source") if args.len() >= 3 => {
            send_line(&json!({"t": "toggle", "source": args[1], "on": args[2] == "on"}));
        }
        Some("say") if args.len() >= 2 => {
            send_line(&json!({"t": "speech", "text": args[1..].join(" ")}));
        }
        Some("reload-ui") => {
            send_line(&json!({"t": "reload_ui"}));
        }
        Some("reload") => {
            send_line(&json!({"t": "reload"}));
        }
        Some("today") => match request(&json!({"t": "today"})) {
            Some(l) => println!("{l}"),
            None => {
                eprintln!("hv: homeviewd is not running");
                std::process::exit(1);
            }
        },
        Some("status") => {
            let Some(mut s) = connect() else {
                eprintln!("hv: homeviewd is not running");
                std::process::exit(1);
            };
            let _ = writeln!(s, r#"{{"t":"subscribe"}}"#);
            let mut line = String::new();
            let _ = BufReader::new(s).read_line(&mut line);
            print!("{line}");
        }
        Some("native-host") => native_host(),
        _ => usage(),
    }
}

#[cfg(test)]
mod tests {
    use super::parse_duration;

    #[test]
    fn durations() {
        assert_eq!(parse_duration("15m"), Some(900.0));
        assert_eq!(parse_duration("90s"), Some(90.0));
        assert_eq!(parse_duration("1h30m"), Some(5400.0));
        assert_eq!(parse_duration("25"), Some(1500.0));
        assert_eq!(parse_duration("abc"), None);
        assert_eq!(parse_duration("5x"), None);
        assert_eq!(parse_duration("0m"), None);
    }
}
