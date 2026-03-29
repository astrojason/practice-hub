use std::{
    fs::File,
    io::{Read, Seek, SeekFrom},
    net::SocketAddr,
    sync::{Arc, Mutex},
    thread,
};
use tauri::Manager;
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
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![start_auth])
        .run(tauri::generate_context!())
        .expect("error while running practice-hub");
}
