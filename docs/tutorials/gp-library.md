# Guitar Pro Library

The GP Library scanner walks a folder of Guitar Pro tab files, matches each one to a song in your catalog, computes a difficulty score from the tab itself, and pushes the results (score + file link) up to Instrumenta.

## Opening the library

From the main practice screen, click **GP Library** in the header.

## Setting the library folder

1. Enter the path to your Guitar Pro folder in **Library folder** (e.g. `/Users/you/Sheet Music`).
2. Click **Scan & Analyze**.

The scan runs in three steps, shown as a progress trail: **Scan files → Match catalog → Analyze**. Analysis is the slow part — a progress bar shows how many files are left.

Files only match a song if their filename follows the pattern:

```
Artist-Song Title-MM-DD-YYYY.gp
```

Any extension (`.gp`, `.gp3`, `.gp4`, `.gp5`, `.gpx`) works.

## Reviewing matched files

Matched files show up in a table with song, artist, date, BPM, and a computed **difficulty** score (0–100). A few things you can do here:

- **Sort** by clicking any column header (Song, Artist, Date, Difficulty).
- **Expand a row** (▸) to see the score breakdown across six axes — Speed, Fret, Picking, Rhythm, Technique, Stamina — each with a short description on hover.
- **Override the score** by clicking the score itself and typing a new value (0–100). Overridden scores are tagged **manual** and always win over the computed one.
- **Open the file** in Guitar Pro by clicking the filename.
- **View the tab** in-app by clicking the ♩ icon — this opens the Guitar Pro Viewer (see its own tutorial for pitch, tempo, and looping controls).

Rows are tagged **new** (first time scored) or **updated** (a newer file version was found since the last push).

## Unmatched files

Files that couldn't be matched to a catalog song land in a separate **Unmatched** section, along with what artist/title the scanner parsed from the filename. From there you can open the file, view it, or **Dismiss** it so it stops showing up on future scans.

## Force Rescan

**Scan & Analyze** skips files it's already seen (based on a local cache) so repeat scans are fast. If you've edited a file's content without changing its filename, or want to reprocess everything from scratch, use **Force Rescan** — it clears that cache first.

## Pushing to Instrumenta

Once you're happy with the results, the bottom of the screen shows how many files are ready to push. Click **Push to Instrumenta (N)** to save each difficulty score and register the file as a resource on its matching song. If some pushes fail, the errors are listed so you know which files to retry.

## Quick recap

- Point the scanner at your Guitar Pro folder and click **Scan & Analyze**.
- Matched files show a computed difficulty score you can expand or manually override.
- Unmatched files need filenames in `Artist-Song Title-MM-DD-YYYY.gp` format to match.
- **Force Rescan** re-analyzes everything, ignoring the seen-file cache.
- **Push to Instrumenta** saves scores and file links to your catalog.
