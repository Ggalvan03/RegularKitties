"use client";

import { Check, Clipboard, Clock3, Crown, Link2, LogOut, Radio, Users } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { getAnonymousAccessToken, getSupabaseBrowserClient } from "@/lib/supabase/browser";
import { GameTable } from "@/components/game-table";
import { RoomChat } from "@/components/room-chat";

type Room = { id: string; join_code: string; capacity: number; timer_seconds: number; victory_mode: "score" | "all_cats"; target_score: number | null; status: string };
type Player = { id: string; user_id: string; nickname: string; seat: number; is_ready: boolean; is_connected: boolean; is_host: boolean };

export function Lobby({ code }: { code: string }) {
  const [room, setRoom] = useState<Room>();
  const [players, setPlayers] = useState<Player[]>([]);
  const [userId, setUserId] = useState<string>();
  const [message, setMessage] = useState("Finding your table…");
  const [copyStatus, setCopyStatus] = useState<"idle" | "copied" | "failed">("idle");

  useEffect(() => {
    const supabase = getSupabaseBrowserClient();
    let channel: ReturnType<typeof supabase.channel> | undefined;
    async function load() {
      await getAnonymousAccessToken();
      const { data: auth } = await supabase.auth.getUser();
      setUserId(auth.user?.id);
      const { data: found, error } = await supabase.from("rooms").select("id,join_code,capacity,timer_seconds,victory_mode,target_score,status").eq("join_code", code).single();
      if (error || !found) { setMessage("This room is unavailable, or this browser no longer owns its seat."); return; }
      setRoom(found as Room);
      const refreshPlayers = async () => {
        const { data } = await supabase.from("players").select("id,user_id,nickname,seat,is_ready,is_connected,is_host").eq("room_id", found.id).is("left_at", null).order("seat");
        setPlayers((data ?? []) as Player[]);
      };
      await refreshPlayers();
      setMessage("");
      channel = supabase.channel(`lobby:${found.id}:${crypto.randomUUID()}`)
        .on("postgres_changes", { event: "*", schema: "public", table: "players", filter: `room_id=eq.${found.id}` }, refreshPlayers)
        .on("postgres_changes", { event: "UPDATE", schema: "public", table: "rooms", filter: `id=eq.${found.id}` }, (payload: { new: unknown }) => setRoom(payload.new as Room))
        .subscribe();
    }
    void load();
    return () => { if (channel) void supabase.removeChannel(channel); };
  }, [code]);

  async function toggleReady(ready: boolean) {
    if (!room) return;
    const token = await getAnonymousAccessToken();
    const response = await fetch("/api/rooms/ready", { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` }, body: JSON.stringify({ roomId: room.id, ready }) });
    if (response.ok && me) setPlayers((current) => current.map((player) => player.id === me.id ? { ...player, is_ready: ready } : player));
  }

  async function startMatch(){
    if(!room)return;
    const token=await getAnonymousAccessToken();
    const response=await fetch("/api/game",{method:"POST",headers:{"Content-Type":"application/json",Authorization:`Bearer ${token}`},body:JSON.stringify({command:"start",roomId:room.id,idempotencyKey:crypto.randomUUID()})});
    if(response.ok)setRoom({...room,status:"playing"});
  }

  async function copyInviteLink() {
    try {
      await navigator.clipboard.writeText(`${window.location.origin}/room/${code}`);
      setCopyStatus("copied");
    } catch {
      setCopyStatus("failed");
    }
    window.setTimeout(() => setCopyStatus("idle"), 2500);
  }

  const me = players.find((player) => player.user_id === userId);

  if(room?.status==="playing"||room?.status==="finished")return <GameTable room={room} players={players} userId={userId} code={code}/>;

  return (
    <main className="lobby-page min-h-screen p-5 sm:p-8">
      <div className="mx-auto max-w-6xl">
        <header className="flex items-center justify-between">
          <Link href="/" className="brand-mark focus-ring"><span className="brand-paw">✦</span><span>Regular Kitties</span></Link>
          <Link href="/" className="quiet-button"><LogOut size={17} /> Leave room</Link>
        </header>
        {message ? <div className="lobby-panel mt-16 text-center"><p className="font-display text-3xl font-bold">{message}</p></div> : room && (
          <div className="mt-10 grid gap-6 lg:grid-cols-[1fr_360px]">
            <section className="lobby-panel">
              <div className="flex flex-wrap items-start justify-between gap-6 border-b border-[var(--line)] p-6 sm:p-8">
                <div><p className="eyebrow"><Radio size={14} /> Private lobby</p><h1 className="mt-3 font-display text-4xl font-black">Gather the cats.</h1><p className="mt-2 font-semibold text-[var(--muted)]">Everyone marks ready. Then the host starts the feast.</p></div>
                <div className="invite-actions">
                  <button className="code-card" onClick={() => void navigator.clipboard.writeText(code)} aria-label={`Copy room code ${code}`}><span>Room code</span><strong>{code}</strong><Clipboard size={17} /></button>
                  <button className="quiet-button invite-link-button" onClick={() => void copyInviteLink()} aria-describedby="invite-copy-status"><Link2 size={17} />{copyStatus === "copied" ? "Link copied" : "Copy invite link"}</button>
                  <span id="invite-copy-status" className="copy-status" role="status" aria-live="polite">{copyStatus === "failed" ? "Could not copy the invite link." : copyStatus === "copied" ? "Invite link copied." : ""}</span>
                </div>
              </div>
              <div className="grid gap-3 p-6 sm:grid-cols-2 sm:p-8">
                {Array.from({ length: room.capacity }, (_, index) => players.find((player) => player.seat === index + 1)).map((player, index) => (
                  <div key={player?.id ?? `seat-${index}`} className={`seat-card ${player ? "filled" : ""}`}>
                    <span className="seat-number">{index + 1}</span>
                    {player ? <><span className="player-avatar">{player.nickname.slice(0, 1).toUpperCase()}</span><span className="min-w-0 flex-1"><strong className="block truncate">{player.nickname}</strong><small>{player.is_connected ? "Connected" : "Reconnecting"}</small></span>{player.is_host && <Crown size={17} aria-label="Host" />}{player.is_ready ? <span className="ready-tag"><Check size={13} /> Ready</span> : <span className="waiting-tag">Not ready</span>}</> : <span className="font-bold text-[var(--muted)]">Open chair</span>}
                  </div>
                ))}
              </div>
            </section>
            <aside className="space-y-5">
              <RoomChat roomId={room.id} compact />
              <div className="lobby-panel p-6"><h2 className="font-display text-2xl font-bold">House rules</h2><dl className="rules-list"><div><dt><Users size={17} /> Seats</dt><dd>{players.length} / {room.capacity}</dd></div><div><dt><Clock3 size={17} /> Turns</dt><dd>{room.timer_seconds} sec</dd></div><div><dt>✦ Victory</dt><dd>{room.victory_mode === "all_cats" ? "All 10 cats" : `${room.target_score} points`}</dd></div></dl></div>
              <div className="lobby-panel p-6">
                <p className="text-sm font-bold text-[var(--muted)]">You are {me?.is_host ? "the host" : `in seat ${me?.seat ?? "—"}`}.</p>
                <button className="primary-button mt-4 w-full" disabled={!me} onClick={() => void toggleReady(!me?.is_ready)}>{me?.is_ready ? "I’m not ready" : "I’m ready"}</button>
                {me?.is_host && <button className="secondary-button mt-3 w-full" onClick={()=>void startMatch()} disabled={players.length < 2 || players.some((player) => !player.is_ready)}>Start match</button>}
                {me?.is_host && players.some((player) => !player.is_ready) && <p className="mt-3 text-center text-xs font-bold text-[var(--muted)]">Every player must be ready.</p>}
              </div>
            </aside>
          </div>
        )}
      </div>
    </main>
  );
}
