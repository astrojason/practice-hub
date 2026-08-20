/**
 * Sets a <video> element's currentTime, working around a WebKit quirk: assigning
 * `currentTime` before `readyState` reaches HAVE_METADATA is silently dropped
 * (Chromium instead defers it and honors it once metadata loads, per spec) — once
 * WebKit's metadata load finishes, playback just continues from wherever autoplay
 * left it, ignoring the earlier seek entirely. Deferring the assignment until
 * `loadedmetadata` fires makes seeks issued before the video is ready (e.g.
 * clicking a marker/region jump immediately after opening it) actually take effect.
 *
 * While a seek is deferred, `vid.currentTime` itself doesn't reflect it yet — any
 * code that reads the "current position" in the meantime (e.g. computing where the
 * *next* marker jump should land) would see the stale pre-seek value and miscompute.
 * `getVideoTime` returns the pending target instead, so repeated calls before the
 * video is ready still compound correctly.
 */
interface PendingSeekState {
  pending?: number;
  listening?: boolean;
}

const pendingSeeks = new WeakMap<HTMLVideoElement, PendingSeekState>();

export function seekVideo(vid: HTMLVideoElement, time: number): void {
  if (vid.readyState >= HTMLMediaElement.HAVE_METADATA) {
    const state = pendingSeeks.get(vid);
    if (state) state.pending = undefined;
    vid.currentTime = time;
    return;
  }
  let state = pendingSeeks.get(vid);
  if (!state) {
    state = {};
    pendingSeeks.set(vid, state);
  }
  state.pending = time;
  if (!state.listening) {
    state.listening = true;
    vid.addEventListener("loadedmetadata", () => {
      state.listening = false;
      if (state.pending !== undefined) {
        vid.currentTime = state.pending;
        state.pending = undefined;
      }
    }, { once: true });
  }
}

/** The video's authoritative current position — the pending seek target if one is
 * still deferred (see `seekVideo`), otherwise the live `currentTime`. */
export function getVideoTime(vid: HTMLVideoElement): number {
  const state = pendingSeeks.get(vid);
  return state?.pending ?? vid.currentTime;
}
