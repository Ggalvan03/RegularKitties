import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { z } from "zod";

export const dynamic = "force-dynamic";

const payloadSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("create"),
    nickname: z.string().trim().min(2).max(20),
    capacity: z.number().int().min(2).max(6),
    timerSeconds: z.number().int().min(15).max(120),
    victoryMode: z.enum(["score", "all_cats"]),
    targetScore: z.number().int().min(5).max(30).nullable(),
  }),
  z.object({
    action: z.literal("join"),
    nickname: z.string().trim().min(2).max(20),
    code: z.string().trim().toUpperCase().regex(/^[A-Z2-9]{6}$/),
  }),
]);

const publicMessages: Record<string, string> = {
  ROOM_UNAVAILABLE: "That room is unavailable or has already started.",
  ROOM_FULL: "That table is full.",
  NICKNAME_TAKEN: "Someone at that table already uses that nickname.",
  INVALID_NICKNAME: "Use a nickname between 2 and 20 characters.",
  AUTH_REQUIRED: "Your player session expired. Please try again.",
};

export async function POST(request: Request) {
  const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (!token) return NextResponse.json({ error: "AUTH_REQUIRED", message: publicMessages.AUTH_REQUIRED }, { status: 401 });

  const parsed = payloadSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "INVALID_REQUEST", message: "Check the room details and try again." }, { status: 400 });

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    { global: { headers: { Authorization: `Bearer ${token}` } }, auth: { persistSession: false } },
  );

  const command = parsed.data;
  const response = command.action === "create"
    ? await supabase.rpc("create_room", {
        nickname: command.nickname,
        capacity: command.capacity,
        timer_seconds: command.timerSeconds,
        victory_mode: command.victoryMode,
        target_score: command.victoryMode === "all_cats" ? null : command.targetScore,
      })
    : await supabase.rpc("join_room", { code: command.code, nickname: command.nickname });

  if (response.error) {
    const code = Object.keys(publicMessages).find((key) => response.error.message.includes(key)) ?? "COMMAND_FAILED";
    console.warn("room_command_failed", { action: command.action, code, databaseCode: response.error.code });
    return NextResponse.json({ error: code, message: publicMessages[code] ?? "The room command could not be completed." }, { status: code === "AUTH_REQUIRED" ? 401 : 409 });
  }
  return NextResponse.json(response.data);
}
