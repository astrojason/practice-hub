import { useCallback, useEffect, useMemo, useState } from "react";
import { ChevronDownIcon, ChevronRightIcon, XMarkIcon } from "@heroicons/react/16/solid";
import {
  getCatalogExercises,
  getCatalogSongs,
  getCatalogStudyMaterials,
  getOverdueSongs,
} from "../../api/client";
import type {
  CatalogExercise,
  CatalogStudyMaterial,
  Song,
} from "../../api/types";

const LIMIT = 25;

interface Props {
  token: string;
  existingSongIds: ReadonlySet<number>;
  existingExerciseIds: ReadonlySet<number>;
  existingStudyMaterialIds: ReadonlySet<number>;
  projectTags: string[];
  onAddSong: (song: Song) => void;
  onAddExercise: (exercise: CatalogExercise) => void;
  onAddStudyMaterial: (material: CatalogStudyMaterial) => void;
  onClose: () => void;
}

export function QuickAddPanel({
  token,
  existingSongIds,
  existingExerciseIds,
  existingStudyMaterialIds,
  projectTags,
  onAddSong,
  onAddExercise,
  onAddStudyMaterial,
  onClose,
}: Props) {
  // ── Search ───────────────────────────────────────────────────────────────────
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");

  // ── Section collapse ─────────────────────────────────────────────────────────
  const [overdueCollapsed, setOverdueCollapsed] = useState(false);
  const [songsCollapsed, setSongsCollapsed] = useState(false);
  const [exercisesCollapsed, setExercisesCollapsed] = useState(false);
  const [materialsCollapsed, setMaterialsCollapsed] = useState(false);

  // ── Overdue ──────────────────────────────────────────────────────────────────
  const [overdueSongs, setOverdueSongs] = useState<Song[]>([]);
  const [overdueLoading, setOverdueLoading] = useState(true);

  // ── Songs catalog ────────────────────────────────────────────────────────────
  const [songs, setSongs] = useState<Song[]>([]);
  const [songsTotal, setSongsTotal] = useState(0);
  const [songsPage, setSongsPage] = useState(1);
  const [songsLoading, setSongsLoading] = useState(false);

  // ── Exercises catalog ────────────────────────────────────────────────────────
  const [exercises, setExercises] = useState<CatalogExercise[]>([]);
  const [exercisesTotal, setExercisesTotal] = useState(0);
  const [exercisesPage, setExercisesPage] = useState(1);
  const [exercisesLoading, setExercisesLoading] = useState(false);

  // ── Study materials catalog ──────────────────────────────────────────────────
  const [materials, setMaterials] = useState<CatalogStudyMaterial[]>([]);
  const [materialsTotal, setMaterialsTotal] = useState(0);
  const [materialsPage, setMaterialsPage] = useState(1);
  const [materialsLoading, setMaterialsLoading] = useState(false);

  // ── Locally added IDs (for immediate visual feedback before parent re-renders)
  const [addedSongIds, setAddedSongIds] = useState<Set<number>>(new Set());
  const [addedExerciseIds, setAddedExerciseIds] = useState<Set<number>>(new Set());
  const [addedMaterialIds, setAddedMaterialIds] = useState<Set<number>>(new Set());

  const projectTagSet = useMemo(() => new Set(projectTags), [projectTags]);

  // ── Debounce search ──────────────────────────────────────────────────────────
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search), 300);
    return () => clearTimeout(t);
  }, [search]);

  // ── Fetch helpers ────────────────────────────────────────────────────────────
  const fetchOverdue = useCallback(async () => {
    setOverdueLoading(true);
    try {
      const data = await getOverdueSongs(token);
      setOverdueSongs(data);
    } catch {
      /* ignore */
    } finally {
      setOverdueLoading(false);
    }
  }, [token]);

  const fetchSongs = useCallback(
    async (page: number, q: string, reset: boolean) => {
      setSongsLoading(true);
      try {
        const res = await getCatalogSongs(token, page, LIMIT, q || undefined);
        setSongs((prev) => (reset ? res.songs : [...prev, ...res.songs]));
        setSongsTotal(res.total);
        setSongsPage(page);
      } catch {
        /* ignore */
      } finally {
        setSongsLoading(false);
      }
    },
    [token]
  );

  const fetchExercises = useCallback(
    async (page: number, reset: boolean) => {
      setExercisesLoading(true);
      try {
        const res = await getCatalogExercises(token, page, LIMIT);
        setExercises((prev) => (reset ? res.exercises : [...prev, ...res.exercises]));
        setExercisesTotal(res.total);
        setExercisesPage(page);
      } catch {
        /* ignore */
      } finally {
        setExercisesLoading(false);
      }
    },
    [token]
  );

  const fetchMaterials = useCallback(
    async (page: number, q: string, reset: boolean) => {
      setMaterialsLoading(true);
      try {
        const res = await getCatalogStudyMaterials(token, page, LIMIT, q || undefined);
        setMaterials((prev) =>
          reset ? res.study_material : [...prev, ...res.study_material]
        );
        setMaterialsTotal(res.total);
        setMaterialsPage(page);
      } catch {
        /* ignore */
      } finally {
        setMaterialsLoading(false);
      }
    },
    [token]
  );

  // ── Initial loads ────────────────────────────────────────────────────────────
  useEffect(() => {
    fetchOverdue();
  }, [fetchOverdue]);

  useEffect(() => {
    fetchExercises(1, true);
  }, [fetchExercises]);

  // Reload songs + materials when debounced search changes (also runs on mount)
  useEffect(() => {
    fetchSongs(1, debouncedSearch, true);
    fetchMaterials(1, debouncedSearch, true);
  }, [debouncedSearch, fetchSongs, fetchMaterials]);

  // ── Keyboard close ───────────────────────────────────────────────────────────
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  // ── Derived: filtered + sorted items ─────────────────────────────────────────
  const overdueSongIds = useMemo(
    () => new Set(overdueSongs.map((s) => s.id)),
    [overdueSongs]
  );

  const visibleOverdue = overdueSongs.filter(
    (s) => !existingSongIds.has(s.id) && !addedSongIds.has(s.id)
  );

  // Sort catalog songs by tag overlap with project songs (descending), then alpha
  const sortedSongs = useMemo(() => {
    const scored = songs.map((s) => ({
      song: s,
      score: s.tags.filter((t) => projectTagSet.has(t)).length,
    }));
    scored.sort((a, b) => b.score - a.score || a.song.name.localeCompare(b.song.name));
    return scored.map((x) => x.song);
  }, [songs, projectTagSet]);

  const visibleSongs = sortedSongs.filter(
    (s) =>
      !existingSongIds.has(s.id) &&
      !overdueSongIds.has(s.id) &&
      !addedSongIds.has(s.id)
  );

  const visibleExercises = exercises.filter((e) => {
    if (existingExerciseIds.has(e.id) || addedExerciseIds.has(e.id)) return false;
    if (debouncedSearch) {
      return e.name.toLowerCase().includes(debouncedSearch.toLowerCase());
    }
    return true;
  });

  const visibleMaterials = materials.filter(
    (m) => !existingStudyMaterialIds.has(m.id) && !addedMaterialIds.has(m.id)
  );

  // ── Add handlers ─────────────────────────────────────────────────────────────
  function handleAddSong(song: Song) {
    setAddedSongIds((prev) => new Set(prev).add(song.id));
    onAddSong(song);
  }

  function handleAddExercise(exercise: CatalogExercise) {
    setAddedExerciseIds((prev) => new Set(prev).add(exercise.id));
    onAddExercise(exercise);
  }

  function handleAddMaterial(material: CatalogStudyMaterial) {
    setAddedMaterialIds((prev) => new Set(prev).add(material.id));
    onAddStudyMaterial(material);
  }

  // ── Render ────────────────────────────────────────────────────────────────────
  return (
    <div className="quick-add-backdrop" onClick={onClose}>
      <div className="quick-add-panel" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="quick-add-header">
          <span className="quick-add-title">Quick Add</span>
          <input
            type="search"
            className="quick-add-search"
            placeholder="Search…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            // eslint-disable-next-line jsx-a11y/no-autofocus
            autoFocus
          />
          <button className="btn-ghost quick-add-close" onClick={onClose}>
            <XMarkIcon />
          </button>
        </div>

        {/* Body */}
        <div className="quick-add-body">
          {/* ── Overdue ── */}
          {!overdueLoading && visibleOverdue.length > 0 && (
            <section className="qa-section">
              <button
                className="qa-section-header"
                onClick={() => setOverdueCollapsed((c) => !c)}
              >
                <span className="qa-section-title qa-overdue">Overdue</span>
                <span className="qa-section-count">{visibleOverdue.length}</span>
                {overdueCollapsed ? (
                  <ChevronRightIcon className="icon-sm" />
                ) : (
                  <ChevronDownIcon className="icon-sm" />
                )}
              </button>
              {!overdueCollapsed &&
                visibleOverdue.map((song) => (
                  <QuickAddRow
                    key={song.id}
                    label={song.name}
                    sub={song.artist_name}
                    onAdd={() => handleAddSong(song)}
                  />
                ))}
            </section>
          )}

          {/* ── Songs ── */}
          <section className="qa-section">
            <button
              className="qa-section-header"
              onClick={() => setSongsCollapsed((c) => !c)}
            >
              <span className="qa-section-title">Songs</span>
              <span className="qa-section-count">{songsTotal}</span>
              {songsCollapsed ? (
                <ChevronRightIcon className="icon-sm" />
              ) : (
                <ChevronDownIcon className="icon-sm" />
              )}
            </button>
            {!songsCollapsed && (
              <>
                {songsLoading && songs.length === 0 ? (
                  <div className="qa-loading">Loading…</div>
                ) : visibleSongs.length === 0 && !songsLoading ? (
                  <div className="qa-empty">No songs to add</div>
                ) : (
                  visibleSongs.map((song) => (
                    <QuickAddRow
                      key={song.id}
                      label={song.name}
                      sub={song.artist_name}
                      onAdd={() => handleAddSong(song)}
                    />
                  ))
                )}
                {songs.length < songsTotal && !songsLoading && (
                  <button
                    className="qa-load-more"
                    onClick={() => fetchSongs(songsPage + 1, debouncedSearch, false)}
                  >
                    Load {Math.min(LIMIT, songsTotal - songs.length)} more
                  </button>
                )}
                {songsLoading && songs.length > 0 && (
                  <div className="qa-loading">Loading…</div>
                )}
              </>
            )}
          </section>

          {/* ── Exercises ── */}
          <section className="qa-section">
            <button
              className="qa-section-header"
              onClick={() => setExercisesCollapsed((c) => !c)}
            >
              <span className="qa-section-title">Exercises</span>
              <span className="qa-section-count">{exercisesTotal}</span>
              {exercisesCollapsed ? (
                <ChevronRightIcon className="icon-sm" />
              ) : (
                <ChevronDownIcon className="icon-sm" />
              )}
            </button>
            {!exercisesCollapsed && (
              <>
                {exercisesLoading && exercises.length === 0 ? (
                  <div className="qa-loading">Loading…</div>
                ) : visibleExercises.length === 0 && !exercisesLoading ? (
                  <div className="qa-empty">No exercises to add</div>
                ) : (
                  visibleExercises.map((exercise) => (
                    <QuickAddRow
                      key={exercise.id}
                      label={exercise.name}
                      onAdd={() => handleAddExercise(exercise)}
                    />
                  ))
                )}
                {exercises.length < exercisesTotal && !exercisesLoading && (
                  <button
                    className="qa-load-more"
                    onClick={() => fetchExercises(exercisesPage + 1, false)}
                  >
                    Load {Math.min(LIMIT, exercisesTotal - exercises.length)} more
                  </button>
                )}
                {exercisesLoading && exercises.length > 0 && (
                  <div className="qa-loading">Loading…</div>
                )}
              </>
            )}
          </section>

          {/* ── Study Materials ── */}
          <section className="qa-section">
            <button
              className="qa-section-header"
              onClick={() => setMaterialsCollapsed((c) => !c)}
            >
              <span className="qa-section-title">Study Materials</span>
              <span className="qa-section-count">{materialsTotal}</span>
              {materialsCollapsed ? (
                <ChevronRightIcon className="icon-sm" />
              ) : (
                <ChevronDownIcon className="icon-sm" />
              )}
            </button>
            {!materialsCollapsed && (
              <>
                {materialsLoading && materials.length === 0 ? (
                  <div className="qa-loading">Loading…</div>
                ) : visibleMaterials.length === 0 && !materialsLoading ? (
                  <div className="qa-empty">No study materials to add</div>
                ) : (
                  visibleMaterials.map((material) => (
                    <QuickAddRow
                      key={material.id}
                      label={material.name}
                      onAdd={() => handleAddMaterial(material)}
                    />
                  ))
                )}
                {materials.length < materialsTotal && !materialsLoading && (
                  <button
                    className="qa-load-more"
                    onClick={() =>
                      fetchMaterials(materialsPage + 1, debouncedSearch, false)
                    }
                  >
                    Load {Math.min(LIMIT, materialsTotal - materials.length)} more
                  </button>
                )}
                {materialsLoading && materials.length > 0 && (
                  <div className="qa-loading">Loading…</div>
                )}
              </>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}

// ── Row component ─────────────────────────────────────────────────────────────

interface QuickAddRowProps {
  label: string;
  sub?: string;
  onAdd: () => void;
}

function QuickAddRow({ label, sub, onAdd }: QuickAddRowProps) {
  return (
    <div className="qa-row">
      <div className="qa-row-info">
        <span className="qa-row-name">{label}</span>
        {sub && <span className="qa-row-sub">{sub}</span>}
      </div>
      <button className="btn-secondary qa-row-add" onClick={onAdd}>
        Add
      </button>
    </div>
  );
}
