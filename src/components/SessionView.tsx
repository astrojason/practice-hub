import { useEffect, useRef, useState } from "react";
import { getDashboard, getUser, rebuildDashboard } from "../api/client";
import type {
  DashboardData,
  DashboardExercise,
  UserProfile,
} from "../api/types";
import { SessionHeader } from "./session/SessionHeader";
import { ItemGroup } from "./session/ItemGroup";
import { ExerciseCard } from "./session/ExerciseCard";
import { SongCard } from "./session/SongCard";
import { StudyMaterialCard } from "./session/StudyMaterialCard";
import { OpenSessionForm } from "./session/forms/OpenSessionForm";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function isTimestampToday(tsMs: number, timezone: string): boolean {
  const fmt = (d: Date) => d.toLocaleDateString("en-CA", { timeZone: timezone });
  return fmt(new Date(tsMs)) === fmt(new Date());
}

function hasSessionToday(
  sessions: { created_timestamp: number }[],
  timezone: string
): boolean {
  return sessions.some((s) => isTimestampToday(s.created_timestamp, timezone));
}

function collectAllExerciseIds(exercises: DashboardExercise[]): number[] {
  const ids: number[] = [];
  for (const ex of exercises) {
    ids.push(ex.id);
    for (const child of ex.child_exercises) ids.push(child.id);
  }
  return ids;
}

// ─── Component ────────────────────────────────────────────────────────────────

interface Props {
  token: string;
  onSignOut: () => Promise<void>;
}

export function SessionView({ token, onSignOut }: Props) {
  // ── Load state ──────────────────────────────────────────────────────────────
  const [dashboard, setDashboard] = useState<DashboardData | null>(null);
  const [userProfile, setUserProfile] = useState<UserProfile | null>(null);
  const [loadError, setLoadError] = useState<{ message: string; which: string } | null>(null);
  const [loadTrigger, setLoadTrigger] = useState(0);
  const [isRebuilding, setIsRebuilding] = useState(false);

  // ── Timer state ─────────────────────────────────────────────────────────────
  // displayedSeconds = serverTotal + sum of all in-session elapsed (running + paused)
  const [serverTotal, setServerTotal] = useState(0);
  const [now, setNow] = useState(Date.now());

  // ── Per-item state ───────────────────────────────────────────────────────────
  // completedIds: "exercise-{id}" | "song-{id}" | "studymaterial-{id}"
  const [completedIds, setCompletedIds] = useState<Set<string>>(new Set());
  // activeTimers: itemKey → Date.now() when the current run started
  const [activeTimers, setActiveTimers] = useState<Map<string, number>>(new Map());
  // pausedElapsed: itemKey → accumulated seconds (set on pause or stop-and-save)
  const [pausedElapsed, setPausedElapsed] = useState<Map<string, number>>(new Map());
  // openForm: which item's form is expanded (only one at a time)
  const [openForm, setOpenForm] = useState<string | null>(null);
  const [showOpenSession, setShowOpenSession] = useState(false);

  // ── Visual-state-shift guards ────────────────────────────────────────────────
  const goalFiredRef = useRef(false);
  const allCompleteFiredRef = useRef(false);
  const confettiCanvasRef = useRef<HTMLCanvasElement>(null);

  // ── Load on mount ────────────────────────────────────────────────────────────
  useEffect(() => {
    setLoadError(null);
    let dashResult: DashboardData | null = null;
    let userResult: UserProfile | null = null;

    const loadDash = getDashboard(token).then((d) => { dashResult = d; }).catch((err) => {
      throw { which: "dashboard (/user/dashboard)", message: err instanceof Error ? err.message : String(err) };
    });
    const loadUser = getUser(token).then((u) => { userResult = u; }).catch((err) => {
      throw { which: "user profile (/user/me)", message: err instanceof Error ? err.message : String(err) };
    });

    Promise.all([loadDash, loadUser])
      .then(() => {
        const dash = dashResult!;
        const user = userResult!;
        setDashboard(dash);
        setUserProfile(user);
        setServerTotal(user.time_practiced_today ?? 0);

        const tz = user.timezone || "UTC";
        const completed = new Set<string>();

        for (const ex of dash.exercises) {
          if (hasSessionToday(ex.meta.sessions, tz))
            completed.add(`exercise-${ex.id}`);
          for (const child of ex.child_exercises) {
            if (hasSessionToday(child.meta.sessions, tz))
              completed.add(`exercise-${child.id}`);
          }
        }
        for (const sm of dash.study_materials) {
          if (hasSessionToday(sm.meta.sessions, tz))
            completed.add(`studymaterial-${sm.id}`);
        }
        for (const song of dash.project?.songs ?? []) {
          if (hasSessionToday(song.meta?.sessions ?? [], tz))
            completed.add(`song-${song.id}`);
        }
        for (const song of dash.to_review?.songs ?? []) {
          if (hasSessionToday(song.meta?.sessions ?? [], tz))
            completed.add(`song-${song.id}`);
        }
        setCompletedIds(completed);
      })
      .catch((err: { which: string; message: string }) =>
        setLoadError({ which: err.which ?? "unknown", message: err.message ?? String(err) })
      );
  }, [token, loadTrigger]);

  // ── Clock tick ───────────────────────────────────────────────────────────────
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  // ── Derived values ────────────────────────────────────────────────────────────
  // Running timers: base (from prior pauses) + current run elapsed
  const activeElapsed = [...activeTimers.entries()].reduce(
    (sum, [key, startedAt]) => {
      const base = pausedElapsed.get(key) ?? 0;
      return sum + base + Math.floor((now - startedAt) / 1000);
    },
    0
  );
  // Paused items not currently running
  const pausedOnlyTotal = [...pausedElapsed.entries()]
    .filter(([key]) => !activeTimers.has(key))
    .reduce((sum, [, secs]) => sum + secs, 0);
  const displayedSeconds = serverTotal + activeElapsed + pausedOnlyTotal;

  const dailyGoalSeconds = (userProfile?.daily_minutes_goal ?? 30) * 60;
  const goalReached = displayedSeconds >= dailyGoalSeconds;

  const allSuggestedIds: Set<string> = dashboard
    ? new Set([
        ...collectAllExerciseIds(dashboard.exercises).map(
          (id) => `exercise-${id}`
        ),
        ...(dashboard.study_materials ?? []).map(
          (sm) => `studymaterial-${sm.id}`
        ),
        ...(dashboard.project?.songs ?? []).map((s) => `song-${s.id}`),
        ...(dashboard.to_review?.songs ?? []).map((s) => `song-${s.id}`),
      ])
    : new Set();

  const allComplete =
    allSuggestedIds.size > 0 &&
    [...allSuggestedIds].every((id) => completedIds.has(id));

  // ── Visual state shift effects ────────────────────────────────────────────────
  useEffect(() => {
    if (goalReached && !goalFiredRef.current) {
      goalFiredRef.current = true;
      fireConfetti();
    }
  }, [goalReached]);

  useEffect(() => {
    if (allComplete && !allCompleteFiredRef.current) {
      allCompleteFiredRef.current = true;
      // The all-complete banner already appears via the allComplete prop;
      // additional shimmer is handled via CSS on the banner element.
    }
  }, [allComplete]);

  // ── Confetti (canvas-based, no external library) ───────────────────────────
  function fireConfetti() {
    const canvas = confettiCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
    canvas.style.display = "block";

    const colors = ["#ff6b6b", "#feca57", "#48dbfb", "#ff9ff3", "#54a0ff", "#5f27cd"];
    const particles = Array.from({ length: 120 }, () => ({
      x: Math.random() * canvas.width,
      y: -10,
      r: 4 + Math.random() * 6,
      color: colors[Math.floor(Math.random() * colors.length)],
      vx: (Math.random() - 0.5) * 4,
      vy: 2 + Math.random() * 4,
      alpha: 1,
    }));

    let frame = 0;
    function tick() {
      if (!ctx || !canvas) return;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      for (const p of particles) {
        p.x += p.vx;
        p.y += p.vy;
        p.vy += 0.1; // gravity
        p.alpha -= 0.008;
        ctx.globalAlpha = Math.max(0, p.alpha);
        ctx.fillStyle = p.color;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
      frame++;
      if (frame < 180) requestAnimationFrame(tick);
      else canvas.style.display = "none";
    }
    requestAnimationFrame(tick);
  }

  // ── Item state helpers ────────────────────────────────────────────────────────
  function getElapsed(itemKey: string): number {
    const base = pausedElapsed.get(itemKey) ?? 0;
    const startedAt = activeTimers.get(itemKey);
    return startedAt ? base + Math.floor((now - startedAt) / 1000) : base;
  }

  function startTimer(itemKey: string) {
    setActiveTimers((prev) => new Map(prev).set(itemKey, Date.now()));
  }

  function pauseTimer(itemKey: string) {
    const total = getElapsed(itemKey);
    setActiveTimers((prev) => {
      const next = new Map(prev);
      next.delete(itemKey);
      return next;
    });
    setPausedElapsed((prev) => new Map(prev).set(itemKey, total));
  }

  function stopAndSave(itemKey: string) {
    const total = getElapsed(itemKey);
    setActiveTimers((prev) => {
      const next = new Map(prev);
      next.delete(itemKey);
      return next;
    });
    setPausedElapsed((prev) => new Map(prev).set(itemKey, total));
    setOpenForm(itemKey);
  }

  function cancelSession(itemKey: string) {
    setActiveTimers((prev) => {
      const next = new Map(prev);
      next.delete(itemKey);
      return next;
    });
    setPausedElapsed((prev) => {
      const next = new Map(prev);
      next.delete(itemKey);
      return next;
    });
    setOpenForm(null);
  }

  function handleSessionSubmit(dailyPracticeTime: number, itemKey: string) {
    setServerTotal(dailyPracticeTime);
    setCompletedIds((prev) => new Set(prev).add(itemKey));
    setActiveTimers((prev) => {
      const next = new Map(prev);
      next.delete(itemKey);
      return next;
    });
    setPausedElapsed((prev) => {
      const next = new Map(prev);
      next.delete(itemKey);
      return next;
    });
    setOpenForm(null);
  }

  // ── Exercise helpers (exercise cards use IDs rather than keys directly) ──────
  function exerciseGetState(id: number) {
    const key = `exercise-${id}`;
    return {
      isCompletedToday: completedIds.has(key),
      isTimerActive: activeTimers.has(key),
      isTimerPaused: !activeTimers.has(key) && pausedElapsed.has(key),
      timerElapsed: getElapsed(key),
      isFormOpen: openForm === key,
    };
  }

  async function handleRebuild() {
    setIsRebuilding(true);
    try {
      const dash = await rebuildDashboard(token);
      setDashboard(dash);
    } catch {
      // silent — dashboard stays unchanged
    } finally {
      setIsRebuilding(false);
    }
  }

  // ── Completion counts for group headers ───────────────────────────────────────
  function exerciseCompletedCount(): number {
    if (!dashboard) return 0;
    return collectAllExerciseIds(dashboard.exercises).filter((id) =>
      completedIds.has(`exercise-${id}`)
    ).length;
  }

  function exerciseTotalCount(): number {
    if (!dashboard) return 0;
    return collectAllExerciseIds(dashboard.exercises).length;
  }

  // ── Render ────────────────────────────────────────────────────────────────────
  if (loadError) {
    return (
      <div className="session-view load-error-view">
        <div className="load-error-card">
          <h2 className="load-error-title">Failed to load</h2>
          <p className="load-error-which">Request: <code>{loadError.which}</code></p>
          <p className="load-error-message">{loadError.message}</p>
          <div className="load-error-actions">
            <button className="btn-primary" onClick={() => setLoadTrigger((n) => n + 1)}>
              Retry
            </button>
            <button className="btn-ghost" onClick={onSignOut}>
              Sign out
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (!dashboard || !userProfile) {
    return (
      <div className="session-view loading">
        <p>Loading…</p>
      </div>
    );
  }

  const projectSongs = dashboard.project?.songs ?? [];
  const reviewSongs = dashboard.to_review?.songs ?? [];

  return (
    <div className="session-view">
      {/* Full-screen confetti canvas — hidden until triggered */}
      <canvas
        ref={confettiCanvasRef}
        className="confetti-canvas"
        style={{ display: "none" }}
      />

      <SessionHeader
        displayedSeconds={displayedSeconds}
        dailyGoalSeconds={dailyGoalSeconds}
        goalReached={goalReached}
        allComplete={allComplete}
        isRebuilding={isRebuilding}
        onRebuild={handleRebuild}
        onOpenSession={() => setShowOpenSession((v) => !v)}
        onSignOut={onSignOut}
      />

      {showOpenSession && (
        <OpenSessionForm
          token={token}
          onSubmit={(dpt) => {
            setServerTotal(dpt);
            setShowOpenSession(false);
          }}
          onCancel={() => setShowOpenSession(false)}
        />
      )}

      <main className="session-main">
        {/* Exercises */}
        <ItemGroup
          title="Exercises"
          completedCount={exerciseCompletedCount()}
          totalCount={exerciseTotalCount()}
        >
          {dashboard.exercises.map((ex) => (
            <ExerciseCard
              key={ex.id}
              token={token}
              exercise={ex}
              getState={(id) => exerciseGetState(id)}
              onStart={(id) => startTimer(`exercise-${id}`)}
              onPause={(id) => pauseTimer(`exercise-${id}`)}
              onStopAndSave={(id) => stopAndSave(`exercise-${id}`)}
              onCancel={(id) => cancelSession(`exercise-${id}`)}
              onFormOpen={(id) => setOpenForm(`exercise-${id}`)}
              onFormClose={() => setOpenForm(null)}
              onSessionSubmit={(id, dpt) =>
                handleSessionSubmit(dpt, `exercise-${id}`)
              }
            />
          ))}
        </ItemGroup>

        {/* Study Materials */}
        <ItemGroup
          title="Study Materials"
          completedCount={
            dashboard.study_materials.filter((sm) =>
              completedIds.has(`studymaterial-${sm.id}`)
            ).length
          }
          totalCount={dashboard.study_materials.length}
        >
          {dashboard.study_materials.map((sm) => (
            <StudyMaterialCard
              key={sm.id}
              token={token}
              material={sm}
              isCompletedToday={completedIds.has(`studymaterial-${sm.id}`)}
              isTimerActive={activeTimers.has(`studymaterial-${sm.id}`)}
              isTimerPaused={
                !activeTimers.has(`studymaterial-${sm.id}`) &&
                pausedElapsed.has(`studymaterial-${sm.id}`)
              }
              timerElapsed={getElapsed(`studymaterial-${sm.id}`)}
              isFormOpen={openForm === `studymaterial-${sm.id}`}
              onStart={() => startTimer(`studymaterial-${sm.id}`)}
              onPause={() => pauseTimer(`studymaterial-${sm.id}`)}
              onStopAndSave={() => stopAndSave(`studymaterial-${sm.id}`)}
              onCancel={() => cancelSession(`studymaterial-${sm.id}`)}
              onFormOpen={() => setOpenForm(`studymaterial-${sm.id}`)}
              onFormClose={() => setOpenForm(null)}
              onSessionSubmit={(dpt) =>
                handleSessionSubmit(dpt, `studymaterial-${sm.id}`)
              }
            />
          ))}
        </ItemGroup>

        {/* Project Songs */}
        <ItemGroup
          title="Project"
          completedCount={
            projectSongs.filter((s) => completedIds.has(`song-${s.id}`)).length
          }
          totalCount={projectSongs.length}
        >
          {projectSongs.map((song) => (
            <SongCard
              key={song.id}
              token={token}
              song={song}
              isCompletedToday={completedIds.has(`song-${song.id}`)}
              isTimerActive={activeTimers.has(`song-${song.id}`)}
              isTimerPaused={
                !activeTimers.has(`song-${song.id}`) &&
                pausedElapsed.has(`song-${song.id}`)
              }
              timerElapsed={getElapsed(`song-${song.id}`)}
              isFormOpen={openForm === `song-${song.id}`}
              onStart={() => startTimer(`song-${song.id}`)}
              onPause={() => pauseTimer(`song-${song.id}`)}
              onStopAndSave={() => stopAndSave(`song-${song.id}`)}
              onCancel={() => cancelSession(`song-${song.id}`)}
              onFormOpen={() => setOpenForm(`song-${song.id}`)}
              onFormClose={() => setOpenForm(null)}
              onSessionSubmit={(dpt) =>
                handleSessionSubmit(dpt, `song-${song.id}`)
              }
            />
          ))}
        </ItemGroup>

        {/* Repertoire Review */}
        <ItemGroup
          title="Repertoire Review"
          completedCount={
            reviewSongs.filter((s) => completedIds.has(`song-${s.id}`)).length
          }
          totalCount={reviewSongs.length}
        >
          {reviewSongs.map((song) => (
            <SongCard
              key={song.id}
              token={token}
              song={song}
              isCompletedToday={completedIds.has(`song-${song.id}`)}
              isTimerActive={activeTimers.has(`song-${song.id}`)}
              isTimerPaused={
                !activeTimers.has(`song-${song.id}`) &&
                pausedElapsed.has(`song-${song.id}`)
              }
              timerElapsed={getElapsed(`song-${song.id}`)}
              isFormOpen={openForm === `song-${song.id}`}
              onStart={() => startTimer(`song-${song.id}`)}
              onPause={() => pauseTimer(`song-${song.id}`)}
              onStopAndSave={() => stopAndSave(`song-${song.id}`)}
              onCancel={() => cancelSession(`song-${song.id}`)}
              onFormOpen={() => setOpenForm(`song-${song.id}`)}
              onFormClose={() => setOpenForm(null)}
              onSessionSubmit={(dpt) =>
                handleSessionSubmit(dpt, `song-${song.id}`)
              }
            />
          ))}
        </ItemGroup>
      </main>
    </div>
  );
}
