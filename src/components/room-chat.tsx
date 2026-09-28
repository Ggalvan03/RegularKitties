"use client";

import { Send } from "lucide-react";
import { FormEvent, useCallback, useEffect, useState } from "react";
import { getSupabaseBrowserClient } from "@/lib/supabase/browser";

type Message = {
  id: string;
  body: string;
  created_at: string;
  player_id: string;
  players: { nickname: string; seat: number } | null;
};
export const PLAYER_COLORS = [
  "#d85f43",
  "#397f75",
  "#7656a5",
  "#c48a24",
  "#4e80b7",
  "#a94f77",
];

export function RoomChat({
  roomId,
  compact = false,
}: {
  roomId: string;
  compact?: boolean;
}) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState("");
  const supabase = getSupabaseBrowserClient();
  const load = useCallback(async () => {
    const { data } = await supabase
      .from("room_messages")
      .select("id,body,created_at,player_id,players(nickname,seat)")
      .eq("room_id", roomId)
      .order("created_at", { ascending: false })
      .limit(100);
    setMessages(((data ?? []) as unknown as Message[]).reverse());
  }, [roomId, supabase]);
  useEffect(() => {
    const initial = window.setTimeout(() => void load(), 0);
    const channel = supabase
      .channel(`chat:${roomId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "room_messages",
          filter: `room_id=eq.${roomId}`,
        },
        () => void load(),
      )
      .subscribe();
    return () => {
      window.clearTimeout(initial);
      void supabase.removeChannel(channel);
    };
  }, [load, roomId, supabase]);
  async function send(event: FormEvent) {
    event.preventDefault();
    const body = draft.trim();
    if (!body) return;
    const { error: sendError } = await supabase.rpc("send_room_message", {
      p_room: roomId,
      p_body: body,
    });
    if (sendError) {
      setError("Wait a moment, then try again.");
      return;
    }
    setDraft("");
    setError("");
    await load();
  }
  return (
    <section className={`room-chat ${compact ? "compact" : ""}`}>
      <h2>Room chat</h2>
      <div className="chat-messages" aria-live="polite">
        {messages.map((message) => (
          <p key={message.id}>
            <strong
              style={{ color: PLAYER_COLORS[(message.players?.seat ?? 1) - 1] }}
            >
              {message.players?.nickname ?? "Player"}
            </strong>
            <span>{message.body}</span>
          </p>
        ))}
      </div>
      <form onSubmit={send}>
        <label className="sr-only" htmlFor={`chat-${roomId}`}>
          Message the room
        </label>
        <input
          id={`chat-${roomId}`}
          value={draft}
          maxLength={280}
          onChange={(event) => setDraft(event.target.value)}
          placeholder="Message the room…"
        />
        <button aria-label="Send message">
          <Send size={16} />
        </button>
      </form>
      {error ? <small role="alert">{error}</small> : null}
    </section>
  );
}
