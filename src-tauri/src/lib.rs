use std::{
    fs::{self, File},
    io::{Read, Seek, SeekFrom},
    net::SocketAddr,
    path::Path,
    sync::{Arc, Mutex},
    thread,
    time::UNIX_EPOCH,
};
use tauri::{Manager, path::BaseDirectory};
use tiny_http::Header;
use url::Url;

// ─── HTTP file server ─────────────────────────────────────────────────────────
// Serves local media files to the frontend via http://127.0.0.1:17865/asset?path=...
// This mirrors the server from practice-player and enables Web Audio API decoding
// of local files, which cannot be loaded via file:// URLs in Tauri's webview.

fn get_content_type(path: &std::path::Path) -> &'static str {
    match path
        .extension()
        .and_then(|s| s.to_str())
        .unwrap_or("")
        .to_ascii_lowercase()
        .as_str()
    {
        "flac" => "audio/flac",
        "mp3" => "audio/mpeg",
        "wav" => "audio/wav",
        "ogg" | "opus" => "audio/ogg",
        "m4a" | "aac" => "audio/mp4",
        "mp4" | "m4v" => "video/mp4",
        "mov" => "video/quicktime",
        "webm" => "video/webm",
        "ogv" => "video/ogg",
        _ => "application/octet-stream",
    }
}

fn spawn_file_server() {
    thread::spawn(move || {
        let addr: SocketAddr = "127.0.0.1:17865".parse().unwrap();
        let server = match tiny_http::Server::http(addr) {
            Ok(s) => s,
            Err(e) => {
                eprintln!("[practice-hub] file server failed to start: {e}");
                return;
            }
        };

        let allow_origin = Header::from_bytes("Access-Control-Allow-Origin", "*").unwrap();
        let allow_methods =
            Header::from_bytes("Access-Control-Allow-Methods", "GET, OPTIONS").unwrap();
        let allow_headers = Header::from_bytes("Access-Control-Allow-Headers", "*").unwrap();

        for req in server.incoming_requests() {
            let url = req.url().to_string();
            let method = req.method().as_str().to_string();
            let range_hdr = req
                .headers()
                .iter()
                .find(|h| h.field.equiv("Range"))
                .map(|h| h.value.as_str().to_string());

            // CORS preflight
            if method == "OPTIONS" {
                let resp = tiny_http::Response::empty(204)
                    .with_header(allow_origin.clone())
                    .with_header(allow_methods.clone())
                    .with_header(allow_headers.clone());
                let _ = req.respond(resp);
                continue;
            }

            // Health check
            if url == "/health" {
                let resp = tiny_http::Response::from_string("OK")
                    .with_header(allow_origin.clone());
                let _ = req.respond(resp);
                continue;
            }

            // Asset serving: /asset?path=/absolute/path/to/file.mp3
            if let Some(q) = url.strip_prefix("/asset?path=") {
                let path_decoded = percent_encoding::percent_decode_str(q)
                    .decode_utf8_lossy()
                    .to_string();

                let mut f = match File::open(&path_decoded) {
                    Ok(f) => f,
                    Err(_) => {
                        let _ = req.respond(
                            tiny_http::Response::from_string("not found")
                                .with_status_code(404)
                                .with_header(allow_origin.clone())
                                .with_header(allow_methods.clone())
                                .with_header(allow_headers.clone()),
                        );
                        continue;
                    }
                };

                let len = f.metadata().map(|m| m.len()).unwrap_or(0);
                let mut start = 0u64;
                let mut end = len.saturating_sub(1);

                if let Some(r) = range_hdr.as_deref().and_then(|s| s.strip_prefix("bytes=")) {
                    let mut sp = r.splitn(2, '-');
                    if let Some(s) = sp.next().and_then(|s| s.parse::<u64>().ok()) {
                        start = s;
                    }
                    if let Some(e) = sp.next().and_then(|s| {
                        if s.is_empty() { None } else { s.parse::<u64>().ok() }
                    }) {
                        end = end.min(e);
                    }
                }

                if start > end || start >= len {
                    let _ = req.respond(
                        tiny_http::Response::from_string("range not satisfiable")
                            .with_status_code(416)
                            .with_header(
                                Header::from_bytes(
                                    "Content-Range",
                                    format!("bytes */{}", len),
                                )
                                .unwrap(),
                            )
                            .with_header(allow_origin.clone()),
                    );
                    continue;
                }

                let count = (end - start + 1) as usize;
                let _ = f.seek(SeekFrom::Start(start));
                let reader = f.take(count as u64);

                let mime = get_content_type(std::path::Path::new(&path_decoded));
                let mut headers = vec![
                    Header::from_bytes("Content-Type", mime).unwrap(),
                    Header::from_bytes("Accept-Ranges", "bytes").unwrap(),
                    Header::from_bytes("Content-Length", count.to_string()).unwrap(),
                    allow_origin.clone(),
                    allow_methods.clone(),
                    allow_headers.clone(),
                ];

                let status = if start == 0 && end + 1 == len {
                    200
                } else {
                    headers.push(
                        Header::from_bytes(
                            "Content-Range",
                            format!("bytes {}-{}/{}", start, end, len),
                        )
                        .unwrap(),
                    );
                    206
                };

                let resp = tiny_http::Response::new(
                    tiny_http::StatusCode(status),
                    headers,
                    reader,
                    Some(count),
                    None,
                );
                let _ = req.respond(resp);
                continue;
            }

            let _ = req.respond(
                tiny_http::Response::from_string("not found").with_status_code(404),
            );
        }
    });
}

// ─── GP file analysis ─────────────────────────────────────────────────────────
// Invokes the bundled Python sidecar (analyze_gp.py) on a local .gp file and
// returns the raw JSON output as a string.  The caller parses it.

#[tauri::command]
async fn analyze_gp_file(
    app: tauri::AppHandle,
    file_path: String,
) -> Result<String, String> {
    let script = app
        .path()
        .resolve("sidecar/analyze_gp.py", BaseDirectory::Resource)
        .map_err(|e| format!("Could not locate analyzer script: {e}"))?;

    let output = std::process::Command::new("python3")
        .arg(&script)
        .arg(&file_path)
        .output()
        .map_err(|e| format!("Failed to launch python3: {e}"))?;

    if output.status.success() {
        Ok(String::from_utf8_lossy(&output.stdout).to_string())
    } else {
        Err(String::from_utf8_lossy(&output.stderr).to_string())
    }
}

// ─── GP library scanner ───────────────────────────────────────────────────────
// Recursively walks a directory and returns JSON describing every .gp file
// found, along with its filesystem metadata for incremental-scan tracking.

#[derive(serde::Serialize)]
struct GpFileEntry {
    path: String,
    filename: String,
    modified_ms: u64, // Unix timestamp in milliseconds
    size_bytes: u64,
}

#[tauri::command]
async fn scan_gp_directory(root_path: String) -> Result<String, String> {
    let mut entries: Vec<GpFileEntry> = Vec::new();
    scan_dir(Path::new(&root_path), &mut entries)
        .map_err(|e| format!("Scan error: {e}"))?;
    serde_json::to_string(&entries).map_err(|e| e.to_string())
}

fn scan_dir(dir: &Path, out: &mut Vec<GpFileEntry>) -> std::io::Result<()> {
    if !dir.is_dir() {
        return Ok(());
    }
    for entry in fs::read_dir(dir)? {
        let entry = entry?;
        let path = entry.path();
        if path.is_dir() {
            scan_dir(&path, out)?;
        } else if let Some(ext) = path.extension() {
            let ext_lower = ext.to_string_lossy().to_lowercase();
            if ext_lower == "gp" || ext_lower == "gpx" || ext_lower == "gp7" || ext_lower == "gp8" {
                let meta = fs::metadata(&path)?;
                let modified_ms = meta
                    .modified()
                    .ok()
                    .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
                    .map(|d| d.as_millis() as u64)
                    .unwrap_or(0);
                out.push(GpFileEntry {
                    path: path.to_string_lossy().to_string(),
                    filename: path
                        .file_name()
                        .map(|n| n.to_string_lossy().to_string())
                        .unwrap_or_default(),
                    modified_ms,
                    size_bytes: meta.len(),
                });
            }
        }
    }
    Ok(())
}

// ─── Local folder media listing ───────────────────────────────────────────────
// Returns all audio/video files (non-recursive) in a directory, sorted by name.

#[derive(serde::Serialize)]
struct LocalFolderEntry {
    path: String,
    filename: String,
}

const MEDIA_EXTENSIONS: &[&str] = &[
    "mp3", "wav", "flac", "aac", "ogg", "opus", "m4a", "wma",
    "mp4", "mov", "webm", "m4v", "mkv", "ogv", "avi",
];

#[tauri::command]
async fn list_local_folder(path: String) -> Result<String, String> {
    let dir = Path::new(&path);
    if !dir.is_dir() {
        return Err(format!("Not a directory: {}", path));
    }
    let mut entries: Vec<LocalFolderEntry> = Vec::new();
    let read = fs::read_dir(dir).map_err(|e| format!("Failed to read directory: {e}"))?;
    for entry in read {
        let entry = entry.map_err(|e| format!("Failed to read entry: {e}"))?;
        let p = entry.path();
        if p.is_file() {
            if let Some(ext) = p.extension() {
                let ext_lower = ext.to_string_lossy().to_lowercase();
                if MEDIA_EXTENSIONS.contains(&ext_lower.as_str()) {
                    entries.push(LocalFolderEntry {
                        path: p.to_string_lossy().to_string(),
                        filename: p.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default(),
                    });
                }
            }
        }
    }
    entries.sort_by(|a, b| a.filename.cmp(&b.filename));
    serde_json::to_string(&entries).map_err(|e| e.to_string())
}

// ─── Open file with system default handler ────────────────────────────────────

#[tauri::command]
async fn open_with_default(path: String) -> Result<(), String> {
    std::process::Command::new("open")
        .arg(&path)
        .spawn()
        .map_err(|e| format!("Failed to open file: {e}"))?;
    Ok(())
}

// ─── Google OAuth command ─────────────────────────────────────────────────────
// Opens a WebviewWindow for the Google OAuth flow and returns the callback URL.

#[tauri::command]
async fn start_auth(
    app: tauri::AppHandle,
    auth_uri: String,
    continue_uri: String,
) -> Result<String, String> {
    let (tx, rx) = tokio::sync::oneshot::channel::<Result<String, String>>();
    let tx = Arc::new(Mutex::new(Some(tx)));
    let tx_nav = tx.clone();
    let tx_close = tx.clone();
    let continue_uri_clone = continue_uri.clone();

    let window = tauri::WebviewWindowBuilder::new(
        &app,
        "auth",
        tauri::WebviewUrl::External(
            Url::parse(&auth_uri).map_err(|e| e.to_string())?,
        ),
    )
    .title("Sign in with Google")
    .inner_size(500.0, 700.0)
    .on_navigation(move |url| {
        if url.as_str().starts_with(&continue_uri_clone) {
            if let Ok(mut guard) = tx_nav.lock() {
                if let Some(sender) = guard.take() {
                    let _ = sender.send(Ok(url.to_string()));
                }
            }
            false
        } else {
            true
        }
    })
    .build()
    .map_err(|e| e.to_string())?;

    window.on_window_event(move |event| {
        if matches!(event, tauri::WindowEvent::Destroyed) {
            if let Ok(mut guard) = tx_close.lock() {
                if let Some(sender) = guard.take() {
                    let _ = sender.send(Err("Sign-in cancelled".to_string()));
                }
            }
        }
    });

    match rx.await {
        Ok(result) => {
            if let Some(w) = app.get_webview_window("auth") {
                let _ = w.close();
            }
            result
        }
        Err(_) => Err("Auth window closed unexpectedly".to_string()),
    }
}

// ─── App entry point ──────────────────────────────────────────────────────────

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .setup(|_app| {
            spawn_file_server();
            Ok(())
        })
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_store::Builder::default().build())
        .invoke_handler(tauri::generate_handler![
            start_auth,
            analyze_gp_file,
            scan_gp_directory,
            list_local_folder,
            open_with_default,
        ])
        .run(tauri::generate_context!())
        .expect("error while running practice-hub");
}
