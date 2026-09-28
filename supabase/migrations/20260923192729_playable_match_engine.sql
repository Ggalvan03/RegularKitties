alter table public.rounds add column steals_taken smallint not null default 0 check (steals_taken between 0 and 2);

create function private.food_index(p_food public.food_type) returns integer language sql immutable set search_path = '' as $$
  select case p_food when 'chicken' then 1 when 'milk' then 2 when 'fish' then 3 else 4 end
$$;

create function private.next_seat(p_room uuid, p_seat smallint) returns smallint language sql stable security definer set search_path = '' as $$
  select coalesce(
    (select min(seat) from public.players where room_id=p_room and left_at is null and seat>p_seat),
    (select min(seat) from public.players where room_id=p_room and left_at is null)
  )::smallint
$$;

create function private.plate_eligible(p_round uuid, p_player uuid, p_tokens jsonb) returns boolean language plpgsql stable security definer set search_path = '' as $$
declare
  counts integer[] := array[0,0,0,0]; mins integer[] := array[-1,-1,-1,-1]; maxs integer[] := array[-1,-1,-1,-1];
  token text; last_idx integer := 0; idx integer; ok boolean;
begin
  select array[
    count(*) filter(where food='chicken'), count(*) filter(where food='milk'),
    count(*) filter(where food='fish'), count(*) filter(where food='croquettes')
  ] into counts from public.plate_cards where round_id=p_round and player_id=p_player;
  for token in select jsonb_array_elements_text(p_tokens) loop
    if token='|' then
      ok := true;
      for idx in 1..4 loop
        if mins[idx]=-1 then ok := ok and counts[idx]=0; else ok := ok and counts[idx]>=mins[idx] and counts[idx]<=maxs[idx]; end if;
      end loop;
      if ok then return true; end if;
      mins:=array[-1,-1,-1,-1]; maxs:=array[-1,-1,-1,-1]; last_idx:=0;
    elsif token in ('chicken','milk','fish','croquettes') then
      last_idx:=private.food_index(token::public.food_type); mins[last_idx]:=1; maxs[last_idx]:=1;
    elsif last_idx>0 then
      if token='*' then mins[last_idx]:=0; maxs[last_idx]:=2147483647;
      elsif token='+' then mins[last_idx]:=1; maxs[last_idx]:=2147483647;
      elsif token in ('2','3') then mins[last_idx]:=token::integer; maxs[last_idx]:=token::integer;
      end if;
    end if;
  end loop;
  ok:=true;
  for idx in 1..4 loop
    if mins[idx]=-1 then ok:=ok and counts[idx]=0; else ok:=ok and counts[idx]>=mins[idx] and counts[idx]<=maxs[idx]; end if;
  end loop;
  return ok;
end $$;

create function private.deal_round(p_game uuid, p_room uuid, p_number integer, p_cat smallint, p_starter smallint, p_timer smallint) returns uuid language plpgsql security definer set search_path = '' as $$
declare new_round uuid; participant record; n integer; foods public.food_type[]:=array['chicken','milk','fish','croquettes']::public.food_type[];
begin
  insert into public.rounds(game_id,number,cat_id,starter_seat,active_seat,deadline)
  values(p_game,p_number,p_cat,p_starter,p_starter,clock_timestamp()+make_interval(secs=>p_timer)) returning id into new_round;
  for participant in select id from public.players where room_id=p_room and left_at is null order by seat loop
    for n in 1..6 loop
      insert into public.hand_cards(round_id,player_id,food,ordinal) values(new_round,participant.id,foods[1+floor(random()*4)::int],n);
    end loop;
  end loop;
  return new_round;
end $$;

create function private.start_game(p_room uuid, p_idem uuid) returns jsonb language plpgsql security definer set search_path = '' as $$
declare actor public.players; target public.rooms; new_game public.games; existing jsonb;
begin
  select p.* into actor from public.players p where p.room_id=p_room and p.user_id=auth.uid() and p.left_at is null;
  if not found or not actor.is_host then raise exception using errcode='42501',message='HOST_REQUIRED'; end if;
  select * into target from public.rooms where id=p_room for update;
  if target.status<>'lobby' then raise exception using errcode='P0001',message='ROOM_NOT_IN_LOBBY'; end if;
  if (select count(*) from public.players where room_id=p_room and left_at is null)<2 then raise exception using errcode='P0001',message='NOT_ENOUGH_PLAYERS'; end if;
  if exists(select 1 from public.players where room_id=p_room and left_at is null and not is_ready) then raise exception using errcode='P0001',message='PLAYERS_NOT_READY'; end if;
  select public_result into existing from public.actions where player_id=actor.id and idempotency_key=p_idem; if found then return existing; end if;
  insert into public.games(room_id,current_round) values(p_room,1) returning * into new_game;
  perform private.deal_round(new_game.id,p_room,1,1,1,target.timer_seconds);
  update public.rooms set status='playing' where id=p_room;
  existing:=jsonb_build_object('game_id',new_game.id,'version',1);
  insert into public.actions(game_id,player_id,idempotency_key,action_type,expected_version,resulting_version,public_result) values(new_game.id,actor.id,p_idem,'start',0,1,existing);
  return existing;
end $$;

create function private.resolve_cycle(p_game public.games, p_round public.rounds, p_room public.rooms) returns void language plpgsql security definer set search_path = '' as $$
declare cat public.cat_definitions; winner uuid; winner_count integer; leaders integer; next_starter smallint; next_round integer; ended boolean;
begin
  select * into cat from public.cat_definitions where id=p_round.cat_id;
  with eligible as (
    select p.id,(select count(*) from public.plate_cards pc where pc.round_id=p_round.id and pc.player_id=p.id)::int cards
    from public.players p where p.room_id=p_room.id and p.left_at is null and private.plate_eligible(p_round.id,p.id,cat.preference_tokens)
  ), top as (select max(cards) cards from eligible)
  select min(id),coalesce(max(cards),0),count(*) into winner,winner_count,leaders from eligible where cards=(select cards from top);
  if winner_count=0 or leaders<>1 then
    update public.rounds set phase='plating',cycle=cycle+1,active_seat=starter_seat,steals_taken=0,deadline=clock_timestamp()+make_interval(secs=>p_room.timer_seconds) where id=p_round.id;
    return;
  end if;
  update public.rounds set phase='round_result',winner_player_id=winner,resolved_at=clock_timestamp() where id=p_round.id;
  update public.players set score=score+cat.points where id=winner;
  insert into public.captured_cats(game_id,cat_id,player_id,round_id,points,capture_order) values(p_game.id,cat.id,winner,p_round.id,cat.points,p_round.number);
  select (p_round.number>=10) or (p_room.victory_mode='score' and exists(select 1 from public.players where room_id=p_room.id and score>=p_room.target_score)) into ended;
  if ended then
    update public.games set status='finished',finished_at=clock_timestamp() where id=p_game.id;
    update public.rooms set status='finished' where id=p_room.id;
    insert into public.final_standings(game_id,player_id,score,placement)
      select p_game.id,p.id,p.score,1+(select count(*) from public.players q where q.room_id=p_room.id and q.score>p.score) from public.players p where p.room_id=p_room.id and p.left_at is null;
  else
    next_starter:=private.next_seat(p_room.id,p_round.starter_seat); next_round:=p_round.number+1;
    update public.games set current_round=next_round where id=p_game.id;
    perform private.deal_round(p_game.id,p_room.id,next_round,next_round::smallint,next_starter,p_room.timer_seconds);
  end if;
end $$;

create function private.game_action(p_game_id uuid,p_kind text,p_card_ids uuid[],p_target uuid,p_expected bigint,p_idem uuid) returns jsonb language plpgsql security definer set search_path = '' as $$
declare actor public.players; game public.games; rnd public.rounds; room public.rooms; nxt smallint; selected_food public.food_type; result jsonb; target_card public.plate_cards;
begin
  select * into game from public.games where id=p_game_id for update; if not found then raise exception using message='GAME_NOT_FOUND'; end if;
  select * into room from public.rooms where id=game.room_id;
  select * into actor from public.players where room_id=room.id and user_id=auth.uid() and left_at is null;
  if not found then raise exception using errcode='42501',message='NOT_A_MEMBER'; end if;
  select public_result into result from public.actions where player_id=actor.id and idempotency_key=p_idem; if found then return result; end if;
  if game.state_version<>p_expected then raise exception using message='STALE_STATE'; end if;
  select * into rnd from public.rounds where game_id=game.id and resolved_at is null order by number desc limit 1 for update;
  if actor.seat<>rnd.active_seat then raise exception using message='NOT_YOUR_TURN'; end if;
  if p_kind='plate' then
    if rnd.phase<>'plating' or coalesce(array_length(p_card_ids,1),0)<1 then raise exception using message='ILLEGAL_PLATE'; end if;
    select food into selected_food from public.hand_cards where id=p_card_ids[1] and player_id=actor.id and round_id=rnd.id;
    if selected_food is null or exists(select 1 from unnest(p_card_ids) x left join public.hand_cards h on h.id=x and h.player_id=actor.id and h.round_id=rnd.id where h.id is null or h.food<>selected_food) then raise exception using message='INVALID_CARDS'; end if;
    insert into public.plate_cards(round_id,player_id,food,source_hand_card_id) select round_id,player_id,food,id from public.hand_cards where id=any(p_card_ids);
    delete from public.hand_cards where id=any(p_card_ids);
  elsif p_kind='steal' then
    if rnd.phase<>'stealing' or rnd.steals_taken>=2 or array_length(p_card_ids,1)<>2 then raise exception using message='ILLEGAL_STEAL'; end if;
    select food into selected_food from public.hand_cards where id=p_card_ids[1] and player_id=actor.id and round_id=rnd.id;
    if selected_food is null or (select count(*) from public.hand_cards where id=any(p_card_ids) and player_id=actor.id and round_id=rnd.id and food=selected_food)<>2 then raise exception using message='INVALID_STEAL_COST'; end if;
    select * into target_card from public.plate_cards where id=p_target and round_id=rnd.id and player_id<>actor.id for update;
    if not found then raise exception using message='INVALID_TARGET'; end if;
    delete from public.hand_cards where id=any(p_card_ids);
    update public.plate_cards set player_id=actor.id where id=target_card.id;
    update public.rounds set steals_taken=steals_taken+1 where id=rnd.id;
  elsif p_kind not in ('pass','finish_steal') then raise exception using message='INVALID_ACTION'; end if;
  if p_kind in ('plate','pass') and rnd.phase='plating' or p_kind='finish_steal' then
    nxt:=private.next_seat(room.id,rnd.active_seat);
    if nxt=rnd.starter_seat then
      if rnd.phase='plating' then update public.rounds set phase='stealing',active_seat=starter_seat,steals_taken=0,deadline=clock_timestamp()+make_interval(secs=>room.timer_seconds) where id=rnd.id;
      else perform private.resolve_cycle(game,rnd,room); end if;
    else update public.rounds set active_seat=nxt,steals_taken=0,deadline=clock_timestamp()+make_interval(secs=>room.timer_seconds) where id=rnd.id; end if;
  end if;
  update public.games set state_version=state_version+1 where id=game.id returning state_version into p_expected;
  result:=jsonb_build_object('game_id',game.id,'version',p_expected);
  insert into public.actions(game_id,player_id,idempotency_key,action_type,expected_version,resulting_version,public_result) values(game.id,actor.id,p_idem,p_kind,game.state_version,p_expected,result);
  return result;
end $$;

create function public.start_game(room_id uuid,idempotency_key uuid) returns jsonb language sql security invoker set search_path='' as $$ select private.start_game(room_id,idempotency_key) $$;
create function public.game_action(game_id uuid,kind text,card_ids uuid[] default array[]::uuid[],target_card uuid default null,expected_version bigint default 0,idempotency_key uuid default gen_random_uuid()) returns jsonb language sql security invoker set search_path='' as $$ select private.game_action(game_id,kind,card_ids,target_card,expected_version,idempotency_key) $$;

revoke all on function public.start_game(uuid,uuid),public.game_action(uuid,text,uuid[],uuid,bigint,uuid) from public;
grant execute on function public.start_game(uuid,uuid),public.game_action(uuid,text,uuid[],uuid,bigint,uuid) to authenticated;
grant execute on function private.start_game(uuid,uuid),private.game_action(uuid,text,uuid[],uuid,bigint,uuid),private.next_seat(uuid,smallint),private.plate_eligible(uuid,uuid,jsonb),private.deal_round(uuid,uuid,integer,smallint,smallint,smallint),private.resolve_cycle(public.games,public.rounds,public.rooms) to authenticated;
alter publication supabase_realtime add table public.hand_cards;
