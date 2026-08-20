/**
 * Sets a <video> element's currentTime, working around a WebKit quirk: assigning
 * `currentTime` before `readyState` reaches HAVE_METADATA is silently dropped
 * (Chromium instead defers it and honors it once metadata loads, per spec) — once
 * WebKit's metadata load finishes, playback just continues from wherever autoplay
 * left it, ignoring the earlier seek entirely. Deferring the assignment until
 * `loadedmetadata` fires makes seeks issued before the video is ready (e.g.
 * clicking a marker/region jump immediately after opening it) actually take effect.
 */
export function seekVideo(vid: HTMLVideoElement, time: number): void {
  if (vid.readyState >= HTMLMediaElement.HAVE_METADATA) {
    vid.currentTime = time;
  } else {
    vid.addEventListener("loadedmetadata", () => { vid.currentTime = time; }, { once: true });
  }
}
