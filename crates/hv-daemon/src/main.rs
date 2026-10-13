mod server;
mod store;

use chrono::{Local, Timelike};
use hv_collectors::{llm, mpris, weather};
use hv_core::config::{expand_home, socket_path};
use hv_core::{Category, Classifier, Config, Engine, Event, Face, Source};
use server::{Frames, Input};
use std::sync::Arc;
use std::time::{Duration, Instant, SystemTime};
use store::Store;
use tokio::sync::{broadcast, mpsc};

const TICK: Duration = Duration::from_millis(33);
const FOCUS_BLOCK_SECS: f64 = 20.0 * 60.0;

struct Brain {
    cfg: Config,
    cfg_mtime: Option<SystemTime>,
    eng: Engine,
    face: Face,
    store: Store,
    start: Instant,
    last_tick: Instant,
    secs: u64,
    work_streak: f64,
    away: f64,
    block_counted: bool,
    last_speech: Instant,
    ev_tx: mpsc::Sender<Input>,
    media_tx: mpsc::Sender<String>,
}

fn data_path() -> std::path::PathBuf {
    let base = std::env::var_os("XDG_DATA_HOME")
        .map(std::path::PathBuf::from)
        .or_else(|| std::env::var_os("HOME").map(|h| std::path::PathBuf::from(h).join(".local/share")))
        .unwrap_or_else(|| std::path::PathBuf::from("."));
    base.join("homeview").join("day.db")
}

fn today_str() -> String {
    Local::now().format("%Y-%m-%d").to_string()
}

/// Set `[sources] <name> = on` in the config file without disturbing the
/// rest of it (comments and ordering are preserved).
fn persist_source(path: &std::path::Path, name: &str, on: bool) -> std::io::Result<()> {
    let text = std::fs::read_to_string(path).unwrap_or_default();
    let mut doc = text
        .parse::<toml_edit::DocumentMut>()
        .map_err(|e| std::io::Error::new(std::io::ErrorKind::InvalidData, e))?;
    doc["sources"][name] = toml_edit::value(on);
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir)?;
    }
    std::fs::write(path, doc.to_string())
}

fn cfg_mtime() -> Option<SystemTime> {
    std::fs::metadata(Config::path()).and_then(|m| m.modified()).ok()
}

impl Brain {
    fn new(cfg: Config, store: Store, ev_tx: mpsc::Sender<Input>, media_tx: mpsc::Sender<String>) -> Self {
        let mut eng = Engine::new(Classifier::new(cfg.categories.clone()));
        eng.ctx.tokens_today = store.get("tokens") as u64;
        let seed = SystemTime::now().duration_since(SystemTime::UNIX_EPOCH).map(|d| d.as_nanos() as u64).unwrap_or(7);
        Self {
            cfg,
            cfg_mtime: cfg_mtime(),
            eng,
            face: Face::new(seed),
            store,
            start: Instant::now(),
            last_tick: Instant::now(),
            secs: 0,
            work_streak: 0.0,
            away: 0.0,
            block_counted: false,
            last_speech: Instant::now(),
            ev_tx,
            media_tx,
        }
    }

    fn now(&self) -> f64 {
        self.start.elapsed().as_secs_f64()
    }

    fn source_enabled(&self, s: Source) -> bool {
        match s {
            Source::Mpris => self.cfg.sources.mpris,
            Source::Focus => self.cfg.sources.focus,
            Source::Browser => self.cfg.sources.browser,
            Source::Llm => self.cfg.sources.llm,
            Source::Always => true,
        }
    }

    fn on_event(&mut self, ev: Event) {
        if !self.source_enabled(ev.source()) {
            return;
        }
        match &ev {
            Event::Media { cmd } => {
                let _ = self.media_tx.try_send(cmd.clone());
                return;
            }
            Event::Toggle { source, on } => {
                self.set_source(source, *on);
                return;
            }
            _ => {}
        }
        if let Event::Tokens { count, .. } = &ev {
            self.store.add("tokens", *count as f64);
        }
        let now = self.now();
        self.eng.apply(&ev, now);
    }

    /// Flip a source switch live and write it back to config.toml.
    fn set_source(&mut self, name: &str, on: bool) {
        let s = &mut self.cfg.sources;
        match name {
            "mpris" => s.mpris = on,
            "focus" => s.focus = on,
            "browser" => s.browser = on,
            "llm" => s.llm = on,
            "ollama" => s.ollama = on,
            _ => return,
        }
        if let Err(e) = persist_source(&Config::path(), name, on) {
            eprintln!("could not save config: {e}");
        }
        self.cfg_mtime = cfg_mtime();
    }

    fn on_tick(&mut self, frames: &Frames) {
        let real_dt = self.last_tick.elapsed().as_secs_f64().min(0.5);
        self.last_tick = Instant::now();
        let now = self.now();
        let hour = Local::now().hour();
        self.eng.step(real_dt, now, hour);
        // Sub-step the springs so a slow tick can't destabilise them.
        let mut rem = real_dt as f32;
        let mut t = now - real_dt;
        while rem > 1e-4 {
            let d = rem.min(1.0 / 30.0);
            t += d as f64;
            self.face.update(&mut self.eng, t, d);
            rem -= d;
        }
        if frames.receiver_count() > 0 {
            let mut f = self.face.frame(&self.eng, self.cfg.llm.daily_token_goal, now);
            f.sources = self.cfg.sources.clone();
            if let Ok(s) = serde_json::to_string(&f) {
                let _ = frames.send(Arc::new(s));
            }
        }
    }

    fn on_second(&mut self) {
        self.secs += 1;
        let now = Local::now();
        match self.store.roll_day(&today_str()) {
            Ok(true) => self.eng.ctx.tokens_today = self.store.get("tokens") as u64,
            Ok(false) => {}
            Err(e) => eprintln!("store: {e}"),
        }
        let idle = self.eng.ctx.idle;
        let cat = self.eng.ctx.category();
        if !idle {
            self.store.add(&format!("cat.{}", cat.as_str()), 1.0);
        }
        if self.eng.ctx.playing && self.cfg.sources.mpris {
            self.store.add("music", 1.0);
        }
        if self.eng.llm_busy() {
            self.store.add("llm", 1.0);
        }
        if cat == Category::Work && !idle {
            self.work_streak += 1.0;
            self.away = 0.0;
            if self.work_streak >= FOCUS_BLOCK_SECS && !self.block_counted {
                self.block_counted = true;
                self.store.add("focus_blocks", 1.0);
            }
        } else {
            self.away += 1.0;
            if self.away > 60.0 {
                self.work_streak = 0.0;
                self.block_counted = false;
            }
        }
        if self.secs % 30 == 0 {
            self.store.sample_mood(now.hour(), &self.eng.mood);
            if let Err(e) = self.store.flush() {
                eprintln!("store flush: {e}");
            }
        }
        if self.secs % 5 == 0 {
            self.maybe_reload();
            self.maybe_speak();
        }
    }

    fn maybe_reload(&mut self) {
        let m = cfg_mtime();
        if m != self.cfg_mtime {
            self.reload();
        }
    }

    fn reload(&mut self) {
        let (cfg, err) = Config::load();
        if let Some(e) = err {
            eprintln!("{e}; keeping previous config");
            self.cfg_mtime = cfg_mtime();
            return;
        }
        self.eng.set_classifier(Classifier::new(cfg.categories.clone()));
        self.cfg = cfg;
        self.cfg_mtime = cfg_mtime();
        eprintln!("config reloaded");
    }

    fn maybe_speak(&mut self) {
        let o = &self.cfg.ollama;
        if o.speak_every_min == 0 || o.model.is_empty() || !self.cfg.sources.ollama {
            return;
        }
        if self.last_speech.elapsed() < Duration::from_secs(o.speak_every_min * 60) {
            return;
        }
        self.last_speech = Instant::now();
        let summary = store::story(&self.store);
        let (host, model) = (o.host.clone(), o.model.clone());
        let tx = self.ev_tx.clone();
        tokio::spawn(async move {
            if let Some(text) = llm::one_liner(&host, &model, &summary).await {
                let _ = tx.send(Input::Ev(Event::Speech { text })).await;
            }
        });
    }

    fn today(&self) -> String {
        self.store.today(self.cfg.llm.daily_token_goal).to_string()
    }
}

#[tokio::main]
async fn main() {
    let (cfg, err) = Config::load();
    if let Some(e) = err {
        eprintln!("{e}; using defaults");
    }
    let day = today_str();
    let store = match Store::open(&data_path(), &day) {
        Ok(s) => s,
        Err(e) => {
            eprintln!("cannot open day log ({e}); running in memory");
            Store::in_memory(&day).expect("in-memory sqlite")
        }
    };

    let (tx, mut rx) = mpsc::channel::<Input>(1024);
    let (frames, _) = broadcast::channel::<Arc<String>>(8);

    let sock = socket_path();
    {
        let (tx, frames) = (tx.clone(), frames.clone());
        let sock = sock.clone();
        tokio::spawn(async move {
            if let Err(e) = server::serve(&sock, tx, frames).await {
                eprintln!("socket: {e}");
                std::process::exit(1);
            }
        });
    }

    // Collectors push plain events; the brain wraps and filters them.
    let (ev_tx, mut ev_rx) = mpsc::channel::<Event>(256);
    {
        let tx = tx.clone();
        tokio::spawn(async move {
            while let Some(e) = ev_rx.recv().await {
                if tx.send(Input::Ev(e)).await.is_err() {
                    break;
                }
            }
        });
    }
    // Collectors always run; the brain drops events from switched-off
    // sources, so toggling in the UI takes effect without a restart.
    let (media_tx, media_rx) = mpsc::channel::<String>(16);
    tokio::spawn(mpris::run(ev_tx.clone(), media_rx));
    tokio::spawn(llm::tail_sessions(ev_tx.clone(), expand_home(&cfg.llm.claude_dir), expand_home(&cfg.llm.codex_dir)));
    tokio::spawn(llm::poll_ollama(ev_tx.clone(), cfg.ollama.host.clone()));
    tokio::spawn(weather::run(ev_tx.clone()));

    let mut brain = Brain::new(cfg, store, tx.clone(), media_tx);
    let mut tick = tokio::time::interval(TICK);
    tick.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
    let mut sec = tokio::time::interval(Duration::from_secs(1));
    let mut term = tokio::signal::unix::signal(tokio::signal::unix::SignalKind::terminate()).expect("sigterm");
    eprintln!("homeviewd listening on {}", sock.display());

    loop {
        tokio::select! {
            Some(inp) = rx.recv() => match inp {
                Input::Ev(e) => brain.on_event(e),
                Input::Today(reply) => { let _ = reply.send(brain.today()); }
                Input::Reload => brain.reload(),
            },
            _ = tick.tick() => brain.on_tick(&frames),
            _ = sec.tick() => brain.on_second(),
            _ = tokio::signal::ctrl_c() => break,
            _ = term.recv() => break,
        }
    }
    if let Err(e) = brain.store.flush() {
        eprintln!("final flush: {e}");
    }
    let _ = std::fs::remove_file(&sock);
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn persist_keeps_comments_and_other_keys() {
        let p = std::env::temp_dir().join(format!("hv-cfg-{}.toml", std::process::id()));
        std::fs::write(&p, "# my notes\nface = 1\n[sources]\nmpris = true # keep\n").unwrap();
        persist_source(&p, "mpris", false).unwrap();
        persist_source(&p, "browser", true).unwrap();
        let out = std::fs::read_to_string(&p).unwrap();
        assert!(out.contains("# my notes"));
        assert!(out.contains("mpris = false"));
        assert!(out.contains("browser = true"));
        let cfg = Config::parse(&out).unwrap();
        assert!(!cfg.sources.mpris && cfg.sources.browser);
        let _ = std::fs::remove_file(&p);
    }

    #[test]
    fn persist_creates_missing_file() {
        let p = std::env::temp_dir().join(format!("hv-cfg-new-{}/c.toml", std::process::id()));
        persist_source(&p, "llm", false).unwrap();
        assert!(!Config::parse(&std::fs::read_to_string(&p).unwrap()).unwrap().sources.llm);
        let _ = std::fs::remove_dir_all(p.parent().unwrap());
    }
}
