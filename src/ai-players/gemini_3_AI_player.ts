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
// Funciones auxiliares internas (Puras)
// ============================================

function isInArea(x: number, y: number, side: Side): boolean {
  if (side === 'white') {
    return x >= 2 && x <= 6 && y >= 0 && y <= 1
  } else {
    return x >= 2 && x <= 6 && y >= 10 && y <= 11
  }
}

function getValidMoves(piece: Piece, boardState: BoardState, aiSide: Side): Position[] {
  const moves: Position[] = []
  
  const dirs8 = [
    { x: 1, y: 0 }, { x: -1, y: 0 }, { x: 0, y: 1 }, { x: 0, y: -1 },
    { x: 1, y: 1 }, { x: -1, y: 1 }, { x: 1, y: -1 }, { x: -1, y: -1 }
  ]
  const dirs4Orth = [{ x: 1, y: 0 }, { x: -1, y: 0 }, { x: 0, y: 1 }, { x: 0, y: -1 }]
  const dirs4Diag = [{ x: 1, y: 1 }, { x: -1, y: 1 }, { x: 1, y: -1 }, { x: -1, y: -1 }]
  const knightOffsets = [
    { x: 2, y: 1 }, { x: 2, y: -1 }, { x: -2, y: 1 }, { x: -2, y: -1 },
    { x: 1, y: 2 }, { x: 1, y: -2 }, { x: -1, y: 2 }, { x: -1, y: -2 }
  ]

  if (piece.type === 'king') {
    for (const d of dirs8) {
      const cx = piece.pos.x + d.x
      const cy = piece.pos.y + d.y
      if (cx >= 0 && cx <= 8 && cy >= 0 && cy <= 11) {
        if (isInArea(cx, cy, piece.side)) {
          const pAt = boardState.pieces.find(p => p.pos.x === cx && p.pos.y === cy)
          if (!pAt) {
            moves.push({ x: cx, y: cy })
          } else if (pAt.side !== piece.side && pAt.type !== 'king' && boardState.ball.holderId === pAt.id) {
            moves.push({ x: cx, y: cy })
          }
        }
      }
    }
  } else if (piece.type === 'knight') {
    for (const o of knightOffsets) {
      const cx = piece.pos.x + o.x
      const cy = piece.pos.y + o.y
      if (cx >= 0 && cx <= 8 && cy >= 0 && cy <= 11) {
        if (!isInArea(cx, cy, piece.side)) {
          const pAt = boardState.pieces.find(p => p.pos.x === cx && p.pos.y === cy)
          if (!pAt) {
            moves.push({ x: cx, y: cy })
          } else if (pAt.side !== piece.side && pAt.type !== 'king' && boardState.ball.holderId === pAt.id) {
            moves.push({ x: cx, y: cy })
          }
        }
      }
    }
  } else {
    const dirs = piece.type === 'rook' ? dirs4Orth : (piece.type === 'bishop' ? dirs4Diag : dirs8)
    for (const d of dirs) {
      let cx = piece.pos.x + d.x
      let cy = piece.pos.y + d.y
      let iter = 0
      while (cx >= 0 && cx <= 8 && cy >= 0 && cy <= 11 && iter < 12) {
        iter++
        if (isInArea(cx, cy, piece.side)) {
          break
        }
        const pAt = boardState.pieces.find(p => p.pos.x === cx && p.pos.y === cy)
        if (pAt) {
          if (pAt.side === piece.side) {
            break
          } else {
            if (pAt.type === 'king') {
              break
            }
            if (boardState.ball.holderId === pAt.id) {
              moves.push({ x: cx, y: cy })
            }
            break
          }
        }
        moves.push({ x: cx, y: cy })
        cx += d.x
        cy += d.y
      }
    }
  }
  return moves
}

function getValidPasses(piece: Piece, boardState: BoardState): Position[] {
  const targets: Position[] = []
  const myKing = boardState.pieces.find(p => p.type === 'king' && p.side === piece.side)
  const isKeeperBlocked = myKing && boardState.keeperBlockedId === myKing.id

  if (piece.type === 'knight') {
    const knightOffsets = [
      { x: 2, y: 1 }, { x: 2, y: -1 }, { x: -2, y: 1 }, { x: -2, y: -1 },
      { x: 1, y: 2 }, { x: 1, y: -2 }, { x: -1, y: 2 }, { x: -1, y: -2 }
    ]
    for (const o of knightOffsets) {
      const cx = piece.pos.x + o.x
      const cy = piece.pos.y + o.y
      if (cx >= 0 && cx <= 8 && cy >= 0 && cy <= 11) {
        if (isKeeperBlocked && myKing && cx === myKing.pos.x && cy === myKing.pos.y) {
          continue
        }
        targets.push({ x: cx, y: cy })
      }
    }
  } else {
    const dirs8 = [
      { x: 1, y: 0 }, { x: -1, y: 0 }, { x: 0, y: 1 }, { x: 0, y: -1 },
      { x: 1, y: 1 }, { x: -1, y: 1 }, { x: 1, y: -1 }, { x: -1, y: -1 }
    ]
    const dirs4Orth = [{ x: 1, y: 0 }, { x: -1, y: 0 }, { x: 0, y: 1 }, { x: 0, y: -1 }]
    const dirs4Diag = [{ x: 1, y: 1 }, { x: -1, y: 1 }, { x: 1, y: -1 }, { x: -1, y: -1 }]
    
    const dirs = piece.type === 'rook' ? dirs4Orth : (piece.type === 'bishop' ? dirs4Diag : dirs8)
    for (const d of dirs) {
      let cx = piece.pos.x + d.x
      let cy = piece.pos.y + d.y
      let iter = 0
      while (cx >= 0 && cx <= 8 && cy >= 0 && cy <= 11 && iter < 12) {
        iter++
        if (isKeeperBlocked && myKing && cx === myKing.pos.x && cy === myKing.pos.y) {
          cx += d.x
          cy += d.y
          continue
        }
        targets.push({ x: cx, y: cy })
        cx += d.x
        cy += d.y
      }
    }
  }
  return targets
}

function isPassSafe(from: Position, to: Position, boardState: BoardState, aiSide: Side): boolean {
  const holder = boardState.pieces.find(p => p.id === boardState.ball.holderId)
  if (!holder) return false
  
  if (holder.type === 'knight') {
    const atDest = boardState.pieces.find(p => p.pos.x === to.x && p.pos.y === to.y)
    if (atDest && atDest.side !== aiSide && atDest.type !== 'king') return false
    return true
  }

  const dx = Math.sign(to.x - from.x)
  const dy = Math.sign(to.y - from.y)
  if (dx === 0 && dy === 0) return false

  let cx = from.x + dx
  let cy = from.y + dy
  let iter = 0

  while ((cx !== to.x || cy !== to.y) && iter < 12) {
    iter++
    const pieceInPath = boardState.pieces.find(p => p.pos.x === cx && p.pos.y === cy)
    if (pieceInPath) {
      if (pieceInPath.side !== aiSide) {
        return pieceInPath.type === 'king'
      }
      return false
    }
    cx += dx
    cy += dy
  }

  const atDest = boardState.pieces.find(p => p.pos.x === to.x && p.pos.y === to.y)
  if (atDest && atDest.side !== aiSide && atDest.type !== 'king') return false

  return true
}

function isBallDestinationSafe(to: Position, boardState: BoardState, aiSide: Side): boolean {
  const opponentSide: Side = aiSide === 'white' ? 'black' : 'white'
  const teammateAtDest = boardState.pieces.find(p => p.pos.x === to.x && p.pos.y === to.y && p.side === aiSide)
  
  const simulatedBall = { pos: to, holderId: teammateAtDest ? teammateAtDest.id : null }
  const simulatedState = { ...boardState, ball: simulatedBall }

  const opponentPieces = boardState.pieces.filter(p => p.side === opponentSide && p.type !== 'king')
  for (const opp of opponentPieces) {
    const oppMoves = getValidMoves(opp, simulatedState, opp.side)
    if (oppMoves.some(m => m.x === to.x && m.y === to.y)) {
      return false
    }
  }
  return true
}

function isOnLineBetween(from: Position, to: Position, check: Position): boolean {
  const dx = Math.sign(to.x - from.x)
  const dy = Math.sign(to.y - from.y)
  if (dx === 0 && dy === 0) return false

  let cx = from.x + dx
  let cy = from.y + dy
  let iter = 0
  while ((cx !== to.x || cy !== to.y) && iter < 12) {
    iter++
    if (cx === check.x && cy === check.y) return true
    cx += dx
    cy += dy
  }
  return false
}

function findShotOnGoal(boardState: BoardState, aiSide: Side): { pieceId: string; to: Position } | null {
  const holder = boardState.pieces.find(p => p.id === boardState.ball.holderId)
  if (!holder || holder.side !== aiSide) return null

  const rivalKing = boardState.pieces.find(p => p.type === 'king' && p.side !== aiSide)
  if (!rivalKing) return null

  const passTargets = getValidPasses(holder, boardState)
  for (const target of passTargets) {
    if (target.x === rivalKing.pos.x && target.y === rivalKing.pos.y) {
      if (isPassSafe(holder.pos, target, boardState, aiSide)) {
        return { pieceId: holder.id, to: target }
      }
    }
    if (holder.type !== 'knight' && isOnLineBetween(holder.pos, target, rivalKing.pos)) {
      if (isPassSafe(holder.pos, target, boardState, aiSide)) {
        return { pieceId: holder.id, to: target }
      }
    }
  }
  return null
}

function isKingUnderDirectThreat(boardState: BoardState, aiSide: Side): boolean {
  const myKing = boardState.pieces.find(p => p.type === 'king' && p.side === aiSide)
  if (!myKing) return false

  const ballHolder = boardState.pieces.find(p => p.id === boardState.ball.holderId)
  if (!ballHolder || ballHolder.side === aiSide) return false

  return isPassSafe(ballHolder.pos, myKing.pos, boardState, ballHolder.side)
}

function findDefensiveBlock(boardState: BoardState, aiSide: Side): { pieceId: string; to: Position } | null {
  if (!isKingUnderDirectThreat(boardState, aiSide)) return null

  const myKing = boardState.pieces.find(p => p.type === 'king' && p.side === aiSide)!
  const ballHolder = boardState.pieces.find(p => p.id === boardState.ball.holderId)!
  if (ballHolder.type === 'knight') return null

  const dx = Math.sign(myKing.pos.x - ballHolder.pos.x)
  const dy = Math.sign(myKing.pos.y - ballHolder.pos.y)
  const path: Position[] = []
  let cx = ballHolder.pos.x + dx
  let cy = ballHolder.pos.y + dy
  let iter = 0

  while ((cx !== myKing.pos.x || cy !== myKing.pos.y) && iter < 12) {
    iter++
    path.push({ x: cx, y: cy })
    cx += dx
    cy += dy
  }

  const myPieces = boardState.pieces.filter(p => p.side === aiSide && p.type !== 'king' && !p.hasMovedThisTurn)
  for (const blockSquare of path) {
    for (const myPiece of myPieces) {
      const validMoves = getValidMoves(myPiece, boardState, myPiece.side)
      if (validMoves.some(m => m.x === blockSquare.x && m.y === blockSquare.y)) {
        return { pieceId: myPiece.id, to: blockSquare }
      }
    }
  }
  return null
}

function findBestTackle(boardState: BoardState, aiSide: Side): { pieceId: string; to: Position } | null {
  const ballHolder = boardState.pieces.find(p => p.id === boardState.ball.holderId)
  if (!ballHolder || ballHolder.side === aiSide || ballHolder.type === 'king') return null

  const opponentKingY = aiSide === 'white' ? 10 : 1
  const candidates: Array<{ pieceId: string; to: Position; dist: number }> = []

  const myPieces = boardState.pieces.filter(p => p.side === aiSide && p.type !== 'king' && !p.hasMovedThisTurn)
  for (const myPiece of myPieces) {
    const validMoves = getValidMoves(myPiece, boardState, myPiece.side)
    if (validMoves.some(m => m.x === ballHolder.pos.x && m.y === ballHolder.pos.y)) {
      const dist = Math.abs(myPiece.pos.y - opponentKingY)
      candidates.push({ pieceId: myPiece.id, to: ballHolder.pos, dist })
    }
  }

  if (candidates.length === 0) return null
  candidates.sort((a, b) => a.dist - b.dist)
  return { pieceId: candidates[0].pieceId, to: candidates[0].to }
}

function cloneBoardState(state: BoardState): BoardState {
  return {
    pieces: state.pieces.map(p => ({ ...p })),
    ball: { pos: { ...state.ball.pos }, holderId: state.ball.holderId },
    score: { ...state.score },
    actionPoints: state.actionPoints,
    turn: state.turn,
    kingMustRelease: state.kingMustRelease,
    keeperBlockedId: state.keeperBlockedId,
    lastMove: state.lastMove ? { ...state.lastMove } : undefined,
    moveHistory: state.moveHistory,
    turnNumber: state.turnNumber
  }
}

function simulateAction(state: BoardState, action: AIAction): BoardState {
  const nextState = cloneBoardState(state)
  nextState.actionPoints -= 1

  if (action.type === 'move' && action.pieceId && action.to) {
    const piece = nextState.pieces.find(p => p.id === action.pieceId)
    if (piece) {
      const targetX = action.to.x
      const targetY = action.to.y
      
      const rival = nextState.pieces.find(p => p.pos.x === targetX && p.pos.y === targetY)
      if (rival && rival.side !== piece.side && nextState.ball.holderId === rival.id) {
        const offsets = [
          { dx: 1, dy: 0 }, { dx: -1, dy: 0 }, { dx: 0, dy: 1 }, { dx: 0, dy: -1 },
          { dx: 1, dy: 1 }, { dx: -1, dy: 1 }, { dx: 1, dy: -1 }, { dx: -1, dy: -1 }
        ]
        for (const o of offsets) {
          const nx = rival.pos.x + o.dx
          const ny = rival.pos.y + o.dy
          if (nx >= 0 && nx <= 8 && ny >= 0 && ny <= 11) {
            if (!nextState.pieces.some(p => p.pos.x === nx && p.pos.y === ny)) {
              rival.pos = { x: nx, y: ny }
              break
            }
          }
        }
        nextState.ball.holderId = piece.id
      }
      
      piece.pos = { x: targetX, y: targetY }
      piece.hasMovedThisTurn = true
      
      if (nextState.ball.holderId === piece.id) {
        nextState.ball.pos = { x: targetX, y: targetY }
      } else if (nextState.ball.pos.x === targetX && nextState.ball.pos.y === targetY) {
        nextState.ball.holderId = piece.id
      }
    }
  } else if (action.type === 'pass' && action.pieceId && action.to) {
    const passTo = action.to
    const piece = nextState.pieces.find(p => p.id === action.pieceId)
    if (piece && nextState.ball.holderId === piece.id) {
      const rivalKing = nextState.pieces.find(p => p.type === 'king' && p.side !== piece.side)
      let finalPos = { ...passTo }
      let finalHolderId: string | null = null
      let turnEnded = false

      if (piece.type === 'knight') {
        const atDest = nextState.pieces.find(p => p.pos.x === passTo.x && p.pos.y === passTo.y)
        if (rivalKing && passTo.x === rivalKing.pos.x && passTo.y === rivalKing.pos.y) {
          turnEnded = true
        } else if (atDest) {
          finalHolderId = atDest.id
          if (atDest.side !== piece.side) turnEnded = true
        }
      } else {
        const dx = Math.sign(passTo.x - piece.pos.x)
        const dy = Math.sign(passTo.y - piece.pos.y)
        let cx = piece.pos.x + dx
        let cy = piece.pos.y + dy
        let iter = 0
        while ((cx !== passTo.x || cy !== passTo.y) && iter < 12) {
          iter++
          const pathPiece = nextState.pieces.find(p => p.pos.x === cx && p.pos.y === cy)
          if (pathPiece) {
            if (pathPiece.side !== piece.side) {
              if (pathPiece.type === 'king') {
                finalPos = { x: cx, y: cy }
                turnEnded = true
              } else {
                finalPos = { x: cx, y: cy }
                finalHolderId = pathPiece.id
                turnEnded = true
              }
            } else {
              finalPos = { x: cx - dx, y: cy - dy }
              break
            }
          }
          if (turnEnded) break
          cx += dx
          cy += dy
        }

        if (!turnEnded) {
          const atDest = nextState.pieces.find(p => p.pos.x === passTo.x && p.pos.y === passTo.y)
          if (rivalKing && passTo.x === rivalKing.pos.x && passTo.y === rivalKing.pos.y) {
            turnEnded = true
          } else if (atDest) {
            finalHolderId = atDest.id
            if (atDest.side !== piece.side) turnEnded = true
          }
        }
      }

      nextState.ball.pos = finalPos
      nextState.ball.holderId = finalHolderId
      if (turnEnded) {
        nextState.actionPoints = 0
      }
      if (piece.type === 'king') {
        nextState.keeperBlockedId = piece.id
      }
    }
  } else if (action.type === 'end_turn') {
    nextState.actionPoints = 0
  }

  return nextState
}

// ============================================
// Export del jugador IA
// ============================================

export const aiPlayer: AIPlayerScript = {
  name: "TikiTaka_AI",
  description: "Estrategia avanzada que combina pases seguros milimétricos, delantera de caballos inmunes a interceptación y repliegues defensivos inteligentes.",
  avatar: "⚡",
  difficulty: "advanced",
  badgeName: "Conquistador del Tablero",
  badgeIcon: "crown",
  play: (boardState: BoardState, aiSide: Side): AIAction[] => {
    try {
      let currentBoard = cloneBoardState(boardState)
      const actions: AIAction[] = []
      let loopGuard = 0

      while (currentBoard.actionPoints > 0 && actions.length < 5 && loopGuard < 10) {
        loopGuard++

        // 0. Obligación de liberar el balón del Rey
        if (currentBoard.kingMustRelease === aiSide) {
          const myKing = currentBoard.pieces.find(p => p.type === 'king' && p.side === aiSide)
          if (myKing && currentBoard.ball.holderId === myKing.id) {
            const passTargets = getValidPasses(myKing, currentBoard)
            let chosenPass: Position | null = null
            
            for (const target of passTargets) {
              if (isPassSafe(myKing.pos, target, currentBoard, aiSide) && isBallDestinationSafe(target, currentBoard, aiSide)) {
                const tm = currentBoard.pieces.find(p => p.pos.x === target.x && p.pos.y === target.y && p.side === aiSide)
                if (tm) { chosenPass = target; break }
              }
            }
            if (!chosenPass) {
              for (const target of passTargets) {
                if (isPassSafe(myKing.pos, target, currentBoard, aiSide) && isBallDestinationSafe(target, currentBoard, aiSide)) {
                  chosenPass = target; break
                }
              }
            }
            if (!chosenPass && passTargets.length > 0) {
              chosenPass = passTargets[0]
            }
            if (chosenPass) {
              const act: AIAction = { type: 'pass', pieceId: myKing.id, to: chosenPass }
              actions.push(act)
              currentBoard = simulateAction(currentBoard, act)
              continue
            }
          }
        }

        // 1. Oportunidad Directa de Gol
        const shot = findShotOnGoal(currentBoard, aiSide)
        if (shot) {
          const act: AIAction = { type: 'pass', pieceId: shot.pieceId, to: shot.to }
          actions.push(act)
          currentBoard = simulateAction(currentBoard, act)
          break
        }

        // 2. Emergencia Defensiva (Rey Amenazado)
        if (isKingUnderDirectThreat(currentBoard, aiSide)) {
          const tackle = findBestTackle(currentBoard, aiSide)
          if (tackle) {
            const act: AIAction = { type: 'move', pieceId: tackle.pieceId, to: tackle.to }
            actions.push(act)
            currentBoard = simulateAction(currentBoard, act)
            continue
          }

          const block = findDefensiveBlock(currentBoard, aiSide)
          if (block) {
            const act: AIAction = { type: 'move', pieceId: block.pieceId, to: block.to }
            actions.push(act)
            currentBoard = simulateAction(currentBoard, act)
            continue
          }

          const myKing = currentBoard.pieces.find(p => p.type === 'king' && p.side === aiSide)
          if (myKing && !myKing.hasMovedThisTurn) {
            const kmoves = getValidMoves(myKing, currentBoard, aiSide)
            let safeKMove: Position | null = null
            for (const km of kmoves) {
              const testState = cloneBoardState(currentBoard)
              const pk = testState.pieces.find(p => p.id === myKing.id)!
              pk.pos = km
              if (!isKingUnderDirectThreat(testState, aiSide)) {
                safeKMove = km
                break
              }
            }
            if (safeKMove) {
              const act: AIAction = { type: 'move', pieceId: myKing.id, to: safeKMove }
              actions.push(act)
              currentBoard = simulateAction(currentBoard, act)
              continue
            }
          }
        }

        // 3. Fase Ofensiva (Tenemos la posesión)
        const holder = currentBoard.pieces.find(p => p.id === currentBoard.ball.holderId)
        if (holder && holder.side === aiSide) {
          const passTargets = getValidPasses(holder, currentBoard)
          const oppKingY = aiSide === 'white' ? 10 : 1
          let knightPass: { pieceId: string; to: Position } | null = null

          for (const target of passTargets) {
            if (isPassSafe(holder.pos, target, currentBoard, aiSide) && isBallDestinationSafe(target, currentBoard, aiSide)) {
              const pAtDest = currentBoard.pieces.find(p => p.pos.x === target.x && p.pos.y === target.y)
              if (pAtDest && pAtDest.side === aiSide && pAtDest.type === 'knight') {
                if (Math.abs(target.y - oppKingY) < Math.abs(holder.pos.y - oppKingY)) {
                  knightPass = { pieceId: holder.id, to: target }
                  break
                }
              }
            }
          }

          if (knightPass) {
            const act: AIAction = { type: 'pass', pieceId: knightPass.pieceId, to: knightPass.to }
            actions.push(act)
            currentBoard = simulateAction(currentBoard, act)
            continue
          }

          if (!holder.hasMovedThisTurn) {
            const moves = getValidMoves(holder, currentBoard, aiSide)
            let bestMove: Position | null = null
            let bestDist = Math.abs(holder.pos.y - oppKingY)

            for (const m of moves) {
              const dist = Math.abs(m.y - oppKingY)
              if (dist < bestDist) {
                bestDist = dist
                bestMove = m
              }
            }

            if (bestMove) {
              const act: AIAction = { type: 'move', pieceId: holder.id, to: bestMove }
              actions.push(act)
              currentBoard = simulateAction(currentBoard, act)
              continue
            }
          }

          let forwardPass: Position | null = null
          let minPassDist = Math.abs(holder.pos.y - oppKingY)
          for (const target of passTargets) {
            if (isPassSafe(holder.pos, target, currentBoard, aiSide) && isBallDestinationSafe(target, currentBoard, aiSide)) {
              const tm = currentBoard.pieces.find(p => p.pos.x === target.x && p.pos.y === target.y && p.side === aiSide)
              if (tm) {
                const dist = Math.abs(target.y - oppKingY)
                if (dist < minPassDist) {
                  minPassDist = dist
                  forwardPass = target
                }
              }
            }
          }

          if (forwardPass) {
            const act: AIAction = { type: 'pass', pieceId: holder.id, to: forwardPass }
            actions.push(act)
            currentBoard = simulateAction(currentBoard, act)
            continue
          }

          let openPass: Position | null = null
          let minOpenDist = Math.abs(holder.pos.y - oppKingY)
          for (const target of passTargets) {
            if (isPassSafe(holder.pos, target, currentBoard, aiSide) && isBallDestinationSafe(target, currentBoard, aiSide)) {
              if (!currentBoard.pieces.some(p => p.pos.x === target.x && p.pos.y === target.y)) {
                const dist = Math.abs(target.y - oppKingY)
                if (dist < minOpenDist) {
                  minOpenDist = dist
                  openPass = target
                }
              }
            }
          }

          if (openPass) {
            const act: AIAction = { type: 'pass', pieceId: holder.id, to: openPass }
            actions.push(act)
            currentBoard = simulateAction(currentBoard, act)
            continue
          }
        }

        // 4. Recuperación y Presión (No tenemos la posesión)
        if (!holder || holder.side !== aiSide) {
          const tackle = findBestTackle(currentBoard, aiSide)
          if (tackle) {
            const act: AIAction = { type: 'move', pieceId: tackle.pieceId, to: tackle.to }
            actions.push(act)
            currentBoard = simulateAction(currentBoard, act)
            continue
          }

          if (currentBoard.ball.holderId === null) {
            const bpos = currentBoard.ball.pos
            let bestGrabber: { pieceId: string; to: Position } | null = null
            let minGrabDist = 999
            
            const myPieces = currentBoard.pieces.filter(p => p.side === aiSide && p.type !== 'king' && !p.hasMovedThisTurn)
            for (const p of myPieces) {
              const moves = getValidMoves(p, currentBoard, aiSide)
              if (moves.some(m => m.x === bpos.x && m.y === bpos.y)) {
                bestGrabber = { pieceId: p.id, to: bpos }
                break
              } else {
                for (const m of moves) {
                  const dist = Math.abs(m.x - bpos.x) + Math.abs(m.y - bpos.y)
                  if (dist < minGrabDist) {
                    minGrabDist = dist
                    bestGrabber = { pieceId: p.id, to: m }
                  }
                }
              }
            }

            if (bestGrabber) {
              const act: AIAction = { type: 'move', pieceId: bestGrabber.pieceId, to: bestGrabber.to }
              actions.push(act)
              currentBoard = simulateAction(currentBoard, act)
              continue
            }
          }

          const oppHolder = currentBoard.pieces.find(p => p.id === currentBoard.ball.holderId)
          const targetPos = oppHolder ? oppHolder.pos : currentBoard.ball.pos
          let pressAct: AIAction | null = null
          let minPressDist = 999

          const myPieces = currentBoard.pieces.filter(p => p.side === aiSide && p.type !== 'king' && !p.hasMovedThisTurn)
          for (const p of myPieces) {
            const moves = getValidMoves(p, currentBoard, aiSide)
            for (const m of moves) {
              const dist = Math.abs(m.x - targetPos.x) + Math.abs(m.y - targetPos.y)
              if (dist < minPressDist) {
                minPressDist = dist
                pressAct = { type: 'move', pieceId: p.id, to: m }
              }
            }
          }

          if (pressAct) {
            actions.push(pressAct)
            currentBoard = simulateAction(currentBoard, pressAct)
            continue
          }
        }

        // Cierre de seguridad si no hay más opciones válidas
        actions.push({ type: 'end_turn' })
        break
      }

      if (actions.length === 0) actions.push({ type: 'end_turn' })
      return actions
    } catch {
      return [{ type: 'end_turn' }]
    }
  }
}