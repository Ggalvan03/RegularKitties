create extension if not exists pgcrypto;
create schema if not exists private;
revoke all on schema private from public;

create type public.room_status as enum ('lobby', 'playing', 'finished', 'closed');
create type public.game_phase as enum ('plating', 'stealing', 'resolving', 'round_result', 'finished');
create type public.food_type as enum ('chicken', 'milk', 'fish', 'croquettes');
create type public.victory_mode as enum ('score', 'all_cats');

create table public.rooms (
  id uuid primary key default gen_random_uuid(),
  join_code text not null unique check (join_code ~ '^[A-Z2-9]{6}$'),
  host_id uuid,
  status public.room_status not null default 'lobby',
  capacity smallint not null default 4 check (capacity between 2 and 6),
  timer_seconds smallint not null default 45 check (timer_seconds between 15 and 120),
  victory_mode public.victory_mode not null default 'score',
  target_score smallint check (
    (victory_mode = 'all_cats' and target_score is null) or
    (victory_mode = 'score' and target_score between 5 and 30)
  ),
  created_at timestamptz not null default clock_timestamp(),
  closed_at timestamptz
);

create table public.players (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.rooms(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  nickname text not null check (char_length(btrim(nickname)) between 2 and 20),
  seat smallint not null check (seat between 1 and 6),
  score integer not null default 0 check (score >= 0),
  is_ready boolean not null default false,
  is_connected boolean not null default true,
  is_host boolean not null default false,
  joined_at timestamptz not null default clock_timestamp(),
  last_seen_at timestamptz not null default clock_timestamp(),
  left_at timestamptz,
  unique (room_id, user_id),
  unique (room_id, seat)
);
create unique index players_room_nickname_unique on public.players(room_id, lower(nickname)) where left_at is null;

alter table public.rooms add constraint rooms_host_fk foreign key (host_id) references public.players(id) deferrable initially deferred;

create table public.cat_definitions (
  id smallint primary key check (id between 1 and 10),
  slug text not null unique,
  name text not null,
  points smallint not null check (points between 1 and 9),
  preference_tokens jsonb not null check (jsonb_typeof(preference_tokens) = 'array'),
  artwork_path text,
  is_provisional boolean not null default true
);

create table public.games (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.rooms(id) on delete cascade,
  state_version bigint not null default 1 check (state_version > 0),
  current_round integer not null default 0 check (current_round >= 0),
  status public.room_status not null default 'playing',
  started_at timestamptz not null default clock_timestamp(),
  finished_at timestamptz
);
create unique index one_active_game_per_room on public.games(room_id) where status = 'playing';

create table public.rounds (
  id uuid primary key default gen_random_uuid(),
  game_id uuid not null references public.games(id) on delete cascade,
  number integer not null check (number > 0),
  cat_id smallint not null references public.cat_definitions(id),
  starter_seat smallint not null check (starter_seat between 1 and 6),
  active_seat smallint not null check (active_seat between 1 and 6),
  phase public.game_phase not null default 'plating',
  cycle integer not null default 1 check (cycle > 0),
  deadline timestamptz not null,
  winner_player_id uuid references public.players(id),
  created_at timestamptz not null default clock_timestamp(),
  resolved_at timestamptz,
  unique (game_id, number)
);

create table public.hand_cards (
  id uuid primary key default gen_random_uuid(),
  round_id uuid not null references public.rounds(id) on delete cascade,
  player_id uuid not null references public.players(id) on delete cascade,
  food public.food_type not null,
  ordinal smallint not null,
  unique (round_id, player_id, ordinal)
);

create table public.plate_cards (
  id uuid primary key default gen_random_uuid(),
  round_id uuid not null references public.rounds(id) on delete cascade,
  player_id uuid not null references public.players(id) on delete cascade,
  food public.food_type not null,
  source_hand_card_id uuid,
  plated_at timestamptz not null default clock_timestamp()
);

create table public.actions (
  id uuid primary key default gen_random_uuid(),
  game_id uuid not null references public.games(id) on delete cascade,
  player_id uuid not null references public.players(id) on delete cascade,
  idempotency_key uuid not null,
  action_type text not null,
  expected_version bigint not null,
  resulting_version bigint,
  public_result jsonb,
  error_code text,
  created_at timestamptz not null default clock_timestamp(),
  unique (player_id, idempotency_key)
);

create table public.captured_cats (
  game_id uuid not null references public.games(id) on delete cascade,
  cat_id smallint not null references public.cat_definitions(id),
  player_id uuid not null references public.players(id),
  round_id uuid not null references public.rounds(id),
  points smallint not null,
  capture_order smallint not null,
  captured_at timestamptz not null default clock_timestamp(),
  primary key (game_id, cat_id),
  unique (game_id, capture_order)
);

create table public.final_standings (
  game_id uuid not null references public.games(id) on delete cascade,
  player_id uuid not null references public.players(id),
  score integer not null,
  placement smallint not null check (placement > 0),
  primary key (game_id, player_id)
);

create index players_user_room_idx on public.players(user_id, room_id);
create index players_room_active_idx on public.players(room_id, seat) where left_at is null;
create index games_room_idx on public.games(room_id, state_version);
create index rounds_game_phase_idx on public.rounds(game_id, phase, deadline);
create index hand_cards_owner_idx on public.hand_cards(player_id, round_id);
create index plate_cards_round_idx on public.plate_cards(round_id, player_id);
create index actions_game_idx on public.actions(game_id, created_at desc);

insert into public.cat_definitions (id, slug, name, points, preference_tokens, artwork_path) values
  (1, 'marmalade', 'Marmalade', 1, '["fish","|","milk","+"]', '/cat-placeholder.png'),
  (2, 'mittens', 'Mittens', 1, '["chicken","2"]', '/cat-placeholder.png'),
  (3, 'bean', 'Bean', 2, '["croquettes","+","milk"]', '/cat-placeholder.png'),
  (4, 'toast', 'Toast', 2, '["fish","+","|","chicken"]', '/cat-placeholder.png'),
  (5, 'pepper', 'Pepper', 2, '["milk","*","fish","2"]', '/cat-placeholder.png'),
  (6, 'pocket', 'Pocket', 3, '["croquettes","3","|","chicken","+"]', '/cat-placeholder.png'),
  (7, 'olive', 'Olive', 3, '["milk","+","fish","+"]', '/cat-placeholder.png'),
  (8, 'waffle', 'Waffle', 3, '["chicken","*","croquettes","+"]', '/cat-placeholder.png'),
  (9, 'noodle', 'Noodle', 4, '["fish","3","milk","+"]', '/cat-placeholder.png'),
  (10, 'socks', 'Socks', 5, '["chicken","+","milk","+","croquettes","+"]', '/cat-placeholder.png');

alter table public.rooms enable row level security;
alter table public.players enable row level security;
alter table public.cat_definitions enable row level security;
alter table public.games enable row level security;
alter table public.rounds enable row level security;
alter table public.hand_cards enable row level security;
alter table public.plate_cards enable row level security;
alter table public.actions enable row level security;
alter table public.captured_cats enable row level security;
alter table public.final_standings enable row level security;

create function private.is_room_member(target_room uuid) returns boolean language sql stable security definer set search_path = '' as $$
  select exists(select 1 from public.players p where p.room_id = target_room and p.user_id = (select auth.uid()) and p.left_at is null)
$$;

create policy rooms_member_read on public.rooms for select to authenticated using (private.is_room_member(id));
create policy players_member_read on public.players for select to authenticated using (private.is_room_member(room_id));
create policy cats_authenticated_read on public.cat_definitions for select to authenticated using (true);
create policy games_member_read on public.games for select to authenticated using (private.is_room_member(room_id));
create policy rounds_member_read on public.rounds for select to authenticated using (exists(select 1 from public.games g where g.id = game_id and private.is_room_member(g.room_id)));
create policy own_hand_read on public.hand_cards for select to authenticated using (exists(select 1 from public.players p where p.id = player_id and p.user_id = (select auth.uid())));
create policy plates_member_read on public.plate_cards for select to authenticated using (exists(select 1 from public.players p where p.id = player_id and private.is_room_member(p.room_id)));
create policy captures_member_read on public.captured_cats for select to authenticated using (exists(select 1 from public.games g where g.id = game_id and private.is_room_member(g.room_id)));
create policy standings_member_read on public.final_standings for select to authenticated using (exists(select 1 from public.games g where g.id = game_id and private.is_room_member(g.room_id)));

create function private.new_join_code() returns text language plpgsql volatile set search_path = '' as $$
declare candidate text;
begin
  loop
    candidate := upper(substr(translate(encode(gen_random_bytes(8), 'base64'), '/+=01', 'ABCDE'), 1, 6));
    candidate := regexp_replace(candidate, '[^A-Z2-9]', 'K', 'g');
    exit when not exists(select 1 from public.rooms where join_code = candidate and status <> 'closed');
  end loop;
  return candidate;
end $$;

create function private.create_room(p_nickname text, p_capacity smallint, p_timer_seconds smallint, p_victory_mode public.victory_mode, p_target_score smallint)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare uid uuid := auth.uid(); new_room public.rooms; new_player public.players;
begin
  if uid is null then raise exception using errcode = '42501', message = 'AUTH_REQUIRED'; end if;
  p_nickname := btrim(p_nickname);
  if char_length(p_nickname) not between 2 and 20 then raise exception using errcode = '22023', message = 'INVALID_NICKNAME'; end if;
  insert into public.rooms(join_code, capacity, timer_seconds, victory_mode, target_score)
  values(private.new_join_code(), p_capacity, p_timer_seconds, p_victory_mode, p_target_score) returning * into new_room;
  insert into public.players(room_id, user_id, nickname, seat, is_host)
  values(new_room.id, uid, p_nickname, 1, true) returning * into new_player;
  update public.rooms set host_id = new_player.id where id = new_room.id;
  return jsonb_build_object('room_id', new_room.id, 'join_code', new_room.join_code, 'player_id', new_player.id);
end $$;

create function private.join_room(p_code text, p_nickname text) returns jsonb language plpgsql security definer set search_path = '' as $$
declare uid uuid := auth.uid(); target public.rooms; existing public.players; new_player public.players; next_seat smallint;
begin
  if uid is null then raise exception using errcode = '42501', message = 'AUTH_REQUIRED'; end if;
  select * into target from public.rooms where join_code = upper(btrim(p_code)) and status = 'lobby' for update;
  if not found then raise exception using errcode = 'P0001', message = 'ROOM_UNAVAILABLE'; end if;
  select * into existing from public.players where room_id = target.id and user_id = uid;
  if found then update public.players set is_connected = true, left_at = null, last_seen_at = clock_timestamp() where id = existing.id; return jsonb_build_object('room_id', target.id, 'join_code', target.join_code, 'player_id', existing.id); end if;
  if (select count(*) from public.players where room_id = target.id and left_at is null) >= target.capacity then raise exception using errcode = 'P0001', message = 'ROOM_FULL'; end if;
  p_nickname := btrim(p_nickname);
  if char_length(p_nickname) not between 2 and 20 then raise exception using errcode = '22023', message = 'INVALID_NICKNAME'; end if;
  if exists(select 1 from public.players p where p.room_id = target.id and lower(p.nickname) = lower(p_nickname) and p.left_at is null) then raise exception using errcode = '23505', message = 'NICKNAME_TAKEN'; end if;
  select seat into next_seat from generate_series(1, target.capacity) seat where not exists(select 1 from public.players p where p.room_id = target.id and p.seat = seat and p.left_at is null) order by seat limit 1;
  insert into public.players(room_id, user_id, nickname, seat) values(target.id, uid, p_nickname, next_seat) returning * into new_player;
  return jsonb_build_object('room_id', target.id, 'join_code', target.join_code, 'player_id', new_player.id);
end $$;

create function private.set_ready(p_room_id uuid, p_ready boolean) returns jsonb language plpgsql security definer set search_path = '' as $$
declare changed public.players;
begin
  update public.players set is_ready = p_ready, last_seen_at = clock_timestamp()
  where public.players.room_id = p_room_id and user_id = auth.uid() and left_at is null returning * into changed;
  if not found then raise exception using errcode = '42501', message = 'NOT_A_MEMBER'; end if;
  return jsonb_build_object('player_id', changed.id, 'ready', changed.is_ready);
end $$;

create function public.create_room(nickname text, capacity smallint default 4, timer_seconds smallint default 45, victory_mode public.victory_mode default 'score', target_score smallint default 10) returns jsonb language sql security invoker set search_path = '' as $$ select private.create_room(nickname, capacity, timer_seconds, victory_mode, target_score) $$;
create function public.join_room(code text, nickname text) returns jsonb language sql security invoker set search_path = '' as $$ select private.join_room(code, nickname) $$;
create function public.set_ready(room_id uuid, ready boolean) returns jsonb language sql security invoker set search_path = '' as $$ select private.set_ready(room_id, ready) $$;

revoke all on all tables in schema public from anon, authenticated;
grant select on public.rooms, public.players, public.cat_definitions, public.games, public.rounds, public.hand_cards, public.plate_cards, public.captured_cats, public.final_standings to authenticated;
grant usage on schema private to authenticated;
revoke all on all functions in schema private from public;
grant execute on function private.create_room(text, smallint, smallint, public.victory_mode, smallint), private.join_room(text, text), private.set_ready(uuid, boolean), private.is_room_member(uuid) to authenticated;
revoke all on function public.create_room(text, smallint, smallint, public.victory_mode, smallint), public.join_room(text, text), public.set_ready(uuid, boolean) from public;
grant execute on function public.create_room(text, smallint, smallint, public.victory_mode, smallint), public.join_room(text, text), public.set_ready(uuid, boolean) to authenticated;

alter publication supabase_realtime add table public.rooms, public.players, public.games, public.rounds, public.plate_cards, public.captured_cats;
