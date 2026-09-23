create function private.deal_round(p_game uuid,p_room uuid,p_number integer,p_cat integer,p_starter integer,p_timer smallint) returns uuid language sql security definer set search_path='' as $$
 select private.deal_round(p_game,p_room,p_number,p_cat::smallint,p_starter::smallint,p_timer)
$$;
grant execute on function private.deal_round(uuid,uuid,integer,integer,integer,smallint) to authenticated;
