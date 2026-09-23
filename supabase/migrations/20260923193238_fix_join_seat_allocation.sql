create or replace function private.join_room(p_code text,p_nickname text) returns jsonb language plpgsql security definer set search_path='' as $$
declare uid uuid:=auth.uid();target public.rooms;existing public.players;new_player public.players;next_seat smallint;
begin
 if uid is null then raise exception using errcode='42501',message='AUTH_REQUIRED';end if;
 select * into target from public.rooms where join_code=upper(btrim(p_code)) and status='lobby' for update;
 if not found then raise exception using errcode='P0001',message='ROOM_UNAVAILABLE';end if;
 select * into existing from public.players where room_id=target.id and user_id=uid;
 if found then update public.players set is_connected=true,left_at=null,last_seen_at=clock_timestamp() where id=existing.id;return jsonb_build_object('room_id',target.id,'join_code',target.join_code,'player_id',existing.id);end if;
 if(select count(*) from public.players where room_id=target.id and left_at is null)>=target.capacity then raise exception using errcode='P0001',message='ROOM_FULL';end if;
 p_nickname:=btrim(p_nickname);if char_length(p_nickname) not between 2 and 20 then raise exception using errcode='22023',message='INVALID_NICKNAME';end if;
 if exists(select 1 from public.players p where p.room_id=target.id and lower(p.nickname)=lower(p_nickname) and p.left_at is null)then raise exception using errcode='23505',message='NICKNAME_TAKEN';end if;
 select s into next_seat from generate_series(1,target.capacity::integer) as s where not exists(select 1 from public.players p where p.room_id=target.id and p.seat=s and p.left_at is null)order by s limit 1;
 insert into public.players(room_id,user_id,nickname,seat)values(target.id,uid,p_nickname,next_seat)returning * into new_player;
 return jsonb_build_object('room_id',target.id,'join_code',target.join_code,'player_id',new_player.id);
end $$;
