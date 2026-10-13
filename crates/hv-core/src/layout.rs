//! Which components to show, and in which bento slot.
//!
//! The grid is two columns wide. Slots:
//!   hero   2x2   the one thing that matters most right now
//!   tall   1x2   next most relevant
//!   square 1x1   two of these stack beside the tall tile
//!   wide   2x1   a last strip
//! plus a fixed toggles `strip` at the bottom.
//!
//! Relevance comes from live context. The UI only applies a new layout when the
//! popup opens, so tiles never jump under the pointer.

use serde::Serialize;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum Slot {
    Hero,
    Tall,
    Square,
    Wide,
    Strip,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct Placed {
    pub id: &'static str,
    pub slot: Slot,
}

#[derive(Debug, Clone, Default)]
pub struct Inputs {
    pub timer_active: bool,
    pub ai_busy: bool,
    pub tokens_today: bool,
    pub playing: bool,
    pub has_track: bool,
    pub working: bool,
    pub idle: bool,
    pub weather: bool,
}

/// Slots each component knows how to draw.
fn supports(id: &str, slot: Slot) -> bool {
    use Slot::*;
    match id {
        "now_playing" | "timer" | "ai" | "focus" => matches!(slot, Hero | Tall | Square | Wide),
        "day" => matches!(slot, Hero | Tall | Wide),
        "weather" => matches!(slot, Square | Wide),
        _ => false,
    }
}

/// (id, relevance). Higher is more relevant. Absent components are omitted.
pub fn scores(i: &Inputs) -> Vec<(&'static str, u32)> {
    let mut v = vec![
        ("timer", if i.timer_active { 100 } else { 22 }),
        ("ai", if i.ai_busy { 85 } else if i.tokens_today { 35 } else { 20 }),
        ("focus", if i.working { 70 } else { 24 }),
        ("day", if i.idle { 75 } else { 50 }),
    ];
    if i.has_track {
        v.push(("now_playing", if i.playing { 90 } else { 45 }));
    }
    if i.weather {
        v.push(("weather", if i.working { 30 } else { 55 }));
    }
    v
}

pub fn rank(i: &Inputs) -> Vec<Placed> {
    let mut left = scores(i);
    // Stable: equal scores keep the declaration order above.
    left.sort_by(|a, b| b.1.cmp(&a.1));

    let mut out = Vec::new();
    for slot in [Slot::Hero, Slot::Tall, Slot::Square, Slot::Square, Slot::Wide] {
        if let Some(pos) = left.iter().position(|(id, _)| supports(id, slot)) {
            let (id, _) = left.remove(pos);
            out.push(Placed { id, slot });
        }
    }
    out.push(Placed { id: "toggles", slot: Slot::Strip });
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    fn slots(v: &[Placed]) -> Vec<(&'static str, Slot)> {
        v.iter().map(|p| (p.id, p.slot)).collect()
    }

    #[test]
    fn music_beats_working() {
        let l = rank(&Inputs { playing: true, has_track: true, working: true, ai_busy: true, ..Default::default() });
        assert_eq!(l[0], Placed { id: "now_playing", slot: Slot::Hero });
        assert_eq!(l[1].id, "ai");
        assert_eq!(l[1].slot, Slot::Tall);
        assert_eq!(l[2].id, "focus");
    }

    #[test]
    fn running_timer_is_hero() {
        let l = rank(&Inputs { timer_active: true, playing: true, has_track: true, ..Default::default() });
        assert_eq!(l[0], Placed { id: "timer", slot: Slot::Hero });
        assert_eq!(l[1].id, "now_playing");
    }

    #[test]
    fn working_without_music_leads_with_ai_then_focus() {
        let l = rank(&Inputs { working: true, ai_busy: true, ..Default::default() });
        assert_eq!(l[0].id, "ai");
        assert_eq!(l[1].id, "focus");
    }

    #[test]
    fn working_alone_leads_with_focus() {
        let l = rank(&Inputs { working: true, ..Default::default() });
        assert_eq!(l[0], Placed { id: "focus", slot: Slot::Hero });
    }

    #[test]
    fn idle_shows_the_day_and_weather() {
        let l = rank(&Inputs { idle: true, weather: true, ..Default::default() });
        assert_eq!(l[0], Placed { id: "day", slot: Slot::Hero });
        assert!(l.iter().any(|p| p.id == "weather"));
    }

    #[test]
    fn weather_never_takes_a_big_slot() {
        let l = rank(&Inputs { weather: true, ..Default::default() });
        for p in &l {
            if p.id == "weather" {
                assert!(matches!(p.slot, Slot::Square | Slot::Wide));
            }
        }
    }

    #[test]
    fn no_component_is_placed_twice_and_toggles_last() {
        let l = rank(&Inputs { playing: true, has_track: true, working: true, ai_busy: true, weather: true, timer_active: true, ..Default::default() });
        let mut ids: Vec<_> = l.iter().map(|p| p.id).collect();
        let n = ids.len();
        ids.sort();
        ids.dedup();
        assert_eq!(ids.len(), n);
        assert_eq!(l.last().unwrap().slot, Slot::Strip);
        assert_eq!(slots(&l)[0].1, Slot::Hero);
    }

    #[test]
    fn every_placement_is_supported() {
        for bits in 0u32..256 {
            let i = Inputs {
                timer_active: bits & 1 != 0,
                ai_busy: bits & 2 != 0,
                tokens_today: bits & 4 != 0,
                playing: bits & 8 != 0,
                has_track: bits & 8 != 0 || bits & 16 != 0,
                working: bits & 32 != 0,
                idle: bits & 64 != 0,
                weather: bits & 128 != 0,
            };
            for p in rank(&i) {
                if p.slot != Slot::Strip {
                    assert!(supports(p.id, p.slot), "{:?} in {:?}", p.id, p.slot);
                }
            }
        }
    }
}
