# Guitar Pro Viewer

The GP Viewer renders a Guitar Pro tab file in-app and can sync it to a real audio recording, so you can follow notation while playing along with the actual song — with independent pitch shifting, tempo control, and looping.

## Opening a tab

You can open the viewer from a few places:

- The ♩ icon next to any file in the **GP Library** scanner.
- A **Guitar Pro** resource link inside a session card's panel.
- A Guitar Pro file inside an expanded local-folder resource.

## The basics

The header shows the tab's title, artist, and tempo once it loads. If the file has multiple tracks, a dropdown lets you switch which one is rendered.

## Loading a backing track

The viewer doesn't play the tab's internal MIDI — it drives the notation cursor from an actual audio file you load yourself. Click **Load audio** at the bottom and pick a file (mp3, wav, flac, m4a, ogg, aac). Once loaded, the **Play** bar becomes usable: play/pause, stop, a click-to-seek progress bar, and a time display.

## Pitch controls

Two independent pitch controls, always visible at the top:

- **Audio** — shifts the pitch of the loaded backing track, in semitones plus a fine ±10-cent adjustment. Useful if the recording is tuned slightly off standard.
- **Tab** — transposes the *notation display* by semitones, without affecting the audio.
- **Link** — ties the two together, so adjusting one adjusts the other by the same amount.
- **Reset** appears whenever any pitch shift is active, to zero everything out at once.

## Tempo

The **Tempo** control shows the score's original BPM and lets you set a different **target tempo** — the audio's playback speed scales to match. A reset arrow appears next to it to snap back to the original score tempo.

## Looping

Use the **Loop** bar to practice a section on repeat:

1. Play to (or seek to) the point you want to start from, then click **Set** next to **In**.
2. Do the same for **Out**.
3. Toggle **Loop** on — playback will now repeat between those two points.
4. **Clear** removes both points.

The loop region is also shown as a highlighted band on the progress bar.

## Audio offset

The cursor position is computed directly from the same timing used to lay out the notation, so it shouldn't drift over the course of a track. If it's still consistently a touch ahead of or behind what you hear — typically genuine audio-output-device latency — use the **Offset** control (in milliseconds, next to the loaded file name) to nudge the cursor forward or back until it lines up.

## Debug console

At the bottom, **▼ Debug** expands a log of internal player/loading events — useful if playback or sync isn't behaving and you need to see what's going on under the hood.

## Persistence

Everything you set — selected track, target tempo, loop points, pitch shifts, and the loaded audio file — is remembered per tab file, so reopening the same file later picks up right where you left off.

## Quick recap

- Load a real audio recording to drive playback; the tab notation follows it.
- **Audio** pitch shifts the recording, **Tab** pitch transposes the notation — **Link** ties them together.
- **Tempo** changes playback speed relative to the score's original BPM.
- Set **Loop In/Out** points and toggle **Loop** to repeat a section.
- Use **Offset** if the cursor and audio drift out of sync.
