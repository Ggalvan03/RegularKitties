# Lobby Sharing, Turn Feedback, Hand Refill, and Food Emoji Design

## Scope

This change improves the existing multiplayer flow without changing room structure or the core plating and stealing rules. It adds a copyable lobby invitation, makes turn changes visually obvious, restores every hand to six cards after each completed stealing phase, and presents food preference tokens as emoji.

## User experience

The lobby will expose a keyboard-accessible “Copy invite link” control alongside the room code. It copies the canonical room URL from the current origin and briefly changes its label to confirm success. If clipboard access fails, the interface reports that the link could not be copied without disturbing the lobby.

During a match, the active player remains highlighted in the score panel. Whenever the active seat changes, that player’s avatar receives a short shake animation so all players can immediately spot the new turn. The initial table load will not shake a player, and the effect will be disabled when the browser requests reduced motion.

Cat preference food tokens will render as `🐟` for fish, `🥛` for milk, `🍗` for chicken, and `🧆` for croquettes. Modifiers (`+`, `*`, `2`, and `3`) and the alternative separator (`|`) retain their current symbols. Accessible labels will preserve the food names for assistive technology.

## Authoritative hand refill

PostgreSQL remains the authoritative game engine. When the final player finishes or times out during the stealing phase, the transition will refill every active player’s hand to six cards before cycle resolution proceeds. Each player receives exactly `6 - current hand count` new random food cards; players already holding six cards receive none. This applies whether the cycle resolves to a winner or continues with the same cat.

The refill is implemented in a new forward-only Supabase migration by replacing the relevant transition functions and introducing a narrowly scoped private helper if that keeps the SQL clear. Both explicit `finish_steal` actions and timer-driven stealing completion must use the same refill behavior. The refill occurs transactionally with phase advancement and state-version mutation so clients never authorize or independently calculate it.

The existing 80-card conceptual deck is currently represented by random food generation rather than a persisted draw pile. The refill will follow that established model and generate uniformly random food types, avoiding an unrelated deck-storage redesign.

## Implementation boundaries

- Lobby clipboard state stays local to the lobby component and resets after a short confirmation interval.
- Turn animation state is derived from changes to `round.active_seat`; it does not change game state.
- Food emoji mapping is a presentation concern and does not alter stored preference tokens or parsing logic.
- The database migration changes only end-of-stealing hand replenishment and preserves existing scoring, cycle, and round behavior.

## Error handling and accessibility

Clipboard failures produce an inline status message. The copy control has a descriptive accessible name. Emoji tokens expose food names rather than relying on their visual glyphs. The shake animation uses transform-only keyframes and has a `prefers-reduced-motion: reduce` override.

## Verification

Focused tests will cover food-token-to-emoji mapping and the end-of-stealing refill invariant. Existing rules tests, type checking, linting, and a production build must pass. Multiplayer smoke or browser verification will confirm that the invite URL copies correctly, the newly active player shakes once, emoji preferences render, and all players show six hand cards after stealing completes.

After local verification, the implementation will be committed and pushed to the current GitHub branch. The linked Vercel project will be monitored until the resulting deployment reaches a ready state; a failed deployment will be inspected and corrected within the requested scope.

## Acceptance criteria

- A lobby participant can copy a full room invitation URL and receives success or failure feedback.
- Every active-seat change after initial load visibly shakes the newly active player unless reduced motion is enabled.
- Completing or timing out the final stealing turn leaves every active player with exactly six hand cards before the next cycle or round state is observed.
- Preference foods display as `🐟`, `🥛`, `🍗`, and `🧆`, while existing operator symbols remain unchanged.
- Automated checks and the production build pass, the changes are pushed to GitHub, and the corresponding Vercel deployment is ready.
