import { useState } from "react";
import { makeItemKey } from "../../lib/itemKey";
import { ItemSessionCard } from "./ItemSessionCard";
import { StudyMaterialSessionForm } from "./forms/StudyMaterialSessionForm";
import { StudyMaterialEditForm } from "./forms/StudyMaterialEditForm";
import { AddChildStudyMaterialForm } from "./forms/AddChildStudyMaterialForm";
import { inferResourceType } from "./forms/shared/inferResourceType";
import type { DashboardStudyMaterial, Resource, StudyMaterialSession } from "../../api/types";

interface SingleCardProps {
  token: string;
  material: DashboardStudyMaterial;
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
  onOpenFile?: (path: string, mediaType: "audio" | "video", itemKey?: string, resources?: Resource[]) => void;
  onGpView?: (path: string) => void;
  isChild?: boolean;
  /** When set, play button starts a sequential child session instead of this item's own timer */
  onStartSequential?: () => void;
  onOpenChat?: () => void;
  isMediaActive?: boolean;
  /** Collapse toggle for parent cards with children */
  childrenCollapsed?: boolean;
  onToggleChildren?: () => void;
  onEntityEdited?: (id: number, name: string, url: string | null, type: string) => void;
  /** Only set for the top-level (non-child) card — enables the "Add child" button. */
  onAddChild?: (child: DashboardStudyMaterial) => void;
}

function StudyMaterialSingleCard({
  token,
  material,
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
  isChild,
  onStartSequential,
  onOpenChat,
  isMediaActive,
  childrenCollapsed,
  onToggleChildren,
  onEntityEdited,
  onAddChild,
}: SingleCardProps) {
  const resources: Resource[] = material.url
    ? [{ name: "Open material", url: material.url, type: inferResourceType(material.url, material.type) }]
    : [];
  const sessions = (material.meta.sessions ?? []) as StudyMaterialSession[];

  return (
    <ItemSessionCard
      token={token}
      name={material.name}
      sequentialItemCount={onStartSequential ? (material.child_study_materials ?? []).length : undefined}
      resources={resources}
      sessions={sessions}
      entityType="study_material"
      entityId={material.id}
      isChild={isChild}
      isCompletedToday={isCompletedToday}
      isSkippedToday={isSkippedToday}
      isTimerActive={isTimerActive}
      isTimerPaused={isTimerPaused}
      timerElapsed={timerElapsed}
      isFormOpen={isFormOpen}
      onStart={onStart}
      onPause={onPause}
      onStopAndSave={onStopAndSave}
      onCancel={onCancel}
      onFormOpen={onFormOpen}
      onFormClose={onFormClose}
      onSessionSubmit={onSessionSubmit}
      onSkip={onSkip}
      onOpenFile={onOpenFile}
      onGpView={onGpView}
      onStartSequential={onStartSequential}
      onOpenChat={onOpenChat}
      isMediaActive={isMediaActive}
      childrenCollapsed={childrenCollapsed}
      onToggleChildren={onToggleChildren}
      editTitle={`Edit: ${material.name}`}
      renderSessionForm={({ initialNotes, timerElapsed, lastSession, onSubmit, onCancel }) => (
        <StudyMaterialSessionForm
          token={token}
          studyMaterialId={material.id}
          initialSeconds={timerElapsed}
          initialNotes={initialNotes}
          lastSession={lastSession}
          onSubmit={onSubmit}
          onCancel={onCancel}
        />
      )}
      renderEditForm={({ onSuccess, onCancel }) => (
        <StudyMaterialEditForm
          token={token}
          material={material}
          onSuccess={(id, name, url, type) => {
            onSuccess();
            onEntityEdited?.(id, name, url, type);
          }}
          onCancel={onCancel}
        />
      )}
      renderAddChildForm={onAddChild ? ({ onSuccess, onCancel }) => (
        <AddChildStudyMaterialForm
          token={token}
          parentStudyMaterialId={material.id}
          onSuccess={(child) => {
            onSuccess();
            onAddChild(child);
          }}
          onCancel={onCancel}
        />
      ) : undefined}
    />
  );
}

export interface StudyMaterialCardProps {
  token: string;
  material: DashboardStudyMaterial;
  getState: (id: number) => {
    isCompletedToday: boolean;
    isSkippedToday: boolean;
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
  onSkip: (id: number) => void;
  onStartSequential?: (parentId: number) => void;
  onOpenFile?: (path: string, mediaType: "audio" | "video", itemKey?: string, resources?: Resource[]) => void;
  onGpView?: (path: string) => void;
  onOpenChat?: (id: number) => void;
  isMediaActive?: boolean;
  onEntityEdited?: (id: number, name: string, url: string | null, type: string) => void;
  onChildAdded?: (parentId: number, child: DashboardStudyMaterial) => void;
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
  onSkip,
  onStartSequential,
  onOpenFile,
  onGpView,
  onOpenChat,
  isMediaActive,
  onEntityEdited,
  onChildAdded,
}: StudyMaterialCardProps) {
  const hasChildren = (material.child_study_materials ?? []).length > 0;
  const [childrenCollapsed, setChildrenCollapsed] = useState(true);
  const state = getState(material.id);

  return (
    <div className="exercise-group">
      <StudyMaterialSingleCard
        token={token}
        material={material}
        isCompletedToday={state.isCompletedToday}
        isSkippedToday={state.isSkippedToday}
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
        onSkip={() => onSkip(material.id)}
        onStartSequential={hasChildren && onStartSequential ? () => onStartSequential(material.id) : undefined}
        onOpenFile={onOpenFile}
        onGpView={onGpView}
        onOpenChat={onOpenChat ? () => onOpenChat(material.id) : undefined}
        isMediaActive={isMediaActive}
        childrenCollapsed={hasChildren ? childrenCollapsed : undefined}
        onToggleChildren={hasChildren ? () => setChildrenCollapsed((v) => !v) : undefined}
        onEntityEdited={onEntityEdited}
        onAddChild={onChildAdded ? (child) => {
          onChildAdded(material.id, child);
          setChildrenCollapsed(false);
        } : undefined}
      />
      {!childrenCollapsed && (material.child_study_materials ?? []).map((child) => {
        const childState = getState(child.id);
        return (
          <StudyMaterialSingleCard
            key={child.id}
            token={token}
            material={child}
            isCompletedToday={childState.isCompletedToday}
            isSkippedToday={childState.isSkippedToday}
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
            onSkip={() => onSkip(child.id)}
            onOpenFile={onOpenFile ? (path, mt, _itemKey, resources) => onOpenFile(path, mt, makeItemKey("studymaterial", child.id), resources) : undefined}
            onGpView={onGpView}
            onOpenChat={onOpenChat ? () => onOpenChat(child.id) : undefined}
            isMediaActive={isMediaActive}
            isChild
            onEntityEdited={onEntityEdited}
          />
        );
      })}
    </div>
  );
}
