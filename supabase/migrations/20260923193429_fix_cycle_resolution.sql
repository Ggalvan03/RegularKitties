create or replace function private.resolve_cycle(p_game public.games,p_round public.rounds,p_room public.rooms) returns void language plpgsql security definer set search_path='' as $$
declare cat public.cat_definitions;winner uuid;winner_count integer;leaders integer;next_starter smallint;next_round integer;ended boolean;
begin
 select * into cat from public.cat_definitions where id=p_round.cat_id;
 with eligible as(select p.id,(select count(*) from public.plate_cards pc where pc.round_id=p_round.id and pc.player_id=p.id)::int cards from public.players p where p.room_id=p_room.id and p.left_at is null and private.plate_eligible(p_round.id,p.id,cat.preference_tokens)),top as(select max(cards)cards from eligible)
 select (array_agg(id order by id))[1],coalesce(max(cards),0),count(*) into winner,winner_count,leaders from eligible where cards=(select cards from top);
 if winner_count=0 or leaders<>1 then update public.rounds set phase='plating',cycle=cycle+1,active_seat=starter_seat,steals_taken=0,deadline=clock_timestamp()+make_interval(secs=>p_room.timer_seconds)where id=p_round.id;return;end if;
 update public.rounds set phase='round_result',winner_player_id=winner,resolved_at=clock_timestamp()where id=p_round.id;
 update public.players set score=score+cat.points where id=winner;
 insert into public.captured_cats(game_id,cat_id,player_id,round_id,points,capture_order)values(p_game.id,cat.id,winner,p_round.id,cat.points,p_round.number);
 select(p_round.number>=10)or(p_room.victory_mode='score'and exists(select 1 from public.players where room_id=p_room.id and score>=p_room.target_score))into ended;
 if ended then update public.games set status='finished',finished_at=clock_timestamp()where id=p_game.id;update public.rooms set status='finished'where id=p_room.id;insert into public.final_standings(game_id,player_id,score,placement)select p_game.id,p.id,p.score,1+(select count(*)from public.players q where q.room_id=p_room.id and q.score>p.score)from public.players p where p.room_id=p_room.id and p.left_at is null;
 else next_starter:=private.next_seat(p_room.id,p_round.starter_seat);next_round:=p_round.number+1;update public.games set current_round=next_round where id=p_game.id;perform private.deal_round(p_game.id,p_room.id,next_round,next_round::smallint,next_starter,p_room.timer_seconds);end if;
end $$;
