//! Answering the quiz out loud: the microphone (through cpal) and macOS's own speech
//! recogniser (Apple's Speech framework, run on this computer whenever the Mac supports it).
//!
//! The microphone is listened to only while "Answer out loud" is on in a running quiz. A short
//! phrase is cut out when someone speaks (by loudness), written to a temporary sound file and
//! handed to the recogniser; its best guesses are sent to the window as `fret-voice` events.
//!
//! Ported from the Craft "visual scale, arpeggio, chord" app's speech module. That app ran this
//! in a helper process; here it runs on its own thread inside the app, and macOS reads the
//! reasons for asking for the microphone and speech recognition from `Info.plist` (merged into
//! the app bundle, and embedded in the dev binary by `build.rs`).

use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use cpal::{FromSample, SizedSample};
use serde_json::json;
use std::collections::VecDeque;
use std::path::Path;
use std::sync::atomic::{AtomicBool, AtomicU32, Ordering};
use std::sync::mpsc::{channel, Receiver, RecvTimeoutError, Sender};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter, State};

pub enum Event {
    /// Someone started speaking at this moment (answer times are measured to here).
    Onset(Instant),
    /// What was heard: the recogniser's guesses, best first.
    Heard(Vec<String>),
    /// Speech was picked up but no words were recognised.
    Nothing,
    /// Something went wrong; listening has stopped.
    Error(String),
    /// The microphone skipped a moment of sound (a buffer underrun or overrun). Listening
    /// carries on; the count is shown so it isn't hidden.
    Dropout,
    /// Listening started. `on_device`: recognition runs on this computer (false: Apple's servers).
    Ready { on_device: bool },
}

pub struct Listener {
    _stream: cpal::Stream,
    pub events: Receiver<Event>,
    /// Microphone loudness (RMS, as f32 bits) for the level meter.
    pub level: Arc<AtomicU32>,
}

impl Listener {
    pub fn level(&self) -> f32 {
        f32::from_bits(self.level.load(Ordering::Relaxed))
    }

    /// Ask for permission, open the default microphone and start listening.
    /// While `paused` is set, what the microphone hears is ignored (the app itself is making sound).
    pub fn start(vocabulary: Vec<String>, paused: Arc<AtomicBool>, stop: Arc<AtomicBool>) -> Result<Listener, String> {
        let (tx, events) = channel();
        let level = Arc::new(AtomicU32::new(0));

        let host = cpal::default_host();
        let device = host.default_input_device().ok_or_else(|| "No microphone was found. Plug one in or pick an input in System Settings > Sound > Input.".to_string())?;
        let supported = device.default_input_config().map_err(|e| format!("Could not read the microphone's settings: {e}"))?;
        let format = supported.sample_format();
        let config = supported.config();
        let rate = config.sample_rate;
        let (atx, arx) = channel::<Vec<f32>>();
        let stream = match format {
            cpal::SampleFormat::F32 => build::<f32>(&device, config, atx, tx.clone()),
            cpal::SampleFormat::I16 => build::<i16>(&device, config, atx, tx.clone()),
            cpal::SampleFormat::U16 => build::<u16>(&device, config, atx, tx.clone()),
            cpal::SampleFormat::I32 => build::<i32>(&device, config, atx, tx.clone()),
            cpal::SampleFormat::F64 => build::<f64>(&device, config, atx, tx.clone()),
            other => return Err(format!("The microphone uses a sample format this app can't read ({other:?}).")),
        }?;
        stream.play().map_err(|e| format!("Could not start the microphone: {e}"))?;

        let lv = level.clone();
        std::thread::Builder::new()
            .name("voice answers".into())
            .spawn(move || {
                match recognizer::authorize() {
                    Ok(on_device) => {
                        let _ = tx.send(Event::Ready { on_device });
                    }
                    Err(e) => {
                        let _ = tx.send(Event::Error(e));
                        return;
                    }
                }
                listen(arx, rate, tx, lv, paused, stop, vocabulary);
            })
            .map_err(|e| format!("Could not start listening: {e}"))?;
        Ok(Listener { _stream: stream, events, level })
    }
}

fn build<T>(device: &cpal::Device, config: cpal::StreamConfig, audio: Sender<Vec<f32>>, events: Sender<Event>) -> Result<cpal::Stream, String>
where
    T: SizedSample + Send + 'static,
    f32: FromSample<T>,
{
    let channels = (config.channels as usize).max(1);
    device
        .build_input_stream::<T, _, _>(
            config,
            move |data: &[T], _| {
                let mono: Vec<f32> = data.chunks(channels).map(|f| f.iter().map(|s| <f32 as FromSample<T>>::from_sample_(*s)).sum::<f32>() / channels as f32).collect();
                let _ = audio.send(mono);
            },
            move |err: cpal::Error| {
                // A dropout only loses a few milliseconds; anything else ends listening.
                let event = if err.kind() == cpal::ErrorKind::Xrun { Event::Dropout } else { Event::Error(format!("The microphone stopped: {err}")) };
                let _ = events.send(event);
            },
            None,
        )
        .map_err(|e| format!("Could not open the microphone: {e}"))
}

/// Cut phrases out of the microphone by loudness and recognise each one.
fn listen(audio: Receiver<Vec<f32>>, rate: u32, tx: Sender<Event>, level: Arc<AtomicU32>, paused: Arc<AtomicBool>, stop: Arc<AtomicBool>, vocabulary: Vec<String>) {
    let rate_f = rate.max(1) as f32;
    let pre_roll = (rate_f * 0.3) as usize;
    let mut ring: VecDeque<f32> = VecDeque::with_capacity(pre_roll + 4096);
    // (samples, quiet samples at the end, loudness sum, chunks)
    let mut phrase: Option<(Vec<f32>, usize, f32, usize)> = None;
    let mut floor = 0.002f32;
    let mut loud = 0;
    let started = Instant::now();
    let mut any_signal = false;
    let file = std::env::temp_dir().join(format!("fret_trainer_voice_{}.wav", std::process::id()));
    loop {
        if stop.load(Ordering::Relaxed) {
            return;
        }
        let chunk = match audio.recv_timeout(Duration::from_millis(100)) {
            Ok(c) => c,
            Err(RecvTimeoutError::Timeout) => continue,
            Err(RecvTimeoutError::Disconnected) => return,
        };
        if chunk.is_empty() {
            continue;
        }
        let rms = (chunk.iter().map(|s| s * s).sum::<f32>() / chunk.len() as f32).sqrt();
        level.store(rms.to_bits(), Ordering::Relaxed);
        if rms > 1e-6 {
            any_signal = true;
        }
        if !any_signal && started.elapsed() > Duration::from_secs(3) {
            let _ = tx.send(Event::Error(
                "The microphone is sending only silence, so macOS probably hasn't allowed it. Open System Settings > Privacy & Security > Microphone and allow Practice Hub (or the program that started it, such as Terminal when running in development), and check the input in System Settings > Sound.".into(),
            ));
            return;
        }
        if paused.load(Ordering::Relaxed) {
            phrase = None;
            ring.clear();
            loud = 0;
            continue;
        }
        let threshold = (floor * 4.0).max(0.012);
        match phrase.as_mut() {
            None => {
                ring.extend(chunk.iter().copied());
                while ring.len() > pre_roll {
                    ring.pop_front();
                }
                if rms > threshold {
                    loud += 1;
                } else {
                    loud = 0;
                    floor = floor * 0.97 + rms * 0.03;
                }
                if loud >= 3 {
                    let since = Duration::from_secs_f32(3.0 * chunk.len() as f32 / rate_f);
                    let _ = tx.send(Event::Onset(Instant::now().checked_sub(since).unwrap_or_else(Instant::now)));
                    phrase = Some((ring.drain(..).collect(), 0, 0.0, 0));
                    loud = 0;
                }
            }
            Some(p) => {
                p.0.extend(chunk.iter().copied());
                p.2 += rms;
                p.3 += 1;
                if rms < threshold * 0.7 {
                    p.1 += chunk.len();
                } else {
                    p.1 = 0;
                }
                let ended = p.1 as f32 > rate_f * 0.6;
                let too_long = p.0.len() as f32 > rate_f * 4.0;
                if ended || too_long {
                    let (samples, _, sum, n) = phrase.take().unwrap_or_default();
                    if too_long && !ended {
                        // A steady noise rather than speech: raise the floor so it stops triggering.
                        floor = floor.max(0.8 * sum / n.max(1) as f32 / 4.0);
                    }
                    let event = match write_wav(&file, &samples, rate) {
                        Err(e) => Event::Error(e),
                        Ok(()) => match recognizer::recognize(&file, &vocabulary) {
                            Ok(g) if g.iter().all(|s| s.trim().is_empty()) => Event::Nothing,
                            Ok(g) => Event::Heard(g),
                            Err(e) => Event::Error(e),
                        },
                    };
                    let fatal = matches!(event, Event::Error(_));
                    let _ = tx.send(event);
                    if fatal {
                        return;
                    }
                    // Whatever was said while recognising belongs to that phrase; start fresh.
                    while audio.try_recv().is_ok() {}
                    ring.clear();
                }
            }
        }
    }
}

/// A mono 16-bit WAV file.
fn write_wav(path: &Path, samples: &[f32], rate: u32) -> Result<(), String> {
    let mut b: Vec<u8> = Vec::with_capacity(44 + samples.len() * 2);
    let data_len = (samples.len() * 2) as u32;
    b.extend_from_slice(b"RIFF");
    b.extend_from_slice(&(36 + data_len).to_le_bytes());
    b.extend_from_slice(b"WAVEfmt ");
    b.extend_from_slice(&16u32.to_le_bytes());
    b.extend_from_slice(&1u16.to_le_bytes()); // PCM
    b.extend_from_slice(&1u16.to_le_bytes()); // mono
    b.extend_from_slice(&rate.to_le_bytes());
    b.extend_from_slice(&(rate * 2).to_le_bytes());
    b.extend_from_slice(&2u16.to_le_bytes());
    b.extend_from_slice(&16u16.to_le_bytes());
    b.extend_from_slice(b"data");
    b.extend_from_slice(&data_len.to_le_bytes());
    // Bring quiet speech up to a healthy level for the recogniser.
    let peak = samples.iter().fold(0.0f32, |m, s| m.max(s.abs())).max(1e-4);
    let gain = (0.7 / peak).min(20.0);
    for s in samples {
        b.extend_from_slice(&(((s * gain).clamp(-1.0, 1.0) * 32767.0) as i16).to_le_bytes());
    }
    std::fs::write(path, b).map_err(|e| format!("Could not write the recording to {}: {e}", path.display()))
}

#[cfg(target_os = "macos")]
mod recognizer {
    use block2::RcBlock;
    use objc2::msg_send;
    use objc2::rc::{autoreleasepool, Allocated, Retained};
    use objc2::runtime::{AnyClass, AnyObject};
    use std::ffi::{c_char, CStr, CString};
    use std::path::Path;
    use std::sync::mpsc::channel;
    use std::time::Duration;

    #[link(name = "Speech", kind = "framework")]
    extern "C" {}
    #[link(name = "Foundation", kind = "framework")]
    extern "C" {}

    fn class(name: &CStr) -> Result<&'static AnyClass, String> {
        AnyClass::get(name).ok_or_else(|| format!("This version of macOS doesn't offer speech recognition ({} is missing).", name.to_string_lossy()))
    }

    fn ns_string(s: &str) -> Result<Retained<AnyObject>, String> {
        let c = CString::new(s).map_err(|_| "Text with a zero byte can't be passed to macOS.".to_string())?;
        let cls = class(c"NSString")?;
        let out: Option<Retained<AnyObject>> = unsafe { msg_send![cls, stringWithUTF8String: c.as_ptr()] };
        out.ok_or_else(|| "macOS could not make a string.".to_string())
    }

    /// # Safety
    /// `s` must be nil or an NSString.
    unsafe fn rust_string(s: *mut AnyObject) -> String {
        if s.is_null() {
            return String::new();
        }
        let p: *const c_char = unsafe { msg_send![s, UTF8String] };
        if p.is_null() {
            return String::new();
        }
        unsafe { CStr::from_ptr(p) }.to_string_lossy().into_owned()
    }

    fn recognizer() -> Result<Retained<AnyObject>, String> {
        let cls = class(c"SFSpeechRecognizer")?;
        let locale_cls = class(c"NSLocale")?;
        let id = ns_string("en-US")?;
        let locale: Option<Retained<AnyObject>> = unsafe { msg_send![locale_cls, localeWithLocaleIdentifier: &*id] };
        let locale = locale.ok_or_else(|| "macOS doesn't know the English (US) language setting.".to_string())?;
        let alloc: Allocated<AnyObject> = unsafe { msg_send![cls, alloc] };
        let rec: Option<Retained<AnyObject>> = unsafe { msg_send![alloc, initWithLocale: &*locale] };
        rec.ok_or_else(|| "macOS has no speech recogniser for English (US).".to_string())
    }

    /// Ask macOS for permission to recognise speech. Ok(true) when it runs on this computer.
    pub fn authorize() -> Result<bool, String> {
        let cls = class(c"SFSpeechRecognizer")?;
        let mut status: isize = unsafe { msg_send![cls, authorizationStatus] };
        if status == 0 {
            let (tx, rx) = channel::<isize>();
            let block = RcBlock::new(move |s: isize| {
                let _ = tx.send(s);
            });
            let _: () = unsafe { msg_send![cls, requestAuthorization: &*block] };
            status = rx.recv_timeout(Duration::from_secs(300)).map_err(|_| "macOS didn't answer the request to use speech recognition. Try turning 'Answer out loud' off and on again.".to_string())?;
        }
        match status {
            3 => {}
            1 => return Err("Speech recognition isn't allowed for this app. Allow it in System Settings > Privacy & Security > Speech Recognition, then turn 'Answer out loud' on again.".into()),
            2 => return Err("Speech recognition is restricted on this Mac (for example by Screen Time or a management profile).".into()),
            other => return Err(format!("Speech recognition permission wasn't given (status {other}).")),
        }
        autoreleasepool(|_| {
            let rec = recognizer()?;
            let available: bool = unsafe { msg_send![&*rec, isAvailable] };
            if !available {
                return Err("macOS speech recognition isn't available right now. Check that Siri or Dictation can be used (System Settings > Keyboard > Dictation) and, if it needs it, the internet connection.".into());
            }
            let on_device: bool = unsafe { msg_send![&*rec, supportsOnDeviceRecognition] };
            Ok(on_device)
        })
    }

    /// Recognise a short recording. Returns the recogniser's guesses, best first.
    pub fn recognize(path: &Path, vocabulary: &[String]) -> Result<Vec<String>, String> {
        autoreleasepool(|_| {
            let rec = recognizer()?;
            // Results arrive on a queue of their own, not the window's.
            let queue_cls = class(c"NSOperationQueue")?;
            let queue: Retained<AnyObject> = unsafe { msg_send![queue_cls, new] };
            let _: () = unsafe { msg_send![&*rec, setQueue: &*queue] };

            let url_cls = class(c"NSURL")?;
            let p = ns_string(&path.to_string_lossy())?;
            let url: Option<Retained<AnyObject>> = unsafe { msg_send![url_cls, fileURLWithPath: &*p] };
            let url = url.ok_or_else(|| "macOS could not open the recording.".to_string())?;
            let req_cls = class(c"SFSpeechURLRecognitionRequest")?;
            let alloc: Allocated<AnyObject> = unsafe { msg_send![req_cls, alloc] };
            let req: Option<Retained<AnyObject>> = unsafe { msg_send![alloc, initWithURL: &*url] };
            let req = req.ok_or_else(|| "macOS could not start recognising the recording.".to_string())?;
            let _: () = unsafe { msg_send![&*req, setShouldReportPartialResults: false] };
            let on_device: bool = unsafe { msg_send![&*rec, supportsOnDeviceRecognition] };
            if on_device {
                let _: () = unsafe { msg_send![&*req, setRequiresOnDeviceRecognition: true] };
            }
            let arr_cls = class(c"NSMutableArray")?;
            let words: Retained<AnyObject> = unsafe { msg_send![arr_cls, new] };
            for w in vocabulary {
                let s = ns_string(w)?;
                let _: () = unsafe { msg_send![&*words, addObject: &*s] };
            }
            let _: () = unsafe { msg_send![&*req, setContextualStrings: &*words] };

            let (tx, rx) = channel::<Result<Vec<String>, String>>();
            let block = RcBlock::new(move |result: *mut AnyObject, error: *mut AnyObject| {
                if !error.is_null() {
                    let desc: *mut AnyObject = unsafe { msg_send![error, localizedDescription] };
                    let code: isize = unsafe { msg_send![error, code] };
                    let text = unsafe { rust_string(desc) };
                    // "No speech detected" is not a failure: nothing was said.
                    if code == 1110 || text.to_lowercase().contains("no speech") {
                        let _ = tx.send(Ok(Vec::new()));
                    } else {
                        let _ = tx.send(Err(format!("macOS speech recognition failed: {text} (code {code})")));
                    }
                    return;
                }
                if result.is_null() {
                    return;
                }
                let done: bool = unsafe { msg_send![result, isFinal] };
                if !done {
                    return;
                }
                let list: *mut AnyObject = unsafe { msg_send![result, transcriptions] };
                let count: usize = if list.is_null() { 0 } else { unsafe { msg_send![list, count] } };
                let mut out = Vec::new();
                for i in 0..count.min(6) {
                    let t: *mut AnyObject = unsafe { msg_send![list, objectAtIndex: i] };
                    let s: *mut AnyObject = unsafe { msg_send![t, formattedString] };
                    out.push(unsafe { rust_string(s) });
                }
                let _ = tx.send(Ok(out));
            });
            let task: Option<Retained<AnyObject>> = unsafe { msg_send![&*rec, recognitionTaskWithRequest: &*req, resultHandler: &*block] };
            if task.is_none() {
                return Err("macOS could not start a speech recognition task.".into());
            }
            let res = rx.recv_timeout(Duration::from_secs(12));
            drop(task);
            match res {
                Ok(r) => r,
                Err(_) => Err("macOS speech recognition didn't answer within 12 seconds.".into()),
            }
        })
    }
}

#[cfg(not(target_os = "macos"))]
mod recognizer {
    use std::path::Path;
    pub fn authorize() -> Result<bool, String> {
        Err("Answering out loud uses macOS speech recognition, so it only works on a Mac.".into())
    }
    pub fn recognize(_path: &Path, _vocabulary: &[String]) -> Result<Vec<String>, String> {
        Err("Answering out loud only works on a Mac.".into())
    }
}


// ------------------------------------------------------------ Tauri commands

/// Shared with the listening thread: set `stop` to end it, `paused` to ignore the microphone.
#[derive(Default)]
pub struct VoiceState {
    current: Mutex<Option<(Arc<AtomicBool>, Arc<AtomicBool>)>>,
}

fn emit(app: &AppHandle, payload: serde_json::Value) {
    // Nothing useful can be done if the window is gone; the thread ends with the next event.
    let _ = app.emit("fret-voice", payload);
}

/// Start listening for spoken answers. Events arrive on the `fret-voice` channel:
/// ready, onset, heard, nothing, dropout, level and error.
#[tauri::command]
pub fn voice_start(app: AppHandle, state: State<VoiceState>, vocabulary: Vec<String>) -> Result<(), String> {
    let mut cur = state.current.lock().map_err(|_| "The listening state is locked up; restart the app.".to_string())?;
    if let Some((stop, _)) = cur.take() {
        stop.store(true, Ordering::Relaxed);
    }
    let stop = Arc::new(AtomicBool::new(false));
    let paused = Arc::new(AtomicBool::new(false));
    *cur = Some((stop.clone(), paused.clone()));
    std::thread::Builder::new()
        .name("voice events".into())
        .spawn(move || {
            // The microphone stream isn't Send, so it lives (and dies) on this thread.
            let listener = match Listener::start(vocabulary, paused, stop.clone()) {
                Ok(l) => l,
                Err(e) => {
                    emit(&app, json!({ "type": "error", "message": e }));
                    return;
                }
            };
            let mut last_level = Instant::now();
            while !stop.load(Ordering::Relaxed) {
                match listener.events.recv_timeout(Duration::from_millis(50)) {
                    Ok(Event::Ready { on_device }) => emit(&app, json!({ "type": "ready", "onDevice": on_device })),
                    Ok(Event::Onset(at)) => emit(&app, json!({ "type": "onset", "agoMs": at.elapsed().as_millis() as u64 })),
                    Ok(Event::Heard(g)) => emit(&app, json!({ "type": "heard", "guesses": g })),
                    Ok(Event::Nothing) => emit(&app, json!({ "type": "nothing" })),
                    Ok(Event::Dropout) => emit(&app, json!({ "type": "dropout" })),
                    Ok(Event::Error(e)) => {
                        emit(&app, json!({ "type": "error", "message": e }));
                        return;
                    }
                    Err(RecvTimeoutError::Timeout) => {}
                    Err(RecvTimeoutError::Disconnected) => {
                        if !stop.load(Ordering::Relaxed) {
                            emit(&app, json!({ "type": "error", "message": "Listening stopped unexpectedly." }));
                        }
                        return;
                    }
                }
                if last_level.elapsed() >= Duration::from_millis(50) {
                    last_level = Instant::now();
                    emit(&app, json!({ "type": "level", "value": listener.level() }));
                }
            }
        })
        .map_err(|e| format!("Could not start the listening thread: {e}"))?;
    Ok(())
}

#[tauri::command]
pub fn voice_stop(state: State<VoiceState>) -> Result<(), String> {
    let mut cur = state.current.lock().map_err(|_| "The listening state is locked up; restart the app.".to_string())?;
    if let Some((stop, _)) = cur.take() {
        stop.store(true, Ordering::Relaxed);
    }
    Ok(())
}

#[tauri::command]
pub fn voice_pause(state: State<VoiceState>, paused: bool) -> Result<(), String> {
    let cur = state.current.lock().map_err(|_| "The listening state is locked up; restart the app.".to_string())?;
    if let Some((_, p)) = cur.as_ref() {
        p.store(paused, Ordering::Relaxed);
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn recordings_are_valid_wav_files() {
        let dir = std::env::temp_dir().join(format!("practice_hub_wav_{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("t.wav");
        let samples: Vec<f32> = (0..4800).map(|i| (i as f32 * 0.05).sin() * 0.1).collect();
        write_wav(&path, &samples, 48000).unwrap();
        let b = std::fs::read(&path).unwrap();
        assert_eq!(&b[0..4], b"RIFF");
        assert_eq!(&b[8..16], b"WAVEfmt ");
        assert_eq!(u32::from_le_bytes([b[24], b[25], b[26], b[27]]), 48000);
        assert_eq!(b.len(), 44 + 4800 * 2);
        // Quiet speech is brought up: the loudest sample is near 0.7 of full scale.
        let peak = b[44..].chunks(2).map(|c| i16::from_le_bytes([c[0], c[1]]).unsigned_abs()).max().unwrap();
        assert!(peak > 20000 && peak < 24000, "{peak}");
        std::fs::remove_dir_all(&dir).unwrap();
    }
}
