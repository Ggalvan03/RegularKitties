create function private.advance_expired(p_game_id uuid,p_expected bigint,p_idem uuid)returns jsonb language plpgsql security definer set search_path='' as $$
declare caller public.players;game public.games;rnd public.rounds;room public.rooms;nxt smallint;result jsonb;new_version bigint;
begin
 select * into game from public.games where id=p_game_id for update;if not found then raise exception using message='GAME_NOT_FOUND';end if;
 select * into room from public.rooms where id=game.room_id;select * into caller from public.players where room_id=room.id and user_id=auth.uid()and left_at is null;if not found then raise exception using errcode='42501',message='NOT_A_MEMBER';end if;
 select public_result into result from public.actions where player_id=caller.id and idempotency_key=p_idem;if found then return result;end if;
 if game.state_version<>p_expected then raise exception using message='STALE_STATE';end if;
 select * into rnd from public.rounds where game_id=game.id and resolved_at is null order by number desc limit 1 for update;
 if clock_timestamp()<rnd.deadline then raise exception using message='DEADLINE_NOT_REACHED';end if;
 nxt:=private.next_seat(room.id,rnd.active_seat);
 if nxt=rnd.starter_seat then if rnd.phase='plating'then update public.rounds set phase='stealing',active_seat=starter_seat,steals_taken=0,deadline=clock_timestamp()+make_interval(secs=>room.timer_seconds)where id=rnd.id;else perform private.resolve_cycle(game,rnd,room);end if;
 else update public.rounds set active_seat=nxt,steals_taken=0,deadline=clock_timestamp()+make_interval(secs=>room.timer_seconds)where id=rnd.id;end if;
 update public.games set state_version=state_version+1 where id=game.id returning state_version into new_version;result:=jsonb_build_object('game_id',game.id,'version',new_version);
 insert into public.actions(game_id,player_id,idempotency_key,action_type,expected_version,resulting_version,public_result)values(game.id,caller.id,p_idem,'advance_expired',p_expected,new_version,result);return result;
end $$;
create function public.advance_expired(game_id uuid,expected_version bigint,idempotency_key uuid)returns jsonb language sql security invoker set search_path='' as $$select private.advance_expired(game_id,expected_version,idempotency_key)$$;
revoke all on function public.advance_expired(uuid,bigint,uuid)from public;grant execute on function public.advance_expired(uuid,bigint,uuid)to authenticated;grant execute on function private.advance_expired(uuid,bigint,uuid)to authenticated;
