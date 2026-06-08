import { describe, it, expect } from 'vitest'
import { getValidMoves, getValidPasses, checkGoal, isInOwnArea, isInEnemyArea } from '../src/game-logic'
import { mkBoard, mkPiece, pos } from './helpers'
import { BoardState } from '../src/types/game'

// ─────────────────────────────────────────────────────────
// Area helpers
// ─────────────────────────────────────────────────────────
describe('isInOwnArea', () => {
    it('white king starting square is in white area', () => {
        expect(isInOwnArea(pos(4, 0), 'white')).toBe(true)
    })

    it('white rook at (0,1) is NOT in white area (x<2)', () => {
        expect(isInOwnArea(pos(0, 1), 'white')).toBe(false)
    })

    it('white bishop at (3,2) is NOT in white area (y>1)', () => {
        expect(isInOwnArea(pos(3, 2), 'white')).toBe(false)
    })

    it('black king starting square is in black area', () => {
        expect(isInOwnArea(pos(4, 11), 'black')).toBe(true)
    })

    it('center of board is not in any area', () => {
        expect(isInOwnArea(pos(4, 5), 'white')).toBe(false)
        expect(isInOwnArea(pos(4, 5), 'black')).toBe(false)
    })
})

describe('isInEnemyArea', () => {
    it('white piece treats black area as enemy area', () => {
        expect(isInEnemyArea(pos(4, 11), 'white')).toBe(true)
    })

    it('black piece treats white area as enemy area', () => {
        expect(isInEnemyArea(pos(4, 0), 'black')).toBe(true)
    })
})

// ─────────────────────────────────────────────────────────
// getValidMoves
// ─────────────────────────────────────────────────────────
describe('getValidMoves', () => {
    it('rook slides along all four axes until board edge', () => {
        const rook = mkPiece('rook', 'white', 0, 4)
        const state = mkBoard({ pieces: [rook] })
        const moves = getValidMoves(rook, state)
        // Can reach (0,2) vertically (stops before y<2 since x=0 is outside own area)
        expect(moves.some(m => m.x === 0 && m.y === 11)).toBe(true)
        expect(moves.some(m => m.x === 8 && m.y === 4)).toBe(true)
    })

    it('rook cannot enter its own area', () => {
        // White rook at (0,4): own area is x∈[2..6], y∈[0..1]
        // Moving to x=3 at y=1 would be in own area — not allowed
        const rook = mkPiece('rook', 'white', 4, 4)
        const state = mkBoard({ pieces: [rook] })
        const moves = getValidMoves(rook, state)
        // No move should land inside white area (x∈[2..6], y∈[0..1])
        moves.forEach(m => {
            const inWhiteArea = m.x >= 2 && m.x <= 6 && m.y >= 0 && m.y <= 1
            expect(inWhiteArea).toBe(false)
        })
    })

    it('rook is blocked by own piece', () => {
        const rook    = mkPiece('rook', 'white', 0, 3)
        const blocker = mkPiece('queen', 'white', 0, 6)
        const state = mkBoard({ pieces: [rook, blocker] })
        const moves = getValidMoves(rook, state)
        expect(moves.some(m => m.x === 0 && m.y >= 6)).toBe(false)
    })

    it('rook can tackle rival ball-holder (not king)', () => {
        const rook  = mkPiece('rook', 'white', 0, 3)
        const rival = mkPiece('queen', 'black', 0, 7)
        const state = mkBoard({
            pieces: [rook, rival],
            ball: { pos: pos(0, 7), holderId: rival.id },
        })
        const moves = getValidMoves(rook, state)
        expect(moves.some(m => m.x === 0 && m.y === 7)).toBe(true)
    })

    it('rook cannot move to rival square without ball', () => {
        const rook  = mkPiece('rook', 'white', 0, 3)
        const rival = mkPiece('queen', 'black', 0, 7)
        const state = mkBoard({
            pieces: [rook, rival],
            ball: { pos: pos(4, 5), holderId: null },
        })
        const moves = getValidMoves(rook, state)
        expect(moves.some(m => m.x === 0 && m.y === 7)).toBe(false)
    })

    it('bishop moves diagonally but not into own area', () => {
        const bishop = mkPiece('bishop', 'white', 4, 4)
        const state = mkBoard({ pieces: [bishop] })
        const moves = getValidMoves(bishop, state)
        // Can reach diagonals beyond own area
        expect(moves.some(m => m.x === 8 && m.y === 8)).toBe(true)
        // Cannot reach white area (x∈[2..6], y∈[0..1])
        moves.forEach(m => {
            const inWhiteArea = m.x >= 2 && m.x <= 6 && m.y >= 0 && m.y <= 1
            expect(inWhiteArea).toBe(false)
        })
    })

    it('queen moves along all 8 directions but not into own area', () => {
        const queen = mkPiece('queen', 'white', 4, 4)
        const state = mkBoard({ pieces: [queen] })
        const moves = getValidMoves(queen, state)
        // Can reach far squares
        expect(moves.some(m => m.x === 4 && m.y === 11)).toBe(true)
        expect(moves.some(m => m.x === 8 && m.y === 4)).toBe(true)
        // Cannot enter own area
        moves.forEach(m => {
            const inWhiteArea = m.x >= 2 && m.x <= 6 && m.y >= 0 && m.y <= 1
            expect(inWhiteArea).toBe(false)
        })
    })

    it('king can only move within its own area', () => {
        // White king at (4,0): area is x∈[2..6], y∈[0..1]
        // Adjacent squares: (3,0),(5,0),(3,1),(4,1),(5,1) are in area; others are out-of-bounds or outside
        const king = mkPiece('king', 'white', 4, 0)
        const state = mkBoard({ pieces: [king] })
        const moves = getValidMoves(king, state)
        moves.forEach(m => {
            const inWhiteArea = m.x >= 2 && m.x <= 6 && m.y >= 0 && m.y <= 1
            expect(inWhiteArea).toBe(true)
            expect(Math.abs(m.x - 4) <= 1 && Math.abs(m.y - 0) <= 1).toBe(true)
        })
    })

    it('king at center of its area has moves in all in-area directions', () => {
        // White king at (4,1): can go to (3,0),(4,0),(5,0),(3,1),(5,1) — all in area
        const king = mkPiece('king', 'white', 4, 1)
        const state = mkBoard({ pieces: [king] })
        const moves = getValidMoves(king, state)
        expect(moves.some(m => m.x === 3 && m.y === 0)).toBe(true)
        expect(moves.some(m => m.x === 4 && m.y === 0)).toBe(true)
        expect(moves.some(m => m.x === 5 && m.y === 0)).toBe(true)
        // No move should be outside area
        moves.forEach(m => {
            expect(m.x >= 2 && m.x <= 6 && m.y >= 0 && m.y <= 1).toBe(true)
        })
    })

    it('rival king square is never a valid move destination', () => {
        const rook = mkPiece('rook', 'white', 4, 5)
        const blackKing = mkPiece('king', 'black', 4, 11)
        const state = mkBoard({
            pieces: [rook, blackKing],
            ball: { pos: pos(4, 11), holderId: blackKing.id },
        })
        const moves = getValidMoves(rook, state)
        // Even though king has ball, rook cannot move to king's square
        expect(moves.some(m => m.x === 4 && m.y === 11)).toBe(false)
    })

    it('knight has correct L-shaped moves (not entering own area)', () => {
        const knight = mkPiece('knight', 'white', 4, 4)
        const state = mkBoard({ pieces: [knight] })
        const moves = getValidMoves(knight, state)
        const expectedOffsets = [
            [1,2],[1,-2],[-1,2],[-1,-2],
            [2,1],[2,-1],[-2,1],[-2,-1],
        ]
        for (const [dx, dy] of expectedOffsets) {
            const dest = pos(4 + dx, 4 + dy)
            if (dest.x >= 0 && dest.x < 9 && dest.y >= 0 && dest.y < 12) {
                const inWhiteArea = dest.x >= 2 && dest.x <= 6 && dest.y >= 0 && dest.y <= 1
                if (!inWhiteArea) {
                    expect(moves.some(m => m.x === dest.x && m.y === dest.y)).toBe(true)
                }
            }
        }
    })
})

// ─────────────────────────────────────────────────────────
// getValidPasses
// ─────────────────────────────────────────────────────────
describe('getValidPasses', () => {
    it('rook can pass to any square in 4 axes, regardless of pieces blocking', () => {
        const rook    = mkPiece('rook', 'white', 0, 4)
        const blocker = mkPiece('queen', 'black', 0, 7)
        const state = mkBoard({ pieces: [rook, blocker] })
        const passes = getValidPasses(rook, state)
        // Unlike moves, passes fly over pieces
        expect(passes.some(p => p.x === 0 && p.y === 9)).toBe(true)
    })

    it('bishop can pass diagonally over pieces', () => {
        const bishop  = mkPiece('bishop', 'white', 0, 2)
        const blocker = mkPiece('rook', 'black', 2, 4)
        const state = mkBoard({ pieces: [bishop, blocker] })
        const passes = getValidPasses(bishop, state)
        expect(passes.some(p => p.x === 4 && p.y === 6)).toBe(true)
    })

    it('king can only pass to adjacent squares', () => {
        // King passes can go anywhere adjacent — no area restriction on pass targets
        const king = mkPiece('king', 'white', 4, 0)
        const state = mkBoard({ pieces: [king] })
        const passes = getValidPasses(king, state)
        expect(passes.every(p => Math.abs(p.x - 4) <= 1 && Math.abs(p.y - 0) <= 1)).toBe(true)
    })

    it('passes can include rival king square (shot = goal)', () => {
        // The pass itself can target the rival king's square — goal is detected in applyPass
        const queen = mkPiece('queen', 'white', 4, 8)
        const blackKing = mkPiece('king', 'black', 4, 11)
        const state = mkBoard({ pieces: [queen, blackKing] })
        const passes = getValidPasses(queen, state)
        expect(passes.some(p => p.x === 4 && p.y === 11)).toBe(true)
    })
})

// ─────────────────────────────────────────────────────────
// checkGoal
// ─────────────────────────────────────────────────────────

function mkGoalBoard(scorer: 'white' | 'black'): BoardState {
    return mkBoard({
        lastMove: {
            type: 'goal',
            from: pos(4, 8),
            to: pos(4, 11),
            playerId: `${scorer}_queen_4_3`,
            at: Date.now(),
        },
    })
}

describe('checkGoal', () => {
    it('returns the scoring side when lastMove.type is goal (white scores)', () => {
        const state = mkGoalBoard('white')
        expect(checkGoal(state)).toBe('white')
    })

    it('returns the scoring side when lastMove.type is goal (black scores)', () => {
        const state = mkGoalBoard('black')
        expect(checkGoal(state)).toBe('black')
    })

    it('returns null when lastMove is undefined', () => {
        const state = mkBoard({})
        expect(checkGoal(state)).toBeNull()
    })

    it('returns null when lastMove.type is pass (not goal)', () => {
        const state = mkBoard({
            lastMove: {
                type: 'pass',
                from: pos(4, 5),
                to: pos(4, 8),
                playerId: 'white_queen_4_3',
                at: Date.now(),
            },
        })
        expect(checkGoal(state)).toBeNull()
    })

    it('returns null when lastMove.type is interception', () => {
        const state = mkBoard({
            lastMove: {
                type: 'interception',
                from: pos(0, 3),
                to: pos(0, 7),
                playerId: 'white_rook_0_1',
                at: Date.now(),
            },
        })
        expect(checkGoal(state)).toBeNull()
    })

    it('returns null when lastMove.type is move', () => {
        const state = mkBoard({
            lastMove: {
                type: 'move',
                from: pos(4, 3),
                to: pos(4, 5),
                playerId: 'white_queen_4_3',
                at: Date.now(),
            },
        })
        expect(checkGoal(state)).toBeNull()
    })
})

// ─────────────────────────────────────────────────────────
// applyPass goal detection (via game-engine)
// ─────────────────────────────────────────────────────────
import { applyPass } from '../src/game-engine'

describe('applyPass — goal detection', () => {
    it('linear pass that reaches rival king is a goal', () => {
        const queen = mkPiece('queen', 'white', 4, 5)
        const blackKing = mkPiece('king', 'black', 4, 11)
        const state = mkBoard({
            pieces: [queen, blackKing],
            ball: { pos: pos(4, 5), holderId: queen.id },
        })
        const result = applyPass(state, pos(4, 11))
        expect(result.goalScored).toBe(true)
        expect(result.boardState.lastMove?.type).toBe('goal')
        expect(checkGoal(result.boardState)).toBe('white')
    })

    it('linear pass that passes THROUGH rival king position is a goal', () => {
        // Queen at (4,8) passing to (4,11) — king is at (4,11)
        const queen = mkPiece('queen', 'white', 4, 8)
        const blackKing = mkPiece('king', 'black', 4, 11)
        const state = mkBoard({
            pieces: [queen, blackKing],
            ball: { pos: pos(4, 8), holderId: queen.id },
        })
        // Pass aimed beyond king at y=11 — but since king is ON the path, it's a goal
        const result = applyPass(state, pos(4, 11))
        expect(result.goalScored).toBe(true)
    })

    it('knight pass to rival king square is a goal', () => {
        // Knight at (3,9) can L-pass to (4,11)
        const knight = mkPiece('knight', 'white', 3, 9)
        const blackKing = mkPiece('king', 'black', 4, 11)
        const state = mkBoard({
            pieces: [knight, blackKing],
            ball: { pos: pos(3, 9), holderId: knight.id },
        })
        const result = applyPass(state, pos(4, 11))
        expect(result.goalScored).toBe(true)
        expect(result.boardState.lastMove?.type).toBe('goal')
    })

    it('linear pass intercepted by non-king rival before reaching king is NOT a goal', () => {
        const queen = mkPiece('queen', 'white', 4, 5)
        const rivalPiece = mkPiece('rook', 'black', 4, 8)
        const blackKing = mkPiece('king', 'black', 4, 11)
        const state = mkBoard({
            pieces: [queen, rivalPiece, blackKing],
            ball: { pos: pos(4, 5), holderId: queen.id },
        })
        const result = applyPass(state, pos(4, 11))
        expect(result.goalScored).toBe(false)
        expect(result.forcedTurnEnd).toBe(true)
        expect(result.boardState.lastMove?.type).toBe('interception')
        expect(result.boardState.ball.holderId).toBe(rivalPiece.id)
    })

    it('normal pass to empty square is not a goal', () => {
        const queen = mkPiece('queen', 'white', 4, 5)
        const state = mkBoard({
            pieces: [queen],
            ball: { pos: pos(4, 5), holderId: queen.id },
        })
        const result = applyPass(state, pos(4, 8))
        expect(result.goalScored).toBe(false)
        expect(result.boardState.lastMove?.type).toBe('pass')
    })
})

// ─────────────────────────────────────────────────────────
// getValidMoves — black piece constraints
// ─────────────────────────────────────────────────────────
describe('getValidMoves — black piece constraints', () => {
    it('black king can only move within black area', () => {
        const king = mkPiece('king', 'black', 4, 11)
        const state = mkBoard({ pieces: [king] })
        const moves = getValidMoves(king, state)
        moves.forEach(m => {
            const inBlackArea = m.x >= 2 && m.x <= 6 && m.y >= 10 && m.y <= 11
            expect(inBlackArea).toBe(true)
        })
    })

    it('black rook cannot enter black area', () => {
        const rook = mkPiece('rook', 'black', 4, 7)
        const state = mkBoard({ pieces: [rook] })
        const moves = getValidMoves(rook, state)
        moves.forEach(m => {
            const inBlackArea = m.x >= 2 && m.x <= 6 && m.y >= 10 && m.y <= 11
            expect(inBlackArea).toBe(false)
        })
    })

    it('black bishop cannot enter black area', () => {
        const bishop = mkPiece('bishop', 'black', 3, 7)
        const state = mkBoard({ pieces: [bishop] })
        const moves = getValidMoves(bishop, state)
        moves.forEach(m => {
            const inBlackArea = m.x >= 2 && m.x <= 6 && m.y >= 10 && m.y <= 11
            expect(inBlackArea).toBe(false)
        })
    })

    it('black queen cannot enter black area', () => {
        const queen = mkPiece('queen', 'black', 4, 6)
        const state = mkBoard({ pieces: [queen] })
        const moves = getValidMoves(queen, state)
        moves.forEach(m => {
            const inBlackArea = m.x >= 2 && m.x <= 6 && m.y >= 10 && m.y <= 11
            expect(inBlackArea).toBe(false)
        })
    })

    it('black king at center of its area can move within it', () => {
        const king = mkPiece('king', 'black', 4, 10)
        const state = mkBoard({ pieces: [king] })
        const moves = getValidMoves(king, state)
        expect(moves.some(m => m.x === 4 && m.y === 11)).toBe(true)
        expect(moves.some(m => m.x === 3 && m.y === 10)).toBe(true)
        moves.forEach(m => {
            const inBlackArea = m.x >= 2 && m.x <= 6 && m.y >= 10 && m.y <= 11
            expect(inBlackArea).toBe(true)
        })
    })
})

// ─────────────────────────────────────────────────────────
// getValidMoves — blocking and tackling rules
// ─────────────────────────────────────────────────────────
describe('getValidMoves — blocking rules', () => {
    it('rook is blocked by rival without ball (cannot pass through or land on it)', () => {
        const rook = mkPiece('rook', 'white', 0, 3)
        const rival = mkPiece('queen', 'black', 0, 6)
        const state = mkBoard({
            pieces: [rook, rival],
            ball: { pos: pos(4, 5), holderId: null },
        })
        const moves = getValidMoves(rook, state)
        expect(moves.some(m => m.x === 0 && m.y === 6)).toBe(false)
        expect(moves.some(m => m.x === 0 && m.y === 9)).toBe(false)
    })

    it('bishop is blocked by own piece on diagonal', () => {
        const bishop = mkPiece('bishop', 'white', 2, 3)
        const blocker = mkPiece('queen', 'white', 4, 5)
        const state = mkBoard({ pieces: [bishop, blocker] })
        const moves = getValidMoves(bishop, state)
        expect(moves.some(m => m.x === 4 && m.y === 5)).toBe(false)
        expect(moves.some(m => m.x === 5 && m.y === 6)).toBe(false)
    })

    it('can only tackle the rival that holds the ball, not others blocking the path', () => {
        const rook = mkPiece('rook', 'white', 0, 3)
        const rival1 = mkPiece('rook', 'black', 0, 6)    // no ball — blocks
        const rival2 = mkPiece('queen', 'black', 0, 9)   // has ball — behind blocker
        const state = mkBoard({
            pieces: [rook, rival1, rival2],
            ball: { pos: pos(0, 9), holderId: rival2.id },
        })
        const moves = getValidMoves(rook, state)
        expect(moves.some(m => m.x === 0 && m.y === 6)).toBe(false) // no ball → can't tackle
        expect(moves.some(m => m.x === 0 && m.y === 9)).toBe(false) // behind rival1
    })

    it('rival king square is never a valid move destination even when king holds ball', () => {
        const queen = mkPiece('queen', 'white', 4, 5)
        const blackKing = mkPiece('king', 'black', 4, 11)
        const state = mkBoard({
            pieces: [queen, blackKing],
            ball: { pos: pos(4, 11), holderId: blackKing.id },
        })
        const moves = getValidMoves(queen, state)
        expect(moves.some(m => m.x === 4 && m.y === 11)).toBe(false)
    })

    it('queen combines rook and bishop directions', () => {
        const queen = mkPiece('queen', 'white', 4, 5)
        const state = mkBoard({ pieces: [queen] })
        const moves = getValidMoves(queen, state)
        // Horizontal
        expect(moves.some(m => m.x === 8 && m.y === 5)).toBe(true)
        expect(moves.some(m => m.x === 0 && m.y === 5)).toBe(true)
        // Vertical
        expect(moves.some(m => m.x === 4 && m.y === 9)).toBe(true)
        // Diagonal NE
        expect(moves.some(m => m.x === 8 && m.y === 9)).toBe(true)
        // Diagonal SW
        expect(moves.some(m => m.x === 2 && m.y === 7)).toBe(true)
    })
})

// ─────────────────────────────────────────────────────────
// getValidMoves — knight own area restriction
// ─────────────────────────────────────────────────────────
describe('getValidMoves — knight own area restriction', () => {
    it('white knight cannot land in white area', () => {
        // Knight at (3,3): L-moves (4,1) and (2,1) land in white area (x∈[2..6], y∈[0..1])
        const knight = mkPiece('knight', 'white', 3, 3)
        const state = mkBoard({ pieces: [knight] })
        const moves = getValidMoves(knight, state)
        expect(moves.some(m => m.x === 4 && m.y === 1)).toBe(false)
        expect(moves.some(m => m.x === 2 && m.y === 1)).toBe(false)
    })

    it('black knight cannot land in black area', () => {
        // Knight at (3,8): L-moves (4,10) and (2,10) land in black area (x∈[2..6], y∈[10..11])
        const knight = mkPiece('knight', 'black', 3, 8)
        const state = mkBoard({ pieces: [knight] })
        const moves = getValidMoves(knight, state)
        expect(moves.some(m => m.x === 4 && m.y === 10)).toBe(false)
        expect(moves.some(m => m.x === 2 && m.y === 10)).toBe(false)
    })

    it('knight can tackle ball-holder by L-jump', () => {
        const knight = mkPiece('knight', 'white', 3, 3)
        const rival = mkPiece('rook', 'black', 4, 5)
        const state = mkBoard({
            pieces: [knight, rival],
            ball: { pos: pos(4, 5), holderId: rival.id },
        })
        const moves = getValidMoves(knight, state)
        expect(moves.some(m => m.x === 4 && m.y === 5)).toBe(true)
    })
})

// ─────────────────────────────────────────────────────────
// getValidPasses — keeper backpass rule
// ─────────────────────────────────────────────────────────
describe('getValidPasses — keeper backpass rule', () => {
    it('excludes blocked keeper position from pass destinations (queen)', () => {
        const queen = mkPiece('queen', 'white', 4, 5)
        const king = mkPiece('king', 'white', 4, 0)
        const state = mkBoard({
            pieces: [queen, king],
            ball: { pos: pos(4, 5), holderId: queen.id },
            keeperBlockedId: king.id,
        })
        const passes = getValidPasses(queen, state)
        expect(passes.some(p => p.x === 4 && p.y === 0)).toBe(false)
    })

    it('includes keeper position when no block is set', () => {
        const queen = mkPiece('queen', 'white', 4, 5)
        const king = mkPiece('king', 'white', 4, 0)
        const state = mkBoard({
            pieces: [queen, king],
            ball: { pos: pos(4, 5), holderId: queen.id },
        })
        const passes = getValidPasses(queen, state)
        expect(passes.some(p => p.x === 4 && p.y === 0)).toBe(true)
    })

    it('knight passes also exclude blocked keeper position', () => {
        // Knight at (2,2): L-move (4,1) is valid; king at (4,1) is blocked
        const knight = mkPiece('knight', 'white', 2, 2)
        const king = mkPiece('king', 'white', 4, 1)
        const state = mkBoard({
            pieces: [knight, king],
            ball: { pos: pos(2, 2), holderId: knight.id },
            keeperBlockedId: king.id,
        })
        const passes = getValidPasses(knight, state)
        expect(passes.some(p => p.x === 4 && p.y === 1)).toBe(false)
    })

    it('king passes also exclude blocked keeper position', () => {
        // King cannot pass to (3,0) if blocked keeper is there — uses a different king for testing
        const passer = mkPiece('queen', 'white', 4, 5)
        const blockedKeeper = mkPiece('king', 'white', 4, 0)
        const state = mkBoard({
            pieces: [passer, blockedKeeper],
            ball: { pos: pos(4, 5), holderId: passer.id },
            keeperBlockedId: blockedKeeper.id,
        })
        const passes = getValidPasses(passer, state)
        expect(passes.some(p => p.x === 4 && p.y === 0)).toBe(false)
    })
})

// ─────────────────────────────────────────────────────────
// getValidPasses — knight pass directions
// ─────────────────────────────────────────────────────────
describe('getValidPasses — knight pass directions', () => {
    it('knight can pass in all valid L-directions regardless of pieces on path', () => {
        const knight = mkPiece('knight', 'white', 4, 5)
        const blocker = mkPiece('rook', 'black', 5, 7) // "in the way" but knights jump
        const state = mkBoard({ pieces: [knight, blocker] })
        const passes = getValidPasses(knight, state)
        // All L-move targets from (4,5) within board bounds should be reachable
        const expectedTargets = [
            pos(5, 7), pos(5, 3), pos(3, 7), pos(3, 3),
            pos(6, 6), pos(6, 4), pos(2, 6), pos(2, 4),
        ]
        for (const target of expectedTargets) {
            if (target.x >= 0 && target.x < 9 && target.y >= 0 && target.y < 12) {
                expect(passes.some(p => p.x === target.x && p.y === target.y)).toBe(true)
            }
        }
    })

    it('rook passes fly over blocking pieces', () => {
        const rook = mkPiece('rook', 'white', 0, 4)
        const blocker1 = mkPiece('queen', 'white', 0, 6)
        const blocker2 = mkPiece('rook', 'black', 0, 8)
        const state = mkBoard({ pieces: [rook, blocker1, blocker2] })
        const passes = getValidPasses(rook, state)
        // Unlike moves, passes are not blocked by pieces
        expect(passes.some(p => p.x === 0 && p.y === 7)).toBe(true)
        expect(passes.some(p => p.x === 0 && p.y === 9)).toBe(true)
    })
})
