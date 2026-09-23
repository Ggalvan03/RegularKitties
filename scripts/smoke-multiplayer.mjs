import { createClient } from "@supabase/supabase-js";
const url=process.env.NEXT_PUBLIC_SUPABASE_URL,key=process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
if(!url||!key)throw new Error("Missing Supabase environment.");
const client=()=>createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false}});
const a=client(),b=client();
await a.auth.signInAnonymously();await b.auth.signInAnonymously();
const idem=()=>crypto.randomUUID();
const {data:created,error:createError}=await a.rpc("create_room",{nickname:"Smoke Host",capacity:2,timer_seconds:45,victory_mode:"score",target_score:5});if(createError)throw createError;
const {error:joinError}=await b.rpc("join_room",{code:created.join_code,nickname:"Smoke Guest"});if(joinError)throw joinError;
await a.rpc("set_ready",{room_id:created.room_id,ready:true});await b.rpc("set_ready",{room_id:created.room_id,ready:true});
const {data:started,error:startError}=await a.rpc("start_game",{room_id:created.room_id,idempotency_key:idem()});if(startError)throw startError;
const {data:round}=await a.from("rounds").select("id,active_seat,phase").eq("game_id",started.game_id).single();
const {data:players}=await a.from("players").select("id,user_id,seat").eq("room_id",created.room_id).order("seat");
const bySeat=new Map(players.map(p=>[p.seat,p.user_id]));const clients=new Map([[a.auth.getUser().then(x=>x.data.user.id),a],[b.auth.getUser().then(x=>x.data.user.id),b]]);const resolved=new Map();for(const [promise,c] of clients)resolved.set(await promise,c);
let version=started.version;
for(const seat of [1,2]){const c=resolved.get(bySeat.get(seat));const {data:hand}=await c.from("hand_cards").select("id,food").eq("round_id",round.id);const preferred=hand.find(x=>x.food==="fish")?.food??hand.find(x=>x.food==="milk")?.food;const cards=seat===1&&preferred?hand.filter(x=>x.food===preferred).map(x=>x.id):[];const {data,error}=await c.rpc("game_action",{game_id:started.game_id,kind:cards.length?"plate":"pass",card_ids:cards,target_card:null,expected_version:version,idempotency_key:idem()});if(error)throw error;version=data.version;}
for(const seat of [1,2]){const c=resolved.get(bySeat.get(seat));const {data,error}=await c.rpc("game_action",{game_id:started.game_id,kind:"finish_steal",card_ids:[],target_card:null,expected_version:version,idempotency_key:idem()});if(error)throw error;version=data.version;}
const {data:game}=await a.from("games").select("state_version,current_round,status").eq("id",started.game_id).single();
console.log(JSON.stringify({ok:true,room:created.join_code,game}));
