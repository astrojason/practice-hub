import { useEffect, useRef, useState } from "react";
import {
  getPracticePlans,
  getPracticePlan,
  createPracticePlan,
  activatePracticePlan,
  getTodaysPracticePlan,
  addPracticePlanEntry,
  updatePracticePlanEntry,
  deletePracticePlanEntry,
  getCatalogSongs,
} from "../api/client";
import { ErrorModal } from "./ErrorModal";
import type { PracticePlan, PracticePlanWithEntries, PracticePlanEntry, TodayEntry, SongSection } from "../api/types";
import { API_BASE_URL } from "../config";

// ─── helpers ──────────────────────────────────────────────────────────────────

function pillColor(songId: number): string {
  return `hsl(${(songId * 47) % 360}, 55%, 30%)`;
}

function formatMSS(totalSeconds: number): string {
  const m = Math.floor(totalSeconds / 60);
  const s = Math.floor(totalSeconds % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

function formatBlockRange(start: number | null, end: number | null): string {
  if (start === null || end === null) return "";
  return `${formatMSS(start)} – ${formatMSS(end)}`;
}

function authHeaders(token: string): HeadersInit {
  return {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
    "X-Timezone": Intl.DateTimeFormat().resolvedOptions().timeZone,
  };
}

// ─── types ────────────────────────────────────────────────────────────────────

interface Props {
  token: string;
  onBack: () => void;
}

// ─── Plan tab ─────────────────────────────────────────────────────────────────

interface DayPanelProps {
  token: string;
  plan: PracticePlanWithEntries;
  day: number;
  onClose: () => void;
  onRefresh: () => void;
}

function DayPanel({ token, plan, day, onClose, onRefresh }: DayPanelProps) {
  const dayEntries = plan.entries
    .filter(e => e.day_of_plan === day)
    .sort((a, b) => a.block_order - b.block_order);

  // Add block state
  const [addOpen, setAddOpen] = useState(false);
  const [songQuery, setSongQuery] = useState("");
  const [songResults, setSongResults] = useState<{ id: number; name: string; artist_name: string }[]>([]);
  const [selectedSongId, setSelectedSongId] = useState<number | null>(null);
  const [sections, setSections] = useState<SongSection[]>([]);
  const [selectedSectionId, setSelectedSectionId] = useState<number | null>(null);
  const [durationMinutes, setDurationMinutes] = useState("5");
  const [addError, setAddError] = useState<string | null>(null);
  const [addLoading, setAddLoading] = useState(false);
  const [panelError, setPanelError] = useState<string | null>(null);
  const searchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleSongSearch = (q: string) => {
    setSongQuery(q);
    if (searchTimerRef.current) clearTimeout(searchTimerRef.current);
    if (!q.trim()) { setSongResults([]); return; }
    searchTimerRef.current = setTimeout(async () => {
      try {
        const res = await getCatalogSongs(token, 1, 10, q);
        setSongResults(res.songs.map(s => ({ id: s.id, name: s.name, artist_name: s.artist_name })));
      } catch (err) {
        setAddError(err instanceof Error ? err.message : "Song search failed.");
      }
    }, 300);
  };

  const handleSelectSong = async (songId: number) => {
    setSelectedSongId(songId);
    setSections([]);
    setSelectedSectionId(null);
    try {
      const res = await fetch(`${API_BASE_URL}/song/${songId}/section`, {
        headers: authHeaders(token),
      });
      if (res.ok) {
        const data = await res.json() as { sections: SongSection[] };
        setSections(data.sections ?? []);
      }
    } catch (err) {
      setAddError(err instanceof Error ? err.message : "Failed to load sections.");
    }
  };

  const handleAddBlock = async () => {
    if (!selectedSectionId) { setAddError("Select a section."); return; }
    const dur = parseInt(durationMinutes) || 5;
    const nextOrder = dayEntries.length > 0 ? Math.max(...dayEntries.map(e => e.block_order)) + 1 : 1;
    setAddLoading(true);
    setAddError(null);
    try {
      await addPracticePlanEntry(token, plan.id, {
        song_section_id: selectedSectionId,
        day_of_plan: day,
        block_order: nextOrder,
        block_duration_seconds: dur * 60,
      });
      setAddOpen(false);
      setSongQuery("");
      setSongResults([]);
      setSelectedSongId(null);
      setSections([]);
      setSelectedSectionId(null);
      setDurationMinutes("5");
      onRefresh();
    } catch (err) {
      setAddError(err instanceof Error ? err.message : "Failed to add block.");
    } finally {
      setAddLoading(false);
    }
  };

  const handleDelete = async (entryId: number) => {
    setPanelError(null);
    try {
      await deletePracticePlanEntry(token, entryId);
      onRefresh();
    } catch (err) {
      setPanelError(err instanceof Error ? err.message : "Failed to delete block.");
    }
  };

  const handleMove = async (entry: PracticePlanEntry, dir: "up" | "down") => {
    const idx = dayEntries.indexOf(entry);
    const swap = dir === "up" ? dayEntries[idx - 1] : dayEntries[idx + 1];
    if (!swap) return;
    setPanelError(null);
    try {
      await Promise.all([
        updatePracticePlanEntry(token, entry.id, { block_order: swap.block_order }),
        updatePracticePlanEntry(token, swap.id, { block_order: entry.block_order }),
      ]);
      onRefresh();
    } catch (err) {
      setPanelError(err instanceof Error ? err.message : "Failed to reorder blocks.");
    }
  };

  return (
    <div className="cal-day-panel">
      <div className="cal-day-panel__header">
        <span className="cal-day-panel__title">Day {day}</span>
        <button className="btn-ghost btn-xs" onClick={onClose}>✕</button>
      </div>
      {panelError && <ErrorModal error={panelError} onDismiss={() => setPanelError(null)} />}
      {dayEntries.length === 0 && <p className="cal-empty">No blocks for this day.</p>}
      <ul className="cal-block-list">
        {dayEntries.map((entry, idx) => (
          <li key={entry.id} className="cal-block-item">
            <div className="cal-block-info">
              <span className="cal-block-section">{entry.section_name}</span>
              <span className="cal-block-song">{entry.song_name}</span>
              <span className="cal-block-dur">{Math.round(entry.block_duration_seconds / 60)} min</span>
            </div>
            <div className="cal-block-actions">
              <button className="btn-ghost btn-xs" onClick={() => handleMove(entry, "up")} disabled={idx === 0}>↑</button>
              <button className="btn-ghost btn-xs" onClick={() => handleMove(entry, "down")} disabled={idx === dayEntries.length - 1}>↓</button>
              <button className="btn-ghost btn-xs" onClick={() => handleDelete(entry.id)}>✕</button>
            </div>
          </li>
        ))}
      </ul>

      {!addOpen && (
        <button className="btn-secondary btn-xs" onClick={() => setAddOpen(true)}>+ Add Block</button>
      )}
      {addOpen && (
        <div className="cal-add-block">
          <input
            type="text"
            placeholder="Search songs…"
            value={songQuery}
            onChange={e => handleSongSearch(e.target.value)}
            className="cal-input"
          />
          {songResults.length > 0 && (
            <ul className="cal-song-results">
              {songResults.map(s => (
                <li
                  key={s.id}
                  className={`cal-song-result ${selectedSongId === s.id ? "is-selected" : ""}`}
                  onClick={() => handleSelectSong(s.id)}
                >
                  {s.name} — {s.artist_name}
                </li>
              ))}
            </ul>
          )}
          {sections.length > 0 && (
            <select
              className="cal-select"
              value={selectedSectionId ?? ""}
              onChange={e => setSelectedSectionId(Number(e.target.value))}
            >
              <option value="">Pick section…</option>
              {sections.map(sec => (
                <option key={sec.id} value={sec.id}>{sec.name}</option>
              ))}
            </select>
          )}
          <div className="cal-row">
            <label className="cal-label">Duration (min)</label>
            <input
              type="number"
              min="1"
              max="120"
              value={durationMinutes}
              onChange={e => setDurationMinutes(e.target.value)}
              className="cal-input cal-input--short"
            />
          </div>
          {addError && <ErrorModal error={addError} onDismiss={() => setAddError(null)} />}
          <div className="cal-row">
            <button className="btn-primary btn-xs" onClick={handleAddBlock} disabled={addLoading}>
              {addLoading ? "Adding…" : "Add"}
            </button>
            <button className="btn-ghost btn-xs" onClick={() => setAddOpen(false)}>Cancel</button>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Plan tab ─────────────────────────────────────────────────────────────────

interface PlanTabProps {
  token: string;
}

function PlanTab({ token }: PlanTabProps) {
  const [plans, setPlans] = useState<PracticePlan[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedPlan, setSelectedPlan] = useState<PracticePlanWithEntries | null>(null);
  const [selectedDay, setSelectedDay] = useState<number | null>(null);
  const [newName, setNewName] = useState("");
  const [newStart, setNewStart] = useState("");
  const [newEnd, setNewEnd] = useState("");
  const [createLoading, setCreateLoading] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  const loadPlans = async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await getPracticePlans(token);
      setPlans(data.plans);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load plans.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadPlans(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const handleSelectPlan = async (planId: number) => {
    setSelectedDay(null);
    try {
      const data = await getPracticePlan(token, planId);
      setSelectedPlan(data.plan);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load plan.");
    }
  };

  const handleActivate = async (planId: number) => {
    try {
      await activatePracticePlan(token, planId);
      await loadPlans();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to activate plan.");
    }
  };

  const handleCreate = async () => {
    if (!newName.trim() || !newStart || !newEnd) {
      setCreateError("Name, start date, and end date are required.");
      return;
    }
    setCreateLoading(true);
    setCreateError(null);
    try {
      await createPracticePlan(token, { name: newName, start_date: newStart, end_date: newEnd });
      setNewName("");
      setNewStart("");
      setNewEnd("");
      await loadPlans();
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : "Failed to create plan.");
    } finally {
      setCreateLoading(false);
    }
  };

  const refreshSelectedPlan = async () => {
    if (!selectedPlan) return;
    try {
      const data = await getPracticePlan(token, selectedPlan.id);
      setSelectedPlan(data.plan);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to refresh plan.");
    }
  };

  // Build calendar grid
  const planDays = selectedPlan
    ? Math.ceil(
        (new Date(selectedPlan.end_date).getTime() - new Date(selectedPlan.start_date).getTime()) /
          (1000 * 60 * 60 * 24)
      ) + 1
    : 0;

  const weeks: number[][] = [];
  if (planDays > 0) {
    let week: number[] = [];
    for (let d = 1; d <= planDays; d++) {
      week.push(d);
      if (week.length === 7) {
        weeks.push(week);
        week = [];
      }
    }
    if (week.length) weeks.push(week);
  }

  const entriesByDay = selectedPlan
    ? selectedPlan.entries.reduce<Record<number, PracticePlanEntry[]>>((acc, e) => {
        if (!acc[e.day_of_plan]) acc[e.day_of_plan] = [];
        acc[e.day_of_plan].push(e);
        return acc;
      }, {})
    : {};

  return (
    <div className="cal-plan-tab">
      <div className="cal-sidebar">
        {loading && <p className="cal-loading">Loading plans…</p>}
        {error && <ErrorModal error={error} onDismiss={() => setError(null)} />}
        <ul className="cal-plan-list">
          {plans.map(plan => (
            <li
              key={plan.id}
              className={`cal-plan-item ${selectedPlan?.id === plan.id ? "is-selected" : ""}`}
              onClick={() => handleSelectPlan(plan.id)}
            >
              <div className="cal-plan-name">
                {plan.name}
                {plan.is_active_plan && <span className="cal-badge">Active</span>}
              </div>
              <div className="cal-plan-dates">{plan.start_date} – {plan.end_date}</div>
              {!plan.is_active_plan && (
                <button
                  className="btn-ghost btn-xs"
                  onClick={e => { e.stopPropagation(); handleActivate(plan.id); }}
                >
                  Activate
                </button>
              )}
            </li>
          ))}
        </ul>

        <div className="cal-new-plan">
          <h3 className="cal-section-title">New Plan</h3>
          <input
            type="text"
            placeholder="Plan name"
            value={newName}
            onChange={e => setNewName(e.target.value)}
            className="cal-input"
          />
          <div className="cal-row">
            <label className="cal-label">Start</label>
            <input
              type="date"
              value={newStart}
              onChange={e => setNewStart(e.target.value)}
              className="cal-input"
            />
          </div>
          <div className="cal-row">
            <label className="cal-label">End</label>
            <input
              type="date"
              value={newEnd}
              onChange={e => setNewEnd(e.target.value)}
              className="cal-input"
            />
          </div>
          {createError && <ErrorModal error={createError} onDismiss={() => setCreateError(null)} />}
          <button className="btn-primary btn-xs" onClick={handleCreate} disabled={createLoading}>
            {createLoading ? "Creating…" : "Create Plan"}
          </button>
        </div>
      </div>

      <div className="cal-main">
        {!selectedPlan && !loading && (
          <p className="cal-empty">Select a plan from the sidebar, or create one.</p>
        )}
        {selectedPlan && (
          <>
            <h2 className="cal-plan-header">
              {selectedPlan.name}
              {selectedPlan.is_active_plan && <span className="cal-badge">Active</span>}
            </h2>
            <div className="cal-grid">
              {weeks.map((week, wi) => (
                <div key={wi} className="cal-week">
                  {week.map(day => {
                    const dayBlocks = (entriesByDay[day] ?? []).sort((a, b) => a.block_order - b.block_order);
                    return (
                      <div
                        key={day}
                        className={`cal-day ${selectedDay === day ? "is-selected" : ""}`}
                        onClick={() => setSelectedDay(selectedDay === day ? null : day)}
                      >
                        <span className="cal-day-num">Day {day}</span>
                        <div className="cal-pills">
                          {dayBlocks.map(block => (
                            <span
                              key={block.id}
                              className="cal-pill"
                              style={{ background: pillColor(block.song_id) }}
                              title={`${block.section_name} — ${block.song_name}`}
                            >
                              {block.section_name}
                            </span>
                          ))}
                        </div>
                      </div>
                    );
                  })}
                </div>
              ))}
            </div>

            {selectedDay !== null && (
              <DayPanel
                token={token}
                plan={selectedPlan}
                day={selectedDay}
                onClose={() => setSelectedDay(null)}
                onRefresh={refreshSelectedPlan}
              />
            )}
          </>
        )}
      </div>
    </div>
  );
}

// ─── Today tab ────────────────────────────────────────────────────────────────

interface TodayTabProps {
  token: string;
}

function TodayTab({ token }: TodayTabProps) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [entries, setEntries] = useState<TodayEntry[]>([]);
  const [currentIdx, setCurrentIdx] = useState(0);
  const [running, setRunning] = useState(false);
  const [secondsLeft, setSecondsLeft] = useState(0);
  const [flashing, setFlashing] = useState(false);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const autoAdvanceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [elapsed, setElapsed] = useState<Set<number>>(new Set());

  useEffect(() => {
    getTodaysPracticePlan(token)
      .then(data => {
        setEntries(data.entries);
        if (data.entries.length > 0) {
          setSecondsLeft(data.entries[0].block_duration_seconds);
        }
      })
      .catch(err => setError(err instanceof Error ? err.message : "Failed to load today's plan."))
      .finally(() => setLoading(false));
  }, [token]);

  const currentEntry: TodayEntry | undefined = entries[currentIdx];

  const goToBlock = (idx: number) => {
    if (idx < 0 || idx >= entries.length) return;
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = null;
    if (autoAdvanceRef.current) clearTimeout(autoAdvanceRef.current);
    autoAdvanceRef.current = null;
    setFlashing(false);
    setRunning(false);
    setCurrentIdx(idx);
    setSecondsLeft(entries[idx].block_duration_seconds);
  };

  const advanceBlock = () => {
    setElapsed(prev => {
      const next = new Set(prev);
      next.add(currentIdx);
      return next;
    });
    goToBlock(currentIdx + 1);
  };

  const handleStartPause = () => {
    if (running) {
      if (timerRef.current) clearInterval(timerRef.current);
      timerRef.current = null;
      setRunning(false);
    } else {
      setRunning(true);
      timerRef.current = setInterval(() => {
        setSecondsLeft(prev => {
          if (prev <= 1) {
            if (timerRef.current) clearInterval(timerRef.current);
            timerRef.current = null;
            setRunning(false);
            setFlashing(true);
            // auto-advance after 3s
            autoAdvanceRef.current = setTimeout(() => {
              setFlashing(false);
              setElapsed(p => {
                const n = new Set(p);
                n.add(currentIdx);
                return n;
              });
              setCurrentIdx(ci => {
                const next = ci + 1;
                if (next < entries.length) {
                  setSecondsLeft(entries[next].block_duration_seconds);
                }
                return next < entries.length ? next : ci;
              });
            }, 3000);
            return 0;
          }
          return prev - 1;
        });
      }, 1000);
    }
  };

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
      if (autoAdvanceRef.current) clearTimeout(autoAdvanceRef.current);
    };
  }, []);

  if (loading) return <p className="cal-loading">Loading today's plan…</p>;
  if (error) return <ErrorModal error={error} onDismiss={() => setError(null)} />;

  if (entries.length === 0) {
    return (
      <p className="cal-empty">No practice plan scheduled for today. Set up a plan in the Plan tab.</p>
    );
  }

  if (!currentEntry) {
    return <p className="cal-empty">All blocks complete!</p>;
  }

  const hasRange = currentEntry.start_seconds !== null && currentEntry.end_seconds !== null;

  return (
    <div className="cal-today">
      {/* Block progress chips */}
      <div className="cal-chips">
        {entries.map((e, i) => (
          <button
            key={e.id}
            className={`cal-chip ${i === currentIdx ? "is-current" : ""} ${elapsed.has(i) ? "is-done" : ""}`}
            onClick={() => goToBlock(i)}
            title={`${e.section_name} — ${e.song_name}`}
          >
            {elapsed.has(i) ? "✓" : i + 1}
          </button>
        ))}
      </div>

      {/* Current block card */}
      <div className="cal-block-card">
        <div className="cal-block-card__song">{currentEntry.song_name}</div>
        <div className="cal-block-card__section">{currentEntry.section_name}</div>
        {hasRange && (
          <div className="cal-block-card__range">
            {formatBlockRange(currentEntry.start_seconds, currentEntry.end_seconds)}
          </div>
        )}
        <div className="cal-block-card__meta">
          Block {currentIdx + 1} of {entries.length}
        </div>
      </div>

      {/* Countdown timer */}
      <div className={`cal-timer ${flashing ? "is-flashing" : ""}`}>
        {formatMSS(secondsLeft)}
      </div>

      {/* Controls */}
      <div className="cal-controls">
        <button className="btn-ghost" onClick={() => goToBlock(currentIdx - 1)} disabled={currentIdx === 0}>← Prev</button>
        <button className="btn-primary" onClick={handleStartPause}>
          {running ? "Pause" : "Start"}
        </button>
        <button
          className={`btn-ghost ${flashing ? "is-pulsing" : ""}`}
          onClick={advanceBlock}
          disabled={currentIdx >= entries.length - 1}
        >
          Next →
        </button>
      </div>
    </div>
  );
}

// ─── Main view ────────────────────────────────────────────────────────────────

type CalTab = "plan" | "today";

export function InterleavedCalendarView({ token, onBack }: Props) {
  const [tab, setTab] = useState<CalTab>("plan");

  return (
    <div className="cal-view">
      <div className="cal-view__header">
        <button className="btn-ghost" onClick={onBack}>← Back</button>
        <h1 className="cal-view__title">Practice Calendar</h1>
        <div className="cal-tabs">
          <button
            className={`cal-tab ${tab === "plan" ? "is-active" : ""}`}
            onClick={() => setTab("plan")}
          >
            Plan
          </button>
          <button
            className={`cal-tab ${tab === "today" ? "is-active" : ""}`}
            onClick={() => setTab("today")}
          >
            Today
          </button>
        </div>
      </div>

      <div className="cal-view__body">
        {tab === "plan" && <PlanTab token={token} />}
        {tab === "today" && <TodayTab token={token} />}
      </div>
    </div>
  );
}
