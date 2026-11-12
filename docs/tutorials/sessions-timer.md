# Sessions &amp; the Practice Timer

The main practice screen is where you actually practice: a suggested list of exercises, study materials, and songs for today, each with its own timer, plus a running total toward your daily goal.

## The header

At the top: today's total practice time versus your daily goal, with a progress bar that fills in as you go (and a small confetti burst the moment you hit the goal). The action buttons:

- **Open Session** — a freeform timer not tied to any specific item, for practice that doesn't map to a catalog entry.
- **Add** — pick from your overdue songs.
- **Quick add** — search your *entire* catalog (songs, exercises, study materials) and add any of them to today's list.
- **Reports**, **GP Library**, **Calendar**, **Browse**, **Help**, **Metronome** — jump to the other screens/tools.
- **Rebuild** — refetches your suggested dashboard from the server.

## AI challenges

Below the header, the **AI Challenges** cards show today's, this week's and this month's challenges. They're written overnight by AI from your practice journal (session notes, "next time" prompts, recent items and To Learn songs) on practice.astrojason.com.

- Most challenges (learn a new song, spend 30 minutes on an item, practice on 5 days…) track themselves: the progress bar updates as you log sessions.
- Challenges the app can't measure have a **Mark done** button (and **Undo** if you tapped it by mistake).
- Completing challenges earns Challenges badges on the web app's Achievements page.

## Practicing an item

Each item (exercise, study material, or song) appears as a card grouped under **Exercises**, **Study Materials**, **Project**, or **Repertoire Review**. A card shows its name, subtitle, any tags, and a status icon (circle = not done, check = completed, forward arrow = skipped).

From a card you can:

- **▶ Start** — begins the timer and opens the session panel.
- **+ Log session** — skip the timer and log a session directly (useful for practice you already did).
- **⏭ Skip** — mark it done for today without logging a session.
- **✎ Edit** — change the item's details.
- **💬 Chat** — open an AI chat about this item. The icon highlights if your last 3+ rated sessions came back Awful/Bad, flagging something you might be struggling with.

Once a timer is running, the card collapses to show just the elapsed time — click it to reopen the session panel, where you can add notes, see your last session, view a rating-history chart, **Pause**/**Resume**, **Stop & Save**, or **Cancel** (discards the timer entirely).

Any resources attached to the item (links, YouTube, local audio/video/folders, Guitar Pro files) are listed at the top of the session panel — clicking one opens it in the appropriate place: the system browser for links, the in-app media player for audio/video, or the in-app **tab player** for Guitar Pro (`.gp`) tabs.

### Tab player

Clicking a Guitar Pro resource opens the tab player over the app (your session and timer keep running underneath). It draws the tab, follows it with a cursor and plays it with a built-in synth — pick a track (or **All tracks**), set the speed, loop a range of bars, and use the metronome, count-in and mixer. Click any bar to jump there; Space plays/pauses.

If the same item also has a local audio or video resource, choose it in the **Audio** menu to play the tab along with that recording instead of the synth. Press play, pause where bar 1 starts, then **Bar 1 starts here** to line the cursor up. If the recording speeds up or slows down, press **Sync this bar** (or `B`) at the start of bars where the tab drifts; the tab then follows the recording in straight lines between those points. Everything is remembered per tab + recording, and **Clear sync points** (with a confirmation) starts over. **Open in Guitar Pro** hands the file to the real Guitar Pro app. The tab player reads Guitar Pro 7/8 `.gp` files; older formats (`.gp3`, `.gp4`, `.gp5`, `.gpx`) open straight in the real Guitar Pro app.

## Sequential sessions

Exercises and study materials that have sub-items (e.g. a warm-up routine with several drills) show a play button that starts a **sequential session** instead of a single timer: it runs each child's timer in turn, prompting you to log or skip before automatically moving to the next one. Cancelling exits back to the dashboard; opening a resource's media pauses the sequence view without losing your place.

## Completing the day

The **Additional** group appears once you've added anything via **Add** or **Quick add**, tracked the same way as suggested items. The header banner reads **All done for today** once every suggested (and additional) item is either completed or skipped.

## Quick recap

- Cards live under Exercises / Study Materials / Project / Repertoire Review / Additional, each trackable independently.
- **Start** runs a timer, **Log session** skips straight to logging, **Skip** marks done without a session.
- The session panel has notes, history, Pause/Resume, Stop & Save, and Cancel.
- Parent items with children can run as a **sequential session** — one timer after another automatically.
- **Open Session** logs freeform time; **Add**/**Quick add** bring more items into today's list.
