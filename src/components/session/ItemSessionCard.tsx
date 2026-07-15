import { useEffect, useRef, useState } from "react";
import {
  ChatBubbleLeftRightIcon,
  CheckIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  ForwardIcon,
  NoSymbolIcon,
  PauseIcon,
  PencilSquareIcon,
  PlayIcon,
  PlusIcon,
  StopIcon,
} from "@heroicons/react/16/solid";
import { SessionModal } from "./SessionModal";
import { LastSessionInfo } from "./LastSessionInfo";
import type { LastSessionData } from "./LastSessionInfo";
import { RatingTrendChart } from "../reports/RatingTrendChart";
import type { ExerciseSession, Resource, SongSession, StudyMaterialSession, StudyRating } from "../../api/types";

export function formatElapsed(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

/** Returns true if the last 3+ sessions are all Awful or Bad */
export function isStruggling(sessions: { rating: StudyRating | null }[]): boolean {
  const rated = sessions.filter((s) => s.rating != null);
  if (rated.length < 3) return false;
  return rated.slice(0, 3).every((s) => s.rating === "Awful" || s.rating === "Bad");
}

type AnySession = SongSession | ExerciseSession | StudyMaterialSession;

interface RenderFormCtx {
  initialNotes: string;
  timerElapsed: number;
  lastSession: LastSessionData | null;
  onSubmit: (dailyPracticeTime: number) => void;
  onCancel: () => void;
}

interface RenderEditCtx {
  /** Call once the edit form has saved successfully, to close the edit modal. */
  onSuccess: () => void;
  onCancel: () => void;
}

export interface ItemSessionCardProps {
  token: string;
  name: string;
  subtitle?: string;
  /** Item-specific tag chips shown next to the name (e.g. exercise flags, song tuning). */
  extraTags?: string[];
  /** When set (and this is not a child card), shows a "N items" tag and swaps the play button for a sequential-session start. */
  sequentialItemCount?: number;
  /** Extra content rendered above the last-session info inside the modal (e.g. bpm/tags row). */
  modalMeta?: React.ReactNode;
  resources: Resource[];
  sessions: AnySession[];
  entityType: "exercise" | "song" | "study_material";
  entityId: number;
  isChild?: boolean;
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
  /** When set, the play button starts a sequential child session instead of this item's own timer. */
  onStartSequential?: () => void;
  onOpenChat?: () => void;
  isMediaActive?: boolean;
  isGpViewerActive?: boolean;
  /** Collapse toggle for parent cards with children. */
  childrenCollapsed?: boolean;
  onToggleChildren?: () => void;
  editTitle: string;
  renderSessionForm: (ctx: RenderFormCtx) => React.ReactNode;
  renderEditForm: (ctx: RenderEditCtx) => React.ReactNode;
}

export function ItemSessionCard({
  token,
  name,
  subtitle,
  extraTags,
  sequentialItemCount,
  modalMeta,
  resources,
  sessions,
  entityType,
  entityId,
  isChild,
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
  onStartSequential,
  onOpenChat,
  isMediaActive,
  isGpViewerActive,
  childrenCollapsed,
  onToggleChildren,
  editTitle,
  renderSessionForm,
  renderEditForm,
}: ItemSessionCardProps) {
  const inSession = isTimerActive || isTimerPaused;
  const [modalOpen, setModalOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [notes, setNotes] = useState("");
  const [showHistory, setShowHistory] = useState(false);
  const mediaWasOpenedRef = useRef(false);

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
    if (onStartSequential) {
      onStartSequential();
    } else {
      onStart();
      setModalOpen(true);
    }
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

  const lastSession = sessions[0] ?? null;
  const struggling = isStruggling(sessions);
  const showSequentialTag = !!onStartSequential && !isChild && sequentialItemCount != null;
  const tags = extraTags ?? [];

  return (
    <div
      className={`item-card ${isChild ? "child-card" : ""} ${isSkippedToday ? "skipped" : isCompletedToday ? "completed" : ""} ${isTimerActive ? "active" : ""}`}
    >
      <div className="item-card-row">
        <span className="item-status">
          {isSkippedToday ? <ForwardIcon className="icon-sm" /> : isCompletedToday ? <CheckIcon className="icon-sm" /> : "○"}
        </span>
        <div className="item-info">
          <span className="item-name">{name}</span>
          {subtitle && <span className="item-sub">{subtitle}</span>}
          {(tags.length > 0 || showSequentialTag) && (
            <span className="item-tags">
              {tags.map((t) => (
                <span key={t} className="tag">{t}</span>
              ))}
              {showSequentialTag && <span className="tag">{sequentialItemCount} items</span>}
            </span>
          )}
        </div>
        <div className="item-actions">
          {onToggleChildren && (
            <button
              className="btn-ghost btn-collapse"
              onClick={onToggleChildren}
              title={childrenCollapsed ? "Expand" : "Collapse"}
            >
              {childrenCollapsed ? <ChevronRightIcon className="icon" /> : <ChevronDownIcon className="icon" />}
            </button>
          )}
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
              <button className="btn-timer" onClick={handleStart} title={onStartSequential ? "Start sequential session" : "Start timer"}>
                <PlayIcon className="icon" />
              </button>
              {!onStartSequential && (
                <button
                  className="btn-timer"
                  onClick={() => { onFormOpen(); setModalOpen(true); }}
                  title="Log session"
                >
                  <PlusIcon className="icon" />
                </button>
              )}
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
          title={name}
          subtitle={subtitle}
          resources={resources}
          onClose={handleClose}
          onOpenFile={onOpenFile ? handleOpenFile : undefined}
          onGpView={onGpView ? handleGpView : undefined}
        >
          {isFormOpen ? (
            renderSessionForm({
              initialNotes: notes,
              timerElapsed,
              lastSession,
              onSubmit: handleFormSubmit,
              onCancel: handleClose,
            })
          ) : (
            <div className="modal-session-body">
              <div className="modal-elapsed-display">{formatElapsed(timerElapsed)}</div>
              {modalMeta}
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
                      entityType={entityType}
                      entityId={entityId}
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
          title={editTitle}
          onClose={() => setEditOpen(false)}
        >
          {renderEditForm({
            onSuccess: () => setEditOpen(false),
            onCancel: () => setEditOpen(false),
          })}
        </SessionModal>
      )}
    </div>
  );
}
