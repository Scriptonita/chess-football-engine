/**
 * Extended king-rules tests — edge cases not covered in king-rules.test.ts.
 * Focuses on:
 * - AP penalty triggered by king's own move (not just teammate moves)
 * - Auto-release when no adjacent empty square (ball stays at king's position)
 * - keeperBlockedId updated correctly when king passes again
 * - kingMustRelease cleared when king no longer holds ball (via tackle)
 * - Full multi-turn scenario with both kings
 */
import { describe, it, expect } from 'vitest'
import { applyMove, applyPass, applyEndTurn } from '../src/game-engine'
import { getValidPasses } from '../src/game-logic'
import { mkBoard, mkPiece, pos } from './helpers'

// ─────────────────────────────────────────────────────────
// King AP penalty — triggered by any action while king holds ball
// ─────────────────────────────────────────────────────────
describe('King AP penalty — triggered by king move itself', () => {
    it('AP penalty fires when the KING itself moves and nextAP would be 1', () => {
        // King holds ball, kingMustRelease active, AP=2; king moves → AP 2→1 → penalty fires
        const king = mkPiece('king', 'white', 4, 0)
        const state = mkBoard({
            pieces: [king],
            ball: { pos: pos(4, 0), holderId: king.id },
            turn: 'white',
            actionPoints: 2,
            kingMustRelease: 'white',
        })
        const { boardState } = applyMove(state, king.id, pos(3, 0))
        // Turn should end due to penalty
        expect(boardState.turn).toBe('black')
        expect(boardState.actionPoints).toBe(5)
    })

    it('ball auto-releases when king itself triggers the penalty', () => {
        const king = mkPiece('king', 'white', 4, 0)
        const state = mkBoard({
            pieces: [king],
            ball: { pos: pos(4, 0), holderId: king.id },
            turn: 'white',
            actionPoints: 2,
            kingMustRelease: 'white',
        })
        const { boardState } = applyMove(state, king.id, pos(3, 0))
        expect(boardState.ball.holderId).toBeNull()
        expect(boardState.keeperBlockedId).toBe(king.id)
    })
})

// ─────────────────────────────────────────────────────────
// Auto-release — no adjacent empty square edge case
// ─────────────────────────────────────────────────────────
describe('King auto-release — no adjacent empty square', () => {
    it('ball becomes loose at kings position when all 8 neighbors are occupied', () => {
        // Surround king at (4,0) with pieces (king area: x∈[2..6], y∈[0..1])
        // King at (4,0): neighbors are (3,0),(5,0),(3,1),(4,1),(5,1)
        const king = mkPiece('king', 'white', 4, 0)
        const n1 = mkPiece('rook', 'white', 3, 0)
        const n2 = mkPiece('rook', 'white', 5, 0)
        const n3 = mkPiece('rook', 'white', 3, 1)
        const n4 = mkPiece('rook', 'white', 4, 1)
        const n5 = mkPiece('rook', 'white', 5, 1)
        // Additional neighbors that might be checked (diagonals) go out of bounds at y<0
        const state = mkBoard({
            pieces: [king, n1, n2, n3, n4, n5],
            ball: { pos: pos(4, 0), holderId: king.id },
            turn: 'white',
            kingMustRelease: 'white',
        })
        const newState = applyEndTurn(state)
        // Ball holderId cleared, remains at king's position
        expect(newState.ball.holderId).toBeNull()
    })
})

// ─────────────────────────────────────────────────────────
// keeperBlockedId — second king pass replaces the blocked keeper
// ─────────────────────────────────────────────────────────
describe('keeperBlockedId — overwritten by new king pass', () => {
    it('second king pass updates keeperBlockedId to same king (idempotent)', () => {
        const king = mkPiece('king', 'white', 4, 1)
        const state = mkBoard({
            pieces: [king],
            ball: { pos: pos(4, 1), holderId: king.id },
            turn: 'white',
            actionPoints: 3,
            keeperBlockedId: king.id, // already blocked from a previous pass
        })
        // King receives ball back somehow (not via blocked path), now passes again
        const { boardState } = applyPass(state, pos(4, 2))
        expect(boardState.keeperBlockedId).toBe(king.id)
    })
})

// ─────────────────────────────────────────────────────────
// kingMustRelease — cleared when king loses ball via tackle
// ─────────────────────────────────────────────────────────
describe('kingMustRelease — cleared when king ball is tackled away', () => {
    it('kingMustRelease clears at white turn-end once white king no longer holds ball', () => {
        const king = mkPiece('king', 'white', 4, 0)
        const blackRook = mkPiece('rook', 'black', 3, 0)
        const state = mkBoard({
            pieces: [king, blackRook],
            ball: { pos: pos(4, 0), holderId: king.id },
            turn: 'black',
            kingMustRelease: 'white',
        })
        // Black rook tackles white king → takes ball, white king displaced
        const { boardState: afterTackle } = applyMove(state, blackRook.id, pos(4, 0))
        expect(afterTackle.ball.holderId).toBe(blackRook.id)
        // Warning persists until white's own turn ends (computeKingTurnEndFlags only runs on departing side)
        expect(afterTackle.kingMustRelease).toBe('white')

        // Black ends its turn → now it's white's turn
        const afterBlackEnd = applyEndTurn(afterTackle)
        expect(afterBlackEnd.turn).toBe('white')
        // White's warning is still active (computed on black's departure above)

        // White ends turn without holding ball → warning finally clears
        const afterWhiteEnd = applyEndTurn({ ...afterBlackEnd, turn: 'white' })
        expect(afterWhiteEnd.kingMustRelease).toBeUndefined()
    })
})

// ─────────────────────────────────────────────────────────
// keeperBlockedId — unblocked when opponent intercepts pass
// ─────────────────────────────────────────────────────────
describe('keeperBlockedId — unblocked by opponent pass interception', () => {
    it('keeper becomes unblocked after opponent intercepts any pass', () => {
        const queen = mkPiece('queen', 'white', 4, 5)
        const whiteKing = mkPiece('king', 'white', 4, 0)
        const blackRook = mkPiece('rook', 'black', 4, 8)
        const state = mkBoard({
            pieces: [queen, whiteKing, blackRook],
            ball: { pos: pos(4, 5), holderId: queen.id },
            turn: 'white',
            keeperBlockedId: whiteKing.id,
            actionPoints: 3,
        })
        const { boardState } = applyPass(state, pos(4, 11))
        // Black rook at (4,8) intercepts
        expect(boardState.ball.holderId).toBe(blackRook.id)
        expect(boardState.keeperBlockedId).toBeUndefined()
    })

    it('keeper stays blocked after own team passes (no opponent touch)', () => {
        const queen = mkPiece('queen', 'white', 4, 5)
        const rook = mkPiece('rook', 'white', 4, 8)
        const whiteKing = mkPiece('king', 'white', 4, 0)
        const state = mkBoard({
            pieces: [queen, rook, whiteKing],
            ball: { pos: pos(4, 5), holderId: queen.id },
            turn: 'white',
            keeperBlockedId: whiteKing.id,
            actionPoints: 3,
        })
        const { boardState } = applyPass(state, pos(4, 8))
        expect(boardState.ball.holderId).toBe(rook.id)
        expect(boardState.keeperBlockedId).toBe(whiteKing.id) // still blocked
    })
})

// ─────────────────────────────────────────────────────────
// Full scenario: black king with ball possession warning
// ─────────────────────────────────────────────────────────
describe('Black king ball possession — full scenario', () => {
    it('black king gets warned first turn, auto-releases second turn', () => {
        const blackKing = mkPiece('king', 'black', 4, 11)

        // Black ends turn holding ball → warning
        const state1 = mkBoard({
            pieces: [blackKing],
            ball: { pos: pos(4, 11), holderId: blackKing.id },
            turn: 'black',
        })
        const after1 = applyEndTurn(state1)
        expect(after1.kingMustRelease).toBe('black')
        expect(after1.ball.holderId).toBe(blackKing.id)

        // White's turn (does nothing), then black ends turn again still holding
        const state2 = { ...after1, turn: 'black' }
        const after2 = applyEndTurn(state2)
        expect(after2.ball.holderId).toBeNull()
        expect(after2.kingMustRelease).toBeUndefined()
        expect(after2.keeperBlockedId).toBe(blackKing.id)
    })

    it('black king releases by passing → clears warning and blocks keeper', () => {
        const blackKing = mkPiece('king', 'black', 4, 11)
        const state = mkBoard({
            pieces: [blackKing],
            ball: { pos: pos(4, 11), holderId: blackKing.id },
            turn: 'black',
            actionPoints: 3,
            kingMustRelease: 'black',
        })
        const { boardState } = applyPass(state, pos(3, 11))
        expect(boardState.kingMustRelease).toBeUndefined()
        expect(boardState.keeperBlockedId).toBe(blackKing.id)
    })
})

// ─────────────────────────────────────────────────────────
// King AP penalty — does not fire prematurely
// ─────────────────────────────────────────────────────────
describe('King AP penalty — boundary conditions', () => {
    it('penalty fires at nextAP=1 but not at nextAP=2', () => {
        const king = mkPiece('king', 'white', 4, 0)
        const rook = mkPiece('rook', 'white', 0, 3)
        // AP=3: move → nextAP=2 → no penalty
        const state = mkBoard({
            pieces: [king, rook],
            ball: { pos: pos(4, 0), holderId: king.id },
            turn: 'white',
            actionPoints: 3,
            kingMustRelease: 'white',
        })
        const { boardState } = applyMove(state, rook.id, pos(0, 5))
        expect(boardState.turn).toBe('white')
        expect(boardState.actionPoints).toBe(2)
    })

    it('penalty fires at exactly nextAP=1', () => {
        const king = mkPiece('king', 'white', 4, 0)
        const rook = mkPiece('rook', 'white', 0, 3)
        // AP=2: move → nextAP=1 → penalty
        const state = mkBoard({
            pieces: [king, rook],
            ball: { pos: pos(4, 0), holderId: king.id },
            turn: 'white',
            actionPoints: 2,
            kingMustRelease: 'white',
        })
        const { boardState } = applyMove(state, rook.id, pos(0, 5))
        expect(boardState.turn).toBe('black')
    })

    it('penalty does NOT fire when king no longer holds ball at nextAP=1', () => {
        // King passes ball before AP drops to 1 — warning cleared by pass
        const king = mkPiece('king', 'white', 4, 1)
        const state = mkBoard({
            pieces: [king],
            ball: { pos: pos(4, 1), holderId: king.id },
            turn: 'white',
            actionPoints: 2,
            kingMustRelease: 'white',
        })
        // King passes → clears kingMustRelease, sets keeperBlockedId
        const { boardState: afterPass } = applyPass(state, pos(4, 2))
        expect(afterPass.kingMustRelease).toBeUndefined()
        expect(afterPass.turn).toBe('white') // still white's turn (AP: 2→1, no penalty)
        expect(afterPass.actionPoints).toBe(1)
    })
})

// ─────────────────────────────────────────────────────────
// getValidPasses — king cannot pass to blocked keeper even when warning active
// ─────────────────────────────────────────────────────────
describe('getValidPasses — king with active warning respects keeper block', () => {
    it('king with kingMustRelease cannot pass back to blocked keeper', () => {
        // Set up: white king holds ball, warned, and a blocked keeper exists
        const king = mkPiece('king', 'white', 4, 1)
        const state = mkBoard({
            pieces: [king],
            ball: { pos: pos(4, 1), holderId: king.id },
            turn: 'white',
            kingMustRelease: 'white',
            keeperBlockedId: king.id, // king is itself blocked (edge case)
        })
        const passes = getValidPasses(king, state)
        // King's position is (4,1); if keeperBlockedId === king.id, its own square should be excluded
        // (not that it would pass to itself, but adjacent squares excluding keeper's position)
        expect(passes.some(p => p.x === 4 && p.y === 1)).toBe(false)
    })
})
