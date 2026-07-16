import { BoardState, Side, Position, Piece } from '../types/game';
import { AIAction, AIPlayerScript } from '../types/ai-player';

// ============================================================================
// Funciones Auxiliares de Utilidad y Tablero
// ============================================================================

/**
 * Genera un hash numérico estable a partir del estado del tablero para sembrar el PRNG.
 */
function hashBoard(boardState: BoardState): number {
  let hash = 0;
  for (const p of boardState.pieces) {
    hash += p.pos.x * 17 + p.pos.y * 31 + (p.side === 'white' ? 1 : 2) * 101;
    if (p.hasMovedThisTurn) hash += 500;
  }
  hash += boardState.ball.pos.x * 13 + boardState.ball.pos.y * 23;
  if (boardState.ball.holderId) {
    hash += boardState.ball.holderId.length * 7;
  }
  hash += boardState.actionPoints * 1003 + (boardState.turn === 'white' ? 1 : 2) * 57;
  hash += boardState.score.white * 10007 + boardState.score.black * 40009;
  return Math.abs(hash) | 0;
}

/**
 * Generador de números pseudoaleatorios sembrado (Algoritmo Mulberry32).
 */
function mulberry32(seed: number): () => number {
  return function() {
    let t = seed += 0x6D2B79F5;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Copia profundamente el estado del tablero para realizar la simulación incremental.
 */
function cloneBoardState(boardState: BoardState): BoardState {
  return {
    pieces: boardState.pieces.map(p => ({
      id: p.id,
      type: p.type,
      side: p.side,
      pos: { x: p.pos.x, y: p.pos.y },
      hasMovedThisTurn: p.hasMovedThisTurn
    })),
    ball: {
      pos: { x: boardState.ball.pos.x, y: boardState.ball.pos.y },
      holderId: boardState.ball.holderId
    },
    score: { white: boardState.score.white, black: boardState.score.black },
    actionPoints: boardState.actionPoints,
    maxActionPoints: boardState.maxActionPoints,
    turn: boardState.turn,
    keeperBlockedId: boardState.keeperBlockedId,
    lastMove: boardState.lastMove ? { ...boardState.lastMove } : undefined,
    moveHistory: boardState.moveHistory,
    turnNumber: boardState.turnNumber
  };
}

/**
 * Verifica si un punto se encuentra en la línea recta (ortogonal o diagonal) entre start y end.
 */
function isOnLineBetween(start: Position, end: Position, point: Position): boolean {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  if (dx === 0 && dy === 0) return start.x === point.x && start.y === point.y;

  const pdx = point.x - start.x;
  const pdy = point.y - start.y;

  // Comprobación de colinealidad usando producto cruzado
  if (dx * pdy !== dy * pdx) return false;

  // Comprobación de límites (bounding box)
  const minX = Math.min(start.x, end.x);
  const maxX = Math.max(start.x, end.x);
  const minY = Math.min(start.y, end.y);
  const maxY = Math.max(start.y, end.y);

  return point.x >= minX && point.x <= maxX && point.y >= minY && point.y <= maxY;
}

/**
 * Determina si un portador de balón puede ser desplazado ortogonalmente tras un tackle.
 */
function canDisplace(holderPos: Position, tacklerPos: Position, boardState: BoardState): boolean {
  const dirs = [
    { x: 1, y: 0 },  // Derecha
    { x: -1, y: 0 }, // Izquierda
    { x: 0, y: 1 },  // Arriba
    { x: 0, y: -1 }  // Abajo
  ];
  for (const d of dirs) {
    const nx = holderPos.x + d.x;
    const ny = holderPos.y + d.y;
    if (nx >= 0 && nx <= 8 && ny >= 0 && ny <= 11) {
      const p = boardState.pieces.find(piece => piece.pos.x === nx && piece.pos.y === ny);
      // La casilla está libre o es la casilla que el tacleador va a vaciar
      if (!p || (p.pos.x === tacklerPos.x && p.pos.y === tacklerPos.y)) {
        return true;
      }
    }
  }
  return false;
}

/**
 * Obtiene la casilla exacta de desplazamiento determinista para el rival tacleado.
 */
function getDisplacementPosition(holderPos: Position, tacklerPos: Position, boardState: BoardState): Position | null {
  const dirs = [
    { x: 1, y: 0 },  // Derecha
    { x: -1, y: 0 }, // Izquierda
    { x: 0, y: 1 },  // Arriba
    { x: 0, y: -1 }  // Abajo
  ];
  for (const d of dirs) {
    const nx = holderPos.x + d.x;
    const ny = holderPos.y + d.y;
    if (nx >= 0 && nx <= 8 && ny >= 0 && ny <= 11) {
      const p = boardState.pieces.find(piece => piece.pos.x === nx && piece.pos.y === ny);
      if (!p || (p.pos.x === tacklerPos.x && p.pos.y === tacklerPos.y)) {
        return { x: nx, y: ny };
      }
    }
  }
  return null;
}

// ============================================================================
// Reglas de Movimiento y Pases (Secciones 4 y 4b)
// ============================================================================

function getValidMoves(piece: Piece, boardState: BoardState, pieceSide: Side): Position[] {
  const moves: Position[] = [];
  const { x, y } = piece.pos;

  const isInsideArea = (p: Position, side: Side) => {
    const yMin = side === 'white' ? 0 : 10;
    const yMax = side === 'white' ? 1 : 11;
    return p.x >= 2 && p.x <= 6 && p.y >= yMin && p.y <= yMax;
  };

  const isValidTarget = (p: Position) => {
    if (p.x < 0 || p.x > 8 || p.y < 0 || p.y > 11) return false;

    // Restricciones de áreas (Sección 3 / 7)
    if (piece.type === 'king') {
      if (!isInsideArea(p, pieceSide)) return false;
    } else {
      if (isInsideArea(p, pieceSide)) return false;
    }

    const targetPiece = boardState.pieces.find(pStr => pStr.pos.x === p.x && pStr.pos.y === p.y);
    if (targetPiece) {
      if (targetPiece.side === pieceSide) return false; // Compañero bloquea
      if (targetPiece.type === 'king') return false;     // Rey rival intocable por movimiento

      // Solo se puede mover a casilla enemiga si tiene el balón (Tackle)
      if (boardState.ball.holderId !== targetPiece.id) return false;

      // Verificar si el tackle es viable por espacio de desplazamiento
      if (!canDisplace(targetPiece.pos, piece.pos, boardState)) return false;
    }
    return true;
  };

  if (piece.type === 'king' || piece.type === 'queen' || piece.type === 'rook' || piece.type === 'bishop') {
    const dirs: [number, number][] = [];
    if (piece.type === 'king' || piece.type === 'queen' || piece.type === 'rook') {
      dirs.push([1, 0], [-1, 0], [0, 1], [0, -1]);
    }
    if (piece.type === 'king' || piece.type === 'queen' || piece.type === 'bishop') {
      dirs.push([1, 1], [1, -1], [-1, 1], [-1, -1]);
    }

    const maxSteps = piece.type === 'king' ? 1 : 12;

    for (const [dx, dy] of dirs) {
      for (let step = 1; step <= maxSteps; step++) {
        const nx = x + dx * step;
        const ny = y + dy * step;
        const np = { x: nx, y: ny };

        if (nx < 0 || nx > 8 || ny < 0 || ny > 11) break;

        const blockingPiece = boardState.pieces.find(pStr => pStr.pos.x === nx && pStr.pos.y === ny);

        if (isValidTarget(np)) {
          moves.push(np);
        }

        if (blockingPiece) {
          // Las piezas lineales se bloquean ante cualquier pieza en el camino
          break;
        }
      }
    }
  } else if (piece.type === 'knight') {
    const knightOffsets = [
      [2, 1], [2, -1], [-2, 1], [-2, -1],
      [1, 2], [1, -2], [-1, 2], [-1, -2]
    ];
    for (const [dx, dy] of knightOffsets) {
      const np = { x: x + dx, y: y + dy };
      if (isValidTarget(np)) {
        moves.push(np);
      }
    }
  }

  return moves;
}

function getValidPasses(piece: Piece, boardState: BoardState): Position[] {
  const passes: Position[] = [];
  const { x, y } = piece.pos;

  const myKing = boardState.pieces.find(p => p.type === 'king' && p.side === piece.side);
  const isKeeperBlocked = boardState.keeperBlockedId === myKing?.id;

  const isValidPassTarget = (p: Position) => {
    if (p.x < 0 || p.x > 8 || p.y < 0 || p.y > 11) return false;
    // Regla de pase atrás del portero bloqueado (Sección 7b)
    if (isKeeperBlocked && myKing && p.x === myKing.pos.x && p.y === myKing.pos.y) {
      return false;
    }
    return true;
  };

  if (piece.type === 'king' || piece.type === 'queen' || piece.type === 'rook' || piece.type === 'bishop') {
    const dirs: [number, number][] = [];
    if (piece.type === 'king' || piece.type === 'queen' || piece.type === 'rook') {
      dirs.push([1, 0], [-1, 0], [0, 1], [0, -1]);
    }
    if (piece.type === 'king' || piece.type === 'queen' || piece.type === 'bishop') {
      dirs.push([1, 1], [1, -1], [-1, 1], [-1, -1]);
    }

    const maxSteps = piece.type === 'king' ? 1 : 12;

    for (const [dx, dy] of dirs) {
      for (let step = 1; step <= maxSteps; step++) {
        const nx = x + dx * step;
        const ny = y + dy * step;
        const np = { x: nx, y: ny };

        if (nx < 0 || nx > 8 || ny < 0 || ny > 11) break;

        if (isValidPassTarget(np)) {
          passes.push(np);
        }
      }
    }
  } else if (piece.type === 'knight') {
    const knightOffsets = [
      [2, 1], [2, -1], [-2, 1], [-2, -1],
      [1, 2], [1, -2], [-1, 2], [-1, -2]
    ];
    for (const [dx, dy] of knightOffsets) {
      const np = { x: x + dx, y: y + dy };
      if (isValidPassTarget(np)) {
        passes.push(np);
      }
    }
  }

  return passes;
}

// ============================================================================
// Verificaciones Críticas de Seguridad (Secciones 5, 5b y 5c)
// ============================================================================

function isPassSafe(from: Position, to: Position, boardState: BoardState, aiSide: Side): boolean {
  const holder = boardState.pieces.find(p => p.id === boardState.ball.holderId);
  if (!holder) return false;

  // 1. Caballos inmunes a intercepción en trayectoria
  if (holder.type === 'knight') {
    const atDest = boardState.pieces.find(p => p.pos.x === to.x && p.pos.y === to.y);
    if (atDest && atDest.side !== aiSide && atDest.type !== 'king') return false;
    return true;
  }

  // 2. Piezas lineales: recorrer trayectoria casilla a casilla
  const dx = Math.sign(to.x - from.x);
  const dy = Math.sign(to.y - from.y);
  let cx = from.x + dx;
  let cy = from.y + dy;
  let steps = 0;

  while ((cx !== to.x || cy !== to.y) && steps < 20) {
    const pieceInPath = boardState.pieces.find(p => p.pos.x === cx && p.pos.y === cy);
    if (pieceInPath && pieceInPath.side !== aiSide) {
      // Si el primer rival en la trayectoria es el rey, cuenta como carril de GOL válido
      return pieceInPath.type === 'king';
    }
    cx += dx;
    cy += dy;
    steps++;
  }

  // 3. Verificar destino final
  const atDest = boardState.pieces.find(p => p.pos.x === to.x && p.pos.y === to.y);
  if (atDest && atDest.side !== aiSide && atDest.type !== 'king') return false;

  return true;
}

function isBallDestinationSafe(to: Position, boardState: BoardState, aiSide: Side): boolean {
  const opponentSide: Side = aiSide === 'white' ? 'black' : 'white';

  const teammateAtDest = boardState.pieces.find(
    p => p.pos.x === to.x && p.pos.y === to.y && p.side === aiSide
  );
  const simulatedBall = { pos: to, holderId: teammateAtDest ? teammateAtDest.id : null };
  const simulatedState = { ...boardState, ball: simulatedBall };

  const opponentPieces = boardState.pieces.filter(
    p => p.side === opponentSide && p.type !== 'king'
  );
  for (const opp of opponentPieces) {
    const oppMoves = getValidMoves(opp, simulatedState, opp.side);
    if (oppMoves.some(m => m.x === to.x && m.y === to.y)) {
      return false; // El rival puede alcanzar o taclear el destino
    }
  }
  return true;
}

function isOffsideState(state: BoardState, aiSide: Side): boolean {
  const holderId = state.ball.holderId;
  if (!holderId) return false;
  const holder = state.pieces.find(p => p.id === holderId);
  if (!holder || holder.side !== aiSide || holder.type === 'king') return false;

  const enemyYMin = aiSide === 'white' ? 10 : 0;
  const enemyYMax = aiSide === 'white' ? 11 : 1;
  return holder.pos.x >= 2 && holder.pos.x <= 6 &&
         holder.pos.y >= enemyYMin && holder.pos.y <= enemyYMax;
}

// ============================================================================
// Detección de Oportunidades y Amenazas Defensivas (Sección 6, 6b, 6c)
// ============================================================================

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
    if (holder.type !== 'knight') {
      if (isOnLineBetween(holder.pos, target, rivalKing.pos)) {
        if (isPassSafe(holder.pos, target, boardState, aiSide)) {
          return { pieceId: holder.id, to: target };
        }
      }
    }
  }
  return null;
}

function isKingUnderDirectThreat(boardState: BoardState, aiSide: Side): boolean {
  const myKing = boardState.pieces.find(p => p.type === 'king' && p.side === aiSide);
  if (!myKing) return false;
  const rivalSide = aiSide === 'white' ? 'black' : 'white';
  const ballHolder = boardState.pieces.find(p => p.id === boardState.ball.holderId);

  if (ballHolder && ballHolder.side === rivalSide) {
    const passes = getValidPasses(ballHolder, boardState);
    for (const tgt of passes) {
      if (tgt.x === myKing.pos.x && tgt.y === myKing.pos.y) {
        if (isPassSafe(ballHolder.pos, tgt, boardState, rivalSide)) return true;
      }
      if (ballHolder.type !== 'knight' && isOnLineBetween(ballHolder.pos, tgt, myKing.pos)) {
        if (isPassSafe(ballHolder.pos, tgt, boardState, rivalSide)) return true;
      }
    }
  }
  return false;
}

// ============================================================================
// Simulación Incremental de Acciones (Sección 2b)
// ============================================================================

function simulateAction(boardState: BoardState, action: AIAction, aiSide: Side): BoardState {
  const nextState = cloneBoardState(boardState);
  nextState.actionPoints -= 1;

  if (action.type === 'end_turn') {
    nextState.actionPoints = 0;
    return nextState;
  }

  const piece = nextState.pieces.find(p => p.id === action.pieceId);
  if (!piece) return nextState;
  const to = action.to!;

  if (action.type === 'move') {
    const fromPos = { x: piece.pos.x, y: piece.pos.y };
    piece.pos = { x: to.x, y: to.y };
    piece.hasMovedThisTurn = true;

    const rivalPiece = nextState.pieces.find(p => p.pos.x === to.x && p.pos.y === to.y && p.id !== piece.id);
    if (rivalPiece && nextState.ball.holderId === rivalPiece.id) {
      // Resolución de Tackle con desplazamiento determinista
      const dispPos = getDisplacementPosition(rivalPiece.pos, fromPos, boardState);
      if (dispPos) rivalPiece.pos = dispPos;
      nextState.ball.holderId = piece.id;
      nextState.ball.pos = { x: to.x, y: to.y };
      nextState.keeperBlockedId = undefined;
    } else {
      // Movimiento o conducción ordinaria
      if (nextState.ball.holderId === piece.id) {
        nextState.ball.pos = { x: to.x, y: to.y };
      } else if (nextState.ball.holderId === null) {
        // Captura en trayectoria (balón suelto)
        if (piece.type === 'knight') {
          if (to.x === nextState.ball.pos.x && to.y === nextState.ball.pos.y) {
            nextState.ball.holderId = piece.id;
          }
        } else {
          if (isOnLineBetween(fromPos, to, nextState.ball.pos)) {
            nextState.ball.holderId = piece.id;
            nextState.ball.pos = { x: to.x, y: to.y };
          }
        }
      }
    }
  } else if (action.type === 'pass') {
    if (piece.type === 'king') {
      nextState.keeperBlockedId = piece.id;
    }

    if (piece.type === 'knight') {
      const targetPiece = nextState.pieces.find(p => p.pos.x === to.x && p.pos.y === to.y);
      if (targetPiece) {
        nextState.ball.holderId = targetPiece.id;
        nextState.ball.pos = { x: to.x, y: to.y };
        if (targetPiece.side !== aiSide) {
          nextState.actionPoints = 0; // Intercepción enemiga forzaría fin de turno
        }
      } else {
        nextState.ball.holderId = null;
        nextState.ball.pos = { x: to.x, y: to.y };
      }
    } else {
      const dx = Math.sign(to.x - piece.pos.x);
      const dy = Math.sign(to.y - piece.pos.y);
      let cx = piece.pos.x + dx;
      let cy = piece.pos.y + dy;
      let intercepted = false;
      let steps = 0;

      while ((cx !== to.x || cy !== to.y) && steps < 20) {
        const pInPath = nextState.pieces.find(p => p.pos.x === cx && p.pos.y === cy);
        if (pInPath && pInPath.side !== aiSide) {
          nextState.ball.holderId = pInPath.id;
          nextState.ball.pos = { x: cx, y: cy };
          nextState.actionPoints = 0;
          intercepted = true;
          break;
        }
        cx += dx;
        cy += dy;
        steps++;
      }

      if (!intercepted) {
        const targetPiece = nextState.pieces.find(p => p.pos.x === to.x && p.pos.y === to.y);
        if (targetPiece) {
          nextState.ball.holderId = targetPiece.id;
          nextState.ball.pos = { x: to.x, y: to.y };
          if (targetPiece.side !== aiSide) nextState.actionPoints = 0;
        } else {
          nextState.ball.holderId = null;
          nextState.ball.pos = { x: to.x, y: to.y };
        }
      }
    }
  }

  return nextState;
}

// ============================================================================
// Heurística de Evaluación Estratégica (Sección 8 y 8c)
// ============================================================================

function evaluateBoard(boardState: BoardState, aiSide: Side): number {
  let score = 0;
  const rivalSide = aiSide === 'white' ? 'black' : 'white';

  // 1. Evaluación de Posesión de Balón
  const holderId = boardState.ball.holderId;
  if (holderId !== null) {
    const holder = boardState.pieces.find(p => p.id === holderId);
    if (holder) {
      if (holder.side === aiSide) {
        score += 600;
        if (holder.type === 'knight') score += 150; // Plus para delanteros
      } else {
        score -= 600;
      }
    }
  } else {
    // Balón suelto: premiar la cercanía de nuestras piezas reactivas
    const ballPos = boardState.ball.pos;
    let minMyDist = 99;
    let minRivalDist = 99;
    for (const p of boardState.pieces) {
      const dist = Math.abs(p.pos.x - ballPos.x) + Math.abs(p.pos.y - ballPos.y);
      if (p.side === aiSide) {
        if (p.type !== 'king' && dist < minMyDist) minMyDist = dist;
      } else {
        if (p.type !== 'king' && dist < minRivalDist) minRivalDist = dist;
      }
    }
    score += (minRivalDist - minMyDist) * 35;
  }

  // 2. Progresión territorial del balón hacia el fondo rival
  const ballY = boardState.ball.pos.y;
  score += (aiSide === 'white' ? ballY : 11 - ballY) * 70;

  // 3. Posicionamiento del bloque táctico (Avanzar todo el equipo cooperativamente)
  for (const p of boardState.pieces) {
    if (p.type === 'king') continue;
    const pY = p.pos.y;
    if (p.side === aiSide) {
      const adv = aiSide === 'white' ? pY : 11 - pY;
      score += adv * 12;
    } else {
      const adv = rivalSide === 'white' ? pY : 11 - pY;
      score -= adv * 10;
    }
  }

  // 4. Defensa de Emergencia del Rey Propio
  if (isKingUnderDirectThreat(boardState, aiSide)) {
    score -= 3500;
  }

  // 5. Presión Ofensiva Directa sobre el Rey Rival (Prepara combos para el próximo turno)
  if (isKingUnderDirectThreat(boardState, rivalSide)) {
    score += 1800;
  }

  return score;
}

// ============================================================================
// Implementación Principal del Objeto AIPlayer
// ============================================================================

export const aiPlayer: AIPlayerScript = {
  name: "Gemini Expert",
  description: "Un estratega de alta fuerza que calcula pases milimétricos, encadena combos fluidos y neutraliza amenazas de inmediato.",
  avatar: "🧠",
  difficulty: "expert",
  badgeName: "Verdugo de Gemini",
  badgeIcon: "brain",

  play: (boardState: BoardState, aiSide: Side): AIAction[] => {
    try {
      const planActions: AIAction[] = [];
      let currentSimState = cloneBoardState(boardState);

      // Inicialización del motor pseudoaleatorio determinista basado en el tablero
      const seed = hashBoard(boardState);
      const nextRandom = mulberry32(seed);

      // Bucle de planificación controlado por los Action Points disponibles (máximo 108 iteraciones de seguridad)
      let iterations = 0;
      while (currentSimState.actionPoints > 0 && iterations < 108) {
        iterations++;

        // PRIORIDAD 1: Buscar tiro inmediato o combo definitivo de gol directo
        const immediateShot = findShotOnGoal(currentSimState, aiSide);
        if (immediateShot) {
          planActions.push({ type: 'pass', pieceId: immediateShot.pieceId, to: immediateShot.to });
          break; // Marcar gol consume el resto de AP y finaliza el turno inmediatamente
        }

        // PRIORIDAD 2: Recopilación y simulación incremental de alternativas válidas
        const candidates: { action: AIAction; score: number }[] = [];

        // Acción base opcional de retención / finalización voluntaria segura
        candidates.push({
          action: { type: 'end_turn' },
          score: evaluateBoard(currentSimState, aiSide) - 15
        });

        const myPieces = currentSimState.pieces.filter(p => p.side === aiSide);

        // Generación de todos los movimientos posibles (incluye capturas sueltas y tackles viables)
        for (const piece of myPieces) {
          if (!piece.hasMovedThisTurn) {
            const validMoves = getValidMoves(piece, currentSimState, aiSide);
            for (const targetPos of validMoves) {
              const act: AIAction = { type: 'move', pieceId: piece.id, to: targetPos };
              const nextSim = simulateAction(currentSimState, act, aiSide);
              let actionScore = evaluateBoard(nextSim, aiSide);

              // Castigar severamente si el movimiento nos deja desprotegidos al fin de turno en Fuera de Juego
              if (nextSim.actionPoints === 0 && isOffsideState(nextSim, aiSide)) {
                actionScore -= 6000;
              }
              candidates.push({ action: act, score: actionScore });
            }
          }
        }

        // Generación de todos los pases tácticos seguros (solo si poseemos el esférico)
        const ballHolder = currentSimState.pieces.find(p => p.id === currentSimState.ball.holderId);
        if (ballHolder && ballHolder.side === aiSide) {
          const validPasses = getValidPasses(ballHolder, currentSimState);
          for (const targetPos of validPasses) {
            // Un pase solo se evalúa si la trayectoria no regala intercepciones absurdas
            if (isPassSafe(ballHolder.pos, targetPos, currentSimState, aiSide)) {
              const act: AIAction = { type: 'pass', pieceId: ballHolder.id, to: targetPos };
              const destSafe = isBallDestinationSafe(targetPos, currentSimState, aiSide);
              const nextSim = simulateAction(currentSimState, act, aiSide);
              let actionScore = evaluateBoard(nextSim, aiSide);

              if (!destSafe) {
                actionScore -= 450; // Penalización por destino vulnerable
              }
              if (nextSim.actionPoints === 0 && isOffsideState(nextSim, aiSide)) {
                actionScore -= 6000;
              }
              candidates.push({ action: act, score: actionScore });
            }
          }
        }

        if (candidates.length === 0) {
          planActions.push({ type: 'end_turn' });
          break;
        }

        // Ordenar candidatos de mayor a menor puntuación
        candidates.sort((a, b) => b.score - a.score);

        // SELECCIÓN NO-DETERMINISTA DE MÁXIMA FUERZA (Evita líneas memorizables por el humano)
        // Tomamos el umbral más alto de jugadas competitivas muy próximas entre sí (Margen de 25)
        const bestScore = candidates[0].score;
        const topCandidates = candidates.filter(c => (bestScore - c.score) <= 25);

        const randIndex = Math.floor(nextRandom() * topCandidates.length);
        const chosenCandidate = topCandidates[randIndex].action;

        planActions.push(chosenCandidate);
        if (chosenCandidate.type === 'end_turn') {
          break;
        }

        // Evolucionar el estado simulado para alimentar la toma de decisiones del siguiente AP
        currentSimState = simulateAction(currentSimState, chosenCandidate, aiSide);
      }

      if (planActions.length === 0) {
        planActions.push({ type: 'end_turn' });
      }
      return planActions;

    } catch (e) {
      // Bloque de seguridad garantizado para no arrojar excepciones al servidor bajo ningún escenario
      return [{ type: 'end_turn' }];
    }
  }
};