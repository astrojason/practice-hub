import { useEffect, useRef, useState } from "react";
import {
  BookmarkIcon,
  BookmarkSlashIcon,
  ChatBubbleLeftRightIcon,
  CheckIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  FolderPlusIcon,
  ForwardIcon,
  MusicalNoteIcon,
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
import { formatPracticeDuration, getStreakStatus, getUsageStalenessLevel, totalSessionSecondsToday } from "../../lib/itemUsage";
import { useStreakTokens } from "./StreakTokenContext";
import { ErrorModal } from "../ErrorModal";
import type { ExerciseSession, Resource, SongSession, StudyMaterialSession } from "../../api/types";

function formatElapsed(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

const STRUGGLING_ASPECTS = ["rhythm_rating", "lead_rating", "singing_rating"] as const;

// A single day of practice isn't a "streak" — only show the badge once
// there's an actual consecutive run to brag about.
const STREAK_DISPLAY_THRESHOLD = 2;

/** Returns true if, for songs, any aspect's last 3+ rated sessions are all Awful/Bad;
 * for exercises/study materials, if the last 3+ sessions overall are all Awful/Bad. */
function isStruggling(
  sessions: AnySession[],
  entityType: "exercise" | "song" | "study_material",
): boolean {
  if (entityType === "song") {
    const songSessions = sessions as SongSession[];
    return STRUGGLING_ASPECTS.some((key) => {
      const rated = songSessions.filter((s) => s[key] != null);
      return rated.length >= 3 && rated.slice(0, 3).every((s) => s[key] === "Awful" || s[key] === "Bad");
    });
  }
  const rated = (sessions as (ExerciseSession | StudyMaterialSession)[]).filter((s) => s.rating != null);
  if (rated.length < 3) return false;
  return rated.slice(0, 3).every((s) => s.rating === "Awful" || s.rating === "Bad");
}

type AnySession = SongSession | ExerciseSession | StudyMaterialSession;

interface RenderFormCtx {
  initialNotes: string;
  timerElapsed: number;
  lastSession: LastSessionData | null;
  onSubmit: (dailyPracticeTime: number, newSession?: ExerciseSession | StudyMaterialSession) => void;
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
  /** When set, enables the orange/red "hasn't been practiced recently" highlight for this item. */
  itemCreatedTimestamp?: number;
  /**
   * Sessions considered for the staleness check, in place of `sessions`.
   * For a parent card with children, pass `sessions` merged with every
   * child's sessions — practicing a child counts as practicing the group,
   * so the parent shouldn't show stale just because it has no sessions of
   * its own. Defaults to `sessions` (correct for childless items and for
   * child cards themselves).
   */
  usageSessions?: AnySession[];
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
  onSessionSubmit: (dailyPracticeTime: number, newSession?: ExerciseSession | StudyMaterialSession) => void;
  onSkip: () => void;
  onOpenFile?: (path: string, mediaType: "audio" | "video", itemKey?: string, resources?: Resource[]) => void;
  onGpView?: (path: string) => void;
  /** When set, the play button starts a sequential child session instead of this item's own timer. */
  onStartSequential?: () => void;
  onOpenChat?: () => void;
  isMediaActive?: boolean;
  /** Collapse toggle for parent cards with children. */
  childrenCollapsed?: boolean;
  onToggleChildren?: () => void;
  editTitle: string;
  renderSessionForm: (ctx: RenderFormCtx) => React.ReactNode;
  renderEditForm: (ctx: RenderEditCtx) => React.ReactNode;
  /** When set (only for top-level, non-child cards), shows an "Add child" button that opens this form. */
  renderAddChildForm?: (ctx: RenderEditCtx) => React.ReactNode;
  /** Whether this item is currently in the user's active exercise/study-material list. */
  isInUserList?: boolean;
  /** When set, shows a bookmark button that adds/removes this item from the user's active list. */
  onToggleUserList?: () => void;
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
  itemCreatedTimestamp,
  usageSessions,
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
  childrenCollapsed,
  onToggleChildren,
  editTitle,
  renderSessionForm,
  renderEditForm,
  renderAddChildForm,
  isInUserList,
  onToggleUserList,
}: ItemSessionCardProps) {
  const inSession = isTimerActive || isTimerPaused;
  const [modalOpen, setModalOpen] = useState(false);
  // Set when the modal was opened via "Edit regions" rather than Start/Log
  // session — shows just the resource list (no timer, no log-session form,
  // no session-completion side effects), so a resource's loop regions/bpm
  // can be edited without practicing it.
  const [resourcesOnly, setResourcesOnly] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [addChildOpen, setAddChildOpen] = useState(false);
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

  function handleOpenFile(path: string, mediaType: "audio" | "video", itemKey?: string, resources?: Resource[]) {
    mediaWasOpenedRef.current = true;
    onOpenFile!(path, mediaType, itemKey, resources);
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
    setResourcesOnly(false);
    setShowHistory(false);
  }

  function handleCancel() {
    onCancel();
    setModalOpen(false);
    setNotes("");
    setShowHistory(false);
  }

  function handleFormSubmit(dpt: number, newSession?: ExerciseSession | StudyMaterialSession) {
    onSessionSubmit(dpt, newSession);
    setModalOpen(false);
    setNotes("");
    setShowHistory(false);
  }

  const lastSession = sessions[0] ?? null;
  const struggling = isStruggling(sessions, entityType);
  const usageStaleness = itemCreatedTimestamp != null ? getUsageStalenessLevel(itemCreatedTimestamp, usageSessions ?? sessions) : "none";
  // Tokens only apply to exercises and study materials (the backend has no
  // song support), so songs get the plain streak without token UI.
  const tokensEnabled = entityType !== "song";
  const { uses: allTokenUses, spend: spendStreakToken } = useStreakTokens();
  const tokenUses = tokensEnabled ? allTokenUses.filter((u) => u.item_type === entityType && u.item_id === entityId) : [];
  const { streak: liveStreak, tokenBalance, openGap } = getStreakStatus(usageSessions ?? sessions, tokenUses);
  // While a two-day gap awaits a token decision the live streak reads 0, but
  // the badge should keep showing what's at stake.
  const streak = openGap ? openGap.streakAtRisk : liveStreak;
  const showStreakTag = streak >= STREAK_DISPLAY_THRESHOLD;
  const [spendingToken, setSpendingToken] = useState(false);
  const [tokenError, setTokenError] = useState<string | null>(null);
  async function handleUseToken() {
    if (!openGap || entityType === "song") return;
    setSpendingToken(true);
    try {
      await spendStreakToken(entityType, entityId, openGap.from, openGap.to);
    } catch (err) {
      setTokenError(err instanceof Error ? err.message : String(err));
    } finally {
      setSpendingToken(false);
    }
  }

  // Flash the badge for a beat whenever the streak grows, rather than on
  // every render (e.g. mount, or an unrelated prop change).
  const prevStreakRef = useRef<number | null>(null);
  const [streakBumped, setStreakBumped] = useState(false);
  useEffect(() => {
    const prev = prevStreakRef.current;
    prevStreakRef.current = streak;
    if (prev !== null && streak > prev) {
      setStreakBumped(true);
      const timer = setTimeout(() => setStreakBumped(false), 700);
      return () => clearTimeout(timer);
    }
  }, [streak]);
  // Parents with children: time practiced today across the item and every
  // child (usageSessions is the de-duplicated merge of all of them). Hidden
  // when nothing was practiced today.
  const totalPracticeSeconds = totalSessionSecondsToday(usageSessions ?? sessions);
  const showTotalTime = !isChild && !!onToggleChildren && totalPracticeSeconds > 0;
  const showSequentialTag = !!onStartSequential && !isChild && sequentialItemCount != null;
  const tags = extraTags ?? [];
  const userListNoun = entityType === "exercise" ? "exercises" : "study materials";
  const toggleUserListTitle = isInUserList ? `Remove from my ${userListNoun}` : `Add to my ${userListNoun}`;

  return (
    <>
    {tokenError && <ErrorModal error={tokenError} onDismiss={() => setTokenError(null)} />}
    <div
      className={`item-card ${isChild ? "child-card" : ""} ${isSkippedToday ? "skipped" : isCompletedToday ? "completed" : ""} ${isTimerActive ? "active" : ""} ${usageStaleness !== "none" ? `stale-${usageStaleness}` : ""}`}
    >
      <div className="item-card-row">
        <span className="item-status">
          {isSkippedToday ? <ForwardIcon className="icon-sm" /> : isCompletedToday ? <CheckIcon className="icon-sm" /> : "○"}
        </span>
        <div className="item-info">
          <span className="item-name">{name}</span>
          {subtitle && <span className="item-sub">{subtitle}</span>}
          {(tags.length > 0 || showSequentialTag || showStreakTag || showTotalTime || openGap) && (
            <span className="item-tags">
              {showStreakTag && (
                <span className={`tag tag-streak ${streakBumped ? "tag-streak--bump" : ""}`}>🔥 {streak}
                  {tokensEnabled && tokenBalance > 0 && (
                    <span className="streak-token" title={`${tokenBalance} streak token${tokenBalance === 1 ? "" : "s"} banked`}>
                      {" "}🛡️ {tokenBalance}
                    </span>
                  )}
                </span>
              )}
              {openGap && (
                <button
                  className="tag tag-streak-use-token"
                  onClick={handleUseToken}
                  disabled={spendingToken}
                  title="You missed two days — spend a token to keep this streak alive"
                >
                  Use streak token
                </button>
              )}
              {tags.map((t) => (
                <span key={t} className="tag">{t}</span>
              ))}
              {showSequentialTag && <span className="tag">{sequentialItemCount} items</span>}
              {showTotalTime && (
                <span className="tag tag-total-time" title="Practiced today across this item and its children">
                  ⏱ {formatPracticeDuration(totalPracticeSeconds)}
                </span>
              )}
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
          {!inSession && renderAddChildForm && (
            <button
              className="btn-ghost"
              onClick={() => setAddChildOpen(true)}
              title="Add child"
            >
              <FolderPlusIcon className="icon" />
            </button>
          )}
          {!inSession && onToggleUserList && (
            <button
              className="btn-ghost"
              onClick={onToggleUserList}
              title={toggleUserListTitle}
            >
              {isInUserList ? <BookmarkIcon className="icon" /> : <BookmarkSlashIcon className="icon" />}
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
          {!inSession && onOpenFile && resources.length > 0 && (
            <button
              className="btn-ghost"
              onClick={() => { setResourcesOnly(true); setModalOpen(true); }}
              title="Edit regions"
            >
              <MusicalNoteIcon className="icon" />
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
          onGpView={onGpView}
          // Without this, SessionModal falls back to onClose when media
          // opens — a full close that also resets resourcesOnly (and, for
          // an in-progress log-session form, its notes). This just hides
          // the modal; the mediaWasOpenedRef effect below reopens it as-is
          // once the media player closes.
          onMediaOpen={() => setModalOpen(false)}
        >
          {resourcesOnly ? (
            <p className="modal-resources-only-hint">
              Select a resource above to open it and edit its loop regions and bpm.
            </p>
          ) : isFormOpen ? (
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

      {addChildOpen && renderAddChildForm && (
        <SessionModal
          title={`Add child: ${name}`}
          onClose={() => setAddChildOpen(false)}
        >
          {renderAddChildForm({
            onSuccess: () => setAddChildOpen(false),
            onCancel: () => setAddChildOpen(false),
          })}
        </SessionModal>
      )}
    </div>
    </>
  );
}
