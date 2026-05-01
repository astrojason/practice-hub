import { useCallback, useEffect, useMemo, useState } from "react";
import { XMarkIcon } from "@heroicons/react/16/solid";
import {
  getCatalogExercises,
  getCatalogSongs,
  getCatalogStudyMaterials,
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
  onAddSong: (song: Song) => void;
  onAddExercise: (exercise: CatalogExercise) => void;
  onAddStudyMaterial: (material: CatalogStudyMaterial) => void;
  onClose: () => void;
}

export function QuickAddModal({
  token,
  existingSongIds,
  existingExerciseIds,
  existingStudyMaterialIds,
  onAddSong,
  onAddExercise,
  onAddStudyMaterial,
  onClose,
}: Props) {
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");

  const [songs, setSongs] = useState<Song[]>([]);
  const [songsTotal, setSongsTotal] = useState(0);
  const [songsPage, setSongsPage] = useState(1);
  const [songsLoading, setSongsLoading] = useState(false);

  const [exercises, setExercises] = useState<CatalogExercise[]>([]);
  const [exercisesTotal, setExercisesTotal] = useState(0);
  const [exercisesPage, setExercisesPage] = useState(1);
  const [exercisesLoading, setExercisesLoading] = useState(false);

  const [materials, setMaterials] = useState<CatalogStudyMaterial[]>([]);
  const [materialsTotal, setMaterialsTotal] = useState(0);
  const [materialsPage, setMaterialsPage] = useState(1);
  const [materialsLoading, setMaterialsLoading] = useState(false);

  const [addedSongIds, setAddedSongIds] = useState<Set<number>>(new Set());
  const [addedExerciseIds, setAddedExerciseIds] = useState<Set<number>>(new Set());
  const [addedMaterialIds, setAddedMaterialIds] = useState<Set<number>>(new Set());

  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search), 300);
    return () => clearTimeout(t);
  }, [search]);

  const fetchSongs = useCallback(
    async (page: number, q: string, reset: boolean) => {
      setSongsLoading(true);
      try {
        const res = await getCatalogSongs(token, page, LIMIT, q);
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
    async (page: number, q: string, reset: boolean) => {
      setExercisesLoading(true);
      try {
        const res = await getCatalogExercises(token, page, LIMIT, q);
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
        const res = await getCatalogStudyMaterials(token, page, LIMIT, q);
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

  useEffect(() => {
    if (!debouncedSearch) {
      setSongs([]);
      setSongsTotal(0);
      setExercises([]);
      setExercisesTotal(0);
      setMaterials([]);
      setMaterialsTotal(0);
      return;
    }
    fetchSongs(1, debouncedSearch, true);
    fetchExercises(1, debouncedSearch, true);
    fetchMaterials(1, debouncedSearch, true);
  }, [debouncedSearch, fetchSongs, fetchExercises, fetchMaterials]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const visibleSongs = useMemo(
    () => songs.filter((s) => !existingSongIds.has(s.id) && !addedSongIds.has(s.id)),
    [songs, existingSongIds, addedSongIds]
  );

  const visibleExercises = useMemo(
    () => exercises.filter((e) => !existingExerciseIds.has(e.id) && !addedExerciseIds.has(e.id)),
    [exercises, existingExerciseIds, addedExerciseIds]
  );

  const visibleMaterials = useMemo(
    () =>
      materials
        .flatMap((m) => [m, ...(m.child_study_materials ?? [])])
        .filter((m) => !existingStudyMaterialIds.has(m.id) && !addedMaterialIds.has(m.id)),
    [materials, existingStudyMaterialIds, addedMaterialIds]
  );

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

  const hasResults = visibleSongs.length > 0 || visibleExercises.length > 0 || visibleMaterials.length > 0;
  const isLoading = songsLoading || exercisesLoading || materialsLoading;

  return (
    <div className="qa-modal-backdrop" onClick={onClose}>
      <div className="qa-modal-card" onClick={(e) => e.stopPropagation()}>
        <div className="qa-modal-header">
          <span className="quick-add-title">Quick Add</span>
          <input
            type="search"
            className="quick-add-search"
            placeholder="Search songs, exercises, study materials…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            // eslint-disable-next-line jsx-a11y/no-autofocus
            autoFocus
          />
          <button className="btn-ghost quick-add-close" onClick={onClose}>
            <XMarkIcon />
          </button>
        </div>

        <div className="quick-add-body">
          {!debouncedSearch && (
            <div className="qa-empty qa-empty-center">Type to search</div>
          )}

          {debouncedSearch && isLoading && !hasResults && (
            <div className="qa-loading">Searching…</div>
          )}

          {debouncedSearch && !isLoading && !hasResults && (
            <div className="qa-empty qa-empty-center">No results for "{debouncedSearch}"</div>
          )}

          {debouncedSearch && visibleSongs.length > 0 && (
            <section className="qa-section">
              <div className="qa-section-header qa-section-header--static">
                <span className="qa-section-title">Songs</span>
                <span className="qa-section-count">{songsTotal}</span>
              </div>
              {visibleSongs.map((song) => (
                <QuickAddRow
                  key={song.id}
                  label={song.name}
                  sub={song.artist_name}
                  onAdd={() => handleAddSong(song)}
                />
              ))}
              {songs.length < songsTotal && !songsLoading && (
                <button
                  className="qa-load-more"
                  onClick={() => fetchSongs(songsPage + 1, debouncedSearch, false)}
                >
                  Load {Math.min(LIMIT, songsTotal - songs.length)} more
                </button>
              )}
            </section>
          )}

          {debouncedSearch && visibleExercises.length > 0 && (
            <section className="qa-section">
              <div className="qa-section-header qa-section-header--static">
                <span className="qa-section-title">Exercises</span>
                <span className="qa-section-count">{exercisesTotal}</span>
              </div>
              {visibleExercises.map((exercise) => (
                <QuickAddRow
                  key={exercise.id}
                  label={exercise.name}
                  onAdd={() => handleAddExercise(exercise)}
                />
              ))}
              {exercises.length < exercisesTotal && !exercisesLoading && (
                <button
                  className="qa-load-more"
                  onClick={() => fetchExercises(exercisesPage + 1, debouncedSearch, false)}
                >
                  Load {Math.min(LIMIT, exercisesTotal - exercises.length)} more
                </button>
              )}
            </section>
          )}

          {debouncedSearch && visibleMaterials.length > 0 && (
            <section className="qa-section">
              <div className="qa-section-header qa-section-header--static">
                <span className="qa-section-title">Study Materials</span>
                <span className="qa-section-count">{materialsTotal}</span>
              </div>
              {visibleMaterials.map((material) => (
                <QuickAddRow
                  key={material.id}
                  label={material.name}
                  onAdd={() => handleAddMaterial(material)}
                />
              ))}
              {materials.length < materialsTotal && !materialsLoading && (
                <button
                  className="qa-load-more"
                  onClick={() => fetchMaterials(materialsPage + 1, debouncedSearch, false)}
                >
                  Load {Math.min(LIMIT, materialsTotal - materials.length)} more
                </button>
              )}
            </section>
          )}
        </div>
      </div>
    </div>
  );
}

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
