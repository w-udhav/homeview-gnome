//! Tiny HTTP/1.0 client for talking to a local Ollama. No TLS, localhost only,
//! which keeps the dependency tree small.

use std::time::Duration;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpStream;

pub async fn request(host: &str, method: &str, path: &str, body: Option<&str>) -> std::io::Result<String> {
    let work = async {
        let mut s = TcpStream::connect(host).await?;
        let body = body.unwrap_or("");
        let req = format!(
            "{method} {path} HTTP/1.0\r\nHost: {host}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
            body.len()
        );
        s.write_all(req.as_bytes()).await?;
        let mut buf = Vec::new();
        s.read_to_end(&mut buf).await?;
        Ok::<_, std::io::Error>(String::from_utf8_lossy(&buf).into_owned())
    };
    let raw = tokio::time::timeout(Duration::from_secs(30), work)
        .await
        .map_err(|_| std::io::Error::new(std::io::ErrorKind::TimedOut, "http timeout"))??;
    parse_body(&raw).ok_or_else(|| std::io::Error::new(std::io::ErrorKind::InvalidData, "bad http response"))
}

pub fn parse_body(raw: &str) -> Option<String> {
    let status_ok = raw.lines().next()?.contains(" 200");
    if !status_ok {
        return None;
    }
    raw.split_once("\r\n\r\n").map(|(_, b)| b.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn body_parsing() {
        let raw = "HTTP/1.0 200 OK\r\nContent-Type: x\r\n\r\n{\"a\":1}";
        assert_eq!(parse_body(raw).unwrap(), "{\"a\":1}");
        assert!(parse_body("HTTP/1.0 500 ERR\r\n\r\nno").is_none());
    }
}
