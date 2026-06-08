import { Piece, Position, BoardState, Side } from './types/game'

// ─────────────────────────────────────────────────────────
// Area constants (5×2 penalty areas)
// ─────────────────────────────────────────────────────────

export const WHITE_AREA = { xMin: 2, xMax: 6, yMin: 0, yMax: 1 }
export const BLACK_AREA = { xMin: 2, xMax: 6, yMin: 10, yMax: 11 }

export function getAreaForSide(side: Side) {
    return side === 'white' ? WHITE_AREA : BLACK_AREA
}

export function isInOwnArea(pos: Position, side: Side): boolean {
    const area = getAreaForSide(side)
    return pos.x >= area.xMin && pos.x <= area.xMax && pos.y >= area.yMin && pos.y <= area.yMax
}

export function isInEnemyArea(pos: Position, side: Side): boolean {
    return isInOwnArea(pos, side === 'white' ? 'black' : 'white')
}

// ─────────────────────────────────────────────────────────
// getValidMoves
// ─────────────────────────────────────────────────────────

export const getValidMoves = (piece: Piece, boardState: BoardState): Position[] => {
    const moves: Position[] = []
    const { x, y } = piece.pos

    const getPieceAt = (pos: Position) => {
        return boardState.pieces.find(p => p.pos.x === pos.x && p.pos.y === pos.y)
    }

    const isValidCoord = (pos: Position) => {
        return pos.x >= 0 && pos.x < 9 && pos.y >= 0 && pos.y < 12
    }

    // Rival king's square is untouchable — no piece can land on it
    const isRivalKingSquare = (dest: Position): boolean => {
        const p = getPieceAt(dest)
        return !!p && p.type === 'king' && p.side !== piece.side
    }

    // Area constraint:
    // - King can ONLY move within its own area
    // - Any other piece CANNOT enter its own area
    const isAreaValid = (dest: Position): boolean => {
        if (piece.type === 'king') {
            return isInOwnArea(dest, piece.side)
        }
        return !isInOwnArea(dest, piece.side)
    }

    // Returns true if the ball holder at `ballHolderPos` has at least one free adjacent
    // square to be displaced to, counting the attacker's current square as free.
    const canDisplace = (ballHolderPos: Position): boolean => {
        return [
            { x: ballHolderPos.x + 1, y: ballHolderPos.y },
            { x: ballHolderPos.x - 1, y: ballHolderPos.y },
            { x: ballHolderPos.x,     y: ballHolderPos.y + 1 },
            { x: ballHolderPos.x,     y: ballHolderPos.y - 1 },
        ].filter(n => n.x >= 0 && n.x < 9 && n.y >= 0 && n.y < 12)
         .some(n => !boardState.pieces.some(p =>
             p.pos.x === n.x && p.pos.y === n.y && p.id !== piece.id
         ))
    }

    // Combined destination check (excluding area constraint, which is separate)
    const isValidDest = (dest: Position): boolean => {
        if (isRivalKingSquare(dest)) return false
        const pieceAt = getPieceAt(dest)
        if (!pieceAt) return true
        if (pieceAt.side === piece.side) return false
        // Tackle: can only move to opponent square if they hold the ball and can be displaced
        if (boardState.ball.holderId === pieceAt.id) return canDisplace(pieceAt.pos)
        return false
    }

    const addLineMoves = (dx: number, dy: number) => {
        let curX = x + dx
        let curY = y + dy
        while (isValidCoord({ x: curX, y: curY })) {
            const dest = { x: curX, y: curY }
            const pieceAt = getPieceAt(dest)

            if (!pieceAt) {
                if (isAreaValid(dest)) moves.push(dest)
            } else {
                if (isAreaValid(dest) && isValidDest(dest)) moves.push(dest)
                break
            }
            curX += dx
            curY += dy
        }
    }

    switch (piece.type) {
        case 'king':
            for (let dx = -1; dx <= 1; dx++) {
                for (let dy = -1; dy <= 1; dy++) {
                    if (dx === 0 && dy === 0) continue
                    const dest = { x: x + dx, y: y + dy }
                    if (isValidCoord(dest) && isAreaValid(dest) && isValidDest(dest)) {
                        moves.push(dest)
                    }
                }
            }
            break

        case 'rook':
            addLineMoves(1, 0)
            addLineMoves(-1, 0)
            addLineMoves(0, 1)
            addLineMoves(0, -1)
            break

        case 'bishop':
            addLineMoves(1, 1)
            addLineMoves(1, -1)
            addLineMoves(-1, 1)
            addLineMoves(-1, -1)
            break

        case 'queen':
            addLineMoves(1, 0)
            addLineMoves(-1, 0)
            addLineMoves(0, 1)
            addLineMoves(0, -1)
            addLineMoves(1, 1)
            addLineMoves(1, -1)
            addLineMoves(-1, 1)
            addLineMoves(-1, -1)
            break

        case 'knight': {
            const knightMoves = [
                { dx: 1, dy: 2 }, { dx: 1, dy: -2 },
                { dx: -1, dy: 2 }, { dx: -1, dy: -2 },
                { dx: 2, dy: 1 }, { dx: 2, dy: -1 },
                { dx: -2, dy: 1 }, { dx: -2, dy: -1 }
            ]
            knightMoves.forEach(({ dx, dy }) => {
                const dest = { x: x + dx, y: y + dy }
                if (isValidCoord(dest) && isAreaValid(dest) && isValidDest(dest)) {
                    moves.push(dest)
                }
            })
            break
        }
    }

    return moves
}

// ─────────────────────────────────────────────────────────
// getValidPasses
// ─────────────────────────────────────────────────────────

export const getValidPasses = (piece: Piece, boardState: BoardState): Position[] => {
    const moves: Position[] = []
    const { x, y } = piece.pos

    const isValidCoord = (pos: Position) => {
        return pos.x >= 0 && pos.x < 9 && pos.y >= 0 && pos.y < 12
    }

    // Keeper backpass rule: blocked keeper cannot be a pass destination
    const blockedKeeper = boardState.keeperBlockedId
        ? boardState.pieces.find(p => p.id === boardState.keeperBlockedId)
        : null
    const isBlockedKeeperPos = (pos: Position): boolean =>
        !!blockedKeeper && blockedKeeper.pos.x === pos.x && blockedKeeper.pos.y === pos.y

    // Passes fly over all pieces — no blocking. The ball can reach any square on
    // the piece's movement ray (interceptions and goal shots are resolved in applyPass).
    const addLinePasses = (dx: number, dy: number) => {
        let curX = x + dx
        let curY = y + dy
        while (isValidCoord({ x: curX, y: curY })) {
            if (!isBlockedKeeperPos({ x: curX, y: curY })) {
                moves.push({ x: curX, y: curY })
            }
            curX += dx
            curY += dy
        }
    }

    switch (piece.type) {
        case 'king':
            for (let dx = -1; dx <= 1; dx++) {
                for (let dy = -1; dy <= 1; dy++) {
                    if (dx === 0 && dy === 0) continue
                    const dest = { x: x + dx, y: y + dy }
                    if (isValidCoord(dest) && !isBlockedKeeperPos(dest)) moves.push(dest)
                }
            }
            break

        case 'rook':
            addLinePasses(1, 0)
            addLinePasses(-1, 0)
            addLinePasses(0, 1)
            addLinePasses(0, -1)
            break

        case 'bishop':
            addLinePasses(1, 1)
            addLinePasses(1, -1)
            addLinePasses(-1, 1)
            addLinePasses(-1, -1)
            break

        case 'queen':
            addLinePasses(1, 0)
            addLinePasses(-1, 0)
            addLinePasses(0, 1)
            addLinePasses(0, -1)
            addLinePasses(1, 1)
            addLinePasses(1, -1)
            addLinePasses(-1, 1)
            addLinePasses(-1, -1)
            break

        case 'knight': {
            const knightMoves = [
                { dx: 1, dy: 2 }, { dx: 1, dy: -2 },
                { dx: -1, dy: 2 }, { dx: -1, dy: -2 },
                { dx: 2, dy: 1 }, { dx: 2, dy: -1 },
                { dx: -2, dy: 1 }, { dx: -2, dy: -1 }
            ]
            knightMoves.forEach(({ dx, dy }) => {
                const dest = { x: x + dx, y: y + dy }
                if (isValidCoord(dest) && !isBlockedKeeperPos(dest)) moves.push(dest)
            })
            break
        }
    }

    return moves
}

// ─────────────────────────────────────────────────────────
// checkGoal
// ─────────────────────────────────────────────────────────

/**
 * Returns which side scored a goal in the given board state, or null if no goal.
 * A goal occurs when a pass reaches the rival king (lastMove.type === 'goal').
 */
export const checkGoal = (boardState: BoardState): Side | null => {
    if (boardState.lastMove?.type !== 'goal') return null
    const playerId = boardState.lastMove.playerId
    return playerId.startsWith('white_') ? 'white' : 'black'
}
