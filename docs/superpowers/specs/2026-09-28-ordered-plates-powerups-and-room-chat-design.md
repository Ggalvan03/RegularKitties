# Ordered Plates, Power-Ups, and Room Chat Design

## Scope

This change expands the existing Regular Kitties multiplayer match with ordered plate logic, compact stacked plate rendering, collectible power-up cards, a six-player-focused table layout, and persistent room chat. PostgreSQL remains authoritative for all game mutations. The client renders and submits intent but never decides whether an ordered plate, power-up, seat change, or chat message is valid.

## Ordered cat requirements

Cat preferences become order-sensitive. A plate must match one complete alternative from left to right with no unrelated or unconsumed cards. The postfix operators retain these meanings:

- A food without a modifier consumes exactly one matching card.
- `*` consumes zero or more consecutive cards of the preceding food.
- `+` consumes one or more consecutive cards of the preceding food.
- `2` and `3` consume exactly that many consecutive cards of the preceding food.
- `|` ends one complete alternative and begins another; it may not be first, last, or adjacent to another `|`.

Repeated foods are allowed inside one alternative because their positions disambiguate them. For example, `Chicken* Fish2 Chicken3` accepts a run of zero or more chicken, followed by exactly two fish, followed by exactly three chicken. Four chicken followed by two fish and three chicken is valid because the first four are consumed by `Chicken*`; four total chicken and two fish without the trailing three-chicken run is invalid.

Every cat definition contains exactly five food tokens and five operator tokens. Operators include postfix modifiers and alternative separators. All ten provisional cat definitions will be replaced with curated expressions meeting those constraints, and `|` will never be the final token. Cat requirements render at a substantially larger scale using the existing food artwork rather than emoji.

## Ordered plates and visual stacks

`plate_cards` gains an authoritative position within each player's plate. Plating appends cards in the chosen order. During their own plating turn, a player may enter reorder mode and drag individual cards into a new sequence. Saving the sequence is a versioned transactional command that verifies the phase, active seat, ownership, complete card set, unique positions, and idempotency key.

Outside reorder mode, each maximal consecutive run of identical food cards collapses into a visual stack. The stack shows the existing food image and a circular count badge in its top-right corner. Non-adjacent cards of the same food remain separate stacks because plate order is meaningful. Reorder mode expands the local player's stacks into individual cards; after saving, consecutive identical cards collapse again.

## Power-up cards

Power-ups share the six-card hand limit with food cards. Every dealt or refill card independently has an exact 15 percent chance to be a power-up. When a power-up is selected, its five types are equally likely. Food types remain equally likely within the other 85 percent. Tests use injected deterministic random values so the probability boundaries and resulting card types are reproducible.

`hand_cards` distinguishes food and power-up cards with a constrained card kind and nullable food or power-up type. Exactly one payload is present for each card. Power-ups cannot be plated or used as a normal steal cost. A consumed power-up is removed from the hand, and the hand is not replenished until the normal end-of-stealing refill.

A player may use at most one power-up during their own stealing turn:

- **Clear Plate:** choose one active player, including self. All cards on that player's plate are discarded.
- **Move Plate:** choose two distinct active players, including self. Their complete plates exchange owners while preserving each plate's internal order.
- **Change Cat:** replace the current cat with a uniformly random uncaptured cat other than the current cat. Plates, phase, active player, deadline, normal steal count, and plate order remain unchanged. The replaced cat returns to the uncaptured pool.
- **Steal for Free:** choose one or two cards across one or more opponents' plates. The cards move to the acting player's plate in the selected order without a food-card payment and without incrementing the normal two-steal counter.
- **Change Seat:** queue the acting player to occupy the final active seat the next time the game enters a plating phase. Other active players shift forward to leave contiguous seats. The queued change is applied atomically before the next plating turn is exposed, whether that phase begins a tied continuation cycle or a new cat round.

The game records whether a power-up was used during each player's current stealing turn and resets that marker when their next stealing turn begins. Every power-up command validates authenticated membership, card ownership, active turn, stealing phase, targets, state version, idempotency, and power-up allowance before applying any mutation.

Each power-up receives an original illustrated card image in the same warm, tactile style as the existing food cards. The visual concepts are an emptied plate for Clear Plate, two crossing plates for Move Plate, rotating cat silhouettes for Change Cat, a paw lifting two food cards for Steal for Free, and a cat chair moving to the end of the table for Change Seat. Hover, keyboard focus, and touch selection reveal the card name and plain-language description.

## Six-player table layout

The game adopts the approved reference-inspired composition without copying the reference artwork:

- The central board is the dominant area and displays all six plates in a compact three-by-two grid.
- The current cat and large ordered requirement sit above the plate grid.
- A fixed right rail contains room chat followed by compact player status rows.
- The local hand and contextual actions span the bottom of the board area.
- Player status, plate borders, avatars, and chat names use the same six-color palette.

The interface fits six players by reducing redundant padding, panel heights, and card footprints rather than applying CSS `zoom`, preserving readable text, browser scaling, focus outlines, and pointer targets. Tablet and phone layouts stack the right rail below the central board and keep chat collapsible without removing any actions.

Player colors are deterministic by current seat and are never accepted from a client payload. If Change Seat moves players, their displayed avatar, plate, status, and chat-name colors update together to the new seat color.

## Room chat

Chat is available in both lobby and match views and persists for the life of the room. A `room_messages` table stores the room, authenticated sender player, validated body, and database timestamp. The client does not provide nickname or color fields; those are resolved from the current player row when messages render.

Only active room members may read or insert messages. Messages are trimmed, must contain 1–280 characters, and are immutable. The UI initially loads the latest 100 messages in chronological order and subscribes to room-scoped Realtime inserts. Older messages remain in the database but pagination is outside this change. A database-enforced short cooldown prevents accidental flooding while keeping ordinary conversation responsive.

The chat rail scrolls independently, announces new messages accessibly without stealing focus, preserves draft text during game refreshes, and uses the same player color as the sender's current avatar. System activity such as power-up use remains visually distinct from player messages and may be derived from authoritative action records rather than inserted as user-authored chat.

## Data and command boundaries

A forward-only Supabase migration will:

- Extend hand cards with constrained food/power-up variants.
- Add ordered positions and supporting uniqueness to plate cards.
- Add power-up-use and pending-seat-change state at the appropriate round/player scope.
- Replace all cat preference fixtures with valid five-food/five-operator ordered expressions.
- Replace plate evaluation with deterministic ordered matching.
- Update dealing, refill, normal stealing, resolution, and timer functions for mixed hands and ordered plates.
- Add transactional commands for plate reordering and power-up use.
- Add room messages, indexes, grants, RLS policies, and Realtime publication.

Typed route-handler schemas expose only the new command intents and validate array sizes, target identifiers, reorder payloads, and chat length before invoking Supabase. PostgreSQL independently repeats every security and game-rule validation inside the transaction.

UI responsibilities are separated into focused components for the ordered requirement, plate stacks/reordering, mixed hand cards, power-up targeting, player status rows, and room chat. The current monolithic game-table component will coordinate fetched state while these components own rendering and local interaction state.

## Error handling and accessibility

Expected failures use stable public codes for invalid order, incomplete order, wrong phase, wrong turn, stale state, power-up already used, invalid power-up target, unavailable replacement cat, invalid card kind, chat rate limit, and invalid message length. A stale command refreshes authoritative state and never retries the mutation automatically.

Dragging has keyboard controls: a focused plated card can move left or right, and an explicit save/cancel pair completes reorder mode. Stack counts have accessible labels such as “three chicken cards.” Power-up descriptions appear on focus as well as hover, and touch selection opens the same description before confirmation. Player identity never relies on color alone; names and active-turn text remain present.

## Verification

Pure rule tests cover full-sequence consumption, postfix modifiers, alternative boundaries, repeated foods, zero-length `*`, extra-card rejection, and all ten five-food/five-operator fixtures. Presentation tests cover consecutive-run grouping without merging separated foods.

Database tests cover mixed six-card dealing and refill probability boundaries, food-only plating and steal costs, reorder ownership and permutations, every valid power-up path, invalid targets, one-power-up-per-turn enforcement, free steals not affecting normal steals, random uncaptured cat selection, queued seat compaction, rollback, stale versions, duplicate idempotency keys, and timer transitions.

Chat tests prove member-only reads/inserts, sender identity derivation, trimming, empty and oversized rejection, cooldown behavior, immutable rows, and outsider denial. Multiplayer smoke tests confirm ordered matching and six-card refills with power-ups. Browser tests cover the six-player viewport, larger requirement artwork, stack badges, mouse and keyboard reordering, power-up descriptions and targeting, synchronized colors, and chat continuity from lobby into the match.

Before release, unit tests, type checking, lint, production build, migration replay or production-safe SQL validation, multiplayer smoke tests, and browser verification must pass. The migration will be applied to the linked Supabase project, the implementation and generated artwork committed and pushed to GitHub, and the Vercel production deployment monitored until ready and smoke-tested.

## Acceptance criteria

- Cat requirements and plates are evaluated in left-to-right order with complete consumption.
- All ten cats show exactly five food items and five operators, with no trailing `|`.
- Players can reorder only their own plate during their own plating turn.
- Consecutive identical foods render as one stack with a circular count badge.
- Power-ups occupy hand slots, draw at 15 percent per card, and only one may be used during the owner's stealing turn.
- All five power-ups follow the targeting and transition rules in this specification.
- Six players and their plates fit the desktop game view without CSS zoom.
- Lobby and match share a member-only room chat with synchronized player colors.
- The complete change passes automated and multiplayer verification and is live on the ready Vercel production deployment.
