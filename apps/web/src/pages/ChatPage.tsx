import { useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import {
  ApiError,
  closeChatSession,
  listChatMessages,
  listChatSessions,
  sendChatMessage,
} from "../lib/apiClient";
import type { ChatMessage, ChatSession } from "../lib/apiClient";
import { useTenant } from "../lib/tenant";

// Live agent chat console. The left rail lists sessions (open first); selecting
// one opens the conversation, which polls for new messages via the `since`
// delta so an agent sees visitor replies without refreshing.
export default function ChatPage() {
  const { tenantId } = useTenant();
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [filter, setFilter] = useState<"open" | "closed" | "all">("open");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [reply, setReply] = useState("");
  const [error, setError] = useState<string | null>(null);
  const lastAtRef = useRef<string | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  const selected = sessions.find((s) => s.id === selectedId) ?? null;

  const loadSessions = () => {
    if (!tenantId) return;
    listChatSessions(tenantId, filter === "all" ? undefined : filter)
      .then(setSessions)
      .catch((err) => setError(err instanceof ApiError ? err.message : "Failed to load chat sessions"));
  };

  // Refresh the session list on tenant/filter change and on a slow poll.
  useEffect(() => {
    if (!tenantId) return;
    loadSessions();
    const handle = setInterval(loadSessions, 5000);
    return () => clearInterval(handle);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tenantId, filter]);

  // When a session is selected, load its full history, then poll for deltas.
  useEffect(() => {
    if (!tenantId || !selectedId) {
      setMessages([]);
      lastAtRef.current = null;
      return;
    }
    let active = true;
    setMessages([]);
    lastAtRef.current = null;

    const poll = () => {
      if (!active) return;
      listChatMessages(tenantId, selectedId, lastAtRef.current ?? undefined)
        .then((batch) => {
          if (!active || batch.length === 0) return;
          setMessages((prev) => {
            const seen = new Set(prev.map((m) => m.id));
            const merged = [...prev, ...batch.filter((m) => !seen.has(m.id))];
            return merged;
          });
          lastAtRef.current = batch[batch.length - 1].created_at;
        })
        .catch(() => {
          /* transient poll error; next tick retries */
        });
    };

    poll();
    const handle = setInterval(poll, 2000);
    return () => {
      active = false;
      clearInterval(handle);
    };
  }, [tenantId, selectedId]);

  // Keep the transcript pinned to the newest message.
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [messages]);

  const handleSend = async (event: FormEvent) => {
    event.preventDefault();
    if (!tenantId || !selectedId || !reply.trim()) return;
    const body = reply.trim();
    setReply("");
    try {
      await sendChatMessage(tenantId, selectedId, { authorType: "agent", body });
      // The poll picks up the inserted message; nudge the list so status/order refresh.
      loadSessions();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to send message");
      setReply(body);
    }
  };

  const handleClose = async () => {
    if (!tenantId || !selectedId) return;
    try {
      await closeChatSession(tenantId, selectedId);
      loadSessions();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to close the chat");
    }
  };

  if (!tenantId) {
    return <p className="hint">Set a tenant id above to open the chat console.</p>;
  }

  return (
    <div>
      <div className="page-header">
        <h2>Chat</h2>
        <span className="hint">{sessions.length} session{sessions.length === 1 ? "" : "s"}</span>
      </div>
      {error && <p className="error">{error}</p>}

      <div className="chat-console">
        <aside className="chat-sessions">
          <div className="chat-filter">
            {(["open", "closed", "all"] as const).map((value) => (
              <button
                key={value}
                type="button"
                className={`chip ${filter === value ? "chip-active" : ""}`}
                onClick={() => setFilter(value)}
              >
                {value}
              </button>
            ))}
          </div>
          {sessions.length === 0 && <p className="hint">No {filter === "all" ? "" : filter} sessions.</p>}
          <ul className="chat-session-list">
            {sessions.map((session) => (
              <li key={session.id}>
                <button
                  type="button"
                  className={`chat-session-item ${session.id === selectedId ? "chat-session-active" : ""}`}
                  onClick={() => setSelectedId(session.id)}
                >
                  <span className="chat-session-name">{session.visitor_name}</span>
                  <span className={`badge ${session.status === "open" ? "kb-badge-published" : "kb-badge-draft"}`}>
                    {session.status}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </aside>

        <section className="chat-thread">
          {!selected && <p className="hint chat-empty">Select a conversation to view it.</p>}
          {selected && (
            <>
              <div className="chat-thread-head">
                <div>
                  <strong>{selected.visitor_name}</strong>
                  <span className="hint"> · {selected.status}</span>
                </div>
                {selected.status === "open" && (
                  <button type="button" className="link-button" onClick={handleClose}>
                    Close chat
                  </button>
                )}
              </div>
              <div className="chat-messages" ref={scrollRef}>
                {messages.map((message) => (
                  <div key={message.id} className={`chat-bubble chat-bubble-${message.author_type}`}>
                    <div className="chat-bubble-body">{message.body}</div>
                    <div className="chat-bubble-meta">
                      {message.author_type} · {new Date(message.created_at).toLocaleTimeString()}
                    </div>
                  </div>
                ))}
                {messages.length === 0 && <p className="hint">No messages yet.</p>}
              </div>
              <form className="chat-composer" onSubmit={handleSend}>
                <input
                  placeholder="Type a reply…"
                  value={reply}
                  onChange={(e) => setReply(e.target.value)}
                  disabled={selected.status === "closed"}
                />
                <button type="submit" disabled={selected.status === "closed" || !reply.trim()}>
                  Send
                </button>
              </form>
            </>
          )}
        </section>
      </div>
    </div>
  );
}
