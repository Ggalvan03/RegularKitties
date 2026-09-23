"use client";

import Image from "next/image";
import { useRouter } from "next/navigation";
import { ArrowRight, Check, Copy, Fish, Milk, Sparkles } from "lucide-react";
import { useState, type ReactNode } from "react";
import { getAnonymousAccessToken } from "@/lib/supabase/browser";

type Mode = "create" | "join";

export function HomeScreen() {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>("create");
  const [targetMode, setTargetMode] = useState<"score" | "all-cats">("score");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string>();

  async function submitRoom(form: HTMLFormElement) {
    setPending(true);
    setError(undefined);
    const data = new FormData(form);
    try {
      const token = await getAnonymousAccessToken();
      const body = mode === "create"
        ? {
            action: "create", nickname: data.get("nickname"), capacity: Number(data.get("capacity")),
            timerSeconds: Number(data.get("timer")), victoryMode: targetMode === "score" ? "score" : "all_cats",
            targetScore: targetMode === "score" ? 10 : null,
          }
        : { action: "join", nickname: data.get("nickname"), code: data.get("code") };
      const response = await fetch("/api/rooms", { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` }, body: JSON.stringify(body) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.message ?? "Could not enter the room.");
      router.push(`/room/${result.join_code}`);
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : "Could not enter the room.");
      setPending(false);
    }
  }

  return (
    <main className="min-h-screen overflow-hidden bg-[var(--paper)] text-[var(--ink)]">
      <div className="paper-noise fixed inset-0 pointer-events-none opacity-40" aria-hidden="true" />
      <nav className="relative z-10 mx-auto flex max-w-[1480px] items-center justify-between px-6 py-5 lg:px-10">
        <a href="#top" className="brand-mark focus-ring" aria-label="Regular Kitties home">
          <span className="brand-paw">✦</span><span>Regular Kitties</span>
        </a>
        <div className="hidden items-center gap-6 text-sm font-bold text-[var(--muted)] sm:flex">
          <span className="flex items-center gap-2"><span className="status-dot" /> Private rooms</span>
          <span>2–6 players</span><span>Free to play</span>
        </div>
      </nav>

      <section id="top" className="relative mx-auto grid min-h-[calc(100vh-76px)] max-w-[1480px] items-center gap-8 px-6 pb-12 lg:grid-cols-[1.04fr_.96fr] lg:px-10">
        <div className="relative z-10 max-w-2xl py-8 lg:py-16">
          <div className="eyebrow"><Sparkles size={14} /> A small game about big appetites</div>
          <h1 className="mt-6 font-display text-[clamp(4rem,8vw,8.5rem)] font-black leading-[.78] tracking-[-.065em]">
            Feed cats.<br /><span className="text-[var(--coral)]">Foil friends.</span>
          </h1>
          <p className="mt-8 max-w-xl text-lg font-semibold leading-8 text-[var(--muted)] sm:text-xl">
            Plate the perfect meal, steal the best bites, and win over ten extremely ordinary—and extremely picky—cats.
          </p>
          <div className="mt-10 flex flex-wrap gap-3" aria-label="Game highlights">
            <FoodPill icon={<span>🍗</span>} label="Plate" tone="coral" />
            <FoodPill icon={<Milk size={17} />} label="Match" tone="cream" />
            <FoodPill icon={<Fish size={17} />} label="Steal" tone="blue" />
          </div>
          <div className="mt-10 flex items-center gap-5 text-sm font-bold text-[var(--muted)]">
            <div className="flex -space-x-2" aria-hidden="true">
              {["#DF6B4F", "#E8B65A", "#75A8A0", "#80629B"].map((color, index) => (
                <span key={color} className="avatar-chip" style={{ backgroundColor: color, zIndex: 4 - index }}>{["M", "J", "S", "R"][index]}</span>
              ))}
            </div>
            <span>No signup. Just send the code.</span>
          </div>
        </div>

        <div className="relative z-10 flex items-center justify-center py-8 lg:justify-end">
          <div className="join-card w-full max-w-[540px]">
            <div className="join-tabs" role="tablist" aria-label="Room action">
              <button role="tab" aria-selected={mode === "create"} onClick={() => setMode("create")} className={mode === "create" ? "active" : ""}>Create room</button>
              <button role="tab" aria-selected={mode === "join"} onClick={() => setMode("join")} className={mode === "join" ? "active" : ""}>Join room</button>
            </div>
            <form className="p-6 sm:p-8" onSubmit={(event) => { event.preventDefault(); void submitRoom(event.currentTarget); }}>
              <div className="mb-7">
                <p className="font-display text-3xl font-bold">{mode === "create" ? "Set the table" : "Pull up a chair"}</p>
                <p className="mt-1 text-sm font-semibold text-[var(--muted)]">{mode === "create" ? "You’ll be the host. Settings can’t change mid-match." : "Enter the code your host shared with you."}</p>
              </div>
              {mode === "join" && <Field label="Room code"><input name="code" className="text-center uppercase tracking-[.24em]" placeholder="KTTY42" minLength={6} maxLength={6} pattern="[A-Za-z2-9]{6}" required /></Field>}
              <Field label="Your nickname"><input name="nickname" placeholder="Marmalade" minLength={2} maxLength={20} required /></Field>
              {mode === "create" && (
                <>
                  <div className="grid grid-cols-2 gap-4">
                    <Field label="Seats"><select name="capacity" defaultValue="4"><option>2</option><option>3</option><option>4</option><option>5</option><option>6</option></select></Field>
                    <Field label="Turn timer"><select name="timer" defaultValue="45"><option value="15">15 sec</option><option value="30">30 sec</option><option value="45">45 sec</option><option value="60">60 sec</option><option value="90">90 sec</option><option value="120">120 sec</option></select></Field>
                  </div>
                  <fieldset className="mt-5">
                    <legend className="field-label">Victory condition</legend>
                    <div className="choice-grid">
                      <Choice selected={targetMode === "score"} onClick={() => setTargetMode("score")} title="First to 10" note="Quick match" />
                      <Choice selected={targetMode === "all-cats"} onClick={() => setTargetMode("all-cats")} title="All 10 cats" note="Full feast" />
                    </div>
                  </fieldset>
                </>
              )}
              {error && <p role="alert" className="error-banner">{error}</p>}
              <button className="primary-button focus-ring mt-7 w-full" type="submit" disabled={pending}>
                {pending ? "Setting the table…" : mode === "create" ? "Create private room" : "Join the table"}<ArrowRight size={19} />
              </button>
              <p className="mt-4 flex items-center justify-center gap-2 text-xs font-bold text-[var(--muted)]"><Copy size={13} /> The room code appears in the lobby.</p>
            </form>
          </div>
        </div>

        <div className="cat-stage" aria-hidden="true">
          <div className="sun-shape" />
          <Image src="/cat-placeholder.png" alt="" width={974} height={1374} priority className="cat-art" />
        </div>
      </section>
    </main>
  );
}

function FoodPill({ icon, label, tone }: { icon: ReactNode; label: string; tone: string }) {
  return <span className={`food-pill ${tone}`}>{icon}{label}</span>;
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return <label className="field"><span className="field-label">{label}</span>{children}</label>;
}

function Choice({ selected, onClick, title, note }: { selected: boolean; onClick: () => void; title: string; note: string }) {
  return (
    <button type="button" onClick={onClick} className={selected ? "selected" : ""} aria-pressed={selected}>
      <span className="choice-check">{selected && <Check size={14} strokeWidth={3} />}</span>
      <span><strong>{title}</strong><small>{note}</small></span>
    </button>
  );
}
