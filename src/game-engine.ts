import { BoardState, Piece, Ball, Position, Side, MoveHistoryEntry, MoveHistoryType } from './types/game'
import { isInEnemyArea } from './game-logic'

// ─────────────────────────────────────────────────────────
// Internal helpers
// ─────────────────────────────────────────────────────────

/** Returns all positions on the straight line between `from` and `to`, including `to`. */
export function getPath(from: Position, to: Position): Position[] {
    const path: Position[] = []
    const dx = Math.sign(to.x - from.x)
    const dy = Math.sign(to.y - from.y)
    let curX = from.x + dx
    let curY = from.y + dy
    let iterations = 0

    while ((curX !== to.x || curY !== to.y) && iterations < 20) {
        path.push({ x: curX, y: curY })
        curX += dx
        curY += dy
        iterations++
    }
    path.push({ x: to.x, y: to.y })
    return path
}

function findAdjacentEmptySquare(pos: Position, pieces: Piece[]): Position | null {
    const candidates: Position[] = [
        { x: pos.x,     y: pos.y + 1 },
        { x: pos.x,     y: pos.y - 1 },
        { x: pos.x + 1, y: pos.y     },
        { x: pos.x - 1, y: pos.y     },
        { x: pos.x + 1, y: pos.y + 1 },
        { x: pos.x - 1, y: pos.y - 1 },
        { x: pos.x + 1, y: pos.y - 1 },
        { x: pos.x - 1, y: pos.y + 1 },
    ]
    return candidates.find(n =>
        n.x >= 0 && n.x < 9 && n.y >= 0 && n.y < 12 &&
        !pieces.some(p => p.pos.x === n.x && p.pos.y === n.y)
    ) ?? null
}

type KingFlags = {
    ball: Ball
    kingMustRelease: Side | undefined
    keeperBlockedId: string | undefined
}

function computeKingTurnEndFlags(
    prevKingMustRelease: Side | undefined,
    prevKeeperBlockedId: string | undefined,
    departingSide: Side,
    pieces: Piece[],
    ball: Ball,
): KingFlags {
    const king = pieces.find(p => p.type === 'king' && p.side === departingSide)

    if (!king || ball.holderId !== king.id) {
        return {
            ball,
            kingMustRelease: prevKingMustRelease === departingSide ? undefined : prevKingMustRelease,
            keeperBlockedId: prevKeeperBlockedId,
        }
    }

    if (prevKingMustRelease === departingSide) {
        // Already warned last turn: auto-release ball to adjacent square
        const releasePos = findAdjacentEmptySquare(king.pos, pieces)
        return {
            ball: releasePos ? { pos: releasePos, holderId: null } : { ...ball, holderId: null },
            kingMustRelease: undefined,
            keeperBlockedId: king.id,
        }
    }

    // First time king ends turn holding ball: warn for next turn
    return {
        ball,
        kingMustRelease: departingSide,
        keeperBlockedId: prevKeeperBlockedId,
    }
}

function isLinearPiece(type: Piece['type']): boolean {
    return type === 'rook' || type === 'bishop' || type === 'queen' || type === 'king'
}

function nextSide(side: Side): Side {
    return side === 'white' ? 'black' : 'white'
}

function resetPieceFlags(pieces: Piece[]): Piece[] {
    return pieces.map(p => ({ ...p, hasMovedThisTurn: false }))
}

type OffsideResult = {
    ball: Ball
    /** The offending piece's id, or null if no offside occurred. */
    offsidePieceId: string | null
    /** History/notification entry to record, or null. */
    entry: MoveHistoryEntry | null
}

/**
 * Offside rule: a side may not END its turn with one of its non-king pieces holding
 * the ball inside the ENEMY area (the rival keeper can't be tackled there, so this
 * would let a player camp the ball indefinitely). When it happens, the piece is
 * "offside" and the ball is handed to the rival king.
 *
 * Runs at every turn-end, AFTER the king-release flags, on the resolved ball.
 */
function applyOffsideAtTurnEnd(departingSide: Side, pieces: Piece[], ball: Ball, turnNumber: number): OffsideResult {
    if (!ball.holderId) return { ball, offsidePieceId: null, entry: null }

    const holder = pieces.find(p => p.id === ball.holderId)
    if (!holder || holder.type === 'king' || holder.side !== departingSide) {
        return { ball, offsidePieceId: null, entry: null }
    }
    if (!isInEnemyArea(holder.pos, departingSide)) {
        return { ball, offsidePieceId: null, entry: null }
    }

    const rivalKing = pieces.find(p => p.type === 'king' && p.side === nextSide(departingSide))
    if (!rivalKing) return { ball, offsidePieceId: null, entry: null }

    return {
        ball: { pos: { ...rivalKing.pos }, holderId: rivalKing.id },
        offsidePieceId: holder.id,
        entry: {
            type: 'offside',
            pieceType: holder.type,
            pieceSide: holder.side,
            from: { ...holder.pos },
            to: { ...rivalKing.pos },
            at: Date.now(),
            turnNumber,
        },
    }
}

const HISTORY_LIMIT = 60

function appendHistory(prev: MoveHistoryEntry[] | undefined, entry: MoveHistoryEntry): MoveHistoryEntry[] {
    const base = prev ?? []
    const next = base.length >= HISTORY_LIMIT
        ? [...base.slice(base.length - HISTORY_LIMIT + 1), entry]
        : [...base, entry]
    return next
}

// ─────────────────────────────────────────────────────────
// applyMove
// ─────────────────────────────────────────────────────────

export type MoveResult = {
    boardState: BoardState
    moveType: 'move' | 'tackle'
}

/**
 * Pure function: applies a piece move to the board state.
 * Handles tackles, ball capture on path, and ball conduction.
 * Does NOT validate that the move is legal — call getValidMoves first.
 */
export function applyMove(boardState: BoardState, pieceId: string, to: Position): MoveResult {
    const piece = boardState.pieces.find(p => p.id === pieceId)!
    let ball: Ball = { ...boardState.ball }
    let moveType: 'move' | 'tackle' = 'move'
    let keeperBlockedId = boardState.keeperBlockedId

    // ── Tackle check ──────────────────────────────────────
    const rivalAtDest = boardState.pieces.find(
        p => p.pos.x === to.x && p.pos.y === to.y && p.side !== piece.side
    )

    let rivalNewPos: Position | null = null
    if (rivalAtDest && ball.holderId === rivalAtDest.id) {
        moveType = 'tackle'
        // Find first adjacent empty square for displaced rival
        const neighbors: Position[] = [
            { x: to.x + 1, y: to.y },
            { x: to.x - 1, y: to.y },
            { x: to.x, y: to.y + 1 },
            { x: to.x, y: to.y - 1 },
        ].filter(n => n.x >= 0 && n.x < 9 && n.y >= 0 && n.y < 12)
         .filter(n => !boardState.pieces.some(p => p.pos.x === n.x && p.pos.y === n.y && p.id !== pieceId))

        if (neighbors.length > 0) rivalNewPos = neighbors[0]
        ball = { holderId: piece.id, pos: to }

        // Tackler touched ball as opponent of blocked keeper → unblock keeper
        if (keeperBlockedId && !keeperBlockedId.startsWith(piece.side + '_')) {
            keeperBlockedId = undefined
        }
    }

    // ── Update pieces array ───────────────────────────────
    const newPieces = boardState.pieces.map(p => {
        if (p.id === pieceId) return { ...p, pos: to, hasMovedThisTurn: true }
        if (rivalAtDest && p.id === rivalAtDest.id && rivalNewPos) return { ...p, pos: rivalNewPos }
        return p
    })

    // ── Ball capture / conduction (only if no tackle) ─────
    if (moveType !== 'tackle') {
        if (!ball.holderId && isLinearPiece(piece.type)) {
            const path = getPath(piece.pos, to)
            if (path.some(p => p.x === ball.pos.x && p.y === ball.pos.y)) {
                ball = { holderId: piece.id, pos: to }
            }
        } else if (!ball.holderId && piece.type === 'knight') {
            if (ball.pos.x === to.x && ball.pos.y === to.y) {
                ball = { holderId: piece.id, pos: to }
            }
        } else if (ball.holderId === pieceId) {
            // Conduction
            ball = { ...ball, pos: to }
        } else if (!ball.holderId && ball.pos.x === to.x && ball.pos.y === to.y) {
            ball = { holderId: piece.id, pos: to }
        }
    }

    // ── AP & turn ─────────────────────────────────────────
    const nextAP = boardState.actionPoints - 1

    // King possession penalty: if kingMustRelease is active and only 1 AP remains
    // after this action and king still holds the ball, consume that last AP as the penalty.
    const kingAfterMove = newPieces.find(p => p.type === 'king' && p.side === boardState.turn)
    const kingPenalty =
        nextAP === 1 &&
        boardState.kingMustRelease === boardState.turn &&
        !!kingAfterMove &&
        ball.holderId === kingAfterMove.id

    const isTurnOver = nextAP === 0 || kingPenalty
    const nextTurn = isTurnOver ? nextSide(boardState.turn) : boardState.turn

    // ── King turn-end flags ───────────────────────────────
    const kingFlags = isTurnOver
        ? computeKingTurnEndFlags(boardState.kingMustRelease, keeperBlockedId, boardState.turn, newPieces, ball)
        : { ball, kingMustRelease: boardState.kingMustRelease, keeperBlockedId }

    const now = Date.now()
    const turnNumber = boardState.turnNumber ?? 1
    const historyEntry: MoveHistoryEntry = {
        type: moveType,
        pieceType: piece.type,
        pieceSide: piece.side,
        from: piece.pos,
        to,
        at: now,
        turnNumber,
    }

    const offside = isTurnOver
        ? applyOffsideAtTurnEnd(boardState.turn, newPieces, kingFlags.ball, turnNumber)
        : { ball: kingFlags.ball, offsidePieceId: null, entry: null }

    let moveHistory = appendHistory(boardState.moveHistory, historyEntry)
    if (offside.entry) moveHistory = appendHistory(moveHistory, offside.entry)

    return {
        moveType,
        boardState: {
            ...boardState,
            pieces: isTurnOver ? resetPieceFlags(newPieces) : newPieces,
            ball: offside.ball,
            actionPoints: isTurnOver ? (boardState.maxActionPoints ?? 5) : nextAP,
            turn: nextTurn,
            turnNumber: isTurnOver ? turnNumber + 1 : turnNumber,
            kingMustRelease: kingFlags.kingMustRelease,
            keeperBlockedId: kingFlags.keeperBlockedId,
            lastMove: offside.entry
                ? { type: 'offside', from: offside.entry.from, to: offside.entry.to, playerId: offside.offsidePieceId!, at: offside.entry.at }
                : { type: moveType, from: piece.pos, to, playerId: piece.id, at: now },
            moveHistory,
        },
    }
}

// ─────────────────────────────────────────────────────────
// applyPass
// ─────────────────────────────────────────────────────────

export type PassResult = {
    boardState: BoardState
    forcedTurnEnd: boolean
    goalScored: boolean
}

/**
 * Pure function: applies a ball pass to the board state.
 * Handles goal detection (ball hits rival king), interception, and forced turn end.
 * Does NOT validate that the pass is legal — call getValidPasses first.
 */
export function applyPass(boardState: BoardState, to: Position): PassResult {
    const holder = boardState.pieces.find(p => p.id === boardState.ball.holderId)!
    let ball: Ball = { ...boardState.ball }
    let forcedTurnEnd = false
    let goalScored = false
    let keeperBlockedId = boardState.keeperBlockedId
    let kingMustRelease = boardState.kingMustRelease

    const path = holder.type !== 'knight' ? getPath(holder.pos, to) : [to]

    // ── Goal / Interception check ─────────────────────────
    // Walk the path (includes destination). First enemy encountered:
    //   - if it's the rival king → GOAL
    //   - otherwise → interception (turn ends)
    // Knights only check the destination square (no traversal).
    const firstEnemy = path
        .map(pos => boardState.pieces.find(
            p => p.pos.x === pos.x && p.pos.y === pos.y && p.side !== holder.side
        ))
        .find(Boolean)

    if (firstEnemy) {
        if (firstEnemy.type === 'king') {
            // Goal: ball stops at the king's square, holder keeps it conceptually
            // but ball is left loose (the board resets immediately after)
            ball = { holderId: null, pos: firstEnemy.pos }
            forcedTurnEnd = true
            goalScored = true
        } else {
            // Interception: rival non-king piece picks up the ball
            ball = { holderId: firstEnemy.id, pos: firstEnemy.pos }
            forcedTurnEnd = true
        }
        // Opponent touched ball → unblock keeper if applicable
        if (keeperBlockedId && !keeperBlockedId.startsWith(firstEnemy.side + '_')) {
            keeperBlockedId = undefined
        }
    }

    // ── Normal pass ───────────────────────────────────────
    if (!forcedTurnEnd) {
        const teammateAtDest = boardState.pieces.find(
            p => p.pos.x === to.x && p.pos.y === to.y && p.side === holder.side
        )
        ball = { pos: to, holderId: teammateAtDest ? teammateAtDest.id : null }

        // King releasing ball → set keeper block; clear forced-release warning if active
        if (holder.type === 'king') {
            keeperBlockedId = holder.id
            if (kingMustRelease === holder.side) {
                kingMustRelease = undefined
            }
        }
    }

    // ── AP & turn ─────────────────────────────────────────
    const nextAP = forcedTurnEnd ? 0 : boardState.actionPoints - 1
    const isTurnOver = nextAP === 0
    const nextTurn = isTurnOver ? nextSide(boardState.turn) : boardState.turn

    // ── King turn-end flags ───────────────────────────────
    const kingFlags = isTurnOver
        ? computeKingTurnEndFlags(kingMustRelease, keeperBlockedId, boardState.turn, boardState.pieces, ball)
        : { ball, kingMustRelease, keeperBlockedId }

    let lastMoveType: MoveHistoryType = 'pass'
    if (goalScored) lastMoveType = 'goal'
    else if (forcedTurnEnd) lastMoveType = 'interception'

    const now = Date.now()
    const turnNumber = boardState.turnNumber ?? 1
    const historyEntry: MoveHistoryEntry = {
        type: lastMoveType,
        pieceType: holder.type,
        pieceSide: holder.side,
        from: holder.pos,
        to: ball.pos,
        at: now,
        turnNumber,
    }

    const offside = isTurnOver
        ? applyOffsideAtTurnEnd(boardState.turn, boardState.pieces, kingFlags.ball, turnNumber)
        : { ball: kingFlags.ball, offsidePieceId: null, entry: null }

    let moveHistory = appendHistory(boardState.moveHistory, historyEntry)
    if (offside.entry) moveHistory = appendHistory(moveHistory, offside.entry)

    return {
        forcedTurnEnd,
        goalScored,
        boardState: {
            ...boardState,
            ball: offside.ball,
            actionPoints: isTurnOver ? (boardState.maxActionPoints ?? 5) : nextAP,
            turn: nextTurn,
            turnNumber: isTurnOver ? turnNumber + 1 : turnNumber,
            pieces: isTurnOver
                ? resetPieceFlags(boardState.pieces)
                : boardState.pieces,
            kingMustRelease: kingFlags.kingMustRelease,
            keeperBlockedId: kingFlags.keeperBlockedId,
            lastMove: offside.entry
                ? { type: 'offside', from: offside.entry.from, to: offside.entry.to, playerId: offside.offsidePieceId!, at: offside.entry.at }
                : { type: lastMoveType, from: holder.pos, to: ball.pos, playerId: holder.id, at: now },
            moveHistory,
        },
    }
}

// ─────────────────────────────────────────────────────────
// applyEndTurn
// ─────────────────────────────────────────────────────────

/**
 * Pure function: manually ends the current turn, passing control to the opponent.
 */
export function applyEndTurn(boardState: BoardState): BoardState {
    const kingFlags = computeKingTurnEndFlags(
        boardState.kingMustRelease,
        boardState.keeperBlockedId,
        boardState.turn,
        boardState.pieces,
        boardState.ball,
    )
    const turnNumber = boardState.turnNumber ?? 1
    const offside = applyOffsideAtTurnEnd(boardState.turn, boardState.pieces, kingFlags.ball, turnNumber)
    return {
        ...boardState,
        turn: nextSide(boardState.turn),
        actionPoints: boardState.maxActionPoints ?? 5,
        turnNumber: turnNumber + 1,
        pieces: resetPieceFlags(boardState.pieces),
        ball: offside.ball,
        kingMustRelease: kingFlags.kingMustRelease,
        keeperBlockedId: kingFlags.keeperBlockedId,
        lastMove: offside.entry
            ? { type: 'offside', from: offside.entry.from, to: offside.entry.to, playerId: offside.offsidePieceId!, at: offside.entry.at }
            : boardState.lastMove,
        moveHistory: offside.entry ? appendHistory(boardState.moveHistory, offside.entry) : boardState.moveHistory,
    }
}
