use std::sync::{Arc, Mutex};
use tauri::Manager;
use url::Url;

/// Opens a dedicated WebviewWindow for Google OAuth.
/// Monitors navigation events; when the window reaches `continue_uri`
/// (Firebase's redirect back to us), captures the full URL, cancels the
/// navigation (so nothing actually loads there), closes the window, and
/// returns the URL so the frontend can exchange it for Firebase tokens.
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
            false // cancel — don't try to load this URL
        } else {
            true // allow all other navigations
        }
    })
    .build()
    .map_err(|e| e.to_string())?;

    // If the user closes the auth window manually, unblock the await below.
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

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![start_auth])
        .run(tauri::generate_context!())
        .expect("error while running practice-hub");
}
