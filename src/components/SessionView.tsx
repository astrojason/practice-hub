import { useEffect, useMemo, useRef, useState } from "react";
import { getDashboard, getUser, rebuildDashboard } from "../api/client";
import type {
  CatalogExercise,
  CatalogStudyMaterial,
  DashboardData,
  DashboardExercise,
  DashboardStudyMaterial,
  Song,
  UserProfile,
} from "../api/types";

// ─── Catalog → dashboard shape converters ─────────────────────────────────────

function catalogExerciseToDashboard(ex: CatalogExercise): DashboardExercise {
  return {
    id: ex.id,
    name: ex.name,
    order: ex.order,
    resources: ex.resources,
    session_type: "exercise",
    parent_exercise_id: ex.parent_exercise_id,
    created_timestamp: 0,
    updated_timestamp: 0,
    child_exercises: ex.child_exercises.map(catalogExerciseToDashboard),
    meta: { user_exercise: null, sessions: [] },
  };
}

function catalogStudyMaterialToDashboard(sm: CatalogStudyMaterial): DashboardStudyMaterial {
  return {
    id: sm.id,
    name: sm.name,
    url: sm.url,
    instrument: sm.instrument,
    parent_study_material_id: sm.parent_study_material_id,
    session_type: "study_material",
    created_timestamp: 0,
    updated_timestamp: 0,
    childStudyMaterials: sm.childStudyMaterials.map(catalogStudyMaterialToDashboard),
    meta: { user_study_material: null, sessions: [] },
  };
}
import { SessionHeader } from "./session/SessionHeader";
import { ItemGroup } from "./session/ItemGroup";
import { ExerciseCard } from "./session/ExerciseCard";
import { SongCard } from "./session/SongCard";
import { StudyMaterialCard } from "./session/StudyMaterialCard";
import { OpenSessionForm } from "./session/forms/OpenSessionForm";
import { QuickAddPanel } from "./session/QuickAddPanel";
import { MediaPlayer } from "./player/MediaPlayer";
import { Metronome } from "./player/Metronome";
import { SequentialSessionModal } from "./session/SequentialSessionModal";
import type { SequentialChild } from "./session/SequentialSessionModal";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function isTimestampToday(tsMs: number): boolean {
  const fmt = (d: Date) => d.toLocaleDateString("en-CA"); // system timezone, matches LastSessionInfo
  return fmt(new Date(tsMs)) === fmt(new Date());
}

function hasSessionToday(sessions: { created_timestamp: number }[]): boolean {
  return sessions.some((s) => isTimestampToday(s.created_timestamp));
}

const COMPLETED_KEY = "ph_completed";

function loadStoredCompletedIds(): Set<string> {
  try {
    const stored = JSON.parse(localStorage.getItem(COMPLETED_KEY) ?? "null");
    const today = new Date().toLocaleDateString("en-CA");
    if (stored?.date === today && Array.isArray(stored.ids)) {
      return new Set<string>(stored.ids);
    }
  } catch {}
  return new Set<string>();
}

function mergeCompletedFromDash(dash: DashboardData, prev: Set<string>): Set<string> {
  const next = new Set(prev);
  for (const ex of dash.exercises) {
    if (hasSessionToday(ex.meta.sessions)) next.add(`exercise-${ex.id}`);
    for (const child of ex.child_exercises) {
      if (hasSessionToday(child.meta.sessions)) next.add(`exercise-${child.id}`);
    }
  }
  for (const sm of dash.study_materials) {
    if (hasSessionToday(sm.meta.sessions)) next.add(`studymaterial-${sm.id}`);
    for (const child of sm.childStudyMaterials) {
      if (hasSessionToday(child.meta.sessions)) next.add(`studymaterial-${child.id}`);
    }
  }
  for (const song of [...(dash.project?.songs ?? []), ...(dash.to_review?.songs ?? [])]) {
    if (hasSessionToday(song.meta?.sessions ?? [])) next.add(`song-${song.id}`);
  }
  return next;
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
  const [openSessionModalOpen, setOpenSessionModalOpen] = useState(false);
  const [showQuickAdd, setShowQuickAdd] = useState(false);

  // ── Sequential session (parent-triggers-children flow) ───────────────────────
  const [sequentialSession, setSequentialSession] = useState<{
    type: "exercise" | "study_material";
    parentId: number;
    parentName: string;
    children: SequentialChild[];
    currentIndex: number;
  } | null>(null);

  // ── Player / Metronome ────────────────────────────────────────────────────────
  const [playerState, setPlayerState] = useState<{
    path: string;
    mediaType: "audio" | "video";
    itemName: string;
  } | null>(null);
  const [metronomeOpen, setMetronomeOpen] = useState(false);

  const openPlayer = (path: string, mediaType: "audio" | "video", itemName: string) => {
    setPlayerState({ path, mediaType, itemName });
  };

  const OPEN_SESSION_KEY = "open-session";

  // ── User-added items (Quick Add) ─────────────────────────────────────────────
  const [additionalSongs, setAdditionalSongs] = useState<Song[]>([]);
  const [additionalExercises, setAdditionalExercises] = useState<DashboardExercise[]>([]);
  const [additionalStudyMaterials, setAdditionalStudyMaterials] = useState<DashboardStudyMaterial[]>([]);

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

        setCompletedIds((prev) => mergeCompletedFromDash(dash, new Set([...prev, ...loadStoredCompletedIds()])));
      })
      .catch((err: { which: string; message: string }) =>
        setLoadError({ which: err.which ?? "unknown", message: err.message ?? String(err) })
      );
  }, [token, loadTrigger]);

  // ── Persist completedIds for today across restarts ────────────────────────────
  useEffect(() => {
    localStorage.setItem(COMPLETED_KEY, JSON.stringify({
      date: new Date().toLocaleDateString("en-CA"),
      ids: [...completedIds],
    }));
  }, [completedIds]);

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
        ...(dashboard.study_materials ?? []).flatMap((sm) => [
          `studymaterial-${sm.id}`,
          ...sm.childStudyMaterials.map((c) => `studymaterial-${c.id}`),
        ]),
        ...(dashboard.project?.songs ?? []).map((s) => `song-${s.id}`),
        ...(dashboard.to_review?.songs ?? []).map((s) => `song-${s.id}`),
      ])
    : new Set();

  // ── Quick Add: IDs already in the session (passed to panel for filtering) ────
  const existingSongIds = useMemo(
    () =>
      new Set([
        ...(dashboard?.project?.songs ?? []).map((s) => s.id),
        ...(dashboard?.to_review?.songs ?? []).map((s) => s.id),
        ...additionalSongs.map((s) => s.id),
      ]),
    [dashboard, additionalSongs]
  );

  const existingExerciseIds = useMemo(() => {
    const ids = new Set(dashboard ? collectAllExerciseIds(dashboard.exercises) : []);
    for (const e of additionalExercises) {
      ids.add(e.id);
      for (const c of e.child_exercises) ids.add(c.id);
    }
    return ids;
  }, [dashboard, additionalExercises]);

  const existingStudyMaterialIds = useMemo(
    () =>
      new Set([
        ...(dashboard?.study_materials ?? []).map((sm) => sm.id),
        ...additionalStudyMaterials.map((sm) => sm.id),
      ]),
    [dashboard, additionalStudyMaterials]
  );

  const projectTags = useMemo(
    () => (dashboard?.project?.songs ?? []).flatMap((s) => s.tags),
    [dashboard]
  );

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
    return startedAt ? base + Math.max(0, Math.floor((now - startedAt) / 1000)) : base;
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

  function studyMaterialGetState(id: number) {
    const key = `studymaterial-${id}`;
    return {
      isCompletedToday: completedIds.has(key),
      isTimerActive: activeTimers.has(key),
      isTimerPaused: !activeTimers.has(key) && pausedElapsed.has(key),
      timerElapsed: getElapsed(key),
      isFormOpen: openForm === key,
    };
  }

  // ── Sequential session handlers ───────────────────────────────────────────────
  function handleStartSequential(type: "exercise" | "study_material", parentId: number) {
    let parentName = "";
    let children: SequentialChild[] = [];

    if (type === "exercise") {
      const all = [...(dashboard?.exercises ?? []), ...additionalExercises];
      const ex = all.find((e) => e.id === parentId);
      if (!ex || ex.child_exercises.length === 0) return;
      parentName = ex.name;
      children = ex.child_exercises.map((child) => ({
        id: child.id,
        name: child.name,
        resources: (child.resources ?? []).map((r) => ({ name: r.name, url: r.url, type: r.type })),
        lastSession: child.meta.sessions?.[0] ?? null,
      }));
    } else {
      const all = [...(dashboard?.study_materials ?? []), ...additionalStudyMaterials];
      const sm = all.find((s) => s.id === parentId);
      if (!sm || sm.childStudyMaterials.length === 0) return;
      parentName = sm.name;
      children = sm.childStudyMaterials.map((child) => ({
        id: child.id,
        name: child.name,
        resources: child.url ? [{ name: "Open material", url: child.url }] : [],
        lastSession: child.meta.sessions?.[0] ?? null,
      }));
    }

    setSequentialSession({ type, parentId, parentName, children, currentIndex: 0 });
    const firstKey = type === "exercise"
      ? `exercise-${children[0].id}`
      : `studymaterial-${children[0].id}`;
    startTimer(firstKey);
  }

  function handleSequentialChildSubmit(dailyPracticeTime: number) {
    if (!sequentialSession) return;
    const { type, parentId, children, currentIndex } = sequentialSession;
    const childId = children[currentIndex].id;
    const childKey = type === "exercise"
      ? `exercise-${childId}`
      : `studymaterial-${childId}`;

    handleSessionSubmit(dailyPracticeTime, childKey);

    const nextIndex = currentIndex + 1;
    if (nextIndex >= children.length) {
      // All children complete — mark parent as complete
      const parentKey = type === "exercise"
        ? `exercise-${parentId}`
        : `studymaterial-${parentId}`;
      setCompletedIds((prev) => new Set(prev).add(parentKey));
      setSequentialSession(null);
    } else {
      setSequentialSession((prev) => prev ? { ...prev, currentIndex: nextIndex } : null);
      const nextKey = type === "exercise"
        ? `exercise-${children[nextIndex].id}`
        : `studymaterial-${children[nextIndex].id}`;
      startTimer(nextKey);
    }
  }

  function handleCancelSequential() {
    if (!sequentialSession) return;
    const { type, children, currentIndex } = sequentialSession;
    const childKey = type === "exercise"
      ? `exercise-${children[currentIndex].id}`
      : `studymaterial-${children[currentIndex].id}`;
    cancelSession(childKey);
    setSequentialSession(null);
  }

  // ── Quick Add handlers ────────────────────────────────────────────────────────
  function handleAddSong(song: Song) {
    setAdditionalSongs((prev) => [...prev, song]);
  }

  function handleAddExercise(exercise: CatalogExercise) {
    setAdditionalExercises((prev) => [...prev, catalogExerciseToDashboard(exercise)]);
  }

  function handleAddStudyMaterial(material: CatalogStudyMaterial) {
    setAdditionalStudyMaterials((prev) => [...prev, catalogStudyMaterialToDashboard(material)]);
  }

  // ── Additional group completion counts ────────────────────────────────────────
  function additionalCompletedCount(): number {
    const exIds = additionalExercises.flatMap((e) => [
      e.id,
      ...e.child_exercises.map((c) => c.id),
    ]);
    return (
      additionalSongs.filter((s) => completedIds.has(`song-${s.id}`)).length +
      exIds.filter((id) => completedIds.has(`exercise-${id}`)).length +
      additionalStudyMaterials.flatMap((sm) => [sm, ...sm.childStudyMaterials])
        .filter((sm) => completedIds.has(`studymaterial-${sm.id}`)).length
    );
  }

  function additionalTotalCount(): number {
    const exIds = additionalExercises.flatMap((e) => [
      e.id,
      ...e.child_exercises.map((c) => c.id),
    ]);
    const smCount = additionalStudyMaterials.reduce((n, sm) => n + 1 + sm.childStudyMaterials.length, 0);
    return additionalSongs.length + exIds.length + smCount;
  }

  async function handleRebuild() {
    setIsRebuilding(true);
    try {
      const dash = await rebuildDashboard(token);
      setDashboard(dash);
      setCompletedIds((prev) => mergeCompletedFromDash(dash, prev));
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
      <div className="loading-screen">
        <div className="loading-spinner" />
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
        onOpenSession={() => {
          if (!activeTimers.has(OPEN_SESSION_KEY) && !pausedElapsed.has(OPEN_SESSION_KEY)) {
            startTimer(OPEN_SESSION_KEY);
          }
          setOpenSessionModalOpen((v) => !v);
        }}
        openSessionActive={activeTimers.has(OPEN_SESSION_KEY) || pausedElapsed.has(OPEN_SESSION_KEY)}
        openSessionElapsed={getElapsed(OPEN_SESSION_KEY)}
        onQuickAdd={() => setShowQuickAdd((v) => !v)}
        onMetronome={() => setMetronomeOpen((v) => !v)}
        onSignOut={onSignOut}
      />

      {openSessionModalOpen && (
        <OpenSessionForm
          token={token}
          elapsed={getElapsed(OPEN_SESSION_KEY)}
          isActive={activeTimers.has(OPEN_SESSION_KEY)}
          onPause={() => pauseTimer(OPEN_SESSION_KEY)}
          onResume={() => startTimer(OPEN_SESSION_KEY)}
          onClose={() => setOpenSessionModalOpen(false)}
          onCancel={() => {
            cancelSession(OPEN_SESSION_KEY);
            setOpenSessionModalOpen(false);
          }}
          onSubmit={(dpt) => {
            setServerTotal(dpt);
            cancelSession(OPEN_SESSION_KEY);
            setOpenSessionModalOpen(false);
          }}
        />
      )}

      {showQuickAdd && (
        <QuickAddPanel
          token={token}
          existingSongIds={existingSongIds}
          existingExerciseIds={existingExerciseIds}
          existingStudyMaterialIds={existingStudyMaterialIds}
          projectTags={projectTags}
          onAddSong={handleAddSong}
          onAddExercise={handleAddExercise}
          onAddStudyMaterial={handleAddStudyMaterial}
          onClose={() => setShowQuickAdd(false)}
        />
      )}

      {/* In-app media player — inline above item groups */}
      {playerState && (
        <MediaPlayer
          filePath={playerState.path}
          mediaType={playerState.mediaType}
          itemName={playerState.itemName}
          onClose={() => setPlayerState(null)}
        />
      )}

      {/* Standalone metronome panel */}
      {metronomeOpen && (
        <Metronome onClose={() => setMetronomeOpen(false)} />
      )}

      {/* Sequential session overlay */}
      {sequentialSession && (() => {
        const { type, parentName, children, currentIndex } = sequentialSession;
        const childId = children[currentIndex].id;
        const childKey = type === "exercise"
          ? `exercise-${childId}`
          : `studymaterial-${childId}`;
        return (
          <SequentialSessionModal
            token={token}
            type={type}
            parentName={parentName}
            children={children}
            currentIndex={currentIndex}
            isTimerActive={activeTimers.has(childKey)}
            timerElapsed={getElapsed(childKey)}
            isFormOpen={openForm === childKey}
            onStart={() => startTimer(childKey)}
            onPause={() => pauseTimer(childKey)}
            onStopAndSave={() => stopAndSave(childKey)}
            onSessionSubmit={handleSequentialChildSubmit}
            onFormClose={() => setOpenForm(null)}
            onCancelReturn={handleCancelSequential}
            onOpenFile={(path, mt) => openPlayer(path, mt, children[currentIndex].name)}
          />
        );
      })()}

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
              onStartSequential={(parentId) => handleStartSequential("exercise", parentId)}
              onOpenFile={(path, mt) => openPlayer(path, mt, ex.name)}
            />
          ))}
        </ItemGroup>

        {/* Study Materials */}
        <ItemGroup
          title="Study Materials"
          completedCount={
            dashboard.study_materials.flatMap((sm) => [sm, ...sm.childStudyMaterials])
              .filter((sm) => completedIds.has(`studymaterial-${sm.id}`)).length
          }
          totalCount={
            dashboard.study_materials.reduce((n, sm) => n + 1 + sm.childStudyMaterials.length, 0)
          }
        >
          {dashboard.study_materials.map((sm) => (
            <StudyMaterialCard
              key={sm.id}
              token={token}
              material={sm}
              getState={(id) => studyMaterialGetState(id)}
              onStart={(id) => startTimer(`studymaterial-${id}`)}
              onPause={(id) => pauseTimer(`studymaterial-${id}`)}
              onStopAndSave={(id) => stopAndSave(`studymaterial-${id}`)}
              onCancel={(id) => cancelSession(`studymaterial-${id}`)}
              onFormOpen={(id) => setOpenForm(`studymaterial-${id}`)}
              onFormClose={() => setOpenForm(null)}
              onSessionSubmit={(id, dpt) =>
                handleSessionSubmit(dpt, `studymaterial-${id}`)
              }
              onStartSequential={(parentId) => handleStartSequential("study_material", parentId)}
              onOpenFile={(path, mt) => openPlayer(path, mt, sm.name)}
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
              onOpenFile={(path, mt) => openPlayer(path, mt, song.name)}
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
              onOpenFile={(path, mt) => openPlayer(path, mt, song.name)}
            />
          ))}
        </ItemGroup>
        {/* Additional (user-added via Quick Add) */}
        {additionalTotalCount() > 0 && (
          <ItemGroup
            title="Additional"
            completedCount={additionalCompletedCount()}
            totalCount={additionalTotalCount()}
          >
            {additionalSongs.map((song) => (
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
                onOpenFile={(path, mt) => openPlayer(path, mt, song.name)}
              />
            ))}
            {additionalExercises.map((ex) => (
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
                onStartSequential={(parentId) => handleStartSequential("exercise", parentId)}
                onOpenFile={(path, mt) => openPlayer(path, mt, ex.name)}
              />
            ))}
            {additionalStudyMaterials.map((sm) => (
              <StudyMaterialCard
                key={sm.id}
                token={token}
                material={sm}
                getState={(id) => studyMaterialGetState(id)}
                onStart={(id) => startTimer(`studymaterial-${id}`)}
                onPause={(id) => pauseTimer(`studymaterial-${id}`)}
                onStopAndSave={(id) => stopAndSave(`studymaterial-${id}`)}
                onCancel={(id) => cancelSession(`studymaterial-${id}`)}
                onFormOpen={(id) => setOpenForm(`studymaterial-${id}`)}
                onFormClose={() => setOpenForm(null)}
                onSessionSubmit={(id, dpt) =>
                  handleSessionSubmit(dpt, `studymaterial-${id}`)
                }
                onStartSequential={(parentId) => handleStartSequential("study_material", parentId)}
                onOpenFile={(path, mt) => openPlayer(path, mt, sm.name)}
              />
            ))}
          </ItemGroup>
        )}
      </main>
    </div>
  );
}
