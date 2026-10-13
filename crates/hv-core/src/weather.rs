use serde::Serialize;

/// What the UI needs: numbers plus a stable icon key and a label.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct WeatherFrame {
    pub temp: f32,
    pub hi: f32,
    pub lo: f32,
    pub icon: &'static str,
    pub label: &'static str,
}

/// WMO weather interpretation codes (as returned by Open-Meteo).
pub fn describe(code: u32) -> (&'static str, &'static str) {
    match code {
        0 => ("clear", "Clear"),
        1 => ("clear", "Mostly clear"),
        2 => ("partly", "Partly cloudy"),
        3 => ("cloudy", "Cloudy"),
        45 | 48 => ("fog", "Fog"),
        51..=57 => ("rain", "Drizzle"),
        61..=67 | 80..=82 => ("rain", "Rain"),
        71..=77 | 85 | 86 => ("snow", "Snow"),
        95..=99 => ("storm", "Thunderstorm"),
        _ => ("cloudy", "Cloudy"),
    }
}

pub fn frame(temp: f32, code: u32, hi: f32, lo: f32) -> WeatherFrame {
    let (icon, label) = describe(code);
    WeatherFrame { temp, hi, lo, icon, label }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn codes_map() {
        assert_eq!(describe(0).0, "clear");
        assert_eq!(describe(63).0, "rain");
        assert_eq!(describe(95).1, "Thunderstorm");
        assert_eq!(describe(999).0, "cloudy");
    }
}
