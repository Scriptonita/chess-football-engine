// Claude Opus — a single maximum-strength Chess.Football player.
//
// Strategy in three sentences: it runs a full-turn BEAM SEARCH (up to all 5 AP) over
// a faithful in-script copy of the engine, scoring every resulting board with a
// positional EVALUATION (goal diff, possession, ball advancement, shooting lanes for
// and against, king safety, loose-ball race, staying home on defence) and an explicit
// GOAL-COMBO finder for forced move→shoot / pass→shoot scores. A BLUNDER FILTER
// penalises leaving the rival an immediate goal, a one-move goal, or our carrier
// exposed to a tackle. Plans are chosen by low-temperature SOFTMAX over their scores
// (board-seeded RNG), so it plays near-optimally yet never repeats the identical line
// in the identical position — in particular the kickoff after a goal varies.
//
// Self-contained: imports only ../types/game and re-implements the engine's pure
// helpers (getValidMoves/getValidPasses/applyMove/applyPass/applyEndTurn) exactly, so
// every action is planned against a correctly simulated state (sections 2b/5/5c).

import { BoardState, Side, Position, Piece } from '../types/game'

interface AIAction {
  type: 'move' | 'pass' | 'end_turn'
  pieceId?: string
  to?: Position
}

interface AIPlayerScript {
  name: string
  description: string
  avatar: string
  difficulty: 'beginner' | 'intermediate' | 'advanced' | 'expert'
  badgeName: string
  badgeIcon: string
  play: (boardState: BoardState, aiSide: Side) => AIAction[]
}

// ============================================================================
// Board geometry
// ============================================================================

const BOARD_W = 9
const BOARD_H = 12

type BallState = { pos: Position; holderId: string | null }
type PieceType = Piece['type']

const KNIGHT_JUMPS: ReadonlyArray<readonly [number, number]> = [
  [1, 2], [1, -2], [-1, 2], [-1, -2], [2, 1], [2, -1], [-2, 1], [-2, -1],
]

const opp = (s: Side): Side => (s === 'white' ? 'black' : 'white')
const goalRow = (side: Side): number => (side === 'white' ? BOARD_H - 1 : 0)
const inBoard = (x: number, y: number): boolean => x >= 0 && x < BOARD_W && y >= 0 && y < BOARD_H
const isLinearPiece = (t: PieceType): boolean => t === 'rook' || t === 'bishop' || t === 'queen' || t === 'king'
const cheby = (a: Position, b: Position): number => Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y))

function isInOwnArea(pos: Position, side: Side): boolean {
  if (pos.x < 2 || pos.x > 6) return false
  return side === 'white' ? pos.y >= 0 && pos.y <= 1 : pos.y >= 10 && pos.y <= 11
}

function isInEnemyArea(pos: Position, side: Side): boolean {
  return isInOwnArea(pos, opp(side))
}

// ============================================================================
// Engine replica — getValidMoves / getValidPasses
// (mirrors src/game-logic.ts exactly: moves are blocked, passes fly over)
// ============================================================================

function getValidMoves(piece: Piece, board: BoardState): Position[] {
  const moves: Position[] = []
  const { x, y } = piece.pos

  const pieceAt = (px: number, py: number): Piece | undefined =>
    board.pieces.find((p) => p.pos.x === px && p.pos.y === py)

  const isRivalKingSquare = (px: number, py: number): boolean => {
    const p = pieceAt(px, py)
    return !!p && p.type === 'king' && p.side !== piece.side
  }

  const isAreaValid = (px: number, py: number): boolean =>
    piece.type === 'king'
      ? isInOwnArea({ x: px, y: py }, piece.side)
      : !isInOwnArea({ x: px, y: py }, piece.side)

  // The displaced holder needs a free orthogonal square; the tackler's own square counts as free.
  const canDisplace = (hx: number, hy: number): boolean =>
    ([[hx + 1, hy], [hx - 1, hy], [hx, hy + 1], [hx, hy - 1]] as Array<[number, number]>)
      .filter(([nx, ny]) => inBoard(nx, ny))
      .some(([nx, ny]) => !board.pieces.some((p) => p.pos.x === nx && p.pos.y === ny && p.id !== piece.id))

  const isValidDest = (px: number, py: number): boolean => {
    if (isRivalKingSquare(px, py)) return false
    const pa = pieceAt(px, py)
    if (!pa) return true
    if (pa.side === piece.side) return false
    if (board.ball.holderId === pa.id) return canDisplace(pa.pos.x, pa.pos.y)
    return false
  }

  const addLine = (dx: number, dy: number): void => {
    let cx = x + dx
    let cy = y + dy
    while (inBoard(cx, cy)) {
      const pa = pieceAt(cx, cy)
      if (!pa) {
        if (isAreaValid(cx, cy)) moves.push({ x: cx, y: cy })
      } else {
        if (isAreaValid(cx, cy) && isValidDest(cx, cy)) moves.push({ x: cx, y: cy })
        break
      }
      cx += dx
      cy += dy
    }
  }

  switch (piece.type) {
    case 'king':
      for (let dx = -1; dx <= 1; dx++) {
        for (let dy = -1; dy <= 1; dy++) {
          if (dx === 0 && dy === 0) continue
          const nx = x + dx
          const ny = y + dy
          if (inBoard(nx, ny) && isAreaValid(nx, ny) && isValidDest(nx, ny)) moves.push({ x: nx, y: ny })
        }
      }
      break
    case 'rook':
      addLine(1, 0); addLine(-1, 0); addLine(0, 1); addLine(0, -1)
      break
    case 'bishop':
      addLine(1, 1); addLine(1, -1); addLine(-1, 1); addLine(-1, -1)
      break
    case 'queen':
      addLine(1, 0); addLine(-1, 0); addLine(0, 1); addLine(0, -1)
      addLine(1, 1); addLine(1, -1); addLine(-1, 1); addLine(-1, -1)
      break
    case 'knight':
      for (const [dx, dy] of KNIGHT_JUMPS) {
        const nx = x + dx
        const ny = y + dy
        if (inBoard(nx, ny) && isAreaValid(nx, ny) && isValidDest(nx, ny)) moves.push({ x: nx, y: ny })
      }
      break
  }
  return moves
}

function getValidPasses(piece: Piece, board: BoardState): Position[] {
  const moves: Position[] = []
  const { x, y } = piece.pos

  const blockedKeeper = board.keeperBlockedId
    ? board.pieces.find((p) => p.id === board.keeperBlockedId)
    : undefined
  // Only the OWN blocked keeper's square is excluded; a blocked RIVAL keeper is a valid shot.
  const isBlockedKeeperPos = (px: number, py: number): boolean =>
    !!blockedKeeper && blockedKeeper.side === piece.side && blockedKeeper.pos.x === px && blockedKeeper.pos.y === py

  const addLine = (dx: number, dy: number): void => {
    let cx = x + dx
    let cy = y + dy
    while (inBoard(cx, cy)) {
      if (!isBlockedKeeperPos(cx, cy)) moves.push({ x: cx, y: cy })
      cx += dx
      cy += dy
    }
  }

  switch (piece.type) {
    case 'king':
      for (let dx = -1; dx <= 1; dx++) {
        for (let dy = -1; dy <= 1; dy++) {
          if (dx === 0 && dy === 0) continue
          const nx = x + dx
          const ny = y + dy
          if (inBoard(nx, ny) && !isBlockedKeeperPos(nx, ny)) moves.push({ x: nx, y: ny })
        }
      }
      break
    case 'rook':
      addLine(1, 0); addLine(-1, 0); addLine(0, 1); addLine(0, -1)
      break
    case 'bishop':
      addLine(1, 1); addLine(1, -1); addLine(-1, 1); addLine(-1, -1)
      break
    case 'queen':
      addLine(1, 0); addLine(-1, 0); addLine(0, 1); addLine(0, -1)
      addLine(1, 1); addLine(1, -1); addLine(-1, 1); addLine(-1, -1)
      break
    case 'knight':
      for (const [dx, dy] of KNIGHT_JUMPS) {
        const nx = x + dx
        const ny = y + dy
        if (inBoard(nx, ny) && !isBlockedKeeperPos(nx, ny)) moves.push({ x: nx, y: ny })
      }
      break
  }
  return moves
}

// ============================================================================
// Engine replica — applyMove / applyPass / applyEndTurn
// (mirrors src/game-engine.ts; move history & timestamps dropped — never read)
// ============================================================================

/** Squares strictly between `from` and `to`, plus `to` (excludes `from`). */
function getPath(from: Position, to: Position): Position[] {
  const path: Position[] = []
  const dx = Math.sign(to.x - from.x)
  const dy = Math.sign(to.y - from.y)
  let cx = from.x + dx
  let cy = from.y + dy
  let it = 0
  while ((cx !== to.x || cy !== to.y) && it < 20) {
    path.push({ x: cx, y: cy })
    cx += dx
    cy += dy
    it++
  }
  path.push({ x: to.x, y: to.y })
  return path
}

function findAdjacentEmptySquare(pos: Position, pieces: Piece[]): Position | null {
  const candidates: Position[] = [
    { x: pos.x, y: pos.y + 1 }, { x: pos.x, y: pos.y - 1 },
    { x: pos.x + 1, y: pos.y }, { x: pos.x - 1, y: pos.y },
    { x: pos.x + 1, y: pos.y + 1 }, { x: pos.x - 1, y: pos.y - 1 },
    { x: pos.x + 1, y: pos.y - 1 }, { x: pos.x - 1, y: pos.y + 1 },
  ]
  return candidates.find((n) =>
    inBoard(n.x, n.y) && !pieces.some((p) => p.pos.x === n.x && p.pos.y === n.y)
  ) ?? null
}

function resetPieceFlags(pieces: Piece[]): Piece[] {
  return pieces.map((p) => (p.hasMovedThisTurn ? { ...p, hasMovedThisTurn: false } : p))
}

interface KingFlags {
  ball: BallState
  kingMustRelease: Side | undefined
  keeperBlockedId: string | undefined
}

function computeKingTurnEndFlags(
  prevKingMustRelease: Side | undefined,
  prevKeeperBlockedId: string | undefined,
  departingSide: Side,
  pieces: Piece[],
  ball: BallState,
): KingFlags {
  const king = pieces.find((p) => p.type === 'king' && p.side === departingSide)
  if (!king || ball.holderId !== king.id) {
    return {
      ball,
      kingMustRelease: prevKingMustRelease === departingSide ? undefined : prevKingMustRelease,
      keeperBlockedId: prevKeeperBlockedId,
    }
  }
  if (prevKingMustRelease === departingSide) {
    const releasePos = findAdjacentEmptySquare(king.pos, pieces)
    return {
      ball: releasePos ? { pos: releasePos, holderId: null } : { ...ball, holderId: null },
      kingMustRelease: undefined,
      keeperBlockedId: king.id,
    }
  }
  return { ball, kingMustRelease: departingSide, keeperBlockedId: prevKeeperBlockedId }
}

interface OffsideResult {
  ball: BallState
  keeperBlockedId: string | undefined
}

function applyOffsideAtTurnEnd(
  departingSide: Side,
  pieces: Piece[],
  ball: BallState,
  keeperBlockedId: string | undefined,
): OffsideResult {
  if (!ball.holderId) return { ball, keeperBlockedId }
  const holder = pieces.find((p) => p.id === ball.holderId)
  if (!holder || holder.type === 'king' || holder.side !== departingSide) return { ball, keeperBlockedId }
  if (!isInEnemyArea(holder.pos, departingSide)) return { ball, keeperBlockedId }
  const rivalKing = pieces.find((p) => p.type === 'king' && p.side === opp(departingSide))
  if (!rivalKing) return { ball, keeperBlockedId }
  return {
    ball: { pos: { ...rivalKing.pos }, holderId: rivalKing.id },
    keeperBlockedId: keeperBlockedId?.startsWith(departingSide + '_') ? undefined : keeperBlockedId,
  }
}

interface MoveResult {
  boardState: BoardState
  moveType: 'move' | 'tackle'
}

function applyMove(board: BoardState, pieceId: string, to: Position): MoveResult {
  const piece = board.pieces.find((p) => p.id === pieceId)!
  let ball: BallState = { ...board.ball }
  let moveType: 'move' | 'tackle' = 'move'
  let keeperBlockedId = board.keeperBlockedId

  const rivalAtDest = board.pieces.find((p) => p.pos.x === to.x && p.pos.y === to.y && p.side !== piece.side)
  let rivalNewPos: Position | null = null
  if (rivalAtDest && ball.holderId === rivalAtDest.id) {
    moveType = 'tackle'
    const neighbors = ([[to.x + 1, to.y], [to.x - 1, to.y], [to.x, to.y + 1], [to.x, to.y - 1]] as Array<[number, number]>)
      .filter(([nx, ny]) => inBoard(nx, ny))
      .filter(([nx, ny]) => !board.pieces.some((p) => p.pos.x === nx && p.pos.y === ny && p.id !== pieceId))
    if (neighbors.length > 0) rivalNewPos = { x: neighbors[0][0], y: neighbors[0][1] }
    ball = { holderId: piece.id, pos: to }
    if (keeperBlockedId && !keeperBlockedId.startsWith(piece.side + '_')) keeperBlockedId = undefined
  }

  const newPieces = board.pieces.map((p) => {
    if (p.id === pieceId) return { ...p, pos: to, hasMovedThisTurn: true }
    if (rivalAtDest && p.id === rivalAtDest.id && rivalNewPos) return { ...p, pos: rivalNewPos }
    return p
  })

  if (moveType !== 'tackle') {
    const wasLoose = !ball.holderId
    if (!ball.holderId && isLinearPiece(piece.type)) {
      const path = getPath(piece.pos, to)
      if (path.some((pp) => pp.x === ball.pos.x && pp.y === ball.pos.y)) ball = { holderId: piece.id, pos: to }
    } else if (!ball.holderId && piece.type === 'knight') {
      if (ball.pos.x === to.x && ball.pos.y === to.y) ball = { holderId: piece.id, pos: to }
    } else if (ball.holderId === pieceId) {
      ball = { ...ball, pos: to }
    } else if (!ball.holderId && ball.pos.x === to.x && ball.pos.y === to.y) {
      ball = { holderId: piece.id, pos: to }
    }
    if (wasLoose && ball.holderId === piece.id && keeperBlockedId && !keeperBlockedId.startsWith(piece.side + '_')) {
      keeperBlockedId = undefined
    }
  }

  const nextAP = board.actionPoints - 1
  const kingAfterMove = newPieces.find((p) => p.type === 'king' && p.side === board.turn)
  const kingPenalty =
    nextAP === 1 && board.kingMustRelease === board.turn && !!kingAfterMove && ball.holderId === kingAfterMove.id
  const isTurnOver = nextAP === 0 || kingPenalty
  const nextTurn = isTurnOver ? opp(board.turn) : board.turn
  const turnNumber = board.turnNumber ?? 1

  const kingFlags: KingFlags = isTurnOver
    ? computeKingTurnEndFlags(board.kingMustRelease, keeperBlockedId, board.turn, newPieces, ball)
    : { ball, kingMustRelease: board.kingMustRelease, keeperBlockedId }
  const offside: OffsideResult = isTurnOver
    ? applyOffsideAtTurnEnd(board.turn, newPieces, kingFlags.ball, kingFlags.keeperBlockedId)
    : { ball: kingFlags.ball, keeperBlockedId: kingFlags.keeperBlockedId }

  return {
    moveType,
    boardState: {
      ...board,
      pieces: isTurnOver ? resetPieceFlags(newPieces) : newPieces,
      ball: offside.ball,
      actionPoints: isTurnOver ? board.maxActionPoints ?? 5 : nextAP,
      turn: nextTurn,
      turnNumber: isTurnOver ? turnNumber + 1 : turnNumber,
      kingMustRelease: kingFlags.kingMustRelease,
      keeperBlockedId: offside.keeperBlockedId,
    },
  }
}

interface PassResult {
  boardState: BoardState
  forcedTurnEnd: boolean
  goalScored: boolean
}

function applyPass(board: BoardState, to: Position): PassResult {
  const holder = board.pieces.find((p) => p.id === board.ball.holderId)!
  let ball: BallState = { ...board.ball }
  let forcedTurnEnd = false
  let goalScored = false
  let keeperBlockedId = board.keeperBlockedId
  let kingMustRelease = board.kingMustRelease

  const path = holder.type !== 'knight' ? getPath(holder.pos, to) : [to]
  const firstEnemy = path
    .map((pos) => board.pieces.find((p) => p.pos.x === pos.x && p.pos.y === pos.y && p.side !== holder.side))
    .find(Boolean)

  if (firstEnemy) {
    if (firstEnemy.type === 'king') {
      ball = { holderId: null, pos: firstEnemy.pos }
      forcedTurnEnd = true
      goalScored = true
    } else {
      ball = { holderId: firstEnemy.id, pos: firstEnemy.pos }
      forcedTurnEnd = true
    }
    if (keeperBlockedId && !keeperBlockedId.startsWith(firstEnemy.side + '_')) keeperBlockedId = undefined
  }

  if (!forcedTurnEnd) {
    const teammateAtDest = board.pieces.find((p) => p.pos.x === to.x && p.pos.y === to.y && p.side === holder.side)
    ball = { pos: to, holderId: teammateAtDest ? teammateAtDest.id : null }
    if (holder.type === 'king') {
      keeperBlockedId = holder.id
      if (kingMustRelease === holder.side) kingMustRelease = undefined
    }
  }

  const nextAP = forcedTurnEnd ? 0 : board.actionPoints - 1
  const isTurnOver = nextAP === 0
  const nextTurn = isTurnOver ? opp(board.turn) : board.turn
  const turnNumber = board.turnNumber ?? 1

  const kingFlags: KingFlags = isTurnOver
    ? computeKingTurnEndFlags(kingMustRelease, keeperBlockedId, board.turn, board.pieces, ball)
    : { ball, kingMustRelease, keeperBlockedId }
  const offside: OffsideResult = isTurnOver
    ? applyOffsideAtTurnEnd(board.turn, board.pieces, kingFlags.ball, kingFlags.keeperBlockedId)
    : { ball: kingFlags.ball, keeperBlockedId: kingFlags.keeperBlockedId }

  return {
    forcedTurnEnd,
    goalScored,
    boardState: {
      ...board,
      ball: offside.ball,
      actionPoints: isTurnOver ? board.maxActionPoints ?? 5 : nextAP,
      turn: nextTurn,
      turnNumber: isTurnOver ? turnNumber + 1 : turnNumber,
      pieces: isTurnOver ? resetPieceFlags(board.pieces) : board.pieces,
      kingMustRelease: kingFlags.kingMustRelease,
      keeperBlockedId: offside.keeperBlockedId,
    },
  }
}

function applyEndTurn(board: BoardState): BoardState {
  const kingFlags = computeKingTurnEndFlags(
    board.kingMustRelease, board.keeperBlockedId, board.turn, board.pieces, board.ball,
  )
  const turnNumber = board.turnNumber ?? 1
  const offside = applyOffsideAtTurnEnd(board.turn, board.pieces, kingFlags.ball, kingFlags.keeperBlockedId)
  return {
    ...board,
    turn: opp(board.turn),
    actionPoints: board.maxActionPoints ?? 5,
    turnNumber: turnNumber + 1,
    pieces: resetPieceFlags(board.pieces),
    ball: offside.ball,
    kingMustRelease: kingFlags.kingMustRelease,
    keeperBlockedId: offside.keeperBlockedId,
  }
}

// ============================================================================
// Evaluation
// ============================================================================

interface AIConfig {
  beamWidth: number
  depth: number
  combos: boolean
  defense: 0 | 1 | 2
  temperature: number
}

// Maximum strength: wide beam, full-turn depth, goal combos on, full defensive
// awareness, low (not zero) temperature so it varies only between near-optimal lines.
const CFG: AIConfig = { beamWidth: 10, depth: 5, combos: true, defense: 2, temperature: 8 }

/** A legal scoring pass for `side` from the current position, or null. */
function immediateGoal(board: BoardState, side: Side): { to: Position; pieceId: string } | null {
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
    const aligned =
      p.pos.x === rivalKing.pos.x || p.pos.y === rivalKing.pos.y ||
      Math.abs(rivalKing.pos.x - p.pos.x) === Math.abs(rivalKing.pos.y - p.pos.y)
    if (!aligned) continue
    const dx = Math.sign(rivalKing.pos.x - p.pos.x)
    const dy = Math.sign(rivalKing.pos.y - p.pos.y)
    let cx = p.pos.x + dx
    let cy = p.pos.y + dy
    let clear = true
    while (!(cx === rivalKing.pos.x && cy === rivalKing.pos.y)) {
      if (board.pieces.some((q) => q.pos.x === cx && q.pos.y === cy)) { clear = false; break }
      cx += dx
      cy += dy
    }
    if (clear) n++
  }
  return n
}

function evaluate(board: BoardState, side: Side): number {
  const me = side
  const you = opp(side)
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
    let myMin = 99
    let yourMin = 99
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

// ============================================================================
// Opponent-reply blunder filter
// ============================================================================

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

// ============================================================================
// Search
// ============================================================================

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

/** Hunts a forced goal this turn (direct shot, move→shoot, or pass→shoot). */
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

/** Beam search over the whole turn; returns ALL complete plans found (caller samples one). */
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
        const actions: AIAction[] = [...node.actions, { type: 'pass', pieceId: goal.pieceId, to: goal.to }]
        plans.push({ actions, score: terminalScore(r.boardState, side, cfg) })
        continue
      }
      for (const c of topCandidates(node.state, side, cfg.beamWidth)) {
        const actions: AIAction[] = [...node.actions, c.action]
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

// ============================================================================
// Seeded RNG + softmax selection (non-determinism with judgment)
// ============================================================================

function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
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

/** Softmax-sample a plan by score with temperature; ties broken at random. */
function selectPlan(plans: Plan[], cfg: AIConfig, rng: () => number): Plan {
  if (plans.length === 1) return plans[0]
  const maxScore = Math.max(...plans.map((p) => p.score))
  if (cfg.temperature <= 0) {
    const best = plans.filter((p) => p.score >= maxScore - 1e-6)
    return best[Math.floor(rng() * best.length)]
  }
  const weights = plans.map((p) => Math.exp((p.score - maxScore) / cfg.temperature))
  const total = weights.reduce((a, b) => a + b, 0)
  let r = rng() * total
  for (let i = 0; i < plans.length; i++) {
    r -= weights[i]
    if (r <= 0) return plans[i]
  }
  return plans[plans.length - 1]
}

// A per-instance nonce keeps play fresh across sessions; combined per-turn with the
// board hash and a move counter it stays board-derived (no wall-clock in the per-turn
// decision logic). Same position no longer resolves the same way every game.
const INSTANCE_SEED = ((Date.now() >>> 0) ^ (Math.floor(Math.random() * 0xffffffff) >>> 0)) >>> 0
let moveCounter = 0

// ============================================================================
// Player
// ============================================================================

export const aiPlayer: AIPlayerScript = {
  name: 'Claude Opus',
  description:
    'Busca el turno completo con evaluación posicional y combos de gol forzado; defiende anticipando el mover-y-chutar rival y elige con temperatura baja para ser fuerte sin volverse previsible.',
  avatar: '🦉',
  difficulty: 'expert',
  badgeName: 'Verdugo de Opus',
  badgeIcon: 'crown',
  play: (boardState: BoardState, aiSide: Side): AIAction[] => {
    try {
      const rng = mulberry32((boardHash(boardState) ^ INSTANCE_SEED ^ (moveCounter++ * 0x85ebca6b)) >>> 0)
      if (CFG.combos) {
        const combo = findScoringCombo(boardState, aiSide)
        if (combo) return combo
      }
      const plans = searchPlans(boardState, aiSide, CFG)
      if (plans.length === 0) return [{ type: 'end_turn' }]
      const actions = selectPlan(plans, CFG, rng).actions
      return actions.length > 0 ? actions : [{ type: 'end_turn' }]
    } catch {
      return [{ type: 'end_turn' }]
    }
  },
}
