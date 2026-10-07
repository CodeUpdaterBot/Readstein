//! Local home-library HTTP server.
//!
//! The desktop app shares its `Books/` directory on the LAN so phones running
//! this fork can mirror the PC shelf (adds, titles, covers, deletions) and
//! exchange reading progress without Readest Cloud.
//! Pairing is a shared bearer token. Discovery is a UDP beacon (no token).

use serde::Serialize;
use serde_json::{json, Value};
use std::collections::HashMap;
use std::net::SocketAddr;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::{Duration, UNIX_EPOCH};
use tauri::{command, State};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::{TcpListener, TcpStream, UdpSocket};
use tokio::sync::Mutex;
use tokio::task::JoinHandle;

const DEFAULT_PORT: u16 = 17432;
const DISCOVERY_PORT: u16 = 17433;
const DISCOVERY_MAGIC: &[u8] = b"READEST-LAN1";
const MAX_HEADER_BYTES: usize = 64 * 1024;
const MAX_CONFIG_BYTES: usize = 2 * 1024 * 1024;
const BOOK_EXTS: &[&str] = &[
    "epub", "pdf", "mobi", "azw", "azw3", "fb2", "fbz", "cbz", "txt", "md", "zip",
];

#[derive(Default)]
pub struct LanLibraryState(pub Arc<Mutex<Option<Running>>>);

pub struct Running {
    shutdown: Arc<AtomicBool>,
    http: JoinHandle<()>,
    beacon: JoinHandle<()>,
    port: u16,
    name: String,
    addrs: Vec<String>,
}

#[derive(Clone)]
struct ServeCtx {
    books_dir: PathBuf,
    token: String,
    name: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StatusPayload {
    running: bool,
    port: u16,
    name: String,
    addrs: Vec<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PeerPayload {
    name: String,
    host: String,
    port: u16,
}

fn advertised_addrs() -> Vec<String> {
    let mut out = Vec::new();
    if let Ok(sock) = std::net::UdpSocket::bind("0.0.0.0:0") {
        let _ = sock.set_ttl(1);
        if sock.connect("8.8.8.8:80").is_ok() {
            if let Ok(addr) = sock.local_addr() {
                let ip = addr.ip();
                if !ip.is_loopback() {
                    out.push(ip.to_string());
                }
            }
        }
    }
    if out.is_empty() {
        out.push("127.0.0.1".into());
    }
    out
}

fn is_book_ext(name: &str) -> bool {
    let ext = name.rsplit('.').next().unwrap_or("").to_ascii_lowercase();
    BOOK_EXTS.iter().any(|e| *e == ext)
}

fn valid_hash(hash: &str) -> bool {
    let n = hash.len();
    (8..=64).contains(&n) && hash.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
}

fn token_ok(got: &str, expected: &str) -> bool {
    !expected.is_empty() && got == expected
}

fn bearer_from(headers: &HashMap<String, String>) -> Option<String> {
    let raw = headers
        .get("authorization")
        .cloned()
        .or_else(|| headers.get("Authorization").cloned())?;
    let rest = raw.strip_prefix("Bearer ").or_else(|| raw.strip_prefix("bearer "))?;
    Some(rest.trim().to_string())
}

fn load_library(books_dir: &Path) -> (Vec<Value>, bool) {
    let path = books_dir.join("library.json");
    let Ok(bytes) = std::fs::read(&path) else {
        return (Vec::new(), false);
    };
    match serde_json::from_slice::<Value>(&bytes) {
        Ok(Value::Array(items)) => (items, true),
        _ => (Vec::new(), false),
    }
}

fn book_dir(books_dir: &Path, hash: &str) -> PathBuf {
    books_dir.join(hash)
}

fn sidecar_names() -> &'static [&'static str] {
    &["cover.png", "config.json", "nav.json"]
}

fn resolve_book_file(books_dir: &Path, book: &Value) -> Option<PathBuf> {
    if let Some(fp) = book.get("filePath").and_then(|v| v.as_str()) {
        let p = PathBuf::from(fp);
        if p.is_file() {
            return Some(p);
        }
    }
    let hash = book.get("hash")?.as_str()?;
    let dir = book_dir(books_dir, hash);
    let rd = std::fs::read_dir(dir).ok()?;
    let mut found: Option<PathBuf> = None;
    for ent in rd.flatten() {
        let path = ent.path();
        if !path.is_file() {
            continue;
        }
        let name = ent.file_name().to_string_lossy().to_string();
        if sidecar_names().iter().any(|s| name.eq_ignore_ascii_case(s)) {
            continue;
        }
        if is_book_ext(&name) {
            found = Some(path);
            break;
        }
    }
    found
}

fn live_books(books_dir: &Path) -> Vec<Value> {
    load_library(books_dir)
        .0
        .into_iter()
        .filter(|b| b.get("deletedAt").map(|v| v.is_null()).unwrap_or(true) && b.get("hash").and_then(|v| v.as_str()).is_some())
        .collect()
}

fn book_by_hash(books_dir: &Path, hash: &str) -> Option<Value> {
    live_books(books_dir)
        .into_iter()
        .find(|b| b.get("hash").and_then(|v| v.as_str()) == Some(hash))
}

fn strip_temp_import_prefix(s: &str) -> String {
    for prefix in ["lan-", "gdrive-"] {
        if let Some(rest) = s.strip_prefix(prefix) {
            let digit_end = rest
                .char_indices()
                .find(|(_, c)| !c.is_ascii_digit())
                .map(|(i, _)| i)
                .unwrap_or(rest.len());
            if digit_end > 0 {
                if let Some(after) = rest[digit_end..].strip_prefix('-') {
                    if !after.is_empty() {
                        return after.to_string();
                    }
                }
            }
        }
    }
    s.to_string()
}

fn file_mtime_ms(path: &Path) -> Option<u64> {
    std::fs::metadata(path)
        .ok()
        .and_then(|m| m.modified().ok())
        .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
        .map(|d| d.as_millis() as u64)
}

fn summarize(books_dir: &Path, book: &Value) -> Option<Value> {
    let hash = book.get("hash")?.as_str()?.to_string();
    let file = resolve_book_file(books_dir, book);
    let size = file
        .as_ref()
        .and_then(|p| std::fs::metadata(p).ok())
        .map(|m| m.len());
    let dir = book_dir(books_dir, &hash);
    let cover_path = dir.join("cover.png");
    let has_cover = cover_path.is_file();
    let has_config = dir.join("config.json").is_file();
    let filename = file
        .as_ref()
        .and_then(|f| f.file_name())
        .map(|s| strip_temp_import_prefix(&s.to_string_lossy()))
        .or_else(|| {
            book.get("filePath").and_then(|v| v.as_str()).map(|p| {
                Path::new(p)
                    .file_name()
                    .map(|s| strip_temp_import_prefix(&s.to_string_lossy()))
                    .unwrap_or_default()
            })
        });
    let raw_title = book.get("title").and_then(|v| v.as_str()).unwrap_or("");
    // The timeline dial bands books by year, so the year data has to cross the wire with
    // the catalog. Without it a synced phone has no years at all, which renders as
    // "0 bands" and no tiles — the desktop looked fine only because its books are local.
    // `published` is a bare year and `publishedDates` holds one entry per component of a
    // composite work; both are written as numbers but tolerate a stringified year.
    let metadata = book.get("metadata");
    let year_of = |value: Option<&serde_json::Value>| -> Option<i64> {
        value.and_then(|v| {
            v.as_i64()
                .or_else(|| v.as_str().and_then(|s| s.trim().parse::<i64>().ok()))
        })
    };
    let published = year_of(metadata.and_then(|m| m.get("published")));
    let published_dates = metadata
        .and_then(|m| m.get("publishedDates"))
        .and_then(|v| v.as_array())
        .map(|dates| {
            dates
                .iter()
                .filter_map(|d| year_of(Some(d)))
                .collect::<Vec<i64>>()
        })
        .unwrap_or_default();
    Some(json!({
        "hash": hash,
        "title": strip_temp_import_prefix(raw_title),
        "author": book.get("author").and_then(|v| v.as_str()).unwrap_or(""),
        "format": book.get("format").and_then(|v| v.as_str()).unwrap_or(""),
        "filename": filename,
        "size": size,
        "updatedAt": book.get("updatedAt").and_then(|v| v.as_u64()).unwrap_or(0),
        "hasCover": has_cover,
        "hasConfig": has_config,
        "hasFile": file.is_some(),
        "coverHash": book.get("coverHash").and_then(|v| v.as_str()),
        "coverMtime": if has_cover { file_mtime_ms(&cover_path) } else { None },
        "coverUpdatedAt": book.get("coverUpdatedAt").and_then(|v| v.as_u64()),
        "metadataUpdatedAt": book.get("metadataUpdatedAt").and_then(|v| v.as_u64()),
        "tags": book.get("tags").cloned().unwrap_or(json!([])),
        "published": published,
        "publishedDates": published_dates,
        // Mirror the whole metadata object, not selected fields: the desktop row is the
        // source of truth for the catalog, and enumerating fields is how the publication
        // years went missing in the first place (a synced phone had no years, so the
        // timeline dial rendered zero bands and no tiles). Anything the desktop can show
        // about a book should reach the device.
        "metadata": book.get("metadata").cloned().unwrap_or(json!({})),
        "groupId": book.get("groupId").and_then(|v| v.as_str()),
        "groupName": book.get("groupName").and_then(|v| v.as_str()),
        "createdAt": book.get("createdAt").and_then(|v| v.as_u64()),
    }))
}

fn cors() -> &'static str {
    "Access-Control-Allow-Origin: *\r\nAccess-Control-Allow-Headers: Authorization, Content-Type\r\nAccess-Control-Allow-Methods: GET, PUT, OPTIONS\r\n"
}

async fn write_response(
    stream: &mut TcpStream,
    status: &str,
    content_type: &str,
    body: &[u8],
) -> std::io::Result<()> {
    let header = format!(
        "HTTP/1.1 {status}\r\n{cors}Content-Type: {content_type}\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
        body.len(),
        cors = cors()
    );
    stream.write_all(header.as_bytes()).await?;
    stream.write_all(body).await?;
    stream.flush().await
}

async fn write_file(stream: &mut TcpStream, path: &Path, content_type: &str) -> std::io::Result<()> {
    let mut file = tokio::fs::File::open(path).await?;
    let len = file.metadata().await?.len();
    let header = format!(
        "HTTP/1.1 200 OK\r\n{cors}Content-Type: {content_type}\r\nContent-Length: {len}\r\nConnection: close\r\n\r\n",
        cors = cors()
    );
    stream.write_all(header.as_bytes()).await?;
    let mut buf = vec![0u8; 64 * 1024];
    loop {
        let n = file.read(&mut buf).await?;
        if n == 0 {
            break;
        }
        stream.write_all(&buf[..n]).await?;
    }
    stream.flush().await
}

fn parse_request(buf: &[u8]) -> Option<(String, String, HashMap<String, String>, usize)> {
    let header_end = buf.windows(4).position(|w| w == b"\r\n\r\n")?;
    let header_bytes = &buf[..header_end];
    let text = std::str::from_utf8(header_bytes).ok()?;
    let mut lines = text.split("\r\n");
    let req = lines.next()?;
    let mut parts = req.split_whitespace();
    let method = parts.next()?.to_string();
    let path = parts.next()?.to_string();
    let mut headers = HashMap::new();
    for line in lines {
        if let Some((k, v)) = line.split_once(':') {
            headers.insert(k.trim().to_ascii_lowercase(), v.trim().to_string());
        }
    }
    Some((method, path, headers, header_end + 4))
}

fn path_parts(path: &str) -> Vec<&str> {
    let no_q = path.split('?').next().unwrap_or(path);
    no_q.split('/').filter(|s| !s.is_empty()).collect()
}

async fn handle_conn(mut stream: TcpStream, ctx: ServeCtx) {
    let mut buf = vec![0u8; 8 * 1024];
    let mut collected = Vec::new();
    loop {
        match stream.read(&mut buf).await {
            Ok(0) => return,
            Ok(n) => {
                collected.extend_from_slice(&buf[..n]);
                if collected.windows(4).any(|w| w == b"\r\n\r\n") || collected.len() > MAX_HEADER_BYTES {
                    break;
                }
            }
            Err(_) => return,
        }
    }
    let Some((method, path, headers, body_at)) = parse_request(&collected) else {
        let _ = write_response(&mut stream, "400 Bad Request", "text/plain", b"bad request").await;
        return;
    };

    if method == "OPTIONS" {
        let _ = write_response(&mut stream, "204 No Content", "text/plain", b"").await;
        return;
    }

    let token = bearer_from(&headers).unwrap_or_default();
    if !token_ok(&token, &ctx.token) {
        let _ = write_response(&mut stream, "401 Unauthorized", "text/plain", b"unauthorized").await;
        return;
    }

    let parts = path_parts(&path);
    let result = route(&method, &parts, &ctx, &collected, body_at, &headers, &mut stream).await;
    if let Err(status) = result {
        let msg = status.as_bytes();
        let _ = write_response(&mut stream, status, "text/plain", msg).await;
    }
}

async fn route(
    method: &str,
    parts: &[&str],
    ctx: &ServeCtx,
    collected: &[u8],
    body_at: usize,
    headers: &HashMap<String, String>,
    stream: &mut TcpStream,
) -> Result<(), &'static str> {
    if parts.first().copied() != Some("v1") {
        return Err("404 Not Found");
    }
    match (method, parts) {
        ("GET", ["v1", "hello"]) => {
            let books = live_books(&ctx.books_dir);
            let body = serde_json::to_vec(&json!({
                "protocol": 1,
                "name": ctx.name,
                "bookCount": books.len(),
            }))
            .unwrap_or_else(|_| b"{}".to_vec());
            write_response(stream, "200 OK", "application/json", &body)
                .await
                .ok();
            Ok(())
        }
        ("GET", ["v1", "books"]) => {
            let (rows, complete) = load_library(&ctx.books_dir);
            let items: Vec<Value> = rows
                .iter()
                .filter(|b| {
                    b.get("deletedAt").map(|v| v.is_null()).unwrap_or(true)
                        && b.get("hash").and_then(|v| v.as_str()).is_some()
                })
                .filter_map(|b| summarize(&ctx.books_dir, b))
                .collect();
            let body = serde_json::to_vec(&json!({ "books": items, "complete": complete }))
                .unwrap_or_else(|_| b"{}".to_vec());
            write_response(stream, "200 OK", "application/json", &body)
                .await
                .ok();
            Ok(())
        }
        ("GET", ["v1", "books", hash, "file"]) if valid_hash(hash) => {
            let book = book_by_hash(&ctx.books_dir, hash).ok_or("404 Not Found")?;
            let path = resolve_book_file(&ctx.books_dir, &book).ok_or("404 Not Found")?;
            write_file(stream, &path, "application/octet-stream").await.ok();
            Ok(())
        }
        ("GET", ["v1", "books", hash, "cover"]) if valid_hash(hash) => {
            let path = book_dir(&ctx.books_dir, hash).join("cover.png");
            if !path.is_file() {
                return Err("404 Not Found");
            }
            write_file(stream, &path, "image/png").await.ok();
            Ok(())
        }
        ("GET", ["v1", "books", hash, "config"]) if valid_hash(hash) => {
            let path = book_dir(&ctx.books_dir, hash).join("config.json");
            if !path.is_file() {
                return Err("404 Not Found");
            }
            write_file(stream, &path, "application/json").await.ok();
            Ok(())
        }
        ("PUT", ["v1", "books", hash, "config"]) if valid_hash(hash) => {
            let len = headers
                .get("content-length")
                .and_then(|s| s.parse::<usize>().ok())
                .unwrap_or(0);
            if len == 0 || len > MAX_CONFIG_BYTES {
                return Err("413 Payload Too Large");
            }
            let mut body = collected[body_at.min(collected.len())..].to_vec();
            while body.len() < len {
                let mut extra = vec![0u8; (len - body.len()).min(64 * 1024)];
                let n = stream.read(&mut extra).await.unwrap_or(0);
                if n == 0 {
                    break;
                }
                extra.truncate(n);
                body.extend_from_slice(&extra);
            }
            body.truncate(len);
            let incoming: Value = serde_json::from_slice(&body).map_err(|_| "400 Bad Request")?;
            let incoming_at = incoming.get("updatedAt").and_then(|v| v.as_u64()).unwrap_or(0);
            let dir = book_dir(&ctx.books_dir, hash);
            let path = dir.join("config.json");
            if path.is_file() {
                if let Ok(existing) = std::fs::read(&path) {
                    if let Ok(local) = serde_json::from_slice::<Value>(&existing) {
                        let local_at = local.get("updatedAt").and_then(|v| v.as_u64()).unwrap_or(0);
                        if local_at > incoming_at {
                            write_response(stream, "200 OK", "application/json", b"{\"ok\":true}")
                                .await
                                .ok();
                            return Ok(());
                        }
                    }
                }
            }
            let _ = std::fs::create_dir_all(&dir);
            std::fs::write(&path, body).map_err(|_| "500 Internal Server Error")?;
            write_response(stream, "200 OK", "application/json", b"{\"ok\":true}")
                .await
                .ok();
            Ok(())
        }
        _ => Err("404 Not Found"),
    }
}

async fn http_loop(listener: TcpListener, ctx: ServeCtx, shutdown: Arc<AtomicBool>) {
    loop {
        if shutdown.load(Ordering::Relaxed) {
            break;
        }
        match tokio::time::timeout(Duration::from_millis(500), listener.accept()).await {
            Ok(Ok((stream, _))) => {
                let ctx = ctx.clone();
                tokio::spawn(async move {
                    handle_conn(stream, ctx).await;
                });
            }
            Ok(Err(_)) => break,
            Err(_) => continue,
        }
    }
}

async fn beacon_loop(name: String, port: u16, addrs: Vec<String>, shutdown: Arc<AtomicBool>) {
    let Ok(sock) = UdpSocket::bind("0.0.0.0:0").await else {
        return;
    };
    let _ = sock.set_broadcast(true);
    let payload = json!({
        "v": 1,
        "name": name,
        "port": port,
        "addrs": addrs,
    });
    let mut packet = DISCOVERY_MAGIC.to_vec();
    if let Ok(bytes) = serde_json::to_vec(&payload) {
        packet.extend_from_slice(&bytes);
    }
    let dest: SocketAddr = ([255, 255, 255, 255], DISCOVERY_PORT).into();
    while !shutdown.load(Ordering::Relaxed) {
        let _ = sock.send_to(&packet, dest).await;
        tokio::time::sleep(Duration::from_secs(2)).await;
    }
}

#[command]
pub async fn lan_library_start(
    state: State<'_, LanLibraryState>,
    books_dir: String,
    token: String,
    port: Option<u16>,
    name: String,
) -> Result<StatusPayload, String> {
    let mut guard = state.0.lock().await;
    if let Some(running) = guard.as_ref() {
        return Ok(StatusPayload {
            running: true,
            port: running.port,
            name: running.name.clone(),
            addrs: running.addrs.clone(),
        });
    }
    let port = if port.unwrap_or(0) == 0 {
        DEFAULT_PORT
    } else {
        port.unwrap_or(DEFAULT_PORT)
    };
    let books_dir = PathBuf::from(&books_dir);
    if !books_dir.is_dir() {
        return Err("Books directory not found".into());
    }
    if token.trim().is_empty() {
        return Err("Pairing code is required".into());
    }
    let listener = TcpListener::bind(("0.0.0.0", port))
        .await
        .map_err(|e| format!("Could not bind port {port}: {e}"))?;
    let bound = listener.local_addr().map(|a| a.port()).unwrap_or(port);
    let addrs = advertised_addrs();
    let name = if name.trim().is_empty() {
        "Readest PC".into()
    } else {
        name
    };
    let shutdown = Arc::new(AtomicBool::new(false));
    let ctx = ServeCtx {
        books_dir,
        token,
        name: name.clone(),
    };
    let http = tokio::spawn(http_loop(listener, ctx, shutdown.clone()));
    let beacon = tokio::spawn(beacon_loop(name.clone(), bound, addrs.clone(), shutdown.clone()));
    *guard = Some(Running {
        shutdown,
        http,
        beacon,
        port: bound,
        name: name.clone(),
        addrs: addrs.clone(),
    });
    Ok(StatusPayload {
        running: true,
        port: bound,
        name,
        addrs,
    })
}

#[command]
pub async fn lan_library_stop(state: State<'_, LanLibraryState>) -> Result<(), String> {
    let mut guard = state.0.lock().await;
    if let Some(running) = guard.take() {
        running.shutdown.store(true, Ordering::Relaxed);
        running.http.abort();
        running.beacon.abort();
    }
    Ok(())
}

#[command]
pub async fn lan_library_status(state: State<'_, LanLibraryState>) -> Result<StatusPayload, String> {
    let guard = state.0.lock().await;
    if let Some(running) = guard.as_ref() {
        Ok(StatusPayload {
            running: true,
            port: running.port,
            name: running.name.clone(),
            addrs: running.addrs.clone(),
        })
    } else {
        Ok(StatusPayload {
            running: false,
            port: 0,
            name: String::new(),
            addrs: vec![],
        })
    }
}

#[command]
pub async fn lan_library_scan() -> Result<Vec<PeerPayload>, String> {
    let sock = UdpSocket::bind(("0.0.0.0", DISCOVERY_PORT))
        .await
        .map_err(|e| format!("Could not listen for home libraries: {e}"))?;
    let _ = sock.set_broadcast(true);
    let mut buf = [0u8; 2048];
    let deadline = tokio::time::Instant::now() + Duration::from_millis(2500);
    let mut found: HashMap<String, PeerPayload> = HashMap::new();
    loop {
        let remain = deadline.saturating_duration_since(tokio::time::Instant::now());
        if remain.is_zero() {
            break;
        }
        match tokio::time::timeout(remain, sock.recv_from(&mut buf)).await {
            Ok(Ok((n, from))) => {
                if n <= DISCOVERY_MAGIC.len() || &buf[..DISCOVERY_MAGIC.len()] != DISCOVERY_MAGIC {
                    continue;
                }
                if let Ok(v) = serde_json::from_slice::<Value>(&buf[DISCOVERY_MAGIC.len()..n]) {
                    let port = v.get("port").and_then(|x| x.as_u64()).unwrap_or(0) as u16;
                    let name = v
                        .get("name")
                        .and_then(|x| x.as_str())
                        .unwrap_or("Readest PC")
                        .to_string();
                    let mut hosts: Vec<String> = v
                        .get("addrs")
                        .and_then(|x| x.as_array())
                        .map(|arr| {
                            arr.iter()
                                .filter_map(|a| a.as_str().map(|s| s.to_string()))
                                .collect()
                        })
                        .unwrap_or_default();
                    if hosts.is_empty() {
                        hosts.push(from.ip().to_string());
                    }
                    for host in hosts {
                        let key = format!("{host}:{port}");
                        found.insert(
                            key,
                            PeerPayload {
                                name: name.clone(),
                                host,
                                port,
                            },
                        );
                    }
                }
            }
            _ => break,
        }
    }
    Ok(found.into_values().collect())
}

#[cfg(test)]
mod tests {
    use super::{strip_temp_import_prefix, summarize};
    use serde_json::json;
    use std::path::PathBuf;

    #[test]
    fn strips_lan_and_gdrive_cache_prefixes() {
        assert_eq!(
            strip_temp_import_prefix("lan-1787729199808-Dying for the Truth - R. Roy Blake"),
            "Dying for the Truth - R. Roy Blake"
        );
        assert_eq!(
            strip_temp_import_prefix("gdrive-99-Report.pdf"),
            "Report.pdf"
        );
        assert_eq!(
            strip_temp_import_prefix("The Real History.pdf"),
            "The Real History.pdf"
        );
    }

    #[test]
    fn summarize_lists_live_books_without_a_file() {
        let tmp = PathBuf::from(std::env::temp_dir()).join(format!(
            "lan-home-summarize-{}",
            std::process::id()
        ));
        let _ = std::fs::create_dir_all(&tmp);
        let book = json!({
            "hash": "abc12345",
            "title": "Edited Title",
            "author": "Someone",
            "format": "PDF",
            "coverHash": "deadbeef",
            "updatedAt": 99,
            "metadataUpdatedAt": 100,
            "coverUpdatedAt": 101,
            "tags": ["history"],
            "metadata": { "published": 1584, "publishedDates": [1584, "1610"] },
        });
        let summary = summarize(&tmp, &book).expect("hash is enough to summarize");
        assert_eq!(summary["title"], "Edited Title");
        assert_eq!(summary["author"], "Someone");
        assert_eq!(summary["hasFile"], false);
        assert_eq!(summary["hasCover"], false);
        assert_eq!(summary["coverHash"], "deadbeef");
        assert_eq!(summary["coverUpdatedAt"], 101);
        assert_eq!(summary["metadataUpdatedAt"], 100);
        assert_eq!(summary["tags"], json!(["history"]));
        // The timeline dial needs these or a synced phone renders "0 bands" and no tiles.
        assert_eq!(summary["published"], 1584);
        assert_eq!(summary["publishedDates"], json!([1584, 1610]));

        // A book with no year data reports none rather than lying about it.
        let bare = json!({ "hash": "def67890", "title": "No Year" });
        let bare_summary = summarize(&tmp, &bare).expect("hash is enough to summarize");
        assert_eq!(bare_summary["published"], serde_json::Value::Null);
        assert_eq!(bare_summary["publishedDates"], json!([]));
        let _ = std::fs::remove_dir_all(&tmp);
    }
}
