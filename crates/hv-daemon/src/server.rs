//! One Unix socket, JSON lines both ways.
//!
//! Client -> daemon: an `Event`, or `{"t":"subscribe"}`, `{"t":"today"}`,
//! `{"t":"reload"}`, `{"t":"ping"}`.
//! Daemon -> client: `frame` lines after subscribing, `today` replies.

use hv_core::Event;
use serde_json::Value;
use std::path::Path;
use std::sync::Arc;
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::net::{UnixListener, UnixStream};
use tokio::sync::{broadcast, mpsc, oneshot};

pub enum Input {
    Ev(Event),
    Today(oneshot::Sender<String>),
    Reload,
}

pub type Frames = broadcast::Sender<Arc<String>>;

pub async fn serve(path: &Path, tx: mpsc::Sender<Input>, frames: Frames) -> std::io::Result<()> {
    // A live daemon already owns the socket: don't steal it.
    if path.exists() {
        if UnixStream::connect(path).await.is_ok() {
            return Err(std::io::Error::new(std::io::ErrorKind::AddrInUse, "homeviewd is already running"));
        }
        let _ = std::fs::remove_file(path);
    }
    let listener = UnixListener::bind(path)?;
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o600))?;
    }
    loop {
        let (stream, _) = listener.accept().await?;
        let tx = tx.clone();
        let frames = frames.clone();
        tokio::spawn(async move {
            handle(stream, tx, frames).await;
        });
    }
}

async fn handle(stream: UnixStream, tx: mpsc::Sender<Input>, frames: Frames) {
    let (rd, mut wr) = stream.into_split();
    let (out_tx, mut out_rx) = mpsc::channel::<String>(64);
    let writer = tokio::spawn(async move {
        while let Some(line) = out_rx.recv().await {
            if wr.write_all(line.as_bytes()).await.is_err() || wr.write_all(b"\n").await.is_err() {
                break;
            }
        }
    });
    let mut forwarder: Option<tokio::task::JoinHandle<()>> = None;
    let mut lines = BufReader::new(rd).lines();
    while let Ok(Some(line)) = lines.next_line().await {
        let Ok(v) = serde_json::from_str::<Value>(&line) else { continue };
        match v.get("t").and_then(Value::as_str) {
            Some("subscribe") => {
                if forwarder.is_none() {
                    let mut rx = frames.subscribe();
                    let out = out_tx.clone();
                    forwarder = Some(tokio::spawn(async move {
                        loop {
                            match rx.recv().await {
                                Ok(s) => {
                                    // try_send: a slow client drops frames instead of stalling.
                                    if matches!(out.try_send(s.to_string()), Err(mpsc::error::TrySendError::Closed(_))) {
                                        break;
                                    }
                                }
                                Err(broadcast::error::RecvError::Lagged(_)) => continue,
                                Err(_) => break,
                            }
                        }
                    }));
                }
            }
            Some("today") => {
                let (o, r) = oneshot::channel();
                if tx.send(Input::Today(o)).await.is_err() {
                    break;
                }
                if let Ok(s) = r.await {
                    let _ = out_tx.send(s).await;
                }
            }
            Some("reload") => {
                let _ = tx.send(Input::Reload).await;
            }
            Some("ping") => {
                let _ = out_tx.send(r#"{"t":"pong"}"#.to_string()).await;
            }
            Some(_) => {
                if let Ok(ev) = serde_json::from_value::<Event>(v) {
                    if tx.send(Input::Ev(ev)).await.is_err() {
                        break;
                    }
                }
            }
            None => {}
        }
    }
    if let Some(f) = forwarder {
        f.abort();
    }
    drop(out_tx);
    writer.abort();
}
