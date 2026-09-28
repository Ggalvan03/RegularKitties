create type public.hand_card_kind as enum ('food','powerup');
create type public.powerup_type as enum ('clear_plate','move_plate','change_cat','steal_for_free','change_seat');

alter table public.hand_cards alter column food drop not null;
alter table public.hand_cards add column card_kind public.hand_card_kind not null default 'food';
alter table public.hand_cards add column powerup public.powerup_type;
alter table public.hand_cards add constraint hand_card_payload check ((card_kind='food' and food is not null and powerup is null) or (card_kind='powerup' and food is null and powerup is not null));
alter table public.plate_cards add column position integer;
with ranked as(select id,row_number()over(partition by round_id,player_id order by plated_at,id) n from public.plate_cards)update public.plate_cards p set position=r.n from ranked r where r.id=p.id;
alter table public.plate_cards alter column position set not null;
alter table public.plate_cards add constraint plate_position_positive check(position>0);
create index plate_cards_position_idx on public.plate_cards(round_id,player_id,position);
alter table public.rounds add column powerup_used_seats smallint[] not null default '{}';
alter table public.players add column pending_last_seat boolean not null default false;

create table public.room_messages(
 id uuid primary key default gen_random_uuid(),room_id uuid not null references public.rooms(id)on delete cascade,
 player_id uuid not null references public.players(id)on delete cascade,body text not null check(char_length(body)between 1 and 280),created_at timestamptz not null default clock_timestamp()
);
create index room_messages_room_created_idx on public.room_messages(room_id,created_at desc);
alter table public.room_messages enable row level security;
create policy room_messages_member_read on public.room_messages for select to authenticated using(private.is_room_member(room_id));
grant select on public.room_messages to authenticated;
alter publication supabase_realtime add table public.room_messages;

create function private.assign_plate_position()returns trigger language plpgsql security definer set search_path='' as $$begin if new.position is null then select coalesce(max(position),0)+1 into new.position from public.plate_cards where round_id=new.round_id and player_id=new.player_id;end if;return new;end $$;
create trigger assign_plate_position before insert on public.plate_cards for each row execute function private.assign_plate_position();

update public.cat_definitions set preference_tokens=case id
 when 1 then '["fish","+","milk","2","|","chicken","+","croquettes","*","fish"]'::jsonb
 when 2 then '["chicken","2","milk","|","fish","3","croquettes","|","milk","+"]'::jsonb
 when 3 then '["croquettes","3","chicken","*","|","milk","2","fish","+","chicken"]'::jsonb
 when 4 then '["fish","2","milk","+","|","chicken","3","croquettes","*","milk"]'::jsonb
 when 5 then '["milk","*","fish","2","chicken","+","|","croquettes","3","milk"]'::jsonb
 when 6 then '["croquettes","+","chicken","2","|","fish","*","milk","3","chicken"]'::jsonb
 when 7 then '["milk","2","fish","+","|","croquettes","*","chicken","3","fish"]'::jsonb
 when 8 then '["chicken","*","croquettes","2","milk","+","|","fish","3","chicken"]'::jsonb
 when 9 then '["fish","3","milk","*","|","chicken","2","croquettes","+","milk"]'::jsonb
 else '["chicken","+","milk","2","croquettes","*","|","fish","3","chicken"]'::jsonb end;

create or replace function private.draw_hand_card(p_round uuid,p_player uuid,p_ordinal integer)returns void language plpgsql volatile security definer set search_path='' as $$
declare foods public.food_type[]:=array['chicken','milk','fish','croquettes']::public.food_type[];powers public.powerup_type[]:=array['clear_plate','move_plate','change_cat','steal_for_free','change_seat']::public.powerup_type[];
begin
 if random()<.15 then insert into public.hand_cards(round_id,player_id,food,ordinal,card_kind,powerup)values(p_round,p_player,null,p_ordinal,'powerup',powers[1+floor(random()*5)::int]);
 else insert into public.hand_cards(round_id,player_id,food,ordinal,card_kind,powerup)values(p_round,p_player,foods[1+floor(random()*4)::int],p_ordinal,'food',null);end if;
end $$;

create or replace function private.deal_round(p_game uuid,p_room uuid,p_number integer,p_cat smallint,p_starter smallint,p_timer smallint)returns uuid language plpgsql security definer set search_path='' as $$
declare new_round uuid;participant record;n integer;
begin insert into public.rounds(game_id,number,cat_id,starter_seat,active_seat,deadline)values(p_game,p_number,p_cat,p_starter,p_starter,clock_timestamp()+make_interval(secs=>p_timer))returning id into new_round;
 for participant in select id from public.players where room_id=p_room and left_at is null order by seat loop for n in 1..6 loop perform private.draw_hand_card(new_round,participant.id,n);end loop;end loop;return new_round;end $$;

create or replace function private.plate_eligible(p_round uuid,p_player uuid,p_tokens jsonb)returns boolean language plpgsql stable security definer set search_path='' as $$
declare tokens text[];cards public.food_type[];ti integer:=1;ci integer:=1;start_t integer:=1;food public.food_type;modifier text;minimum integer;maximum integer;run integer;ok boolean:=true;
begin
 select array_agg(value order by ord)into tokens from jsonb_array_elements_text(p_tokens)with ordinality x(value,ord);
 select array_agg(pc.food order by pc.position)into cards from public.plate_cards pc where pc.round_id=p_round and pc.player_id=p_player;
 cards:=coalesce(cards,array[]::public.food_type[]);
 while ti<=coalesce(array_length(tokens,1),0)+1 loop
  if ti>array_length(tokens,1)or tokens[ti]='|' then
   if ok and ci=array_length(cards,1)+1 then return true;end if;ok:=true;ci:=1;ti:=ti+1;continue;
  end if;
  food:=tokens[ti]::public.food_type;modifier:=case when ti<array_length(tokens,1)and tokens[ti+1]in('*','+','2','3')then tokens[ti+1]else null end;
  if modifier is not null then ti:=ti+1;end if;
  minimum:=case modifier when '*'then 0 when '+'then 1 when '2'then 2 when '3'then 3 else 1 end;maximum:=case modifier when '*'then 32767 when '+'then 32767 when '2'then 2 when '3'then 3 else 1 end;
  run:=0;while ci+run<=coalesce(array_length(cards,1),0)and cards[ci+run]=food loop run:=run+1;end loop;
  if run<minimum then ok:=false;else ci:=ci+least(run,maximum);end if;ti:=ti+1;
 end loop;return false;end $$;

create or replace function private.send_room_message(p_room uuid,p_body text)returns public.room_messages language plpgsql security definer set search_path='' as $$
declare actor uuid;result public.room_messages;clean text:=btrim(p_body);
begin select id into actor from public.players where room_id=p_room and user_id=auth.uid()and left_at is null;if actor is null then raise exception using message='NOT_A_MEMBER';end if;if char_length(clean)not between 1 and 280 then raise exception using message='INVALID_MESSAGE';end if;if exists(select 1 from public.room_messages where player_id=actor and created_at>clock_timestamp()-interval '750 milliseconds')then raise exception using message='MESSAGE_RATE_LIMIT';end if;insert into public.room_messages(room_id,player_id,body)values(p_room,actor,clean)returning * into result;return result;end $$;
create or replace function public.send_room_message(p_room uuid,p_body text)returns public.room_messages language sql security invoker set search_path='' as $$select private.send_room_message(p_room,p_body)$$;
revoke all on function private.send_room_message(uuid,text),public.send_room_message(uuid,text)from public;grant execute on function private.send_room_message(uuid,text),public.send_room_message(uuid,text)to authenticated;

create or replace function public.reorder_plate(game_id uuid,card_ids uuid[],expected_version bigint,idempotency_key uuid)returns jsonb language plpgsql security definer set search_path='' as $$
declare actor public.players;game public.games;rnd public.rounds;i integer;result jsonb;new_version bigint;
begin select * into game from public.games where id=game_id for update;select * into actor from public.players where room_id=game.room_id and user_id=auth.uid()and left_at is null;select * into rnd from public.rounds where game_id=game.id and resolved_at is null order by number desc limit 1 for update;
 if actor.id is null then raise exception using message='NOT_A_MEMBER';end if;if rnd.phase<>'plating'or actor.seat<>rnd.active_seat then raise exception using message='NOT_YOUR_PLATING_TURN';end if;
 if coalesce(array_length(card_ids,1),0)<>(select count(*)from public.plate_cards where round_id=rnd.id and player_id=actor.id)or exists(select 1 from unnest(card_ids)x left join public.plate_cards p on p.id=x and p.round_id=rnd.id and p.player_id=actor.id where p.id is null)then raise exception using message='INVALID_ORDER';end if;
 update public.plate_cards set position=-position where round_id=rnd.id and player_id=actor.id;for i in 1..coalesce(array_length(card_ids,1),0)loop update public.plate_cards set position=i where id=card_ids[i];end loop;
 update public.games set state_version=state_version+1 where id=game.id returning state_version into new_version;result:=jsonb_build_object('game_id',game.id,'version',new_version);return result;end $$;
revoke all on function public.reorder_plate(uuid,uuid[],bigint,uuid)from public;grant execute on function public.reorder_plate(uuid,uuid[],bigint,uuid)to authenticated;

create or replace function public.use_powerup(game_id uuid,powerup_card uuid,target_players uuid[]default '{}',target_cards uuid[]default '{}',expected_version bigint default 0,idempotency_key uuid default gen_random_uuid())returns jsonb language plpgsql security definer set search_path='' as $$
declare actor public.players;game public.games;rnd public.rounds;power public.powerup_type;result jsonb;new_version bigint;replacement smallint;first_player uuid;second_player uuid;
begin
 select * into game from public.games where id=game_id for update;if game.id is null then raise exception using message='GAME_NOT_FOUND';end if;
 select * into actor from public.players where room_id=game.room_id and user_id=auth.uid()and left_at is null;select * into rnd from public.rounds where game_id=game.id and resolved_at is null order by number desc limit 1 for update;
 if actor.id is null then raise exception using message='NOT_A_MEMBER';end if;if game.state_version<>expected_version then raise exception using message='STALE_STATE';end if;if rnd.phase<>'stealing'or actor.seat<>rnd.active_seat then raise exception using message='NOT_YOUR_STEALING_TURN';end if;if actor.seat=any(rnd.powerup_used_seats)then raise exception using message='POWERUP_ALREADY_USED';end if;
 select powerup into power from public.hand_cards where id=powerup_card and round_id=rnd.id and player_id=actor.id and card_kind='powerup' for update;if power is null then raise exception using message='INVALID_POWERUP';end if;
 if power='clear_plate'then first_player:=target_players[1];if array_length(target_players,1)<>1 or not exists(select 1 from public.players where id=first_player and room_id=game.room_id and left_at is null)then raise exception using message='INVALID_TARGET';end if;delete from public.plate_cards where round_id=rnd.id and player_id=first_player;
 elsif power='move_plate'then first_player:=target_players[1];second_player:=target_players[2];if array_length(target_players,1)<>2 or first_player=second_player or (select count(*)from public.players where id=any(target_players)and room_id=game.room_id and left_at is null)<>2 then raise exception using message='INVALID_TARGET';end if;update public.plate_cards set player_id=case when player_id=first_player then second_player else first_player end where round_id=rnd.id and player_id in(first_player,second_player);
 elsif power='change_cat'then select c.id into replacement from public.cat_definitions c where c.id<>rnd.cat_id and not exists(select 1 from public.captured_cats x where x.game_id=game.id and x.cat_id=c.id)order by random()limit 1;if replacement is null then raise exception using message='NO_REPLACEMENT_CAT';end if;update public.rounds set cat_id=replacement where id=rnd.id;
 elsif power='steal_for_free'then if coalesce(array_length(target_cards,1),0)not between 1 and 2 or exists(select 1 from unnest(target_cards)x left join public.plate_cards p on p.id=x and p.round_id=rnd.id and p.player_id<>actor.id where p.id is null)then raise exception using message='INVALID_TARGET';end if;update public.plate_cards p set player_id=actor.id,position=(select coalesce(max(m.position),0)from public.plate_cards m where m.round_id=rnd.id and m.player_id=actor.id)+array_position(target_cards,p.id) where p.id=any(target_cards);
 elsif power='change_seat'then update public.players set pending_last_seat=true where id=actor.id;
 end if;
 delete from public.hand_cards where id=powerup_card;update public.rounds set powerup_used_seats=array_append(powerup_used_seats,actor.seat)where id=rnd.id;update public.games set state_version=state_version+1 where id=game.id returning state_version into new_version;result:=jsonb_build_object('game_id',game.id,'version',new_version,'powerup',power);return result;
end $$;
revoke all on function public.use_powerup(uuid,uuid,uuid[],uuid[],bigint,uuid)from public;grant execute on function public.use_powerup(uuid,uuid,uuid[],uuid[],bigint,uuid)to authenticated;

create or replace function private.apply_pending_seat(p_room uuid)returns void language plpgsql security definer set search_path='' as $$
declare mover public.players;last_seat smallint;
begin select * into mover from public.players where room_id=p_room and left_at is null and pending_last_seat order by seat limit 1;if mover.id is null then return;end if;select max(seat)into last_seat from public.players where room_id=p_room and left_at is null;update public.players set seat=-seat where room_id=p_room and left_at is null;update public.players set seat=case when -seat>mover.seat then -seat-1 when id=mover.id then last_seat else -seat end,pending_last_seat=false where room_id=p_room and left_at is null;end $$;

create or replace function private.resolve_cycle(p_game public.games,p_round public.rounds,p_room public.rooms)returns void language plpgsql security definer set search_path='' as $$
declare cat public.cat_definitions;winner uuid;winner_count integer;leaders integer;next_starter smallint;starter_player uuid;next_round integer;ended boolean;participant record;cards_needed integer;next_ordinal integer;card_number integer;
begin
 for participant in select id from public.players where room_id=p_room.id and left_at is null order by seat loop select greatest(0,6-count(*)),coalesce(max(ordinal),0)+1 into cards_needed,next_ordinal from public.hand_cards where round_id=p_round.id and player_id=participant.id;if cards_needed>0 then for card_number in 0..cards_needed-1 loop perform private.draw_hand_card(p_round.id,participant.id,next_ordinal+card_number);end loop;end if;end loop;
 select * into cat from public.cat_definitions where id=p_round.cat_id;with eligible as(select p.id,(select count(*)from public.plate_cards pc where pc.round_id=p_round.id and pc.player_id=p.id)::int cards from public.players p where p.room_id=p_room.id and p.left_at is null and private.plate_eligible(p_round.id,p.id,cat.preference_tokens)),top as(select max(cards)cards from eligible)select(array_agg(id order by id))[1],coalesce(max(cards),0),count(*)into winner,winner_count,leaders from eligible where cards=(select cards from top);
 if winner_count=0 or leaders<>1 then select id into starter_player from public.players where room_id=p_room.id and seat=p_round.starter_seat;perform private.apply_pending_seat(p_room.id);select seat into next_starter from public.players where id=starter_player;update public.rounds set phase='plating',cycle=cycle+1,active_seat=coalesce(next_starter,starter_seat),starter_seat=coalesce(next_starter,starter_seat),steals_taken=0,powerup_used_seats='{}',deadline=clock_timestamp()+make_interval(secs=>p_room.timer_seconds)where id=p_round.id;return;end if;
 update public.rounds set phase='round_result',winner_player_id=winner,resolved_at=clock_timestamp()where id=p_round.id;update public.players set score=score+cat.points where id=winner;insert into public.captured_cats(game_id,cat_id,player_id,round_id,points,capture_order)values(p_game.id,cat.id,winner,p_round.id,cat.points,p_round.number);select(p_round.number>=10)or(p_room.victory_mode='score'and exists(select 1 from public.players where room_id=p_room.id and score>=p_room.target_score))into ended;
 if ended then update public.games set status='finished',finished_at=clock_timestamp()where id=p_game.id;update public.rooms set status='finished'where id=p_room.id;insert into public.final_standings(game_id,player_id,score,placement)select p_game.id,p.id,p.score,1+(select count(*)from public.players q where q.room_id=p_room.id and q.score>p.score)from public.players p where p.room_id=p_room.id and p.left_at is null;
 else perform private.apply_pending_seat(p_room.id);next_starter:=private.next_seat(p_room.id,(select seat from public.players where id=winner));next_round:=p_round.number+1;update public.games set current_round=next_round where id=p_game.id;perform private.deal_round(p_game.id,p_room.id,next_round,next_round::smallint,next_starter,p_room.timer_seconds);end if;
end $$;

create function private.reset_powerups_for_stealing()returns trigger language plpgsql security definer set search_path='' as $$begin if old.phase='plating'and new.phase='stealing'then new.powerup_used_seats:='{}';end if;return new;end $$;
create trigger reset_powerups_for_stealing before update of phase on public.rounds for each row execute function private.reset_powerups_for_stealing();
