use crate::mood::{Engine, Mood};
use serde::Serialize;

/// Critically-ish damped spring, semi-implicit Euler.
#[derive(Debug, Clone, Copy)]
pub struct Spring {
    pub x: f32,
    pub v: f32,
    pub target: f32,
    k: f32,
}

impl Spring {
    pub fn new(x: f32, k: f32) -> Self {
        Self { x, v: 0.0, target: x, k }
    }

    pub fn step(&mut self, dt: f32) {
        let c = 2.0 * self.k.sqrt() * 0.75;
        let a = self.k * (self.target - self.x) - c * self.v;
        self.v += a * dt;
        self.x += self.v * dt;
    }
}

struct Rng(u64);

impl Rng {
    fn next(&mut self) -> f32 {
        self.0 ^= self.0 << 13;
        self.0 ^= self.0 >> 7;
        self.0 ^= self.0 << 17;
        (self.0 >> 11) as f32 / (1u64 << 53) as f32
    }
}

#[derive(Debug, Clone, Serialize)]
pub struct Frame {
    pub t: &'static str,
    pub eye: f32,
    pub px: f32,
    pub py: f32,
    pub brow: f32,
    pub mouth: f32,
    pub mouth_open: f32,
    pub blush: f32,
    pub tilt: f32,
    pub bounce: f32,
    pub breathe: f32,
    pub hue: f32,
    pub sat: f32,
    pub hidden: bool,
    pub playing: bool,
    pub llm: bool,
    pub status: String,
    pub speech: Option<String>,
    pub food: f32,
    pub style: String,
    pub mood: Mood,
}

pub struct Face {
    eye: Spring,
    px: Spring,
    py: Spring,
    brow: Spring,
    mouth: Spring,
    mouth_open: Spring,
    blush: Spring,
    tilt: Spring,
    bounce: Spring,
    hue: f32,
    sat: Spring,
    rng: Rng,
    next_blink: f64,
    blink_until: f64,
    breathe: f32,
}

fn hash_hue(s: &str) -> f32 {
    let mut h: u32 = 2166136261;
    for b in s.bytes() {
        h ^= b as u32;
        h = h.wrapping_mul(16777619);
    }
    (h % 360) as f32
}

fn wrap_deg(d: f32) -> f32 {
    ((d + 540.0) % 360.0) - 180.0
}

impl Face {
    pub fn new(seed: u64) -> Self {
        Self {
            eye: Spring::new(0.9, 300.0),
            px: Spring::new(0.0, 160.0),
            py: Spring::new(0.0, 160.0),
            brow: Spring::new(0.0, 120.0),
            mouth: Spring::new(0.2, 100.0),
            mouth_open: Spring::new(0.0, 200.0),
            blush: Spring::new(0.0, 60.0),
            tilt: Spring::new(0.0, 60.0),
            bounce: Spring::new(0.0, 220.0),
            hue: 210.0,
            sat: Spring::new(0.0, 30.0),
            rng: Rng(seed | 1),
            next_blink: 2.0,
            blink_until: 0.0,
            breathe: 0.0,
        }
    }

    /// Advance one animation step. `dt` should be small (<= ~1/30 s); callers
    /// with bigger gaps should loop.
    pub fn update(&mut self, eng: &mut Engine, now: f64, dt: f32) {
        let m = eng.mood;
        let sleepy = m.sleepiness;

        if eng.bounce {
            eng.bounce = false;
            self.bounce.v = -7.0;
        }

        // Blinking: rarer and slower when sleepy.
        if now >= self.next_blink {
            self.blink_until = now + 0.12 + 0.25 * sleepy as f64;
            self.next_blink = now + 2.5 + (self.rng.next() * 3.5 + sleepy * 4.0) as f64;
        }
        let blinking = now < self.blink_until;
        let base_open = 0.9 - 0.55 * sleepy + 0.12 * m.curiosity;
        self.eye.target = if blinking { 0.0 } else { base_open.clamp(0.1, 1.0) };

        // Gaze: follows the cursor, unless something grabs attention.
        let (cx, cy) = eng.ctx.cursor;
        let (mut tx, mut ty) = (cx * 0.7, cy * 0.5);
        let sideeye = now < eng.sideeye_until;
        if sideeye {
            tx = -0.95;
            ty = 0.05;
        } else if now < eng.glance_until {
            tx = 0.85;
            ty = 0.1;
        }
        self.px.target = tx;
        self.py.target = ty;

        // Brow: focus pulls it down, curiosity lifts it.
        let mut brow = -(m.focus - 0.4) * 0.9 + m.curiosity * 0.6;
        if sideeye {
            brow = -0.5;
        }
        self.brow.target = brow.clamp(-1.0, 1.0);

        // Mouth: curve from joy, flatter when sleepy.
        self.mouth.target = ((m.joy - 0.35) * 1.6 - sleepy * 0.3).clamp(-0.6, 1.0);
        let talking = eng.ctx.speech.is_some();
        self.mouth_open.target = if talking { 0.35 + 0.3 * ((now * 12.0).sin() as f32).abs() } else if sleepy > 0.8 { 0.2 } else { 0.0 };
        self.blush.target = ((m.joy - 0.6) * 2.0).clamp(0.0, 1.0);

        // Body language.
        let mut tilt = 0.0;
        if eng.ctx.playing {
            tilt += ((now * 1.6).sin() as f32) * 3.0 * (0.4 + m.energy);
        }
        if now < eng.wave_until {
            tilt += ((now * 14.0).sin() as f32) * 9.0;
        }
        tilt += sleepy * 6.0 * ((now * 0.3).sin() as f32 * 0.5 + 0.5);
        self.tilt.target = tilt;
        self.bounce.target = 0.0;

        // Tint follows the track; desaturates when there's nothing playing.
        if let Some((t, a)) = &eng.ctx.track {
            let target = hash_hue(&format!("{t}{a}"));
            self.hue = (self.hue + wrap_deg(target - self.hue) * (dt * 3.0).min(1.0) + 360.0) % 360.0;
        }
        self.sat.target = if eng.ctx.playing { 0.55 } else { 0.0 };

        for s in [
            &mut self.eye, &mut self.px, &mut self.py, &mut self.brow, &mut self.mouth,
            &mut self.mouth_open, &mut self.blush, &mut self.tilt, &mut self.bounce, &mut self.sat,
        ] {
            s.step(dt);
        }
        self.breathe = ((now * std::f64::consts::TAU / 4.0).sin() as f32) * 0.5 + 0.5;
    }

    pub fn frame(&self, eng: &Engine, goal: u64, style: &str) -> Frame {
        let status = match (&eng.ctx.track, eng.ctx.playing) {
            (Some((t, a)), true) if !a.is_empty() => format!("♪ {t} — {a}"),
            (Some((t, _)), true) => format!("♪ {t}"),
            _ => String::new(),
        };
        Frame {
            t: "frame",
            eye: self.eye.x.clamp(0.0, 1.1),
            px: self.px.x,
            py: self.py.x,
            brow: self.brow.x,
            mouth: self.mouth.x,
            mouth_open: self.mouth_open.x.max(0.0),
            blush: self.blush.x.clamp(0.0, 1.0),
            tilt: self.tilt.x,
            bounce: self.bounce.x,
            breathe: self.breathe,
            hue: self.hue,
            sat: self.sat.x.clamp(0.0, 1.0),
            hidden: eng.ctx.hidden,
            playing: eng.ctx.playing,
            llm: eng.llm_busy(),
            status,
            speech: eng.ctx.speech.as_ref().map(|(s, _)| s.clone()),
            food: if goal == 0 { 0.0 } else { (eng.ctx.tokens_today as f32 / goal as f32).min(1.0) },
            style: style.to_string(),
            mood: eng.mood,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::config::Categories;
    use crate::mood::Classifier;

    #[test]
    fn spring_converges() {
        let mut s = Spring::new(0.0, 120.0);
        s.target = 1.0;
        for _ in 0..300 {
            s.step(1.0 / 60.0);
        }
        assert!((s.x - 1.0).abs() < 0.01);
    }

    #[test]
    fn blinks_happen() {
        let mut eng = Engine::new(Classifier::new(Categories::default()));
        let mut f = Face::new(42);
        let mut min = 1.0f32;
        let dt = 1.0 / 30.0;
        for i in 0..(30 * 20) {
            let now = i as f64 * dt as f64;
            f.update(&mut eng, now, dt);
            min = min.min(f.eye.x);
        }
        assert!(min < 0.2, "eye never closed: {min}");
    }

    #[test]
    fn sleepy_eyes_droop() {
        let mut eng = Engine::new(Classifier::new(Categories::default()));
        eng.mood.sleepiness = 1.0;
        let mut f = Face::new(1);
        let dt = 1.0 / 30.0;
        // Start after the first blink window so we sample the resting pose.
        for i in 0..(30 * 3) {
            f.update(&mut eng, 10.0 + i as f64 * dt as f64, dt);
        }
        assert!(f.eye.target < 0.5);
    }

    #[test]
    fn sideeye_looks_left() {
        let mut eng = Engine::new(Classifier::new(Categories::default()));
        eng.sideeye_until = 100.0;
        let mut f = Face::new(1);
        for i in 0..120 {
            f.update(&mut eng, i as f64 / 30.0, 1.0 / 30.0);
        }
        assert!(f.px.x < -0.7);
    }

    #[test]
    fn frame_serializes() {
        let eng = Engine::new(Classifier::new(Categories::default()));
        let f = Face::new(1);
        let s = serde_json::to_string(&f.frame(&eng, 1000, "classic")).unwrap();
        assert!(s.starts_with(r#"{"t":"frame""#));
    }
}
