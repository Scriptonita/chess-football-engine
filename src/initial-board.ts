import { BoardState, Piece, PieceType, Side } from './types/game'

/**
 * Canonical starting position for a Chess.Football kickoff.
 *
 * This is the single source of truth for the initial board: the UI package
 * re-exports it and the simulation/training scripts import it, so no side ever
 * diverges.
 *
 * Bishop placement note: the pitch is 9 columns wide (odd width), so a pair of
 * bishops placed symmetrically on the same rank would always share square colour.
 * To give each side one light-squared and one dark-squared bishop, the right-hand
 * bishop and right-hand knight are swapped relative to a naive symmetric setup:
 *   - bishops end on {3,2}/{6,4} (white) and {3,9}/{6,7} (black) → opposite colours
 *   - knights take the vacated {5,2}/{5,9} squares
 * This trades left-right symmetry for correct bishop colouring.
 */
export function getInitialBoardState(
    servingSide: Side,
    currentScore = { white: 0, black: 0 },
    maxActionPoints = 5,
): BoardState {
    const pieces: Piece[] = []

    const addPiece = (type: PieceType, side: Side, x: number, y: number) => {
        pieces.push({ id: `${side}_${type}_${x}_${y}`, type, side, pos: { x, y }, hasMovedThisTurn: false })
    }

    // White pieces (bottom). King at row 1 (front area row); queen at y=5 (kickoff row).
    addPiece('rook',   'white', 0, 1)
    addPiece('rook',   'white', 8, 1)
    addPiece('bishop', 'white', 3, 2)  // dark square
    addPiece('bishop', 'white', 6, 4)  // light square (swapped with the right knight)
    addPiece('king',   'white', 4, 1)
    addPiece('queen',  'white', 4, 5)
    addPiece('knight', 'white', 2, 4)
    addPiece('knight', 'white', 5, 2)  // took the bishop's old square

    // Black pieces (top, mirrored). King at row 10; queen at y=6 (kickoff row).
    addPiece('rook',   'black', 0, 10)
    addPiece('rook',   'black', 8, 10)
    addPiece('bishop', 'black', 3, 9)  // light square
    addPiece('bishop', 'black', 6, 7)  // dark square (swapped with the right knight)
    addPiece('king',   'black', 4, 10)
    addPiece('queen',  'black', 4, 6)
    addPiece('knight', 'black', 2, 7)
    addPiece('knight', 'black', 5, 9)  // took the bishop's old square

    const servingQueen = pieces.find(p => p.side === servingSide && p.type === 'queen')!

    return {
        pieces,
        ball: { pos: { ...servingQueen.pos }, holderId: servingQueen.id },
        score: currentScore,
        actionPoints: maxActionPoints,
        maxActionPoints,
        turn: servingSide,
        moveHistory: [],
        turnNumber: 1,
    }
}
