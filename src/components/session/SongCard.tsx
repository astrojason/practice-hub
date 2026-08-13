import { ItemSessionCard } from "./ItemSessionCard";
import { SongSessionForm } from "./forms/SongSessionForm";
import { SongEditForm } from "./forms/SongEditForm";
import type { Song, SongSession } from "../../api/types";

function decodeHtml(html: string): string {
  const ta = document.createElement("textarea");
  ta.innerHTML = html;
  return ta.value;
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
  onGpView?: (path: string) => void;
  onOpenChat?: () => void;
  isMediaActive?: boolean;
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
  onEntityEdited,
}: Props) {
  const resources = (song.resources ?? []).map((r) => ({ name: r.name, url: r.url, type: r.type }));
  const sessions = (song.meta.sessions ?? []) as SongSession[];

  return (
    <ItemSessionCard
      token={token}
      name={song.name}
      subtitle={song.artist_name}
      extraTags={[decodeHtml(song.tuning_name)]}
      modalMeta={(song.bpm != null || song.tags.length > 0) ? (
        <div className="modal-meta">
          {song.bpm != null && (
            <span className="modal-meta-bpm">{song.bpm} bpm</span>
          )}
          {song.tags.map((t) => (
            <span key={t} className="tag">{t}</span>
          ))}
        </div>
      ) : undefined}
      resources={resources}
      sessions={sessions}
      entityType="song"
      entityId={song.id}
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
      onOpenChat={onOpenChat}
      isMediaActive={isMediaActive}
      editTitle={`Edit: ${song.name}`}
      renderSessionForm={({ initialNotes, timerElapsed, lastSession, onSubmit, onCancel }) => (
        <SongSessionForm
          token={token}
          songId={song.id}
          songBpm={song.bpm}
          songSeconds={song.seconds}
          songHasLead={song.has_lead}
          songHasSinging={song.has_singing}
          initialSeconds={timerElapsed}
          initialNotes={initialNotes}
          lastSession={lastSession}
          onSubmit={onSubmit}
          onCancel={onCancel}
        />
      )}
      renderEditForm={({ onSuccess, onCancel }) => (
        <SongEditForm
          token={token}
          song={song}
          currentListId={currentListId}
          onSuccess={(updated) => {
            onSuccess();
            onEntityEdited?.(updated);
          }}
          onCancel={onCancel}
        />
      )}
    />
  );
}
