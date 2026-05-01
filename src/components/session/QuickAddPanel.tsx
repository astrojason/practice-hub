import { useEffect, useMemo, useState } from "react";
import { ChevronDownIcon, ChevronRightIcon, XMarkIcon } from "@heroicons/react/16/solid";
import type { Song } from "../../api/types";

interface Props {
  overdueSongs: Song[];
  existingSongIds: ReadonlySet<number>;
  onAddSong: (song: Song) => void;
  onClose: () => void;
}

export function QuickAddPanel({
  overdueSongs,
  existingSongIds,
  onAddSong,
  onClose,
}: Props) {
  const [overdueCollapsed, setOverdueCollapsed] = useState(false);
  const [addedSongIds, setAddedSongIds] = useState<Set<number>>(new Set());
  const [filterTuning, setFilterTuning] = useState<string | null>(null);
  const [filterPlaylist, setFilterPlaylist] = useState<string | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const visibleOverdue = useMemo(
    () =>
      overdueSongs.filter((s) => {
        if (existingSongIds.has(s.id) || addedSongIds.has(s.id)) return false;
        if (filterTuning && s.tuning_name !== filterTuning) return false;
        if (filterPlaylist && !(s.meta.song_lists ?? []).some((pl) => pl.name === filterPlaylist)) return false;
        return true;
      }),
    [overdueSongs, existingSongIds, addedSongIds, filterTuning, filterPlaylist]
  );

  const uniqueTunings = useMemo(() => {
    const seen = new Set<string>();
    return overdueSongs.map((s) => s.tuning_name).filter((t) => {
      if (seen.has(t)) return false;
      seen.add(t);
      return true;
    });
  }, [overdueSongs]);

  const uniquePlaylists = useMemo(() => {
    const seen = new Set<string>();
    return overdueSongs
      .flatMap((s) => s.meta.song_lists ?? [])
      .filter((pl) => {
        if (seen.has(pl.name)) return false;
        seen.add(pl.name);
        return true;
      });
  }, [overdueSongs]);

  function handleAddSong(song: Song) {
    setAddedSongIds((prev) => new Set(prev).add(song.id));
    onAddSong(song);
    onClose();
  }

  return (
    <div className="quick-add-backdrop" onClick={onClose}>
      <div className="quick-add-panel" onClick={(e) => e.stopPropagation()}>
        <div className="quick-add-header">
          <span className="quick-add-title">Add</span>
          <button className="btn-ghost quick-add-close" onClick={onClose}>
            <XMarkIcon />
          </button>
        </div>

        {(uniqueTunings.length > 1 || uniquePlaylists.length > 0) && (
          <div className="qa-filters">
            {uniqueTunings.length > 1 && uniqueTunings.map((t) => (
              <button
                key={t}
                className={`qa-filter-pill${filterTuning === t ? " active" : ""}`}
                onClick={() => setFilterTuning((prev) => (prev === t ? null : t))}
              >
                {t}
              </button>
            ))}
            {uniquePlaylists.map((pl) => (
              <button
                key={pl.name}
                className={`qa-filter-pill qa-filter-pill--playlist${filterPlaylist === pl.name ? " active" : ""}`}
                onClick={() => setFilterPlaylist((prev) => (prev === pl.name ? null : pl.name))}
              >
                {pl.name}
              </button>
            ))}
          </div>
        )}

        <div className="quick-add-body">
          {visibleOverdue.length === 0 ? (
            <div className="qa-empty qa-empty-center">No overdue items</div>
          ) : (
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
