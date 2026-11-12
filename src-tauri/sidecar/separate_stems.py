#!/usr/bin/env python3
"""
Instrument stem separation for the media player's instrument filter.

  separate_stems.py separate <input> <outdir>
      Runs Demucs (htdemucs_6s) on <input> (any audio/video ffmpeg can read)
      and writes vocals/drums/bass/guitar/piano/other .wav stems into
      <outdir>, plus a stems.json manifest. The manifest is written last, so
      a partial/failed run never looks like a finished cache entry.
      Prints the manifest JSON to stdout.

  separate_stems.py mix <stemdir> <outpath> <keep>
      Sums the stems named in <keep> (comma-separated; may be empty for
      silence) into a single 16-bit .wav at <outpath>.

Errors go to stderr with a non-zero exit code; the Tauri command surfaces the
stderr text to the user.
"""

import json
import os
import shutil
import sys
import tempfile
import wave

MODEL = "htdemucs_6s"
STEMS = ["vocals", "drums", "bass", "guitar", "piano", "other"]


def fail(msg: str) -> None:
    sys.stderr.write(msg.rstrip() + "\n")
    sys.exit(1)


def separate(input_path: str, outdir: str) -> None:
    if not os.path.isfile(input_path):
        fail(f"File not found: {input_path}")
    try:
        import demucs.separate  # noqa: F401
    except ImportError:
        fail(
            "Demucs isn't installed for this Python. Install it with:\n"
            f"  {sys.executable} -m pip install demucs"
        )

    os.makedirs(outdir, exist_ok=True)
    work = tempfile.mkdtemp(prefix="stems-", dir=outdir)
    try:
        import demucs.separate as ds
        try:
            ds.main([
                "-n", MODEL,
                "-o", work,
                "--filename", "{stem}.{ext}",
                input_path,
            ])
        except SystemExit as e:  # demucs calls sys.exit on bad input
            if e.code not in (0, None):
                fail(f"Demucs failed (exit {e.code}) separating {input_path}")

        produced = os.path.join(work, MODEL)
        stems = []
        for name in STEMS:
            src = os.path.join(produced, f"{name}.wav")
            if not os.path.isfile(src):
                fail(f"Demucs didn't produce a '{name}' stem for {input_path}")
            dst = os.path.join(outdir, f"{name}.wav")
            shutil.move(src, dst)
            stems.append({"name": name, "path": dst})

        manifest = {"model": MODEL, "stems": stems}
        with open(os.path.join(outdir, "stems.json"), "w") as f:
            json.dump(manifest, f)
        print(json.dumps(manifest))
    finally:
        shutil.rmtree(work, ignore_errors=True)


def mix(stemdir: str, outpath: str, keep: list) -> None:
    try:
        import numpy as np
    except ImportError:
        fail(f"numpy isn't installed for this Python. Install it with:\n  {sys.executable} -m pip install numpy")

    unknown = [k for k in keep if k not in STEMS]
    if unknown:
        fail(f"Unknown stem(s): {', '.join(unknown)}")

    # Read the first stem for the format even when nothing is kept, so the
    # silent mix still has the file's length/rate/channels.
    ref_path = os.path.join(stemdir, f"{(keep or STEMS)[0]}.wav")
    if not os.path.isfile(ref_path):
        fail(f"Stem file missing: {ref_path} — separate the file again.")
    with wave.open(ref_path, "rb") as ref:
        params = ref.getparams()
    if params.sampwidth != 2:
        fail(f"Unsupported stem sample width {params.sampwidth * 8}-bit (expected 16-bit)")

    total = np.zeros(params.nframes * params.nchannels, dtype=np.int32)
    for name in keep:
        path = os.path.join(stemdir, f"{name}.wav")
        if not os.path.isfile(path):
            fail(f"Stem file missing: {path} — separate the file again.")
        with wave.open(path, "rb") as w:
            if (w.getnchannels(), w.getframerate()) != (params.nchannels, params.framerate):
                fail(f"Stem '{name}' doesn't match the other stems' format")
            data = np.frombuffer(w.readframes(w.getnframes()), dtype=np.int16).astype(np.int32)
        n = min(len(data), len(total))
        total[:n] += data[:n]

    out = np.clip(total, -32768, 32767).astype(np.int16)
    tmp = outpath + ".part"
    with wave.open(tmp, "wb") as w:
        w.setnchannels(params.nchannels)
        w.setsampwidth(2)
        w.setframerate(params.framerate)
        w.writeframes(out.tobytes())
    os.replace(tmp, outpath)
    print(outpath)


def main(argv: list) -> None:
    if len(argv) >= 3 and argv[0] == "separate":
        separate(argv[1], argv[2])
    elif len(argv) >= 3 and argv[0] == "mix":
        keep = [k for k in (argv[3] if len(argv) > 3 else "").split(",") if k]
        mix(argv[1], argv[2], keep)
    else:
        fail(__doc__ or "usage: separate_stems.py separate|mix ...")


if __name__ == "__main__":
    main(sys.argv[1:])
