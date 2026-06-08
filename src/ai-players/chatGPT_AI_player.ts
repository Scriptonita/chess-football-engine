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
// Constantes y helpers base
// ============================================

const BOARD_W = 9
const BOARD_H = 12

function isInsideBoard(pos: Position): boolean {
  return pos.x >= 0 && pos.x < BOARD_W && pos.y >= 0 && pos.y < BOARD_H
}

function samePos(a: Position, b: Position): boolean {
  return a.x === b.x && a.y === b.y
}

function opponentOf(side: Side): Side {
  return side === 'white' ? 'black' : 'white'
}

function getOwnArea(side: Side) {
  if (side === 'white') return { xMin: 2, xMax: 6, yMin: 0, yMax: 1 }
  return { xMin: 2, xMax: 6, yMin: 10, yMax: 11 }
}

function isInOwnArea(pos: Position, side: Side): boolean {
  const a = getOwnArea(side)
  return pos.x >= a.xMin && pos.x <= a.xMax && pos.y >= a.yMin && pos.y <= a.yMax
}

function getPieceAt(boardState: BoardState, pos: Position): Piece | undefined {
  return boardState.pieces.find(p => p.pos.x === pos.x && p.pos.y === pos.y)
}

function getPieceById(boardState: BoardState, id: string | null | undefined): Piece | undefined {
  if (!id) return undefined
  return boardState.pieces.find(p => p.id === id)
}

function getMyKing(boardState: BoardState, side: Side): Piece | undefined {
  return boardState.pieces.find(p => p.side === side && p.type === 'king')
}

function getRivalKing(boardState: BoardState, side: Side): Piece | undefined {
  return boardState.pieces.find(p => p.side !== side && p.type === 'king')
}

function isSquareOccupiedByOwn(boardState: BoardState, pos: Position, side: Side): boolean {
  const p = getPieceAt(boardState, pos)
  return !!p && p.side === side
}

function isSquareOccupiedByRival(boardState: BoardState, pos: Position, side: Side): boolean {
  const p = getPieceAt(boardState, pos)
  return !!p && p.side !== side
}

function isRivalKingSquare(boardState: BoardState, pos: Position, aiSide: Side): boolean {
  const king = getRivalKing(boardState, aiSide)
  if (!king) return false
  return samePos(king.pos, pos)
}

// ============================================
// Movimiento y pases válidos
// ============================================

function getLinearMoves(
  piece: Piece,
  boardState: BoardState,
  directions: Array<{ dx: number; dy: number }>,
  maxSteps: number
): Position[] {
  const res: Position[] = []
  const rivalKing = boardState.pieces.find(p => p.type === 'king' && p.side !== piece.side)

  for (const dir of directions) {
    let cx = piece.pos.x + dir.dx
    let cy = piece.pos.y + dir.dy
    let steps = 0

    while (steps < maxSteps) {
      const next = { x: cx, y: cy }
      if (!isInsideBoard(next)) break

      // Restricciones de área
      if (piece.type === 'king') {
        if (!isInOwnArea(next, piece.side)) break
      } else {
        if (isInOwnArea(next, piece.side)) {
          cx += dir.dx
          cy += dir.dy
          steps++
          continue
        }
      }

      // No se puede mover al rey rival
      if (rivalKing && samePos(next, rivalKing.pos)) {
        break
      }

      const at = getPieceAt(boardState, next)
      if (!at) {
        res.push(next)
      } else {
        if (at.side === piece.side) {
          break
        }
        // Rival: solo si tiene el balón y no es el rey (tackle)
        if (boardState.ball.holderId === at.id && at.type !== 'king') {
          res.push(next)
        }
        break
      }

      cx += dir.dx
      cy += dir.dy
      steps++
    }
  }

  return res
}

function getValidMoves(piece: Piece, boardState: BoardState): Position[] {
  if (piece.hasMovedThisTurn) return []

  const rookDirs = [
    { dx: 1, dy: 0 },
    { dx: -1, dy: 0 },
    { dx: 0, dy: 1 },
    { dx: 0, dy: -1 }
  ]
  const bishopDirs = [
    { dx: 1, dy: 1 },
    { dx: -1, dy: 1 },
    { dx: 1, dy: -1 },
    { dx: -1, dy: -1 }
  ]
  const queenDirs = [...rookDirs, ...bishopDirs]

  if (piece.type === 'king') {
    return getLinearMoves(piece, boardState, queenDirs, 1)
  }

  if (piece.type === 'rook') {
    return getLinearMoves(piece, boardState, rookDirs, 30)
  }

  if (piece.type === 'bishop') {
    return getLinearMoves(piece, boardState, bishopDirs, 30)
  }

  if (piece.type === 'queen') {
    return getLinearMoves(piece, boardState, queenDirs, 30)
  }

  // Knight
  const deltas = [
    { dx: 2, dy: 1 },
    { dx: 2, dy: -1 },
    { dx: -2, dy: 1 },
    { dx: -2, dy: -1 },
    { dx: 1, dy: 2 },
    { dx: 1, dy: -2 },
    { dx: -1, dy: 2 },
    { dx: -1, dy: -2 }
  ]

  const res: Position[] = []
  const rivalKing = boardState.pieces.find(p => p.type === 'king' && p.side !== piece.side)

  for (const d of deltas) {
    const to = { x: piece.pos.x + d.dx, y: piece.pos.y + d.dy }
    if (!isInsideBoard(to)) continue

    // Caballo no puede entrar en su propia área
    if (isInOwnArea(to, piece.side)) continue

    if (rivalKing && samePos(to, rivalKing.pos)) continue

    const at = getPieceAt(boardState, to)
    if (!at) {
      res.push(to)
      continue
    }

    if (at.side === piece.side) continue

    // Tackle si tiene balón y no es rey
    if (boardState.ball.holderId === at.id && at.type !== 'king') {
      res.push(to)
    }
  }

  return res
}

function getValidPasses(piece: Piece, boardState: BoardState): Position[] {
  // El motor validará igualmente, pero generamos opciones razonables.
  const res: Position[] = []

  if (piece.type === 'knight') {
    const deltas = [
      { dx: 2, dy: 1 },
      { dx: 2, dy: -1 },
      { dx: -2, dy: 1 },
      { dx: -2, dy: -1 },
      { dx: 1, dy: 2 },
      { dx: 1, dy: -2 },
      { dx: -1, dy: 2 },
      { dx: -1, dy: -2 }
    ]
    for (const d of deltas) {
      const to = { x: piece.pos.x + d.dx, y: piece.pos.y + d.dy }
      if (!isInsideBoard(to)) continue
      res.push(to)
    }
    return res
  }

  const rookDirs = [
    { dx: 1, dy: 0 },
    { dx: -1, dy: 0 },
    { dx: 0, dy: 1 },
    { dx: 0, dy: -1 }
  ]
  const bishopDirs = [
    { dx: 1, dy: 1 },
    { dx: -1, dy: 1 },
    { dx: 1, dy: -1 },
    { dx: -1, dy: -1 }
  ]

  let dirs: Array<{ dx: number; dy: number }> = []
  if (piece.type === 'rook') dirs = rookDirs
  if (piece.type === 'bishop') dirs = bishopDirs
  if (piece.type === 'queen') dirs = [...rookDirs, ...bishopDirs]
  if (piece.type === 'king') dirs = [...rookDirs, ...bishopDirs]

  for (const dir of dirs) {
    for (let step = 1; step <= 30; step++) {
      const to = { x: piece.pos.x + dir.dx * step, y: piece.pos.y + dir.dy * step }
      if (!isInsideBoard(to)) break
      res.push(to)
    }
  }

  return res
}

// ============================================
// Seguridad de pases y destinos
// ============================================

function isOnLineBetween(from: Position, to: Position, mid: Position): boolean {
  const dx1 = to.x - from.x
  const dy1 = to.y - from.y
  const dx2 = mid.x - from.x
  const dy2 = mid.y - from.y

  // colineal
  if (dx1 * dy2 !== dy1 * dx2) return false

  const minX = Math.min(from.x, to.x)
  const maxX = Math.max(from.x, to.x)
  const minY = Math.min(from.y, to.y)
  const maxY = Math.max(from.y, to.y)

  return mid.x >= minX && mid.x <= maxX && mid.y >= minY && mid.y <= maxY
}

function isPassSafe(from: Position, to: Position, boardState: BoardState, aiSide: Side): boolean {
  const holder = getPieceById(boardState, boardState.ball.holderId)
  if (!holder) return false
  if (holder.side !== aiSide) return false

  // Pase de caballo: no hay intercepción, solo importa destino
  if (holder.type === 'knight') {
    const atDest = getPieceAt(boardState, to)
    if (atDest && atDest.side !== aiSide && atDest.type !== 'king') return false
    return true
  }

  const dx = Math.sign(to.x - from.x)
  const dy = Math.sign(to.y - from.y)

  // Si no es una dirección válida (ej: dx=0 dy=0), inválido
  if (dx === 0 && dy === 0) return false

  // Debe ser línea recta o diagonal
  const absDx = Math.abs(to.x - from.x)
  const absDy = Math.abs(to.y - from.y)
  const isStraight = absDx === 0 || absDy === 0
  const isDiag = absDx === absDy
  if (!isStraight && !isDiag) return false

  let cx = from.x + dx
  let cy = from.y + dy
  let guard = 0

  while ((cx !== to.x || cy !== to.y) && guard < 200) {
    const pieceInPath = getPieceAt(boardState, { x: cx, y: cy })
    if (pieceInPath) {
      if (pieceInPath.side !== aiSide) {
        return pieceInPath.type === 'king'
      }
      return false
    }
    cx += dx
    cy += dy
    guard++
  }

  const atDest = getPieceAt(boardState, to)
  if (atDest && atDest.side !== aiSide && atDest.type !== 'king') return false

  return true
}

function isBallDestinationSafe(to: Position, boardState: BoardState, aiSide: Side): boolean {
  const opponentSide = opponentOf(aiSide)

  const teammateAtDest = boardState.pieces.find(
    p => p.side === aiSide && p.pos.x === to.x && p.pos.y === to.y
  )

  const simulatedBall = { pos: { ...to }, holderId: teammateAtDest ? teammateAtDest.id : null }
  const simulatedState: BoardState = { ...boardState, ball: simulatedBall }

  const opponentPieces = boardState.pieces.filter(p => p.side === opponentSide && p.type !== 'king')
  for (const opp of opponentPieces) {
    // si el rival puede moverse a "to", es peligroso (podría capturar/tacklear)
    const moves = getValidMoves(opp, simulatedState)
    if (moves.some(m => m.x === to.x && m.y === to.y)) {
      return false
    }
  }

  return true
}

// ============================================
// Detección de gol
// ============================================

function findShotOnGoal(
  boardState: BoardState,
  aiSide: Side
): { pieceId: string; to: Position } | null {
  const holder = getPieceById(boardState, boardState.ball.holderId)
  if (!holder || holder.side !== aiSide) return null

  const rivalKing = getRivalKing(boardState, aiSide)
  if (!rivalKing) return null

  const targets = getValidPasses(holder, boardState)

  for (const t of targets) {
    // destino exacto
    if (samePos(t, rivalKing.pos)) {
      if (isPassSafe(holder.pos, t, boardState, aiSide)) {
        return { pieceId: holder.id, to: t }
      }
    }

    // "tirar más allá" (solo lineales)
    if (holder.type !== 'knight' && isOnLineBetween(holder.pos, t, rivalKing.pos)) {
      if (isPassSafe(holder.pos, t, boardState, aiSide)) {
        return { pieceId: holder.id, to: t }
      }
    }
  }

  return null
}

// ============================================
// Defensa: amenaza directa al rey
// ============================================

function isKingUnderDirectThreat(boardState: BoardState, aiSide: Side): boolean {
  const myKing = getMyKing(boardState, aiSide)
  if (!myKing) return false

  const ballHolder = getPieceById(boardState, boardState.ball.holderId)
  if (!ballHolder) return false
  if (ballHolder.side === aiSide) return false

  return isPassSafe(ballHolder.pos, myKing.pos, boardState, ballHolder.side)
}

function findDefensiveBlock(
  boardState: BoardState,
  aiSide: Side
): { pieceId: string; to: Position } | null {
  if (!isKingUnderDirectThreat(boardState, aiSide)) return null

  const myKing = getMyKing(boardState, aiSide)
  const ballHolder = getPieceById(boardState, boardState.ball.holderId)
  if (!myKing || !ballHolder) return null

  // si es caballo, no se puede bloquear
  if (ballHolder.type === 'knight') return null

  const dx = Math.sign(myKing.pos.x - ballHolder.pos.x)
  const dy = Math.sign(myKing.pos.y - ballHolder.pos.y)

  // si no es línea recta/diagonal, no es bloqueable (pero entonces isPassSafe sería false normalmente)
  const absDx = Math.abs(myKing.pos.x - ballHolder.pos.x)
  const absDy = Math.abs(myKing.pos.y - ballHolder.pos.y)
  const isStraight = absDx === 0 || absDy === 0
  const isDiag = absDx === absDy
  if (!isStraight && !isDiag) return null

  const path: Position[] = []
  let cx = ballHolder.pos.x + dx
  let cy = ballHolder.pos.y + dy
  let guard = 0

  while ((cx !== myKing.pos.x || cy !== myKing.pos.y) && guard < 50) {
    path.push({ x: cx, y: cy })
    cx += dx
    cy += dy
    guard++
  }

  const myPieces = boardState.pieces.filter(
    p => p.side === aiSide && p.type !== 'king' && !p.hasMovedThisTurn
  )

  for (const square of path) {
    for (const mp of myPieces) {
      const moves = getValidMoves(mp, boardState)
      if (moves.some(m => samePos(m, square))) {
        return { pieceId: mp.id, to: square }
      }
    }
  }

  return null
}

function findKingEvasionMove(boardState: BoardState, aiSide: Side): { pieceId: string; to: Position } | null {
  const myKing = getMyKing(boardState, aiSide)
  if (!myKing) return null
  if (myKing.hasMovedThisTurn) return null

  const moves = getValidMoves(myKing, boardState)
  if (moves.length === 0) return null

  // Preferir centro del área
  const center = aiSide === 'white' ? { x: 4, y: 1 } : { x: 4, y: 10 }
  moves.sort((a, b) => {
    const da = Math.abs(a.x - center.x) + Math.abs(a.y - center.y)
    const db = Math.abs(b.x - center.x) + Math.abs(b.y - center.y)
    return da - db
  })

  return { pieceId: myKing.id, to: moves[0] }
}

// ============================================
// Tackle prioritario
// ============================================

function findBestTackle(boardState: BoardState, aiSide: Side): { pieceId: string; to: Position } | null {
  const holder = getPieceById(boardState, boardState.ball.holderId)
  if (!holder) return null
  if (holder.side === aiSide) return null
  if (holder.type === 'king') return null

  const opponentKingY = aiSide === 'white' ? 10 : 1

  const myPieces = boardState.pieces.filter(
    p => p.side === aiSide && p.type !== 'king' && !p.hasMovedThisTurn
  )

  const candidates: Array<{ pieceId: string; to: Position; dist: number }> = []

  for (const mp of myPieces) {
    const moves = getValidMoves(mp, boardState)
    if (moves.some(m => samePos(m, holder.pos))) {
      const dist = Math.abs(mp.pos.y - opponentKingY)
      candidates.push({ pieceId: mp.id, to: holder.pos, dist })
    }
  }

  if (candidates.length === 0) return null
  candidates.sort((a, b) => a.dist - b.dist)
  return { pieceId: candidates[0].pieceId, to: candidates[0].to }
}

// ============================================
// Ataque: avanzar con balón y posicionar caballos
// ============================================

function findBestBallCarryMove(boardState: BoardState, aiSide: Side): { pieceId: string; to: Position } | null {
  const holder = getPieceById(boardState, boardState.ball.holderId)
  if (!holder || holder.side !== aiSide) return null
  if (holder.hasMovedThisTurn) return null

  const moves = getValidMoves(holder, boardState)
  if (moves.length === 0) return null

  const rivalKing = getRivalKing(boardState, aiSide)
  if (!rivalKing) return null

  // Evitar conducir a una casilla donde nos tacklean instantáneo
  const safeHolder = holder
  function isCarrySquareSafe(to: Position): boolean {
    const opponentSide = opponentOf(aiSide)
    const simulatedHolder: Piece = { ...safeHolder, pos: { ...to } }

    const simulatedPieces = boardState.pieces.map(p => (p.id === safeHolder.id ? simulatedHolder : p))
    const simulatedState: BoardState = {
      ...boardState,
      pieces: simulatedPieces,
      ball: { pos: { ...to }, holderId: safeHolder.id }
    }

    const opponentPieces = simulatedState.pieces.filter(p => p.side === opponentSide && p.type !== 'king')
    for (const opp of opponentPieces) {
      const oppMoves = getValidMoves(opp, simulatedState)
      if (oppMoves.some(m => samePos(m, to))) return false
    }
    return true
  }

  const dir = aiSide === 'white' ? 1 : -1

  moves.sort((a, b) => {
    // Preferir avanzar en Y hacia portería
    const advA = dir * (a.y - holder.pos.y)
    const advB = dir * (b.y - holder.pos.y)
    if (advA !== advB) return advB - advA

    // Luego acercarse al rey rival
    const da = Math.abs(a.x - rivalKing.pos.x) + Math.abs(a.y - rivalKing.pos.y)
    const db = Math.abs(b.x - rivalKing.pos.x) + Math.abs(b.y - rivalKing.pos.y)
    return da - db
  })

  for (const m of moves) {
    if (isCarrySquareSafe(m)) {
      return { pieceId: holder.id, to: m }
    }
  }

  return { pieceId: holder.id, to: moves[0] }
}

function findPassToAdvancedKnight(boardState: BoardState, aiSide: Side): { pieceId: string; to: Position } | null {
  const holder = getPieceById(boardState, boardState.ball.holderId)
  if (!holder || holder.side !== aiSide) return null

  const myKnights = boardState.pieces.filter(p => p.side === aiSide && p.type === 'knight')
  if (myKnights.length === 0) return null

  const passes = getValidPasses(holder, boardState)

  // candidatos: pasar a casilla de un caballo propio
  const candidates: Position[] = []
  for (const k of myKnights) {
    if (passes.some(p => samePos(p, k.pos))) {
      candidates.push(k.pos)
    }
  }

  if (candidates.length === 0) return null

  const dir = aiSide === 'white' ? 1 : -1

  candidates.sort((a, b) => {
    // preferir caballo más avanzado
    const ya = dir * a.y
    const yb = dir * b.y
    if (ya !== yb) return yb - ya
    return Math.abs(a.x - 4) - Math.abs(b.x - 4)
  })

  for (const to of candidates) {
    if (!isPassSafe(holder.pos, to, boardState, aiSide)) continue
    // si cae en caballo, suele ser buen destino (no hace falta check extra)
    return { pieceId: holder.id, to }
  }

  return null
}

function findSafeProgressPass(boardState: BoardState, aiSide: Side): { pieceId: string; to: Position } | null {
  const holder = getPieceById(boardState, boardState.ball.holderId)
  if (!holder || holder.side !== aiSide) return null

  const passes = getValidPasses(holder, boardState)
  if (passes.length === 0) return null

  const rivalKing = getRivalKing(boardState, aiSide)
  if (!rivalKing) return null

  const dir = aiSide === 'white' ? 1 : -1

  const safeHolder = holder
  const safeRivalKing = rivalKing
  // preferimos destinos donde hay compañero (posesión inmediata)
  const withTeammate: Position[] = []
  const empty: Position[] = []

  for (const p of passes) {
    const at = getPieceAt(boardState, p)
    if (at && at.side === aiSide) withTeammate.push(p)
    else empty.push(p)
  }

  function sortByAttackValue(arr: Position[]) {
    arr.sort((a, b) => {
      const advA = dir * (a.y - safeHolder.pos.y)
      const advB = dir * (b.y - safeHolder.pos.y)
      if (advA !== advB) return advB - advA

      const da = Math.abs(a.x - safeRivalKing.pos.x) + Math.abs(a.y - safeRivalKing.pos.y)
      const db = Math.abs(b.x - safeRivalKing.pos.x) + Math.abs(b.y - safeRivalKing.pos.y)
      return da - db
    })
  }

  sortByAttackValue(withTeammate)
  sortByAttackValue(empty)

  for (const to of withTeammate) {
    if (!isPassSafe(holder.pos, to, boardState, aiSide)) continue
    return { pieceId: holder.id, to }
  }

  for (const to of empty) {
    if (!isPassSafe(holder.pos, to, boardState, aiSide)) continue
    if (!isBallDestinationSafe(to, boardState, aiSide)) continue
    return { pieceId: holder.id, to }
  }

  return null
}

// ============================================
// Sin balón: acercarse a la pelota / presionar
// ============================================

function findBestMoveTowardBall(boardState: BoardState, aiSide: Side): { pieceId: string; to: Position } | null {
  const ballPos = boardState.ball.pos
  const myPieces = boardState.pieces.filter(p => p.side === aiSide && p.type !== 'king' && !p.hasMovedThisTurn)

  const candidates: Array<{ pieceId: string; to: Position; score: number }> = []

  for (const mp of myPieces) {
    const moves = getValidMoves(mp, boardState)
    for (const m of moves) {
      const distNow = Math.abs(mp.pos.x - ballPos.x) + Math.abs(mp.pos.y - ballPos.y)
      const distNext = Math.abs(m.x - ballPos.x) + Math.abs(m.y - ballPos.y)

      // preferimos reducir distancia
      const gain = distNow - distNext

      // preferimos avanzar hacia el ataque ligeramente
      const dir = aiSide === 'white' ? 1 : -1
      const adv = dir * (m.y - mp.pos.y)

      // ligera preferencia por caballos (amenaza futura de gol)
      const typeBonus = mp.type === 'knight' ? 0.5 : mp.type === 'queen' ? 0.3 : 0.1

      const score = gain * 2 + adv * 0.2 + typeBonus

      candidates.push({ pieceId: mp.id, to: m, score })
    }
  }

  if (candidates.length === 0) return null
  candidates.sort((a, b) => b.score - a.score)
  return { pieceId: candidates[0].pieceId, to: candidates[0].to }
}

// ============================================
// KingMustRelease: pase urgente del rey
// ============================================

function findKingReleasePass(boardState: BoardState, aiSide: Side): { pieceId: string; to: Position } | null {
  const myKing = getMyKing(boardState, aiSide)
  if (!myKing) return null
  if (boardState.ball.holderId !== myKing.id) return null

  const passes = getValidPasses(myKing, boardState)

  // preferir pasar a un compañero fuera del área (si existe)
  const teammateTargets = passes.filter(p => {
    const at = getPieceAt(boardState, p)
    return at && at.side === aiSide
  })

  // ordenar por "seguridad" (evitar que el rival llegue)
  const ordered = [...teammateTargets, ...passes]

  for (const to of ordered) {
    // backpass rule lo gestionará el motor con getValidPasses real, aquí solo evitamos locuras
    if (!isPassSafe(myKing.pos, to, boardState, aiSide)) continue

    const at = getPieceAt(boardState, to)
    if (!at) {
      if (!isBallDestinationSafe(to, boardState, aiSide)) continue
    }

    return { pieceId: myKing.id, to }
  }

  return null
}

// ============================================
// Utilidad: evitar duplicar move con misma pieza
// ============================================

function alreadyMovedInPlannedActions(actions: AIAction[], pieceId: string): boolean {
  return actions.some(a => a.type === 'move' && a.pieceId === pieceId)
}

// ============================================
// Export del jugador IA
// ============================================

export const aiPlayer: AIPlayerScript = {
  name: 'Táctico Neural',
  description:
    'IA táctica que prioriza goles seguros, tackles inmediatos y pases sin intercepción. Usa caballos como delanteros y protege al rey bloqueando líneas de tiro.',
  avatar: '🎯',
  difficulty: 'advanced',
  badgeName: 'Cazador del Cerebro',
  badgeIcon: 'target',
  play: (boardState: BoardState, aiSide: Side): AIAction[] => {
    try {
      const actions: AIAction[] = []

      if (boardState.turn !== aiSide) {
        return [{ type: 'end_turn' }]
      }

      const myKing = getMyKing(boardState, aiSide)
      const rivalKing = getRivalKing(boardState, aiSide)

      if (!myKing || !rivalKing) {
        return [{ type: 'end_turn' }]
      }

      // =====================================================
      // 0) Si kingMustRelease, liberar YA (máxima prioridad)
      // =====================================================
      if (boardState.kingMustRelease === aiSide) {
        const release = findKingReleasePass(boardState, aiSide)
        if (release) {
          actions.push({ type: 'pass', pieceId: release.pieceId, to: release.to })
        }
      }

      // =====================================================
      // 1) Si tenemos balón: buscar gol inmediato
      // =====================================================
      const shotNow = findShotOnGoal(boardState, aiSide)
      if (shotNow) {
        // no duplicar pass si ya hicimos release del rey
        const alreadyHasPass = actions.some(a => a.type === 'pass')
        if (!alreadyHasPass) {
          actions.push({ type: 'pass', pieceId: shotNow.pieceId, to: shotNow.to })
        }
        if (actions.length === 0) actions.push({ type: 'end_turn' })
        return actions.slice(0, 5)
      }

      // =====================================================
      // 2) Defensa si el rival tiene amenaza directa de gol
      // =====================================================
      const underThreat = isKingUnderDirectThreat(boardState, aiSide)
      if (underThreat) {
        // 2a) Tackle si es posible
        const tackle = findBestTackle(boardState, aiSide)
        if (tackle && !alreadyMovedInPlannedActions(actions, tackle.pieceId)) {
          actions.push({ type: 'move', pieceId: tackle.pieceId, to: tackle.to })

          // tras tackle, si el motor nos da posesión, intentamos "tiro ideal"
          // (no podemos simular desplazamiento exacto del rival, pero esto suele funcionar bien)
          // Intento rápido: si el rival-holder está en tackle.to, asumimos que ahora tenemos balón ahí.
          // No mutamos state, simplemente intentamos pass si la pieza que se movió era potencial holder.
          // El motor validará si realmente sostiene el balón.
          const movedPiece = getPieceById(boardState, tackle.pieceId)
          if (movedPiece) {
            const tryShotAfter = findShotOnGoal(
              {
                ...boardState,
                ball: { pos: { ...tackle.to }, holderId: tackle.pieceId }
              },
              aiSide
            )
            if (tryShotAfter && actions.length < 5) {
              if (isPassSafe(tackle.to, tryShotAfter.to, { ...boardState, ball: { pos: tackle.to, holderId: tackle.pieceId } }, aiSide)) {
                actions.push({ type: 'pass', pieceId: tackle.pieceId, to: tryShotAfter.to })
              }
            }
          }

          // rellenar con reposicionamiento si quedan AP
          while (actions.length < 5) {
            const extra = findBestMoveTowardBall(boardState, aiSide)
            if (!extra) break
            if (alreadyMovedInPlannedActions(actions, extra.pieceId)) break
            actions.push({ type: 'move', pieceId: extra.pieceId, to: extra.to })
          }

          return actions.slice(0, 5)
        }

        // 2b) Bloquear línea si no hay tackle
        const block = findDefensiveBlock(boardState, aiSide)
        if (block && !alreadyMovedInPlannedActions(actions, block.pieceId)) {
          actions.push({ type: 'move', pieceId: block.pieceId, to: block.to })
        } else {
          // 2c) Si no se puede bloquear (caballo), mover rey dentro del área
          const evasion = findKingEvasionMove(boardState, aiSide)
          if (evasion && !alreadyMovedInPlannedActions(actions, evasion.pieceId)) {
            actions.push({ type: 'move', pieceId: evasion.pieceId, to: evasion.to })
          }
        }
      }

      // =====================================================
      // 3) Si el rival tiene el balón: buscar tackle aunque no haya amenaza directa
      // =====================================================
      const holder = getPieceById(boardState, boardState.ball.holderId)
      const weHaveBall = holder && holder.side === aiSide

      if (!weHaveBall) {
        const tackle = findBestTackle(boardState, aiSide)
        if (tackle && !alreadyMovedInPlannedActions(actions, tackle.pieceId) && actions.length < 5) {
          actions.push({ type: 'move', pieceId: tackle.pieceId, to: tackle.to })
        }
      }

      // =====================================================
      // 4) Si tenemos balón: avanzar + pasar a caballo
      // =====================================================
      if (weHaveBall) {
        // 4a) conducir hacia delante si es posible
        const carry = findBestBallCarryMove(boardState, aiSide)
        if (carry && actions.length < 5 && !alreadyMovedInPlannedActions(actions, carry.pieceId)) {
          actions.push({ type: 'move', pieceId: carry.pieceId, to: carry.to })
        }

        // 4b) intentar pasar a un caballo adelantado
        if (actions.length < 5) {
          const passToKnight = findPassToAdvancedKnight(boardState, aiSide)
          if (passToKnight && actions.length < 5) {
            // evitar doble pass si ya hemos pasado por kingMustRelease
            const alreadyHasPass = actions.some(a => a.type === 'pass')
            if (!alreadyHasPass) {
              actions.push({ type: 'pass', pieceId: passToKnight.pieceId, to: passToKnight.to })
            }
          }
        }

        // 4c) si no hay pase a caballo, pase de progreso seguro
        if (actions.length < 5 && !actions.some(a => a.type === 'pass')) {
          const prog = findSafeProgressPass(boardState, aiSide)
          if (prog) {
            actions.push({ type: 'pass', pieceId: prog.pieceId, to: prog.to })
          }
        }

        // 4d) tras posible pase, intentar gol directo (por si se abrió línea)
        if (actions.length < 5) {
          const shot = findShotOnGoal(boardState, aiSide)
          if (shot && !actions.some(a => a.type === 'pass')) {
            actions.push({ type: 'pass', pieceId: shot.pieceId, to: shot.to })
          }
        }
      }

      // =====================================================
      // 5) Si no tenemos balón: acercarnos a la pelota
      // =====================================================
      while (actions.length < 5) {
        const mv = findBestMoveTowardBall(boardState, aiSide)
        if (!mv) break
        if (alreadyMovedInPlannedActions(actions, mv.pieceId)) break
        actions.push({ type: 'move', pieceId: mv.pieceId, to: mv.to })
      }

      if (actions.length === 0) actions.push({ type: 'end_turn' })
      return actions.slice(0, 5)
    } catch {
      return [{ type: 'end_turn' }]
    }
  }
}