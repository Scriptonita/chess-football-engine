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

// ============================================
// Funciones auxiliares internas
// ============================================

const DIRS_8: ReadonlyArray<readonly [number, number]> = [
  [-1, -1], [-1, 0], [-1, 1], [0, -1], [0, 1], [1, -1], [1, 0], [1, 1],
]
const DIRS_ROOK: ReadonlyArray<readonly [number, number]> = [[1, 0], [-1, 0], [0, 1], [0, -1]]
const DIRS_BISHOP: ReadonlyArray<readonly [number, number]> = [[1, 1], [1, -1], [-1, 1], [-1, -1]]
const KNIGHT_JUMPS: ReadonlyArray<readonly [number, number]> = [
  [1, 2], [1, -2], [-1, 2], [-1, -2], [2, 1], [2, -1], [-2, 1], [-2, -1],
]

function inBoard(p: Position): boolean {
  return p.x >= 0 && p.x < 9 && p.y >= 0 && p.y < 12
}

function posEq(a: Position, b: Position): boolean {
  return a.x === b.x && a.y === b.y
}

function otherSide(s: Side): Side {
  return s === 'white' ? 'black' : 'white'
}

/** Área propia del lado `side` (5×2). */
function isInArea(pos: Position, side: Side): boolean {
  if (pos.x < 2 || pos.x > 6) return false
  return side === 'white' ? pos.y <= 1 : pos.y >= 10
}

function isInEnemyArea(pos: Position, side: Side): boolean {
  return isInArea(pos, otherSide(side))
}

function pieceAt(state: BoardState, pos: Position): Piece | undefined {
  return state.pieces.find(p => p.pos.x === pos.x && p.pos.y === pos.y)
}

function getHolder(state: BoardState): Piece | null {
  if (!state.ball.holderId) return null
  return state.pieces.find(p => p.id === state.ball.holderId) ?? null
}

function findKing(state: BoardState, side: Side): Piece | null {
  return state.pieces.find(p => p.type === 'king' && p.side === side) ?? null
}

function cloneState(s: BoardState): BoardState {
  return {
    ...s,
    pieces: s.pieces.map(p => ({ ...p, pos: { ...p.pos } })),
    ball: { pos: { ...s.ball.pos }, holderId: s.ball.holderId },
    score: { ...s.score },
  }
}

/** Casillas de la línea recta entre from y to, incluyendo to (máx. 20 pasos). */
function getPath(from: Position, to: Position): Position[] {
  const path: Position[] = []
  const dx = Math.sign(to.x - from.x)
  const dy = Math.sign(to.y - from.y)
  let cx = from.x + dx
  let cy = from.y + dy
  let steps = 0
  while ((cx !== to.x || cy !== to.y) && steps < 20) {
    path.push({ x: cx, y: cy })
    cx += dx
    cy += dy
    steps++
  }
  path.push({ x: to.x, y: to.y })
  return path
}

/** ¿`target` está estrictamente entre from y to (sin contar extremos)? */
function isOnLineBetween(from: Position, to: Position, target: Position): boolean {
  const dx = Math.sign(to.x - from.x)
  const dy = Math.sign(to.y - from.y)
  if (dx === 0 && dy === 0) return false
  let cx = from.x + dx
  let cy = from.y + dy
  let steps = 0
  while ((cx !== to.x || cy !== to.y) && steps < 20) {
    if (cx === target.x && cy === target.y) return true
    cx += dx
    cy += dy
    steps++
  }
  return false
}

/** El portador en holderPos puede ser desplazado: alguna ortogonal libre (la casilla del atacante cuenta como libre). */
function canDisplace(state: BoardState, holderPos: Position, attackerId: string): boolean {
  return [
    { x: holderPos.x + 1, y: holderPos.y },
    { x: holderPos.x - 1, y: holderPos.y },
    { x: holderPos.x, y: holderPos.y + 1 },
    { x: holderPos.x, y: holderPos.y - 1 },
  ].filter(inBoard)
   .some(n => !state.pieces.some(p => p.pos.x === n.x && p.pos.y === n.y && p.id !== attackerId))
}

function getValidMoves(piece: Piece, state: BoardState): Position[] {
  const moves: Position[] = []

  const isAreaValid = (dest: Position): boolean =>
    piece.type === 'king' ? isInArea(dest, piece.side) : !isInArea(dest, piece.side)

  const isValidDest = (dest: Position): boolean => {
    const at = pieceAt(state, dest)
    if (!at) return true
    if (at.side === piece.side) return false
    if (at.type === 'king') return false
    // Tackle: solo si el rival tiene el balón y puede ser desplazado
    if (state.ball.holderId === at.id) return canDisplace(state, at.pos, piece.id)
    return false
  }

  const tryAdd = (dest: Position) => {
    if (inBoard(dest) && isAreaValid(dest) && isValidDest(dest)) moves.push(dest)
  }

  const slide = (dx: number, dy: number) => {
    let cx = piece.pos.x + dx
    let cy = piece.pos.y + dy
    let steps = 0
    while (inBoard({ x: cx, y: cy }) && steps < 20) {
      const dest = { x: cx, y: cy }
      const at = pieceAt(state, dest)
      if (at) {
        tryAdd(dest)
        break
      }
      tryAdd(dest)
      cx += dx
      cy += dy
      steps++
    }
  }

  switch (piece.type) {
    case 'king':
      for (const [dx, dy] of DIRS_8) tryAdd({ x: piece.pos.x + dx, y: piece.pos.y + dy })
      break
    case 'queen':
      for (const [dx, dy] of DIRS_8) slide(dx, dy)
      break
    case 'rook':
      for (const [dx, dy] of DIRS_ROOK) slide(dx, dy)
      break
    case 'bishop':
      for (const [dx, dy] of DIRS_BISHOP) slide(dx, dy)
      break
    case 'knight':
      for (const [dx, dy] of KNIGHT_JUMPS) tryAdd({ x: piece.pos.x + dx, y: piece.pos.y + dy })
      break
  }
  return moves
}

function getValidPasses(piece: Piece, state: BoardState): Position[] {
  const moves: Position[] = []
  const blockedKeeper = state.keeperBlockedId
    ? state.pieces.find(p => p.id === state.keeperBlockedId)
    : null

  const tryAdd = (dest: Position) => {
    if (!inBoard(dest)) return
    if (blockedKeeper && posEq(dest, blockedKeeper.pos)) return
    moves.push(dest)
  }

  const slide = (dx: number, dy: number) => {
    let cx = piece.pos.x + dx
    let cy = piece.pos.y + dy
    let steps = 0
    while (inBoard({ x: cx, y: cy }) && steps < 20) {
      tryAdd({ x: cx, y: cy })
      cx += dx
      cy += dy
      steps++
    }
  }

  switch (piece.type) {
    case 'king':
      for (const [dx, dy] of DIRS_8) tryAdd({ x: piece.pos.x + dx, y: piece.pos.y + dy })
      break
    case 'queen':
      for (const [dx, dy] of DIRS_8) slide(dx, dy)
      break
    case 'rook':
      for (const [dx, dy] of DIRS_ROOK) slide(dx, dy)
      break
    case 'bishop':
      for (const [dx, dy] of DIRS_BISHOP) slide(dx, dy)
      break
    case 'knight':
      for (const [dx, dy] of KNIGHT_JUMPS) tryAdd({ x: piece.pos.x + dx, y: piece.pos.y + dy })
      break
  }
  return moves
}

/** Pase seguro: el primer RIVAL de la trayectoria decide (rey = gol, otro = intercepción). Las piezas propias se sobrevuelan. */
function isPassSafe(from: Position, to: Position, state: BoardState, aiSide: Side): boolean {
  const holder = getHolder(state)
  if (!holder) return false

  if (holder.type === 'knight') {
    const atDest = pieceAt(state, to)
    if (atDest && atDest.side !== aiSide && atDest.type !== 'king') return false
    return true
  }

  const dx = Math.sign(to.x - from.x)
  const dy = Math.sign(to.y - from.y)
  if (dx === 0 && dy === 0) return false
  let cx = from.x + dx
  let cy = from.y + dy
  let steps = 0
  while ((cx !== to.x || cy !== to.y) && steps < 20) {
    const inPath = pieceAt(state, { x: cx, y: cy })
    if (inPath && inPath.side !== aiSide) return inPath.type === 'king'
    cx += dx
    cy += dy
    steps++
  }

  const atDest = pieceAt(state, to)
  if (atDest && atDest.side !== aiSide && atDest.type !== 'king') return false
  return true
}

// ── Simulación fiel del motor ─────────────────────────────

function applySimMove(state: BoardState, pieceId: string, to: Position): BoardState {
  const next = cloneState(state)
  const piece = next.pieces.find(p => p.id === pieceId)
  if (!piece) return next
  const from = { ...piece.pos }

  const rivalAtDest = next.pieces.find(p => posEq(p.pos, to) && p.side !== piece.side)
  if (rivalAtDest && next.ball.holderId === rivalAtDest.id) {
    // Tackle: balón para el atacante, rival desplazado (orden del motor: +x, -x, +y, -y)
    const neighbors = [
      { x: to.x + 1, y: to.y },
      { x: to.x - 1, y: to.y },
      { x: to.x, y: to.y + 1 },
      { x: to.x, y: to.y - 1 },
    ].filter(inBoard)
     .filter(n => !next.pieces.some(p => posEq(p.pos, n) && p.id !== pieceId))
    if (neighbors.length > 0) rivalAtDest.pos = neighbors[0]
    next.ball = { holderId: piece.id, pos: { ...to } }
    if (next.keeperBlockedId && !next.keeperBlockedId.startsWith(piece.side + '_')) {
      next.keeperBlockedId = undefined
    }
  } else if (next.ball.holderId === pieceId) {
    next.ball = { holderId: pieceId, pos: { ...to } } // conducción
  } else if (!next.ball.holderId) {
    const isLinear = piece.type !== 'knight'
    const captured = isLinear
      ? getPath(from, to).some(p => posEq(p, next.ball.pos))
      : posEq(to, next.ball.pos)
    if (captured) next.ball = { holderId: pieceId, pos: { ...to } }
  }

  piece.pos = { ...to }
  piece.hasMovedThisTurn = true
  return next
}

function applySimPass(state: BoardState, to: Position): { state: BoardState; goal: boolean; intercepted: boolean } {
  const next = cloneState(state)
  const holder = getHolder(next)
  if (!holder) return { state: next, goal: false, intercepted: false }

  const path = holder.type !== 'knight' ? getPath(holder.pos, to) : [to]
  const firstEnemy = path
    .map(pos => next.pieces.find(p => posEq(p.pos, pos) && p.side !== holder.side))
    .find(Boolean)

  if (firstEnemy) {
    if (firstEnemy.type === 'king') {
      next.ball = { holderId: null, pos: { ...firstEnemy.pos } }
      return { state: next, goal: true, intercepted: false }
    }
    next.ball = { holderId: firstEnemy.id, pos: { ...firstEnemy.pos } }
    if (next.keeperBlockedId && !next.keeperBlockedId.startsWith(firstEnemy.side + '_')) {
      next.keeperBlockedId = undefined
    }
    return { state: next, goal: false, intercepted: true }
  }

  const teammateAtDest = next.pieces.find(p => posEq(p.pos, to) && p.side === holder.side)
  next.ball = { pos: { ...to }, holderId: teammateAtDest ? teammateAtDest.id : null }
  if (holder.type === 'king') {
    next.keeperBlockedId = holder.id
    if (next.kingMustRelease === holder.side) next.kingMustRelease = undefined
  }
  return { state: next, goal: false, intercepted: false }
}

// ── Seguridad del balón ───────────────────────────────────

/** ¿El rival puede hacerse con el balón si queda en `to` (suelto o en un compañero)? */
function isBallDestinationSafe(to: Position, state: BoardState, aiSide: Side): boolean {
  const opp = otherSide(aiSide)
  const teammateAtDest = state.pieces.find(p => posEq(p.pos, to) && p.side === aiSide)
  const simBall = { pos: { ...to }, holderId: teammateAtDest ? teammateAtDest.id : null }
  const simState: BoardState = { ...state, ball: simBall }

  for (const piece of state.pieces) {
    if (piece.side !== opp || piece.type === 'king') continue
    const moves = getValidMoves(piece, simState)
    for (const m of moves) {
      if (posEq(m, to)) return false // tackle o captura directa
      // Balón suelto: una pieza lineal rival lo captura con solo cruzar su casilla
      if (!teammateAtDest && piece.type !== 'knight' && isOnLineBetween(piece.pos, m, to)) return false
    }
  }
  return true
}

/** ¿El portador estaría a salvo de tackle inmediato si condujera el balón hasta `dest`? */
function isHolderSafeAt(state: BoardState, holderId: string, dest: Position): boolean {
  const sim = applySimMove(state, holderId, dest)
  const opp = otherSide(sim.pieces.find(p => p.id === holderId)!.side)
  for (const piece of sim.pieces) {
    if (piece.side !== opp || piece.type === 'king') continue
    if (getValidMoves(piece, sim).some(m => posEq(m, dest))) return false
  }
  return true
}

/** ¿Mi portador actual (no-rey) es tackleable por el rival en este estado? */
function isHolderInDanger(state: BoardState, aiSide: Side): boolean {
  const holder = getHolder(state)
  if (!holder || holder.side !== aiSide || holder.type === 'king') return false
  const opp = otherSide(aiSide)
  for (const piece of state.pieces) {
    if (piece.side !== opp || piece.type === 'king') continue
    if (getValidMoves(piece, state).some(m => posEq(m, holder.pos))) return true
  }
  return false
}

// ── Detección de gol ──────────────────────────────────────

function findShotOnGoal(state: BoardState, aiSide: Side): { pieceId: string; to: Position } | null {
  const holder = getHolder(state)
  if (!holder || holder.side !== aiSide) return null
  const rivalKing = findKing(state, otherSide(aiSide))
  if (!rivalKing) return null

  const passTargets = getValidPasses(holder, state)

  for (const target of passTargets) {
    if (posEq(target, rivalKing.pos) && isPassSafe(holder.pos, target, state, aiSide)) {
      return { pieceId: holder.id, to: target }
    }
  }
  if (holder.type !== 'knight') {
    for (const target of passTargets) {
      if (isOnLineBetween(holder.pos, target, rivalKing.pos) &&
          isPassSafe(holder.pos, target, state, aiSide)) {
        return { pieceId: holder.id, to: target }
      }
    }
  }
  return null
}

// ── Defensa ───────────────────────────────────────────────

function isKingUnderDirectThreat(state: BoardState, aiSide: Side): boolean {
  const myKing = findKing(state, aiSide)
  if (!myKing) return false
  const ballHolder = getHolder(state)
  if (!ballHolder || ballHolder.side === aiSide) return false
  return isPassSafe(ballHolder.pos, myKing.pos, state, ballHolder.side)
}

/** Casillas desde las que el portador rival podría chutar a mi rey tras UN movimiento. */
function findIncomingShotSquares(state: BoardState, aiSide: Side): Position[] {
  const myKing = findKing(state, aiSide)
  const ballHolder = getHolder(state)
  if (!myKing || !ballHolder || ballHolder.side === aiSide || ballHolder.type === 'king') return []

  const threats: Position[] = []
  for (const dest of getValidMoves(ballHolder, state)) {
    const sim = applySimMove(state, ballHolder.id, dest)
    if (isPassSafe(dest, myKing.pos, sim, ballHolder.side)) threats.push(dest)
  }
  return threats
}

/** Bloquear la línea recta entre `from` y mi rey con una pieza propia sin mover. */
function findLaneBlock(state: BoardState, aiSide: Side, from: Position): { pieceId: string; to: Position } | null {
  const myKing = findKing(state, aiSide)
  if (!myKing) return null
  const dx = Math.sign(myKing.pos.x - from.x)
  const dy = Math.sign(myKing.pos.y - from.y)
  if (dx === 0 && dy === 0) return null

  const lane: Position[] = []
  let cx = from.x + dx
  let cy = from.y + dy
  let steps = 0
  while ((cx !== myKing.pos.x || cy !== myKing.pos.y) && steps < 20) {
    lane.push({ x: cx, y: cy })
    cx += dx
    cy += dy
    steps++
  }
  // Preferir bloquear cerca del rey (cubre más ángulos futuros)
  lane.reverse()

  const myPieces = state.pieces
    .filter(p => p.side === aiSide && p.type !== 'king' && !p.hasMovedThisTurn)
    .sort((a, b) => a.id.localeCompare(b.id))
  for (const square of lane) {
    if (pieceAt(state, square)) continue
    for (const piece of myPieces) {
      if (getValidMoves(piece, state).some(m => posEq(m, square))) {
        return { pieceId: piece.id, to: square }
      }
    }
  }
  return null
}

function findBestTackle(state: BoardState, aiSide: Side): { pieceId: string; to: Position } | null {
  const ballHolder = getHolder(state)
  if (!ballHolder || ballHolder.side === aiSide || ballHolder.type === 'king') return null

  const rivalKing = findKing(state, otherSide(aiSide))
  const candidates: Array<{ pieceId: string; to: Position; dist: number; id: string }> = []
  for (const piece of state.pieces) {
    if (piece.side !== aiSide || piece.type === 'king' || piece.hasMovedThisTurn) continue
    if (getValidMoves(piece, state).some(m => posEq(m, ballHolder.pos))) {
      const dist = rivalKing
        ? Math.max(Math.abs(piece.pos.x - rivalKing.pos.x), Math.abs(piece.pos.y - rivalKing.pos.y))
        : 0
      candidates.push({ pieceId: piece.id, to: ballHolder.pos, dist, id: piece.id })
    }
  }
  if (candidates.length === 0) return null
  candidates.sort((a, b) => a.dist - b.dist || a.id.localeCompare(b.id))
  return { pieceId: candidates[0].pieceId, to: candidates[0].to }
}

/** Mover el rey a una casilla del área donde el portador rival NO tenga tiro limpio. */
function findKingDodge(state: BoardState, aiSide: Side): { pieceId: string; to: Position } | null {
  const myKing = findKing(state, aiSide)
  const ballHolder = getHolder(state)
  if (!myKing || myKing.hasMovedThisTurn || !ballHolder || ballHolder.side === aiSide) return null

  const candidates = getValidMoves(myKing, state)
    .map(dest => {
      const sim = applySimMove(state, myKing.id, dest)
      const directShot = isPassSafe(ballHolder.pos, dest, sim, ballHolder.side)
      const incoming = directShot ? 99 : findIncomingShotSquares(sim, aiSide).length
      const centerDist = Math.abs(dest.x - 4)
      return { dest, directShot, incoming, centerDist }
    })
    .filter(c => !c.directShot)
    .sort((a, b) => a.incoming - b.incoming || a.centerDist - b.centerDist ||
                    a.dest.x - b.dest.x || a.dest.y - b.dest.y)

  if (candidates.length === 0) return null
  return { pieceId: myKing.id, to: candidates[0].dest }
}

// ── Balón suelto ──────────────────────────────────────────

function findLooseBallCapture(state: BoardState, aiSide: Side, allowAreaFinish: boolean): { pieceId: string; to: Position } | null {
  if (state.ball.holderId !== null) return null
  const ballPos = state.ball.pos
  const rivalKing = findKing(state, otherSide(aiSide))

  let best: { pieceId: string; to: Position; score: number; id: string } | null = null
  for (const piece of state.pieces) {
    if (piece.side !== aiSide || piece.type === 'king' || piece.hasMovedThisTurn) continue
    for (const dest of getValidMoves(piece, state)) {
      const captures = piece.type === 'knight'
        ? posEq(dest, ballPos)
        : (posEq(dest, ballPos) || isOnLineBetween(piece.pos, dest, ballPos))
      if (!captures) continue
      if (!allowAreaFinish && isInEnemyArea(dest, aiSide)) continue

      const sim = applySimMove(state, piece.id, dest)
      let score = 0
      if (findShotOnGoal(sim, aiSide)) score += 1000
      if (isHolderSafeAt(state, piece.id, dest)) score += 100
      if (rivalKing) {
        score -= Math.max(Math.abs(dest.x - rivalKing.pos.x), Math.abs(dest.y - rivalKing.pos.y))
      }
      if (!best || score > best.score || (score === best.score && piece.id.localeCompare(best.id) < 0)) {
        best = { pieceId: piece.id, to: dest, score, id: piece.id }
      }
    }
  }
  return best ? { pieceId: best.pieceId, to: best.to } : null
}

// ── Fuera de juego ────────────────────────────────────────

function endsInOffside(simState: BoardState, aiSide: Side): boolean {
  const holder = getHolder(simState)
  if (!holder || holder.side !== aiSide || holder.type === 'king') return false
  return isInEnemyArea(holder.pos, aiSide)
}

// ── Cadenas ofensivas ─────────────────────────────────────

/** Mover el portador a una casilla desde la que existe disparo seguro (requiere 2 AP). */
function findMoveThenShoot(state: BoardState, aiSide: Side): { pieceId: string; to: Position } | null {
  const holder = getHolder(state)
  if (!holder || holder.side !== aiSide || holder.type === 'king' || holder.hasMovedThisTurn) return null

  const rivalKing = findKing(state, otherSide(aiSide))
  if (!rivalKing) return null

  const moves = getValidMoves(holder, state)
    .slice()
    .sort((a, b) =>
      Math.max(Math.abs(a.x - rivalKing.pos.x), Math.abs(a.y - rivalKing.pos.y)) -
      Math.max(Math.abs(b.x - rivalKing.pos.x), Math.abs(b.y - rivalKing.pos.y)) ||
      a.x - b.x || a.y - b.y)
  for (const dest of moves) {
    const sim = applySimMove(state, holder.id, dest)
    if (findShotOnGoal(sim, aiSide)) return { pieceId: holder.id, to: dest }
  }
  return null
}

/** Pasar a un compañero que tiene disparo seguro desde su casilla (requiere 2 AP). */
function findPassToShooter(state: BoardState, aiSide: Side): { to: Position } | null {
  const holder = getHolder(state)
  if (!holder || holder.side !== aiSide) return null

  const passTargets = getValidPasses(holder, state)
  const teammates = state.pieces
    .filter(p => p.side === aiSide && p.type !== 'king' && p.id !== holder.id)
    .sort((a, b) => (a.type === 'knight' ? 0 : 1) - (b.type === 'knight' ? 0 : 1) || a.id.localeCompare(b.id))

  for (const mate of teammates) {
    if (!passTargets.some(t => posEq(t, mate.pos))) continue
    if (!isPassSafe(holder.pos, mate.pos, state, aiSide)) continue
    const result = applySimPass(state, mate.pos)
    if (result.goal || result.intercepted) continue
    if (findShotOnGoal(result.state, aiSide)) return { to: mate.pos }
  }
  return null
}

/** Pasar a un compañero sin mover que puede moverse a casilla de disparo y chutar (requiere 3 AP). */
function findPassMoveShoot(state: BoardState, aiSide: Side): { to: Position } | null {
  const holder = getHolder(state)
  if (!holder || holder.side !== aiSide) return null

  const passTargets = getValidPasses(holder, state)
  const teammates = state.pieces
    .filter(p => p.side === aiSide && p.type !== 'king' && p.id !== holder.id && !p.hasMovedThisTurn)
    .sort((a, b) => (a.type === 'knight' ? 0 : 1) - (b.type === 'knight' ? 0 : 1) || a.id.localeCompare(b.id))

  for (const mate of teammates) {
    if (!passTargets.some(t => posEq(t, mate.pos))) continue
    if (!isPassSafe(holder.pos, mate.pos, state, aiSide)) continue
    const result = applySimPass(state, mate.pos)
    if (result.goal || result.intercepted) continue
    if (findMoveThenShoot(result.state, aiSide)) return { to: mate.pos }
  }
  return null
}

// ── Avance seguro con balón ───────────────────────────────

type Advance = { kind: 'move' | 'pass'; pieceId: string; to: Position; score: number }

function findSafeAdvance(state: BoardState, aiSide: Side): Advance | null {
  const holder = getHolder(state)
  if (!holder || holder.side !== aiSide) return null
  const rivalKing = findKing(state, otherSide(aiSide))
  if (!rivalKing) return null

  const distTo = (p: Position) =>
    Math.max(Math.abs(p.x - rivalKing.pos.x), Math.abs(p.y - rivalKing.pos.y))
  const holderDist = distTo(holder.pos)
  const candidates: Advance[] = []

  // Conducción (no para el rey: su sitio es el área)
  if (holder.type !== 'king' && !holder.hasMovedThisTurn) {
    for (const dest of getValidMoves(holder, state)) {
      if (isInEnemyArea(dest, aiSide)) continue // nunca terminar dentro del área sin chutar
      if (!isHolderSafeAt(state, holder.id, dest)) continue
      const progress = holderDist - distTo(dest)
      if (progress <= 0) continue
      candidates.push({ kind: 'move', pieceId: holder.id, to: dest, score: progress * 10 })
    }
  }

  // Pase a compañero adelantado (preferir caballos) o a casilla vacía segura
  const passTargets = getValidPasses(holder, state)
  for (const target of passTargets) {
    if (isInEnemyArea(target, aiSide)) continue
    if (!isPassSafe(holder.pos, target, state, aiSide)) continue
    const mate = state.pieces.find(p => posEq(p.pos, target) && p.side === aiSide)
    if (mate && mate.type === 'king') continue // no devolverla al portero sin necesidad
    if (!isBallDestinationSafe(target, state, aiSide)) continue
    const progress = holderDist - distTo(target)
    if (mate) {
      const knightBonus = mate.type === 'knight' ? 8 : 0
      if (progress <= 0 && knightBonus === 0) continue
      candidates.push({ kind: 'pass', pieceId: holder.id, to: target, score: progress * 10 + knightBonus + 2 })
    } else {
      if (progress <= 1) continue // un balón suelto solo compensa si gana terreno claro
      candidates.push({ kind: 'pass', pieceId: holder.id, to: target, score: progress * 10 - 6 })
    }
  }

  if (candidates.length === 0) return null
  candidates.sort((a, b) => b.score - a.score ||
    a.to.x - b.to.x || a.to.y - b.to.y || (a.kind === 'move' ? -1 : 1))
  return candidates[0]
}

/** Soltar el balón del rey: pase seguro a compañero (preferido) o a casilla segura. */
function findKingRelease(state: BoardState, aiSide: Side): { to: Position } | null {
  const myKing = findKing(state, aiSide)
  if (!myKing || state.ball.holderId !== myKing.id) return null

  const targets = getValidPasses(myKing, state)
  const scored = targets
    .filter(t => isPassSafe(myKing.pos, t, state, aiSide))
    .map(t => {
      const mate = state.pieces.find(p => posEq(p.pos, t) && p.side === aiSide)
      const destSafe = isBallDestinationSafe(t, state, aiSide)
      return { t, score: (mate ? 10 : 0) + (destSafe ? 5 : 0) }
    })
    .sort((a, b) => b.score - a.score || a.t.x - b.t.x || a.t.y - b.t.y)
  if (scored.length > 0) return { to: scored[0].t }
  // Último recurso: cualquier destino válido (peor que la liberación automática no es)
  if (targets.length > 0) return { to: targets[0] }
  return null
}

// ── Reposicionamiento ─────────────────────────────────────

/** Casillas desde las que un caballo chuta al rey rival. */
function knightShotSquares(state: BoardState, aiSide: Side): Position[] {
  const rivalKing = findKing(state, otherSide(aiSide))
  if (!rivalKing) return []
  return KNIGHT_JUMPS
    .map(([dx, dy]) => ({ x: rivalKing.pos.x + dx, y: rivalKing.pos.y + dy }))
    .filter(inBoard)
}

function findRepositionMove(state: BoardState, aiSide: Side, defensive: boolean): { pieceId: string; to: Position } | null {
  const myKing = findKing(state, aiSide)
  const shotSquares = knightShotSquares(state, aiSide)
  const ballPos = state.ball.pos

  let best: { pieceId: string; to: Position; gain: number; id: string } | null = null
  const consider = (piece: Piece, dest: Position, gain: number) => {
    if (gain <= 0) return
    if (!best || gain > best.gain || (gain === best.gain && piece.id.localeCompare(best.id) < 0)) {
      best = { pieceId: piece.id, to: dest, gain, id: piece.id }
    }
  }

  for (const piece of state.pieces) {
    if (piece.side !== aiSide || piece.type === 'king' || piece.hasMovedThisTurn) continue
    if (piece.id === state.ball.holderId) continue
    const moves = getValidMoves(piece, state)
      .filter(m => !isInEnemyArea(m, aiSide)) // sin balón tampoco conviene pisar el área (no aporta)
      .sort((a, b) => a.x - b.x || a.y - b.y)

    for (const dest of moves) {
      if (defensive && myKing) {
        // Acercarse al balón (presión) y a la zona entre balón y rey propio
        const now = Math.max(Math.abs(piece.pos.x - ballPos.x), Math.abs(piece.pos.y - ballPos.y))
        const after = Math.max(Math.abs(dest.x - ballPos.x), Math.abs(dest.y - ballPos.y))
        consider(piece, dest, now - after)
      } else if (piece.type === 'knight' && shotSquares.length > 0) {
        // Caballos hacia casillas de disparo
        const dist = (p: Position) => Math.min(...shotSquares.map(s => Math.max(Math.abs(p.x - s.x), Math.abs(p.y - s.y))))
        consider(piece, dest, (dist(piece.pos) - dist(dest)) * 2)
      } else if (piece.type === 'queen') {
        // Reina hacia el centro del campo
        const center = { x: 4, y: aiSide === 'white' ? 6 : 5 }
        const dist = (p: Position) => Math.max(Math.abs(p.x - center.x), Math.abs(p.y - center.y))
        consider(piece, dest, dist(piece.pos) - dist(dest))
      }
    }
  }
  return best ? { pieceId: (best as { pieceId: string }).pieceId, to: (best as { to: Position }).to } : null
}

/**
 * Puestos defensivos fijos: ocupar la columna del rey justo fuera del área
 * (cierra todos los tiros verticales) y los flancos diagonales adyacentes.
 */
function findDefensivePostMove(state: BoardState, aiSide: Side): { pieceId: string; to: Position } | null {
  const myKing = findKing(state, aiSide)
  if (!myKing) return null
  const guardRow = aiSide === 'white' ? 2 : 9
  const posts: Position[] = [
    { x: myKing.pos.x, y: guardRow },
    { x: myKing.pos.x - 1, y: guardRow },
    { x: myKing.pos.x + 1, y: guardRow },
  ].filter(inBoard)

  for (const post of posts) {
    if (pieceAt(state, post)) continue
    const guard = state.pieces
      .filter(p => p.side === aiSide && !p.hasMovedThisTurn && p.id !== state.ball.holderId &&
                   (p.type === 'rook' || p.type === 'bishop'))
      .sort((a, b) => a.id.localeCompare(b.id))
      .find(p => getValidMoves(p, state).some(m => posEq(m, post)))
    if (guard) return { pieceId: guard.id, to: post }
  }
  return null
}

// ============================================
// Export del jugador IA
// ============================================

export const aiPlayer: AIPlayerScript = {
  name: 'Claude Fable',
  description: 'Estratega de equipo: simula cada acción antes de jugarla, triangula con los caballos para chutar sin intercepción y defiende anticipando el mover-y-chutar rival.',
  avatar: '🦊',
  difficulty: 'advanced',
  badgeName: 'Cazador de Fábulas',
  badgeIcon: 'feather',

  play: (boardState: BoardState, aiSide: Side): AIAction[] => {
    try {
      const actions: AIAction[] = []
      let sim = cloneState(boardState)
      let budget = Math.max(0, Math.min(boardState.actionPoints, 5))

      const pushMove = (pieceId: string, to: Position) => {
        actions.push({ type: 'move', pieceId, to })
        sim = applySimMove(sim, pieceId, to)
        budget--
      }
      /** Devuelve true si el pase termina el turno (gol o intercepción simulada). */
      const pushPass = (to: Position): boolean => {
        const holderId = sim.ball.holderId!
        actions.push({ type: 'pass', pieceId: holderId, to })
        const result = applySimPass(sim, to)
        sim = result.state
        budget--
        return result.goal || result.intercepted
      }

      // ── 0. El rey debe soltar el balón (o acaba de recibirlo): libéralo ya ──
      if (budget > 0) {
        const myKing = findKing(sim, aiSide)
        if (myKing && sim.ball.holderId === myKing.id) {
          // Antes de soltar, ¿hay gol directo del rey? (raro pero posible)
          const shot = findShotOnGoal(sim, aiSide)
          if (shot && pushPass(shot.to)) return actions
          if (sim.ball.holderId === myKing.id) {
            const release = findKingRelease(sim, aiSide)
            if (release && pushPass(release.to)) return actions
          }
        }
      }

      let guard = 0
      while (budget > 0 && guard++ < 16) {
        // ── 1. Gol inmediato ──
        const shot = findShotOnGoal(sim, aiSide)
        if (shot) {
          pushPass(shot.to)
          return actions
        }

        const holder = getHolder(sim)

        // ── 2. Balón suelto: carrera por la posesión ──
        if (!holder) {
          const capture = findLooseBallCapture(sim, aiSide, budget >= 2)
          if (capture) {
            pushMove(capture.pieceId, capture.to)
            continue
          }
        }

        // ── 3. Tenemos el balón: cadenas de gol y avance seguro ──
        if (holder && holder.side === aiSide) {
          if (budget >= 2) {
            const ms = findMoveThenShoot(sim, aiSide)
            if (ms) { pushMove(ms.pieceId, ms.to); continue } // el disparo sale en la siguiente vuelta
            const ps = findPassToShooter(sim, aiSide)
            if (ps) { if (pushPass(ps.to)) return actions; continue }
          }
          if (budget >= 3) {
            const pms = findPassMoveShoot(sim, aiSide)
            if (pms) { if (pushPass(pms.to)) return actions; continue }
          }

          if (holder.type === 'king') {
            // El rey no debe quedarse el balón: suéltalo aunque no haya jugada
            const release = findKingRelease(sim, aiSide)
            if (release) { if (pushPass(release.to)) return actions; continue }
          } else {
            const adv = findSafeAdvance(sim, aiSide)
            if (adv) {
              if (adv.kind === 'move') pushMove(adv.pieceId, adv.to)
              else if (pushPass(adv.to)) return actions
              continue
            }
          }

          // Balón seguro pero sin avance: que el resto del equipo se coloque
          const support = findRepositionMove(sim, aiSide, false)
          if (support) { pushMove(support.pieceId, support.to); continue }
          break
        }

        // ── 4. El rival tiene el balón: tackle > bloqueo > rey > presión ──
        if (holder && holder.side !== aiSide) {
          if (holder.type !== 'king') {
            const tackle = findBestTackle(sim, aiSide)
            if (tackle) { pushMove(tackle.pieceId, tackle.to); continue }
          }

          if (isKingUnderDirectThreat(sim, aiSide)) {
            if (holder.type !== 'knight') {
              const block = findLaneBlock(sim, aiSide, holder.pos)
              if (block) { pushMove(block.pieceId, block.to); continue }
            }
            const dodge = findKingDodge(sim, aiSide)
            if (dodge) { pushMove(dodge.pieceId, dodge.to); continue }
          } else {
            // Anticipar el mover+chutar: negar la casilla de tiro o cerrar su carril
            const threats = findIncomingShotSquares(sim, aiSide)
            if (threats.length > 0) {
              const myKing = findKing(sim, aiSide)
              const sorted = threats.slice().sort((a, b) => {
                const da = myKing ? Math.max(Math.abs(a.x - myKing.pos.x), Math.abs(a.y - myKing.pos.y)) : 0
                const db = myKing ? Math.max(Math.abs(b.x - myKing.pos.x), Math.abs(b.y - myKing.pos.y)) : 0
                return da - db || a.x - b.x || a.y - b.y
              })
              let acted = false
              for (const threat of sorted) {
                // Ocupar la casilla de tiro la inutiliza (el portador ya no puede aterrizar ahí)
                const occupier = sim.pieces
                  .filter(p => p.side === aiSide && p.type !== 'king' && !p.hasMovedThisTurn)
                  .sort((a, b) => a.id.localeCompare(b.id))
                  .find(p => getValidMoves(p, sim).some(m => posEq(m, threat)))
                if (occupier) { pushMove(occupier.id, threat); acted = true; break }
                const block = findLaneBlock(sim, aiSide, threat)
                if (block) { pushMove(block.pieceId, block.to); acted = true; break }
              }
              if (acted) continue
              const dodge = findKingDodge(sim, aiSide)
              if (dodge) { pushMove(dodge.pieceId, dodge.to); continue }
            }
          }

          const post = findDefensivePostMove(sim, aiSide)
          if (post) { pushMove(post.pieceId, post.to); continue }
          const press = findRepositionMove(sim, aiSide, true)
          if (press) { pushMove(press.pieceId, press.to); continue }
        }

        // ── 5. Nada urgente: guarnecer al rey y mejorar la estructura ──
        const post = findDefensivePostMove(sim, aiSide)
        if (post) { pushMove(post.pieceId, post.to); continue }
        const repo = findRepositionMove(sim, aiSide, false)
        if (repo) { pushMove(repo.pieceId, repo.to); continue }
        break
      }

      // ── 6. Guarda de fuera de juego sobre el estado final simulado ──
      if (endsInOffside(sim, aiSide)) {
        const holder = getHolder(sim)!
        const escape = getValidPasses(holder, sim)
          .filter(t => !isInEnemyArea(t, aiSide))
          .filter(t => isPassSafe(holder.pos, t, sim, aiSide))
          .map(t => ({ t, safe: isBallDestinationSafe(t, sim, aiSide) ? 1 : 0 }))
          .sort((a, b) => b.safe - a.safe || a.t.x - b.t.x || a.t.y - b.t.y)
        if (escape.length > 0 && budget > 0) {
          pushPass(escape[0].t)
        } else if (!holder.hasMovedThisTurn && budget > 0) {
          const out = getValidMoves(holder, sim)
            .filter(m => !isInEnemyArea(m, aiSide))
            .sort((a, b) => a.x - b.x || a.y - b.y)
          if (out.length > 0) pushMove(holder.id, out[0])
        }
      }

      // ── 7. Guarda anti-tackle: no terminar el turno con el portador expuesto ──
      // Los movimientos posteriores del plan pueden haber abierto líneas rivales
      // hacia el portador, así que se re-verifica sobre el ESTADO FINAL simulado.
      if (budget > 0 && isHolderInDanger(sim, aiSide)) {
        const holder = getHolder(sim)!
        const escapes = getValidPasses(holder, sim)
          .filter(t => !isInEnemyArea(t, aiSide))
          .filter(t => isPassSafe(holder.pos, t, sim, aiSide))
          .filter(t => {
            const mate = sim.pieces.find(p => posEq(p.pos, t) && p.side === aiSide)
            if (mate && mate.type === 'king') return false
            return isBallDestinationSafe(t, sim, aiSide)
          })
          .map(t => ({ t, mate: sim.pieces.some(p => posEq(p.pos, t) && p.side === aiSide) ? 1 : 0 }))
          .sort((a, b) => b.mate - a.mate || a.t.x - b.t.x || a.t.y - b.t.y)
        if (escapes.length > 0) {
          pushPass(escapes[0].t)
        } else if (!holder.hasMovedThisTurn && holder.type !== 'king') {
          const safeMove = getValidMoves(holder, sim)
            .filter(m => !isInEnemyArea(m, aiSide))
            .filter(m => isHolderSafeAt(sim, holder.id, m))
            .sort((a, b) => a.x - b.x || a.y - b.y)
          if (safeMove.length > 0) pushMove(holder.id, safeMove[0])
        }
      }

      if (actions.length === 0) actions.push({ type: 'end_turn' })
      return actions
    } catch {
      return [{ type: 'end_turn' }]
    }
  },
}
