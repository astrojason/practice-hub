import { useCallback, useEffect, useState } from "react";
import { ArrowLeftIcon, MagnifyingGlassIcon } from "@heroicons/react/16/solid";
import { getCatalogSongs, getCatalogExercises, getCatalogStudyMaterials } from "../api/client";
import { catalogExerciseToDashboard, catalogStudyMaterialToDashboard } from "../api/catalogConvert";
import { BrowseSongRow } from "./browse/BrowseSongRow";
import { BrowseExerciseRow } from "./browse/BrowseExerciseRow";
import { BrowseStudyMaterialRow } from "./browse/BrowseStudyMaterialRow";
import { ErrorModal } from "./ErrorModal";
import type { Song, DashboardExercise, DashboardStudyMaterial } from "../api/types";

const LIMIT = 25;

type Tab = "songs" | "study_materials" | "exercises";

interface Props {
  token: string;
  onBack: () => void;
}

export function BrowseView({ token, onBack }: Props) {
  const [tab, setTab] = useState<Tab>("songs");
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");

  const [songs, setSongs] = useState<Song[]>([]);
  const [songsTotal, setSongsTotal] = useState(0);
  const [songsPage, setSongsPage] = useState(1);
  const [songsLoading, setSongsLoading] = useState(false);

  const [exercises, setExercises] = useState<DashboardExercise[]>([]);
  const [exercisesTotal, setExercisesTotal] = useState(0);
  const [exercisesPage, setExercisesPage] = useState(1);
  const [exercisesLoading, setExercisesLoading] = useState(false);

  const [materials, setMaterials] = useState<DashboardStudyMaterial[]>([]);
  const [materialsTotal, setMaterialsTotal] = useState(0);
  const [materialsPage, setMaterialsPage] = useState(1);
  const [materialsLoading, setMaterialsLoading] = useState(false);

  const [error, setError] = useState<string | null>(null);

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
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load songs");
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
        const converted = res.exercises.map(catalogExerciseToDashboard);
        setExercises((prev) => (reset ? converted : [...prev, ...converted]));
        setExercisesTotal(res.total);
        setExercisesPage(page);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load exercises");
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
        const converted = res.study_material.map(catalogStudyMaterialToDashboard);
        setMaterials((prev) => (reset ? converted : [...prev, ...converted]));
        setMaterialsTotal(res.total);
        setMaterialsPage(page);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load study materials");
      } finally {
        setMaterialsLoading(false);
      }
    },
    [token]
  );

  useEffect(() => {
    if (tab === "songs") fetchSongs(1, debouncedSearch, true);
    else if (tab === "exercises") fetchExercises(1, debouncedSearch, true);
    else fetchMaterials(1, debouncedSearch, true);
  }, [tab, debouncedSearch, fetchSongs, fetchExercises, fetchMaterials]);

  const tabLabel = tab === "songs" ? "songs" : tab === "exercises" ? "exercises" : "study materials";

  return (
    <div className="browse-view">
      <header className="browse-header">
        <button className="btn-ghost" onClick={onBack} title="Back to session">
          <ArrowLeftIcon className="icon-sm" /> Back
        </button>
        <h1 className="browse-title">Browse</h1>
      </header>

      {error && <ErrorModal error={error} onDismiss={() => setError(null)} />}

      <div className="browse-tabs">
        <button
          className={`browse-tab ${tab === "songs" ? "active" : ""}`}
          onClick={() => setTab("songs")}
        >
          Songs
        </button>
        <button
          className={`browse-tab ${tab === "study_materials" ? "active" : ""}`}
          onClick={() => setTab("study_materials")}
        >
          Study Materials
        </button>
        <button
          className={`browse-tab ${tab === "exercises" ? "active" : ""}`}
          onClick={() => setTab("exercises")}
        >
          Exercises
        </button>
      </div>

      <div className="browse-search-wrap">
        <MagnifyingGlassIcon className="icon-sm browse-search-icon" />
        <input
          type="search"
          className="browse-search"
          placeholder={`Search ${tabLabel}…`}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      <div className="browse-list">
        {tab === "songs" && (
          <>
            {songs.map((s) => (
              <BrowseSongRow key={s.id} token={token} song={s} />
            ))}
            {songs.length === 0 && !songsLoading && <div className="browse-empty">No songs found</div>}
            {songs.length < songsTotal && !songsLoading && (
              <button
                className="qa-load-more"
                onClick={() => fetchSongs(songsPage + 1, debouncedSearch, false)}
              >
                Load {Math.min(LIMIT, songsTotal - songs.length)} more
              </button>
            )}
          </>
        )}

        {tab === "exercises" && (
          <>
            {exercises.map((ex) => (
              <BrowseExerciseRow key={ex.id} token={token} exercise={ex} />
            ))}
            {exercises.length === 0 && !exercisesLoading && (
              <div className="browse-empty">No exercises found</div>
            )}
            {exercises.length < exercisesTotal && !exercisesLoading && (
              <button
                className="qa-load-more"
                onClick={() => fetchExercises(exercisesPage + 1, debouncedSearch, false)}
              >
                Load {Math.min(LIMIT, exercisesTotal - exercises.length)} more
              </button>
            )}
          </>
        )}

        {tab === "study_materials" && (
          <>
            {materials.map((m) => (
              <BrowseStudyMaterialRow key={m.id} token={token} material={m} />
            ))}
            {materials.length === 0 && !materialsLoading && (
              <div className="browse-empty">No study materials found</div>
            )}
            {materials.length < materialsTotal && !materialsLoading && (
              <button
                className="qa-load-more"
                onClick={() => fetchMaterials(materialsPage + 1, debouncedSearch, false)}
              >
                Load {Math.min(LIMIT, materialsTotal - materials.length)} more
              </button>
            )}
          </>
        )}
      </div>
    </div>
  );
}
