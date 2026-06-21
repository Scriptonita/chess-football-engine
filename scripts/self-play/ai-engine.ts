// Configurable Chess.Football AI engine — one search/eval core, parameterised into
// real difficulty tiers (beginner → expert). A TRAINING tool: it plays and tunes
// against the hand-written persona scripts via the self-play harness. (It is not yet
// shipped as a runtime opponent; the persona scripts in src/ai-players/ are.)
//
// The core (developed over 7 self-play iterations, see NOTES.md):
//   • EVALUATION FUNCTION scores any board (possession, ball advancement, shooting
//     pressure, king safety, loose-ball race, staying home on defence).
//   • BEAM SEARCH over the whole 5-AP turn finds multi-step combos (carry → pass to
//     a shooter → shoot) the old greedy scripts never saw.
//   • findScoringCombo explicitly hunts forced goals (move-then-shoot / pass-then-
//     shoot) the beam would prune.
//   • A BLUNDER FILTER refuses to hang a goal, a tackle, or a loose ball.
//
// Difficulty comes from FOUR knobs, not four separate hand-written scripts:
//   beamWidth/depth (tactical sight) · combos (sees forced goals) · defense
//   (0=blind, 1=goals, 2=full) · temperature + mistakeProb (randomness/errors).
//
// NON-DETERMINISM: plans are chosen by SOFTMAX sampling over their scores with a
// per-tier `temperature`, seeded by board-hash XOR an instance seed XOR a per-move
// counter. So the same AI no longer plays the identical move in the identical spot
// (the baseline scripts' core weakness), yet a fixed seed stays reproducible for
// benchmarking.

import { getValidMoves, getValidPasses } from '../../src/game-logic'
import { applyMove, applyPass, applyEndTurn } from '../../src/game-engine'
import type { BoardState, Side } from '../../src/types/game'
import type { AIAction } from '../../src/types/ai-player'

const BOARD_W = 9
const BOARD_H = 12
const opp = (s: Side): Side => (s === 'white' ? 'black' : 'white')
const goalRow = (side: Side): number => (side === 'white' ? BOARD_H - 1 : 0)
const cheby = (a: { x: number; y: number }, b: { x: number; y: number }) =>
  Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y))

export interface AIConfig {
  /** How many candidate plans the beam keeps per depth (tactical breadth). */
  beamWidth: number
  /** Max actions planned ahead in one turn (≤5). Lower = more myopic. */
  depth: number
  /** Hunt forced goal combos (move/pass-then-shoot). Off → misses easy goals. */
  combos: boolean
  /** 0 = ignores opponent replies, 1 = avoids hanging a direct goal, 2 = full. */
  defense: 0 | 1 | 2
  /** Softmax spread over plan scores. 0 ≈ always best; higher = more random/varied. */
  temperature: number
  /** Probability of throwing the turn away on a random legal plan (human-like error). */
  mistakeProb: number
}

// ─────────────────────────────────────────────────────────────────────────────
// Evaluation
// ─────────────────────────────────────────────────────────────────────────────

function immediateGoal(board: BoardState, side: Side): { to: { x: number; y: number }; pieceId: string } | null {
  const holder = board.pieces.find((p) => p.id === board.ball.holderId)
  if (!holder || holder.side !== side) return null
  for (const t of getValidPasses(holder, board)) {
    if (applyPass(board, t).goalScored) return { to: t, pieceId: holder.id }
  }
  return null
}

/** How many of `side`'s pieces have a clear straight/diagonal shooting line to the rival king. */
function shootingThreats(board: BoardState, side: Side): number {
  const rivalKing = board.pieces.find((p) => p.type === 'king' && p.side !== side)
  if (!rivalKing) return 0
  let n = 0
  for (const p of board.pieces) {
    if (p.side !== side || p.type === 'king') continue
    const aligned = p.pos.x === rivalKing.pos.x || p.pos.y === rivalKing.pos.y ||
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

function evaluate(board: BoardState, side: Side): number {
  const me = side, you = opp(side)
  const myKing = board.pieces.find((p) => p.type === 'king' && p.side === me)
  const yourKing = board.pieces.find((p) => p.type === 'king' && p.side === you)
  let score = 0

  score += (board.score[me] - board.score[you]) * 10000

  const holder = board.pieces.find((p) => p.id === board.ball.holderId)
  if (holder) {
    const mine = holder.side === me
    score += mine ? 140 : -140
    const dist = Math.abs(holder.pos.y - goalRow(holder.side))
    score += (BOARD_H - 1 - dist) * (mine ? 9 : -9)
    if (mine && holder.type === 'king') score -= 220
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

  score += shootingThreats(board, me) * 45
  score -= shootingThreats(board, you) * 52
  if (immediateGoal(board, you)) score -= 650
  if (board.kingMustRelease === me) score -= 160

  const cx = (BOARD_W - 1) / 2
  const weHoldBall = holder?.side === me
  for (const p of board.pieces) {
    if (p.type === 'king') continue
    score += (p.side === me ? -1 : 1) * -Math.abs(p.pos.x - cx)
    if (p.side === me && !weHoldBall) {
      const intoEnemy = BOARD_H - 1 - Math.abs(p.pos.y - goalRow(me))
      if (intoEnemy > 7) score -= (intoEnemy - 7) * 6
    }
  }
  if (myKing) score -= Math.abs(myKing.pos.x - cx) * 4
  if (yourKing) score += Math.abs(yourKing.pos.x - cx) * 4

  return score
}

// ─────────────────────────────────────────────────────────────────────────────
// Opponent-reply blunder filter (scaled by config.defense)
// ─────────────────────────────────────────────────────────────────────────────

function opponentCanTackleOurHolder(board: BoardState, you: Side): boolean {
  const holder = board.pieces.find((p) => p.id === board.ball.holderId)
  if (!holder || holder.side === you || holder.type === 'king') return false
  for (const p of board.pieces) {
    if (p.side !== you || p.type === 'king') continue
    if (getValidMoves(p, board).some((m) => m.x === holder.pos.x && m.y === holder.pos.y)) return true
  }
  return false
}

/** The opponent's one-extra-move scoring combos: carry-then-shoot, tackle-then-shoot, grab-loose-then-shoot. */
function opponentThreatAfterOneMove(board: BoardState, you: Side): boolean {
  const holder = board.pieces.find((p) => p.id === board.ball.holderId)
  if (holder && holder.side === you && holder.type !== 'king') {
    for (const to of getValidMoves(holder, board)) {
      if (immediateGoal(applyMove(board, holder.id, to).boardState, you)) return true
    }
    return false
  }
  if (holder && holder.side !== you) {
    for (const p of board.pieces) {
      if (p.side !== you || p.type === 'king') continue
      if (!getValidMoves(p, board).some((m) => m.x === holder.pos.x && m.y === holder.pos.y)) continue
      if (immediateGoal(applyMove(board, p.id, holder.pos).boardState, you)) return true
    }
    return false
  }
  if (!holder) {
    for (const p of board.pieces) {
      if (p.side !== you || p.type === 'king') continue
      for (const to of getValidMoves(p, board)) {
        const nb = applyMove(board, p.id, to).boardState
        if (nb.ball.holderId === p.id && immediateGoal(nb, you)) return true
      }
    }
  }
  return false
}

function candidateScore(next: BoardState, side: Side, cfg: AIConfig): number {
  const you = opp(side)
  let v = evaluate(next, side)
  if (cfg.defense >= 1 && next.turn === you) {
    if (immediateGoal(next, you)) v -= 5000
    else if (cfg.defense >= 2 && opponentThreatAfterOneMove(next, you)) v -= 700
    if (cfg.defense >= 2 && opponentCanTackleOurHolder(next, you)) v -= 230
  }
  return v
}

// ─────────────────────────────────────────────────────────────────────────────
// Search
// ─────────────────────────────────────────────────────────────────────────────

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

function topCandidates(board: BoardState, side: Side, n: number): Candidate[] {
  return candidates(board, side)
    .map((c) => ({ c, v: evaluate(c.next, side) }))
    .sort((a, b) => b.v - a.v)
    .slice(0, n)
    .map((x) => x.c)
}

function terminalScore(state: BoardState, side: Side, cfg: AIConfig): number {
  const st = state.turn === side ? applyEndTurn(state) : state
  return candidateScore(st, side, cfg)
}

function findScoringCombo(board: BoardState, side: Side): AIAction[] | null {
  const direct = immediateGoal(board, side)
  if (direct) return [{ type: 'pass', pieceId: direct.pieceId, to: direct.to }]
  if (board.actionPoints < 2) return null
  for (const p of board.pieces) {
    if (p.side !== side || p.hasMovedThisTurn) continue
    for (const to of getValidMoves(p, board)) {
      const nb = applyMove(board, p.id, to).boardState
      if (nb.turn !== side) continue
      const g = immediateGoal(nb, side)
      if (g) return [{ type: 'move', pieceId: p.id, to }, { type: 'pass', pieceId: g.pieceId, to: g.to }]
    }
  }
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
  return null
}

interface Plan { actions: AIAction[]; score: number }
interface Node { state: BoardState; actions: AIAction[]; score: number }

/** Beam search; returns ALL complete plans found (so the caller can sample one). */
function searchPlans(board: BoardState, side: Side, cfg: AIConfig): Plan[] {
  const apBudget = Math.min(board.actionPoints, cfg.depth)
  const plans: Plan[] = [{ actions: [{ type: 'end_turn' }], score: terminalScore(board, side, cfg) }]

  let frontier: Node[] = [{ state: board, actions: [], score: 0 }]
  for (let depth = 0; depth < apBudget; depth++) {
    const next: Node[] = []
    for (const node of frontier) {
      if (node.state.turn !== side) continue
      const goal = immediateGoal(node.state, side)
      if (goal) {
        const r = applyPass(node.state, goal.to)
        const actions = [...node.actions, { type: 'pass' as const, pieceId: goal.pieceId, to: goal.to }]
        const score = terminalScore(r.boardState, side, cfg)
        plans.push({ actions, score })
        continue
      }
      for (const c of topCandidates(node.state, side, cfg.beamWidth)) {
        const actions = [...node.actions, c.action]
        const score = terminalScore(c.next, side, cfg)
        plans.push({ actions, score })
        next.push({ state: c.next, actions, score })
      }
    }
    frontier = next.filter((n) => n.state.turn === side).sort((a, b) => b.score - a.score).slice(0, cfg.beamWidth)
    if (frontier.length === 0) break
  }
  return plans
}

// ─────────────────────────────────────────────────────────────────────────────
// Seeded RNG + softmax selection
// ─────────────────────────────────────────────────────────────────────────────

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
  return h
}

/** Softmax-sample a plan by score with the given temperature (0 → strict argmax). */
function selectPlan(plans: Plan[], cfg: AIConfig, rng: () => number): Plan {
  if (plans.length === 1) return plans[0]
  const maxScore = Math.max(...plans.map((p) => p.score))

  // Human-like error: occasionally just pick any legal plan outright.
  if (cfg.mistakeProb > 0 && rng() < cfg.mistakeProb) {
    return plans[Math.floor(rng() * plans.length)]
  }
  if (cfg.temperature <= 0) {
    // Argmax, but break ties randomly so play still varies between equal options.
    const best = plans.filter((p) => p.score >= maxScore - 1e-6)
    return best[Math.floor(rng() * best.length)]
  }
  // Numerically stable softmax over (score - max).
  const weights = plans.map((p) => Math.exp((p.score - maxScore) / cfg.temperature))
  const total = weights.reduce((a, b) => a + b, 0)
  let r = rng() * total
  for (let i = 0; i < plans.length; i++) {
    r -= weights[i]
    if (r <= 0) return plans[i]
  }
  return plans[plans.length - 1]
}

// ─────────────────────────────────────────────────────────────────────────────
// Public factory
// ─────────────────────────────────────────────────────────────────────────────

export interface AIPlayer {
  id: string
  name: string
  config: AIConfig
  play: (board: BoardState, side: Side) => AIAction[]
}

/**
 * Build an AI from a config. `seed` fixes the RNG stream (reproducible benchmarks);
 * omit it (or pass Date.now()) for fresh, non-deterministic play each session.
 */
export function createAI(id: string, name: string, config: AIConfig, seed = 0x9e3779b9): AIPlayer {
  let moveCounter = 0
  return {
    id, name, config,
    play(board, side) {
      try {
        const rng = mulberry32((boardHash(board) ^ seed ^ (moveCounter++ * 0x85ebca6b)) >>> 0)
        if (config.combos) {
          const combo = findScoringCombo(board, side)
          // Even when a forced goal exists, an error-prone tier may fluff it.
          if (combo && !(config.mistakeProb > 0 && rng() < config.mistakeProb)) return combo
        }
        const plans = searchPlans(board, side, config)
        return selectPlan(plans, config, rng).actions
      } catch {
        return [{ type: 'end_turn' }]
      }
    },
  }
}

// ── Difficulty tiers ──────────────────────────────────────────────────────────
// Tuned so each tier reliably beats the one below and loses to the one above.
export const TIERS: Record<'beginner' | 'intermediate' | 'advanced' | 'expert', AIConfig> = {
  beginner:     { beamWidth: 2,  depth: 2, combos: false, defense: 0, temperature: 220, mistakeProb: 0.35 },
  intermediate: { beamWidth: 4,  depth: 3, combos: true,  defense: 1, temperature: 90,  mistakeProb: 0.12 },
  advanced:     { beamWidth: 6,  depth: 4, combos: true,  defense: 2, temperature: 35,  mistakeProb: 0.03 },
  expert:       { beamWidth: 10, depth: 5, combos: true,  defense: 2, temperature: 8,   mistakeProb: 0 },
}

export const makeTier = (tier: keyof typeof TIERS, seed?: number): AIPlayer =>
  createAI(tier, tier[0].toUpperCase() + tier.slice(1), TIERS[tier], seed)
