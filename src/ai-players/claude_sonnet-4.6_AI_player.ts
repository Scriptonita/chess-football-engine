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

function isInBoard(pos: Position): boolean {
  return pos.x >= 0 && pos.x <= 8 && pos.y >= 0 && pos.y <= 11
}

function isInOwnArea(pos: Position, side: Side): boolean {
  if (side === 'white') return pos.x >= 2 && pos.x <= 6 && pos.y >= 0 && pos.y <= 1
  return pos.x >= 2 && pos.x <= 6 && pos.y >= 10 && pos.y <= 11
}

function posEq(a: Position, b: Position): boolean {
  return a.x === b.x && a.y === b.y
}

function getPieceAt(pos: Position, pieces: Piece[]): Piece | undefined {
  return pieces.find(p => posEq(p.pos, pos))
}

function getValidMoves(piece: Piece, boardState: BoardState, pieceSide: Side): Position[] {
  const { pieces, ball } = boardState
  const results: Position[] = []

  const canLandOn = (dest: Position): boolean => {
    if (!isInBoard(dest)) return false
    // King restricted to own area
    if (piece.type === 'king') {
      if (!isInOwnArea(dest, pieceSide)) return false
    } else {
      // Non-king cannot enter own area
      if (isInOwnArea(dest, pieceSide)) return false
    }
    const occupant = getPieceAt(dest, pieces)
    if (!occupant) return true
    if (occupant.side === pieceSide) return false
    // Can move to rival square only if rival holds ball (tackle) and not king
    if (occupant.type === 'king') return false
    if (occupant.id === ball.holderId) return true
    return false
  }

  const slideDir = (dxs: number, dys: number) => {
    let cx = piece.pos.x + dxs
    let cy = piece.pos.y + dys
    let steps = 0
    while (isInBoard({ x: cx, y: cy }) && steps < 20) {
      const dest: Position = { x: cx, y: cy }
      const occupant = getPieceAt(dest, pieces)
      if (occupant) {
        if (canLandOn(dest)) results.push(dest)
        break
      }
      if (canLandOn(dest)) results.push(dest)
      cx += dxs
      cy += dys
      steps++
    }
  }

  switch (piece.type) {
    case 'king': {
      const dirs = [[-1,-1],[-1,0],[-1,1],[0,-1],[0,1],[1,-1],[1,0],[1,1]]
      for (const [dx, dy] of dirs) {
        const dest = { x: piece.pos.x + dx, y: piece.pos.y + dy }
        if (canLandOn(dest)) results.push(dest)
      }
      break
    }
    case 'queen': {
      const dirs = [[-1,-1],[-1,0],[-1,1],[0,-1],[0,1],[1,-1],[1,0],[1,1]]
      for (const [dx, dy] of dirs) slideDir(dx, dy)
      break
    }
    case 'rook': {
      for (const [dx, dy] of [[-1,0],[1,0],[0,-1],[0,1]]) slideDir(dx, dy)
      break
    }
    case 'bishop': {
      for (const [dx, dy] of [[-1,-1],[-1,1],[1,-1],[1,1]]) slideDir(dx, dy)
      break
    }
    case 'knight': {
      const jumps = [[-2,-1],[-2,1],[-1,-2],[-1,2],[1,-2],[1,2],[2,-1],[2,1]]
      for (const [dx, dy] of jumps) {
        const dest = { x: piece.pos.x + dx, y: piece.pos.y + dy }
        if (canLandOn(dest)) results.push(dest)
      }
      break
    }
  }

  return results
}

function getValidPasses(piece: Piece, boardState: BoardState): Position[] {
  // Pass destinations follow the same directional pattern as movement but
  // passes are NOT blocked by pieces (ball flies over them). They can land
  // on any square reachable by the piece's directional pattern (unlimited for sliders).
  // Exception: cannot pass to own piece's square OR rival king's square as final dest
  // (rival king as dest = GOAL, which is valid). Cannot pass outside board.
  // keeperBlockedId: if set, cannot pass to the king's square for the blocked keeper.
  const { pieces } = boardState
  const results: Position[] = []

  const addIfValid = (dest: Position) => {
    if (!isInBoard(dest)) return
    const occupant = getPieceAt(dest, pieces)
    if (occupant && occupant.side === piece.side) return // own piece
    // Check keeperBlockedId
    if (boardState.keeperBlockedId) {
      const blockedKing = pieces.find(p => p.id === boardState.keeperBlockedId)
      if (blockedKing && posEq(dest, blockedKing.pos)) return
    }
    results.push(dest)
  }

  const slidePassDir = (dx: number, dy: number) => {
    let cx = piece.pos.x + dx
    let cy = piece.pos.y + dy
    let steps = 0
    while (isInBoard({ x: cx, y: cy }) && steps < 20) {
      addIfValid({ x: cx, y: cy })
      cx += dx
      cy += dy
      steps++
    }
  }

  switch (piece.type) {
    case 'king': {
      const dirs = [[-1,-1],[-1,0],[-1,1],[0,-1],[0,1],[1,-1],[1,0],[1,1]]
      for (const [dx, dy] of dirs) {
        const dest = { x: piece.pos.x + dx, y: piece.pos.y + dy }
        addIfValid(dest)
      }
      break
    }
    case 'queen': {
      const dirs = [[-1,-1],[-1,0],[-1,1],[0,-1],[0,1],[1,-1],[1,0],[1,1]]
      for (const [dx, dy] of dirs) slidePassDir(dx, dy)
      break
    }
    case 'rook': {
      for (const [dx, dy] of [[-1,0],[1,0],[0,-1],[0,1]]) slidePassDir(dx, dy)
      break
    }
    case 'bishop': {
      for (const [dx, dy] of [[-1,-1],[-1,1],[1,-1],[1,1]]) slidePassDir(dx, dy)
      break
    }
    case 'knight': {
      const jumps = [[-2,-1],[-2,1],[-1,-2],[-1,2],[1,-2],[1,2],[2,-1],[2,1]]
      for (const [dx, dy] of jumps) {
        const dest = { x: piece.pos.x + dx, y: piece.pos.y + dy }
        addIfValid(dest)
      }
      break
    }
  }

  return results
}

function isPassSafe(
  from: Position,
  to: Position,
  boardState: BoardState,
  aiSide: Side
): boolean {
  const holder = boardState.pieces.find(p => p.id === boardState.ball.holderId)
  if (!holder) return false

  if (holder.type === 'knight') {
    // Knight passes jump, no interception. Check destination.
    const atDest = getPieceAt(to, boardState.pieces)
    if (atDest && atDest.side !== aiSide && atDest.type !== 'king') return false
    return true
  }

  // Linear piece: walk the path step by step
  const dx = Math.sign(to.x - from.x)
  const dy = Math.sign(to.y - from.y)

  // Validate it's actually a linear direction
  if (dx === 0 && dy === 0) return false

  let cx = from.x + dx
  let cy = from.y + dy
  let steps = 0

  while ((cx !== to.x || cy !== to.y) && steps < 20) {
    const pieceInPath = getPieceAt({ x: cx, y: cy }, boardState.pieces)
    if (pieceInPath) {
      if (pieceInPath.side !== aiSide) {
        // Rival in path: goal if king, interception otherwise
        return pieceInPath.type === 'king'
      }
      // Own piece blocks
      return false
    }
    cx += dx
    cy += dy
    steps++
  }

  // Check destination square
  const atDest = getPieceAt(to, boardState.pieces)
  if (atDest && atDest.side !== aiSide && atDest.type !== 'king') return false

  return true
}

function isBallDestinationSafe(
  to: Position,
  boardState: BoardState,
  aiSide: Side
): boolean {
  const opponentSide: Side = aiSide === 'white' ? 'black' : 'white'
  const teammateAtDest = boardState.pieces.find(
    p => posEq(p.pos, to) && p.side === aiSide
  )
  const simulatedBall = { pos: to, holderId: teammateAtDest ? teammateAtDest.id : null }
  const simulatedState = { ...boardState, ball: simulatedBall }

  const opponentPieces = boardState.pieces.filter(
    p => p.side === opponentSide && p.type !== 'king'
  )
  for (const opp of opponentPieces) {
    const oppMoves = getValidMoves(opp, simulatedState, opp.side)
    if (oppMoves.some(m => posEq(m, to))) return false
  }
  return true
}

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

function findShotOnGoal(
  boardState: BoardState,
  aiSide: Side
): { pieceId: string; to: Position } | null {
  const holder = boardState.pieces.find(p => p.id === boardState.ball.holderId)
  if (!holder || holder.side !== aiSide) return null

  const rivalKing = boardState.pieces.find(p => p.type === 'king' && p.side !== aiSide)
  if (!rivalKing) return null

  const passTargets = getValidPasses(holder, boardState)

  // First check direct shots to king square
  for (const target of passTargets) {
    if (posEq(target, rivalKing.pos)) {
      if (isPassSafe(holder.pos, target, boardState, aiSide)) {
        return { pieceId: holder.id, to: target }
      }
    }
  }

  // For linear pieces, also check passes that travel through the king
  if (holder.type !== 'knight') {
    for (const target of passTargets) {
      if (isOnLineBetween(holder.pos, target, rivalKing.pos)) {
        if (isPassSafe(holder.pos, target, boardState, aiSide)) {
          return { pieceId: holder.id, to: target }
        }
      }
    }
  }

  return null
}

function isKingUnderDirectThreat(
  boardState: BoardState,
  aiSide: Side
): boolean {
  const myKing = boardState.pieces.find(p => p.type === 'king' && p.side === aiSide)
  if (!myKing) return false

  const ballHolder = boardState.pieces.find(p => p.id === boardState.ball.holderId)
  if (!ballHolder || ballHolder.side === aiSide) return false

  // Check if rival can shoot directly at our king
  const opponentSide: Side = ballHolder.side
  return isPassSafe(ballHolder.pos, myKing.pos, { ...boardState }, opponentSide)
}

function findDefensiveBlock(
  boardState: BoardState,
  aiSide: Side
): { pieceId: string; to: Position } | null {
  if (!isKingUnderDirectThreat(boardState, aiSide)) return null

  const myKing = boardState.pieces.find(p => p.type === 'king' && p.side === aiSide)
  if (!myKing) return null
  const ballHolder = boardState.pieces.find(p => p.id === boardState.ball.holderId)
  if (!ballHolder) return null

  // Knight passes can't be blocked
  if (ballHolder.type === 'knight') return null

  const dx = Math.sign(myKing.pos.x - ballHolder.pos.x)
  const dy = Math.sign(myKing.pos.y - ballHolder.pos.y)
  const path: Position[] = []
  let cx = ballHolder.pos.x + dx
  let cy = ballHolder.pos.y + dy
  let steps = 0
  while ((cx !== myKing.pos.x || cy !== myKing.pos.y) && steps < 20) {
    path.push({ x: cx, y: cy })
    cx += dx
    cy += dy
    steps++
  }

  const myPieces = boardState.pieces.filter(
    p => p.side === aiSide && p.type !== 'king' && !p.hasMovedThisTurn
  )
  for (const blockSquare of path) {
    for (const myPiece of myPieces) {
      const validMoves = getValidMoves(myPiece, boardState, myPiece.side)
      if (validMoves.some(m => posEq(m, blockSquare))) {
        return { pieceId: myPiece.id, to: blockSquare }
      }
    }
  }
  return null
}

function findBestTackle(
  boardState: BoardState,
  aiSide: Side
): { pieceId: string; to: Position } | null {
  const ballHolder = boardState.pieces.find(p => p.id === boardState.ball.holderId)
  if (!ballHolder || ballHolder.side === aiSide || ballHolder.type === 'king') return null

  const opponentKingY = aiSide === 'white' ? 10 : 1
  const candidates: Array<{ pieceId: string; to: Position; dist: number }> = []

  const myPieces = boardState.pieces.filter(
    p => p.side === aiSide && p.type !== 'king' && !p.hasMovedThisTurn
  )
  for (const myPiece of myPieces) {
    const validMoves = getValidMoves(myPiece, boardState, myPiece.side)
    if (validMoves.some(m => posEq(m, ballHolder.pos))) {
      const dist = Math.abs(myPiece.pos.y - opponentKingY)
      candidates.push({ pieceId: myPiece.id, to: ballHolder.pos, dist })
    }
  }

  if (candidates.length === 0) return null
  candidates.sort((a, b) => a.dist - b.dist)
  return { pieceId: candidates[0].pieceId, to: candidates[0].to }
}

/**
 * Find the best piece to advance the ball toward the rival king.
 * Returns a move + optional pass sequence.
 */
function findAdvanceWithBall(
  boardState: BoardState,
  aiSide: Side
): AIAction[] {
  const holder = boardState.pieces.find(p => p.id === boardState.ball.holderId)
  if (!holder || holder.side !== aiSide) return []

  const rivalKing = boardState.pieces.find(p => p.type === 'king' && p.side !== aiSide)
  if (!rivalKing) return []

  const targetY = aiSide === 'white' ? 10 : 1
  const actions: AIAction[] = []

  // If holder hasn't moved, try to move it forward
  if (!holder.hasMovedThisTurn && holder.type !== 'king') {
    const validMoves = getValidMoves(holder, boardState, holder.side)
    // Sort moves toward rival king
    const sorted = validMoves
      .filter(m => !isInOwnArea(m, aiSide)) // no own area
      .sort((a, b) => Math.abs(a.y - targetY) - Math.abs(b.y - targetY))

    if (sorted.length > 0) {
      const bestMove = sorted[0]
      // Simulate after move to check for shot
      const simulatedPieces = boardState.pieces.map(p =>
        p.id === holder.id ? { ...p, pos: bestMove, hasMovedThisTurn: true } : p
      )
      const simulatedBall = { ...boardState.ball, pos: bestMove }
      const simState = { ...boardState, pieces: simulatedPieces, ball: simulatedBall }

      actions.push({ type: 'move', pieceId: holder.id, to: bestMove })

      // Check shot after moving
      const shot = findShotOnGoal(simState, aiSide)
      if (shot) {
        actions.push({ type: 'pass', pieceId: shot.pieceId, to: shot.to })
        return actions
      }

      // Try passing to a teammate in a better position (especially knight)
      const newHolder = { ...holder, pos: bestMove, hasMovedThisTurn: true }
      const passTargets = getValidPasses(newHolder, simState)
      // Look for a knight to pass to (knight passes = uninterceptable)
      const myKnights = simulatedPieces.filter(p => p.side === aiSide && p.type === 'knight' && p.id !== holder.id)
      for (const knight of myKnights) {
        if (passTargets.some(t => posEq(t, knight.pos))) {
          if (isPassSafe(bestMove, knight.pos, simState, aiSide) && isBallDestinationSafe(knight.pos, simState, aiSide)) {
            actions.push({ type: 'pass', pieceId: holder.id, to: knight.pos })
            return actions
          }
        }
      }

      // Try passing to a safer advanced teammate
      const myTeammates = simulatedPieces.filter(p => p.side === aiSide && p.type !== 'king' && p.id !== holder.id)
      const advancedTeammates = myTeammates
        .filter(p => passTargets.some(t => posEq(t, p.pos)))
        .sort((a, b) => Math.abs(a.pos.y - targetY) - Math.abs(b.pos.y - targetY))
      for (const mate of advancedTeammates) {
        if (isPassSafe(bestMove, mate.pos, simState, aiSide) && isBallDestinationSafe(mate.pos, simState, aiSide)) {
          actions.push({ type: 'pass', pieceId: holder.id, to: mate.pos })
          return actions
        }
      }
    }
  }

  // Holder can't or shouldn't move — try safe pass to advanced teammate
  const passTargets = getValidPasses(holder, boardState)
  const myTeammates = boardState.pieces.filter(p => p.side === aiSide && p.type !== 'king' && p.id !== holder.id)

  // Prioritize passing to knight
  const myKnights = myTeammates.filter(p => p.type === 'knight')
  for (const knight of myKnights) {
    if (passTargets.some(t => posEq(t, knight.pos))) {
      if (isPassSafe(holder.pos, knight.pos, boardState, aiSide) && isBallDestinationSafe(knight.pos, boardState, aiSide)) {
        actions.push({ type: 'pass', pieceId: holder.id, to: knight.pos })
        return actions
      }
    }
  }

  // Nearest advanced teammate
  const advancedTeammates = myTeammates
    .filter(p => passTargets.some(t => posEq(t, p.pos)))
    .sort((a, b) => Math.abs(a.pos.y - targetY) - Math.abs(b.pos.y - targetY))
  for (const mate of advancedTeammates) {
    if (isPassSafe(holder.pos, mate.pos, boardState, aiSide) && isBallDestinationSafe(mate.pos, boardState, aiSide)) {
      actions.push({ type: 'pass', pieceId: holder.id, to: mate.pos })
      return actions
    }
  }

  return actions
}

/**
 * Find reposition moves for unused pieces (no ball involved).
 * Returns up to maxMoves defensive/offensive reposition actions.
 */
function findRepositionMoves(
  boardState: BoardState,
  aiSide: Side,
  maxMoves: number
): AIAction[] {
  const actions: AIAction[] = []
  const targetY = aiSide === 'white' ? 10 : 1
  const myPieces = boardState.pieces.filter(
    p => p.side === aiSide && p.type !== 'king' && !p.hasMovedThisTurn && p.id !== boardState.ball.holderId
  )

  // Sort: advance knights and queen toward opponent
  const sorted = myPieces.sort((a, b) => {
    const aScore = (a.type === 'knight' ? 0 : a.type === 'queen' ? 1 : 2)
    const bScore = (b.type === 'knight' ? 0 : b.type === 'queen' ? 1 : 2)
    if (aScore !== bScore) return aScore - bScore
    return Math.abs(a.pos.y - targetY) - Math.abs(b.pos.y - targetY)
  })

  for (const piece of sorted) {
    if (actions.length >= maxMoves) break
    const validMoves = getValidMoves(piece, boardState, aiSide)
    if (validMoves.length === 0) continue
    // Pick move that advances piece toward rival king
    const best = validMoves.sort((a, b) => Math.abs(a.y - targetY) - Math.abs(b.y - targetY))[0]
    if (Math.abs(best.y - targetY) < Math.abs(piece.pos.y - targetY)) {
      actions.push({ type: 'move', pieceId: piece.id, to: best })
    }
  }

  return actions
}

function findKingAvoidKnightShot(
  boardState: BoardState,
  aiSide: Side
): AIAction | null {
  const myKing = boardState.pieces.find(p => p.type === 'king' && p.side === aiSide)
  if (!myKing) return null

  const ballHolder = boardState.pieces.find(p => p.id === boardState.ball.holderId)
  if (!ballHolder || ballHolder.side === aiSide || ballHolder.type !== 'knight') return null

  // Check if knight can shoot at our king
  const knightMoves = getValidPasses(ballHolder, boardState)
  if (!knightMoves.some(m => posEq(m, myKing.pos))) return null

  // Move king to another area square
  const kingMoves = getValidMoves(myKing, boardState, aiSide)
  if (kingMoves.length === 0) return null
  // Pick a square not targeted by the knight
  for (const dest of kingMoves) {
    if (!knightMoves.some(m => posEq(m, dest))) {
      return { type: 'move', pieceId: myKing.id, to: dest }
    }
  }
  // If all squares threatened, just move to any
  return { type: 'move', pieceId: myKing.id, to: kingMoves[0] }
}

// ============================================
// Export del jugador IA
// ============================================

export const aiPlayer: AIPlayerScript = {
  name: "Claude Sonnet",
  description: "Estratega ofensivo que prioriza disparos al rey rival desde los caballos, protege al rey propio bloqueando líneas de tiro, y aprovecha todos los AP disponibles para avanzar con seguridad.",
  avatar: "🧠",
  difficulty: "advanced",
  badgeName: "Domador de Sonnet",
  badgeIcon: "brain",

  play: (boardState: BoardState, aiSide: Side): AIAction[] => {
    try {
      const actions: AIAction[] = []

      // Helper: remaining AP budget for this turn (minus already queued actions)
      const apBudget = () => boardState.actionPoints - actions.length

      // ── 0. kingMustRelease: pass the ball out with the king FIRST ──
      if (boardState.kingMustRelease === aiSide) {
        const myKing = boardState.pieces.find(p => p.type === 'king' && p.side === aiSide)
        if (myKing && myKing.id === boardState.ball.holderId) {
          const passTargets = getValidPasses(myKing, boardState)
          const myTeammates = boardState.pieces.filter(p => p.side === aiSide && p.type !== 'king')
          // Prefer passing to a teammate
          for (const mate of myTeammates) {
            if (passTargets.some(t => posEq(t, mate.pos))) {
              if (isPassSafe(myKing.pos, mate.pos, boardState, aiSide)) {
                actions.push({ type: 'pass', pieceId: myKing.id, to: mate.pos })
                break
              }
            }
          }
          // If no teammate found, pass to nearest safe empty square
          if (actions.length === 0) {
            for (const t of passTargets) {
              if (isPassSafe(myKing.pos, t, boardState, aiSide)) {
                actions.push({ type: 'pass', pieceId: myKing.id, to: t })
                break
              }
            }
          }
        }
      }

      // ── 1. Check for immediate goal ──
      if (apBudget() > 0) {
        const shot = findShotOnGoal(boardState, aiSide)
        if (shot) {
          actions.push({ type: 'pass', pieceId: shot.pieceId, to: shot.to })
          return actions
        }
      }

      // ── 2. Defensive: king under threat? ──
      if (apBudget() > 0) {
        const threatExists = isKingUnderDirectThreat(boardState, aiSide)
        if (threatExists) {
          // 2a. Try tackle first
          const tackle = findBestTackle(boardState, aiSide)
          if (tackle) {
            actions.push({ type: 'move', pieceId: tackle.pieceId, to: tackle.to })
            // After tackle we have the ball — check for shot
            if (apBudget() > 0) {
              const newHolder = boardState.pieces.find(p => p.id === tackle.pieceId)
              if (newHolder) {
                const simPieces = boardState.pieces.map(p =>
                  p.id === tackle.pieceId ? { ...p, pos: tackle.to, hasMovedThisTurn: true } : p
                ).filter(p => p.id !== boardState.ball.holderId || p.id === tackle.pieceId)
                // Remove old ball holder (tackled piece displaced — simplify: just simulate ball with tackler)
                const simState = {
                  ...boardState,
                  pieces: simPieces,
                  ball: { pos: tackle.to, holderId: tackle.pieceId }
                }
                const shot = findShotOnGoal(simState, aiSide)
                if (shot) {
                  actions.push({ type: 'pass', pieceId: shot.pieceId, to: shot.to })
                  return actions
                }
              }
            }
          } else {
            // 2b. Try blocking the line
            const block = findDefensiveBlock(boardState, aiSide)
            if (block) {
              actions.push({ type: 'move', pieceId: block.pieceId, to: block.to })
            } else {
              // 2c. Knight threat: move king within area
              const kingDodge = findKingAvoidKnightShot(boardState, aiSide)
              if (kingDodge) {
                actions.push(kingDodge)
              }
            }
          }
        }
      }

      // ── 3. Offensive: we have the ball ──
      const holder = boardState.pieces.find(p => p.id === boardState.ball.holderId)
      if (holder && holder.side === aiSide && apBudget() > 0) {
        const advanceActions = findAdvanceWithBall(boardState, aiSide)
        for (const a of advanceActions) {
          if (apBudget() > 0) actions.push(a)
        }
      }

      // ── 4. No ball: tackle or reposition ──
      if ((!holder || holder.side !== aiSide) && apBudget() > 0) {
        const tackle = findBestTackle(boardState, aiSide)
        if (tackle && apBudget() > 0) {
          actions.push({ type: 'move', pieceId: tackle.pieceId, to: tackle.to })
          // After tackle, try shot
          if (apBudget() > 0) {
            const simPieces = boardState.pieces.map(p =>
              p.id === tackle.pieceId ? { ...p, pos: tackle.to, hasMovedThisTurn: true } : p
            )
            const simState = {
              ...boardState,
              pieces: simPieces,
              ball: { pos: tackle.to, holderId: tackle.pieceId }
            }
            const shot = findShotOnGoal(simState, aiSide)
            if (shot) {
              actions.push({ type: 'pass', pieceId: shot.pieceId, to: shot.to })
              return actions
            }
          }
        }
      }

      // ── 5. Fill remaining AP with useful repositioning ──
      if (apBudget() > 0) {
        const remaining = apBudget()
        const repoMoves = findRepositionMoves(boardState, aiSide, remaining)
        for (const m of repoMoves) {
          if (apBudget() > 0) actions.push(m)
        }
      }

      // ── 6. End turn if nothing else to do ──
      if (actions.length === 0) {
        actions.push({ type: 'end_turn' })
      }

      return actions
    } catch {
      return [{ type: 'end_turn' }]
    }
  }
}