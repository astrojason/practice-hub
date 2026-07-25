import { useEffect, useState } from "react";
import { FolderOpenIcon, PlusIcon, XMarkIcon } from "@heroicons/react/16/solid";
import { open as openFilePicker } from "@tauri-apps/plugin-dialog";
import { getArtists, getTunings, updateSong } from "../../../api/client";
import { ErrorModal } from "../../ErrorModal";
import type { Artist, Resource, Song, Tuning, UpdateSongPayload } from "../../../api/types";

// Matches the backend's DifficultyRating enum (Simple/Easy/Average/Challenging/Hard)
// x10, so singing_difficulty shares the same 1-100 scale as rhythm/lead.
const SINGING_DIFFICULTY_OPTIONS = [
  { label: "Simple", value: 10 },
  { label: "Easy", value: 30 },
  { label: "Average", value: 50 },
  { label: "Challenging", value: 70 },
  { label: "Hard", value: 100 },
];

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
  currentListId?: number;
  onSuccess: (updated: Song) => void;
  onCancel: () => void;
}

export function SongEditForm({ token, song, currentListId, onSuccess, onCancel }: Props) {
  const [artists, setArtists] = useState<Artist[]>([]);
  const [tunings, setTunings] = useState<Tuning[]>([]);
  const [name, setName] = useState(song.name);
  const [artistId, setArtistId] = useState(song.artist_id);
  const [tuningId, setTuningId] = useState(song.tuning_id);
  const [length, setLength] = useState(secsToMmSs(song.seconds));
  const [bpm, setBpm] = useState<number | "">(song.bpm ?? "");
  const [hasLead, setHasLead] = useState(song.has_lead);
  const [hasSinging, setHasSinging] = useState(song.has_singing);
  const [rhythmDifficulty, setRhythmDifficulty] = useState<number | "">(song.meta.rhythm_difficulty ?? "");
  const [leadDifficulty, setLeadDifficulty] = useState<number | "">(song.meta.lead_difficulty ?? "");
  const [singingDifficulty, setSingingDifficulty] = useState<number | "">(song.meta.singing_difficulty ?? "");
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
    getArtists(token).then(({ artists }) => setArtists(artists)).catch((err) => setError(err instanceof Error ? err.message : "Failed to load artists"));
    getTunings(token).then(({ tunings }) => setTunings(tunings)).catch((err) => setError(err instanceof Error ? err.message : "Failed to load tunings"));
  }, [token]);

  function findResourceNameError(): string | null {
    const named = resources.filter((r) => r.url).map((r) => r.name.trim());
    if (named.some((n) => !n)) return "Every resource needs a name.";
    const seen = new Set<string>();
    for (const n of named) {
      if (seen.has(n.toLowerCase())) return `Resource name "${n}" is used more than once.`;
      seen.add(n.toLowerCase());
    }
    return null;
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim() || !artistId || !tuningId) return;
    const resourceNameError = findResourceNameError();
    if (resourceNameError) {
      setError(resourceNameError);
      return;
    }
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
        .map((r) => ({ name: r.name.trim(), url: r.url, type: r.type })),
      song_lists: [
        ...new Set([
          ...(song.meta.song_lists ?? []).map((l) => l.id),
          ...(currentListId != null ? [currentListId] : []),
        ]),
      ],
      has_lead: hasLead,
      has_singing: hasSinging,
      rhythm_difficulty: rhythmDifficulty !== "" ? Number(rhythmDifficulty) : null,
      lead_difficulty: hasLead && leadDifficulty !== "" ? Number(leadDifficulty) : null,
      singing_difficulty: hasSinging && singingDifficulty !== "" ? Number(singingDifficulty) : null,
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
      <div className="edit-form-row">
        <label className="checkbox-label">
          <input
            type="checkbox"
            checked={hasLead}
            onChange={(e) => setHasLead(e.target.checked)}
          />
          Has Lead part
        </label>
        <label className="checkbox-label">
          <input
            type="checkbox"
            checked={hasSinging}
            onChange={(e) => setHasSinging(e.target.checked)}
          />
          Has Singing part
        </label>
      </div>
      <div className="edit-form-grid">
        <div className="edit-form-row">
          <label htmlFor="ef-diff-rhythm">Rhythm Difficulty</label>
          <input
            id="ef-diff-rhythm"
            type="number"
            min={1}
            max={100}
            placeholder="—"
            value={rhythmDifficulty}
            onChange={(e) => setRhythmDifficulty(e.target.value === "" ? "" : Number(e.target.value))}
          />
        </div>
        {hasLead && (
          <div className="edit-form-row">
            <label htmlFor="ef-diff-lead">Lead Difficulty</label>
            <input
              id="ef-diff-lead"
              type="number"
              min={1}
              max={100}
              placeholder="—"
              value={leadDifficulty}
              onChange={(e) => setLeadDifficulty(e.target.value === "" ? "" : Number(e.target.value))}
            />
          </div>
        )}
      </div>
      <div className="edit-form-grid">
        {hasSinging && (
          <div className="edit-form-row">
            <label htmlFor="ef-diff-singing">Singing Difficulty</label>
            <select
              id="ef-diff-singing"
              value={singingDifficulty}
              onChange={(e) => setSingingDifficulty(e.target.value === "" ? "" : Number(e.target.value))}
            >
              <option value="">—</option>
              {SINGING_DIFFICULTY_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          </div>
        )}
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
                  placeholder={r.type === "local_file" || r.type === "guitar_pro" ? "/path/to/file" : r.type === "local_folder" ? "/path/to/folder" : "https://..."}
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
                  <option value="local_folder">Folder</option>
                  <option value="guitar_pro">Guitar Pro</option>
                </select>
                {(r.type === "local_file" || r.type === "local_folder" || r.type === "guitar_pro") && (
                  <button
                    type="button"
                    className="edit-resource-browse"
                    title={r.type === "local_folder" ? "Browse for folder" : "Browse for file"}
                    onClick={async () => {
                      try {
                        const path = await openFilePicker({
                          multiple: false,
                          directory: r.type === "local_folder",
                          filters: r.type === "guitar_pro"
                            ? [{ name: "Guitar Pro", extensions: ["gp", "gp3", "gp4", "gp5", "gpx"] }]
                            : undefined,
                        });
                        if (typeof path === "string") updateResource(r.id, "url", path);
                      } catch (err) {
                        setError(err instanceof Error ? err.message : String(err));
                      }
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
      {error && <ErrorModal error={error} onDismiss={() => setError(null)} />}
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
