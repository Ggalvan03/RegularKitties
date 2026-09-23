create policy actions_no_direct_access on public.actions
  for all to authenticated
  using (false)
  with check (false);

create index rooms_host_idx on public.rooms(host_id);
create index rounds_cat_idx on public.rounds(cat_id);
create index rounds_winner_idx on public.rounds(winner_player_id);
create index plate_cards_player_idx on public.plate_cards(player_id);
create index captured_cats_cat_idx on public.captured_cats(cat_id);
create index captured_cats_player_idx on public.captured_cats(player_id);
create index captured_cats_round_idx on public.captured_cats(round_id);
create index final_standings_player_idx on public.final_standings(player_id);
