// Talking to the Fretboard Trainer: speaking aloud (call-outs, key names) with the
// webview's speech synthesis, and listening for spoken quiz answers through the
// desktop app's microphone and macOS speech recogniser (see src-tauri/src/voice.rs).

import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

export type VoiceEvent =
  | { type: "ready"; onDevice: boolean }
  | { type: "onset"; agoMs: number }
  | { type: "heard"; guesses: string[] }
  | { type: "nothing" }
  | { type: "dropout" }
  | { type: "level"; value: number }
  | { type: "error"; message: string };

/** Where spoken answers come from. The desktop app supplies one; tests can put their own on `window`. */
export interface VoiceBackend {
  /** Start listening for the given words. Returns a function that stops listening. */
  start(vocabulary: string[], input: string, onEvent: (e: VoiceEvent) => void): Promise<() => void>;
  /** The microphones available and the system default one. */
  inputs(): Promise<{ inputs: string[]; default: string | null }>;
  /** Ignore the microphone while the app itself is making sound. */
  pause(paused: boolean): Promise<void>;
}

declare global {
  interface Window {
    __fretboardVoice?: VoiceBackend;
  }
}

const tauriBackend: VoiceBackend = {
  async start(vocabulary, input, onEvent) {
    if (!("__TAURI_INTERNALS__" in window)) {
      throw new Error("Answering out loud needs the Practice Hub desktop app: this window has no microphone access.");
    }
    const unlisten = await listen<VoiceEvent>("fret-voice", (e) => onEvent(e.payload));
    try {
      await invoke("voice_start", { vocabulary, input: input || null });
    } catch (err) {
      unlisten();
      throw new Error(typeof err === "string" ? err : err instanceof Error ? err.message : String(err));
    }
    return () => {
      unlisten();
      invoke("voice_stop").catch((err) => onEvent({ type: "error", message: `Could not stop listening: ${err instanceof Error ? err.message : String(err)}` }));
    };
  },
  async inputs() {
    if (!("__TAURI_INTERNALS__" in window)) throw new Error("Choosing a microphone needs the Practice Hub desktop app.");
    return invoke<{ inputs: string[]; default: string | null }>("voice_inputs");
  },
  async pause(paused) {
    await invoke("voice_pause", { paused });
  },
};

export const voiceBackend = (): VoiceBackend => window.__fretboardVoice ?? tauriBackend;

// ── Speaking ──

/** Words per minute for the speech voice, as a speech-synthesis rate (175 wpm is normal speed). */
export const rateFor = (wpm: number) => Math.max(0.5, Math.min(2, wpm / 175));

/** The voices this computer offers, English ones first. */
export function availableVoices(): SpeechSynthesisVoice[] {
  const voices = window.speechSynthesis?.getVoices() ?? [];
  return [...voices].sort((a, b) => Number(b.lang.startsWith("en")) - Number(a.lang.startsWith("en")) || a.name.localeCompare(b.name));
}

/** Say something aloud with the named voice (or the default). Throws if this webview cannot speak. */
export function speak(text: string, wpm: number, voiceName = ""): void {
  const synth = window.speechSynthesis;
  if (!synth || typeof SpeechSynthesisUtterance === "undefined") {
    throw new Error("This webview cannot speak aloud (no speech synthesis).");
  }
  synth.cancel();
  const u = new SpeechSynthesisUtterance(text);
  u.rate = rateFor(wpm);
  u.lang = "en-US";
  const chosen = voiceName ? window.speechSynthesis.getVoices().find((v) => v.name === voiceName) : undefined;
  if (chosen) {
    u.voice = chosen;
    u.lang = chosen.lang;
  }
  synth.speak(u);
}
