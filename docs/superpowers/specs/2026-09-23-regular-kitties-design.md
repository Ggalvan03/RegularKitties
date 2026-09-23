# Regular Kitties Multiplayer Web Game — Design Specification

## Product scope

Regular Kitties is a private-room, English-language, turn-based web game for two to six friends. It is desktop-first, remains usable on tablets and phones, and requires no player accounts or public matchmaking. Each browser receives a persistent anonymous Supabase identity, joins a room under a unique nickname, and plays a synchronized match whose rules are enforced by PostgreSQL.

Version one includes private rooms, configurable match settings, lobby readiness, the complete plating and stealing game loop, reconnect support, timers, scoring, rematches, and final standings. It excludes registered accounts, bots, chat, spectators, matchmaking, public room discovery, persistent profiles, and final cat artwork. Ten provisional cat fixtures will remain replaceable data rather than hard-coded game logic.

The project must operate within the Vercel Hobby and Supabase Free plans. It will not enable paid add-ons, custom domains, or resources that can incur charges. Supabase Free projects may pause after a period of low activity; that limitation is accepted for this friend-group use case.

## Architecture

The application uses Next.js App Router, TypeScript, Tailwind CSS, Vitest, and Playwright. Vercel hosts preview and production deployments. Supabase provides anonymous Auth, PostgreSQL, and Realtime.

The browser signs in anonymously, reads RLS-filtered state, subscribes to room-scoped Realtime changes, and sends commands through typed Next.js route handlers. Route handlers preserve the player's Supabase session and invoke transactional PostgreSQL RPCs. PostgreSQL is the only authoritative game engine: no client or Next.js process may directly decide or persist a turn transition, score change, card movement, timer expiry, or winner.

The rules engine has two complementary layers:

- Pure TypeScript modules define deterministic deck construction, preference parsing, plate evaluation, rankings, and presentation-oriented legality checks. They provide fast feedback and reusable client types.
- Transactional PostgreSQL functions independently enforce every authoritative mutation. They validate the authenticated player, room membership, game version, phase, active seat, deadline, card ownership, payload, and idempotency key before changing state atomically.

This duplication is intentional: TypeScript gives a testable and responsive interface, while PostgreSQL remains secure under stale, malicious, duplicated, or concurrent requests.

Environment separation is:

- Local development: local Supabase and the local Next.js server.
- Preview: the first Supabase Free cloud project and Vercel preview deployments.
- Production: the second Supabase Free cloud project and the Vercel production deployment.

Only `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` are exposed to the browser. A server-only secret is introduced only if a required operation cannot safely run as the player's session under RLS; the default design does not require one.

## Domain model

Versioned Supabase migrations define the following concepts:

- `rooms`: normalized join code, status, capacity, timer seconds, victory mode, target score, host, and lifecycle timestamps.
- `players`: room, anonymous Auth user, normalized unique nickname, seat, score, ready state, connection state, host flag, and connection timestamps.
- `games`: room, status, current round, current state version, winner state, and match timestamps.
- `rounds`: game, cat, starter seat, active seat, phase, cycle, deadline, outcome, and timestamps.
- `hands`: private card instances owned by one player for the current round.
- `plate_cards`: public card instances plated by players.
- `actions`: player, action type, idempotency key, expected and resulting versions, sanitized payload/result metadata, and timestamps.
- `captured_cats`: game, cat, capturing player, points, round, and capture order.
- `final_standings`: immutable match result rows with score and shared placement.
- Definition tables or seed data for foods, cards, operators, and cats so final names, points, preferences, and artwork can change without changing rules code.

All exposed tables have RLS enabled. Room members may read safe public state for their current room. A player may read only their own hand. Outsiders cannot discover private rooms through table reads. Browser roles receive no direct permission to change authoritative game state. Indexes cover room membership, authenticated user lookup, game and round lookup, active turns, action idempotency, and RLS predicates.

Security-definer functions, if required for atomic transitions across protected tables, live in a non-exposed schema, set a safe search path, authenticate with `auth.uid()`, validate authorization internally, and have execution revoked from `public` before narrowly scoped grants are added.

## Game rules

The food types are chicken, milk, fish, and croquettes. Every round builds and shuffles an 80-card food deck containing 20 large cards of each food and deals six cards to each player.

Each cat preference is constructed from five small-food cards interleaved with five operator cards. Small-food and operator discard piles are recycled and reshuffled whenever their decks cannot supply the next preference. The parser applies these rules:

- `|` ends one alternative and begins another.
- A food followed by no modifier requires exactly one card.
- `*`, `+`, `2`, and `3` are postfix modifiers for the preceding food.
- `*` means zero or more; `+` means one or more; `2` and `3` require exactly that quantity.
- A plate is eligible only when every card on it is consumed by one complete alternative. Extra or unrelated foods invalidate that alternative.

A cycle has two ordered phases, both beginning with the round starter and following seat order:

1. During each plating turn, the active player plays any positive number of cards of exactly one food type, or passes.
2. During each stealing turn, the active player makes zero, one, or two legal steals. Each steal discards two identical cards from the hand and moves one selected card from an opponent's plate to the stealing player's plate.

After every player finishes stealing, eligible plates are compared by total card count. A unique eligible leader captures the cat and earns its points. If no plate qualifies or the largest eligible plates tie, the same cat continues with another plating and stealing cycle. A newly captured cat rotates the starter to the next occupied seat. Every hand and plate is discarded, a fresh round is dealt, and a new cat preference is revealed.

The match ends when all ten cats are captured or a player reaches the configured target score. Final standings sort by descending score and use competition ranking, so equal scores share a placement and the next placement skips accordingly. “All cats” disables the score-target ending condition.

## Commands and concurrency

Typed route handlers expose these application commands:

- Create a room.
- Join a room by code.
- Mark the current player ready or not ready.
- Start a match.
- Submit a plating action or pass.
- Submit up to two steals or pass.
- Advance an expired turn.
- Leave a room.
- Reconnect to an existing seat.
- Start a rematch while retaining the room and seats.

Room constraints are enforced both at the endpoint boundary and in PostgreSQL: capacity 2–6 with default 4; timer 15–120 seconds with default 45; target 5–30 points with default 10 or all cats; nicknames trimmed to 2–20 characters and unique case-insensitively within the room; and short, case-insensitive, collision-checked join codes that become invalid when a room closes.

The host may start only when 2–6 players are present and every seated player is ready. If the host disconnects or leaves, host status transfers to the earliest connected player by seat creation time. Temporary disconnection preserves the seat, hand, and nickname. A returning anonymous identity reconnects to the existing seat rather than creating another player.

Every state-changing command carries a unique idempotency key and the game-state version the player acted upon. PostgreSQL serializes the affected game state, rejects stale versions, and records a successful command and transition in the same transaction. Repeated keys return the stored result without applying the transition again. Illegal or concurrent losing commands roll back completely.

Deadlines are database timestamps. Clients render a countdown using the server deadline but never decide that a turn expired. At zero, any connected client may request advancement; the database advances only when its own clock confirms expiry. An expired plating or stealing turn becomes a pass.

## Realtime and recovery

Clients fetch an authoritative snapshot before opening subscriptions. They subscribe only to safe public changes for the current room and private changes for their own hand. Realtime events are invalidation signals rather than authoritative patches: the client refetches or reconciles against a snapshot and ignores versions older than the newest applied version.

When the network drops, the interface shows an explicit offline or reconnecting state and disables moves. On recovery it refreshes the Auth session, fetches a complete authoritative snapshot, then resumes subscriptions. A brief Realtime failure does not corrupt play; reconnecting or a lightweight fallback refetch restores the current state.

Structured logs record command type, transition, game and room identifiers, version, duration, and sanitized error codes. Logs never include credentials, access tokens, full command payloads containing private cards, or complete hand contents.

## User experience

The visual direction is a warm, tactile tabletop game with crisp modern controls: soft paper-like surfaces, restrained playful color, strong food symbols, and original neutral cat illustrations. It must feel like the game itself, not a marketing page. Status is communicated by text and shape as well as color.

The home screen immediately offers create-room and join-room flows. Creation collects nickname, capacity, timer, and victory condition. Joining collects a room code and nickname while anonymous sign-in happens in the background.

The lobby displays the join code, seated nicknames, readiness and connection states, host identity, and host controls. Copying the join code is keyboard accessible. The host receives a clear explanation when start is unavailable.

The game table keeps the current cat and parsed preference central. Public plates, scores, seat order, phase, active player, server deadline countdown, and a concise activity log remain visible. The local player's private hand and context-sensitive actions occupy a stable bottom action area. Legal choices are emphasized; unavailable actions remain understandable through labels or help text.

Plating supports multi-select for one food type and an explicit pass. Stealing shows only legal opponent cards, the two-card discard cost, and remaining steals. Submission of a steal receives a confirmation step because it irreversibly spends cards. A round-result overlay shows the captured cat, points, and updated standings. The final leaderboard offers rematch and leave-room actions.

Desktop and tablet layouts receive the full table treatment. Phones use a condensed vertical composition without removing any required action. All controls work by keyboard, have visible focus states and accessible names, respect reduced-motion preferences, and avoid color-only meaning.

## Error states

Expected command failures use stable, typed error codes and plain player-facing messages: room unavailable, nickname taken, room full, not ready, not host, wrong phase, not active player, stale state, illegal card selection, deadline not reached, and session mismatch. A stale-state response triggers an authoritative refresh rather than retrying the mutation automatically.

Loading states preserve the table structure. Empty states explain the next valid action. Unexpected failures keep private data out of diagnostics, provide a safe retry for reads, and never imply a move succeeded without an authoritative resulting version.

## Verification

Vitest covers deterministic shuffling, deck composition, preference tokenization and parsing, alternative boundaries, every modifier, exact plate matching, unrelated-card rejection, legal stealing costs, ties, rankings, score targets, and round reset behavior.

Database tests cover each RPC's valid path and rejection cases, including outsiders, wrong turns, invalid cards, duplicate idempotency keys, stale versions, timer expiry, simultaneous submissions, rollback, host transfer, reconnection, and rematch. RLS tests prove outsiders cannot read rooms, players cannot read another hand, and browser roles cannot directly mutate authoritative state.

Integration tests simulate complete two-, three-, and six-player matches, repeated tied cycles, score-target completion, and all-cats completion. Playwright uses separate browser contexts to verify room creation and joining, readiness, match start, plating, stealing, passing, timer auto-pass, reconnect, host transfer, cat capture, rematch, and final standings. Tests also inspect HTML, endpoint responses, and Realtime-visible data to ensure one player's hand never leaks to another.

Before production release, the project must pass type checking, unit tests, database tests, production build, and representative multi-browser flows. Supabase security and performance advisors must be reviewed after schema changes. The Vercel preview must be exercised before promotion, and preview/production build and runtime logs must show no unresolved application errors.

## Delivery and operations

Dependencies are pinned and the lockfile is committed. The repository contains an environment-variable template with names but no values, generated TypeScript database types, reproducible migrations, seed data for provisional cats, and setup instructions.

Cloud work begins only after confirming the selected Supabase organization/project slots and Vercel Hobby account. No paid resource is created. If either service reports a nonzero price, unavailable free quota, or a required paid upgrade, work stops before creation and presents the exact cost and constraint for approval.

The delivery sequence is local implementation and verification, preview Supabase setup, Vercel preview deployment and multi-browser verification, production Supabase migration, production environment configuration, production deployment, and final smoke testing.

## Acceptance criteria

- Two to six people can complete a synchronized match from separate browsers through the deployed URL.
- PostgreSQL rejects cheating, stale actions, invalid ownership, out-of-turn actions, and duplicate submissions.
- A refresh or brief disconnect does not lose a player's seat or hand.
- Other players' hands are absent from unauthorized HTML, queries, endpoint responses, and Realtime data.
- Timers advance only after the database deadline and expired turns become passes.
- All ten provisional cats are playable and replaceable through data changes.
- Equal final scores share placement without an additional tie-breaker.
- Preview and production remain on free Vercel and Supabase resources, subject to Supabase inactivity pausing.
