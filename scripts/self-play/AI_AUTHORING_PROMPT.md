# Chess.Football — Master AI Authoring & Training Prompt

> **Purpose of this document.** This is the complete, self-contained context for
> creating and improving a Chess.Football AI opponent. Hand it (whole, verbatim) to
> an LLM or a developer and they should be able to author a strong, *characterful*,
> non-deterministic AI `play()` function — and understand the game, its objective
> and the experience we want the player to have — without any other reference.
>
> It is written to be used as a **prompt**: paste it, then add a final instruction
> such as *"Write the `play` function for the EXPERT tier with the persona of
> 'Claude Sonnet', following every rule and strategic principle below."*

---

## 1. Identity, purpose & the experience we want

**Chess.Football** is a turn-based strategy game: chess geometry, football objective.
Two sides (white, black) maneuver chess-like pieces on a tall grid to pass a single
ball into the **opponent's king**, who acts as the goalkeeper. First to a target
number of goals wins.

The game ships on CrazyGames as the **AI Champions** mode: the human plays a
**championship bracket** against a ladder of AI personalities (themed as famous AI
models — *Claude Sonnet*, *ChatGPT*, *Gemini*, *Claude Fable*…). 

**The experience we are designing for:**
- Winning the championship must feel like a *real* achievement. Early opponents
  teach the game; later ones genuinely punish mistakes.
- Each AI must feel like a **distinct opponent with a personality**, not the same
  bot at different speeds.
- Crucially, the AI must **not be deterministic**. The original scripts always made
  the identical move in the identical position, so a human could memorise one
  winning line and repeat it forever. A good opponent varies its play, so every
  match feels fresh and the player must actually *understand* the game to win.

When you author an AI, optimise for **"a human should respect this opponent"**:
sound defence, punishes hung balls, takes its chances, and surprises.

---

## 2. Objective & game flow

- A **goal** = the ball is passed so that the **rival king** is the first piece on
  the ball's straight path. First side to the goal target wins.
- The **goal target** (1–10, championship default 3) is fixed at match creation and
  is **NOT present in `BoardState`** — your script *cannot* read how many goals
  remain. Just play every turn to score and avoid conceding. There are **no draws**.
- Play alternates turns. On your turn you have **Action Points (AP)**, which are
  **configurable per game (1–5, default 5)**. Read the budget from
  `boardState.actionPoints` (remaining this turn) and `boardState.maxActionPoints`
  (the per-turn total) — **never assume a fixed 5**. Each move or pass costs 1 AP.
  Your turn ends when AP hit 0, when a pass is intercepted, when you concede/score,
  or when you voluntarily end it (`end_turn`, which forfeits remaining AP).
- After a goal, the board resets to a kickoff and the **conceding side serves**: its
  Queen starts with the ball at her central square, and the conceding team takes the
  first turn. (Opening kickoff: in online PvP **white** serves first; in training vs
  AI the side chosen by the human serves.)

---

## 3. Complete rules

### Board & coordinates
- Grid is **9 wide × 12 tall**. `Position = { x: 0..8, y: 0..11 }`.
  - `x` → columns A–I (`x=0`→A … `x=8`→I).
  - `y` → ranks 1–12 (`y=0`→rank 1 … `y=11`→rank 12).
- **White** defends the bottom (ranks 1–2), attacks upward toward rank 12.
  **Black** defends the top (ranks 11–12), attacks downward toward rank 1.
- **Penalty areas** (where each king is confined): columns C–G (`x` 2–6).
  - White area: `y` 0–1. Black area: `y` 10–11.

### Pieces & movement (each side: 1 King, 1 Queen, 2 Rooks, 2 Bishops, 2 Knights)
- **King** (the goalkeeper): one square any direction, **confined to its own
  penalty area** (it can never leave, even carrying the ball).
- **Queen**: any distance, straight or diagonal (a **move** is blocked by the first
  piece on its path — yours OR the enemy's).
- **Rook**: any distance, orthogonal (move blocked by pieces).
- **Bishop**: any distance, diagonal (move blocked by pieces).
- **Knight**: L-shape jump (±2,±1)/(±1,±2), **ignores intervening pieces**.
- **No non-king piece may enter its OWN penalty area.** (They may enter the enemy's
  — but see *offside*.)
- **The rival king is untouchable**: no piece may *move* onto the rival king's
  square. The king is reached **only by a pass** (= a goal). You cannot tackle a king.
- **Each piece may move at most once per turn** (`hasMovedThisTurn`). A piece **may
  both move AND pass** in the same turn (2 AP); several different pieces may move in
  one turn.
- Always derive legal targets from `getValidMoves(piece, board)` /
  `getValidPasses(holder, board)`. Never invent moves. A **move** stops at the first
  piece in its path; a **pass** flies over them — do not reuse pass geometry to
  generate moves (the #1 measured cause of discarded illegal actions).

### Starting formation & piece IDs
- IDs follow `{side}_{type}_{initialX}_{initialY}` and use the **initial** square, so
  a piece keeps its ID after moving. Always read IDs from `boardState.pieces[].id`;
  never reconstruct them from current positions.
- **White** (attacks toward y=11): king `white_king_4_1` @{4,1}; queen
  `white_queen_4_5` @{4,5}; rooks `white_rook_0_1`/`white_rook_8_1`; bishops
  `white_bishop_3_2`/`white_bishop_5_2`; knights `white_knight_2_4`/`white_knight_6_4`.
- **Black** (attacks toward y=0) mirrors it: king `black_king_4_10` @{4,10}; queen
  `black_queen_4_6` @{4,6}; rooks `black_rook_0_10`/`black_rook_8_10`; bishops
  `black_bishop_3_9`/`black_bishop_5_9`; knights `black_knight_2_7`/`black_knight_6_7`.
- **Parameterise the attacking direction by `aiSide`.** White attacks up (rival king
  at {4,10}), black attacks down (rival king at {4,1}). Hardcoding a direction is a
  classic bug that makes the AI "play backwards".

### The ball
- Exactly one ball. `Ball = { pos, holderId }`. `holderId` is the carrying piece's
  id, or `null` when the ball is **loose** on the board.
- A piece **carries** ("conducts") the ball as it moves — the ball travels to its
  destination (1 AP, same as a normal move). The king can conduct but cannot leave its
  area. (How a loose ball is captured is detailed below.)

### Passing, interception & goals
- A pass costs 1 AP; the holder kicks the ball without moving itself. Pass targets
  follow the piece's movement directions but are **NOT pre-filtered by blocking** —
  any square on the directional ray (to the board edge) is a valid target; the ball
  flies over pieces.
- **Your own pieces NEVER block or intercept a pass** — only the **first ENEMY
  piece** on the path resolves it:
  - if that first enemy is the **king** → **GOAL** (ball stops at the king's square,
    turn ends). Aiming *past* the king on the same line is still a goal.
  - if it's any other enemy → **interception**: the closest one seizes the ball and
    your **turn ends immediately** (AP set to 0 — emit nothing after).
- If a **teammate** is at the destination, **they become the new holder** (passing to
  a teammate's square is the normal way to give them the ball — `getValidPasses` does
  NOT exclude teammate squares). If the destination is empty, the ball lands **loose**
  (`holderId: null`) there for either side to grab.
- **Knight passes are the exception: they JUMP everything and can NEVER be
  intercepted.** Only the exact L-destination is checked — it's a goal only if that
  destination *is* the rival king's square; if it holds an enemy non-king piece, that
  enemy receives the ball. This is why knights are the safest finishers.

### Gaining possession (loose ball)
- **Linear pieces** (king, queen, rook, bishop) capture a loose ball by **crossing or
  landing on** its square as they move — they need only pass over it, and the ball
  travels with them to their destination.
- **Knights** capture only by **landing exactly** on the ball's square.

### Tackle (stealing the ball)
- You may move a piece **onto an opponent who is holding the ball** to steal it — but
  **never onto the king** (untouchable). The displaced opponent is shoved to its
  first free **orthogonal** square in the fixed priority **right → left → up → down**
  (deterministic, so you can simulate exactly where it lands). The tackler's own
  vacated square counts as free, so a piece orthogonally adjacent to the holder can
  always tackle.
- **If the holder is surrounded on all four orthogonal sides** (no free displacement
  square), the tackle is **illegal**. `getValidMoves` already encodes all of this — a
  legal tackle shows up as a move onto the holder's square.

### Offside (do NOT camp in the box with the ball)
- If your turn **ends with a non-king piece holding the ball inside the enemy penalty
  area**, it is **offside**: the ball is handed to the **defending king**. Checked at
  **every** turn end (AP exhausted, voluntary, or forced), with **no warning turn**.
- The offender is **whichever piece holds the ball when the turn ends — not the last
  piece you moved.** Parking a teammate with the ball in the box while you spend the
  remaining AP elsewhere is offside all the same. Your offside check must look at the
  *final* simulated holder of the whole plan.
- Consequence: once the ball is carried into the enemy area you must **shoot or pass
  it out before the turn ends** — you cannot park it there. Only enter the box with
  the ball when you will shoot the same turn.

### King / keeper special rules
- **King possession penalty (`kingMustRelease`)**: the king may hold the ball for the
  turn it receives it, but must release it before its next turn ends. If the king ends
  a turn holding the ball, next turn `kingMustRelease === yourSide` — pass it away
  **early** in the turn. If you haven't by the last AP, the engine **auto-releases** it
  (consuming that final AP) to an adjacent empty square: the 4 orthogonals first, then
  the 4 diagonals. Never let the king hoard the ball.
- **Keeper block (`keeperBlockedId`)**: after the king passes the ball away,
  `keeperBlockedId` is set to its id and it **cannot receive a pass back** until an
  opponent touches the ball. The king's square is excluded from valid pass targets
  **only for its own teammates** — a *rival* shot at a blocked keeper is still a normal
  goal attempt and stays in `getValidPasses`. The block lifts as soon as an opponent
  touches the ball in any way (interception, tackle, capturing the loose ball,
  receiving it after an offside, or a goal). `getValidPasses` already respects this.

---

## 4. Programming contract

```ts
type Side = 'white' | 'black'
type PieceType = 'king' | 'queen' | 'rook' | 'bishop' | 'knight'
interface Position { x: number; y: number }
interface Piece { id: string; type: PieceType; side: Side; pos: Position; hasMovedThisTurn: boolean }
interface Ball { pos: Position; holderId: string | null }
interface BoardState {
  pieces: Piece[]; ball: Ball; score: { white: number; black: number }
  actionPoints: number; maxActionPoints?: number; turn: Side; turnNumber: number
  kingMustRelease?: Side; keeperBlockedId?: string
  lastMove?: { type: MoveHistoryType; from?: Position; to: Position; playerId: string; at: number }
  moveHistory: MoveHistoryEntry[]
}

interface AIAction { type: 'move' | 'pass' | 'end_turn'; pieceId?: string; to?: Position }

// THE CONTRACT YOU IMPLEMENT:
play: (boardState: BoardState, aiSide: Side) => AIAction[]   // up to `actionPoints` actions, one per AP
```

Engine helpers available (all **pure** — they return a new board, never mutate):
`getValidMoves`, `getValidPasses`, `applyMove`, `applyPass`, `applyEndTurn`,
`checkGoal`, `isInOwnArea`, `isInEnemyArea`, `getAreaForSide`, `getPath`,
`squareName`.

**Hard requirements for `play`:**
1. **Legal only.** Every `move`/`pass` you emit must be in `getValidMoves` /
   `getValidPasses` for the current simulated state. (The engine does *not* validate
   for you — the client skips illegal actions, which wastes your turn.)
2. **Simulate as you plan.** To chain actions, apply each with `applyMove` /
   `applyPass` to a local copy and plan the next action from the result.
3. **Stop correctly.** A pass that returns `forcedTurnEnd` (interception/goal) ends
   your turn — emit nothing after it.
4. **Synchronous & side-effect-free** on the input. No network, no I/O.
5. **Non-determinism is REQUIRED** (see §6). Use a seeded RNG so you can be
   reproducible in tests but varied in play. (This relaxes the engine's original
   "no randomness" rule — variety is now a design goal.)
6. **Never throw.** Wrap the body in try/catch and fall back to
   `[{ type: 'end_turn' }]`.

---

## 5. Strategic principles (the "understanding")

These were **mined empirically** from thousands of self-play games (see §8). They are
the difference between a bot a human laughs at and one a human respects. A strong AI
encodes all of them; weaker tiers deliberately encode fewer.

**Possession & safety**
- **Never hang the ball.** Do not end your turn with your ball-carrier sitting on a
  square an opponent can *tackle* next move. Losing possession cheaply is how you
  lose — the opponent works it up to a goal over the following turns.
- **Keep possession when nothing improves.** If you hold the ball and no action
  meaningfully improves your position, it is fine to end the turn early and keep the
  ball, rather than shuffle it into danger. (This also avoids the infinite
  shuffling-stalemate the old scripts fell into.)
- **Don't let the king hoard the ball** (`kingMustRelease`); pass it to a field
  piece promptly.
- **Respect offside**: never end a turn carrying the ball in the enemy box.

**Attacking**
- **Create shooting lanes**: maneuver a piece onto a clear straight/diagonal line to
  the rival king. The more simultaneous threats, the harder to defend.
- **Score within one turn** when you can: the king dodges between turns, so set up
  AND fire in the same turn. The two killer combos:
  - **move-then-shoot** (2 AP): move a piece so a clear shot opens, then pass to the king.
  - **pass-then-shoot** (2 AP): pass to a teammate already on a shooting line, who shoots.
  - **carry-then-shoot**: walk the ball onto a lane, then shoot.
- **Take a certain goal immediately** — never pass up a legal scoring pass.

**Defending**
- **Punish the opponent's combos before they happen**: if, after your move, the
  opponent could score in one extra move (carry/tackle/grab-loose then shoot), that
  move is a blunder — avoid it.
- **Recover loose balls.** A loose ball is a race; get your nearest piece onto it,
  *especially* if it's near your own king (the opponent grabbing it can shoot).
- **Stay home when you don't have the ball.** Don't leave rooks parked in the
  attacking third while the opponent walks the ball into your goal.
- **King positioning**: keep the keeper central in its area for the best blocking
  angles; dodge it off a knight's incoming shot square when threatened.

---

## 6. Reference architecture (a strong, tunable core)

A single search+eval core, parameterised into tiers, beats four separate hand-written
if/else scripts and is far stronger. Recommended design:

1. **Evaluation function** `evaluate(board, side) → number` (higher = better for
   `side`). Reference feature weights that work well:
   - goal difference ×10000 (dominant);
   - holding the ball ±140; ball advancement toward rival goal ×9/rank;
   - king hoarding the ball −220;
   - loose ball: (opponentDist − ourDist) ×26, −8 ×ourDist, −120 if loose near our king;
   - clear shooting lanes: +45 each (ours), −52 each (theirs);
   - opponent can score next pass −650; `kingMustRelease` −160;
   - piece centralisation (small); our pieces stranded in the attacking third with no
     ball −6/rank past midfield; king off-centre in its area ×4.
2. **Beam search over the whole turn** (up to 5 AP). Expand candidate actions, keep
   the top-`beamWidth` partial sequences by score per depth, and remember the best
   *complete* plan found at any depth (ending the turn early is always an option).
   Score a completed plan by simulating `applyEndTurn` and then evaluating with the
   blunder filter — this also makes offside fall out for free.
3. **Explicit combo finder** `findScoringCombo` — directly searches move-then-shoot
   and pass-then-shoot for a *forced goal this turn*, because the beam tends to prune
   the setup move (it doesn't raise eval on its own).
4. **Blunder filter** layered on the eval when it becomes the opponent's move:
   −5000 if you leave them an immediate goal; −700 if you leave them a one-move
   scoring combo; −230 if your holder is left tackle-able.
5. **Non-determinism via softmax**: instead of always the argmax plan, sample a plan
   with probability ∝ `exp(score / temperature)`, using a seeded RNG
   (`seed = hash(board) ^ instanceSeed ^ moveCounter`). `temperature → 0` ≈ best
   play; higher → more variety and weaker. Add a `mistakeProb` to occasionally play a
   random legal plan (human-like error).

---

## 7. Difficulty tiers

Tune the knobs — **not** separate scripts — so the ladder is monotonic (each tier
beats the one below, loses to the one above). Validated reference presets:

| Tier | beamWidth | depth | combos | defense | temperature | mistakeProb | lookahead |
|---|---|---|---|---|---|---|---|
| **beginner**     | 2  | 2 | off | 0 (ignores replies) | 220 | 0.35 | 0 |
| **intermediate** | 4  | 3 | on  | 1 (no hung goals)   | 90  | 0.12 | 0 |
| **advanced**     | 6  | 4 | on  | 2 (full)            | 35  | 0.03 | 0 |
| **expert**       | 10 | 5 | on  | 2 (full)            | 8   | 0.00 | 1 |
| **legendary**    | 14 | 5 | on  | 2 (full)            | 2   | 0.00 | 2 |

- `defense`: 0 = ignores opponent replies (hangs balls/goals — easy to beat);
  1 = won't hand a direct goal; 2 = full combo + tackle awareness.
- `depth` < 5 makes a tier *myopic* (plans fewer AP ahead, leaves AP unused).
- `temperature` is the main "beatability" dial: a strong, fixed eval at low temp
  (legendary ≈ 2) plays near-optimally and punishes every human error; raise it
  (expert ≈ 8) for sound-but-varied play a skilled human can exploit.
- `lookahead` is **deep DEFENCE only** (turns of forced-goal veto). DO NOT run a
  negamax over the static eval to drive move *choice*: with a well-tuned eval that
  rewards calculated aggression, shallow minimax discounts beyond-horizon payoffs and
  turns the engine passive — it stops scoring and gets *weaker* (measured: expert
  20–0 → 0–10 vs the bar). Use lookahead purely to demote a plan that hands the
  opponent a goal it can force over its next 1 turn (expert) or 2 turns (legendary).
- Map the championship bracket to **beginner → intermediate → advanced → expert →
  legendary** so the difficulty curve is real (legendary 92% vs the bar, never loses;
  expert hard but beatable).

---

## 8. How to train / iterate (the self-play loop)

The AIs are "trained" by **self-play measurement + tuning** (no neural net needed —
this is search + a tuned evaluation, the same recipe that makes chess engines strong;
self-play is how we calibrate the weights and find the blunders).

Tooling in `scripts/self-play/` (run with `npx tsx`):
- `harness.ts` — `runMatch(white, black, opts)` plays a full game headlessly using
  only the engine's pure functions, and records per-side **metrics of mistakes and
  good plays**: missed shots, open shots conceded, possessions lost to interception,
  tackles won, hung balls, wasted AP, illegal actions, possession %.
- `tournament.ts` — round-robin of the engine scripts + blunder report.
- `ai-engine.ts` — the configurable core above (`createAI`, `TIERS`, `makeTier`).
- `ladder.ts` — tiers vs tiers and vs the engine scripts; verifies a monotonic ladder.
- `benchmark.ts` — a single AI vs the four engine scripts.

**The loop:** run a benchmark → read the blunder metrics → trace one lost game move
by move to see the concrete failure → add/adjust an eval term or filter → re-measure.
Document each iteration (what failed, the fix, the new record) in `NOTES.md`. This is
exactly how the reference AI went from losing 0–3 to the strongest script up to
beating all four engine scripts.

---

## 9. Persona design (make each opponent feel different)

Difficulty sets *strength*; persona sets *flavour*. Bias the eval/selection slightly
per character so the styles read differently to a human — while staying within the
tier's strength band:

- **Claude Sonnet** — *positional & patient*: values possession and king safety
  higher; lower temperature within its tier (principled, consistent).
- **ChatGPT / Táctico Neural** — *aggressive*: weights shooting threats and ball
  advancement up; takes more risks (higher temperature).
- **Gemini / TikiTaka** — *passing & triangulation*: prefers pass-then-shoot combos
  and short safe passes; values keeping the ball.
- **Claude Fable** — *all-rounder boss*: full strength, slight unpredictability.

Give each a `name`, `avatar` (emoji), `difficulty`, `badgeName`, `badgeIcon`, and a
one-line `description` of its style (shown in the UI).

---

## 10. Output checklist (before you ship an AI)

- [ ] Emits only legal actions (0 illegal across a self-play tournament).
- [ ] Never throws; falls back to `end_turn`.
- [ ] Never hangs the ball to a tackle, never ends a turn offside, never hoards with
      the king.
- [ ] Takes a forced goal when one exists (for tiers with `combos`).
- [ ] Recovers loose balls and defends its own goal.
- [ ] Is **non-deterministic** (varies between games on the same position) yet
      reproducible under a fixed seed.
- [ ] Sits on the right rung of the ladder (beats the tier below, loses to the one
      above) — confirmed with `ladder.ts`.
- [ ] Per-turn cost is small (the reference core is ~20–40 ms/turn).

---

> **Provenance.** §3 (Complete rules) is cross-checked against `docs/AI_GAME_RULES.md`
> (v2.4) and carries the same canonical mechanics: configurable AP (1–5), the
> uninterceptable knight pass, tackle displacement priority (right→left→up→down) and
> the surrounded-holder illegality, king auto-release order (orthogonals then
> diagonals), the teammate-scoped keeper backpass block, offside on whichever piece
> holds the ball at turn end, the unreadable goal target, and the full piece-ID
> formation. Strategy (§5) and architecture (§6) mirror `docs/AI_PLAYER_PROMPT.md`
> (the per-author prompt) and the empirical findings logged in `NOTES.md`. If any of
> those source docs change, update this file in lockstep.
