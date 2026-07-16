# FutbolAjedrez - Game Rules & AI Player Specification

> This document contains everything an AI needs to understand the game and produce a valid player script.

---

## 1. Game Overview

FutbolAjedrez is a turn-based strategy game that combines chess piece movement with football (soccer) objectives. Two players take turns moving chess pieces on a rectangular board, trying to **shoot the ball at the opponent's king** to score goals.

**Objective**: Score more goals than your opponent by shooting the ball at the rival king.

### Purpose: a virtual opponent a human enjoys playing

The script you produce powers a **virtual player that faces a human** in real time. It may run in different applications (the Chess.Football web app and others), so it must not assume a specific product context. The goal is a **good experience for the person on the other side**: an opponent that is **not predictable** (no memorisable line), defends soundly, punishes mistakes, takes its chances, and whose real strength **matches its declared `difficulty`**. Winning should feel earned; losing should feel fair.

### Game Philosophy: think like chess, play football

This is a **team game**. Picture a football match where the players are chess pieces moving across the pitch:

- **Use your WHOLE team**, both to attack and to defend. A single piece chasing the ball is as bad here as a single player chasing the ball in football. Build play with passes, support the ball carrier, keep defenders covering your king.
- **Score goals and avoid conceding.** Every turn you should be making progress toward one of those two things.
- **Strategically, it's chess.** At all times you must know where every piece stands and **where it can reach** — yours AND your rival's. The board state is fully visible: there is no excuse for being surprised.
- **Anticipate.** Think about what can happen in the next moves: where the rival can take the ball, which shooting lanes open or close after each move, what your opponent's best reply will be.

In short: **think like chess, play football.**

---

## 2. The Board

- **Dimensions**: 9 columns (A-I, indexed 0-8) x 12 rows (1-12, indexed 0-11)
- **Total squares**: 108
- **Coordinate system**: `{ x: 0-8, y: 0-11 }` where x=0 is column A (left), y=0 is row 1 (bottom/white side)

### The Areas (5×2 penalty zones)

Each side has a **5×2 area** at its end of the field:

- **White's area** (defended by white king): `x ∈ [2..6]`, `y ∈ [0..1]` (10 squares)
- **Black's area** (defended by black king): `x ∈ [2..6]`, `y ∈ [10..11]` (10 squares)

### Rules about the area

1. The **king can ONLY move within its own area** — it cannot leave under any circumstance, even when holding the ball.
2. **No other piece from the same team** can enter its own area.
3. Rival pieces **can** enter the opponent's area freely.
4. The **king is untouchable**: no rival piece can move to the king's square. Only a pass (shot) can reach the king.
5. A non-king piece **may not end its turn holding the ball inside the rival area** — doing so is **offside** (see below).

### Offside

A side may not **end its turn with a non-king piece holding the ball inside the enemy area**. If it does, that piece is **offside** and loses possession: the ball is handed to the **defending king** (the king of that area).

- Checked at **every turn end** (AP exhausted, voluntary end, or forced end).
- Only non-king pieces are affected; the king has its own possession rules (section 7) and can never be in the enemy area.
- **No warning turn** (unlike the king rule): ending a single turn with the ball in the enemy area is penalized immediately.
- Avoid it by conducting the ball **out of the area** or **passing** before the turn ends.
- Recorded as `lastMove.type === 'offside'`; the ball moves to the defending king.

**Rationale**: defending pieces cannot enter their own area to tackle, so without this rule a piece could camp the ball in the rival area indefinitely. It mirrors football's **offside**.

### Scoring a Goal

A goal is scored when a **pass/shot** reaches (or passes through) the **rival king's square**:
- The ball travels along its pass trajectory.
- The **first enemy piece on the trajectory** is resolved:
  - If it is the **rival king** → **GOAL**.
  - If it is any **other rival piece** → interception (normal interception rules).
- For **knight passes** (which jump): only the exact destination square matters. If the destination is the rival king's square → GOAL.

```
y=11  [ ][ ][ ][ ][ ][ ][ ][ ][ ]   ← Black area (back row)
y=10  [R][ ][ ][ ][K][ ][ ][ ][R]   ← Black King (target for white) + Black rooks
y=9   [ ][ ][ ][B][ ][N][ ][ ][ ]   ← Black bishop (D10) + knight (F10)
y=8   [ ][ ][ ][ ][ ][ ][ ][ ][ ]
y=7   [ ][ ][N][ ][ ][ ][B][ ][ ]   ← Black knight (C8) + bishop (G8)
y=6   [ ][ ][ ][ ][Q][ ][ ][ ][ ]   ← Black queen ── center ──
y=5   [ ][ ][ ][ ][Q][ ][ ][ ][ ]   ← White queen ── center ──
y=4   [ ][ ][N][ ][ ][ ][B][ ][ ]   ← White knight (C5) + bishop (G5)
y=3   [ ][ ][ ][ ][ ][ ][ ][ ][ ]
y=2   [ ][ ][ ][B][ ][N][ ][ ][ ]   ← White bishop (D3) + knight (F3)
y=1   [R][ ][ ][ ][K][ ][ ][ ][R]   ← White King (target for black) + White rooks
y=0   [ ][ ][ ][ ][ ][ ][ ][ ][ ]   ← White area (back row)
       0  1  2  3  4  5  6  7  8
       A  B  C  D  E  F  G  H  I
```

---

## 3. Pieces

Each side has **8 pieces** with chess-based movement:

| Piece | Count | Role | Starting Positions (White) |
|-------|-------|------|---------------------------|
| King (K) | 1 | **Goal / Target** — confined to own area | E2 → {x:4, y:1} |
| Queen (Q) | 1 | Midfielder | E6 → {x:4, y:5} |
| Rook (R) | 2 | Lateral defenders | A2, I2 → {x:0, y:1}, {x:8, y:1} |
| Bishop (B) | 2 | Central defenders | D3, G5 → {x:3, y:2}, {x:6, y:4} |
| Knight (N) | 2 | Strikers/Forwards | C5, F3 → {x:2, y:4}, {x:5, y:2} |

The right-hand bishop and knight are swapped (relative to a symmetric layout) so each side has one light-squared and one dark-squared bishop — a 9-wide board can't achieve that with a same-rank symmetric pair.

Black's pieces mirror white's: same x positions, y positions mirrored:
- Black King at {4, 10}
- Black Rooks at {0, 10}, {8, 10}
- Black Bishops at {3, 9}, {6, 7}
- Black Queen at {4, 6}
- Black Knights at {2, 7}, {5, 9}

### Movement Rules

| Piece | Movement Pattern | Can Jump? | Area restriction |
|-------|-----------------|-----------|-----------------|
| **King** | 1 square in any direction (8 directions) | No | **ONLY within own area** |
| **Queen** | Unlimited squares in any direction (8 directions) | No | Cannot enter own area |
| **Rook** | Unlimited squares horizontally or vertically (4 directions) | No | Cannot enter own area |
| **Bishop** | Unlimited squares diagonally (4 directions) | No | Cannot enter own area |
| **Knight** | L-shape: 2 squares in one axis + 1 in the other (8 possible destinations) | **Yes** | Cannot enter own area |

**Blocking**: All pieces except the Knight are blocked by other pieces in their path. They cannot move through occupied squares. The Knight can jump over any piece.

**You cannot move to a square occupied by your own piece.**

**You CAN move to a square occupied by an opponent ONLY if that opponent is holding the ball (Tackle) — EXCEPT the rival king, who is untouchable.**

---

## 4. Turn Structure

Each turn, the active player has a number of **Action Points (AP)** that is **configurable per game (1–5, default 5)**. Each action costs 1 AP. Read the current budget from `boardState.actionPoints` (remaining this turn) and `boardState.maxActionPoints` (the per-turn total) — never assume a fixed 5.

### Available Actions (each costs 1 AP):

1. **Move** (`type: "move"`): Move one of your pieces to a valid destination square.
   - Each piece can only move **once per turn** (tracked by `hasMovedThisTurn`).
   - Moving with the ball = "conducting" (ball moves with the piece).

2. **Pass** (`type: "pass"`): The piece holding the ball kicks it to a destination square.
   - The piece does NOT move, only the ball travels.
   - Pass destinations follow the same directional pattern as the piece's movement.
   - Passes are NOT blocked by pieces in the path (the ball flies over them), EXCEPT for interceptions.
   - **Knights' passes also jump over everything** (no interception possible on knight passes).

3. **End Turn** (`type: "end_turn"`): Voluntarily end the turn, forfeiting remaining AP.

### Turn Flow:
1. Player starts with `maxActionPoints` AP (configurable 1–5, default 5)
2. Player performs actions (each costs 1 AP)
3. Turn ends when:
   - AP reaches 0 (automatic)
   - Player voluntarily ends turn
   - An interception or goal occurs (forced turn end, AP set to 0)

### Constraints:
- A piece that has already moved this turn (`hasMovedThisTurn: true`) cannot move again
- A piece CAN move AND pass in the same turn (2 AP total)
- Multiple different pieces can be moved in the same turn
- You can only pass if one of your pieces is holding the ball

---

## 5. Ball Mechanics

### Ball State
The ball has:
- `pos: { x, y }` - current position on the board
- `holderId: string | null` - ID of the piece holding it, or null if loose

### Gaining Possession
- **Path capture**: If a linear piece (King, Queen, Rook, Bishop) moves and the ball is on its path, it picks up the ball automatically.
- **Destination capture**: If any piece (including Knight) moves to the square where a loose ball sits, it picks it up.
- **Tackle**: Moving to a square occupied by an opponent who has the ball. You take the ball, the opponent is displaced to an adjacent empty square (orthogonal), following a **fixed priority: right → left → up → down** (first empty square in that order — deterministic, so you can simulate exactly where the displaced piece lands). **CANNOT tackle the king.** **If the ball holder is surrounded on all four orthogonal sides by other pieces (with no free square to be displaced to), the tackle is not allowed** — the move is simply illegal in that case. Note: the tackler's own starting square counts as free for the displacement (the tackler vacates it), so a piece adjacent to the holder can always tackle.

### Conducting (Moving with the Ball)
When a piece holding the ball moves, the ball moves with it to the destination. This costs 1 AP (same as a normal move). The king can conduct the ball but cannot leave its area.

### Passing (Kicking the Ball)
- The piece with the ball sends it to a valid destination without moving itself.
- Pass destinations follow the piece's movement directions. The list of destinations is NOT pre-filtered by pieces in the path (any square on the piece's directional ray is a valid target), but at resolution time the first rival piece on the trajectory **intercepts** the pass — or scores a goal against you if that rival piece is the rival king. See "Interception" and "Shooting (Scoring a Goal)" below. Knight passes are an exception: only the exact L-shaped destination is checked.
- **Passing to a teammate IS allowed and is the normal way to give them the ball**: a square occupied by a teammate is a valid pass destination, and the teammate becomes the new ball holder. `getValidPasses` does NOT exclude teammate squares (the only excluded square is your OWN blocked keeper's, see rule 7b — a blocked RIVAL keeper is still a valid shot target).
- **Your own pieces NEVER block or intercept a pass**: the ball flies over them. Only the **first ENEMY piece** on the trajectory matters (interception, or goal if it is the rival king).
- If the destination square is **empty**, the ball lands there **loose** (`holderId: null`) — any piece (yours or the rival's) can capture it afterwards by moving there.
- If the destination square holds an **enemy non-king piece**, that enemy receives the ball (interception at destination). This also applies to knight passes.
- Cost: 1 AP.

### Interception
When a non-knight piece passes, the ball travels along a linear path. If an **opponent's piece** (other than the king) is on that path (between origin and destination), the opponent **intercepts** the ball:
- The opponent closest to the passer (first one on the path) gets the ball.
- The current player's turn **immediately ends** (AP set to 0).

**Important**: Knight passes CANNOT be intercepted (the ball "jumps" to the destination).

### Shooting (Scoring a Goal)
A goal is scored when a pass reaches the rival king's square:
- **Linear passes** (Queen, Rook, Bishop, King): The ball travels along the path. The first enemy piece encountered on the path:
  - If it is the **rival king** → GOAL (ball stops at king's square, turn ends).
  - If it is any **other rival piece** → interception.
- **Knight passes**: Only the exact L-shaped destination is checked. If the destination is the rival king's square → GOAL.

After a goal, the board resets to initial formation, and the **team that conceded** serves first.

---

## 6. Kickoffs, After a Goal, and Match End

**Opening kickoff**: the serving side's Queen starts with the ball at her central square. In online PvP matches **white** always serves first; in training (vs AI) the side chosen by the human player serves.

When a goal is scored:
1. The score updates (+1 for the scoring team)
2. The board resets to the initial formation (with new king positions)
3. The team that **conceded** the goal serves: their Queen starts with the ball at center
4. The conceding team takes the first turn

**Match end**: the match ends as soon as one side reaches the goal target configured at match creation (1–10 goals, default 3). There are no draws. Note: the goal target is NOT included in `BoardState`, so your script cannot read it — just play every turn to score and avoid conceding.

---

## 7. King Special Rules

### 7a. King Cannot Hold the Ball More Than One Turn

The king may receive the ball and hold it during that turn, but **must release it before their next turn ends**.

- If the king holds the ball when the player's turn ends, the flag `kingMustRelease` is set for that side.
- On the **following turn** for that side, the king must pass the ball voluntarily.
- If the player has not passed with the king by the last AP, the system **automatically releases** the ball to an adjacent empty square (consuming that final AP). The 4 orthogonal squares are tried first; if all are occupied, the 4 diagonals are tried next.
- The last active AP indicator turns into a **crown icon** (👑) when `kingMustRelease` is active, warning the player.

**Rationale**: prevents a winning player from parking the ball with their king to stall the game.

### 7b. Goalkeeper Backpass Rule

Once the king releases the ball (voluntarily or via auto-release), **no teammate can pass the ball back to the king** until an opponent has touched it.

- When the king passes, `keeperBlockedId` is set to the king's piece ID.
- The king's square is excluded from valid pass destinations **only for the king's own teammates**. Rival pieces are NOT affected: shooting at a blocked keeper's square is a normal goal attempt and stays in `getValidPasses`.
- The block is lifted as soon as an **opponent piece touches the ball in any way**: interception, tackle, **capturing a loose ball**, receiving it after an offside, or goal.

**Rationale**: mirrors the football backpass rule — prevents repeatedly passing to the king to waste time.

---

## 8. TypeScript Interfaces

```typescript
type Side = 'white' | 'black'
type PieceType = 'king' | 'queen' | 'rook' | 'bishop' | 'knight'

interface Position {
  x: number  // 0-8
  y: number  // 0-11
}

interface Piece {
  id: string
  type: PieceType
  side: Side
  pos: Position
  hasMovedThisTurn: boolean
}

interface Ball {
  pos: Position
  holderId: string | null  // Piece ID or null if loose
}

type MoveHistoryType = 'move' | 'pass' | 'tackle' | 'goal' | 'interception' | 'offside'

interface MoveHistoryEntry {
  type: MoveHistoryType
  pieceType: PieceType
  pieceSide: Side
  from?: Position
  to: Position
  at: number
  turnNumber: number
}

interface BoardState {
  pieces: Piece[]
  ball: Ball
  score: { white: number; black: number }
  actionPoints: number      // remaining AP for current turn (0..maxActionPoints)
  maxActionPoints?: number  // per-turn AP budget (1-5, default 5)
  turn: Side                // whose turn it is
  turnNumber: number        // increments every turn change
  lastMove?: {
    type: MoveHistoryType
    from?: Position
    to: Position
    playerId: string
    at: number
  }
  moveHistory: MoveHistoryEntry[]  // last 60 entries
  kingMustRelease?: Side    // this side's king must release the ball this turn
  keeperBlockedId?: string  // this keeper cannot receive passes until an opponent touches the ball
}
```

### Piece ID Format
Piece IDs follow the pattern: `{side}_{type}_{initialX}_{initialY}`

**White pieces:**
- `white_rook_0_1`, `white_rook_8_1`
- `white_bishop_3_2`, `white_bishop_6_4`
- `white_king_4_1`
- `white_queen_4_5`
- `white_knight_2_4`, `white_knight_5_2`

**Black pieces:**
- `black_rook_0_10`, `black_rook_8_10`
- `black_bishop_3_9`, `black_bishop_6_7`
- `black_king_4_10`
- `black_queen_4_6`
- `black_knight_2_7`, `black_knight_5_9`

---

## 9. AI Player Script Specification

### Expected Output Format

```typescript
interface AIAction {
  type: 'move' | 'pass' | 'end_turn'
  pieceId?: string    // Required for 'move' and 'pass'
  to?: Position       // Required for 'move' and 'pass'
}

interface AIPlayerScript {
  name: string                    // Display name
  description: string             // Strategy description in Spanish
  avatar: string                  // Emoji or icon identifier
  difficulty: 'beginner' | 'intermediate' | 'advanced' | 'expert'
  badgeName: string               // Trophy name in Spanish
  badgeIcon: string               // Lucide icon name
  play: (boardState: BoardState, aiSide: Side) => AIAction[]
}
```

### The `play` Function

The `play` function is called once per AI turn. It receives:
- `boardState`: The complete current state of the board
- `aiSide`: Which side the AI is playing ('white' or 'black')

It must return an **ordered array of actions** to execute sequentially. The array should contain at most `boardState.actionPoints` actions (one per remaining AP — at most 5). The system will:
1. Execute each action in order
2. Validate each action (invalid actions are skipped)
3. Stop if AP runs out or if an interception/goal occurs

### Validation Rules

**For `move` actions:**
- The piece must exist and belong to `aiSide`
- The piece must NOT have `hasMovedThisTurn: true`
- The destination must be valid:
  - King: destination must be within own area (`x ∈ [2..6]`, `y ∈ [0..1]` for white, `y ∈ [10..11]` for black)
  - Other pieces: destination must NOT be within own area
  - Cannot move to rival king's square
  - Cannot move to square with own piece
  - Can move to rival's square only if that rival holds the ball (tackle — not king)

**For `pass` actions:**
- The piece must exist, belong to `aiSide`, and be holding the ball **at that point of the sequence** (earlier actions may have changed who holds it)
- The destination must be in `getValidPasses(piece, boardState)` (any square in the piece's directional range, **including squares occupied by teammates** — the teammate receives the ball; the only excluded square is your OWN blocked keeper's)
- WARNING: If the rival king is on the trajectory, it's a GOAL and the turn ends immediately
- WARNING: If any other opponent intercepts, the turn ends immediately (subsequent actions are ignored)

**IMPORTANT — actions are validated against the EVOLVED state**: each action is validated against the board state *after* the previous actions were applied, not against the state `play` received. An invalid action is **silently skipped** (no error, the AP is not spent, but your plan desynchronizes). To produce valid sequences you must simulate the effect of each of your actions before planning the next one.

**For `end_turn` actions:**
- Always valid. Stops execution of remaining actions.

### Non-determinism (required) & target strength

- **The AI must NOT be predictable.** A script that plays the identical move in the
  identical position (e.g. the same kickoff after every goal) is memorisable and a
  human will beat it on repeat. Scripts must introduce **variety with judgment** —
  explore randomly *among the good options* — using a board-seeded PRNG (varied in
  play, reproducible under a fixed seed in the harness). Randomness must only choose
  between legal, non-blunder plans.
- **Aim for a single strong opponent.** This is a new game — every human is new, so
  there is no tier to choose and no audience to profile. Ship one player at **maximum
  strength** (deep whole-turn search, full defensive awareness, goal-combo detection),
  declared `difficulty: 'expert'`. Get strength from search breadth/depth + a good
  evaluation + a **low** selection temperature — never from ad-hoc tricks or deliberate
  blunders. Variety (above) is what keeps it fresh, not playing weaker.
- **Recommended strong architecture**: an evaluation function + a whole-turn search
  (beam over the 5 AP) + an explicit goal-combo finder + a blunder filter + softmax
  selection. Full reference implementation and the training harness/ladder live in the
  engine repo under `scripts/self-play/` (`ai-engine.ts`, `ladder.ts`) and
  `AI_AUTHORING_PROMPT.md`. See sections 8b/8c of `AI_PLAYER_PROMPT.md` for details.

---

## 10. Strategic Considerations

### Offensive Strategy
- **Direct shot**: If a piece holds the ball and can pass to the rival king's exact square, that's a goal. Always check this first.
- **Knight shots are gold**: Knight passes can't be intercepted and jump to the exact destination. A knight near the rival king can shoot safely.
- **Opening passing lanes**: Use pieces to pass the ball toward the area, then shoot. The king is at the center of the area front row ({4,1} for white's king, {4,10} for black's king).
- **Queen as playmaker**: The queen can pass in all 8 directions with unlimited range, creating long shooting lanes.
- **Passing through the area**: Passes to squares beyond the rival king are also goals (ball stops at king). Use this to "aim past" the king.

### Defensive Strategy
- **King should stay near the area center**: The king starts at {4,1}/{4,10} and can move within the 5×2 area. Keep it at the center to minimize shooting angles.
- **Block passing lanes**: Position pieces between the ball holder and your king to force interceptions.
- **Rooks and bishops as interceptors**: Position them on the same row/column/diagonal as your king to intercept shots.
- **Don't block your own king's area**: Remember that your own non-king pieces cannot enter your area. Plan defensively using pieces outside the area.

### Tactical Elements
- **Moves are blocked, passes are not.** A linear MOVE (queen, rook, bishop, king) stops at the first piece on its path — your own pieces included. A PASS flies over your own pieces and only the first ENEMY matters. Do not reuse pass logic to generate moves: a destination "on the right ray" is NOT a valid move if anything stands in between. (This is the single most common invalid action measured in simulations.)
- **Re-check the goal shot after EVERY action.** Most real goals are `conduct → shoot` or `pass → shoot` chained within one turn. A script that only checks for a shot at the start of the turn misses the majority of its chances (measured: ~60 unconverted 2-AP goals per 300 turns in weak scripts).
- **Loose ball is top priority**: if `ball.holderId === null`, whoever reaches the ball first gains possession. Linear pieces capture it by merely **crossing** its square; knights must land on it. Race for every loose ball.
- **Offside awareness**: never end your turn with a non-king piece holding the ball inside the rival area — the ball is handed to the defending king. The check applies to **whichever piece holds the ball when the turn ends**, not just the piece you moved last: a teammate left parked in the area with the ball while other pieces spend the remaining AP is offside all the same. If your striker is in the area with the ball, **shoot or pass out before the turn ends**.
- **Area awareness**: Your non-king pieces (queen, rooks, bishops, knights) CANNOT enter your own area. Plan movements accordingly.
- **Knight positioning**: Knights can jump over pieces and shoot without interception risk. Position them to have L-shape shots toward the rival king.
- **Rival area entry**: Your pieces CAN enter the opponent's area (except their king's square). This enables close-range attacks.
- **Interception traps**: After passing, if the ball is intercepted, your turn ends immediately. Check opponent positions before passing (except with Knights).
- **King ball management**: If you receive the ball with your king, pass it out before your turn ends — otherwise `kingMustRelease` will be set and your next turn's last AP will be forced into an auto-release.
- **Keeper backpass block**: After the king passes, `keeperBlockedId` prevents passing back to the king until an opponent touches the ball. Factor this into your passing chains.

### Board Awareness
- **King positions**: White king at `{4,1}`, black king at `{4,10}`. These are the primary targets.
- **Area dimensions**: `x ∈ [2..6]`, depth = 2 rows from each end.
- **Center control**: The area around y=5-6 is midfield. Controlling it gives more passing options.

---

## 11. Example Turn

Suppose the AI plays as White and the board state shows:
- White Queen (`white_queen_4_5`) at {x:4, y:6} **holding the ball**, has not moved
- White Knight (`white_knight_2_4`) at {x:3, y:7}, has not moved
- Black Bishop at {x:4, y:8} — it blocks the Queen's vertical shot at the king
- Black King at {x:4, y:10}

The direct Queen shot {4,6} → {4,10} is NOT safe: the black bishop at {4,8} is the first enemy on the trajectory and would intercept. Instead, relay through the knight (knight passes cannot be intercepted):

```javascript
[
  // 1. Pass to the teammate knight (diagonal {4,6}→{3,7}, no enemy in between).
  //    The knight RECEIVES the ball (teammate squares are valid pass targets). (1 AP)
  { type: 'pass', pieceId: 'white_queen_4_5', to: { x: 3, y: 7 } },
  // 2. Knight conducts the ball with an L-move {3,7}→{2,9}.
  //    Note {2,9} is OUTSIDE the black area (y=9 < 10): no offside risk. (1 AP)
  { type: 'move', pieceId: 'white_knight_2_4', to: { x: 2, y: 9 } },
  // 3. Knight shot: {2,9}→{4,10} is a valid L (+2,+1) and the destination is the
  //    black king. Knight passes jump everything → uninterceptable GOAL. (1 AP)
  { type: 'pass', pieceId: 'white_knight_2_4', to: { x: 4, y: 10 } }
  // Goal forces the turn end; remaining AP are irrelevant.
]
```

Note how every action was planned against the **simulated state after the previous action**: the knight could only shoot because step 1 actually gave it the ball and step 2 actually moved it to a square with an L-line to the king.

---

## 12. Common Pitfalls

1. **Don't try to tackle the king**: It's invalid — no piece can move to the rival king's square.
2. **Don't move non-king pieces into your own area**: They cannot enter — moves to own area are invalid.
3. **Don't move the king outside its area**: The king is confined to the 5×2 area at all times.
4. **Don't pass through opponents (except with Knights)**: Check the linear path for opponent pieces before passing. The first one will either intercept or (if it's the rival king) give you a goal.
5. **Don't try to move a piece twice**: `hasMovedThisTurn` prevents double moves.
6. **Don't forget the ball**: If you don't have possession, you need to capture it first.
7. **Goals are only scored by passes**: Moving a piece to the king's square is invalid (untouchable). Only a pass reaching the king scores.
8. **Check piece IDs carefully**: Use the exact IDs from the boardState. IDs: `white_king_4_1`, `black_king_4_10`, `white_queen_4_5`, `black_queen_4_6`, `white_knight_2_4`, `white_knight_6_4`, `black_knight_2_7`, `black_knight_6_7`.
9. **Don't park the ball with the king**: If `boardState.kingMustRelease === aiSide`, the king MUST pass the ball this turn or the system will auto-release it on the last AP. Prioritise passing with the king early in the turn.
10. **Don't pass back to a blocked keeper**: If `boardState.keeperBlockedId` is set to your king's ID, no teammate can pass to the king's square — those destinations will simply not appear in `getValidPasses`. The block lifts once an opponent touches the ball.
11. **Don't end the turn offside**: a non-king piece holding the ball inside the rival area when your turn ends loses possession to the defending king. Shoot, pass out, or conduct out of the area first.
12. **Don't assume your own pieces block passes**: they don't — the ball flies over teammates. And don't exclude teammate squares from pass targets: passing to a teammate's square is exactly how you give them the ball.
13. **Don't plan against a stale state**: every action is validated against the board after your previous actions. Simulate each action's effect (moves, ball changes, displacements) before deciding the next one, or your later actions will be silently discarded.
14. **Don't generate moves geometrically without blocking**: a linear move destination must have a CLEAR path — every intermediate square empty. Pass logic ("any square on the ray") does not transfer to moves. Measured: blocked-path moves are the #1 cause of discarded actions.
15. **Don't compute pass targets from a stale position**: if a piece moved earlier in your action array, its pass destinations must be recomputed from its NEW position. A knight that moved and then "passes" using L-targets from its old square produces invalid actions every time.
16. **Don't retry an action that was already discarded**: if the same action is invalid this turn, it will be invalid next turn too unless the board changed. Scripts observed in simulation repeated the identical illegal move every turn for entire games. Always have a fallback.

---

## 13. Score Context

The `boardState.score` object contains `{ white: number, black: number }`. Use this to adapt strategy:
- If winning: play more defensively, protect the lead
- If losing: play more aggressively, take risks
- If tied: balanced approach

A goal in `lastMove` is indicated by `boardState.lastMove?.type === 'goal'`.

---

*Document version: 2.4 — June 2026 — Cross-checked against the canonical rules repo (chess.football). Added: tackle displacement priority (right→left→up→down), auto-release order (orthogonals then diagonals), opening kickoff, match end / goal target. v2.3: keeper block scoped to teammates only (rival shots at a blocked keeper are valid; block lifts on any opponent touch, including loose-ball capture), move-vs-pass blocking contrast, re-check-shot-after-every-action, offside applies to whichever piece holds the ball at turn end, pitfalls 14–16 from simulation findings.*
