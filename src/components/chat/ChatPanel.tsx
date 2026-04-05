import { useEffect, useRef, useState } from "react";
import { XMarkIcon, PaperAirplaneIcon, KeyIcon } from "@heroicons/react/16/solid";
import type {
  Song,
  DashboardExercise,
  DashboardStudyMaterial,
  SongSession,
  ExerciseSession,
  StudyMaterialSession,
  CatalogExerciseWithActive,
} from "../../api/types";
import { useOpenAIKey } from "../../hooks/useOpenAIKey";

// ─── Types ─────────────────────────────────────────────────────────────────────

type AnySession = SongSession | ExerciseSession | StudyMaterialSession;

export type ChatEntity =
  | { type: "song"; item: Song; sessions: SongSession[] }
  | { type: "exercise"; item: DashboardExercise; sessions: ExerciseSession[] }
  | { type: "study_material"; item: DashboardStudyMaterial; sessions: StudyMaterialSession[] };

interface ChatContext {
  entity: ChatEntity;
  projectSongs: Song[];
  activeExercises: DashboardExercise[];
  activeStudyMaterials: DashboardStudyMaterial[];
  historicalExercises: CatalogExerciseWithActive[];
  toLearnSongs: Song[];
}

interface Message {
  role: "user" | "assistant";
  content: string;
}

// ─── Context builders ──────────────────────────────────────────────────────────

const RATING_VALUES: Record<string, number> = { Awful: 1, Bad: 2, Neutral: 3, Good: 4, Great: 5 };

function recentSessionsSummary(sessions: AnySession[], limit = 10): string {
  const recent = sessions.slice(0, limit);
  if (recent.length === 0) return "  No sessions logged yet.";
  return recent
    .map((s) => {
      const date = new Date(s.created_timestamp).toLocaleDateString();
      const mins = Math.round(s.seconds / 60);
      const parts = [`    ${date} — ${mins}m`];
      if (s.rating) parts.push(`rating: ${s.rating}`);
      if ("bpm" in s && s.bpm) parts.push(`BPM: ${s.bpm}`);
      if ("focus" in s && s.focus) parts.push(`focus: ${s.focus}`);
      if (s.notes) parts.push(`notes: "${s.notes}"`);
      return parts.join(", ");
    })
    .join("\n");
}

function buildSystemPrompt(ctx: ChatContext): string {
  const { entity, projectSongs, activeExercises, activeStudyMaterials, historicalExercises, toLearnSongs } = ctx;

  // ── Entity description ───────────────────────────────────────────────────────
  let entityDesc = "";
  if (entity.type === "song") {
    const s = entity.item;
    entityDesc = `Song: "${s.name}" by ${s.artist_name}`;
    if (s.bpm) entityDesc += `, ${s.bpm} BPM`;
    if (s.tags.length > 0) entityDesc += `\nTags: ${s.tags.join(", ")}`;
  } else if (entity.type === "exercise") {
    entityDesc = `Exercise: "${entity.item.name}"`;
  } else {
    entityDesc = `Study material: "${entity.item.name}"`;
  }

  // ── Session history for this entity ─────────────────────────────────────────
  const recentSessions = recentSessionsSummary(entity.sessions as AnySession[]);
  const ratedSessions = (entity.sessions as AnySession[]).filter((s) => s.rating != null);
  const avgRating = ratedSessions.length > 0
    ? (ratedSessions.reduce((a, s) => a + (RATING_VALUES[s.rating!] ?? 0), 0) / ratedSessions.length).toFixed(1)
    : null;

  const last3 = ratedSessions.slice(0, 3);
  const isStruggling = last3.length >= 3 && last3.every((s) => s.rating === "Awful" || s.rating === "Bad");

  // ── Project songs ────────────────────────────────────────────────────────────
  const projectSongsDesc = projectSongs.length > 0
    ? projectSongs.map((s) => {
        const tags = s.tags.length > 0 ? ` [${s.tags.join(", ")}]` : "";
        return `  - "${s.name}" by ${s.artist_name}${tags}`;
      }).join("\n")
    : "  None";

  // ── Active exercises ─────────────────────────────────────────────────────────
  const allExercises = [
    ...activeExercises.map((e) => ({ name: e.name, active: true })),
    ...historicalExercises.filter((e) => !e.active).map((e) => ({ name: e.name, active: false })),
  ];
  const exercisesDesc = allExercises.length > 0
    ? allExercises.map((e) => `  - "${e.name}"${e.active ? "" : " (inactive)"}`).join("\n")
    : "  None";

  // ── Active study materials ───────────────────────────────────────────────────
  const studyMaterialsDesc = activeStudyMaterials.length > 0
    ? activeStudyMaterials.map((m) => `  - "${m.name}"`).join("\n")
    : "  None";

  // ── To Learn list ────────────────────────────────────────────────────────────
  const toLearnDesc = toLearnSongs.length > 0
    ? toLearnSongs.map((s) => {
        const tags = s.tags.length > 0 ? ` [${s.tags.join(", ")}]` : "";
        return `  - "${s.name}" by ${s.artist_name}${tags}`;
      }).join("\n")
    : "  None";

  return `You are a focused guitar practice assistant. Your ONLY role is to help the user improve at the specific item they are practicing. Do not engage with any off-topic requests — if asked something unrelated to this item, their practice data, or guitar/music in general, politely redirect.

## Current item
${entityDesc}

## Recent session history
${recentSessions}
${avgRating ? `Average rating: ${avgRating}/5` : ""}
${isStruggling ? "⚠️ The user has rated this Awful or Bad in their last 3+ sessions — they are struggling." : ""}

## User's current project songs
${projectSongsDesc}

## User's exercises (active + inactive catalog)
${exercisesDesc}

## User's study materials
${studyMaterialsDesc}

## User's To Learn list
${toLearnDesc}

Use this context to give targeted, specific advice. Reference the user's actual exercises and study materials when relevant. If suggesting adjacent songs, draw from the To Learn list and project songs.`;
}

// ─── Key setup modal ───────────────────────────────────────────────────────────

function KeySetupModal({ onSave, onCancel }: { onSave: (key: string) => void; onCancel: () => void }) {
  const [value, setValue] = useState("");

  return (
    <div className="chat-key-setup">
      <KeyIcon style={{ width: 24, height: 24, color: "var(--text-dim)", marginBottom: 8 }} />
      <p className="chat-key-setup-title">OpenAI API key required</p>
      <p className="chat-key-setup-desc">
        The AI chat uses the OpenAI API. Your key is stored locally on this device.
      </p>
      <input
        type="password"
        className="chat-key-input"
        placeholder="sk-..."
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => { if (e.key === "Enter" && value.trim()) onSave(value.trim()); }}
        autoFocus
      />
      <div className="chat-key-actions">
        <button className="btn-ghost" onClick={onCancel}>Cancel</button>
        <button
          className="btn-primary"
          disabled={!value.trim()}
          onClick={() => onSave(value.trim())}
        >
          Save key
        </button>
      </div>
    </div>
  );
}

// ─── Token tracker ────────────────────────────────────────────────────────────

const TOKEN_TRACKER = "https://token-tracker-roan.vercel.app/api/tokens";
const DAILY_LIMIT = 250_000;

async function getTokensUsed(): Promise<number> {
  const res = await fetch(TOKEN_TRACKER);
  const { tokens } = await res.json();
  return tokens as number;
}

async function reportTokens(count: number): Promise<void> {
  await fetch(TOKEN_TRACKER, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ tokens: count }),
  });
}

// ─── ChatPanel ────────────────────────────────────────────────────────────────

interface Props {
  context: ChatContext;
  onClose: () => void;
}

export function ChatPanel({ context, onClose }: Props) {
  const { apiKey, loaded, saveKey } = useOpenAIKey();
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showKeySetup, setShowKeySetup] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // Show key setup if key not loaded yet
  useEffect(() => {
    if (loaded && !apiKey) setShowKeySetup(true);
  }, [loaded, apiKey]);

  // Scroll to bottom on new messages
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const entityName =
    context.entity.type === "song"
      ? context.entity.item.name
      : context.entity.type === "exercise"
      ? context.entity.item.name
      : context.entity.item.name;

  async function sendMessage() {
    if (!input.trim() || !apiKey) return;
    const userMessage: Message = { role: "user", content: input.trim() };
    const updatedMessages = [...messages, userMessage];
    setMessages(updatedMessages);
    setInput("");
    setSending(true);
    setError(null);

    try {
      // Check daily token budget (fail open if tracker unreachable)
      try {
        const used = await getTokensUsed();
        if (used >= DAILY_LIMIT) {
          setError(`Daily token limit reached (${used.toLocaleString()} / ${DAILY_LIMIT.toLocaleString()}). Try again tomorrow.`);
          setSending(false);
          return;
        }
      } catch {
        // Tracker unreachable — proceed
      }

      const response = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: "gpt-4o-mini",
          messages: [
            { role: "system", content: buildSystemPrompt(context) },
            ...updatedMessages,
          ],
          max_tokens: 600,
          temperature: 0.5,
        }),
      });

      if (!response.ok) {
        const body = await response.text().catch(() => "");
        if (response.status === 401) {
          setError("Invalid API key. Click the key icon to update it.");
        } else {
          setError(`OpenAI error ${response.status}: ${body.slice(0, 120)}`);
        }
        setSending(false);
        return;
      }

      const data = await response.json();
      const assistantContent: string = data.choices?.[0]?.message?.content ?? "";
      setMessages((prev) => [...prev, { role: "assistant", content: assistantContent }]);

      // Report tokens used (fail silently)
      const tokensUsed: number =
        (data.usage?.prompt_tokens ?? 0) + (data.usage?.completion_tokens ?? 0);
      if (tokensUsed > 0) {
        reportTokens(tokensUsed).catch(() => { /* non-critical */ });
      }
    } catch {
      setError("Failed to reach OpenAI. Check your network connection.");
    } finally {
      setSending(false);
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  }

  return (
    <div className="chat-panel-backdrop" onClick={onClose}>
      <div className="chat-panel" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="chat-panel-header">
          <div className="chat-panel-title-group">
            <span className="chat-panel-title">Chat</span>
            <span className="chat-panel-subtitle">{entityName}</span>
          </div>
          <div className="chat-panel-header-actions">
            <button
              className="btn-ghost"
              title="Update API key"
              onClick={() => setShowKeySetup(true)}
            >
              <KeyIcon className="icon" />
            </button>
            <button className="btn-ghost" onClick={onClose} title="Close">
              <XMarkIcon />
            </button>
          </div>
        </div>

        {/* Key setup overlay */}
        {showKeySetup && (
          <KeySetupModal
            onSave={async (key) => {
              await saveKey(key);
              setShowKeySetup(false);
              inputRef.current?.focus();
            }}
            onCancel={() => setShowKeySetup(false)}
          />
        )}

        {/* Messages */}
        {!showKeySetup && (
          <>
            <div className="chat-messages">
              {messages.length === 0 && (
                <div className="chat-empty">Ask anything about this item — technique tips, BPM strategy, what to work on next.</div>
              )}
              {messages.map((m, i) => (
                <div key={i} className={`chat-message chat-message--${m.role}`}>
                  <div className="chat-message-content">{m.content}</div>
                </div>
              ))}
              {sending && (
                <div className="chat-message chat-message--assistant">
                  <div className="chat-typing">
                    <span />
                    <span />
                    <span />
                  </div>
                </div>
              )}
              {error && <div className="chat-error">{error}</div>}
              <div ref={bottomRef} />
            </div>

            {/* Input */}
            <div className="chat-input-row">
              <textarea
                ref={inputRef}
                className="chat-input"
                rows={2}
                placeholder="Ask a question…"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                disabled={sending || !apiKey}
                autoFocus
              />
              <button
                className="btn-primary chat-send"
                onClick={sendMessage}
                disabled={sending || !input.trim() || !apiKey}
                title="Send (Enter)"
              >
                <PaperAirplaneIcon className="icon" />
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
