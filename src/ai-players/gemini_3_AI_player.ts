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

function cloneState(state: BoardState): BoardState {
  return JSON.parse(JSON.stringify(state));
}

function isInsideArea(pos: Position, side: Side): boolean {
  const yMin = side === 'white' ? 0 : 10;
  const yMax = side === 'white' ? 1 : 11;
  return pos.x >= 2 && pos.x <= 6 && pos.y >= yMin && pos.y <= yMax;
}

function isOnLineBetween(from: Position, to: Position, check: Position): boolean {
  const dx = Math.sign(to.x - from.x);
  const dy = Math.sign(to.y - from.y);
  if (dx === 0 && dy === 0) return false;
  
  let cx = from.x + dx;
  let cy = from.y + dy;
  while (cx !== to.x || cy !== to.y) {
    if (cx === check.x && cy === check.y) return true;
    cx += dx;
    cy += dy;
  }
  return false;
}

function isDisplacementPossible(holderPos: Position, tacklerPos: Position, pieces: Piece[]): boolean {
  const directions = [{ x: 1, y: 0 }, { x: -1, y: 0 }, { x: 0, y: 1 }, { x: 0, y: -1 }];
  return directions.some(d => {
    const nx = holderPos.x + d.x;
    const ny = holderPos.y + d.y;
    if (nx < 0 || nx > 8 || ny < 0 || ny > 11) return false;
    if (nx === tacklerPos.x && ny === tacklerPos.y) return true; 
    return !pieces.some(p => p.pos.x === nx && p.pos.y === ny);
  });
}

function getValidMoves(piece: Piece, boardState: BoardState, aiSide: Side): Position[] {
  const valid: Position[] = [];
  const { pieces, ball } = boardState;
  
  const directions: { [key: string]: Position[] } = {
    king: [{ x: 1, y: 0 }, { x: -1, y: 0 }, { x: 0, y: 1 }, { x: 0, y: -1 }, { x: 1, y: 1 }, { x: -1, y: 1 }, { x: 1, y: -1 }, { x: -1, y: -1 }],
    queen: [{ x: 1, y: 0 }, { x: -1, y: 0 }, { x: 0, y: 1 }, { x: 0, y: -1 }, { x: 1, y: 1 }, { x: -1, y: 1 }, { x: 1, y: -1 }, { x: -1, y: -1 }],
    rook: [{ x: 1, y: 0 }, { x: -1, y: 0 }, { x: 0, y: 1 }, { x: 0, y: -1 }],
    bishop: [{ x: 1, y: 1 }, { x: -1, y: 1 }, { x: 1, y: -1 }, { x: -1, y: -1 }],
    knight: [{ x: 1, y: 2 }, { x: 1, y: -2 }, { x: -1, y: 2 }, { x: -1, y: -2 }, { x: 2, y: 1 }, { x: 2, y: -1 }, { x: -2, y: 1 }, { x: -2, y: -1 }]
  };

  const pDirs = directions[piece.type] || [];

  if (piece.type === 'knight') {
    for (const d of pDirs) {
      const nx = piece.pos.x + d.x;
      const ny = piece.pos.y + d.y;
      if (nx >= 0 && nx <= 8 && ny >= 0 && ny <= 11) {
        const dest: Position = { x: nx, y: ny };
        // Un caballo nunca puede pisar su propia área
        if (isInsideArea(dest, piece.side)) continue;

        const occupant = pieces.find(p => p.pos.x === nx && p.pos.y === ny);
        if (occupant) {
          if (occupant.side === piece.side) continue;
          if (occupant.type === 'king') continue;
          if (ball.holderId === occupant.id && isDisplacementPossible(occupant.pos, piece.pos, pieces)) {
            valid.push(dest);
          }
        } else {
          valid.push(dest);
        }
      }
    }
  } else {
    const isLinearInfinite = piece.type === 'queen' || piece.type === 'rook' || piece.type === 'bishop';
    for (const d of pDirs) {
      let step = 1;
      while (step < 12) {
        const nx = piece.pos.x + d.x * step;
        const ny = piece.pos.y + d.y * step;
        if (nx < 0 || nx > 8 || ny < 0 || ny > 11) break;
        
        const dest: Position = { x: nx, y: ny };
        if (piece.type === 'king' && !isInsideArea(dest, piece.side)) break;
        if (piece.type !== 'king' && isInsideArea(dest, piece.side)) {
          if (isLinearInfinite) { step++; continue; } else break;
        }

        const occupant = pieces.find(p => p.pos.x === nx && p.pos.y === ny);
        if (occupant) {
          if (occupant.side === piece.side) break;
          if (occupant.type === 'king') break;
          if (ball.holderId === occupant.id && isDisplacementPossible(occupant.pos, piece.pos, pieces)) {
            valid.push(dest);
          }
          break; 
        } else {
          valid.push(dest);
        }
        
        if (piece.type === 'king') break;
        step++;
      }
    }
  }
  return valid;
}

function getValidPasses(piece: Piece, boardState: BoardState): Position[] {
  const valid: Position[] = [];
  const { pieces, keeperBlockedId } = boardState;

  const patterns: { [key: string]: Position[] } = {
    king: [{ x: 1, y: 0 }, { x: -1, y: 0 }, { x: 0, y: 1 }, { x: 0, y: -1 }, { x: 1, y: 1 }, { x: -1, y: 1 }, { x: 1, y: -1 }, { x: -1, y: -1 }],
    queen: [{ x: 1, y: 0 }, { x: -1, y: 0 }, { x: 0, y: 1 }, { x: 0, y: -1 }, { x: 1, y: 1 }, { x: -1, y: 1 }, { x: 1, y: -1 }, { x: -1, y: -1 }],
    rook: [{ x: 1, y: 0 }, { x: -1, y: 0 }, { x: 0, y: 1 }, { x: 0, y: -1 }],
    bishop: [{ x: 1, y: 1 }, { x: -1, y: 1 }, { x: 1, y: -1 }, { x: -1, y: -1 }],
    knight: [{ x: 1, y: 2 }, { x: 1, y: -2 }, { x: -1, y: 2 }, { x: -1, y: -2 }, { x: 2, y: 1 }, { x: 2, y: -1 }, { x: -2, y: 1 }, { x: -2, y: -1 }]
  };

  const pDirs = patterns[piece.type] || [];
  const myKing = pieces.find(p => p.type === 'king' && p.side === piece.side);

  if (piece.type === 'knight' || piece.type === 'king') {
    for (const d of pDirs) {
      const nx = piece.pos.x + d.x;
      const ny = piece.pos.y + d.y;
      if (nx >= 0 && nx <= 8 && ny >= 0 && ny <= 11) {
        if (keeperBlockedId && myKing && myKing.pos.x === nx && myKing.pos.y === ny) continue;
        valid.push({ x: nx, y: ny });
      }
    }
  } else {
    for (const d of pDirs) {
      let step = 1;
      while (step < 12) {
        const nx = piece.pos.x + d.x * step;
        const ny = piece.pos.y + d.y * step;
        if (nx < 0 || nx > 8 || ny < 0 || ny > 11) break;
        if (keeperBlockedId && myKing && myKing.pos.x === nx && myKing.pos.y === ny) { step++; continue; }
        valid.push({ x: nx, y: ny });
        step++;
      }
    }
  }
  return valid;
}

function isPassSafe(from: Position, to: Position, boardState: BoardState, aiSide: Side): boolean {
  const { pieces, ball } = boardState;
  const holder = pieces.find(p => p.id === ball.holderId);
  if (!holder) return false;

  if (holder.type === 'knight') {
    const atDest = pieces.find(p => p.pos.x === to.x && p.pos.y === to.y);
    if (atDest && atDest.side !== aiSide && atDest.type !== 'king') return false;
    return true;
  }

  const dx = Math.sign(to.x - from.x);
  const dy = Math.sign(to.y - from.y);
  let cx = from.x + dx;
  let cy = from.y + dy;
  let steps = 0;

  while ((cx !== to.x || cy !== to.y) && steps < 20) {
    const pieceInPath = pieces.find(p => p.pos.x === cx && p.pos.y === cy);
    if (pieceInPath && pieceInPath.side !== aiSide) {
      return pieceInPath.type === 'king';
    }
    cx += dx;
    cy += dy;
    steps++;
  }

  const atDest = pieces.find(p => p.pos.x === to.x && p.pos.y === to.y);
  if (atDest && atDest.side !== aiSide && atDest.type !== 'king') return false;

  return true;
}

function isBallDestinationSafe(to: Position, boardState: BoardState, aiSide: Side): boolean {
  const opponentSide: Side = aiSide === 'white' ? 'black' : 'white';
  const teammateAtDest = boardState.pieces.find(p => p.pos.x === to.x && p.pos.y === to.y && p.side === aiSide);
  
  const simulatedBall = { pos: to, holderId: teammateAtDest ? teammateAtDest.id : null };
  const simulatedState = { ...boardState, ball: simulatedBall };

  const opponentPieces = boardState.pieces.filter(p => p.side === opponentSide && p.type !== 'king');
  for (const opp of opponentPieces) {
    const oppMoves = getValidMoves(opp, simulatedState, opp.side);
    if (oppMoves.some(m => m.x === to.x && m.y === to.y)) {
      return false;
    }
  }
  return true;
}

function endsInOffside(simState: BoardState, aiSide: Side): boolean {
  const holder = simState.pieces.find(p => p.id === simState.ball.holderId);
  if (!holder || holder.side !== aiSide || holder.type === 'king') return false;
  const enemyYMin = aiSide === 'white' ? 10 : 0;
  const enemyYMax = aiSide === 'white' ? 11 : 1;
  return holder.pos.x >= 2 && holder.pos.x <= 6 && holder.pos.y >= enemyYMin && holder.pos.y <= enemyYMax;
}

function findShotOnGoal(boardState: BoardState, aiSide: Side): { pieceId: string; to: Position } | null {
  const holder = boardState.pieces.find(p => p.id === boardState.ball.holderId);
  if (!holder || holder.side !== aiSide) return null;

  const rivalKing = boardState.pieces.find(p => p.type === 'king' && p.side !== aiSide);
  if (!rivalKing) return null;

  const passTargets = getValidPasses(holder, boardState);
  for (const target of passTargets) {
    if (target.x === rivalKing.pos.x && target.y === rivalKing.pos.y) {
      if (isPassSafe(holder.pos, target, boardState, aiSide)) {
        return { pieceId: holder.id, to: target };
      }
    }
    if (holder.type !== 'knight' && isOnLineBetween(holder.pos, target, rivalKing.pos)) {
      if (isPassSafe(holder.pos, target, boardState, aiSide)) {
        return { pieceId: holder.id, to: target };
      }
    }
  }
  return null;
}

function isKingUnderDirectThreat(boardState: BoardState, aiSide: Side): boolean {
  const myKing = boardState.pieces.find(p => p.type === 'king' && p.side === aiSide);
  if (!myKing) return false;

  const ballHolder = boardState.pieces.find(p => p.id === boardState.ball.holderId);
  if (!ballHolder || ballHolder.side === aiSide) return false;

  return isPassSafe(ballHolder.pos, myKing.pos, boardState, ballHolder.side);
}

function findIncomingShotSquares(boardState: BoardState, aiSide: Side): Position[] {
  const myKing = boardState.pieces.find(p => p.type === 'king' && p.side === aiSide);
  const ballHolder = boardState.pieces.find(p => p.id === boardState.ball.holderId);
  if (!myKing || !ballHolder || ballHolder.side === aiSide) return [];

  const threats: Position[] = [];
  for (const dest of getValidMoves(ballHolder, boardState, ballHolder.side)) {
    const simPieces = boardState.pieces.map(p => p.id === ballHolder.id ? { ...p, pos: dest } : p);
    const simState = { ...boardState, pieces: simPieces, ball: { pos: dest, holderId: ballHolder.id } };
    if (isPassSafe(dest, myKing.pos, simState, ballHolder.side)) {
      threats.push(dest);
    }
  }
  return threats;
}

function findDefensiveBlock(boardState: BoardState, aiSide: Side): { pieceId: string; to: Position } | null {
  const myKing = boardState.pieces.find(p => p.type === 'king' && p.side === aiSide);
  const ballHolder = boardState.pieces.find(p => p.id === boardState.ball.holderId);
  if (!myKing || !ballHolder || ballHolder.side === aiSide) return null;

  // Los pases de caballo no pueden bloquearse (saltan todo)
  if (ballHolder.type === 'knight') return null;

  // Solo hay carril que bloquear si portador y rey están alineados (fila/columna/diagonal)
  const adx = Math.abs(myKing.pos.x - ballHolder.pos.x);
  const ady = Math.abs(myKing.pos.y - ballHolder.pos.y);
  if (!(myKing.pos.x === ballHolder.pos.x || myKing.pos.y === ballHolder.pos.y || adx === ady)) return null;

  const dx = Math.sign(myKing.pos.x - ballHolder.pos.x);
  const dy = Math.sign(myKing.pos.y - ballHolder.pos.y);
  if (dx === 0 && dy === 0) return null;

  const path: Position[] = [];
  let cx = ballHolder.pos.x + dx;
  let cy = ballHolder.pos.y + dy;
  while ((cx !== myKing.pos.x || cy !== myKing.pos.y) && path.length < 20) {
    path.push({ x: cx, y: cy });
    cx += dx;
    cy += dy;
  }

  const myPieces = boardState.pieces.filter(p => p.side === aiSide && p.type !== 'king' && !p.hasMovedThisTurn);
  for (const blockSquare of path) {
    if (boardState.pieces.some(p => p.pos.x === blockSquare.x && p.pos.y === blockSquare.y)) continue;
    for (const myPiece of myPieces) {
      const validMoves = getValidMoves(myPiece, boardState, myPiece.side);
      if (validMoves.some(m => m.x === blockSquare.x && m.y === blockSquare.y)) {
        return { pieceId: myPiece.id, to: blockSquare };
      }
    }
  }
  return null;
}

function findBestTackle(boardState: BoardState, aiSide: Side): { pieceId: string; to: Position } | null {
  const ballHolder = boardState.pieces.find(p => p.id === boardState.ball.holderId);
  if (!ballHolder || ballHolder.side === aiSide || ballHolder.type === 'king') return null;

  const opponentKingY = aiSide === 'white' ? 10 : 1;
  const candidates: Array<{ pieceId: string; to: Position; dist: number }> = [];

  const myPieces = boardState.pieces.filter(p => p.side === aiSide && p.type !== 'king' && !p.hasMovedThisTurn);
  for (const myPiece of myPieces) {
    const validMoves = getValidMoves(myPiece, boardState, myPiece.side);
    if (validMoves.some(m => m.x === ballHolder.pos.x && m.y === ballHolder.pos.y)) {
      const dist = Math.abs(myPiece.pos.y - opponentKingY);
      candidates.push({ pieceId: myPiece.id, to: ballHolder.pos, dist });
    }
  }

  if (candidates.length === 0) return null;
  candidates.sort((a, b) => a.dist - b.dist);
  return { pieceId: candidates[0].pieceId, to: candidates[0].to };
}

function findLooseBallCapture(boardState: BoardState, aiSide: Side): { pieceId: string; to: Position } | null {
  if (boardState.ball.holderId !== null) return null;
  const ballPos = boardState.ball.pos;

  const myPieces = boardState.pieces.filter(p => p.side === aiSide && p.type !== 'king' && !p.hasMovedThisTurn);
  for (const piece of myPieces) {
    for (const dest of getValidMoves(piece, boardState, piece.side)) {
      if (piece.type === 'knight') {
        if (dest.x === ballPos.x && dest.y === ballPos.y) {
          return { pieceId: piece.id, to: dest };
        }
      } else if (isOnLineBetween(piece.pos, dest, ballPos) || (dest.x === ballPos.x && dest.y === ballPos.y)) {
        return { pieceId: piece.id, to: dest };
      }
    }
  }
  return null;
}

// ============================================
// Funciones de simulación incremental
// ============================================

function applySimMove(state: BoardState, pieceId: string, to: Position): void {
  const piece = state.pieces.find(p => p.id === pieceId);
  if (!piece) return;

  const oldPos = { ...piece.pos };
  piece.pos = { ...to };
  piece.hasMovedThisTurn = true;

  // Si era tackle
  const rival = state.pieces.find(p => p.pos.x === to.x && p.pos.y === to.y && p.id !== pieceId);
  if (rival && state.ball.holderId === rival.id) {
    state.ball.holderId = piece.id;
    state.ball.pos = { ...to };
    // Desplazar rival a la primera ortogonal libre simulada
    const dirs = [{x:1,y:0}, {x:-1,y:0}, {x:0,y:1}, {x:0,y:-1}];
    for (const d of dirs) {
      const rx = to.x + d.x;
      const ry = to.y + d.y;
      if (rx >= 0 && rx <= 8 && ry >= 0 && ry <= 11 && !(rx === oldPos.x && ry === oldPos.y)) {
        if (!state.pieces.some(p => p.pos.x === rx && p.pos.y === ry)) {
          rival.pos = { x: rx, y: ry };
          break;
        }
      }
    }
    return;
  }

  // Si conducía balón
  if (state.ball.holderId === pieceId) {
    state.ball.pos = { ...to };
  } 
  // Si captura balón suelto en trayectoria o destino
  else if (state.ball.holderId === null) {
    if (piece.type === 'knight') {
      if (to.x === state.ball.pos.x && to.y === state.ball.pos.y) {
        state.ball.holderId = piece.id;
      }
    } else {
      if (isOnLineBetween(oldPos, to, state.ball.pos) || (to.x === state.ball.pos.x && to.y === state.ball.pos.y)) {
        state.ball.holderId = piece.id;
        state.ball.pos = { ...to };
      }
    }
  }
}

function applySimPass(state: BoardState, pieceId: string, to: Position, aiSide: Side): void {
  const piece = state.pieces.find(p => p.id === pieceId);
  if (!piece) return;

  if (piece.type === 'king') {
    state.keeperBlockedId = piece.id;
    if (state.kingMustRelease === aiSide) {
      state.kingMustRelease = undefined;
    }
  }

  // Intercepción lineal en ruta
  if (piece.type !== 'knight') {
    const dx = Math.sign(to.x - piece.pos.x);
    const dy = Math.sign(to.y - piece.pos.y);
    let cx = piece.pos.x + dx;
    let cy = piece.pos.y + dy;
    while (cx !== to.x || cy !== to.y) {
      const opp = state.pieces.find(p => p.pos.x === cx && p.pos.y === cy && p.side !== aiSide);
      if (opp) {
        if (opp.type === 'king') {
          // GOL simulado
          state.ball.holderId = opp.id;
          state.ball.pos = { ...opp.pos };
          state.actionPoints = 0;
          return;
        } else {
          // Intercepción
          state.ball.holderId = opp.id;
          state.ball.pos = { ...opp.pos };
          state.actionPoints = 0;
          return;
        }
      }
      cx += dx;
      cy += dy;
    }
  }

  // Destino
  const targetPiece = state.pieces.find(p => p.pos.x === to.x && p.pos.y === to.y);
  if (targetPiece) {
    state.ball.holderId = targetPiece.id;
    state.ball.pos = { ...to };
    if (targetPiece.side !== aiSide) {
      state.actionPoints = 0; // Si es rival, corta AP
    }
  } else {
    state.ball.holderId = null;
    state.ball.pos = { ...to };
  }
}

// ============================================
// Export del jugador IA
// ============================================

export const aiPlayer: AIPlayerScript = {
  name: "MagoTáctico AI",
  description: "Estratega de pases de alta precisión que domina las transiciones mediante desmarques rápidos de caballos y anticipación de amenazas contra el rey.",
  avatar: "🧙‍♂️",
  difficulty: "advanced",
  badgeName: "Desmitificador del Mago",
  badgeIcon: "target",
  play: (boardState: BoardState, aiSide: Side): AIAction[] => {
    try {
      const actions: AIAction[] = [];
      let simState = cloneState(boardState);
      let budget = simState.actionPoints;

      while (budget > 0) {
        // PRIORIDAD 0: Obligación de liberar el balón con el Rey
        if (simState.kingMustRelease === aiSide) {
          const myKing = simState.pieces.find(p => p.type === 'king' && p.side === aiSide);
          if (myKing && simState.ball.holderId === myKing.id) {
            const passes = getValidPasses(myKing, simState);
            let fallbackPass: Position | null = null;
            let foundSafe = false;
            
            for (const p of passes) {
              const teammate = simState.pieces.find(pt => pt.pos.x === p.x && pt.pos.y === p.y && pt.side === aiSide);
              if (teammate && isPassSafe(myKing.pos, p, simState, aiSide) && isBallDestinationSafe(p, simState, aiSide)) {
                actions.push({ type: 'pass', pieceId: myKing.id, to: p });
                applySimPass(simState, myKing.id, p, aiSide);
                foundSafe = true;
                break;
              }
              if (!teammate && isPassSafe(myKing.pos, p, simState, aiSide) && isBallDestinationSafe(p, simState, aiSide)) {
                fallbackPass = p;
              }
            }
            if (!foundSafe && fallbackPass) {
              actions.push({ type: 'pass', pieceId: myKing.id, to: fallbackPass });
              applySimPass(simState, myKing.id, fallbackPass, aiSide);
              foundSafe = true;
            }
            if (!foundSafe && passes.length > 0) {
              actions.push({ type: 'pass', pieceId: myKing.id, to: passes[0] });
              applySimPass(simState, myKing.id, passes[0], aiSide);
            }
            budget--;
            simState.actionPoints = budget;
            continue;
          }
        }

        // PRIORIDAD 1: Oportunidad de Gol inmediata
        const shot = findShotOnGoal(simState, aiSide);
        if (shot) {
          actions.push({ type: 'pass', pieceId: shot.pieceId, to: shot.to });
          applySimPass(simState, shot.pieceId, shot.to, aiSide);
          break; 
        }

        // PRIORIDAD 2: Balón suelto (Carrera por el esférico)
        if (simState.ball.holderId === null) {
          const capture = findLooseBallCapture(simState, aiSide);
          if (capture) {
            actions.push({ type: 'move', pieceId: capture.pieceId, to: capture.to });
            applySimMove(simState, capture.pieceId, capture.to);
            budget--;
            simState.actionPoints = budget;
            continue;
          }
        }

        // PRIORIDAD 3: Defensa de Emergencia (Amenazas al Rey)
        const directThreat = isKingUnderDirectThreat(simState, aiSide);
        const incomingSquares = findIncomingShotSquares(simState, aiSide);
        if (directThreat || incomingSquares.length > 0) {
          const tackle = findBestTackle(simState, aiSide);
          if (tackle) {
            actions.push({ type: 'move', pieceId: tackle.pieceId, to: tackle.to });
            applySimMove(simState, tackle.pieceId, tackle.to);
            budget--;
            simState.actionPoints = budget;
            continue;
          }
          const block = findDefensiveBlock(simState, aiSide);
          if (block) {
            actions.push({ type: 'move', pieceId: block.pieceId, to: block.to });
            applySimMove(simState, block.pieceId, block.to);
            budget--;
            simState.actionPoints = budget;
            continue;
          }
          // Si no se puede placar ni bloquear, mover el rey defensivamente
          const myKing = simState.pieces.find(p => p.type === 'king' && p.side === aiSide);
          if (myKing && !myKing.hasMovedThisTurn) {
            const kingMoves = getValidMoves(myKing, simState, aiSide);
            if (kingMoves.length > 0) {
              actions.push({ type: 'move', pieceId: myKing.id, to: kingMoves[0] });
              applySimMove(simState, myKing.id, kingMoves[0]);
              budget--;
              simState.actionPoints = budget;
              continue;
            }
          }
        }

        // PRIORIDAD 4: Gestión de la Posesión y Progresión de ataque
        const holder = simState.pieces.find(p => p.id === simState.ball.holderId);
        if (holder && holder.side === aiSide) {
          // Si estamos conduciendo y podemos avanzar hacia campo rival de forma segura
          if (!holder.hasMovedThisTurn) {
            const moves = getValidMoves(holder, simState, aiSide);
            let bestMove: Position | null = null;
            let bestY = holder.pos.y;
            
            for (const m of moves) {
              const isProgression = aiSide === 'white' ? m.y > bestY : m.y < bestY;
              if (isProgression) {
                // Evitar caer en fuera de juego preventivamente si no se puede chutar
                const nextState = cloneState(simState);
                applySimMove(nextState, holder.id, m);
                if (!endsInOffside(nextState, aiSide)) {
                  bestMove = m;
                  bestY = m.y;
                }
              }
            }
            if (bestMove) {
              actions.push({ type: 'move', pieceId: holder.id, to: bestMove });
              applySimMove(simState, holder.id, bestMove);
              budget--;
              simState.actionPoints = budget;
              continue;
            }
          }

          // Si mover no es opción, buscar pase adelantado seguro (priorizando Caballos atacantes)
          const passes = getValidPasses(holder, simState);
          let advancedPass: Position | null = null;
          let bestPassY = holder.pos.y;

          for (const p of passes) {
            const targetTeammate = simState.pieces.find(pt => pt.pos.x === p.x && pt.pos.y === p.y && pt.side === aiSide);
            const isProgression = aiSide === 'white' ? p.y > bestPassY : p.y < bestPassY;
            
            if (isProgression && isPassSafe(holder.pos, p, simState, aiSide) && isBallDestinationSafe(p, simState, aiSide)) {
              // Chequear que no deje en fuera de juego al receptor
              const nextState = cloneState(simState);
              applySimPass(nextState, holder.id, p, aiSide);
              if (!endsInOffside(nextState, aiSide)) {
                if (targetTeammate && targetTeammate.type === 'knight') {
                  advancedPass = p;
                  break; // Los pases a caballos son óptimos
                }
                advancedPass = p;
                bestPassY = p.y;
              }
            }
          }

          if (advancedPass) {
            actions.push({ type: 'pass', pieceId: holder.id, to: advancedPass });
            applySimPass(simState, holder.id, advancedPass, aiSide);
            budget--;
            simState.actionPoints = budget;
            continue;
          }
        } else {
          // Si no tenemos el balón, intentar robarlo vía tackle proactivo
          const tackle = findBestTackle(simState, aiSide);
          if (tackle) {
            actions.push({ type: 'move', pieceId: tackle.pieceId, to: tackle.to });
            applySimMove(simState, tackle.pieceId, tackle.to);
            budget--;
            simState.actionPoints = budget;
            continue;
          }
        }

        // PRIORIDAD 5: Reposicionamiento táctico general (Gastar AP sobrante)
        const activePieces = simState.pieces.filter(p => p.side === aiSide && p.type !== 'king' && !p.hasMovedThisTurn);
        let movedAny = false;
        
        for (const piece of activePieces) {
          const moves = getValidMoves(piece, simState, aiSide);
          if (moves.length > 0) {
            // Adelantar piezas defensivas o de soporte
            let targetMove = moves[0];
            for (const m of moves) {
              const isBetter = aiSide === 'white' ? m.y > targetMove.y : m.y < targetMove.y;
              if (isBetter) targetMove = m;
            }
            actions.push({ type: 'move', pieceId: piece.id, to: targetMove });
            applySimMove(simState, piece.id, targetMove);
            movedAny = true;
            break;
          }
        }

        if (!movedAny) {
          actions.push({ type: 'end_turn' });
          break;
        }

        budget--;
        simState.actionPoints = budget;
      }

      if (actions.length === 0) actions.push({ type: 'end_turn' });
      return actions;
    } catch {
      return [{ type: 'end_turn' }];
    }
  }
};
