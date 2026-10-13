//! Weather via Open-Meteo (no API key). This is the only signal that leaves
//! the machine, so it does nothing unless `[weather] enabled = true`.
//! `curl` does the HTTPS so the daemon needs no TLS stack.

use hv_core::{Config, Event};
use serde_json::Value;
use std::time::Duration;
use tokio::process::Command;
use tokio::sync::mpsc::Sender;

pub fn url(lat: f64, lon: f64, imperial: bool) -> String {
    format!(
        "https://api.open-meteo.com/v1/forecast?latitude={lat:.3}&longitude={lon:.3}\
         &current=temperature_2m,weather_code&daily=temperature_2m_max,temperature_2m_min\
         &forecast_days=1&timezone=auto{}",
        if imperial { "&temperature_unit=fahrenheit" } else { "" }
    )
}

pub fn parse(body: &str) -> Option<Event> {
    let v: Value = serde_json::from_str(body).ok()?;
    let cur = v.get("current")?;
    let temp = cur.get("temperature_2m")?.as_f64()? as f32;
    let code = cur.get("weather_code")?.as_u64()? as u32;
    let daily = v.get("daily")?;
    let hi = daily.get("temperature_2m_max")?.get(0)?.as_f64()? as f32;
    let lo = daily.get("temperature_2m_min")?.get(0)?.as_f64()? as f32;
    Some(Event::Weather { temp, code, hi, lo })
}

async fn fetch(url: &str) -> Option<String> {
    let out = Command::new("curl")
        .args(["-fsS", "--max-time", "15", url])
        .kill_on_drop(true)
        .output()
        .await
        .ok()?;
    out.status.success().then(|| String::from_utf8_lossy(&out.stdout).into_owned())
}

pub async fn run(tx: Sender<Event>) {
    loop {
        // Re-read the config each round so enabling it needs no restart.
        let (cfg, _) = Config::load();
        let w = cfg.weather;
        if w.enabled && (w.lat != 0.0 || w.lon != 0.0) {
            if let Some(body) = fetch(&url(w.lat, w.lon, w.units == "imperial")).await {
                if let Some(ev) = parse(&body) {
                    if tx.send(ev).await.is_err() {
                        return;
                    }
                }
            }
            tokio::time::sleep(Duration::from_secs(20 * 60)).await;
        } else {
            tokio::time::sleep(Duration::from_secs(30)).await;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_open_meteo() {
        let body = r#"{"current":{"temperature_2m":21.4,"weather_code":2},
                       "daily":{"temperature_2m_max":[24.1],"temperature_2m_min":[17.2]}}"#;
        assert_eq!(parse(body), Some(Event::Weather { temp: 21.4, code: 2, hi: 24.1, lo: 17.2 }));
        assert_eq!(parse("{}"), None);
    }

    #[test]
    fn url_units() {
        assert!(url(1.0, 2.0, true).ends_with("&temperature_unit=fahrenheit"));
        assert!(!url(1.0, 2.0, false).contains("fahrenheit"));
    }
}
