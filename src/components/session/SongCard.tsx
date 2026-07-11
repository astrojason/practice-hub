import { useEffect, useRef, useState } from "react";
import {
  ChatBubbleLeftRightIcon,
  CheckIcon,
  ForwardIcon,
  NoSymbolIcon,
  PauseIcon,
  PencilSquareIcon,
  PlayIcon,
  PlusIcon,
  StopIcon,
} from "@heroicons/react/16/solid";
import { SongSessionForm } from "./forms/SongSessionForm";
import { SongEditForm } from "./forms/SongEditForm";
import { SessionModal } from "./SessionModal";
import { LastSessionInfo } from "./LastSessionInfo";
import { RatingTrendChart } from "../reports/RatingTrendChart";
import type { Song, SongSession } from "../../api/types";

function decodeHtml(html: string): string {
  const ta = document.createElement("textarea");
  ta.innerHTML = html;
  return ta.value;
}

function formatElapsed(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

/** Returns true if the last 3+ sessions are all Awful or Bad */
export function isStruggling(sessions: SongSession[]): boolean {
  const rated = sessions.filter((s) => s.rating != null);
  if (rated.length < 3) return false;
  return rated.slice(0, 3).every((s) => s.rating === "Awful" || s.rating === "Bad");
}

interface Props {
  token: string;
  song: Song;
  currentListId?: number;
  isCompletedToday: boolean;
  isSkippedToday: boolean;
  isTimerActive: boolean;
  isTimerPaused: boolean;
  timerElapsed: number;
  isFormOpen: boolean;
  onStart: () => void;
  onPause: () => void;
  onStopAndSave: () => void;
  onCancel: () => void;
  onFormOpen: () => void;
  onFormClose: () => void;
  onSessionSubmit: (dailyPracticeTime: number) => void;
  onSkip: () => void;
  onOpenFile?: (path: string, mediaType: "audio" | "video", itemKey?: string) => void;
  onGpView?: (path: string, audioPath?: string) => void;
  onOpenChat?: () => void;
  isMediaActive?: boolean;
  isGpViewerActive?: boolean;
  onEntityEdited?: (song: Song) => void;
}

export function SongCard({
  token,
  song,
  currentListId,
  isCompletedToday,
  isSkippedToday,
  isTimerActive,
  isTimerPaused,
  timerElapsed,
  isFormOpen,
  onStart,
  onPause,
  onStopAndSave,
  onCancel,
  onFormOpen,
  onFormClose,
  onSessionSubmit,
  onSkip,
  onOpenFile,
  onGpView,
  onOpenChat,
  isMediaActive,
  isGpViewerActive,
  onEntityEdited,
}: Props) {
  const inSession = isTimerActive || isTimerPaused;
  const [modalOpen, setModalOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [notes, setNotes] = useState("");
  const [showHistory, setShowHistory] = useState(false);
  const mediaWasOpenedRef = useRef(false);

  // If Stop & Save is triggered externally (e.g. a future shortcut), open the modal
  useEffect(() => {
    if (isFormOpen) setModalOpen(true);
  }, [isFormOpen]);

  useEffect(() => {
    if (!(isMediaActive ?? false) && !(isGpViewerActive ?? false) && mediaWasOpenedRef.current) {
      setModalOpen(true);
      mediaWasOpenedRef.current = false;
    }
  }, [isMediaActive, isGpViewerActive]);

  function handleOpenFile(path: string, mediaType: "audio" | "video", itemKey?: string) {
    mediaWasOpenedRef.current = true;
    onOpenFile!(path, mediaType, itemKey);
  }

  function handleGpView(path: string, audioPath?: string) {
    mediaWasOpenedRef.current = true;
    onGpView!(path, audioPath);
  }

  function handleStart() {
    onStart();
    setModalOpen(true);
  }

  function handleClose() {
    if (isFormOpen) onFormClose();
    setModalOpen(false);
    setShowHistory(false);
  }

  function handleCancel() {
    onCancel();
    setModalOpen(false);
    setNotes("");
    setShowHistory(false);
  }

  function handleFormSubmit(dpt: number) {
    onSessionSubmit(dpt);
    setModalOpen(false);
    setNotes("");
    setShowHistory(false);
  }

  const resources = (song.resources ?? []).map((r) => ({ name: r.name, url: r.url, type: r.type }));
  const sessions = (song.meta.sessions ?? []) as SongSession[];
  const lastSession = sessions[0] ?? null;
  const struggling = isStruggling(sessions);

  return (
    <div
      className={`item-card ${isSkippedToday ? "skipped" : isCompletedToday ? "completed" : ""} ${isTimerActive ? "active" : ""}`}
    >
      <div className="item-card-row">
        <span className="item-status">
          {isSkippedToday ? <ForwardIcon className="icon-sm" /> : isCompletedToday ? <CheckIcon className="icon-sm" /> : "○"}
        </span>
        <div className="item-info">
          <span className="item-name">{song.name}</span>
          <span className="item-sub">{song.artist_name}</span>
          <span className="item-tags">
            <span className="tag">{decodeHtml(song.tuning_name)}</span>
          </span>
        </div>
        <div className="item-actions">
          {!inSession && (
            <button
              className="btn-ghost"
              onClick={() => setEditOpen(true)}
              title="Edit"
            >
              <PencilSquareIcon className="icon" />
            </button>
          )}
          <button
            className={`btn-ghost btn-chat ${struggling ? "btn-chat--struggling" : ""}`}
            onClick={onOpenChat}
            title="AI chat"
          >
            <ChatBubbleLeftRightIcon className="icon" />
          </button>
          {inSession ? (
            <button
              className="item-elapsed"
              onClick={() => setModalOpen(true)}
              title="Open session"
            >
              {formatElapsed(timerElapsed)}
            </button>
          ) : (
            <>
              <button className="btn-timer" onClick={handleStart} title="Start timer">
                <PlayIcon className="icon" />
              </button>
              <button
                className="btn-timer"
                onClick={() => { onFormOpen(); setModalOpen(true); }}
                title="Log session"
              >
                <PlusIcon className="icon" />
              </button>
              {!isCompletedToday && !isSkippedToday && (
                <button className="btn-ghost btn-skip" onClick={onSkip} title="Skip">
                  <ForwardIcon className="icon" />
                </button>
              )}
            </>
          )}
        </div>
      </div>

      {modalOpen && (
        <SessionModal
          title={song.name}
          subtitle={song.artist_name}
          resources={resources}
          onClose={handleClose}
          onOpenFile={onOpenFile ? handleOpenFile : undefined}
          onGpView={onGpView ? handleGpView : undefined}
        >
          {isFormOpen ? (
            <SongSessionForm
              token={token}
              songId={song.id}
              songBpm={song.bpm}
              songSeconds={song.seconds}
              initialSeconds={timerElapsed}
              initialNotes={notes}
              lastSession={lastSession}
              onSubmit={handleFormSubmit}
              onCancel={handleClose}
            />
          ) : (
            <div className="modal-session-body">
              <div className="modal-elapsed-display">{formatElapsed(timerElapsed)}</div>
              {(song.bpm != null || song.tags.length > 0) && (
                <div className="modal-meta">
                  {song.bpm != null && (
                    <span className="modal-meta-bpm">{song.bpm} bpm</span>
                  )}
                  {song.tags.map((t) => (
                    <span key={t} className="tag">{t}</span>
                  ))}
                </div>
              )}
              {lastSession && (
                <LastSessionInfo session={lastSession} />
              )}
              <label className="form-full modal-notes-label">
                Notes
                <textarea
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  rows={3}
                  placeholder="Notes for this session…"
                />
              </label>
              {sessions.length > 0 && (
                <div className="modal-history">
                  <button
                    className="btn-ghost modal-history-toggle"
                    onClick={() => setShowHistory((v) => !v)}
                  >
                    {showHistory ? "Hide history" : `Rating history (${sessions.length})`}
                  </button>
                  {showHistory && (
                    <RatingTrendChart
                      token={token}
                      entityType="song"
                      entityId={song.id}
                      sessions={sessions}
                    />
                  )}
                </div>
              )}
              <div className="modal-session-controls">
                {isTimerActive ? (
                  <button className="btn-secondary" onClick={onPause}>
                    <PauseIcon className="icon" /> Pause
                  </button>
                ) : (
                  <button className="btn-secondary" onClick={onStart}>
                    <PlayIcon className="icon" /> Resume
                  </button>
                )}
                <button className="btn-primary" onClick={onStopAndSave}>
                  <StopIcon className="icon" /> Stop &amp; Save
                </button>
                <button className="btn-ghost" onClick={handleCancel}>
                  <NoSymbolIcon className="icon" /> Cancel
                </button>
              </div>
            </div>
          )}
        </SessionModal>
      )}
      {editOpen && (
        <SessionModal
          title={`Edit: ${song.name}`}
          onClose={() => setEditOpen(false)}
        >
          <SongEditForm
            token={token}
            song={song}
            currentListId={currentListId}
            onSuccess={(updated) => {
              setEditOpen(false);
              onEntityEdited?.(updated);
            }}
            onCancel={() => setEditOpen(false)}
          />
        </SessionModal>
      )}
    </div>
  );
}
