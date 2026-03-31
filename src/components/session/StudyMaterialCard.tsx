import { useEffect, useState } from "react";
import {
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
import type { DashboardStudyMaterial, Resource } from "../../api/types";

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
  onOpenFile?: (path: string, mediaType: "audio" | "video") => void;
  isChild?: boolean;
  /** When set, play button starts a sequential child session instead of this item's own timer */
  onStartSequential?: () => void;
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
}: SingleCardProps) {
  const inSession = isTimerActive || isTimerPaused;
  const [modalOpen, setModalOpen] = useState(false);
  const [notes, setNotes] = useState("");

  useEffect(() => {
    if (isFormOpen) setModalOpen(true);
  }, [isFormOpen]);

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
  }

  function handleCancel() {
    onCancel();
    setModalOpen(false);
    setNotes("");
  }

  function handleFormSubmit(dpt: number) {
    onSessionSubmit(dpt);
    setModalOpen(false);
    setNotes("");
  }

  const resources: Resource[] = material.url
    ? [{ name: "Open material", url: material.url, type: inferResourceType(material.url) }]
    : [];
  const lastSession = material.meta.sessions?.[0] ?? null;

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
          onOpenFile={onOpenFile}
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
  onOpenFile?: (path: string, mediaType: "audio" | "video") => void;
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
            onOpenFile={onOpenFile}
            isChild
          />
        );
      })}
    </div>
  );
}
