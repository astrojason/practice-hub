import { test, expect } from "./base";

const mockUser = {
  id: 1, firebase_uid: "test-uid", email: "test@example.com", display_name: "Test User",
  daily_minutes_goal: 30, timezone: "America/New_York", time_practiced_today: 0,
  total_time_practiced: 0, max_days_no_review: 7, min_days_between_reviews: 1, num_songs_to_learn: 5,
};

const mockDashboard = {
  scale: null, key_signature: null, overdue: [], to_review: { songs: [] }, to_learn: { songs: [] },
  project: { songs: [] }, exercises: [], study_materials: [], chord: null, progression: null, interval: null,
};


const SPOKEN_NOTES = ["C", "C sharp", "D", "D sharp", "E", "F", "F sharp", "G", "G sharp", "A", "A sharp", "B"];
const STD = [40, 45, 50, 55, 59, 64];
type P = import("@playwright/test").Page;

/** A stand-in for the desktop app's microphone: tests push "heard" phrases through `window.__voiceEmit`. */
async function stubVoice(page: P) {
  await page.addInitScript(() => {
    const w = window as unknown as Record<string, unknown>;
    w.__voiceStarts = 0;
    w.__voicePauses = [];
    w.__fretboardVoice = {
      start: async (vocab: string[], onEvent: (e: unknown) => void) => {
        w.__voiceStarts = (w.__voiceStarts as number) + 1;
        w.__voiceVocab = vocab;
        w.__voiceEmit = onEvent;
        onEvent({ type: "ready", onDevice: true });
        return () => {
          w.__voiceStopped = true;
        };
      },
      pause: async (p: boolean) => (w.__voicePauses as boolean[]).push(p),
    };
    // Record what is spoken instead of making noise.
    const spoken: { text: string; rate: number }[] = [];
    w.__spoken = spoken;
    window.speechSynthesis.speak = (u: SpeechSynthesisUtterance) => void spoken.push({ text: u.text, rate: u.rate });
  });
}

test.beforeEach(async ({ page }) => {
  await stubVoice(page);
  await page.addInitScript(() => {
    localStorage.setItem("ph:refreshToken", "fake-refresh-token");
    if (!localStorage.getItem("ph:fretboard:settings")) {
      localStorage.setItem("ph:fretboard:settings", JSON.stringify({ countIn: 0, bpm: 240, notesPerBeat: 4, loop: false, click: false }));
    }
  });
  await page.route("**/securetoken.googleapis.com/**", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ id_token: "fake-id-token", refresh_token: "fake-refresh-token" }) })
  );
  await page.route("**/user/me", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(mockUser) }));
  await page.route("**/user/dashboard**", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(mockDashboard) }));
  await page.goto("/");
  await page.locator("button", { hasText: "Fretboard" }).first().click();
});

const emit = (page: P, e: unknown) => page.evaluate((ev) => (window as unknown as { __voiceEmit: (x: unknown) => void }).__voiceEmit(ev), e);
const spokenList = (page: P) => page.evaluate(() => (window as unknown as { __spoken: { text: string; rate: number }[] }).__spoken);

async function startVoiceQuiz(page: P) {
  await page.locator(".fb-tab", { hasText: "Quiz" }).click();
  await page.locator(".fb-quiz-side label", { hasText: "Answer out loud" }).locator("input").check();
  await page.getByRole("button", { name: /Start/ }).first().click();
}

async function litPitchClass(page: P) {
  const el = page.locator('.fb-note[data-quiz="true"]').first();
  const s = parseInt((await el.getAttribute("data-string")) ?? "0");
  const f = parseInt((await el.getAttribute("data-fret")) ?? "0");
  return (STD[s] + f) % 12;
}

test("spoken answers are understood (same cases as the Craft app)", async ({ page }) => {
  const failures = await page.evaluate(async () => {
    const { spokenAnswer, spokenCommand } = await import("/src/lib/fretboard/spoken.ts");
    const { BOTH_NAMES, CHORDS, chordIndex } = await import("/src/lib/fretboard/theory.ts");
    const { INTERVALS } = await import("/src/lib/fretboard/quiz.ts");
    const bad: string[] = [];
    const eq = (label: string, got: unknown, want: unknown) => {
      if (JSON.stringify(got) !== JSON.stringify(want)) bad.push(`${label}: got ${JSON.stringify(got)} want ${JSON.stringify(want)}`);
    };
    const g = (t: string) => [t];
    const notes = [...BOTH_NAMES];
    eq("C sharp", spokenAnswer("note", notes, g("C sharp")), 1);
    eq("D flat sign", spokenAnswer("note", notes, g("D♭")), 1);
    eq("Eb", spokenAnswer("note", notes, g("Eb")), 3);
    eq("B flat", spokenAnswer("note", notes, g("B flat")), 10);
    eq("bee", spokenAnswer("note", notes, g("bee")), 11);
    eq("G", spokenAnswer("note", notes, g("G")), 7);
    eq("hmm", spokenAnswer("note", notes, g("hmm")), null);
    eq("later guess", spokenAnswer("note", notes, ["um", "F sharp"]), 6);
    const degrees = ["1  (C)", "2  (D)", "b3  (Eb)", "4  (F)", "5  (G)", "b6  (Ab)", "b7  (Bb)"];
    eq("flat three", spokenAnswer("degree", degrees, g("flat three")), 2);
    eq("b7", spokenAnswer("degree", degrees, g("b7")), 6);
    eq("root", spokenAnswer("degree", degrees, g("root")), 0);
    eq("minor third degree", spokenAnswer("degree", degrees, g("minor third")), 2);
    eq("three", spokenAnswer("degree", degrees, g("three")), 2);
    eq("fifth", spokenAnswer("degree", degrees, g("fifth")), 4);
    eq("A flat", spokenAnswer("degree", degrees, g("A flat")), 5);
    const ivs = [...INTERVALS];
    eq("minor third", spokenAnswer("interval", ivs, g("minor third")), 2);
    eq("perfect 5th", spokenAnswer("interval", ivs, g("Perfect 5th")), 6);
    eq("tritone", spokenAnswer("interval", ivs, g("tritone")), 5);
    eq("octave", spokenAnswer("interval", ivs, g("octave")), 11);
    eq("major seventh", spokenAnswer("earinterval", ivs, g("major seventh")), 10);
    eq("third alone", spokenAnswer("interval", ivs, g("third")), null);
    const chords = ["", "m", "dim", "aug", "7", "maj7", "m7"].map((s) => CHORDS[chordIndex(s)].name);
    const named = (t: string) => chords[spokenAnswer("earchord", chords, g(t)) ?? -1];
    eq("minor seven", named("minor seven"), "Minor 7");
    eq("dominant 7", named("dominant 7"), "Dominant 7");
    eq("diminished", named("diminished"), "Diminished");
    eq("major", named("major"), "Major");
    eq("next", spokenCommand(g("next")), "next");
    eq("again", spokenCommand(g("play it again")), "again");
    eq("not a command", spokenCommand(g("C sharp")), null);
    return bad;
  });
  expect(failures).toEqual([]);
});

test("Answer out loud listens during a running quiz, and a spoken answer is scored", async ({ page }) => {
  await startVoiceQuiz(page);
  await expect(page.locator(".fb-voice-status")).toContainText("Listening");
  const vocab = await page.evaluate(() => (window as unknown as { __voiceVocab: string[] }).__voiceVocab);
  expect(vocab).toContain("C sharp");
  expect(vocab).toContain("next");
  const pc = await litPitchClass(page);
  await emit(page, { type: "onset", agoMs: 0 });
  await emit(page, { type: "heard", guesses: [SPOKEN_NOTES[pc]] });
  await expect(page.locator(".fb-quiz-feedback")).toContainText("Correct!");
  await expect(page.locator(".fb-voice-heard")).toContainText(SPOKEN_NOTES[pc]);
  // "next" moves on; "again" replays without scoring.
  await emit(page, { type: "heard", guesses: ["next"] });
  await expect(page.locator(".fb-quiz-feedback")).toHaveCount(0);
  await emit(page, { type: "heard", guesses: ["again"] });
  await expect(page.locator(".fb-quiz-score")).toHaveText("1 / 1");
  const wrong = SPOKEN_NOTES[((await litPitchClass(page)) + 1) % 12];
  await emit(page, { type: "heard", guesses: [wrong] });
  await expect(page.locator(".fb-quiz-feedback")).toContainText("Not quite.");
});

test("the microphone is paused while the app makes its own sound", async ({ page }) => {
  await startVoiceQuiz(page);
  await expect(page.locator(".fb-voice-status")).toContainText("Listening");
  await page.keyboard.press("1");
  await expect.poll(() => page.evaluate(() => (window as unknown as { __voicePauses: boolean[] }).__voicePauses.includes(true))).toBe(true);
});

test("a level meter, dropouts and unrecognised speech are shown", async ({ page }) => {
  await startVoiceQuiz(page);
  await emit(page, { type: "level", value: 0.2 });
  await expect(page.locator(".fb-voice-meter")).toBeVisible();
  await emit(page, { type: "dropout" });
  await emit(page, { type: "dropout" });
  await expect(page.locator(".fb-voice-status")).toContainText("2 audio dropouts");
  await emit(page, { type: "nothing" });
  await expect(page.locator(".fb-voice-heard")).toContainText("nothing recognised");
  await expect(page.locator(".fb-voice-error")).toHaveCount(0);
});

test("a listening problem is shown with its message and a Try again button; the quiz keeps running", async ({ page }) => {
  await startVoiceQuiz(page);
  await emit(page, { type: "error", message: "Speech recognition isn't allowed for this app. Allow it in System Settings." });
  await expect(page.locator(".fb-voice-error")).toContainText("System Settings");
  await expect(choicesLocator(page)).toHaveCount(12);
  await page.getByRole("button", { name: "Try again" }).click();
  await expect(page.locator(".fb-voice-status")).toContainText("Listening");
  await expect.poll(() => page.evaluate(() => (window as unknown as { __voiceStarts: number }).__voiceStarts)).toBe(2);
});

const choicesLocator = (page: P) => page.locator(".fb-quiz-choice");

test("in a browser with no microphone access the reason is shown", async ({ page }) => {
  await page.addInitScript(() => {
    delete (window as unknown as Record<string, unknown>).__fretboardVoice;
  });
  await page.reload();
  await page.locator("button", { hasText: "Fretboard" }).first().click();
  await startVoiceQuiz(page);
  await expect(page.locator(".fb-voice-error")).toContainText("desktop app");
});

test("call-outs and the next key can be spoken aloud, at the chosen voice speed", async ({ page }) => {
  await page.locator(".fb-tab", { hasText: "Practice" }).click();
  await page.locator('select[aria-label="Call-outs"]').selectOption("note");
  await page.locator("label", { hasText: "Speak call-outs" }).locator("input").check();
  await page.getByTestId("fb-play").click();
  await expect.poll(async () => (await spokenList(page)).length).toBeGreaterThan(0);
  const first = (await spokenList(page))[0];
  expect(first.text).toMatch(/^(see|dee|ee|eff|gee|ay|bee)/);
  expect(first.rate).toBeCloseTo(1, 1);
  await page.getByTestId("fb-play").click();
  // The circle of fifths says the next key.
  await page.locator('select[aria-label="Routine"]').selectOption({ label: "Circle of fifths" });
  await page.getByTestId("fb-play").click();
  await expect.poll(async () => (await spokenList(page)).some((s) => /major/.test(s.text))).toBe(true);
  await page.getByTestId("fb-play").click();
});

test("voice speed is a setting", async ({ page }) => {
  await page.locator('button[aria-label="Fretboard settings"]').click();
  const dlg = page.locator('[role="dialog"][aria-label="Fretboard settings"]');
  await dlg.locator('input[aria-label="Voice speed"]').fill("260");
  await dlg.locator('input[aria-label="Voice speed"]').dispatchEvent("change");
  await dlg.locator("button", { hasText: "Done" }).click();
  await page.locator(".fb-tab", { hasText: "Practice" }).click();
  await page.locator('select[aria-label="Call-outs"]').selectOption("note");
  await page.locator("label", { hasText: "Speak call-outs" }).locator("input").check();
  await page.getByTestId("fb-play").click();
  await expect.poll(async () => (await spokenList(page)).length).toBeGreaterThan(0);
  expect((await spokenList(page))[0].rate).toBeGreaterThan(1.3);
  await page.getByTestId("fb-play").click();
});
