// Production AI engine for Chess.Football.
//
// One search+eval core parameterised into difficulty tiers; exports a full
// championship roster of AIPlayerScript-compatible opponents ready for use in
// futbolajedrez / crazygames without any additional dependencies.
//
// Architecture (validated over 8 self-play iterations — see scripts/self-play/NOTES.md):
//   • EVALUATION FUNCTION: goal diff, possession, ball advancement, shooting lanes,
//     king safety, loose-ball race, defensive positioning. (§6 of AI_AUTHORING_PROMPT)
//   • BEAM SEARCH over the whole AP budget finds multi-step combos the old greedy
//     scripts never saw.
//   • findScoringCombo explicitly hunts forced goals the beam tends to prune.
//   • BLUNDER FILTER refuses to hand the opponent a direct goal or a tackle.
//   • SOFTMAX selection with a seeded RNG gives non-deterministic but principled play
//     (same position, different seed → different move; fixed seed → reproducible).

import { getValidMoves, getValidPasses } from './game-logic'
import { applyMove, applyPass, applyEndTurn } from './game-engine'
import type { BoardState, Piece, Position, Side } from './types/game'
import type { AIAction, AIPlayerScript } from './types/ai-player'

const BOARD_W = 9
const BOARD_H = 12
const opp = (s: Side): Side => (s === 'white' ? 'black' : 'white')
const goalRow = (side: Side): number => (side === 'white' ? BOARD_H - 1 : 0)
const cheby = (a: { x: number; y: number }, b: { x: number; y: number }) =>
  Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y))

// ── Configuration ─────────────────────────────────────────────────────────────

/** Search + randomness knobs. Tune to create a difficulty tier. */
export interface AIConfig {
  /** How many candidate plans the beam keeps per depth (tactical breadth). */
  beamWidth: number
  /** Max AP planned ahead in a single turn (≤5). Lower = more myopic. */
  depth: number
  /** Hunt forced goal combos (move/pass-then-shoot). Off = misses easy goals. */
  combos: boolean
  /** 0 = ignores opponent replies; 1 = avoids hanging a direct goal; 2 = full. */
  defense: 0 | 1 | 2
  /** Softmax spread over plan scores. 0 = always best; higher = more varied/weaker. */
  temperature: number
  /** Probability of playing a random legal plan (simulates human-like errors). */
  mistakeProb: number
  /**
   * Adversarial lookahead: how many *opponent* (and beyond) full turns to simulate
   * with negamax when scoring our candidate turn-plans. 0 = none (single-turn beam +
   * 1-move blunder filter, the old behaviour). 1 = 2-ply (our turn → opponent's best
   * reply). 2 = 3-ply (… → our best counter). This is what makes the top tiers hard
   * for a planning human: a plan that looks good statically but lets the opponent set
   * up a goal over their next full turn is now seen and rejected.
   */
  lookahead?: number
  /** How many of our top static plans to deepen with lookahead (branching factor). */
  lookaheadWidth?: number
}

/**
 * Small additive weight deltas that give each persona a distinctive playing style.
 * All fields are optional — omit to use the baseline weights.
 */
export interface EvalBias {
  /** Additive delta to the ±140 possession weight (positive = values holding more). */
  possession?: number
  /** Additive delta to the +45 shooting-threat weight. */
  shooting?: number
  /** Multiplier on ball advancement distance score (default 1.0). */
  advancement?: number
}

/**
 * Difficulty presets. Each tier reliably beats the one below it.
 * (Validated via scripts/self-play/ladder.ts — see NOTES.md iter 8.)
 */
export const TIERS = {
  beginner:     { beamWidth: 2,  depth: 2, combos: false, defense: 0, temperature: 220, mistakeProb: 0.35, lookahead: 0, lookaheadWidth: 0 },
  intermediate: { beamWidth: 4,  depth: 3, combos: true,  defense: 1, temperature: 90,  mistakeProb: 0.12, lookahead: 0, lookaheadWidth: 0 },
  advanced:     { beamWidth: 6,  depth: 4, combos: true,  defense: 2, temperature: 35,  mistakeProb: 0.03, lookahead: 0, lookaheadWidth: 0 },
  // expert: a genuinely hard but beatable opponent — strong static play + a 1-turn
  // forced-goal veto (sees 2–3 AP opponent goals the 1-move filter misses). Temp 3:
  // post-dedupe the plan list holds DISTINCT plans, so the old temp 8 spread real
  // randomness (pre-dedupe the top plan's permutation copies concentrated the softmax
  // mass and play was near-argmax at any temperature).
  expert:       { beamWidth: 10, depth: 5, combos: true,  defense: 2, temperature: 3,   mistakeProb: 0, lookahead: 1, lookaheadWidth: 4 },
  // legendary: the "almost unbeatable" boss — wide beam, near-deterministic best play,
  // and a 2-turn forced-goal veto (won't walk into a loss it can't defend two turns
  // out). lookaheadWidth 2 on purpose: a wider deep-veto budget (3–4) adds caution that
  // COSTS tempo and play strength (measured 50% vs 60% against the SF tune at lkw 2).
  legendary:    { beamWidth: 14, depth: 5, combos: true,  defense: 2, temperature: 2,   mistakeProb: 0, lookahead: 2, lookaheadWidth: 2 },
} as const satisfies Record<string, AIConfig>

export type TierName = keyof typeof TIERS

// ── Evaluation ────────────────────────────────────────────────────────────────

function immediateGoal(board: BoardState, side: Side): { to: { x: number; y: number }; pieceId: string } | null {
  const holder = board.pieces.find((p) => p.id === board.ball.holderId)
  if (!holder || holder.side !== side) return null
  for (const t of getValidPasses(holder, board)) {
    if (applyPass(board, t).goalScored) return { to: t, pieceId: holder.id }
  }
  return null
}

function shootingThreats(board: BoardState, side: Side): number {
  const rivalKing = board.pieces.find((p) => p.type === 'king' && p.side !== side)
  if (!rivalKing) return 0
  let n = 0
  for (const p of board.pieces) {
    if (p.side !== side || p.type === 'king') continue
    const aligned =
      p.pos.x === rivalKing.pos.x ||
      p.pos.y === rivalKing.pos.y ||
      Math.abs(rivalKing.pos.x - p.pos.x) === Math.abs(rivalKing.pos.y - p.pos.y)
    if (!aligned) continue
    const dx = Math.sign(rivalKing.pos.x - p.pos.x)
    const dy = Math.sign(rivalKing.pos.y - p.pos.y)
    let cx = p.pos.x + dx, cy = p.pos.y + dy, clear = true
    while (!(cx === rivalKing.pos.x && cy === rivalKing.pos.y)) {
      if (board.pieces.some((q) => q.pos.x === cx && q.pos.y === cy)) { clear = false; break }
      cx += dx; cy += dy
    }
    if (clear) n++
  }
  return n
}

/** Knights at L-distance from the rival king can shoot uninterceptably. */
function knightThreats(board: BoardState, side: Side): number {
  const rivalKing = board.pieces.find((p) => p.type === 'king' && p.side !== side)
  if (!rivalKing) return 0
  let n = 0
  for (const p of board.pieces) {
    if (p.side !== side || p.type !== 'knight') continue
    const dx = Math.abs(rivalKing.pos.x - p.pos.x)
    const dy = Math.abs(rivalKing.pos.y - p.pos.y)
    if ((dx === 1 && dy === 2) || (dx === 2 && dy === 1)) n++
  }
  return n
}

const RAY_DIRS: ReadonlyArray<readonly [number, number]> = [
  [1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1],
]

/**
 * How exposed `kingSide`'s king is. For each of the 8 rays out of the king, the first
 * piece met decides: an enemy with a clear line is a live shot (it only needs the
 * ball); an empty lane to the board edge is a square an enemy can move onto and fire
 * down; a friendly piece screens the lane. This is what lets the engine keep the king
 * shielded instead of leaving the back-rank cross-shot wide open (the lane Fable walks
 * the ball up a flank to exploit).
 */
function kingExposure(board: BoardState, kingSide: Side): number {
  const king = board.pieces.find((p) => p.type === 'king' && p.side === kingSide)
  if (!king) return 0
  let exposure = 0
  for (const [dx, dy] of RAY_DIRS) {
    let cx = king.pos.x + dx, cy = king.pos.y + dy
    let firstEnemy = false, screened = false
    while (cx >= 0 && cx < BOARD_W && cy >= 0 && cy < BOARD_H) {
      const pc = board.pieces.find((p) => p.pos.x === cx && p.pos.y === cy)
      if (pc) { if (pc.side === kingSide) screened = true; else firstEnemy = true; break }
      cx += dx; cy += dy
    }
    if (firstEnemy) exposure += 3        // enemy already aiming down this lane
    else if (!screened) exposure += 1    // open lane: enemy can step in and shoot
  }
  return exposure
}

function evaluate(board: BoardState, side: Side, bias: EvalBias): number {
  const me = side, you = opp(side)
  const myKing  = board.pieces.find((p) => p.type === 'king' && p.side === me)
  const yourKing = board.pieces.find((p) => p.type === 'king' && p.side === you)
  const possW  = 140 + (bias.possession ?? 0)
  const shotW  = 45  + (bias.shooting ?? 0)
  const advMul = bias.advancement ?? 1
  let score = 0

  score += (board.score[me] - board.score[you]) * 10000

  const holder = board.pieces.find((p) => p.id === board.ball.holderId)
  if (holder) {
    const mine = holder.side === me
    score += mine ? possW : -possW
    const dist = Math.abs(holder.pos.y - goalRow(holder.side))
    // Exponentially reward ball proximity to the rival goal: twice the weight at midfield
    const advScore = Math.round((BOARD_H - 1 - dist) * (mine ? 16 : -16) * advMul)
    score += advScore
    if (mine && holder.type === 'king') score -= 220
    if (!mine) {
      // Enemy possession: our outfield pieces must get GOALSIDE (between the ball and
      // our king). A piece ahead of the ball can neither screen a shot lane nor tackle
      // the carrier — attacking deployment without the ball is dead weight.
      const myEnd = goalRow(you)
      const ballDepth = Math.abs(holder.pos.y - myEnd)
      for (const p of board.pieces) {
        if (p.side !== me || p.type === 'king') continue
        const d = Math.abs(p.pos.y - myEnd)
        if (d > ballDepth) score -= (d - ballDepth) * 5
      }
    }
  } else {
    const ball = board.ball.pos
    let myMin = 99, yourMin = 99
    for (const p of board.pieces) {
      if (p.type === 'king') continue
      const d = cheby(p.pos, ball)
      if (p.side === me) myMin = Math.min(myMin, d)
      else yourMin = Math.min(yourMin, d)
    }
    score += (yourMin - myMin) * 26
    score -= myMin * 8
    if (myKing && cheby(ball, myKing.pos) <= 4 && yourMin <= myMin) score -= 120
  }

  score += shootingThreats(board, me) * shotW
  score -= shootingThreats(board, you) * 65
  // Knight threats are uninterceptable shots — weight them much higher
  score += knightThreats(board, me) * 220
  score -= knightThreats(board, you) * 280
  // Keep our king screened and squeeze the rival king's escape lanes.
  score -= kingExposure(board, me) * 13
  score += kingExposure(board, you) * 9
  if (immediateGoal(board, you)) score -= 650
  if (board.kingMustRelease === me) score -= 160

  const cx = (BOARD_W - 1) / 2
  const weHoldBall = holder?.side === me
  for (const p of board.pieces) {
    if (p.type === 'king') continue
    // Centralisation: penalise OUR pieces drifting onto the wings (worse shooting
    // angles, ball easily trapped on a file); mildly reward the rival being pushed
    // wide. (The previous sign was inverted and actively shoved our pieces — and the
    // ball — to the a/i-files, the #1 source of rookie edge-play.)
    score += (p.side === me ? -1 : 1) * Math.abs(p.pos.x - cx)
    if (p.side === me && !weHoldBall) {
      const intoEnemy = BOARD_H - 1 - Math.abs(p.pos.y - goalRow(me))
      if (intoEnemy > 7) score -= (intoEnemy - 7) * 6
    }
  }
  if (myKing)  score -= Math.abs(myKing.pos.x  - cx) * 4
  if (yourKing) score += Math.abs(yourKing.pos.x - cx) * 4

  return score
}

// ── Blunder filter ────────────────────────────────────────────────────────────

function opponentCanTackleOurHolder(board: BoardState, you: Side): boolean {
  const holder = board.pieces.find((p) => p.id === board.ball.holderId)
  if (!holder || holder.side === you || holder.type === 'king') return false
  for (const p of board.pieces) {
    if (p.side !== you || p.type === 'king') continue
    if (getValidMoves(p, board).some((m) => m.x === holder.pos.x && m.y === holder.pos.y)) return true
  }
  return false
}

/**
 * True if a `shooter` of side opposite to `king` standing at `from` has a clean throw
 * at the king: knights need the exact L (their passes jump everything); linear pieces
 * need a directional ray with NO defending piece strictly in between. The shooter's own
 * teammates never block or intercept a pass, so only the KING's side screens.
 */
function hasCleanShot(board: BoardState, shooter: Piece, from: Position, king: Piece): boolean {
  const dx = king.pos.x - from.x, dy = king.pos.y - from.y
  if (dx === 0 && dy === 0) return false
  if (shooter.type === 'knight') {
    const ax = Math.abs(dx), ay = Math.abs(dy)
    return (ax === 1 && ay === 2) || (ax === 2 && ay === 1)
  }
  if (shooter.type === 'king') return false
  const aligned =
    shooter.type === 'rook'   ? dx === 0 || dy === 0 :
    shooter.type === 'bishop' ? Math.abs(dx) === Math.abs(dy) :
    /* queen */                 dx === 0 || dy === 0 || Math.abs(dx) === Math.abs(dy)
  if (!aligned) return false
  const sx = Math.sign(dx), sy = Math.sign(dy)
  let cx = from.x + sx, cy = from.y + sy
  while (!(cx === king.pos.x && cy === king.pos.y)) {
    if (board.pieces.some((q) => q.side === king.side && q.pos.x === cx && q.pos.y === cy)) return false
    cx += sx; cy += sy
  }
  return true
}

/**
 * How many distinct one-turn goal routes `you` (to move next) has against us, capped.
 * Routes: carry-then-shoot (move the piece, THEN look where the throw reaches — what a
 * human reads instantly), pass-to-a-teammate-who-has-a-clean-shot, tackle-our-carrier-
 * then-shoot, grab-the-loose-ball-then-shoot. COUNTED rather than boolean so defence
 * has a gradient: a plan that blocks one of two lanes, tackles the carrier, or steps
 * the king off a line scores better even when it cannot clear every threat. Cheap
 * geometric prefilter (hasCleanShot) gates the exact engine simulation.
 */
function countGoalThreats(board: BoardState, you: Side, cap: number): number {
  const king = board.pieces.find((p) => p.type === 'king' && p.side !== you)
  if (!king) return 0
  let n = 0
  const holder = board.pieces.find((p) => p.id === board.ball.holderId)

  if (holder && holder.side === you && holder.type !== 'king') {
    // carry → shoot
    for (const to of getValidMoves(holder, board)) {
      if (!hasCleanShot(board, holder, to, king)) continue
      if (immediateGoal(applyMove(board, holder.id, to).boardState, you) && ++n >= cap) return n
    }
    // pass → receiver shoots at once (receiver aligned with a clean lane, and the pass
    // itself is not intercepted by one of OUR pieces before it reaches the receiver)
    for (const to of getValidPasses(holder, board)) {
      const mate = board.pieces.find((p) => p.side === you && p.type !== 'king' && p.pos.x === to.x && p.pos.y === to.y)
      if (!mate || mate.id === holder.id || !hasCleanShot(board, mate, mate.pos, king)) continue
      if (holder.type !== 'knight') {
        const sx = Math.sign(to.x - holder.pos.x), sy = Math.sign(to.y - holder.pos.y)
        let cx = holder.pos.x + sx, cy = holder.pos.y + sy, blocked = false
        while (!(cx === to.x && cy === to.y)) {
          if (board.pieces.some((q) => q.side !== you && q.pos.x === cx && q.pos.y === cy)) { blocked = true; break }
          cx += sx; cy += sy
        }
        if (blocked) continue
      }
      if (++n >= cap) return n
    }
    return n
  }

  if (holder && holder.side !== you && holder.type !== 'king') {
    // tackle our carrier → shoot from its square
    for (const p of board.pieces) {
      if (p.side !== you || p.type === 'king') continue
      if (!hasCleanShot(board, p, holder.pos, king)) continue
      if (!getValidMoves(p, board).some((m) => m.x === holder.pos.x && m.y === holder.pos.y)) continue
      if (immediateGoal(applyMove(board, p.id, holder.pos).boardState, you) && ++n >= cap) return n
    }
    return n
  }

  if (!holder) {
    // grab the loose ball → shoot from the move's destination
    for (const p of board.pieces) {
      if (p.side !== you || p.type === 'king') continue
      for (const to of getValidMoves(p, board)) {
        if (!hasCleanShot(board, p, to, king)) continue
        const nb = applyMove(board, p.id, to).boardState
        if (nb.ball.holderId === p.id && immediateGoal(nb, you)) { if (++n >= cap) return n; break }
      }
    }
  }
  return n
}

/** True if the ball is loose and the rival can capture it with a single move. */
function opponentCanGrabLoose(board: BoardState, you: Side): boolean {
  if (board.ball.holderId) return false
  for (const p of board.pieces) {
    if (p.side !== you || p.type === 'king') continue
    for (const to of getValidMoves(p, board)) {
      if (applyMove(board, p.id, to).boardState.ball.holderId === p.id) return true
    }
  }
  return false
}

function candidateScore(next: BoardState, side: Side, cfg: AIConfig, bias: EvalBias): number {
  const you = opp(side)
  let v = evaluate(next, side, bias)
  if (cfg.defense >= 1 && next.turn === you) {
    if (immediateGoal(next, you)) v -= 5000
    else if (cfg.defense >= 2) {
      // Graded: -700 for the first one-turn goal route, -250 per extra (capped), so
      // partial defence (block ONE lane, tackle, king step-off) is still rewarded.
      const threats = countGoalThreats(next, you, 3)
      if (threats > 0) v -= 700 + (threats - 1) * 250
    }
    if (cfg.defense >= 2) {
      // Losing possession (tackle of our carrier OR conceding a contested loose ball)
      // costs roughly the +140 we get for holding it — never so much that the engine
      // prefers abandoning a loose ball to grabbing it into a contestable square.
      if (opponentCanTackleOurHolder(next, you)) v -= 160
      else if (opponentCanGrabLoose(next, you)) v -= 150
    }
  }
  return v
}

// ── Search ────────────────────────────────────────────────────────────────────

interface Candidate { action: AIAction; next: BoardState }

function candidates(board: BoardState, side: Side): Candidate[] {
  const out: Candidate[] = []
  const holder = board.pieces.find((p) => p.id === board.ball.holderId)
  if (holder && holder.side === side) {
    for (const to of getValidPasses(holder, board)) {
      out.push({ action: { type: 'pass', pieceId: holder.id, to }, next: applyPass(board, to).boardState })
    }
  }
  for (const p of board.pieces) {
    if (p.side !== side || p.hasMovedThisTurn) continue
    for (const to of getValidMoves(p, board)) {
      out.push({ action: { type: 'move', pieceId: p.id, to }, next: applyMove(board, p.id, to).boardState })
    }
  }
  return out
}

function topCandidates(board: BoardState, side: Side, n: number, bias: EvalBias): Candidate[] {
  return candidates(board, side)
    .map((c) => ({ c, v: evaluate(c.next, side, bias) }))
    .sort((a, b) => b.v - a.v)
    .slice(0, n)
    .map((x) => x.c)
}

function findScoringCombo(board: BoardState, side: Side): AIAction[] | null {
  // 1-step: direct shot
  const direct = immediateGoal(board, side)
  if (direct) return [{ type: 'pass', pieceId: direct.pieceId, to: direct.to }]
  if (board.actionPoints < 2) return null

  // 2-step: move → shoot
  for (const p of board.pieces) {
    if (p.side !== side || p.hasMovedThisTurn) continue
    for (const to of getValidMoves(p, board)) {
      const nb = applyMove(board, p.id, to).boardState
      if (nb.turn !== side) continue
      const g = immediateGoal(nb, side)
      if (g) return [{ type: 'move', pieceId: p.id, to }, { type: 'pass', pieceId: g.pieceId, to: g.to }]
    }
  }

  // 2-step: pass → shoot (or pass is direct goal)
  const holder = board.pieces.find((p) => p.id === board.ball.holderId)
  if (holder && holder.side === side) {
    for (const to of getValidPasses(holder, board)) {
      const r = applyPass(board, to)
      if (r.goalScored) return [{ type: 'pass', pieceId: holder.id, to }]
      if (r.forcedTurnEnd || r.boardState.turn !== side) continue
      const g = immediateGoal(r.boardState, side)
      if (g) return [{ type: 'pass', pieceId: holder.id, to }, { type: 'pass', pieceId: g.pieceId, to: g.to }]
    }
  }

  if (board.actionPoints < 3) return null

  // 3-step: pass → new holder moves → shoot
  // Key case: pass to knight → knight repositions to L-jump range → knight shoots (uninterceptable)
  if (holder && holder.side === side) {
    for (const passTo of getValidPasses(holder, board)) {
      const r = applyPass(board, passTo)
      if (r.goalScored || r.forcedTurnEnd || r.boardState.turn !== side) continue
      const nb1 = r.boardState
      const newHolder = nb1.pieces.find((p) => p.id === nb1.ball.holderId)
      if (!newHolder || newHolder.side !== side || newHolder.type === 'king') continue
      for (const moveTo of getValidMoves(newHolder, nb1)) {
        const nb2 = applyMove(nb1, newHolder.id, moveTo).boardState
        if (nb2.turn !== side) continue
        const g = immediateGoal(nb2, side)
        if (g) return [
          { type: 'pass', pieceId: holder.id, to: passTo },
          { type: 'move', pieceId: newHolder.id, to: moveTo },
          { type: 'pass', pieceId: g.pieceId, to: g.to },
        ]
      }
    }
  }

  return null
}

/** A goal dominates any positional eval term; bigger than any reachable eval magnitude. */
const GOAL_VALUE = 100000

// `after` = board state once this whole turn is played out (opponent to move), so the
// adversarial layer can recurse into the opponent's reply. `scored` = this turn scores.
interface Plan { actions: AIAction[]; score: number; after: BoardState; scored: boolean }
interface Node  { state: BoardState; actions: AIAction[]; score: number }

/**
 * Order-insensitive fingerprint of a search state. Two action sequences that land on
 * the same position (same squares, same pieces already moved, same ball, same AP) are
 * the SAME plan for search purposes. Without this the beam drowns in permutations of
 * one move-set (measured: the entire top-12 plan list was a single 5-move set in
 * different orders), so its effective diversity was ~1 and the defensive veto only
 * ever examined copies of the same plan.
 */
function stateKey(s: BoardState): string {
  let k = s.turn === 'white' ? 'w' : 'b'
  for (const p of s.pieces) k += `|${p.pos.x},${p.pos.y}${p.hasMovedThisTurn ? 'm' : ''}`
  return `${k}#${s.ball.pos.x},${s.ball.pos.y},${s.ball.holderId ?? '-'}#${s.actionPoints}`
}

function searchPlans(board: BoardState, side: Side, cfg: AIConfig, bias: EvalBias): Plan[] {
  const apBudget = Math.min(board.actionPoints, cfg.depth)
  const endState = applyEndTurn(board)
  // Deduped by outcome: permutations of one move-set collapse to the best-scored copy.
  const plansByKey = new Map<string, Plan>()
  const addPlan = (p: Plan) => {
    const key = stateKey(p.after)
    const prev = plansByKey.get(key)
    if (!prev || p.score > prev.score) plansByKey.set(key, p)
  }
  addPlan({ actions: [{ type: 'end_turn' }], score: candidateScore(endState, side, cfg, bias), after: endState, scored: false })
  let frontier: Node[] = [{ state: board, actions: [], score: 0 }]

  for (let depth = 0; depth < apBudget; depth++) {
    const next = new Map<string, Node>()
    for (const node of frontier) {
      if (node.state.turn !== side) continue
      const goal = immediateGoal(node.state, side)
      if (goal) {
        const r = applyPass(node.state, goal.to)
        const actions: AIAction[] = [...node.actions, { type: 'pass', pieceId: goal.pieceId, to: goal.to }]
        addPlan({ actions, score: GOAL_VALUE, after: r.boardState, scored: true })
        continue
      }
      for (const c of topCandidates(node.state, side, cfg.beamWidth, bias)) {
        const actions: AIAction[] = [...node.actions, c.action]
        const after = c.next.turn === side ? applyEndTurn(c.next) : c.next
        // Tiny bonus per AP used so a useful longer plan breaks ties over end_turn —
        // kept small so the engine won't shuffle pieces into danger just to spend AP.
        const score = candidateScore(after, side, cfg, bias) + actions.length * 2
        addPlan({ actions, score, after, scored: false })
        if (c.next.turn !== side) continue
        const key = stateKey(c.next)
        const prev = next.get(key)
        if (!prev || score > prev.score) next.set(key, { state: c.next, actions, score })
      }
    }
    frontier = [...next.values()]
      .sort((a, b) => b.score - a.score)
      .slice(0, cfg.beamWidth)
    if (frontier.length === 0) break
  }
  return [...plansByKey.values()]
}

// ── Deep defensive lookahead ────────────────────────────────────────────────────
//
// IMPORTANT: a full negamax over the static eval makes the engine *weaker*, not
// stronger — the static eval already drives strong attacking play, and a shallow
// minimax discounts any attack whose payoff lies past the search horizon, so the
// engine turns passive and stops scoring (measured: it dropped from 20–0 to 0–10 vs
// Fable). So the offense stays 100 % static; lookahead is used *only* additively, to
// veto plans that let the opponent set up a forced goal the 1-move blunder filter
// can't see (e.g. a 2–3 AP carry/pass/reposition-then-shoot, or — for the top tier —
// a 2-turn forced goal we can't defend). This strictly demotes blunders; it never
// dampens offense.

/** Cheap config for the opponent/defence sub-search (narrow beam, no blunder filter). */
function defenceCfg(cfg: AIConfig): AIConfig {
  return { ...cfg, beamWidth: Math.min(cfg.beamWidth, 4), defense: 0, lookahead: 0 }
}

/** Top-N turn-plans for `side` by static eval, with their resulting states. */
function rankedPlans(board: BoardState, side: Side, cfg: AIConfig, bias: EvalBias, n: number): Plan[] {
  return searchPlans(board, side, cfg, bias).sort((a, b) => b.score - a.score).slice(0, n)
}

/**
 * Can `attacker` (to move in `state`) FORCE a goal within `turns` of its own turns,
 * against our best defence? `turns === 1` is just "scores on this turn" (cheap combo
 * check). For `turns >= 2` it is an AND/OR search: the attacker forces iff it has a
 * turn after which EVERY one of our replies still leaves it forcing in `turns-1`.
 */
function attackerForcesGoal(
  state: BoardState, attacker: Side, cfg: AIConfig, bias: EvalBias, turns: number,
): boolean {
  if (findScoringCombo(state, attacker)) return true
  if (turns <= 1) return false
  const k = Math.max(1, cfg.lookaheadWidth ?? 4)
  const defender = opp(attacker)
  for (const aPlan of rankedPlans(state, attacker, cfg, bias, k)) {
    if (aPlan.scored) return true
    // Our turn now (aPlan.after). The attacker only forces if we have NO saving reply.
    const ourReplies = rankedPlans(aPlan.after, defender, cfg, bias, k)
    const weCanSave = ourReplies.some((d) => !d.scored && !attackerForcesGoal(d.after, attacker, cfg, bias, turns - 1))
    if (!weCanSave) return true
  }
  return false
}

/**
 * Static plans, then a deep-defence veto over the top plans, graded by how fast the
 * opponent's goal is forced: conceding on their NEXT turn costs GOAL_VALUE, a 2-turn
 * forced loss costs GOAL_VALUE/2 (more resistant). Two-pass budget: the cheap 1-turn
 * check (findScoringCombo) sweeps a wide window; the expensive AND/OR search only
 * runs on plans that pass it. Examination stops early once `lookaheadWidth` safe
 * plans exist. If EVERY examined plan loses, the unexamined remainder (statically
 * worse and unchecked) is demoted below the graded ones, so the engine plays the most
 * RESISTANT losing plan instead of an arbitrary unexamined one — this was the failure
 * mode where, under an unstoppable threat, the veto demoted all its copies of one plan
 * and the engine scattered pieces offensively while conceding.
 */
function searchPlansDefended(board: BoardState, side: Side, cfg: AIConfig, bias: EvalBias): Plan[] {
  const plans = searchPlans(board, side, cfg, bias)
  const lookahead = cfg.lookahead ?? 0
  if (lookahead < 1 || plans.length <= 1) return plans
  const sub = defenceCfg(cfg)
  const you = opp(side)
  const ranked = plans.sort((a, b) => b.score - a.score)
  // Examine top plans, STOPPING once kSafe safe ones exist, and return the FULL list.
  // Deliberately leaky: softmax tail-picks can land on unexamined plans. Full hard-veto
  // coverage was tried and is strictly WORSE (expert fell to 30–45% vs Fable, conceding
  // MORE): with every aggressive plan demoted the engine turtles, and passivity hands
  // the opponent free tempo to build the 2-turn combos a lookahead-1 tier can't see.
  // Tempo > caution in this game — same lesson as the Iter-11 negamax failure.
  const kSafe = Math.max(1, cfg.lookaheadWidth ?? 4)
  const maxExamine = Math.min(ranked.length, kSafe * 6)
  let deepBudget = kSafe * 2
  let safe = 0
  let examined = 0
  for (let i = 0; i < maxExamine && safe < kSafe; i++) {
    const p = ranked[i]
    examined = i + 1
    if (p.scored) { safe++; continue }
    if (findScoringCombo(p.after, you)) { p.score -= GOAL_VALUE; continue }
    if (lookahead >= 2 && deepBudget > 0) {
      deepBudget--
      if (attackerForcesGoal(p.after, you, sub, bias, 2)) { p.score -= GOAL_VALUE / 2; continue }
    }
    safe++
  }
  if (safe === 0) {
    // Everything examined loses: demote the unexamined remainder (statically worse and
    // unchecked) so the engine plays the most RESISTANT losing plan — losing in 2 turns
    // (−GOAL_VALUE/2) over losing next turn (−GOAL_VALUE) — instead of an arbitrary
    // unexamined plan that leapfrogs the graded ones.
    for (let i = examined; i < ranked.length; i++) ranked[i].score -= GOAL_VALUE
  }
  return ranked
}

// ── RNG + plan selection ──────────────────────────────────────────────────────

function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function boardHash(board: BoardState): number {
  let h = 2166136261
  for (const p of board.pieces) {
    h = (h ^ (p.pos.x * 31 + p.pos.y * 17 + p.type.charCodeAt(0))) >>> 0
    h = (h * 16777619) >>> 0
  }
  h = (h ^ (board.ball.pos.x * 7 + board.ball.pos.y)) >>> 0
  h = (h ^ ((board.turnNumber ?? 0) * 2654435761)) >>> 0
  h = (h ^ (board.score.white * 73856093) ^ (board.score.black * 19349663)) >>> 0
  return h >>> 0
}

function selectPlan(plans: Plan[], cfg: AIConfig, rng: () => number): Plan {
  if (plans.length === 1) return plans[0]
  const maxScore = Math.max(...plans.map((p) => p.score))
  if (cfg.mistakeProb > 0 && rng() < cfg.mistakeProb) return plans[Math.floor(rng() * plans.length)]
  if (cfg.temperature <= 0) {
    const best = plans.filter((p) => p.score >= maxScore - 1e-6)
    return best[Math.floor(rng() * best.length)]
  }
  const weights = plans.map((p) => Math.exp((p.score - maxScore) / cfg.temperature))
  const total = weights.reduce((a, b) => a + b, 0)
  let r = rng() * total
  for (let i = 0; i < plans.length; i++) { r -= weights[i]; if (r <= 0) return plans[i] }
  return plans[plans.length - 1]
}

// ── Internal play closure ─────────────────────────────────────────────────────

function buildPlay(cfg: AIConfig, bias: EvalBias, seed: number): (board: BoardState, aiSide: Side) => AIAction[] {
  let moveCounter = 0
  return (board, aiSide) => {
    try {
      const rng = mulberry32((boardHash(board) ^ seed ^ (moveCounter++ * 0x85ebca6b)) >>> 0)
      if (cfg.combos) {
        const combo = findScoringCombo(board, aiSide)
        if (combo && !(cfg.mistakeProb > 0 && rng() < cfg.mistakeProb)) return combo
      }
      const plans = (cfg.lookahead ?? 0) >= 1
        ? searchPlansDefended(board, aiSide, cfg, bias)
        : searchPlans(board, aiSide, cfg, bias)
      if (plans.length === 0) return [{ type: 'end_turn' }]
      const chosen = selectPlan(plans, cfg, rng).actions
      return chosen.length > 0 ? chosen : [{ type: 'end_turn' }]
    } catch {
      return [{ type: 'end_turn' }]
    }
  }
}

// ── Public API ────────────────────────────────────────────────────────────────

/** Identity and display metadata for a championship AI opponent. */
export interface AIPersona {
  /** Unique string identifier used by apps to route to the right opponent. */
  id: string
  name: string
  description: string
  /** Emoji avatar shown in the UI. */
  avatar: string
  difficulty: 'beginner' | 'intermediate' | 'advanced' | 'expert' | 'legendary'
  /** Trophy name awarded to a player who defeats this AI. */
  badgeName: string
  /** Lucide icon name for the badge. */
  badgeIcon: string
}

/** A full AIPlayerScript with an additional `id` field for routing. */
export interface ChampionAI extends AIPlayerScript {
  id: string
}

/**
 * Build a championship AI from a persona + optional config and eval-bias overrides.
 *
 * `seed` pins the RNG stream (pass a fixed value for reproducible tests;
 * omit for a fresh, non-deterministic session — the default uses Date.now() XOR random).
 *
 * @example
 * // Ready-to-use opponent at intermediate difficulty:
 * const bot = createChampionAI({ id: 'my-bot', name: 'My Bot', avatar: '🤖',
 *   difficulty: 'intermediate', description: '...', badgeName: '...', badgeIcon: 'star' })
 *
 * // Expert-level with aggressive shooting bias:
 * const boss = createChampionAI(myPersona, { temperature: 5 }, { shooting: 20 })
 */
export function createChampionAI(
  persona: AIPersona,
  configOverride: Partial<AIConfig> = {},
  evalBias: EvalBias = {},
  seed = ((Date.now() >>> 0) ^ (Math.floor(Math.random() * 0xffffffff) >>> 0)) >>> 0,
): ChampionAI {
  const cfg: AIConfig = { ...TIERS[persona.difficulty as TierName], ...configOverride }
  return {
    id:          persona.id,
    name:        persona.name,
    description: persona.description,
    avatar:      persona.avatar,
    difficulty:  persona.difficulty,
    badgeName:   persona.badgeName,
    badgeIcon:   persona.badgeIcon,
    play:        buildPlay(cfg, evalBias, seed),
  }
}

/**
 * Low-level factory for fully custom configs.
 * Prefer `createChampionAI` for production opponents.
 * Used by the self-play training scripts.
 */
export function createAI(
  id: string,
  name: string,
  config: AIConfig,
  evalBias: EvalBias = {},
  seed = 0x9e3779b9,
): ChampionAI {
  const difficulty: TierName =
    (config.lookahead ?? 0) >= 2 ? 'legendary'
    : (config.lookahead ?? 0) >= 1 ? 'expert'
    : config.beamWidth >= 6 ? 'advanced'
    : config.beamWidth >= 4 ? 'intermediate'
    : 'beginner'
  return {
    id, name,
    description: '',
    avatar:      '🤖',
    difficulty,
    badgeName:   name,
    badgeIcon:   'bot',
    play:        buildPlay(config, evalBias, seed),
  }
}

/** Convenience wrapper: build a tier AI by name with an optional fixed seed. */
export const makeTier = (tier: TierName, seed?: number): ChampionAI =>
  createAI(tier, tier[0].toUpperCase() + tier.slice(1), TIERS[tier], {}, seed)

/**
 * Internal functions exposed for the self-play diagnosis scripts ONLY
 * (scripts/self-play, scripts/trace.ts). Not part of the stable public API.
 */
export const __internals = {
  evaluate, candidateScore, searchPlans, searchPlansDefended,
  findScoringCombo, attackerForcesGoal, immediateGoal, defenceCfg,
} as const

// ── Championship roster ───────────────────────────────────────────────────────

/**
 * Four championship opponents in ascending difficulty. The FLOOR is calibrated to the
 * hand-written `claude_fable_AI_player.ts` script — i.e. even the easiest championship
 * rival already plays at "Fable level" (competitive: attacks, defends, the occasional
 * basic slip), never the old 5-year-old beginner/intermediate tiers. Every rival is at
 * least as strong as that Fable script; each beats the one below it.
 *
 * Strength ladder (benchmarked vs the hand-written `claude-fable`, 12–20×130 @5AP, and
 * head-to-head — see scripts/self-play/NOTES.md "Iter 12"):
 *   • R16  chatgpt-tactico  expert (pure, no bias)   ≈ Fable (8W 4D 8L, 50%) ← the FLOOR
 *   • QF   gemini-tikitaka  expert+ (beam 12)        90% vs R16 (never loses), 96% vs Fable
 *   • SF   claude-tactico   legendary-grade          70% vs QF (lookahead-2 boss defence)
 *   • Final claude-fable    legendary (plain)        sweeps Fable 12–0, 100% vs expert,
 *                                                    60% vs SF (top rungs are close by
 *                                                    nature: two lookahead-2 tunes mirror
 *                                                    each other and saturate ~55–60%)
 *
 * vs-Fable win-rate saturates above the floor, so the upper rungs are spread on the
 * proven strength axes — beam width and `lookahead` — and validated tier-vs-tier.
 * Post-dedupe (Iter 12) the softmax operates over DISTINCT plans, so temperature is a
 * real randomness knob now: raising it above ~3 measurably weakens a tier, and eval
 * biases perturb the tuned weights hard (both were re-calibrated; the mid rungs keep a
 * small possession bias as flavour, the floor and the boss run unbiased). Beam width is
 * the dominant strength axis (beam-10 lookahead-2 LOSES 0–10 to beam-12 lookahead-1).
 *
 * Apps walk this array as a bracket, or call `createChampionAI` for a custom roster.
 * For a deliberately easy/practice bot use `makeTier('beginner' | 'intermediate' |
 * 'advanced')` — those tiers still exist, they are just no longer part of the championship.
 */
export const CHAMPIONSHIP_ROSTER: readonly ChampionAI[] = [
  // 1 — Floor (Round of 16): the MINIMUM championship level = Fable's level. Pure
  // `expert` tier, NO eval bias: post-dedupe the beam follows the eval faithfully and
  // even a mild aggressive bias (shooting +15) drops it well below the floor (50% →
  // 21–31% vs Fable). Its temp-3 play is already direct and shoot-first (ChatGPT persona).
  createChampionAI(
    {
      id:          'chatgpt-tactico',
      name:        'ChatGPT Táctico',
      description: 'Agresivo y directo. Busca el gol antes que la posesión.',
      avatar:      '⚡',
      difficulty:  'expert',
      badgeName:   'Vencedor del Táctico',
      badgeIcon:   'zap',
    },
  ),

  // 2 — Quarterfinal: "expert+" — wider beam than the floor (still lookahead 1).
  // 90% vs the floor (8W 2D 0L, never loses) and 96% vs the hand-written Fable.
  // Patient, possession style (Gemini persona).
  createChampionAI(
    {
      id:          'gemini-tikitaka',
      name:        'Gemini TikiTaka',
      description: 'Paciente y posesivo. Construye el juego con pases cortos y triangulaciones.',
      avatar:      '🌊',
      difficulty:  'expert',
      badgeName:   'Maestro del Toque',
      badgeIcon:   'wind',
    },
    { beamWidth: 12, temperature: 5, lookaheadWidth: 6 },
    { possession: 25 },
  ),

  // 3 — Semifinal: boss-grade defence — the 2-turn forced-goal veto (lookahead 2), with
  // a slightly narrower beam/veto than the final boss. 70% vs the QF tune. Positional
  // (Claude Sonnet persona).
  createChampionAI(
    {
      id:          'claude-tactico',
      name:        'Claude Táctico',
      description: 'Posicional y metódico. Controla el centro y espera el momento exacto.',
      avatar:      '🔷',
      difficulty:  'legendary',
      badgeName:   'Orden Táctico',
      badgeIcon:   'shield',
    },
    { beamWidth: 12, temperature: 5, lookaheadWidth: 2 },
    { possession: 20 },
  ),

  // 4 — Final (boss): plain `legendary` — widest beam, full 2-turn veto, temp 2.
  // Post-dedupe the softmax spreads over DISTINCT plans, so the old temperature-5
  // override now WEAKENS it (measured: lost 4-6 vs the SF tune); the board-seeded RNG
  // still varies its play. Sweeps the hand-written Fable. (Claude Fable persona.)
  createChampionAI(
    {
      id:          'claude-fable',
      name:        'Claude Fable',
      description: 'El campeón. Juega cerca de lo óptimo con un toque imprevisible.',
      avatar:      '🦉',
      difficulty:  'legendary',
      badgeName:   'Verdugo de Fable',
      badgeIcon:   'crown',
    },
  ),
]
