import { useEffect, useState } from "react";
import { FolderOpenIcon, PlusIcon, XMarkIcon } from "@heroicons/react/16/solid";
import { open as openFilePicker } from "@tauri-apps/plugin-dialog";
import { getArtists, getTunings, updateSong } from "../../../api/client";
import type { Artist, Resource, Song, Tuning, UpdateSongPayload } from "../../../api/types";

const DIFFICULTY_LABELS = ["None", "Beginner", "Intermediate", "Advanced", "Expert", "Master"];

function tsToDateStr(ts: number | null): string {
  if (!ts) return "";
  const ms = ts > 1e10 ? ts : ts * 1000;
  return new Date(ms).toLocaleDateString("en-CA");
}

function secsToMmSs(s: number | null): string {
  if (!s) return "";
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return `${m}:${String(sec).padStart(2, "0")}`;
}

function mmSsToSecs(str: string): number {
  const [m, s] = str.split(":").map(Number);
  if (!isNaN(m) && !isNaN(s)) return m * 60 + s;
  return 0;
}

interface ResourceRow {
  id: string;
  name: string;
  url: string;
  type: string;
}

interface Props {
  token: string;
  song: Song;
  onSuccess: (updated: Song) => void;
  onCancel: () => void;
}

export function SongEditForm({ token, song, onSuccess, onCancel }: Props) {
  const [artists, setArtists] = useState<Artist[]>([]);
  const [tunings, setTunings] = useState<Tuning[]>([]);
  const [name, setName] = useState(song.name);
  const [artistId, setArtistId] = useState(song.artist_id);
  const [tuningId, setTuningId] = useState(song.tuning_id);
  const [length, setLength] = useState(secsToMmSs(song.seconds));
  const [bpm, setBpm] = useState<number | "">(song.bpm ?? "");
  const [difficulty, setDifficulty] = useState(song.meta.difficulty ?? 0);
  const [dateLearned, setDateLearned] = useState(tsToDateStr(song.meta.date_learned));
  const [resources, setResources] = useState<ResourceRow[]>(
    (song.resources ?? []).map((r: Resource, i: number) => ({
      id: String(i),
      name: r.name,
      url: r.url,
      type: r.type ?? "url",
    }))
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getArtists(token).then(({ artists }) => setArtists(artists)).catch(() => {});
    getTunings(token).then(({ tunings }) => setTunings(tunings)).catch(() => {});
  }, [token]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim() || !artistId || !tuningId) return;
    setSaving(true);
    setError(null);
    const payload: UpdateSongPayload = {
      name: name.trim(),
      artist_id: artistId,
      tuning_id: tuningId,
      seconds: length ? mmSsToSecs(length) : (song.seconds ?? 0),
      bpm: bpm !== "" ? Number(bpm) : null,
      resources: resources
        .filter((r) => r.url)
        .map((r) => ({ name: r.name, url: r.url, type: r.type })),
      song_lists: (song.meta.song_lists ?? []).map((l) => l.id),
      difficulty: Number(difficulty),
      date_learned: dateLearned || null,
    };
    try {
      const updated = await updateSong(token, song.id, payload);
      onSuccess(updated);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  function addResource() {
    setResources((prev) => [...prev, { id: Date.now().toString(), name: "", url: "", type: "url" }]);
  }

  function removeResource(id: string) {
    setResources((prev) => prev.filter((r) => r.id !== id));
  }

  function updateResource(id: string, field: keyof ResourceRow, value: string) {
    setResources((prev) => prev.map((r) => (r.id === id ? { ...r, [field]: value } : r)));
  }

  return (
    <form className="edit-form" onSubmit={handleSubmit}>
      <div className="edit-form-row">
        <label htmlFor="ef-name">Name</label>
        <input
          id="ef-name"
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
        />
      </div>
      <div className="edit-form-row">
        <label htmlFor="ef-artist">Artist</label>
        <select
          id="ef-artist"
          value={artistId}
          onChange={(e) => setArtistId(Number(e.target.value))}
          required
        >
          {artists.map((a) => (
            <option key={a.id} value={a.id}>{a.name}</option>
          ))}
        </select>
      </div>
      <div className="edit-form-row">
        <label htmlFor="ef-tuning">Tuning</label>
        <select
          id="ef-tuning"
          value={tuningId}
          onChange={(e) => setTuningId(Number(e.target.value))}
          required
        >
          {tunings.map((t) => (
            <option key={t.id} value={t.id}>{t.name}</option>
          ))}
        </select>
      </div>
      <div className="edit-form-grid">
        <div className="edit-form-row">
          <label htmlFor="ef-length">Length (mm:ss)</label>
          <input
            id="ef-length"
            type="text"
            value={length}
            onChange={(e) => setLength(e.target.value)}
            placeholder="3:45"
          />
        </div>
        <div className="edit-form-row">
          <label htmlFor="ef-bpm">BPM</label>
          <input
            id="ef-bpm"
            type="number"
            value={bpm}
            onChange={(e) => setBpm(e.target.value === "" ? "" : Number(e.target.value))}
            min={0}
          />
        </div>
      </div>
      <div className="edit-form-grid">
        <div className="edit-form-row">
          <label htmlFor="ef-diff">Difficulty</label>
          <select
            id="ef-diff"
            value={difficulty}
            onChange={(e) => setDifficulty(Number(e.target.value))}
          >
            {DIFFICULTY_LABELS.map((label, i) => (
              <option key={i} value={i}>{label}</option>
            ))}
          </select>
        </div>
        <div className="edit-form-row">
          <label htmlFor="ef-date">Date Learned</label>
          <input
            id="ef-date"
            type="date"
            value={dateLearned}
            onChange={(e) => setDateLearned(e.target.value)}
          />
        </div>
      </div>
      <div className="edit-form-row">
        <div className="edit-resource-header">
          <span className="edit-label-text">Resources</span>
          <button
            type="button"
            className="btn-ghost"
            style={{ padding: "2px 7px", fontSize: 12, height: 24 }}
            onClick={addResource}
          >
            <PlusIcon className="icon-sm" /> Add
          </button>
        </div>
        {resources.length > 0 && (
          <div className="edit-resource-list">
            {resources.map((r) => (
              <div key={r.id} className="edit-resource-row">
                <input
                  type="text"
                  placeholder="Name"
                  value={r.name}
                  onChange={(e) => updateResource(r.id, "name", e.target.value)}
                />
                <input
                  type="text"
                  placeholder={r.type === "local_file" ? "/path/to/file" : "https://..."}
                  value={r.url}
                  onChange={(e) => updateResource(r.id, "url", e.target.value)}
                />
                <select
                  value={r.type}
                  onChange={(e) => updateResource(r.id, "type", e.target.value)}
                >
                  <option value="url">URL</option>
                  <option value="youtube">YouTube</option>
                  <option value="local_file">File</option>
                </select>
                {r.type === "local_file" && (
                  <button
                    type="button"
                    className="edit-resource-browse"
                    title="Browse for file"
                    onClick={async () => {
                      const path = await openFilePicker({ multiple: false, directory: false });
                      if (typeof path === "string") updateResource(r.id, "url", path);
                    }}
                  >
                    <FolderOpenIcon />
                  </button>
                )}
                <button
                  type="button"
                  className="edit-resource-remove"
                  onClick={() => removeResource(r.id)}
                  title="Remove"
                >
                  <XMarkIcon />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
      {error && <div className="form-error">{error}</div>}
      <div className="edit-form-actions">
        <button type="submit" className="btn-primary" disabled={saving}>
          {saving ? "Saving…" : "Save"}
        </button>
        <button type="button" className="btn-ghost" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </form>
  );
}
