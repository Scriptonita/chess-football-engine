// Self-play harness for Chess.Football AI scripts.
//
// Runs full matches headlessly using ONLY the engine's pure functions, so thousands
// of games can be simulated to measure how each AI plays. The metrics here are the
// blunders and good plays we feed back when tuning a stronger AI: missed shots on
// goal, open shots conceded, possessions lost to interception, tackles won, wasted
// action points, etc.
//
// Each turn is executed with the exact same rules gating the apps use (see
// scripts/simulate.ts and the futbolajedrez turn route): every action is validated
// against the evolved state, illegal actions are skipped, the turn is force-ended
// if the script didn't end it.

import { getValidMoves, getValidPasses, checkGoal } from '../../src/game-logic'
import { applyMove, applyPass, applyEndTurn } from '../../src/game-engine'
import { getAIScript } from '../../src/ai-players/registry'
import type { BoardState, Side, Piece, PieceType } from '../../src/types/game'
import type { AIAction } from '../../src/types/ai-player'

const opp = (s: Side): Side => (s === 'white' ? 'black' : 'white')

// Initial board (mirrors getInitialBoardState in @scriptonita/chess-football-ui and
// scripts/simulate.ts). Kept local so the harness has no app/UI dependency.
function getInitialBoardState(servingSide: Side, currentScore = { white: 0, black: 0 }, maxActionPoints = 5): BoardState {
  const pieces: Piece[] = []
  const addPiece = (type: PieceType, side: Side, x: number, y: number) => {
    pieces.push({ id: `${side}_${type}_${x}_${y}`, type, side, pos: { x, y }, hasMovedThisTurn: false })
  }
  addPiece('rook', 'white', 0, 1); addPiece('rook', 'white', 8, 1)
  addPiece('bishop', 'white', 3, 2); addPiece('bishop', 'white', 5, 2)
  addPiece('king', 'white', 4, 1); addPiece('queen', 'white', 4, 5)
  addPiece('knight', 'white', 2, 4); addPiece('knight', 'white', 6, 4)
  addPiece('rook', 'black', 0, 10); addPiece('rook', 'black', 8, 10)
  addPiece('bishop', 'black', 3, 9); addPiece('bishop', 'black', 5, 9)
  addPiece('king', 'black', 4, 10); addPiece('queen', 'black', 4, 6)
  addPiece('knight', 'black', 2, 7); addPiece('knight', 'black', 6, 7)
  const servingQueen = pieces.find((p) => p.side === servingSide && p.type === 'queen')!
  return {
    pieces, ball: { pos: { ...servingQueen.pos }, holderId: servingQueen.id },
    score: currentScore, actionPoints: maxActionPoints, maxActionPoints,
    turn: servingSide, moveHistory: [], turnNumber: 1,
  }
}

/** Either a registered engine script id, or an inline prototype (e.g. our strong AI). */
export type Player = string | { id: string; play: (b: BoardState, side: Side) => AIAction[] }

type Resolved = { id: string; play: (b: BoardState, side: Side) => AIAction[] }
function resolvePlayer(p: Player): Resolved {
  if (typeof p === 'string') {
    const s = getAIScript(p)
    return { id: p, play: s ? s.play : () => [{ type: 'end_turn' }] }
  }
  return p
}

/** True if `side` holds the ball AND has a legal pass that scores a goal right now. */
export function hasImmediateGoal(board: BoardState, side: Side): boolean {
  const holder = board.pieces.find((p) => p.id === board.ball.holderId)
  if (!holder || holder.side !== side) return false
  for (const t of getValidPasses(holder, board)) {
    if (applyPass(board, t).goalScored) return true
  }
  return false
}

/**
 * Plays one full turn for `side` using its script, applying each action under the
 * same legality gate AIGameScreen uses. Returns the resulting board, how many AP
 * were actually spent, and how many illegal actions the script tried to emit.
 */
function playTurn(play: Resolved['play'], board: BoardState, side: Side): {
  board: BoardState; apSpent: number; illegal: number
} {
  let s = board
  let illegal = 0
  let apSpent = 0
  let actions
  try {
    actions = play(s, side)
  } catch {
    return { board: applyEndTurn(board), apSpent: 0, illegal: 0 }
  }

  for (const action of actions) {
    if (action.type === 'move' && action.pieceId && action.to) {
      const to = action.to
      const piece = s.pieces.find((p) => p.id === action.pieceId)
      if (!piece || !getValidMoves(piece, s).some((m) => m.x === to.x && m.y === to.y)) { illegal++; continue }
      s = applyMove(s, action.pieceId, to).boardState
      apSpent++
    } else if (action.type === 'pass' && action.to) {
      const to = action.to
      const holder = s.pieces.find((p) => p.id === s.ball.holderId)
      if (!holder || !getValidPasses(holder, s).some((m) => m.x === to.x && m.y === to.y)) { illegal++; continue }
      const r = applyPass(s, to)
      s = r.boardState
      apSpent++
      if (r.forcedTurnEnd) break
    } else if (action.type === 'end_turn') {
      break
    }
  }
  // Mirror AIGameScreen: only end the turn if it is STILL this side's and no goal.
  if (s.turn === side && !checkGoal(s)) s = applyEndTurn(s)
  return { board: s, apSpent, illegal }
}

export interface SideMetrics {
  goals: number
  /** Had a legal scoring pass at the start of the turn but did not take it. */
  missedShots: number
  /** Ended the turn leaving the opponent an immediate scoring pass. */
  concededOpenShots: number
  /** Own pass intercepted by the opponent (possession lost cheaply). */
  lostToInterception: number
  /** Intercepted an opponent pass. */
  interceptionsWon: number
  /** Regained the ball with a tackle. */
  tackles: number
  /** Turns that ended with >=2 AP unused and no goal/interception (passive play). */
  wastedApTurns: number
  /** Script emitted an illegal action (engine bug signal). */
  illegalActions: number
  /** King forced to release the ball (hoarded possession). */
  kingForcedRelease: number
  turns: number
  possessionTurns: number
}

const emptyMetrics = (): SideMetrics => ({
  goals: 0, missedShots: 0, concededOpenShots: 0, lostToInterception: 0,
  interceptionsWon: 0, tackles: 0, wastedApTurns: 0, illegalActions: 0,
  kingForcedRelease: 0, turns: 0, possessionTurns: 0,
})

export interface MatchResult {
  white: string
  black: string
  score: { white: number; black: number }
  winner: Side | 'draw'
  turns: number
  metrics: { white: SideMetrics; black: SideMetrics }
}

export interface MatchOptions {
  maxGoals?: number
  maxAP?: number
  /** Hard cap on turns to avoid stalemated games dragging on forever. */
  turnCap?: number
}

/**
 * Plays one full match: `whiteId` (white) vs `blackId` (black) to `maxGoals`.
 * Deterministic given the scripts (the engine AIs have no randomness), so a single
 * game per pairing is representative — multiple games only matter once the AI gains
 * its own variety.
 */
export function runMatch(white: Player, black: Player, opts: MatchOptions = {}): MatchResult {
  const maxGoals = opts.maxGoals ?? 3
  const maxAP = opts.maxAP ?? 5
  const turnCap = opts.turnCap ?? 800
  const playerOf: Record<Side, Resolved> = { white: resolvePlayer(white), black: resolvePlayer(black) }
  const m: Record<Side, SideMetrics> = { white: emptyMetrics(), black: emptyMetrics() }

  const score = { white: 0, black: 0 }
  let board = getInitialBoardState('white', score, maxAP)
  let turnCount = 0

  while (score.white < maxGoals && score.black < maxGoals && turnCount < turnCap) {
    const side = board.turn
    const o = opp(side)

    // ── Pre-turn snapshot ──
    m[side].turns++
    const holderPre = board.pieces.find((p) => p.id === board.ball.holderId)
    if (holderPre?.side === side) m[side].possessionTurns++
    const shotPre = hasImmediateGoal(board, side)
    if (board.kingMustRelease === side) m[side].kingForcedRelease++
    const apStart = board.actionPoints
    const preTN = board.turnNumber

    // ── Play ──
    const { board: after, apSpent, illegal } = playTurn(playerOf[side].play, board, side)
    m[side].illegalActions += illegal
    turnCount++

    // ── Goal? ──
    const scorer = checkGoal(after)
    if (scorer) {
      m[scorer].goals++
      score[scorer]++
      if (score[scorer] >= maxGoals) { board = after; break }
      // Kickoff: the side that conceded serves (mirrors AIGameScreen).
      board = getInitialBoardState(opp(scorer), score, maxAP)
      continue
    }

    // ── Post-turn quality analysis (no goal) ──
    if (shotPre) m[side].missedShots++

    const lastType = after.lastMove?.type
    if (lastType === 'interception') {
      m[side].lostToInterception++
      m[o].interceptionsWon++
    }
    // Tackles this turn: history entries stamped with this turn number, this side.
    const newEntries = after.moveHistory.filter((e) => e.turnNumber === preTN && e.pieceSide === side)
    m[side].tackles += newEntries.filter((e) => e.type === 'tackle').length

    // Left the opponent (now to move) an immediate scoring pass.
    if (after.turn === o && hasImmediateGoal(after, o)) m[side].concededOpenShots++

    // Passive turn: lots of AP left, nothing forced it to stop early.
    if (lastType !== 'interception' && apStart - apSpent >= 2) m[side].wastedApTurns++

    board = after
  }

  const winner: Side | 'draw' =
    score.white > score.black ? 'white' : score.black > score.white ? 'black' : 'draw'

  return { white: playerOf.white.id, black: playerOf.black.id, score, winner, turns: turnCount, metrics: m }
}

export const ALL_SCRIPTS = ['claude-tactico', 'chatgpt-tactico', 'gemini-tikitaka', 'claude-fable'] as const
