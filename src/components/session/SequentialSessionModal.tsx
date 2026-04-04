import { useState } from "react";
import {
  ArrowLeftIcon,
  NoSymbolIcon,
  PauseIcon,
  PlayIcon,
  StopIcon,
} from "@heroicons/react/16/solid";
import { ExerciseSessionForm } from "./forms/ExerciseSessionForm";
import { StudyMaterialSessionForm } from "./forms/StudyMaterialSessionForm";
import { LastSessionInfo } from "./LastSessionInfo";
import { SessionModal } from "./SessionModal";
import type { LastSessionData } from "./LastSessionInfo";
import type { Resource } from "../../api/types";

function formatElapsed(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

export interface SequentialChild {
  id: number;
  name: string;
  resources: Resource[];
  lastSession: LastSessionData | null;
}

interface Props {
  token: string;
  type: "exercise" | "study_material";
  parentName: string;
  children: SequentialChild[];
  currentIndex: number;
  isTimerActive: boolean;
  timerElapsed: number;
  isFormOpen: boolean;
  onStart: () => void;
  onPause: () => void;
  onStopAndSave: () => void;
  onSessionSubmit: (dailyPracticeTime: number) => void;
  onFormClose: () => void;
  onCancelReturn: () => void;
  onOpenFile?: (path: string, mediaType: "audio" | "video", itemKey?: string) => void;
}

export function SequentialSessionModal({
  token,
  type,
  parentName,
  children,
  currentIndex,
  isTimerActive,
  timerElapsed,
  isFormOpen,
  onStart,
  onPause,
  onStopAndSave,
  onSessionSubmit,
  onFormClose,
  onCancelReturn,
  onOpenFile,
}: Props) {
  const [notes, setNotes] = useState("");

  const current = children[currentIndex];
  const total = children.length;
  const subtitle = `${parentName} · ${currentIndex + 1} of ${total}`;

  function handleFormSubmit(dpt: number) {
    onSessionSubmit(dpt);
    setNotes("");
  }

  return (
    <SessionModal
      title={current.name}
      subtitle={subtitle}
      resources={current.resources}
      onClose={onCancelReturn}
      onOpenFile={onOpenFile}
    >
      {isFormOpen ? (
        <div className="sequential-form-wrapper">
          {type === "exercise" ? (
            <ExerciseSessionForm
              token={token}
              exerciseId={current.id}
              initialSeconds={timerElapsed}
              initialNotes={notes}
              lastSession={current.lastSession}
              onSubmit={handleFormSubmit}
              onCancel={onFormClose}
            />
          ) : (
            <StudyMaterialSessionForm
              token={token}
              studyMaterialId={current.id}
              initialSeconds={timerElapsed}
              initialNotes={notes}
              lastSession={current.lastSession}
              onSubmit={handleFormSubmit}
              onCancel={onFormClose}
            />
          )}
          <div className="sequential-cancel-return-row">
            <button className="btn-ghost" onClick={onCancelReturn}>
              <ArrowLeftIcon className="icon" /> Cancel &amp; Return
            </button>
          </div>
        </div>
      ) : (
        <div className="modal-session-body">
          <div className="modal-elapsed-display">{formatElapsed(timerElapsed)}</div>
          {current.lastSession && (
            <LastSessionInfo session={current.lastSession} />
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
            <button className="btn-ghost" onClick={onCancelReturn}>
              <NoSymbolIcon className="icon" /> Cancel &amp; Return
            </button>
          </div>
        </div>
      )}
    </SessionModal>
  );
}
