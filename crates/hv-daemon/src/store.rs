//! Day log. Stores aggregates only: seconds per category, music/LLM time,
//! token totals, focus blocks and an hourly mood arc. No raw activity log.

use hv_core::Mood;
use rusqlite::{params, Connection};
use serde_json::{json, Value};
use std::collections::BTreeMap;
use std::path::Path;

pub struct Store {
    conn: Connection,
    pub day: String,
    totals: BTreeMap<String, f64>,
    /// hour -> (energy, focus, joy sums, samples)
    arc: BTreeMap<u32, [f64; 4]>,
}

impl Store {
    pub fn open(path: &Path, day: &str) -> rusqlite::Result<Self> {
        if let Some(dir) = path.parent() {
            let _ = std::fs::create_dir_all(dir);
        }
        let conn = Connection::open(path)?;
        conn.execute_batch(
            "CREATE TABLE IF NOT EXISTS daily (day TEXT, key TEXT, value REAL, PRIMARY KEY (day, key));
             CREATE TABLE IF NOT EXISTS arc (day TEXT, hour INTEGER, energy REAL, focus REAL, joy REAL, n REAL, PRIMARY KEY (day, hour));",
        )?;
        let mut s = Self { conn, day: day.to_string(), totals: BTreeMap::new(), arc: BTreeMap::new() };
        s.load()?;
        Ok(s)
    }

    pub fn in_memory(day: &str) -> rusqlite::Result<Self> {
        let conn = Connection::open_in_memory()?;
        conn.execute_batch(
            "CREATE TABLE daily (day TEXT, key TEXT, value REAL, PRIMARY KEY (day, key));
             CREATE TABLE arc (day TEXT, hour INTEGER, energy REAL, focus REAL, joy REAL, n REAL, PRIMARY KEY (day, hour));",
        )?;
        Ok(Self { conn, day: day.to_string(), totals: BTreeMap::new(), arc: BTreeMap::new() })
    }

    fn load(&mut self) -> rusqlite::Result<()> {
        self.totals.clear();
        self.arc.clear();
        let mut st = self.conn.prepare("SELECT key, value FROM daily WHERE day = ?1")?;
        let rows = st.query_map([&self.day], |r| Ok((r.get::<_, String>(0)?, r.get::<_, f64>(1)?)))?;
        for r in rows {
            let (k, v) = r?;
            self.totals.insert(k, v);
        }
        drop(st);
        let mut st = self.conn.prepare("SELECT hour, energy, focus, joy, n FROM arc WHERE day = ?1")?;
        let rows = st.query_map([&self.day], |r| {
            Ok((r.get::<_, u32>(0)?, [r.get::<_, f64>(1)?, r.get::<_, f64>(2)?, r.get::<_, f64>(3)?, r.get::<_, f64>(4)?]))
        })?;
        for r in rows {
            let (h, a) = r?;
            self.arc.insert(h, a);
        }
        Ok(())
    }

    pub fn add(&mut self, key: &str, amount: f64) {
        *self.totals.entry(key.to_string()).or_insert(0.0) += amount;
    }

    pub fn get(&self, key: &str) -> f64 {
        self.totals.get(key).copied().unwrap_or(0.0)
    }

    pub fn sample_mood(&mut self, hour: u32, m: &Mood) {
        let e = self.arc.entry(hour).or_insert([0.0; 4]);
        e[0] += m.energy as f64;
        e[1] += m.focus as f64;
        e[2] += m.joy as f64;
        e[3] += 1.0;
    }

    pub fn flush(&mut self) -> rusqlite::Result<()> {
        let tx = self.conn.transaction()?;
        for (k, v) in &self.totals {
            tx.execute(
                "INSERT INTO daily (day, key, value) VALUES (?1, ?2, ?3) ON CONFLICT(day, key) DO UPDATE SET value = excluded.value",
                params![self.day, k, v],
            )?;
        }
        for (h, a) in &self.arc {
            tx.execute(
                "INSERT INTO arc (day, hour, energy, focus, joy, n) VALUES (?1, ?2, ?3, ?4, ?5, ?6)
                 ON CONFLICT(day, hour) DO UPDATE SET energy = excluded.energy, focus = excluded.focus, joy = excluded.joy, n = excluded.n",
                params![self.day, h, a[0], a[1], a[2], a[3]],
            )?;
        }
        tx.commit()
    }

    /// Flushes the finished day and starts a fresh one when the date changes.
    pub fn roll_day(&mut self, new_day: &str) -> rusqlite::Result<bool> {
        if new_day == self.day {
            return Ok(false);
        }
        self.flush()?;
        self.day = new_day.to_string();
        self.load()?;
        Ok(true)
    }

    pub fn arc_points(&self) -> Vec<Value> {
        self.arc
            .iter()
            .filter(|(_, a)| a[3] > 0.0)
            .map(|(h, a)| json!({"hour": h, "energy": a[0] / a[3], "focus": a[1] / a[3], "joy": a[2] / a[3]}))
            .collect()
    }

    pub fn today(&self, tokens_goal: u64) -> Value {
        let mins = |k: &str| (self.get(k) / 60.0).round() as u64;
        let cats: BTreeMap<&str, u64> = ["work", "watch", "social", "read", "other"]
            .into_iter()
            .map(|c| (c, mins(&format!("cat.{c}"))))
            .collect();
        let arc = self.arc_points();
        json!({
            "t": "today",
            "day": self.day,
            "minutes": cats,
            "music_min": mins("music"),
            "llm_min": mins("llm"),
            "tokens": self.get("tokens") as u64,
            "tokens_goal": tokens_goal,
            "focus_blocks": self.get("focus_blocks") as u64,
            "arc": arc,
            "story": story(self),
        })
    }
}

fn dur(m: u64) -> String {
    if m >= 60 {
        format!("{}h {:02}m", m / 60, m % 60)
    } else {
        format!("{m}m")
    }
}

/// A plain-language summary built only from what was recorded.
pub fn story(s: &Store) -> String {
    let mins = |k: &str| (s.get(k) / 60.0).round() as u64;
    let mut parts = Vec::new();
    if mins("cat.work") > 0 {
        let mut p = format!("{} of work", dur(mins("cat.work")));
        let b = s.get("focus_blocks") as u64;
        if b > 0 {
            p += &format!(" in {b} focus block{}", if b == 1 { "" } else { "s" });
        }
        parts.push(p);
    }
    if mins("music") > 0 {
        parts.push(format!("{} of music", dur(mins("music"))));
    }
    if mins("llm") > 0 {
        parts.push(format!("{} with an AI helper", dur(mins("llm"))));
    }
    if mins("cat.social") >= 10 {
        parts.push(format!("{} drifting on social", dur(mins("cat.social"))));
    }
    let peak = s
        .arc_points()
        .into_iter()
        .max_by(|a, b| a["focus"].as_f64().partial_cmp(&b["focus"].as_f64()).unwrap_or(std::cmp::Ordering::Equal))
        .and_then(|p| p["hour"].as_u64());
    let mut out = if parts.is_empty() { "A quiet start so far.".to_string() } else { format!("{}.", parts.join(", ")) };
    if let Some(h) = peak {
        if mins("cat.work") > 0 {
            out += &format!(" Sharpest around {h}:00.");
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn totals_and_story() {
        let mut s = Store::in_memory("2026-01-01").unwrap();
        s.add("cat.work", 3.0 * 3600.0);
        s.add("music", 5400.0);
        s.add("focus_blocks", 2.0);
        s.sample_mood(10, &Mood { energy: 0.5, focus: 0.9, joy: 0.5, curiosity: 0.2, sleepiness: 0.0 });
        let t = s.today(1000);
        assert_eq!(t["minutes"]["work"], 180);
        assert_eq!(t["music_min"], 90);
        let st = t["story"].as_str().unwrap();
        assert!(st.contains("3h 00m of work"));
        assert!(st.contains("2 focus blocks"));
        assert!(st.contains("10:00"));
    }

    #[test]
    fn empty_day_story() {
        let s = Store::in_memory("d").unwrap();
        assert!(story(&s).contains("quiet"));
    }

    #[test]
    fn persists_across_open() {
        let p = std::env::temp_dir().join(format!("hv-store-{}.db", std::process::id()));
        let _ = std::fs::remove_file(&p);
        {
            let mut s = Store::open(&p, "d1").unwrap();
            s.add("music", 120.0);
            s.flush().unwrap();
        }
        let s = Store::open(&p, "d1").unwrap();
        assert_eq!(s.get("music"), 120.0);
        let _ = std::fs::remove_file(&p);
    }

    #[test]
    fn roll_day_resets() {
        let mut s = Store::in_memory("d1").unwrap();
        s.add("music", 60.0);
        assert!(s.roll_day("d2").unwrap());
        assert_eq!(s.get("music"), 0.0);
    }
}
