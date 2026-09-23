# Regular Kitties Implementation Plan

## Delivery strategy

Build the game in vertical slices that keep PostgreSQL authoritative from the first playable flow. Each slice ends with focused verification. Cloud resources are created only after the local application, migrations, and tests are credible, and only when both services confirm a zero-dollar selection.

## Phase 1 — Repository and local platform

1. Scaffold a pinned Next.js App Router project with TypeScript, Tailwind CSS, Vitest, and Playwright without overwriting the existing documentation or `.env`.
2. Add strict TypeScript settings, formatting scripts, test configuration, and an environment template containing variable names only.
3. Initialize local Supabase configuration through the current CLI, following command help rather than assumed flags.
4. Add browser and server Supabase clients using publishable credentials and cookie-backed anonymous sessions.
5. Establish shared domain types, typed command envelopes, error codes, and snapshot shapes.
6. Add the initial warm tabletop theme, metadata, favicon, and accessible application shell.
7. Verify type checking, unit-test startup, production build, and local Supabase startup or document any host prerequisite.

## Phase 2 — Pure rules engine

1. Define the four foods, large-card deck, preference tokens, cat fixtures, seats, phases, and score modes.
2. Implement seeded deterministic shuffle and an 80-card round deck with 20 cards per food.
3. Implement preference parsing with alternative boundaries and postfix `*`, `+`, `2`, and `3` modifiers.
4. Implement exact plate matching, unique-leader resolution, competition rankings, score-target completion, and starter rotation.
5. Implement command-level legality helpers for plating and stealing without treating them as authoritative.
6. Unit-test deck invariants, parser examples and edge cases, matching, steals, ties, rankings, end conditions, and reset behavior.

## Phase 3 — Authoritative database

1. Create migrations through the Supabase CLI for enums, definitions, rooms, players, games, rounds, hands, plate cards, actions, captured cats, and final standings.
2. Seed configurable food/operator definitions and ten explicitly provisional cats.
3. Add constraints, unique indexes, room/game/version indexes, membership indexes, and idempotency enforcement.
4. Enable RLS on every exposed table; grant only required reads and RPC execution.
5. Add safe snapshot functions for room public state and the caller's private hand.
6. Add transactional functions for create, join, ready, start, plate/pass, steal/pass, expired-turn advancement, disconnect/leave, reconnect, and rematch.
7. Ensure functions validate `auth.uid()`, membership, expected version, phase, active seat, deadline, ownership, legality, and idempotency inside the transaction.
8. Add pgTAP or SQL integration tests for successful flows, rollback, concurrency, RLS isolation, and hidden-hand protection.
9. Generate TypeScript database types and run local security/performance checks.

## Phase 4 — Typed application endpoints

1. Implement anonymous-session bootstrap and refresh-safe cookie handling.
2. Add shared request validation for nickname, code, capacity, timer, victory mode, UUID/idempotency keys, and expected versions.
3. Implement typed Next.js route handlers that invoke RPCs as the player session and normalize database errors into stable error codes.
4. Add structured sanitized logging that excludes cards, hands, tokens, keys, and credentials.
5. Add route-level tests for invalid input, session failures, stale state, and successful result shapes.

## Phase 5 — Rooms and lobby

1. Build the game-native home screen with create and join panels in the first viewport.
2. Build room configuration controls for capacity, timer, and victory condition.
3. Build the lobby with join-code copy, seats, readiness, connection status, host identity, and guarded start controls.
4. Persist the current room locally only as a navigation convenience; recover the actual seat from Supabase identity.
5. Add loading, room-closed, nickname-taken, room-full, and reconnect states.
6. Verify create/join/readiness/start with two isolated browser contexts.

## Phase 6 — Playable table

1. Build the central cat and parsed-preference display using original neutral placeholder artwork.
2. Build public player plates, scores, turn order, phase label, countdown, connection state, and activity log.
3. Build the private hand with food grouping, keyboard multi-selection, legal plating, and pass.
4. Build the stealing interaction with legal targets, visible discard cost, up-to-two steal selection, pass, and confirmation.
5. Build the round-result overlay and competition-ranked final leaderboard with rematch and leave actions.
6. Implement authoritative snapshot fetching, room-scoped Realtime invalidation, monotonic-version reconciliation, and offline move blocking.
7. Implement database-deadline advancement requests and prevent client-side timer authority.
8. Add responsive desktop, tablet, and condensed phone layouts; verify focus, labels, reduced motion, and non-color-only states.

## Phase 7 — End-to-end verification

1. Run unit, route, database, type, and production-build checks.
2. Simulate complete two-, three-, and six-player games, including tied cycles and both end conditions.
3. Exercise create, join, ready, start, plate, steal, pass, timeout, reconnect, host transfer, capture, leaderboard, and rematch in Playwright.
4. Inspect DOM, network responses, and Realtime-visible rows from separate contexts to prove private hands do not leak.
5. Run Supabase security and performance advisors and resolve findings affecting this application.

## Phase 8 — Free cloud environments and release

1. Authenticate the installed Supabase and Vercel integrations.
2. Discover existing organizations, free project slots, and Vercel team/account state without creating resources.
3. Confirm each selected preview and production resource reports a zero-dollar cost; stop for approval if any nonzero cost or required upgrade appears.
4. Create or select the preview Supabase project, apply reviewed migrations, seed fixtures, enable anonymous Auth and Realtime, generate types, and run advisors.
5. Create or link the Vercel project on Hobby, configure preview environment variable names and secret values without exposing them, and deploy a preview.
6. Run multi-browser preview verification and inspect build, runtime, database, Auth, and Realtime logs.
7. Create or select the production Supabase project, apply the identical migration set, seed fixtures, enable required services, and run advisors.
8. Configure production environment values, deploy the approved commit, run smoke tests, and inspect production logs.
9. Document the deployed URL, inactivity-restoration note, environment layout, verification evidence, and fixture-replacement procedure.

## Completion gates

- No database migration advances while its SQL or RLS tests fail.
- No UI slice is called playable until two browser identities can complete it against authoritative state.
- No preview is promoted while hidden-hand leakage, stale-command handling, timer authority, or reconnect behavior is unverified.
- No cloud resource is created when the service reports a price above $0.
- Production is complete only after an actual two-player smoke flow succeeds through the deployed URL.
