import { useEffect, useMemo, useRef, useState } from "react";
import {
  ChevronDownIcon,
  ChevronRightIcon,
  FunnelIcon,
  MagnifyingGlassIcon,
  XMarkIcon,
} from "@heroicons/react/16/solid";
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
  const [filterOpen, setFilterOpen] = useState(false);
  const [filterTuning, setFilterTuning] = useState<string | null>(null);
  const [filterPlaylist, setFilterPlaylist] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

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

  const hasFilterOptions = uniqueTunings.length > 1 || uniquePlaylists.length > 0;
  const activeFilterCount = (filterTuning ? 1 : 0) + (filterPlaylist ? 1 : 0);

  const q = search.trim().toLowerCase();

  const visibleOverdue = useMemo(
    () =>
      overdueSongs.filter((s) => {
        if (existingSongIds.has(s.id) || addedSongIds.has(s.id)) return false;
        if (filterTuning && s.tuning_name !== filterTuning) return false;
        if (filterPlaylist && !(s.meta.song_lists ?? []).some((pl) => pl.name === filterPlaylist)) return false;
        if (q && !s.name.toLowerCase().includes(q) && !s.artist_name.toLowerCase().includes(q)) return false;
        return true;
      }),
    [overdueSongs, existingSongIds, addedSongIds, filterTuning, filterPlaylist, q]
  );

  function handleAddSong(song: Song) {
    setAddedSongIds((prev) => new Set(prev).add(song.id));
    onAddSong(song);
    onClose();
  }

  function toggleFilterPanel() {
    setFilterOpen((v) => {
      if (!v) setTimeout(() => searchRef.current?.focus(), 50);
      return !v;
    });
  }

  return (
    <div className="quick-add-backdrop" onClick={onClose}>
      <div className="quick-add-panel" onClick={(e) => e.stopPropagation()}>
        {/* ── Header ── */}
        <div className="quick-add-header">
          <span className="quick-add-title">Add</span>
          <div className="quick-add-header-actions">
            {hasFilterOptions && (
              <button
                className={`btn-ghost qa-filter-btn${filterOpen ? " active" : ""}`}
                onClick={toggleFilterPanel}
                title="Filter"
              >
                <FunnelIcon />
                {activeFilterCount > 0 && (
                  <span className="qa-filter-badge">{activeFilterCount}</span>
                )}
              </button>
            )}
            <button className="btn-ghost quick-add-close" onClick={onClose}>
              <XMarkIcon />
            </button>
          </div>
        </div>

        {/* ── Filter panel ── */}
        {filterOpen && (
          <div className="qa-filter-panel">
            <div className="qa-filter-search-wrap">
              <MagnifyingGlassIcon className="qa-filter-search-icon icon-sm" />
              <input
                ref={searchRef}
                type="search"
                className="qa-filter-search"
                placeholder="Search…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>

            {uniqueTunings.length > 1 && (
              <div className="qa-filter-group">
                <span className="qa-filter-group-label">Tuning</span>
                <div className="qa-filter-pills">
                  {uniqueTunings.map((t) => (
                    <button
                      key={t}
                      className={`qa-filter-pill${filterTuning === t ? " active" : ""}`}
                      onClick={() => setFilterTuning((prev) => (prev === t ? null : t))}
                      // eslint-disable-next-line react/no-danger
                      dangerouslySetInnerHTML={{ __html: t }}
                    />
                  ))}
                </div>
              </div>
            )}

            {uniquePlaylists.length > 0 && (
              <div className="qa-filter-group">
                <span className="qa-filter-group-label">Playlist</span>
                <div className="qa-filter-pills">
                  {uniquePlaylists.map((pl) => (
                    <button
                      key={pl.name}
                      className={`qa-filter-pill qa-filter-pill--playlist${filterPlaylist === pl.name ? " active" : ""}`}
                      onClick={() => setFilterPlaylist((prev) => (prev === pl.name ? null : pl.name))}
                      // eslint-disable-next-line react/no-danger
                      dangerouslySetInnerHTML={{ __html: pl.name }}
                    />
                  ))}
                </div>
              </div>
            )}

            {(activeFilterCount > 0 || search) && (
              <button
                className="qa-filter-clear"
                onClick={() => {
                  setFilterTuning(null);
                  setFilterPlaylist(null);
                  setSearch("");
                }}
              >
                Clear filters
              </button>
            )}
          </div>
        )}

        {/* ── Body ── */}
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
