import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { z } from "zod";

const schema = z.discriminatedUnion("command", [
  z.object({ command:z.literal("start"),roomId:z.string().uuid(),idempotencyKey:z.string().uuid() }),
  z.object({ command:z.literal("action"),gameId:z.string().uuid(),kind:z.enum(["plate","pass","steal","finish_steal"]),cardIds:z.array(z.string().uuid()).max(6),targetCard:z.string().uuid().nullable(),expectedVersion:z.number().int().positive(),idempotencyKey:z.string().uuid() }),
  z.object({ command:z.literal("advance"),gameId:z.string().uuid(),expectedVersion:z.number().int().positive(),idempotencyKey:z.string().uuid() }),
]);

export async function POST(request:Request){
  const token=request.headers.get("authorization")?.replace(/^Bearer\s+/i,"");
  const parsed=schema.safeParse(await request.json().catch(()=>null));
  if(!token||!parsed.success)return NextResponse.json({message:"Invalid game command."},{status:400});
  const supabase=createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!,process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,{global:{headers:{Authorization:`Bearer ${token}`}},auth:{persistSession:false}});
  const cmd=parsed.data;
  const response=cmd.command==="start"
    ?await supabase.rpc("start_game",{room_id:cmd.roomId,idempotency_key:cmd.idempotencyKey})
    :cmd.command==="advance"
      ?await supabase.rpc("advance_expired",{game_id:cmd.gameId,expected_version:cmd.expectedVersion,idempotency_key:cmd.idempotencyKey})
      :await supabase.rpc("game_action",{game_id:cmd.gameId,kind:cmd.kind,card_ids:cmd.cardIds,target_card:cmd.targetCard,expected_version:cmd.expectedVersion,idempotency_key:cmd.idempotencyKey});
  if(response.error){console.warn("game_command_failed",{command:cmd.command,code:response.error.code});return NextResponse.json({message:response.error.message.split("\n")[0]},{status:409});}
  return NextResponse.json(response.data);
}
