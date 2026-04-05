import { useEffect, useRef, useState } from "react";
import {
  ChatBubbleLeftRightIcon,
  CheckIcon,
  NoSymbolIcon,
  PauseIcon,
  PlayIcon,
  PlusIcon,
  StopIcon,
} from "@heroicons/react/16/solid";
import { StudyMaterialSessionForm } from "./forms/StudyMaterialSessionForm";
import { SessionModal } from "./SessionModal";
import { LastSessionInfo } from "./LastSessionInfo";
import { RatingTrendChart } from "../reports/RatingTrendChart";
import type { DashboardStudyMaterial, Resource, StudyMaterialSession } from "../../api/types";

function inferResourceType(url: string): Resource["type"] {
  if (url.startsWith("/") || /^[A-Za-z]:\\/.test(url)) return "local_file";
  if (url.includes("youtube.com") || url.includes("youtu.be")) return "youtube";
  return "url";
}

function formatElapsed(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

/** Returns true if the last 3+ sessions are all Awful or Bad */
function isStruggling(sessions: StudyMaterialSession[]): boolean {
  const rated = sessions.filter((s) => s.rating != null);
  if (rated.length < 3) return false;
  return rated.slice(0, 3).every((s) => s.rating === "Awful" || s.rating === "Bad");
}

interface SingleCardProps {
  token: string;
  material: DashboardStudyMaterial;
  isCompletedToday: boolean;
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
  onOpenFile?: (path: string, mediaType: "audio" | "video", itemKey?: string) => void;
  isChild?: boolean;
  /** When set, play button starts a sequential child session instead of this item's own timer */
  onStartSequential?: () => void;
  onOpenChat?: () => void;
  isMediaActive?: boolean;
}

function StudyMaterialSingleCard({
  token,
  material,
  isCompletedToday,
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
  onOpenFile,
  isChild,
  onStartSequential,
  onOpenChat,
  isMediaActive,
}: SingleCardProps) {
  const inSession = isTimerActive || isTimerPaused;
  const [modalOpen, setModalOpen] = useState(false);
  const [notes, setNotes] = useState("");
  const [showHistory, setShowHistory] = useState(false);
  const mediaWasOpenedRef = useRef(false);

  useEffect(() => {
    if (isFormOpen) setModalOpen(true);
  }, [isFormOpen]);

  useEffect(() => {
    if (!(isMediaActive ?? false) && mediaWasOpenedRef.current) {
      setModalOpen(true);
      mediaWasOpenedRef.current = false;
    }
  }, [isMediaActive]);

  function handleOpenFile(path: string, mediaType: "audio" | "video", itemKey?: string) {
    mediaWasOpenedRef.current = true;
    onOpenFile!(path, mediaType, itemKey);
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

  const resources: Resource[] = material.url
    ? [{ name: "Open material", url: material.url, type: inferResourceType(material.url) }]
    : [];
  const sessions = (material.meta.sessions ?? []) as StudyMaterialSession[];
  const lastSession = sessions[0] ?? null;
  const struggling = isStruggling(sessions);

  return (
    <div
      className={`item-card ${isChild ? "child-card" : ""} ${isCompletedToday ? "completed" : ""} ${isTimerActive ? "active" : ""}`}
    >
      <div className="item-card-row">
        <span className="item-status">
          {isCompletedToday ? <CheckIcon className="icon-sm" /> : "○"}
        </span>
        <div className="item-info">
          <span className="item-name">{material.name}</span>
          {onStartSequential && !isChild && (
            <span className="item-tags">
              <span className="tag">{(material.child_study_materials ?? []).length} items</span>
            </span>
          )}
        </div>
        <div className="item-actions">
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
            </>
          )}
        </div>
      </div>

      {modalOpen && (
        <SessionModal
          title={material.name}
          resources={resources}
          onClose={handleClose}
          onOpenFile={onOpenFile ? handleOpenFile : undefined}
        >
          {isFormOpen ? (
            <StudyMaterialSessionForm
              token={token}
              studyMaterialId={material.id}
              initialSeconds={timerElapsed}
              initialNotes={notes}
              lastSession={lastSession}
              onSubmit={handleFormSubmit}
              onCancel={handleClose}
            />
          ) : (
            <div className="modal-session-body">
              <div className="modal-elapsed-display">{formatElapsed(timerElapsed)}</div>
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
                      entityType="study_material"
                      entityId={material.id}
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
    </div>
  );
}

export interface StudyMaterialCardProps {
  token: string;
  material: DashboardStudyMaterial;
  getState: (id: number) => {
    isCompletedToday: boolean;
    isTimerActive: boolean;
    isTimerPaused: boolean;
    timerElapsed: number;
    isFormOpen: boolean;
  };
  onStart: (id: number) => void;
  onPause: (id: number) => void;
  onStopAndSave: (id: number) => void;
  onCancel: (id: number) => void;
  onFormOpen: (id: number) => void;
  onFormClose: (id: number) => void;
  onSessionSubmit: (id: number, dailyPracticeTime: number) => void;
  onStartSequential?: (parentId: number) => void;
  onOpenFile?: (path: string, mediaType: "audio" | "video", itemKey?: string) => void;
  onOpenChat?: (id: number) => void;
  isMediaActive?: boolean;
}

export function StudyMaterialCard({
  token,
  material,
  getState,
  onStart,
  onPause,
  onStopAndSave,
  onCancel,
  onFormOpen,
  onFormClose,
  onSessionSubmit,
  onStartSequential,
  onOpenFile,
  onOpenChat,
  isMediaActive,
}: StudyMaterialCardProps) {
  const hasChildren = (material.child_study_materials ?? []).length > 0;
  const state = getState(material.id);

  return (
    <div className={hasChildren ? "exercise-group" : undefined}>
      <StudyMaterialSingleCard
        token={token}
        material={material}
        isCompletedToday={state.isCompletedToday}
        isTimerActive={state.isTimerActive}
        isTimerPaused={state.isTimerPaused}
        timerElapsed={state.timerElapsed}
        isFormOpen={state.isFormOpen}
        onStart={() => onStart(material.id)}
        onPause={() => onPause(material.id)}
        onStopAndSave={() => onStopAndSave(material.id)}
        onCancel={() => onCancel(material.id)}
        onFormOpen={() => onFormOpen(material.id)}
        onFormClose={() => onFormClose(material.id)}
        onSessionSubmit={(dpt) => onSessionSubmit(material.id, dpt)}
        onStartSequential={hasChildren && onStartSequential ? () => onStartSequential(material.id) : undefined}
        onOpenFile={onOpenFile}
        onOpenChat={onOpenChat ? () => onOpenChat(material.id) : undefined}
        isMediaActive={isMediaActive}
      />
      {(material.child_study_materials ?? []).map((child) => {
        const childState = getState(child.id);
        return (
          <StudyMaterialSingleCard
            key={child.id}
            token={token}
            material={child}
            isCompletedToday={childState.isCompletedToday}
            isTimerActive={childState.isTimerActive}
            isTimerPaused={childState.isTimerPaused}
            timerElapsed={childState.timerElapsed}
            isFormOpen={childState.isFormOpen}
            onStart={() => onStart(child.id)}
            onPause={() => onPause(child.id)}
            onStopAndSave={() => onStopAndSave(child.id)}
            onCancel={() => onCancel(child.id)}
            onFormOpen={() => onFormOpen(child.id)}
            onFormClose={() => onFormClose(child.id)}
            onSessionSubmit={(dpt) => onSessionSubmit(child.id, dpt)}
            onOpenFile={onOpenFile ? (path, mt) => onOpenFile(path, mt, `studymaterial-${child.id}`) : undefined}
            onOpenChat={onOpenChat ? () => onOpenChat(child.id) : undefined}
            isMediaActive={isMediaActive}
            isChild
          />
        );
      })}
    </div>
  );
}
