use crate::config::Categories;
use crate::event::{Event, LlmState};
use serde::Serialize;
use std::collections::{HashMap, VecDeque};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum Category {
    Work,
    Watch,
    Social,
    Read,
    Other,
}

impl Category {
    pub fn as_str(self) -> &'static str {
        match self {
            Category::Work => "work",
            Category::Watch => "watch",
            Category::Social => "social",
            Category::Read => "read",
            Category::Other => "other",
        }
    }
}

#[derive(Debug, Clone)]
pub struct Classifier {
    cats: Categories,
}

impl Classifier {
    pub fn new(cats: Categories) -> Self {
        Self { cats }
    }

    pub fn classify(&self, text: &str) -> Category {
        let t = text.to_lowercase();
        let hit = |xs: &[String]| xs.iter().any(|x| !x.is_empty() && t.contains(&x.to_lowercase()));
        if hit(&self.cats.social) {
            Category::Social
        } else if hit(&self.cats.watch) {
            Category::Watch
        } else if hit(&self.cats.work) {
            Category::Work
        } else if hit(&self.cats.read) {
            Category::Read
        } else {
            Category::Other
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Serialize)]
pub struct Mood {
    pub energy: f32,
    pub focus: f32,
    pub joy: f32,
    pub curiosity: f32,
    pub sleepiness: f32,
}

impl Mood {
    fn clamp(&mut self) {
        for v in [&mut self.energy, &mut self.focus, &mut self.joy, &mut self.curiosity, &mut self.sleepiness] {
            *v = v.clamp(0.0, 1.0);
        }
    }
}

const HALF_LIFE: Mood = Mood { energy: 120.0, focus: 300.0, joy: 40.0, curiosity: 15.0, sleepiness: 120.0 };

/// Resting sleepiness by local hour.
pub fn night_sleepiness(hour: u32) -> f32 {
    match hour {
        2..=5 => 0.85,
        0 | 1 => 0.45,
        6 => 0.3,
        22 | 23 => 0.2,
        _ => 0.05,
    }
}

#[derive(Debug, Clone, Default)]
pub struct Context {
    pub playing: bool,
    pub track: Option<(String, String)>,
    pub idle: bool,
    pub category: Option<Category>,
    pub app: String,
    pub domain: Option<String>,
    /// agent -> time it started
    pub llm_busy: HashMap<String, f64>,
    pub tokens_today: u64,
    pub hidden: bool,
    pub speech: Option<(String, f64)>,
    pub cursor: (f32, f32),
}

impl Context {
    pub fn category(&self) -> Category {
        self.category.unwrap_or(Category::Other)
    }
}

pub struct Engine {
    pub mood: Mood,
    pub ctx: Context,
    classifier: Classifier,
    app_cat: Category,
    site_cat: Option<Category>,
    switches: VecDeque<f64>,
    last_switch: f64,
    idle_since: f64,
    pub glance_until: f64,
    pub sideeye_until: f64,
    pub wave_until: f64,
    pub bounce: bool,
}

impl Engine {
    pub fn new(classifier: Classifier) -> Self {
        Self {
            mood: Mood { energy: 0.5, focus: 0.3, joy: 0.4, curiosity: 0.2, sleepiness: 0.05 },
            ctx: Context::default(),
            classifier,
            app_cat: Category::Other,
            site_cat: None,
            switches: VecDeque::new(),
            last_switch: 0.0,
            idle_since: 0.0,
            glance_until: 0.0,
            sideeye_until: 0.0,
            wave_until: 0.0,
            bounce: false,
        }
    }

    pub fn set_classifier(&mut self, c: Classifier) {
        self.classifier = c;
    }

    fn effective_category(&self) -> Category {
        self.site_cat.filter(|c| *c != Category::Other).unwrap_or(self.app_cat)
    }

    fn recompute_category(&mut self, now: f64) {
        let new = self.effective_category();
        let old = self.ctx.category;
        self.ctx.category = Some(new);
        if old.is_some() && old != Some(new) {
            self.last_switch = now;
            self.mood.focus -= 0.06;
            if matches!(new, Category::Social | Category::Watch) {
                self.switches.push_back(now);
            }
            while self.switches.front().is_some_and(|t| now - t > 60.0) {
                self.switches.pop_front();
            }
            if self.switches.len() >= 4 {
                self.sideeye_until = now + 5.0;
                self.mood.focus -= 0.2;
                self.switches.clear();
            }
        }
    }

    pub fn apply(&mut self, ev: &Event, now: f64) {
        match ev {
            Event::Track { title, artist, playing } => {
                self.ctx.track = Some((title.clone(), artist.clone()));
                self.ctx.playing = *playing;
                self.mood.curiosity += 0.5;
                self.mood.joy += 0.05;
                self.glance_until = now + 2.5;
            }
            Event::Playback { playing } => {
                if *playing && !self.ctx.playing {
                    self.mood.joy += 0.1;
                    self.mood.energy += 0.1;
                }
                self.ctx.playing = *playing;
            }
            Event::Focus { app, title } => {
                self.ctx.app = app.clone();
                self.app_cat = self.classifier.classify(&format!("{app} {title}"));
                // Leaving a browser for something else drops the stale site.
                if !is_browser(app) {
                    self.site_cat = None;
                }
                self.recompute_category(now);
            }
            Event::Site { domain } => {
                self.ctx.domain = Some(domain.clone());
                self.site_cat = Some(self.classifier.classify(domain));
                self.recompute_category(now);
            }
            Event::Idle { idle } => {
                if *idle && !self.ctx.idle {
                    self.idle_since = now;
                } else if !*idle && self.ctx.idle {
                    if now - self.idle_since >= 120.0 {
                        self.mood.energy += 0.5;
                        self.mood.sleepiness -= 0.3;
                        self.wave_until = now + 2.5;
                    }
                }
                self.ctx.idle = *idle;
            }
            Event::Llm { agent, state } => match state {
                LlmState::Started => {
                    self.ctx.llm_busy.entry(agent.clone()).or_insert_with(|| {
                        now
                    });
                    self.mood.focus += 0.15;
                    self.mood.curiosity += 0.2;
                }
                LlmState::Finished => {
                    if let Some(since) = self.ctx.llm_busy.remove(agent) {
                        if now - since >= 30.0 {
                            self.mood.joy += 0.6;
                            self.bounce = true;
                        } else {
                            self.mood.joy += 0.2;
                        }
                    }
                }
                LlmState::Input => {
                    self.mood.curiosity += 0.4;
                    self.glance_until = now + 2.0;
                }
            },
            Event::Tokens { count, .. } => self.ctx.tokens_today += *count,
            Event::Cursor { x, y } => self.ctx.cursor = (x.clamp(-1.0, 1.0), y.clamp(-1.0, 1.0)),
            Event::Hide { hidden } => self.ctx.hidden = hidden.unwrap_or(!self.ctx.hidden),
            Event::Speech { text } => self.ctx.speech = Some((text.clone(), now + 12.0)),
        }
        self.mood.clamp();
    }

    pub fn step(&mut self, dt: f64, now: f64, hour: u32) {
        let mut base = Mood { energy: 0.5, focus: 0.3, joy: 0.4, curiosity: 0.2, sleepiness: night_sleepiness(hour) };
        if self.ctx.idle {
            base.energy = 0.2;
            base.sleepiness = (base.sleepiness + 0.3).min(1.0);
        }
        let k = |half: f32| 0.5f32.powf(dt as f32 / half);
        self.mood.energy = base.energy + (self.mood.energy - base.energy) * k(HALF_LIFE.energy);
        self.mood.focus = base.focus + (self.mood.focus - base.focus) * k(HALF_LIFE.focus);
        self.mood.joy = base.joy + (self.mood.joy - base.joy) * k(HALF_LIFE.joy);
        self.mood.curiosity = base.curiosity + (self.mood.curiosity - base.curiosity) * k(HALF_LIFE.curiosity);
        self.mood.sleepiness = base.sleepiness + (self.mood.sleepiness - base.sleepiness) * k(HALF_LIFE.sleepiness);

        // Long stretches in one work context build focus.
        if self.ctx.category() == Category::Work && !self.ctx.idle && now - self.last_switch > 120.0 {
            self.mood.focus += 0.02 * dt as f32;
        }
        if self.ctx.playing {
            self.mood.energy += 0.004 * dt as f32;
        }
        if let Some((_, until)) = &self.ctx.speech {
            if now > *until {
                self.ctx.speech = None;
            }
        }
        self.mood.clamp();
    }

    pub fn llm_busy(&self) -> bool {
        !self.ctx.llm_busy.is_empty()
    }
}

fn is_browser(app: &str) -> bool {
    let a = app.to_lowercase();
    ["firefox", "chrom", "brave", "vivaldi", "zen", "librewolf", "edge", "epiphany", "orion"].iter().any(|b| a.contains(b))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::config::Categories;

    fn engine() -> Engine {
        Engine::new(Classifier::new(Categories::default()))
    }

    fn focus(app: &str) -> Event {
        Event::Focus { app: app.into(), title: String::new() }
    }

    #[test]
    fn classifies() {
        let c = Classifier::new(Categories::default());
        assert_eq!(c.classify("kitty"), Category::Work);
        assert_eq!(c.classify("www.reddit.com"), Category::Social);
        assert_eq!(c.classify("youtube.com"), Category::Watch);
        assert_eq!(c.classify("calculator"), Category::Other);
    }

    #[test]
    fn rapid_social_switching_triggers_sideeye() {
        let mut e = engine();
        let mut t = 100.0;
        e.apply(&focus("firefox"), t);
        for _ in 0..5 {
            t += 5.0;
            e.apply(&Event::Site { domain: "github.com".into() }, t);
            t += 2.0;
            e.apply(&Event::Site { domain: "reddit.com".into() }, t);
        }
        assert!(e.sideeye_until > 100.0);
    }

    #[test]
    fn long_llm_task_makes_joy_and_bounce() {
        let mut e = engine();
        e.mood.joy = 0.2;
        e.apply(&Event::Llm { agent: "claude".into(), state: LlmState::Started }, 0.0);
        e.apply(&Event::Llm { agent: "claude".into(), state: LlmState::Finished }, 60.0);
        assert!(e.mood.joy >= 0.8);
        assert!(e.bounce);
    }

    #[test]
    fn short_llm_task_small_joy() {
        let mut e = engine();
        e.mood.joy = 0.2;
        e.apply(&Event::Llm { agent: "claude".into(), state: LlmState::Started }, 0.0);
        e.apply(&Event::Llm { agent: "claude".into(), state: LlmState::Finished }, 5.0);
        assert!(e.mood.joy < 0.5);
        assert!(!e.bounce);
    }

    #[test]
    fn sleepiness_rises_at_night() {
        let mut e = engine();
        for _ in 0..600 {
            e.step(1.0, 0.0, 3);
        }
        assert!(e.mood.sleepiness > 0.7);
        for _ in 0..1200 {
            e.step(1.0, 0.0, 14);
        }
        assert!(e.mood.sleepiness < 0.2);
    }

    #[test]
    fn back_after_idle_wakes_and_waves() {
        let mut e = engine();
        e.mood.energy = 0.1;
        e.apply(&Event::Idle { idle: true }, 0.0);
        e.apply(&Event::Idle { idle: false }, 300.0);
        assert!(e.mood.energy > 0.5);
        assert!(e.wave_until > 300.0);
    }

    #[test]
    fn new_track_sparks_curiosity_and_glance() {
        let mut e = engine();
        e.apply(&Event::Track { title: "a".into(), artist: "b".into(), playing: true }, 10.0);
        assert!(e.mood.curiosity >= 0.7);
        assert!(e.glance_until > 10.0);
        assert!(e.ctx.playing);
    }

    #[test]
    fn mood_decays_to_baseline() {
        let mut e = engine();
        e.mood.curiosity = 1.0;
        for _ in 0..120 {
            e.step(1.0, 0.0, 12);
        }
        assert!((e.mood.curiosity - 0.2).abs() < 0.02);
    }

    #[test]
    fn long_work_builds_focus() {
        let mut e = engine();
        e.apply(&focus("kitty"), 0.0);
        let before = e.mood.focus;
        for i in 0..600 {
            e.step(1.0, 200.0 + i as f64, 12);
        }
        assert!(e.mood.focus > before);
    }
}
