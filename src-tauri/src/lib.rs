use std::{
    fs::{self, File},
    io::{Read, Seek, SeekFrom},
    net::SocketAddr,
    path::{Path, PathBuf},
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
        "m4a" | "aac" => "audio/mp4",
        "mp4" | "m4v" => "video/mp4",
        "mov" => "video/quicktime",
        "webm" => "video/webm",
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
// Invokes the bundled Python sidecar (analyze_gp.py --view) on a local .gp file
// and returns structured note/measure data as a JSON string for the tab viewer.

#[tauri::command]
async fn parse_gp_file(
    app: tauri::AppHandle,
    file_path: String,
) -> Result<String, String> {
    let script = app
        .path()
        .resolve("sidecar/analyze_gp.py", BaseDirectory::Resource)
        .map_err(|e| format!("Could not locate analyzer script: {e}"))?;

    let output = std::process::Command::new("python3")
        .arg(&script)
        .arg("--view")
        .arg(&file_path)
        .output()
        .map_err(|e| format!("Failed to launch python3: {e}"))?;

    if output.status.success() {
        Ok(String::from_utf8_lossy(&output.stdout).to_string())
    } else {
        Err(String::from_utf8_lossy(&output.stderr).to_string())
    }
}

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

// Writes computed per-aspect values directly to the canonical song row in
// Turso. The Python sidecar re-checks the manual flags immediately before
// each update so an admin lock that lands after scanning still wins.
#[tauri::command]
async fn write_song_difficulty(
    app: tauri::AppHandle,
    db_url: String,
    auth_token: String,
    song_id: i64,
    rhythm: Option<f64>,
    lead: Option<f64>,
) -> Result<String, String> {
    let script = app
        .path()
        .resolve("sidecar/write_song_difficulty.py", BaseDirectory::Resource)
        .map_err(|e| format!("Could not locate Turso writer script: {e}"))?;

    let home = std::env::var_os("HOME")
        .ok_or_else(|| "Could not locate the home directory for the Instrumenta Python environment".to_string())?;
    let python = PathBuf::from(home)
        .join("Projects/astrojason/practice.astrojason.com/.venv/bin/python3");
    if !python.is_file() {
        return Err(format!(
            "Instrumenta Python environment not found at {}",
            python.display()
        ));
    }

    let mut command = std::process::Command::new(&python);
    command
        .arg(&script)
        .arg("--db-url")
        .arg(&db_url)
        .arg("--auth-token")
        .arg(&auth_token)
        .arg("--song-id")
        .arg(song_id.to_string());
    if let Some(value) = rhythm {
        command.arg("--rhythm").arg(value.to_string());
    }
    if let Some(value) = lead {
        command.arg("--lead").arg(value.to_string());
    }

    let output = command
        .output()
        .map_err(|e| format!("Failed to launch Turso writer: {e}"))?;

    if output.status.success() {
        Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
    } else {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        Err(if stderr.is_empty() {
            format!("Turso writer exited with status {}", output.status)
        } else {
            stderr
        })
    }
}

// ─── Nightly GP scan launchd agent ───────────────────────────────────────────

const NIGHTLY_SCAN_LABEL: &str = "com.astrojason.practicehub.nightly-gp-scan";

fn home_directory() -> Result<PathBuf, String> {
    std::env::var_os("HOME")
        .map(PathBuf::from)
        .ok_or_else(|| "Could not locate the home directory".to_string())
}

fn launchd_agent_path() -> Result<PathBuf, String> {
    Ok(home_directory()?
        .join("Library/LaunchAgents")
        .join(format!("{NIGHTLY_SCAN_LABEL}.plist")))
}

fn xml_escape(value: &str) -> String {
    value
        .replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
        .replace('\'', "&apos;")
}

fn run_launchctl(action: &str, path: &Path) -> Result<(), String> {
    let output = std::process::Command::new("launchctl")
        .arg(action)
        .arg("-w")
        .arg(path)
        .output()
        .map_err(|e| format!("Failed to launch launchctl: {e}"))?;

    if output.status.success() {
        return Ok(());
    }

    let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
    let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
    let detail = if !stderr.is_empty() { stderr } else if !stdout.is_empty() { stdout } else {
        format!("exit status {}", output.status)
    };
    Err(format!("launchctl {action} failed: {detail}"))
}

fn launchctl_already_unloaded(message: &str) -> bool {
    let lower = message.to_ascii_lowercase();
    lower.contains("could not find specified service")
        || lower.contains("service is not loaded")
        || lower.contains("no such process")
        || lower.contains("no such file")
}

#[tauri::command]
async fn install_launchd_agent(app: tauri::AppHandle) -> Result<(), String> {
    let home = home_directory()?;
    let python = home.join("Projects/astrojason/practice.astrojason.com/.venv/bin/python3");
    let script = home.join("Projects/astrojason/practice-hub/scripts/nightly_gp_scan.py");
    let log_dir = home.join("Library/Logs/practice-hub");
    let log_path = log_dir.join("nightly-gp-scan.log");
    let agent_path = launchd_agent_path()?;

    if !python.is_file() {
        return Err(format!("Instrumenta Python environment not found at {}", python.display()));
    }
    if !script.is_file() {
        return Err(format!("Nightly scan script not found at {}", script.display()));
    }

    let template_path = app
        .path()
        .resolve(
            "sidecar/com.astrojason.practicehub.nightly-gp-scan.plist",
            BaseDirectory::Resource,
        )
        .map_err(|e| format!("Could not locate launchd template: {e}"))?;
    let template = fs::read_to_string(&template_path)
        .map_err(|e| format!("Failed to read launchd template {}: {e}", template_path.display()))?;
    let plist = template
        .replace("__PYTHON_PATH__", &xml_escape(&python.to_string_lossy()))
        .replace("__SCRIPT_PATH__", &xml_escape(&script.to_string_lossy()))
        .replace("__LOG_PATH__", &xml_escape(&log_path.to_string_lossy()));

    fs::create_dir_all(&log_dir)
        .map_err(|e| format!("Failed to create log directory {}: {e}", log_dir.display()))?;
    let agent_dir = agent_path
        .parent()
        .ok_or_else(|| format!("Invalid launchd agent path: {}", agent_path.display()))?;
    fs::create_dir_all(agent_dir)
        .map_err(|e| format!("Failed to create LaunchAgents directory {}: {e}", agent_dir.display()))?;
    fs::write(&agent_path, plist)
        .map_err(|e| format!("Failed to write launchd agent {}: {e}", agent_path.display()))?;

    if let Err(load_error) = run_launchctl("load", &agent_path) {
        return match fs::remove_file(&agent_path) {
            Ok(()) => Err(load_error),
            Err(cleanup_error) if cleanup_error.kind() == std::io::ErrorKind::NotFound => Err(load_error),
            Err(cleanup_error) => Err(format!(
                "{load_error}; failed to remove the inactive plist: {cleanup_error}"
            )),
        };
    }
    Ok(())
}

#[tauri::command]
async fn uninstall_launchd_agent() -> Result<(), String> {
    let agent_path = launchd_agent_path()?;
    if !agent_path.exists() {
        return Ok(());
    }

    if let Err(error) = run_launchctl("unload", &agent_path) {
        if !launchctl_already_unloaded(&error) {
            return Err(error);
        }
    }

    match fs::remove_file(&agent_path) {
        Ok(()) => Ok(()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(format!("Failed to remove launchd agent {}: {error}", agent_path.display())),
    }
}

#[tauri::command]
fn is_launchd_agent_installed() -> Result<bool, String> {
    Ok(launchd_agent_path()?.is_file())
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

// Formats actually decodable by Web Audio API or HTML5 video in the webview.
const MEDIA_EXTENSIONS: &[&str] = &[
    "mp3", "wav", "flac", "aac", "m4a",
    "mp4", "mov", "webm", "m4v",
];

// Case-insensitive natural sort: "Track 2" < "Track 10".
fn natural_cmp(a: &str, b: &str) -> std::cmp::Ordering {
    let a_lc = a.to_ascii_lowercase();
    let b_lc = b.to_ascii_lowercase();
    let mut ai: usize = 0;
    let mut bi: usize = 0;
    loop {
        let a_done = ai >= a_lc.len();
        let b_done = bi >= b_lc.len();
        match (a_done, b_done) {
            (true, true) => return std::cmp::Ordering::Equal,
            (true, false) => return std::cmp::Ordering::Less,
            (false, true) => return std::cmp::Ordering::Greater,
            _ => {}
        }
        let a_ch = a_lc[ai..].chars().next().unwrap();
        let b_ch = b_lc[bi..].chars().next().unwrap();
        if a_ch.is_ascii_digit() && b_ch.is_ascii_digit() {
            let a_end = ai + a_lc[ai..].find(|c: char| !c.is_ascii_digit()).unwrap_or(a_lc.len() - ai);
            let b_end = bi + b_lc[bi..].find(|c: char| !c.is_ascii_digit()).unwrap_or(b_lc.len() - bi);
            let a_num: u64 = a_lc[ai..a_end].parse().unwrap_or(0);
            let b_num: u64 = b_lc[bi..b_end].parse().unwrap_or(0);
            ai = a_end;
            bi = b_end;
            match a_num.cmp(&b_num) {
                std::cmp::Ordering::Equal => {}
                ord => return ord,
            }
        } else {
            ai += a_ch.len_utf8();
            bi += b_ch.len_utf8();
            match a_ch.cmp(&b_ch) {
                std::cmp::Ordering::Equal => {}
                ord => return ord,
            }
        }
    }
}

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
            let filename = p.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default();
            if filename.starts_with("._") {
                continue;
            }
            if let Some(ext) = p.extension() {
                let ext_lower = ext.to_string_lossy().to_lowercase();
                if MEDIA_EXTENSIONS.contains(&ext_lower.as_str()) {
                    entries.push(LocalFolderEntry {
                        path: p.to_string_lossy().to_string(),
                        filename,
                    });
                }
            }
        }
    }
    entries.sort_by(|a, b| natural_cmp(&a.filename, &b.filename));
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

// ─── Changelog ───────────────────────────────────────────────────────────────

#[derive(serde::Serialize)]
pub struct ChangelogEntry {
    hash: String,
    message: String,
    date: String,
}

#[tauri::command]
fn get_changelog() -> Result<Vec<ChangelogEntry>, String> {
    let output = std::process::Command::new("git")
        .args(["log", "--pretty=format:%h|%s|%ad", "--date=short", "-n", "50"])
        .output()
        .map_err(|e| e.to_string())?;
    let log = String::from_utf8_lossy(&output.stdout);
    let entries = log.lines()
        .filter(|l| !l.is_empty())
        .filter_map(|line| {
            let parts: Vec<&str> = line.splitn(3, '|').collect();
            if parts.len() == 3 {
                Some(ChangelogEntry {
                    hash: parts[0].to_string(),
                    message: parts[1].to_string(),
                    date: parts[2].to_string(),
                })
            } else {
                None
            }
        })
        .collect();
    Ok(entries)
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
            write_song_difficulty,
            install_launchd_agent,
            uninstall_launchd_agent,
            is_launchd_agent_installed,
            parse_gp_file,
            scan_gp_directory,
            list_local_folder,
            open_with_default,
            get_changelog,
        ])
        .run(tauri::generate_context!())
        .expect("error while running practice-hub");
}
