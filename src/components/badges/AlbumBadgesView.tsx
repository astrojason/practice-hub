import { ArrowLeftIcon } from "@heroicons/react/16/solid";
import type { AlbumBadgesResponse } from "../../api/types";

interface Props {
  data: AlbumBadgesResponse | null;
  onBack: () => void;
}

export function AlbumBadgesView({ data, onBack }: Props) {
  const badges = data?.badges ?? [];
  const inProgress = data?.in_progress ?? [];

  return (
    <div className="badges-view">
      <div className="badges-header">
        <button onClick={onBack} className="btn-ghost">
          <ArrowLeftIcon className="icon-sm" /> Back
        </button>
        <h2>Album badges</h2>
      </div>

      {data === null && <p className="badges-empty">Loading…</p>}
      {data !== null && badges.length === 0 && inProgress.length === 0 && (
        <p className="badges-empty">
          No albums yet. Assign songs to an album and add them all to your repertoire to earn a badge.
        </p>
      )}

      {badges.length > 0 && (
        <section>
          <h3>Earned</h3>
          <div className="badge-grid">
            {badges.map((b) => (
              <div key={b.album_id} className="badge-card">
                <span className="badge-card-icon">🏅</span>
                <strong>{b.album_name}</strong>
                <span>{b.artist_name}</span>
                {b.year && <span>{b.year}</span>}
                <span className="badge-card-date">
                  Earned {new Date(b.awarded_timestamp * 1000).toLocaleDateString("en-CA")}
                </span>
              </div>
            ))}
          </div>
        </section>
      )}

      {inProgress.length > 0 && (
        <section>
          <h3>In progress</h3>
          <ul className="badge-progress-list">
            {inProgress.map((p) => (
              <li key={p.album_id} className="badge-progress-item">
                <div className="badge-progress-label">
                  <strong>{p.album_name}</strong>
                  <span>{p.artist_name}</span>
                  <span>{p.learned} / {p.required}</span>
                </div>
                <div className="badge-progress-bar">
                  <div className="badge-progress-fill" style={{ width: `${Math.round((p.learned / p.required) * 100)}%` }} />
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
