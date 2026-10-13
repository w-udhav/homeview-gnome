use serde::Serialize;

/// A single countdown. All times are seconds.
#[derive(Debug, Clone, Copy, Default, PartialEq, Serialize)]
pub struct Timer {
    pub total: f32,
    pub left: f32,
    pub running: bool,
}

impl Timer {
    pub fn start(&mut self, secs: f32) {
        if secs > 0.0 {
            self.total = secs;
            self.left = secs;
            self.running = true;
        }
    }

    pub fn pause(&mut self) {
        self.running = false;
    }

    pub fn resume(&mut self) {
        if self.left > 0.0 {
            self.running = true;
        }
    }

    pub fn toggle(&mut self) {
        if self.running {
            self.pause();
        } else {
            self.resume();
        }
    }

    pub fn cancel(&mut self) {
        *self = Timer::default();
    }

    /// Add (or remove) time on a live timer.
    pub fn add(&mut self, secs: f32) {
        if self.total > 0.0 {
            self.left = (self.left + secs).max(1.0);
            self.total = self.total.max(self.left);
        } else {
            self.start(secs);
        }
    }

    pub fn active(&self) -> bool {
        self.total > 0.0
    }

    /// Advance by `dt`. Returns true on the tick the timer reaches zero.
    pub fn tick(&mut self, dt: f32) -> bool {
        if !self.running {
            return false;
        }
        self.left -= dt;
        if self.left <= 0.0 {
            *self = Timer::default();
            return true;
        }
        false
    }

    pub fn apply(&mut self, action: &str, secs: f32) {
        match action {
            "start" => self.start(secs),
            "pause" => self.pause(),
            "resume" => self.resume(),
            "toggle" => self.toggle(),
            "cancel" => self.cancel(),
            "add" => self.add(secs),
            _ => {}
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn counts_down_and_finishes() {
        let mut t = Timer::default();
        t.start(3.0);
        assert!(!t.tick(1.0));
        assert!(!t.tick(1.0));
        assert!((t.left - 1.0).abs() < 1e-4);
        assert!(t.tick(1.5));
        assert!(!t.active());
    }

    #[test]
    fn pause_holds_time() {
        let mut t = Timer::default();
        t.start(10.0);
        t.tick(4.0);
        t.apply("pause", 0.0);
        assert!(!t.tick(100.0));
        assert!((t.left - 6.0).abs() < 1e-4);
        t.apply("toggle", 0.0);
        assert!(t.running);
    }

    #[test]
    fn cancel_and_add() {
        let mut t = Timer::default();
        t.apply("add", 60.0);
        assert!(t.running && t.total == 60.0);
        t.apply("add", 30.0);
        assert_eq!(t.left, 90.0);
        t.apply("cancel", 0.0);
        assert_eq!(t, Timer::default());
    }
}
