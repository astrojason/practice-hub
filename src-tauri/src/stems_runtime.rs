//! The Python that instrument separation (Demucs) runs on.
//!
//! People shouldn't need Python, pip or a terminal. The first time they use instrument
//! separation the app sets up its own private copy in its data folder: a standalone Python
//! (python-build-standalone), then Demucs and its helpers, then the separation model. It is
//! a one-time download that never touches the rest of the computer. A computer that already
//! has a Python with Demucs (a developer's) is used as it is.

use serde_json::json;
use std::{
    fs,
    io::{BufRead, BufReader, Read},
    path::{Path, PathBuf},
    process::{Command, Stdio},
};
use tauri::{AppHandle, Emitter, Manager};

const PYTHON_TAG: &str = "20261110";
const PYTHON_FILE_AARCH64: &str = "cpython-3.11.18%2B20261110-aarch64-apple-darwin-install_only.tar.gz";
const PYTHON_SHA_AARCH64: &str = "73f1ed14486aa278d331e95f7d6d452f5cfb69d90b418e26e62fd4846d53557d";
const PYTHON_FILE_X86_64: &str = "cpython-3.11.18%2B20261110-x86_64-apple-darwin-install_only.tar.gz";
const PYTHON_SHA_X86_64: &str = "9ff3ea8df9037e692939a3f2348f5fd760239ab8eb9d0d2d11d099457dda63a0";
const PIP_PACKAGES: [&str; 3] = ["demucs", "numpy", "imageio-ffmpeg"];
const MODEL: &str = "htdemucs_6s";

/// Prefix of the error the separation commands return when the setup hasn't been done.
pub const NOT_SET_UP: &str = "STEMS_NOT_SET_UP";

fn runtime_dir(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Could not find the app's data folder: {e}"))?
        .join("stems-runtime"))
}

fn managed_python(app: &AppHandle) -> Result<Option<PathBuf>, String> {
    let dir = runtime_dir(app)?;
    let python = dir.join("python/bin/python3");
    Ok(if dir.join("ready").is_file() && python.is_file() { Some(python) } else { None })
}

/// A system python that already has Demucs and numpy (someone who set it up themselves).
fn system_python() -> Option<PathBuf> {
    let ok = Command::new("python3")
        .args(["-c", "import demucs, numpy"])
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .map(|s| s.success())
        .unwrap_or(false);
    ok.then(|| PathBuf::from("python3"))
}

/// The Python to run separation with, or the "not set up" error.
pub fn stem_python(app: &AppHandle) -> Result<PathBuf, String> {
    if let Some(p) = managed_python(app)? {
        return Ok(p);
    }
    system_python().ok_or_else(|| format!("{NOT_SET_UP}: instrument separation needs a one-time setup."))
}

#[derive(serde::Serialize)]
pub struct StemsStatus {
    ready: bool,
    /// "managed" (the app's own copy), "system" (the computer's own), or null.
    source: Option<&'static str>,
}

#[tauri::command]
pub fn stems_status(app: AppHandle) -> Result<StemsStatus, String> {
    if managed_python(&app)?.is_some() {
        return Ok(StemsStatus { ready: true, source: Some("managed") });
    }
    if system_python().is_some() {
        return Ok(StemsStatus { ready: true, source: Some("system") });
    }
    Ok(StemsStatus { ready: false, source: None })
}

fn progress(app: &AppHandle, step: u32, label: &str, message: &str, percent: Option<f64>) {
    // Nothing useful can be done if the window is gone; the setup carries on regardless.
    let _ = app.emit("stems-setup", json!({ "step": step, "steps": 4, "label": label, "message": message, "percent": percent }));
}

fn command_failed(what: &str, out: &std::process::Output) -> String {
    let text = String::from_utf8_lossy(&out.stderr);
    let tail: Vec<&str> = text.lines().rev().take(8).collect::<Vec<_>>().into_iter().rev().collect();
    format!("{what} failed ({}). {}", out.status, tail.join("\n"))
}

fn download(app: &AppHandle, url: &str, dest: &Path) -> Result<(), String> {
    let mut child = Command::new("curl")
        .args(["-L", "--fail", "--show-error", "--progress-bar", "-o"])
        .arg(dest)
        .arg(url)
        .stdout(Stdio::null())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("Could not start the download (curl): {e}"))?;
    let mut stderr = child.stderr.take().ok_or("Could not read the download's progress")?;
    let mut buf = [0u8; 256];
    let mut tail = String::new();
    let mut last_pct = -1.0;
    loop {
        let n = stderr.read(&mut buf).map_err(|e| format!("Could not read the download's progress: {e}"))?;
        if n == 0 {
            break;
        }
        tail.push_str(&String::from_utf8_lossy(&buf[..n]));
        if tail.len() > 4000 {
            tail = tail[tail.len() - 2000..].to_string();
        }
        // curl's bar ends each update with "NN.N%".
        if let Some(i) = tail.rfind('%') {
            let digits: String = tail[..i].chars().rev().take_while(|c| c.is_ascii_digit() || *c == '.').collect::<Vec<_>>().into_iter().rev().collect();
            if let Ok(p) = digits.parse::<f64>() {
                if (p - last_pct).abs() >= 0.5 {
                    last_pct = p;
                    progress(app, 1, "Downloading Python", &format!("{p:.0}% downloaded"), Some(p));
                }
            }
        }
    }
    let status = child.wait().map_err(|e| format!("The download didn't finish: {e}"))?;
    if !status.success() {
        return Err(format!("The download failed ({status}). Check your internet connection and try again. {}", tail.lines().last().unwrap_or("")));
    }
    Ok(())
}

fn run_setup(app: &AppHandle) -> Result<(), String> {
    let dir = runtime_dir(app)?;
    // Start clean: a half-finished earlier attempt is replaced, never trusted.
    for stale in ["ready", "python", "python.tar.gz"] {
        let p = dir.join(stale);
        let removed = if p.is_dir() { fs::remove_dir_all(&p) } else if p.exists() { fs::remove_file(&p) } else { Ok(()) };
        removed.map_err(|e| format!("Could not clear {}: {e}", p.display()))?;
    }
    fs::create_dir_all(&dir).map_err(|e| format!("Could not create {}: {e}", dir.display()))?;

    let (file, sha) = if cfg!(target_arch = "aarch64") { (PYTHON_FILE_AARCH64, PYTHON_SHA_AARCH64) } else { (PYTHON_FILE_X86_64, PYTHON_SHA_X86_64) };
    let url = format!("https://github.com/astral-sh/python-build-standalone/releases/download/{PYTHON_TAG}/{file}");
    let tarball = dir.join("python.tar.gz");

    progress(app, 1, "Downloading Python", "Starting the download…", Some(0.0));
    download(app, &url, &tarball)?;

    progress(app, 2, "Preparing Python", "Checking the download…", None);
    let out = Command::new("shasum").args(["-a", "256"]).arg(&tarball).output().map_err(|e| format!("Could not check the download: {e}"))?;
    if !String::from_utf8_lossy(&out.stdout).starts_with(sha) {
        return Err("The downloaded Python didn't match its expected checksum, so it wasn't used. Try again.".into());
    }
    progress(app, 2, "Preparing Python", "Unpacking…", None);
    let out = Command::new("tar").arg("-xzf").arg(&tarball).arg("-C").arg(&dir).output().map_err(|e| format!("Could not unpack Python: {e}"))?;
    if !out.status.success() {
        return Err(command_failed("Unpacking Python", &out));
    }
    fs::remove_file(&tarball).map_err(|e| format!("Could not remove {}: {e}", tarball.display()))?;
    let python = dir.join("python/bin/python3");
    if !python.is_file() {
        return Err(format!("Python wasn't where expected after unpacking ({}).", python.display()));
    }

    progress(app, 3, "Installing the instrument splitter", "Installing Demucs (this is the long part)…", None);
    let mut child = Command::new(&python)
        .args(["-m", "pip", "install", "--no-input", "--disable-pip-version-check", "--only-binary", ":all:"])
        .args(PIP_PACKAGES)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("Could not start the installer: {e}"))?;
    let stdout = child.stdout.take().ok_or("Could not read the installer's output")?;
    for line in BufReader::new(stdout).lines().map_while(Result::ok) {
        let l = line.trim();
        if l.starts_with("Collecting") || l.starts_with("Downloading") || l.starts_with("Installing") {
            let shown: String = l.chars().take(90).collect();
            progress(app, 3, "Installing the instrument splitter", &shown, None);
        }
    }
    let out = child.wait_with_output().map_err(|e| format!("The installer didn't finish: {e}"))?;
    if !out.status.success() {
        return Err(command_failed("Installing Demucs", &out));
    }

    progress(app, 4, "Downloading the separation model", "Fetching the model (about 100 MB)…", None);
    let out = Command::new(&python)
        .args(["-c", &format!("from demucs.pretrained import get_model; get_model('{MODEL}')")])
        .output()
        .map_err(|e| format!("Could not start the model download: {e}"))?;
    if !out.status.success() {
        return Err(command_failed("Downloading the separation model", &out));
    }

    fs::write(dir.join("ready"), "ok").map_err(|e| format!("Could not finish the setup: {e}"))?;
    progress(app, 4, "All set", "Instrument separation is ready.", Some(100.0));
    Ok(())
}

/// Set up the private Python and Demucs. Progress arrives on the `stems-setup` event.
#[tauri::command]
pub async fn stems_setup(app: AppHandle) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || run_setup(&app))
        .await
        .map_err(|e| format!("The setup stopped unexpectedly: {e}"))?
}
