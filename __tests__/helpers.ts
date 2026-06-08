import { BoardState, Piece, Position, Side, PieceType } from '../src/types/game'

let _idCounter = 0
export function resetIdCounter() { _idCounter = 0 }

export function mkPiece(
    type: PieceType,
    side: Side,
    x: number,
    y: number,
    hasMoved = false,
): Piece {
    return { id: `${side}_${type}_${x}_${y}_${_idCounter++}`, type, side, pos: { x, y }, hasMovedThisTurn: hasMoved }
}

export function mkBoard(overrides: Partial<BoardState> = {}): BoardState {
    return {
        pieces: [],
        ball: { pos: { x: 4, y: 1 }, holderId: null },
        score: { white: 0, black: 0 },
        actionPoints: 5,
        turn: 'white',
        moveHistory: [],
        turnNumber: 1,
        ...overrides,
    }
}

/** Returns the piece at a given position, or undefined. */
export function pieceAt(state: BoardState, x: number, y: number): Piece | undefined {
    return state.pieces.find(p => p.pos.x === x && p.pos.y === y)
}

/** Returns a position object */
export function pos(x: number, y: number): Position { return { x, y } }
