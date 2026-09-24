import { useState } from "react";
import { BookmarkIcon, BookmarkSlashIcon } from "@heroicons/react/16/solid";
import { ErrorModal } from "../ErrorModal";
import { setPlaylistOnDashboard } from "../../api/client";
import { decodeHtml } from "../../lib/decodeHtml";
import type { UserPlaylist } from "../../api/types";

interface Props {
  token: string;
  playlist: UserPlaylist;
}

export function BrowsePlaylistRow({ token, playlist }: Props) {
  const [onDashboard, setOnDashboard] = useState(playlist.on_dashboard);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleToggle() {
    if (saving) return;
    setSaving(true);
    try {
      const updated = await setPlaylistOnDashboard(token, playlist.id, !onDashboard);
      setOnDashboard(updated.on_dashboard ?? !onDashboard);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  const label = onDashboard ? "Saved to dashboard" : "Save to dashboard";

  return (
    <div className="browse-group">
      <div className="browse-row browse-playlist-row">
        <div className="browse-row-info">
          <span className="browse-row-name">{decodeHtml(playlist.name ?? "")}</span>
          <span className="browse-row-sub">
            {playlist.song_count} {playlist.song_count === 1 ? "song" : "songs"}
          </span>
          {playlist.session_playlist && <span className="tag">Session playlist</span>}
        </div>
        <div className="browse-row-actions">
          <button
            className={`btn-ghost${onDashboard ? " active" : ""}`}
            onClick={handleToggle}
            disabled={saving}
            aria-label={label}
            title={label}
          >
            {onDashboard ? <BookmarkIcon className="icon" /> : <BookmarkSlashIcon className="icon" />}
          </button>
        </div>
      </div>
      {error && <ErrorModal error={error} onDismiss={() => setError(null)} />}
    </div>
  );
}
