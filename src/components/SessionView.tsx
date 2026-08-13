import { useEffect, useMemo, useRef, useState } from "react";
import {
  getDashboard,
  getExerciseCatalog,
  getExerciseSessionHistory,
  getStudyMaterialById,
  getStudyMaterialSessionHistory,
  getUser,
  rebuildDashboard,
} from "../api/client";
import type {
  CatalogExercise,
  CatalogExerciseWithActive,
  CatalogStudyMaterial,
  DashboardData,
  DashboardExercise,
  DashboardStudyMaterial,
  ExerciseSession,
  Resource,
  Song,
  SongSession,
  StudyMaterialSession,
  UserProfile,
} from "../api/types";
import { ChatPanel } from "./chat/ChatPanel";
import type { ChatEntity } from "./chat/ChatPanel";
import { ErrorModal } from "./ErrorModal";
import { HelpModal } from "./HelpModal";
import { PracticeTimeReport } from "./reports/PracticeTimeReport";
import { catalogExerciseToDashboard, catalogStudyMaterialToDashboard } from "../api/catalogConvert";
import { makeItemKey, parseItemKey } from "../lib/itemKey";
import { readLocalStorageJSON, writeLocalStorageJSON } from "../hooks/useLocalStorageJSON";
import { SessionHeader } from "./session/SessionHeader";
import { ItemGroup } from "./session/ItemGroup";
import { ExerciseCard } from "./session/ExerciseCard";
import { SongCard } from "./session/SongCard";
import { StudyMaterialCard } from "./session/StudyMaterialCard";
import { OpenSessionForm } from "./session/forms/OpenSessionForm";
import { QuickAddPanel } from "./session/QuickAddPanel";
import { QuickAddModal } from "./session/QuickAddModal";
import { MediaPlayer } from "./player/MediaPlayer";
import { Metronome } from "./player/Metronome";
import { SequentialSessionModal } from "./session/SequentialSessionModal";
import { ConfettiCanvas } from "./session/ConfettiCanvas";
import type { ConfettiCanvasHandle } from "./session/ConfettiCanvas";
import { useSessionTimers } from "../hooks/useSessionTimers";
import { useSequentialSession } from "../hooks/useSequentialSession";
import pkgJson from "../../package.json";

const APP_VERSION: string = pkgJson.version;

// ─── Helpers ──────────────────────────────────────────────────────────────────

function isTimestampToday(tsMs: number): boolean {
  const fmt = (d: Date) => d.toLocaleDateString("en-CA"); // system timezone, matches LastSessionInfo
  return fmt(new Date(tsMs)) === fmt(new Date());
}

function hasSessionToday(sessions: { created_timestamp: number }[]): boolean {
  return sessions.some((s) => isTimestampToday(s.created_timestamp));
}

const COMPLETED_KEY = "ph_completed";
const SKIPPED_KEY = "ph_skipped";

interface StoredIdsResult {
  ids: Set<string>;
  error: string | null;
}

interface StoredIds {
  date: string;
  ids: string[];
}

function loadStoredCompletedIds(): StoredIdsResult {
  const { value: stored, error } = readLocalStorageJSON<StoredIds | null>(COMPLETED_KEY, null);
  if (error) {
    return {
      ids: new Set<string>(),
      error: `Couldn't read today's completed items from local storage — they've been reset. (${error})`,
    };
  }
  const today = new Date().toLocaleDateString("en-CA");
  if (stored?.date === today && Array.isArray(stored.ids)) {
    return { ids: new Set<string>(stored.ids), error: null };
  }
  return { ids: new Set<string>(), error: null };
}

function loadStoredSkippedIds(): StoredIdsResult {
  const { value: stored, error } = readLocalStorageJSON<StoredIds | null>(SKIPPED_KEY, null);
  if (error) {
    return {
      ids: new Set<string>(),
      error: `Couldn't read today's skipped items from local storage — they've been reset. (${error})`,
    };
  }
  const today = new Date().toLocaleDateString("en-CA");
  if (stored?.date === today && Array.isArray(stored.ids)) {
    return { ids: new Set<string>(stored.ids), error: null };
  }
  return { ids: new Set<string>(), error: null };
}

// Marks a parent exercise/study-material as done in `doneIds` once every one of
// its direct children is already present in `doneIds` — the single source of
// truth for that rule, used everywhere a parent's completion needs recomputing.
function autoCompleteParents(
  exercises: DashboardExercise[],
  studyMaterials: DashboardStudyMaterial[],
  doneIds: Set<string>
): Set<string> {
  const next = new Set(doneIds);
  for (const ex of exercises) {
    const parentKey = makeItemKey("exercise", ex.id);
    if (
      ex.child_exercises.length > 0 &&
      !next.has(parentKey) &&
      ex.child_exercises.every((c) => next.has(makeItemKey("exercise", c.id)))
    ) {
      next.add(parentKey);
    }
  }
  for (const sm of studyMaterials) {
    const parentKey = makeItemKey("studymaterial", sm.id);
    const children = sm.child_study_materials ?? [];
    if (children.length > 0 && !next.has(parentKey) && children.every((c) => next.has(makeItemKey("studymaterial", c.id)))) {
      next.add(parentKey);
    }
  }
  return next;
}

function mergeCompletedFromDash(dash: DashboardData, prev: Set<string>): Set<string> {
  let next = new Set(prev);
  for (const ex of dash.exercises) {
    if (hasSessionToday(ex.meta.sessions)) next.add(makeItemKey("exercise", ex.id));
    for (const child of ex.child_exercises) {
      if (hasSessionToday(child.meta.sessions)) next.add(makeItemKey("exercise", child.id));
    }
  }
  for (const sm of dash.study_materials) {
    if (hasSessionToday(sm.meta.sessions)) next.add(makeItemKey("studymaterial", sm.id));
    for (const child of sm.child_study_materials ?? []) {
      if (hasSessionToday(child.meta.sessions)) next.add(makeItemKey("studymaterial", child.id));
    }
  }
  for (const song of [...(dash.project?.songs ?? []), ...(dash.to_review?.songs ?? [])]) {
    if (hasSessionToday(song.meta?.sessions ?? [])) next.add(makeItemKey("song", song.id));
  }
  next = autoCompleteParents(dash.exercises, dash.study_materials, next);
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

function nestStudyMaterials(flat: DashboardStudyMaterial[]): DashboardStudyMaterial[] {
  // Study materials are exactly two levels deep: a parent and its direct children.
  // The API may return a parent with its children already nested inside
  // child_study_materials, or return children as flat siblings referencing their
  // parent via parent_study_material_id — sometimes both in the same response.
  // Gather every item (top-level entries plus any already-nested children) into
  // one pool, keyed by id, before rebuilding the two-level tree.
  const all: DashboardStudyMaterial[] = [];
  for (const sm of flat) {
    all.push(sm);
    for (const child of sm.child_study_materials ?? []) all.push(child);
  }

  const byId = new Map<number, DashboardStudyMaterial>();
  for (const sm of all) {
    const id = Number(sm.id);
    if (!byId.has(id)) byId.set(id, { ...sm, child_study_materials: [] });
  }

  const roots: DashboardStudyMaterial[] = [];
  const rootIds = new Set<number>();
  for (const sm of all) {
    const id = Number(sm.id);
    const node = byId.get(id)!;
    const parent = sm.parent_study_material_id != null ? byId.get(Number(sm.parent_study_material_id)) : undefined;
    // A valid parent is itself parentless. This keeps the hierarchy exactly two
    // levels and stops malformed data — a self-reference, or two items each
    // naming the other as parent — from nesting items into an unreachable cycle
    // that silently drops them from the dashboard.
    const isValidChild = parent && parent.id !== node.id && parent.parent_study_material_id == null;
    if (isValidChild) {
      if (!parent!.child_study_materials!.some((c) => c.id === node.id)) {
        parent!.child_study_materials!.push(node);
      }
      continue;
    }
    if (!rootIds.has(id)) {
      rootIds.add(id);
      roots.push(node);
    }
  }
  return roots;
}

// Returns IDs of parent study materials that are referenced by orphaned root items
// but not present in the nested list.
function findOrphanParentIds(nested: DashboardStudyMaterial[]): number[] {
  const presentIds = new Set(nested.map((sm) => sm.id));
  const orphanIds = new Set<number>();
  for (const sm of nested) {
    if (sm.parent_study_material_id != null && !presentIds.has(sm.parent_study_material_id)) {
      orphanIds.add(sm.parent_study_material_id);
    }
  }
  return [...orphanIds];
}

/**
 * Fetches orphaned study-material parents by id, tolerating individual failures
 * (a missing/unreachable parent shouldn't block the rest of the dashboard from
 * rendering) while still reporting which ids failed and why, so the failure is
 * visible instead of silently rendering the child as if it had no parent.
 */
async function fetchOrphanParents(
  token: string,
  ids: number[]
): Promise<{ parents: DashboardStudyMaterial[]; errorMessage: string | null }> {
  const settled = await Promise.allSettled(ids.map((id) => getStudyMaterialById(token, id)));
  const parents: DashboardStudyMaterial[] = [];
  const failures: string[] = [];
  settled.forEach((result, i) => {
    if (result.status === "fulfilled") {
      parents.push(result.value);
    } else {
      const reason = result.reason;
      failures.push(`#${ids[i]}: ${reason instanceof Error ? reason.message : String(reason)}`);
    }
  });
  const errorMessage = failures.length > 0
    ? `Failed to load ${failures.length} parent study material${failures.length > 1 ? "s" : ""}: ${failures.join("; ")}`
    : null;
  return { parents, errorMessage };
}

// ─── Component ────────────────────────────────────────────────────────────────

interface Props {
  token: string;
  onSignOut: () => Promise<void>;
  onGpLibrary: () => void;
  onCalendar: () => void;
  onBrowse: () => void;
  onChangelog: () => void;
  onGpView?: (path: string) => void;
}

export function SessionView({ token, onSignOut, onGpLibrary, onCalendar, onBrowse, onChangelog, onGpView }: Props) {
  const [helpOpen, setHelpOpen] = useState(false);
  // ── Load state ──────────────────────────────────────────────────────────────
  const [dashboard, setDashboard] = useState<DashboardData | null>(null);
  const [userProfile, setUserProfile] = useState<UserProfile | null>(null);
  const [loadError, setLoadError] = useState<{ message: string; which: string } | null>(null);
  const [loadTrigger, setLoadTrigger] = useState(0);
  const [isRebuilding, setIsRebuilding] = useState(false);
  const [rebuildError, setRebuildError] = useState<string | null>(null);
  const [orphanFetchError, setOrphanFetchError] = useState<string | null>(null);
  const [historicalExercisesError, setHistoricalExercisesError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [quickAddHistoryError, setQuickAddHistoryError] = useState<string | null>(null);

  // ── Timer state ─────────────────────────────────────────────────────────────
  // displayedSeconds = serverTotal + sum of all in-session elapsed (running + paused)
  const [serverTotal, setServerTotal] = useState(0);
  const [now, setNow] = useState(Date.now());

  // ── Per-item state ───────────────────────────────────────────────────────────
  // Read once on mount — captured alongside any read error so a corrupted
  // localStorage value resets state (safe) but doesn't do so silently.
  const [initialStoredIds] = useState(() => ({
    completed: loadStoredCompletedIds(),
    skipped: loadStoredSkippedIds(),
  }));
  const [storageError, setStorageError] = useState<string | null>(
    [initialStoredIds.completed.error, initialStoredIds.skipped.error].filter(Boolean).join(" ") || null
  );
  // completedIds: "exercise-{id}" | "song-{id}" | "studymaterial-{id}"
  const [completedIds, setCompletedIds] = useState<Set<string>>(new Set());
  // skippedIds: subset of completedIds — items marked skipped (no session created)
  const [skippedIds, setSkippedIds] = useState<Set<string>>(initialStoredIds.skipped.ids);
  const { activeTimers, pausedElapsed, getElapsed, startTimer, pauseTimer, clearTimer } = useSessionTimers(now);
  // openForm: which item's form is expanded (only one at a time)
  const [openForm, setOpenForm] = useState<string | null>(null);
  const [openSessionModalOpen, setOpenSessionModalOpen] = useState(false);
  const [showAdd, setShowAdd] = useState(false);
  const [showQuickAddModal, setShowQuickAddModal] = useState(false);

  // ── Chat / Reports ────────────────────────────────────────────────────────────
  const [chatEntity, setChatEntity] = useState<ChatEntity | null>(null);
  const [reportOpen, setReportOpen] = useState(false);
  const [historicalExercises, setHistoricalExercises] = useState<CatalogExerciseWithActive[]>([]);
  const [historicalExercisesLoaded, setHistoricalExercisesLoaded] = useState(false);

  // Loaded lazily on first chat open (rather than on every dashboard load) so a
  // fetch failure only interrupts the user at the point the data is actually
  // needed, and doesn't cost a network round-trip for sessions that never open chat.
  useEffect(() => {
    if (!chatEntity || historicalExercisesLoaded) return;
    getExerciseCatalog(token)
      .then((exercises) => {
        setHistoricalExercises(exercises);
        setHistoricalExercisesLoaded(true);
      })
      .catch((err) =>
        setHistoricalExercisesError(
          `Couldn't load exercise history for AI chat context: ${err instanceof Error ? err.message : String(err)}`
        )
      );
  }, [chatEntity, historicalExercisesLoaded, token]);

  // ── Player / Metronome ────────────────────────────────────────────────────────
  const [playerState, setPlayerState] = useState<{
    path: string;
    mediaType: "audio" | "video";
    itemName: string;
    itemKey?: string;
    songId?: number;
  } | null>(null);
  const [metronomeOpen, setMetronomeOpen] = useState(false);

  const openPlayer = (path: string, mediaType: "audio" | "video", itemName: string, itemKey?: string) => {
    const parsedKey = itemKey ? parseItemKey(itemKey) : null;
    const songId = parsedKey?.type === "song" ? parsedKey.id : undefined;
    setPlayerState({ path, mediaType, itemName, itemKey, songId: Number.isFinite(songId) ? songId : undefined });
  };

  const OPEN_SESSION_KEY = "open-session";

  // ── User-added items (Quick Add) ─────────────────────────────────────────────
  const [additionalSongs, setAdditionalSongs] = useState<Song[]>([]);
  const [additionalExercises, setAdditionalExercises] = useState<DashboardExercise[]>([]);
  const [additionalStudyMaterials, setAdditionalStudyMaterials] = useState<DashboardStudyMaterial[]>([]);

  // ── Visual-state-shift guards ────────────────────────────────────────────────
  const goalFiredRef = useRef(false);
  const allCompleteFiredRef = useRef(false);
  const confettiRef = useRef<ConfettiCanvasHandle>(null);
  // Tracks the calendar day completedIds/skippedIds were computed for, so a
  // midnight rollover while the app stays open (no remount) can be detected.
  const currentDayRef = useRef(new Date().toLocaleDateString("en-CA"));

  // ── Load on mount ────────────────────────────────────────────────────────────
  useEffect(() => {
    setLoadError(null);
    setOrphanFetchError(null);

    Promise.allSettled([getDashboard(token), getUser(token)]).then(async ([dashResult, userResult]) => {
      const failures: { which: string; message: string }[] = [];
      if (dashResult.status === "rejected") {
        failures.push({
          which: "dashboard (/user/dashboard)",
          message: dashResult.reason instanceof Error ? dashResult.reason.message : String(dashResult.reason),
        });
      }
      if (userResult.status === "rejected") {
        failures.push({
          which: "user profile (/user/me)",
          message: userResult.reason instanceof Error ? userResult.reason.message : String(userResult.reason),
        });
      }
      // Surface every failed request, not just whichever one Promise.all would have
      // reported first — a support report of "why won't it load" is only useful if
      // it doesn't discard half the story when both requests fail together.
      if (failures.length > 0) {
        setLoadError({
          which: failures.map((f) => f.which).join(" + "),
          message: failures.map((f) => f.message).join(" | "),
        });
        return;
      }

      const raw = (dashResult as PromiseFulfilledResult<DashboardData>).value;
      const user = (userResult as PromiseFulfilledResult<UserProfile>).value;
      let nestedSms = nestStudyMaterials(raw.study_materials);

      // If any top-level study material is an orphan (its parent isn't in the dashboard
      // response), fetch the parent and re-nest so the hierarchy displays correctly.
      const orphanParentIds = findOrphanParentIds(nestedSms);
      if (orphanParentIds.length > 0) {
        const { parents, errorMessage } = await fetchOrphanParents(token, orphanParentIds);
        if (errorMessage) setOrphanFetchError(errorMessage);
        if (parents.length > 0) {
          nestedSms = nestStudyMaterials([...raw.study_materials, ...parents]);
        }
      }

      const dash = { ...raw, study_materials: nestedSms };
      setDashboard(dash);
      setUserProfile(user);
      setServerTotal(user.time_practiced_today ?? 0);

      setCompletedIds((prev) => mergeCompletedFromDash(dash, new Set([...prev, ...loadStoredCompletedIds().ids])));
    });
  }, [token, loadTrigger]);

  // ── Persist completedIds for today across restarts ────────────────────────────
  useEffect(() => {
    writeLocalStorageJSON(COMPLETED_KEY, {
      date: new Date().toLocaleDateString("en-CA"),
      ids: [...completedIds],
    });
  }, [completedIds]);

  // ── Persist skippedIds for today across restarts ──────────────────────────────
  useEffect(() => {
    writeLocalStorageJSON(SKIPPED_KEY, {
      date: new Date().toLocaleDateString("en-CA"),
      ids: [...skippedIds],
    });
  }, [skippedIds]);

  // ── Auto-complete parents when all children are done (completed or skipped) ───
  useEffect(() => {
    if (!dashboard) return;
    const doneIds = new Set([...completedIds, ...skippedIds]);
    const withParents = autoCompleteParents(
      [...dashboard.exercises, ...additionalExercises],
      [...dashboard.study_materials, ...additionalStudyMaterials],
      doneIds
    );
    const toComplete = [...withParents].filter((k) => !doneIds.has(k));
    if (toComplete.length > 0) {
      setCompletedIds((prev) => {
        const next = new Set(prev);
        toComplete.forEach((k) => next.add(k));
        return next;
      });
    }
  }, [completedIds, skippedIds, dashboard, additionalExercises, additionalStudyMaterials]);

  // ── Clock tick ───────────────────────────────────────────────────────────────
  useEffect(() => {
    const id = setInterval(() => {
      setNow(Date.now());

      // Detect a midnight rollover while the app stays open — completedIds/
      // skippedIds were computed for the previous day and must reset, since
      // nothing else re-checks the calendar day for as long as the app runs.
      const today = new Date().toLocaleDateString("en-CA");
      if (today !== currentDayRef.current) {
        currentDayRef.current = today;
        setCompletedIds(new Set());
        setSkippedIds(new Set());
        goalFiredRef.current = false;
        allCompleteFiredRef.current = false;
        setLoadTrigger((n) => n + 1);
      }
    }, 1000);
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
          (id) => makeItemKey("exercise", id)
        ),
        ...(dashboard.study_materials ?? []).flatMap((sm) => [
          makeItemKey("studymaterial", sm.id),
          ...(sm.child_study_materials ?? []).map((c) => makeItemKey("studymaterial", c.id)),
        ]),
        ...(dashboard.project?.songs ?? []).map((s) => makeItemKey("song", s.id)),
        ...(dashboard.to_review?.songs ?? []).map((s) => makeItemKey("song", s.id)),
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

  const existingStudyMaterialIds = useMemo(() => {
    const ids = new Set<number>();
    function collect(sm: DashboardStudyMaterial) {
      ids.add(sm.id);
      for (const c of sm.child_study_materials ?? []) collect(c);
    }
    for (const sm of dashboard?.study_materials ?? []) collect(sm);
    for (const sm of additionalStudyMaterials) collect(sm);
    return ids;
  }, [dashboard, additionalStudyMaterials]);


  const allComplete =
    allSuggestedIds.size > 0 &&
    [...allSuggestedIds].every((id) => completedIds.has(id) || skippedIds.has(id));

  // ── Visual state shift effects ────────────────────────────────────────────────
  useEffect(() => {
    if (goalReached && !goalFiredRef.current) {
      goalFiredRef.current = true;
      confettiRef.current?.fire();
    }
  }, [goalReached]);

  useEffect(() => {
    if (allComplete && !allCompleteFiredRef.current) {
      allCompleteFiredRef.current = true;
      // The all-complete banner already appears via the allComplete prop;
      // additional shimmer is handled via CSS on the banner element.
    }
  }, [allComplete]);

  // ── Item state helpers ────────────────────────────────────────────────────────
  function stopAndSave(itemKey: string) {
    pauseTimer(itemKey);
    setOpenForm(itemKey);
  }

  function cancelSession(itemKey: string) {
    clearTimer(itemKey);
    setOpenForm(null);
  }

  function handleSkipItems(keys: string[]) {
    setSkippedIds((prev) => {
      const next = new Set(prev);
      keys.forEach((k) => next.add(k));
      return next;
    });
    setCompletedIds((prev) => {
      const withKeys = new Set(prev);
      keys.forEach((k) => withKeys.add(k));
      return autoCompleteParents(
        [...(dashboard?.exercises ?? []), ...additionalExercises],
        [...(dashboard?.study_materials ?? []), ...additionalStudyMaterials],
        withKeys
      );
    });
  }

  function handleSessionSubmit(dailyPracticeTime: number, itemKey: string) {
    setServerTotal(dailyPracticeTime);
    setCompletedIds((prev) => {
      const withKey = new Set(prev).add(itemKey);
      return autoCompleteParents(
        [...(dashboard?.exercises ?? []), ...additionalExercises],
        [...(dashboard?.study_materials ?? []), ...additionalStudyMaterials],
        withKey
      );
    });
    clearTimer(itemKey);
    setOpenForm(null);
  }

  // ── Exercise helpers (exercise cards use IDs rather than keys directly) ──────
  function exerciseGetState(id: number) {
    const key = makeItemKey("exercise", id);
    return {
      isCompletedToday: completedIds.has(key) && !skippedIds.has(key),
      isSkippedToday: skippedIds.has(key),
      isTimerActive: activeTimers.has(key),
      isTimerPaused: !activeTimers.has(key) && pausedElapsed.has(key),
      timerElapsed: getElapsed(key),
      isFormOpen: openForm === key,
    };
  }

  function studyMaterialGetState(id: number) {
    const key = makeItemKey("studymaterial", id);
    return {
      isCompletedToday: completedIds.has(key) && !skippedIds.has(key),
      isSkippedToday: skippedIds.has(key),
      isTimerActive: activeTimers.has(key),
      isTimerPaused: !activeTimers.has(key) && pausedElapsed.has(key),
      timerElapsed: getElapsed(key),
      isFormOpen: openForm === key,
    };
  }

  // ── Sequential session (parent-triggers-children flow) ───────────────────────
  const {
    sequentialSession,
    sequentialModalHidden,
    setSequentialModalHidden,
    sequentialMediaWasOpenedRef,
    handleStartSequential,
    handleSequentialChildSubmit,
    handleSequentialChildSkip,
    handleCancelSequential,
  } = useSequentialSession({
    dashboard,
    additionalExercises,
    additionalStudyMaterials,
    completedIds,
    startTimer,
    clearTimer,
    cancelSession,
    handleSessionSubmit,
    handleSkipItems,
    markComplete: (key) => setCompletedIds((prev) => new Set(prev).add(key)),
    onError: setActionError,
  });

  // ── Re-show the sequential session modal once media opened from it closes ───
  useEffect(() => {
    if (playerState === null && sequentialMediaWasOpenedRef.current) {
      setSequentialModalHidden(false);
      sequentialMediaWasOpenedRef.current = false;
    }
  }, [playerState, sequentialMediaWasOpenedRef, setSequentialModalHidden]);

  // ── Entity-edited handlers ────────────────────────────────────────────────────
  function handleSongEdited(updated: Song) {
    setDashboard((prev) => {
      if (!prev) return prev;
      const replaceInList = (songs: Song[]) =>
        songs.map((s) => (s.id === updated.id ? updated : s));
      return {
        ...prev,
        project: prev.project ? { ...prev.project, songs: replaceInList(prev.project.songs) } : prev.project,
        to_review: prev.to_review ? { ...prev.to_review, songs: replaceInList(prev.to_review.songs) } : prev.to_review,
        overdue: replaceInList(prev.overdue),
      };
    });
    setAdditionalSongs((prev) => prev.map((s) => (s.id === updated.id ? updated : s)));
  }

  function handleExerciseEdited(id: number, name: string, resources: Resource[] | null) {
    const mergeEx = (ex: DashboardExercise): DashboardExercise => ({
      ...ex,
      name: ex.id === id ? name : ex.name,
      resources: ex.id === id ? resources : ex.resources,
      child_exercises: ex.child_exercises.map((c) =>
        c.id === id ? { ...c, name, resources } : c
      ),
    });
    setDashboard((prev) => prev && { ...prev, exercises: prev.exercises.map(mergeEx) });
    setAdditionalExercises((prev) => prev.map(mergeEx));
  }

  function handleStudyMaterialEdited(id: number, name: string, url: string | null, type: string) {
    const mergeSm = (sm: DashboardStudyMaterial): DashboardStudyMaterial => ({
      ...sm,
      name: sm.id === id ? name : sm.name,
      url: sm.id === id ? url : sm.url,
      type: sm.id === id ? type : sm.type,
      child_study_materials: (sm.child_study_materials ?? []).map((c) =>
        c.id === id ? { ...c, name, url, type } : c
      ),
    });
    setDashboard((prev) =>
      prev && { ...prev, study_materials: prev.study_materials.map(mergeSm) }
    );
    setAdditionalStudyMaterials((prev) => prev.map(mergeSm));
  }

  // ── Add-child handlers ────────────────────────────────────────────────────────
  function handleExerciseChildAdded(parentId: number, child: DashboardExercise) {
    const mergeEx = (ex: DashboardExercise): DashboardExercise =>
      ex.id === parentId ? { ...ex, child_exercises: [...ex.child_exercises, child] } : ex;
    setDashboard((prev) => prev && { ...prev, exercises: prev.exercises.map(mergeEx) });
    setAdditionalExercises((prev) => prev.map(mergeEx));
  }

  function handleStudyMaterialChildAdded(parentId: number, child: DashboardStudyMaterial) {
    const mergeSm = (sm: DashboardStudyMaterial): DashboardStudyMaterial =>
      sm.id === parentId
        ? { ...sm, child_study_materials: [...(sm.child_study_materials ?? []), child] }
        : sm;
    setDashboard((prev) =>
      prev && { ...prev, study_materials: prev.study_materials.map(mergeSm) }
    );
    setAdditionalStudyMaterials((prev) => prev.map(mergeSm));
  }

  // ── Quick Add handlers ────────────────────────────────────────────────────────
  function handleAddSong(song: Song) {
    setAdditionalSongs((prev) => [...prev, song]);
  }

  function handleAddExercise(exercise: CatalogExercise) {
    setAdditionalExercises((prev) => [...prev, catalogExerciseToDashboard(exercise)]);
    // The catalog shape has no session history, so the freshly-added card would
    // otherwise show "never practiced" even for exercises with real history —
    // fill it in from the real session-history endpoint once it loads.
    getExerciseSessionHistory(token, exercise.id)
      .then((res) => {
        setAdditionalExercises((prev) =>
          prev.map((e) =>
            e.id === exercise.id ? { ...e, meta: { ...e.meta, sessions: res.user_exercise_sessions } } : e
          )
        );
      })
      .catch((err) =>
        setQuickAddHistoryError(
          `Couldn't load session history for "${exercise.name}": ${err instanceof Error ? err.message : String(err)}`
        )
      );
  }

  function handleAddStudyMaterial(material: CatalogStudyMaterial) {
    setAdditionalStudyMaterials((prev) => [...prev, catalogStudyMaterialToDashboard(material)]);
    // Same gap as exercises above — backfill real session history in the background.
    getStudyMaterialSessionHistory(token, material.id)
      .then((res) => {
        setAdditionalStudyMaterials((prev) =>
          prev.map((sm) =>
            sm.id === material.id ? { ...sm, meta: { ...sm.meta, sessions: res.user_study_material_sessions } } : sm
          )
        );
      })
      .catch((err) =>
        setQuickAddHistoryError(
          `Couldn't load session history for "${material.name}": ${err instanceof Error ? err.message : String(err)}`
        )
      );
  }

  // ── Additional group completion counts ────────────────────────────────────────
  function additionalCompletedCount(): number {
    const exIds = additionalExercises.flatMap((e) => [
      e.id,
      ...e.child_exercises.map((c) => c.id),
    ]);
    return (
      additionalSongs.filter((s) => isDone(makeItemKey("song", s.id))).length +
      exIds.filter((id) => isDone(makeItemKey("exercise", id))).length +
      additionalStudyMaterials.flatMap((sm) => [sm, ...(sm.child_study_materials ?? [])])
        .filter((sm) => isDone(makeItemKey("studymaterial", sm.id))).length
    );
  }

  function additionalTotalCount(): number {
    const exIds = additionalExercises.flatMap((e) => [
      e.id,
      ...e.child_exercises.map((c) => c.id),
    ]);
    const smCount = additionalStudyMaterials.reduce((n, sm) => n + 1 + (sm.child_study_materials ?? []).length, 0);
    return additionalSongs.length + exIds.length + smCount;
  }

  async function handleRebuild() {
    // A sequential session snapshots its children's resources/last-session info once,
    // at start — rebuilding mid-sequence would replace `dashboard` without refreshing
    // that snapshot, leaving the remaining queue items showing stale data. Block it
    // instead of letting the two silently drift apart.
    if (sequentialSession) {
      setRebuildError("Finish or cancel the current sequential session before rebuilding the dashboard.");
      return;
    }
    setIsRebuilding(true);
    setRebuildError(null);
    setOrphanFetchError(null);
    try {
      const raw = await rebuildDashboard(token);
      let nestedSms = nestStudyMaterials(raw.study_materials);
      const orphanParentIds = findOrphanParentIds(nestedSms);
      if (orphanParentIds.length > 0) {
        const { parents, errorMessage } = await fetchOrphanParents(token, orphanParentIds);
        if (errorMessage) setOrphanFetchError(errorMessage);
        if (parents.length > 0) {
          nestedSms = nestStudyMaterials([...raw.study_materials, ...parents]);
        }
      }
      const dash = { ...raw, study_materials: nestedSms };
      setDashboard(dash);
      setCompletedIds((prev) => mergeCompletedFromDash(dash, prev));
    } catch (err) {
      setRebuildError(err instanceof Error ? err.message : "Rebuild failed. Try again.");
    } finally {
      setIsRebuilding(false);
    }
  }

  // ── Chat handlers ─────────────────────────────────────────────────────────────
  function openChat(type: ChatEntity["type"], id: number) {
    if (type === "song") {
      const allSongs = [
        ...(dashboard?.project?.songs ?? []),
        ...(dashboard?.to_review?.songs ?? []),
        ...additionalSongs,
      ];
      const song = allSongs.find((s) => s.id === id);
      if (!song) {
        setActionError("Couldn't open chat — that song is no longer in the session. Try refreshing.");
        return;
      }
      setChatEntity({ type: "song", item: song, sessions: (song.meta.sessions ?? []) as SongSession[] });
      return;
    }

    if (type === "exercise") {
      const allExercises = [...(dashboard?.exercises ?? []), ...additionalExercises];
      let found: DashboardExercise | undefined;
      for (const ex of allExercises) {
        if (ex.id === id) { found = ex; break; }
        const child = ex.child_exercises.find((c) => c.id === id);
        if (child) { found = child; break; }
      }
      if (!found) {
        setActionError("Couldn't open chat — that exercise is no longer in the session. Try refreshing.");
        return;
      }
      setChatEntity({ type: "exercise", item: found, sessions: (found.meta.sessions ?? []) as ExerciseSession[] });
      return;
    }

    const allMaterials = [...(dashboard?.study_materials ?? []), ...additionalStudyMaterials];
    let found: DashboardStudyMaterial | undefined;
    for (const sm of allMaterials) {
      if (sm.id === id) { found = sm; break; }
      const child = (sm.child_study_materials ?? []).find((c) => c.id === id);
      if (child) { found = child; break; }
    }
    if (!found) {
      setActionError("Couldn't open chat — that study material is no longer in the session. Try refreshing.");
      return;
    }
    setChatEntity({ type: "study_material", item: found, sessions: (found.meta.sessions ?? []) as StudyMaterialSession[] });
  }

  function isDone(key: string): boolean {
    return completedIds.has(key) || skippedIds.has(key);
  }

  // ── Completion counts for group headers ───────────────────────────────────────
  function exerciseCompletedCount(): number {
    if (!dashboard) return 0;
    return collectAllExerciseIds(dashboard.exercises).filter((id) =>
      isDone(makeItemKey("exercise", id))
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
      {rebuildError && <ErrorModal error={rebuildError} onDismiss={() => setRebuildError(null)} />}
      {orphanFetchError && <ErrorModal error={orphanFetchError} onDismiss={() => setOrphanFetchError(null)} />}
      {storageError && <ErrorModal error={storageError} onDismiss={() => setStorageError(null)} />}
      {historicalExercisesError && (
        <ErrorModal error={historicalExercisesError} onDismiss={() => setHistoricalExercisesError(null)} />
      )}
      {actionError && <ErrorModal error={actionError} onDismiss={() => setActionError(null)} />}
      {quickAddHistoryError && (
        <ErrorModal error={quickAddHistoryError} onDismiss={() => setQuickAddHistoryError(null)} />
      )}
      {/* Full-screen confetti canvas — hidden until triggered */}
      <ConfettiCanvas ref={confettiRef} />

      <SessionHeader
        displayedSeconds={displayedSeconds}
        dailyGoalSeconds={dailyGoalSeconds}
        goalReached={goalReached}
        allComplete={allComplete}
        isRebuilding={isRebuilding}
        version={APP_VERSION}
        onRebuild={handleRebuild}
        onOpenSession={() => {
          if (!activeTimers.has(OPEN_SESSION_KEY) && !pausedElapsed.has(OPEN_SESSION_KEY)) {
            startTimer(OPEN_SESSION_KEY);
          }
          setOpenSessionModalOpen((v) => !v);
        }}
        openSessionActive={activeTimers.has(OPEN_SESSION_KEY) || pausedElapsed.has(OPEN_SESSION_KEY)}
        openSessionElapsed={getElapsed(OPEN_SESSION_KEY)}
        onAdd={() => setShowAdd((v) => !v)}
        onQuickAdd={() => setShowQuickAddModal((v) => !v)}
        onMetronome={() => setMetronomeOpen((v) => !v)}
        onSignOut={onSignOut}
        onReports={() => setReportOpen(true)}
        onGpLibrary={onGpLibrary}
        onCalendar={onCalendar}
        onBrowse={onBrowse}
        onHelp={() => setHelpOpen(true)}
        onChangelog={onChangelog}
      />

      {helpOpen && <HelpModal onClose={() => setHelpOpen(false)} />}

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

      {showAdd && (
        <QuickAddPanel
          overdueSongs={dashboard?.overdue ?? []}
          existingSongIds={existingSongIds}
          onAddSong={handleAddSong}
          onClose={() => setShowAdd(false)}
        />
      )}

      {showQuickAddModal && (
        <QuickAddModal
          token={token}
          existingSongIds={existingSongIds}
          existingExerciseIds={existingExerciseIds}
          existingStudyMaterialIds={existingStudyMaterialIds}
          onAddSong={handleAddSong}
          onAddExercise={handleAddExercise}
          onAddStudyMaterial={handleAddStudyMaterial}
          onClose={() => setShowQuickAddModal(false)}
        />
      )}

      {/* In-app media player — inline above item groups */}
      {playerState && (
        <MediaPlayer
          filePath={playerState.path}
          mediaType={playerState.mediaType}
          itemName={playerState.itemName}
          onClose={() => setPlayerState(null)}
          timerElapsed={playerState.itemKey ? getElapsed(playerState.itemKey) : undefined}
          isTimerActive={playerState.itemKey ? activeTimers.has(playerState.itemKey) : false}
          token={token}
          songId={playerState.songId}
        />
      )}

      {/* Standalone metronome panel */}
      {metronomeOpen && (
        <Metronome onClose={() => setMetronomeOpen(false)} />
      )}

      {/* Sequential session overlay */}
      {sequentialSession && !sequentialModalHidden && (() => {
        const { type, parentName, children, currentIndex } = sequentialSession;
        const childId = children[currentIndex].id;
        const childKey = type === "exercise"
          ? makeItemKey("exercise", childId)
          : makeItemKey("studymaterial", childId);
        function hideForMedia() {
          sequentialMediaWasOpenedRef.current = true;
          setSequentialModalHidden(true);
        }
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
            onSkip={handleSequentialChildSkip}
            onFormClose={() => setOpenForm(null)}
            onCancelReturn={handleCancelSequential}
            onOpenFile={(path, mt, itemKey) => openPlayer(path, mt, children[currentIndex].name, itemKey ?? childKey)}
            onGpView={onGpView}
            onMediaOpen={hideForMedia}
          />
        );
      })()}

      {/* Practice Time Report */}
      {reportOpen && (
        <PracticeTimeReport token={token} onClose={() => setReportOpen(false)} />
      )}

      {/* AI Chat Panel */}
      {chatEntity && dashboard && (
        <ChatPanel
          context={{
            entity: chatEntity,
            projectSongs: dashboard.project?.songs ?? [],
            activeExercises: dashboard.exercises,
            activeStudyMaterials: dashboard.study_materials,
            historicalExercises,
            toLearnSongs: dashboard.to_learn?.songs ?? [],
          }}
          onClose={() => setChatEntity(null)}
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
              onStart={(id) => startTimer(makeItemKey("exercise", id))}
              onPause={(id) => pauseTimer(makeItemKey("exercise", id))}
              onStopAndSave={(id) => stopAndSave(makeItemKey("exercise", id))}
              onCancel={(id) => cancelSession(makeItemKey("exercise", id))}
              onFormOpen={(id) => setOpenForm(makeItemKey("exercise", id))}
              onFormClose={() => setOpenForm(null)}
              onSessionSubmit={(id, dpt) =>
                handleSessionSubmit(dpt, makeItemKey("exercise", id))
              }
              onSkip={(id) => {
                if (id === ex.id) {
                  const childKeys = ex.child_exercises.map((c) => makeItemKey("exercise", c.id));
                  handleSkipItems([makeItemKey("exercise", id), ...childKeys]);
                } else {
                  handleSkipItems([makeItemKey("exercise", id)]);
                }
              }}
              onStartSequential={(parentId) => handleStartSequential("exercise", parentId)}
              onOpenFile={(path, mt, itemKey) => openPlayer(path, mt, ex.name, itemKey ?? makeItemKey("exercise", ex.id))}
              onGpView={onGpView}
              onOpenChat={(id) => openChat("exercise", id)}
              isMediaActive={playerState !== null}
              onEntityEdited={(id, name, resources) => handleExerciseEdited(id, name, resources)}
              onChildAdded={handleExerciseChildAdded}
            />
          ))}
        </ItemGroup>

        {/* Study Materials */}
        <ItemGroup
          title="Study Materials"
          completedCount={
            dashboard.study_materials.flatMap((sm) => [sm, ...(sm.child_study_materials ?? [])])
              .filter((sm) => isDone(makeItemKey("studymaterial", sm.id))).length
          }
          totalCount={
            dashboard.study_materials.reduce((n, sm) => n + 1 + (sm.child_study_materials ?? []).length, 0)
          }
        >
          {dashboard.study_materials.map((sm) => (
            <StudyMaterialCard
              key={sm.id}
              token={token}
              material={sm}
              getState={(id) => studyMaterialGetState(id)}
              onStart={(id) => startTimer(makeItemKey("studymaterial", id))}
              onPause={(id) => pauseTimer(makeItemKey("studymaterial", id))}
              onStopAndSave={(id) => stopAndSave(makeItemKey("studymaterial", id))}
              onCancel={(id) => cancelSession(makeItemKey("studymaterial", id))}
              onFormOpen={(id) => setOpenForm(makeItemKey("studymaterial", id))}
              onFormClose={() => setOpenForm(null)}
              onSessionSubmit={(id, dpt) =>
                handleSessionSubmit(dpt, makeItemKey("studymaterial", id))
              }
              onSkip={(id) => {
                if (id === sm.id) {
                  const childKeys = (sm.child_study_materials ?? []).map((c) => makeItemKey("studymaterial", c.id));
                  handleSkipItems([makeItemKey("studymaterial", id), ...childKeys]);
                } else {
                  handleSkipItems([makeItemKey("studymaterial", id)]);
                }
              }}
              onStartSequential={(parentId) => handleStartSequential("study_material", parentId)}
              onOpenFile={(path, mt, itemKey) => openPlayer(path, mt, sm.name, itemKey ?? makeItemKey("studymaterial", sm.id))}
              onGpView={onGpView}
              onOpenChat={(id) => openChat("study_material", id)}
              isMediaActive={playerState !== null}
              onEntityEdited={(id, name, url, type) => handleStudyMaterialEdited(id, name, url, type)}
              onChildAdded={handleStudyMaterialChildAdded}
            />
          ))}
        </ItemGroup>

        {/* Project Songs */}
        <ItemGroup
          title="Project"
          completedCount={
            projectSongs.filter((s) => isDone(makeItemKey("song", s.id))).length
          }
          totalCount={projectSongs.length}
        >
          {projectSongs.map((song) => (
            <SongCard
              key={song.id}
              token={token}
              song={song}
              currentListId={dashboard.project?.id}
              isCompletedToday={completedIds.has(makeItemKey("song", song.id)) && !skippedIds.has(makeItemKey("song", song.id))}
              isSkippedToday={skippedIds.has(makeItemKey("song", song.id))}
              isTimerActive={activeTimers.has(makeItemKey("song", song.id))}
              isTimerPaused={
                !activeTimers.has(makeItemKey("song", song.id)) &&
                pausedElapsed.has(makeItemKey("song", song.id))
              }
              timerElapsed={getElapsed(makeItemKey("song", song.id))}
              isFormOpen={openForm === makeItemKey("song", song.id)}
              onStart={() => startTimer(makeItemKey("song", song.id))}
              onPause={() => pauseTimer(makeItemKey("song", song.id))}
              onStopAndSave={() => stopAndSave(makeItemKey("song", song.id))}
              onCancel={() => cancelSession(makeItemKey("song", song.id))}
              onFormOpen={() => setOpenForm(makeItemKey("song", song.id))}
              onFormClose={() => setOpenForm(null)}
              onSessionSubmit={(dpt) =>
                handleSessionSubmit(dpt, makeItemKey("song", song.id))
              }
              onSkip={() => handleSkipItems([makeItemKey("song", song.id)])}
              onOpenFile={(path, mt, itemKey) => openPlayer(path, mt, song.name, itemKey ?? makeItemKey("song", song.id))}
              onGpView={onGpView}
              onOpenChat={() => openChat("song", song.id)}
              isMediaActive={playerState !== null}
              onEntityEdited={handleSongEdited}
            />
          ))}
        </ItemGroup>

        {/* Repertoire Review */}
        <ItemGroup
          title="Repertoire Review"
          completedCount={
            reviewSongs.filter((s) => isDone(makeItemKey("song", s.id))).length
          }
          totalCount={reviewSongs.length}
        >
          {reviewSongs.map((song) => (
            <SongCard
              key={song.id}
              token={token}
              song={song}
              currentListId={dashboard.to_review?.id}
              isCompletedToday={completedIds.has(makeItemKey("song", song.id)) && !skippedIds.has(makeItemKey("song", song.id))}
              isSkippedToday={skippedIds.has(makeItemKey("song", song.id))}
              isTimerActive={activeTimers.has(makeItemKey("song", song.id))}
              isTimerPaused={
                !activeTimers.has(makeItemKey("song", song.id)) &&
                pausedElapsed.has(makeItemKey("song", song.id))
              }
              timerElapsed={getElapsed(makeItemKey("song", song.id))}
              isFormOpen={openForm === makeItemKey("song", song.id)}
              onStart={() => startTimer(makeItemKey("song", song.id))}
              onPause={() => pauseTimer(makeItemKey("song", song.id))}
              onStopAndSave={() => stopAndSave(makeItemKey("song", song.id))}
              onCancel={() => cancelSession(makeItemKey("song", song.id))}
              onFormOpen={() => setOpenForm(makeItemKey("song", song.id))}
              onFormClose={() => setOpenForm(null)}
              onSessionSubmit={(dpt) =>
                handleSessionSubmit(dpt, makeItemKey("song", song.id))
              }
              onSkip={() => handleSkipItems([makeItemKey("song", song.id)])}
              onOpenFile={(path, mt, itemKey) => openPlayer(path, mt, song.name, itemKey ?? makeItemKey("song", song.id))}
              onGpView={onGpView}
              onOpenChat={() => openChat("song", song.id)}
              isMediaActive={playerState !== null}
              onEntityEdited={handleSongEdited}
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
                isCompletedToday={completedIds.has(makeItemKey("song", song.id)) && !skippedIds.has(makeItemKey("song", song.id))}
                isSkippedToday={skippedIds.has(makeItemKey("song", song.id))}
                isTimerActive={activeTimers.has(makeItemKey("song", song.id))}
                isTimerPaused={
                  !activeTimers.has(makeItemKey("song", song.id)) &&
                  pausedElapsed.has(makeItemKey("song", song.id))
                }
                timerElapsed={getElapsed(makeItemKey("song", song.id))}
                isFormOpen={openForm === makeItemKey("song", song.id)}
                onStart={() => startTimer(makeItemKey("song", song.id))}
                onPause={() => pauseTimer(makeItemKey("song", song.id))}
                onStopAndSave={() => stopAndSave(makeItemKey("song", song.id))}
                onCancel={() => cancelSession(makeItemKey("song", song.id))}
                onFormOpen={() => setOpenForm(makeItemKey("song", song.id))}
                onFormClose={() => setOpenForm(null)}
                onSessionSubmit={(dpt) =>
                  handleSessionSubmit(dpt, makeItemKey("song", song.id))
                }
                onSkip={() => handleSkipItems([makeItemKey("song", song.id)])}
                onOpenFile={(path, mt, itemKey) => openPlayer(path, mt, song.name, itemKey ?? makeItemKey("song", song.id))}
                onGpView={onGpView}
                onOpenChat={() => openChat("song", song.id)}
                isMediaActive={playerState !== null}
                onEntityEdited={handleSongEdited}
              />
            ))}
            {additionalExercises.map((ex) => (
              <ExerciseCard
                key={ex.id}
                token={token}
                exercise={ex}
                getState={(id) => exerciseGetState(id)}
                onStart={(id) => startTimer(makeItemKey("exercise", id))}
                onPause={(id) => pauseTimer(makeItemKey("exercise", id))}
                onStopAndSave={(id) => stopAndSave(makeItemKey("exercise", id))}
                onCancel={(id) => cancelSession(makeItemKey("exercise", id))}
                onFormOpen={(id) => setOpenForm(makeItemKey("exercise", id))}
                onFormClose={() => setOpenForm(null)}
                onSessionSubmit={(id, dpt) =>
                  handleSessionSubmit(dpt, makeItemKey("exercise", id))
                }
                onSkip={(id) => {
                  if (id === ex.id) {
                    const childKeys = ex.child_exercises.map((c) => makeItemKey("exercise", c.id));
                    handleSkipItems([makeItemKey("exercise", id), ...childKeys]);
                  } else {
                    handleSkipItems([makeItemKey("exercise", id)]);
                  }
                }}
                onStartSequential={(parentId) => handleStartSequential("exercise", parentId)}
                onOpenFile={(path, mt, itemKey) => openPlayer(path, mt, ex.name, itemKey ?? makeItemKey("exercise", ex.id))}
                onGpView={onGpView}
                onOpenChat={(id) => openChat("exercise", id)}
                isMediaActive={playerState !== null}
                onEntityEdited={(id, name, resources) => handleExerciseEdited(id, name, resources)}
                onChildAdded={handleExerciseChildAdded}
              />
            ))}
            {additionalStudyMaterials.map((sm) => (
              <StudyMaterialCard
                key={sm.id}
                token={token}
                material={sm}
                getState={(id) => studyMaterialGetState(id)}
                onStart={(id) => startTimer(makeItemKey("studymaterial", id))}
                onPause={(id) => pauseTimer(makeItemKey("studymaterial", id))}
                onStopAndSave={(id) => stopAndSave(makeItemKey("studymaterial", id))}
                onCancel={(id) => cancelSession(makeItemKey("studymaterial", id))}
                onFormOpen={(id) => setOpenForm(makeItemKey("studymaterial", id))}
                onFormClose={() => setOpenForm(null)}
                onSessionSubmit={(id, dpt) =>
                  handleSessionSubmit(dpt, makeItemKey("studymaterial", id))
                }
                onSkip={(id) => {
                  if (id === sm.id) {
                    const childKeys = (sm.child_study_materials ?? []).map((c) => makeItemKey("studymaterial", c.id));
                    handleSkipItems([makeItemKey("studymaterial", id), ...childKeys]);
                  } else {
                    handleSkipItems([makeItemKey("studymaterial", id)]);
                  }
                }}
                onStartSequential={(parentId) => handleStartSequential("study_material", parentId)}
                onOpenFile={(path, mt, itemKey) => openPlayer(path, mt, sm.name, itemKey ?? makeItemKey("studymaterial", sm.id))}
                onGpView={onGpView}
                onOpenChat={(id) => openChat("study_material", id)}
                isMediaActive={playerState !== null}
                onEntityEdited={(id, name, url, type) => handleStudyMaterialEdited(id, name, url, type)}
                onChildAdded={handleStudyMaterialChildAdded}
              />
            ))}
          </ItemGroup>
        )}
      </main>
    </div>
  );
}
