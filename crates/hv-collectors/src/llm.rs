//! LLM activity: tail Claude Code / Codex session files for token counts and
//! liveness, and poll a local Ollama. Claude Code hooks (`hv emit llm ...`)
//! are more precise; this is the fallback and the only token source.

use crate::http;
use hv_core::{Event, LlmState};
use serde_json::Value;
use std::collections::HashMap;
use std::io::{Read, Seek, SeekFrom};
use std::path::{Path, PathBuf};
use std::time::{Duration, SystemTime};
use tokio::sync::mpsc::Sender;

const RECENT: Duration = Duration::from_secs(15 * 60);
const QUIET_AFTER: Duration = Duration::from_secs(8);

/// Sum input+output tokens from a session line. Looks at `usage` (Claude) and
/// `last_token_usage` (Codex) and deliberately ignores cumulative totals.
pub fn line_tokens(v: &Value) -> u64 {
    match v {
        Value::Object(m) => {
            for key in ["usage", "last_token_usage"] {
                if let Some(Value::Object(u)) = m.get(key) {
                    let g = |k: &str| u.get(k).and_then(Value::as_u64).unwrap_or(0);
                    return g("input_tokens") + g("output_tokens");
                }
            }
            m.values().map(line_tokens).sum()
        }
        Value::Array(a) => a.iter().map(line_tokens).sum(),
        _ => 0,
    }
}

fn walk(dir: &Path, depth: u32, out: &mut Vec<(PathBuf, SystemTime, u64)>) {
    let Ok(rd) = std::fs::read_dir(dir) else { return };
    for e in rd.flatten() {
        let p = e.path();
        let Ok(md) = e.metadata() else { continue };
        if md.is_dir() {
            if depth > 0 {
                walk(&p, depth - 1, out);
            }
        } else if p.extension().is_some_and(|x| x == "jsonl") {
            if let Ok(m) = md.modified() {
                if SystemTime::now().duration_since(m).map(|d| d < RECENT).unwrap_or(true) {
                    out.push((p, m, md.len()));
                }
            }
        }
    }
}

struct Tail {
    offsets: HashMap<PathBuf, u64>,
}

impl Tail {
    /// Returns (new complete lines, tokens) for one file.
    fn read_new(&mut self, path: &Path, len: u64, first_scan: bool) -> (usize, u64) {
        let off = match self.offsets.get(path) {
            Some(o) => *o,
            None => {
                // Files that already exist at startup are not replayed.
                self.offsets.insert(path.to_path_buf(), if first_scan { len } else { 0 });
                if first_scan {
                    return (0, 0);
                }
                0
            }
        };
        if len < off {
            self.offsets.insert(path.to_path_buf(), len);
            return (0, 0);
        }
        if len == off {
            return (0, 0);
        }
        let Ok(mut f) = std::fs::File::open(path) else { return (0, 0) };
        if f.seek(SeekFrom::Start(off)).is_err() {
            return (0, 0);
        }
        let mut buf = Vec::with_capacity((len - off).min(4 << 20) as usize);
        if f.take(4 << 20).read_to_end(&mut buf).is_err() {
            return (0, 0);
        }
        let Some(last_nl) = buf.iter().rposition(|b| *b == b'\n') else { return (0, 0) };
        let consumed = &buf[..=last_nl];
        self.offsets.insert(path.to_path_buf(), off + consumed.len() as u64);
        let mut lines = 0;
        let mut tokens = 0;
        for line in consumed.split(|b| *b == b'\n').filter(|l| !l.is_empty()) {
            lines += 1;
            if let Ok(v) = serde_json::from_slice::<Value>(line) {
                tokens += line_tokens(&v);
            }
        }
        (lines, tokens)
    }
}

pub async fn tail_sessions(tx: Sender<Event>, claude_dir: PathBuf, codex_dir: PathBuf) {
    let mut tail = Tail { offsets: HashMap::new() };
    let mut last_activity: HashMap<&'static str, std::time::Instant> = HashMap::new();
    let mut busy: HashMap<&'static str, bool> = HashMap::new();
    let mut first = true;
    loop {
        for (agent, dir, depth) in [("claude", &claude_dir, 3u32), ("codex", &codex_dir, 5u32)] {
            let mut files = Vec::new();
            walk(dir, depth, &mut files);
            let mut lines = 0;
            let mut tokens = 0;
            for (p, _, len) in files {
                let (l, t) = tail.read_new(&p, len, first);
                lines += l;
                tokens += t;
            }
            if tokens > 0 && tx.send(Event::Tokens { agent: agent.into(), count: tokens }).await.is_err() {
                return;
            }
            if lines > 0 {
                last_activity.insert(agent, std::time::Instant::now());
                if !busy.get(agent).copied().unwrap_or(false) {
                    busy.insert(agent, true);
                    if tx.send(Event::Llm { agent: agent.into(), state: LlmState::Started }).await.is_err() {
                        return;
                    }
                }
            } else if busy.get(agent).copied().unwrap_or(false) {
                if last_activity.get(agent).is_some_and(|t| t.elapsed() > QUIET_AFTER) {
                    busy.insert(agent, false);
                    if tx.send(Event::Llm { agent: agent.into(), state: LlmState::Finished }).await.is_err() {
                        return;
                    }
                }
            }
        }
        first = false;
        tokio::time::sleep(Duration::from_secs(1)).await;
    }
}

pub async fn poll_ollama(tx: Sender<Event>, host: String) {
    let mut loaded = false;
    loop {
        let now_loaded = match http::request(&host, "GET", "/api/ps", None).await {
            Ok(body) => serde_json::from_str::<Value>(&body)
                .ok()
                .and_then(|v| v.get("models").and_then(Value::as_array).map(|a| !a.is_empty()))
                .unwrap_or(false),
            Err(_) => false,
        };
        if now_loaded != loaded {
            loaded = now_loaded;
            let state = if loaded { LlmState::Started } else { LlmState::Finished };
            if tx.send(Event::Llm { agent: "ollama".into(), state }).await.is_err() {
                return;
            }
        }
        tokio::time::sleep(Duration::from_secs(5)).await;
    }
}

/// Ask the local model for one short line. Returns None on any failure.
pub async fn one_liner(host: &str, model: &str, summary: &str) -> Option<String> {
    let prompt = format!(
        "You are a tiny friendly desktop companion. In one short sentence (max 12 words, no emoji, no quotes), comment on the user's day so far: {summary}"
    );
    let body = serde_json::json!({"model": model, "prompt": prompt, "stream": false}).to_string();
    let resp = http::request(host, "POST", "/api/generate", Some(&body)).await.ok()?;
    let v: Value = serde_json::from_str(&resp).ok()?;
    let text = v.get("response")?.as_str()?.trim().trim_matches('"').to_string();
    if text.is_empty() {
        None
    } else {
        Some(text.chars().take(120).collect())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn claude_usage() {
        let v: Value = serde_json::from_str(
            r#"{"type":"assistant","message":{"usage":{"input_tokens":10,"output_tokens":5,"cache_read_input_tokens":999}}}"#,
        )
        .unwrap();
        assert_eq!(line_tokens(&v), 15);
    }

    #[test]
    fn codex_last_not_total() {
        let v: Value = serde_json::from_str(
            r#"{"payload":{"info":{"total_token_usage":{"input_tokens":1000,"output_tokens":500},"last_token_usage":{"input_tokens":20,"output_tokens":4}}}}"#,
        )
        .unwrap();
        assert_eq!(line_tokens(&v), 24);
    }

    #[test]
    fn no_usage_is_zero() {
        let v: Value = serde_json::from_str(r#"{"type":"user","message":"hi"}"#).unwrap();
        assert_eq!(line_tokens(&v), 0);
    }

    #[test]
    fn tail_reads_only_new_complete_lines() {
        let dir = std::env::temp_dir().join(format!("hv-tail-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let p = dir.join("s.jsonl");
        std::fs::write(&p, "{\"usage\":{\"input_tokens\":1,\"output_tokens\":1}}\n").unwrap();
        let mut t = Tail { offsets: HashMap::new() };
        let len = std::fs::metadata(&p).unwrap().len();
        assert_eq!(t.read_new(&p, len, true), (0, 0)); // existing content skipped
        use std::io::Write;
        let mut f = std::fs::OpenOptions::new().append(true).open(&p).unwrap();
        write!(f, "{{\"usage\":{{\"input_tokens\":3,\"output_tokens\":4}}}}\n{{\"partial").unwrap();
        let len = std::fs::metadata(&p).unwrap().len();
        assert_eq!(t.read_new(&p, len, false), (1, 7));
        writeln!(f, "\":1}}").unwrap();
        let len = std::fs::metadata(&p).unwrap().len();
        assert_eq!(t.read_new(&p, len, false), (1, 0));
        std::fs::remove_dir_all(&dir).ok();
    }
}
