import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { z } from "zod";

const schema = z.object({ roomId: z.string().uuid(), ready: z.boolean() });

export async function POST(request: Request) {
  const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!token || !parsed.success) return NextResponse.json({ message: "Invalid ready command." }, { status: 400 });
  const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!, {
    global: { headers: { Authorization: `Bearer ${token}` } }, auth: { persistSession: false },
  });
  const { data, error } = await supabase.rpc("set_ready", { room_id: parsed.data.roomId, ready: parsed.data.ready });
  if (error) return NextResponse.json({ message: "Readiness could not be changed." }, { status: 409 });
  return NextResponse.json(data);
}
