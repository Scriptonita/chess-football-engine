/**
 * Extended game-logic tests — covers all rules not already in game-logic.test.ts.
 * Each describe block maps to a specific rule or invariant.
 */
import { describe, it, expect } from 'vitest'
import {
    getValidMoves,
    getValidPasses,
    isInOwnArea,
    isInEnemyArea,
    getAreaForSide,
    WHITE_AREA,
    BLACK_AREA,
} from '../src/game-logic'
import { mkBoard, mkPiece, pos } from './helpers'

// ─────────────────────────────────────────────────────────
// Area constants and boundaries
// ─────────────────────────────────────────────────────────
describe('Area constants', () => {
    it('white area spans x∈[2..6] y∈[0..1]', () => {
        expect(WHITE_AREA).toEqual({ xMin: 2, xMax: 6, yMin: 0, yMax: 1 })
    })

    it('black area spans x∈[2..6] y∈[10..11]', () => {
        expect(BLACK_AREA).toEqual({ xMin: 2, xMax: 6, yMin: 10, yMax: 11 })
    })

    it('getAreaForSide returns white area for white', () => {
        expect(getAreaForSide('white')).toEqual(WHITE_AREA)
    })

    it('getAreaForSide returns black area for black', () => {
        expect(getAreaForSide('black')).toEqual(BLACK_AREA)
    })
})

describe('isInOwnArea — exact boundary corners', () => {
    // White area corners: (2,0), (6,0), (2,1), (6,1)
    it('white area corner (2,0) is in white area', () => {
        expect(isInOwnArea(pos(2, 0), 'white')).toBe(true)
    })
    it('white area corner (6,0) is in white area', () => {
        expect(isInOwnArea(pos(6, 0), 'white')).toBe(true)
    })
    it('white area corner (2,1) is in white area', () => {
        expect(isInOwnArea(pos(2, 1), 'white')).toBe(true)
    })
    it('white area corner (6,1) is in white area', () => {
        expect(isInOwnArea(pos(6, 1), 'white')).toBe(true)
    })

    // Just outside white area
    it('(1,0) is NOT in white area (x too small)', () => {
        expect(isInOwnArea(pos(1, 0), 'white')).toBe(false)
    })
    it('(7,0) is NOT in white area (x too large)', () => {
        expect(isInOwnArea(pos(7, 0), 'white')).toBe(false)
    })
    it('(4,2) is NOT in white area (y too large)', () => {
        expect(isInOwnArea(pos(4, 2), 'white')).toBe(false)
    })

    // Black area corners: (2,10), (6,10), (2,11), (6,11)
    it('black area corner (2,10) is in black area', () => {
        expect(isInOwnArea(pos(2, 10), 'black')).toBe(true)
    })
    it('black area corner (6,11) is in black area', () => {
        expect(isInOwnArea(pos(6, 11), 'black')).toBe(true)
    })

    // Just outside black area
    it('(4,9) is NOT in black area (y too small)', () => {
        expect(isInOwnArea(pos(4, 9), 'black')).toBe(false)
    })
    it('(7,10) is NOT in black area (x too large)', () => {
        expect(isInOwnArea(pos(7, 10), 'black')).toBe(false)
    })
})

describe('isInEnemyArea — symmetric', () => {
    it('white enemy area is the black area', () => {
        expect(isInEnemyArea(pos(4, 10), 'white')).toBe(true)
        expect(isInEnemyArea(pos(4, 11), 'white')).toBe(true)
        expect(isInEnemyArea(pos(4, 9), 'white')).toBe(false)
    })
    it('black enemy area is the white area', () => {
        expect(isInEnemyArea(pos(4, 0), 'black')).toBe(true)
        expect(isInEnemyArea(pos(4, 1), 'black')).toBe(true)
        expect(isInEnemyArea(pos(4, 2), 'black')).toBe(false)
    })
})

// ─────────────────────────────────────────────────────────
// Board coordinate system (9×12 grid)
// ─────────────────────────────────────────────────────────
describe('Board coordinate system', () => {
    it('board has 9 columns (x 0-8)', () => {
        // Rook at x=0: can slide right to x=8
        const rook = mkPiece('rook', 'white', 0, 4)
        const state = mkBoard({ pieces: [rook] })
        const moves = getValidMoves(rook, state)
        expect(moves.some(m => m.x === 8 && m.y === 4)).toBe(true)
        expect(moves.some(m => m.x === 9 && m.y === 4)).toBe(false)
    })

    it('board has 12 rows (y 0-11)', () => {
        // Rook at y=4: can slide up to y=11
        const rook = mkPiece('rook', 'white', 0, 4)
        const state = mkBoard({ pieces: [rook] })
        const moves = getValidMoves(rook, state)
        expect(moves.some(m => m.x === 0 && m.y === 11)).toBe(true)
        expect(moves.some(m => m.x === 0 && m.y === 12)).toBe(false)
    })
})

// ─────────────────────────────────────────────────────────
// getValidMoves — piece-specific rules
// ─────────────────────────────────────────────────────────
describe('getValidMoves — rook exhaustive', () => {
    it('rook at corner (0,4) slides in 3 directions (not left off board)', () => {
        const rook = mkPiece('rook', 'white', 0, 4)
        const state = mkBoard({ pieces: [rook] })
        const moves = getValidMoves(rook, state)
        // Right: (1,4)…(8,4); Up: (0,5)…(0,11); Down: stops at own area
        expect(moves.some(m => m.x === 8 && m.y === 4)).toBe(true)
        expect(moves.some(m => m.x === 0 && m.y === 11)).toBe(true)
        // No x=-1
        expect(moves.some(m => m.x < 0)).toBe(false)
    })

    it('rook moving toward own area stops just before it', () => {
        // White rook at (4,4) moving down: (4,3),(4,2) ok; (4,1),(4,0) in area → blocked
        const rook = mkPiece('rook', 'white', 4, 4)
        const state = mkBoard({ pieces: [rook] })
        const moves = getValidMoves(rook, state)
        expect(moves.some(m => m.x === 4 && m.y === 3)).toBe(true)
        expect(moves.some(m => m.x === 4 && m.y === 2)).toBe(true)
        expect(moves.some(m => m.x === 4 && m.y === 1)).toBe(false) // in white area
        expect(moves.some(m => m.x === 4 && m.y === 0)).toBe(false) // in white area
    })

    it('rook can pass through own area squares (no blocking by area)', () => {
        // White rook at (4,4): moving down, can "see through" own area; no move there but ray continues
        // Actually the ray stops because pieces aren't blocking — area is just a landing restriction.
        // Rook at (1,4) moving down toward y=0 passes through x=1 (outside white area, so ok)
        const rook = mkPiece('rook', 'white', 1, 5)
        const state = mkBoard({ pieces: [rook] })
        const moves = getValidMoves(rook, state)
        // x=1 is outside white area (x<2), so rook can move down to y=0
        expect(moves.some(m => m.x === 1 && m.y === 0)).toBe(true)
    })

    it('rook is blocked by rival piece — can tackle if rival holds ball', () => {
        const rook = mkPiece('rook', 'white', 0, 3)
        const rival = mkPiece('queen', 'black', 0, 6)
        const state = mkBoard({
            pieces: [rook, rival],
            ball: { pos: pos(0, 6), holderId: rival.id },
        })
        const moves = getValidMoves(rook, state)
        expect(moves.some(m => m.x === 0 && m.y === 6)).toBe(true)  // tackle allowed
        expect(moves.some(m => m.x === 0 && m.y === 7)).toBe(false) // behind rival
    })
})

describe('getValidMoves — bishop exhaustive', () => {
    it('bishop at (4,5) can reach far corners on all 4 diagonals', () => {
        const bishop = mkPiece('bishop', 'white', 4, 5)
        const state = mkBoard({ pieces: [bishop] })
        const moves = getValidMoves(bishop, state)
        expect(moves.some(m => m.x === 8 && m.y === 9)).toBe(true)  // NE
        expect(moves.some(m => m.x === 0 && m.y === 9)).toBe(true)  // NW
        expect(moves.some(m => m.x === 6 && m.y === 3)).toBe(true)  // SE diagonal (4+2,5-2)
        // SW diagonal: (3,4),(2,3),(1,2),(0,1)
        expect(moves.some(m => m.x === 0 && m.y === 1)).toBe(true)  // SW corner, not in area (x<2)
    })

    it('bishop stops diagonally at board edge', () => {
        const bishop = mkPiece('bishop', 'white', 0, 5)
        const state = mkBoard({ pieces: [bishop] })
        const moves = getValidMoves(bishop, state)
        // Can go NE to (8,13) — but capped at y=11
        expect(moves.some(m => m.x === 6 && m.y === 11)).toBe(true)
        expect(moves.some(m => m.x === 9)).toBe(false) // out of bounds
    })
})

describe('getValidMoves — queen exhaustive', () => {
    it('queen at (4,5) can reach any direction up to the board edge', () => {
        const queen = mkPiece('queen', 'white', 4, 5)
        const state = mkBoard({ pieces: [queen] })
        const moves = getValidMoves(queen, state)
        // All 8 directions
        expect(moves.some(m => m.x === 4 && m.y === 11)).toBe(true) // N
        expect(moves.some(m => m.x === 8 && m.y === 5)).toBe(true)  // E
        expect(moves.some(m => m.x === 0 && m.y === 5)).toBe(true)  // W
        expect(moves.some(m => m.x === 8 && m.y === 9)).toBe(true)  // NE
        expect(moves.some(m => m.x === 0 && m.y === 9)).toBe(true)  // NW
        // S stops before white area at (4,2)
        expect(moves.some(m => m.x === 4 && m.y === 2)).toBe(true)
        expect(moves.some(m => m.x === 4 && m.y === 1)).toBe(false) // in white area
    })

    it('queen is blocked by own piece on any ray', () => {
        const queen = mkPiece('queen', 'white', 4, 5)
        const blocker = mkPiece('rook', 'white', 7, 5)
        const state = mkBoard({ pieces: [queen, blocker] })
        const moves = getValidMoves(queen, state)
        expect(moves.some(m => m.x === 7 && m.y === 5)).toBe(false) // own piece
        expect(moves.some(m => m.x === 8 && m.y === 5)).toBe(false) // behind own piece
    })
})

describe('getValidMoves — knight exhaustive', () => {
    it('knight at (0,0) has 1 valid move (board edge + area limits)', () => {
        const knight = mkPiece('knight', 'white', 0, 0)
        const state = mkBoard({ pieces: [knight] })
        const moves = getValidMoves(knight, state)
        // From (0,0): only (1,2) is in bounds and outside white area.
        // (2,1) is inside white area (x∈[2..6], y∈[0..1]) → blocked.
        // All other L-moves are out of bounds.
        expect(moves.some(m => m.x === 1 && m.y === 2)).toBe(true)
        expect(moves.some(m => m.x === 2 && m.y === 1)).toBe(false)
        expect(moves).toHaveLength(1)
    })

    it('knight jumps over pieces (not blocked by intermediate pieces)', () => {
        const knight = mkPiece('knight', 'white', 4, 5)
        const blocker = mkPiece('rook', 'white', 5, 5) // "in the way" linearly
        const rival = mkPiece('queen', 'black', 5, 6)  // no ball → can't land there
        const state = mkBoard({ pieces: [knight, blocker, rival] })
        const moves = getValidMoves(knight, state)
        // (5,7) = (+1,+2) is reachable despite blocker at (5,5)
        expect(moves.some(m => m.x === 5 && m.y === 7)).toBe(true)
        // (6,6) = (+2,+1) is reachable (no piece there)
        expect(moves.some(m => m.x === 6 && m.y === 6)).toBe(true)
        // (5,6) has rival without ball → cannot land there
        expect(moves.some(m => m.x === 5 && m.y === 6)).toBe(false)
    })

    it('knight cannot land on own piece', () => {
        const knight = mkPiece('knight', 'white', 4, 5)
        const own = mkPiece('rook', 'white', 5, 7)
        const state = mkBoard({ pieces: [knight, own] })
        const moves = getValidMoves(knight, state)
        expect(moves.some(m => m.x === 5 && m.y === 7)).toBe(false)
    })

    it('black knight cannot land in black area', () => {
        // Black knight at (4,8): (3,10) and (5,10) are in black area
        const knight = mkPiece('knight', 'black', 4, 8)
        const state = mkBoard({ pieces: [knight] })
        const moves = getValidMoves(knight, state)
        expect(moves.some(m => m.x === 3 && m.y === 10)).toBe(false)
        expect(moves.some(m => m.x === 5 && m.y === 10)).toBe(false)
        // But (2,9) is NOT in black area → valid
        expect(moves.some(m => m.x === 2 && m.y === 9)).toBe(true)
    })
})

describe('getValidMoves — king exhaustive', () => {
    it('white king at (2,0) — corner of area — has 3 valid moves', () => {
        const king = mkPiece('king', 'white', 2, 0)
        const state = mkBoard({ pieces: [king] })
        const moves = getValidMoves(king, state)
        // Adjacent in area: (3,0), (2,1), (3,1)
        expect(moves.some(m => m.x === 3 && m.y === 0)).toBe(true)
        expect(moves.some(m => m.x === 2 && m.y === 1)).toBe(true)
        expect(moves.some(m => m.x === 3 && m.y === 1)).toBe(true)
        // (1,0) is outside area → blocked
        expect(moves.some(m => m.x === 1 && m.y === 0)).toBe(false)
        // (2,-1) is out of bounds → blocked
        expect(moves.some(m => m.y < 0)).toBe(false)
        expect(moves).toHaveLength(3)
    })

    it('black king at (6,11) — corner of area — has 3 valid moves', () => {
        const king = mkPiece('king', 'black', 6, 11)
        const state = mkBoard({ pieces: [king] })
        const moves = getValidMoves(king, state)
        expect(moves.some(m => m.x === 5 && m.y === 11)).toBe(true)
        expect(moves.some(m => m.x === 6 && m.y === 10)).toBe(true)
        expect(moves.some(m => m.x === 5 && m.y === 10)).toBe(true)
        expect(moves).toHaveLength(3)
    })

    it('king can tackle rival ball-holder that entered its own area', () => {
        // A black rook enters white's area (valid for black pieces)
        const whiteKing = mkPiece('king', 'white', 4, 0)
        const blackRook = mkPiece('rook', 'black', 4, 1)
        const state = mkBoard({
            pieces: [whiteKing, blackRook],
            ball: { pos: pos(4, 1), holderId: blackRook.id },
        })
        const moves = getValidMoves(whiteKing, state)
        // (4,1) is in white area, rival holds ball → king can tackle
        expect(moves.some(m => m.x === 4 && m.y === 1)).toBe(true)
    })

    it('king cannot tackle rival NOT holding ball', () => {
        const whiteKing = mkPiece('king', 'white', 4, 0)
        const blackRook = mkPiece('rook', 'black', 4, 1)
        const state = mkBoard({
            pieces: [whiteKing, blackRook],
            ball: { pos: pos(5, 5), holderId: null },
        })
        const moves = getValidMoves(whiteKing, state)
        expect(moves.some(m => m.x === 4 && m.y === 1)).toBe(false)
    })
})

// ─────────────────────────────────────────────────────────
// getValidPasses — rules
// ─────────────────────────────────────────────────────────
describe('getValidPasses — area restrictions do NOT apply to passes', () => {
    it('queen can pass into own area (e.g. to king)', () => {
        const queen = mkPiece('queen', 'white', 4, 5)
        const king = mkPiece('king', 'white', 4, 0)
        const state = mkBoard({
            pieces: [queen, king],
            ball: { pos: pos(4, 5), holderId: queen.id },
        })
        const passes = getValidPasses(queen, state)
        // (4,0) is in white area but pass can land there (king is there)
        expect(passes.some(p => p.x === 4 && p.y === 0)).toBe(true)
    })

    it('queen can pass to any square in rival area', () => {
        const queen = mkPiece('queen', 'white', 4, 8)
        const state = mkBoard({
            pieces: [queen],
            ball: { pos: pos(4, 8), holderId: queen.id },
        })
        const passes = getValidPasses(queen, state)
        // (4,10) is in black area — valid pass destination
        expect(passes.some(p => p.x === 4 && p.y === 10)).toBe(true)
        expect(passes.some(p => p.x === 4 && p.y === 11)).toBe(true)
    })
})

describe('getValidPasses — boundary checking', () => {
    it('passes do not go out of board bounds', () => {
        const rook = mkPiece('rook', 'white', 0, 5)
        const state = mkBoard({ pieces: [rook] })
        const passes = getValidPasses(rook, state)
        passes.forEach(p => {
            expect(p.x).toBeGreaterThanOrEqual(0)
            expect(p.x).toBeLessThan(9)
            expect(p.y).toBeGreaterThanOrEqual(0)
            expect(p.y).toBeLessThan(12)
        })
    })

    it('knight passes are bounded by board', () => {
        const knight = mkPiece('knight', 'white', 0, 0)
        const state = mkBoard({ pieces: [knight] })
        const passes = getValidPasses(knight, state)
        passes.forEach(p => {
            expect(p.x).toBeGreaterThanOrEqual(0)
            expect(p.y).toBeGreaterThanOrEqual(0)
        })
    })
})

describe('getValidPasses — keeper backpass blocked', () => {
    it('bishop passes also exclude blocked keeper position', () => {
        const bishop = mkPiece('bishop', 'white', 2, 3)
        const king = mkPiece('king', 'white', 4, 1) // on bishop's diagonal
        const state = mkBoard({
            pieces: [bishop, king],
            ball: { pos: pos(2, 3), holderId: bishop.id },
            keeperBlockedId: king.id,
        })
        const passes = getValidPasses(bishop, state)
        expect(passes.some(p => p.x === 4 && p.y === 1)).toBe(false)
    })

    it('blocked keeper at non-square position does not affect other squares', () => {
        const queen = mkPiece('queen', 'white', 4, 5)
        const king = mkPiece('king', 'white', 4, 0)
        const state = mkBoard({
            pieces: [queen, king],
            ball: { pos: pos(4, 5), holderId: queen.id },
            keeperBlockedId: king.id,
        })
        const passes = getValidPasses(queen, state)
        // (4,0) blocked, but (4,1) — a square near the king — is NOT blocked
        expect(passes.some(p => p.x === 4 && p.y === 0)).toBe(false)
        expect(passes.some(p => p.x === 4 && p.y === 2)).toBe(true)
    })
})

// ─────────────────────────────────────────────────────────
// Tackle rules — exhaustive
// ─────────────────────────────────────────────────────────
describe('getValidMoves — tackle rules exhaustive', () => {
    it('queen can tackle rival ball-holder on diagonal', () => {
        const queen = mkPiece('queen', 'white', 2, 3)
        const rival = mkPiece('rook', 'black', 4, 5)
        const state = mkBoard({
            pieces: [queen, rival],
            ball: { pos: pos(4, 5), holderId: rival.id },
        })
        const moves = getValidMoves(queen, state)
        expect(moves.some(m => m.x === 4 && m.y === 5)).toBe(true)
    })

    it('queen cannot tackle rival without ball on diagonal', () => {
        const queen = mkPiece('queen', 'white', 2, 3)
        const rival = mkPiece('rook', 'black', 4, 5)
        const state = mkBoard({
            pieces: [queen, rival],
            ball: { pos: pos(0, 0), holderId: null },
        })
        const moves = getValidMoves(queen, state)
        expect(moves.some(m => m.x === 4 && m.y === 5)).toBe(false)
    })

    it('rival king square cannot be moved to even with ball', () => {
        // Rival king holds ball → still cannot be moved to
        const queen = mkPiece('queen', 'white', 4, 5)
        const blackKing = mkPiece('king', 'black', 4, 11)
        const state = mkBoard({
            pieces: [queen, blackKing],
            ball: { pos: pos(4, 11), holderId: blackKing.id },
        })
        const moves = getValidMoves(queen, state)
        expect(moves.some(m => m.x === 4 && m.y === 11)).toBe(false)
    })

    it('knight can tackle ball-holder at L-destination', () => {
        const knight = mkPiece('knight', 'white', 2, 3)
        const rival = mkPiece('queen', 'black', 4, 4)
        const state = mkBoard({
            pieces: [knight, rival],
            ball: { pos: pos(4, 4), holderId: rival.id },
        })
        const moves = getValidMoves(knight, state)
        expect(moves.some(m => m.x === 4 && m.y === 4)).toBe(true)
    })
})
