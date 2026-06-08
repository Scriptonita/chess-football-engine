import { describe, it, expect } from 'vitest'
import { applyEndTurn, applyMove, applyPass } from '../src/game-engine'
import { getValidPasses } from '../src/game-logic'
import { mkBoard, mkPiece, pos } from './helpers'

// ─────────────────────────────────────────────────────────
// kingMustRelease — warning system
// A king that ends its turn holding the ball gets a warning (first turn).
// If it ends the NEXT turn still holding the ball, the ball is force-released.
// ─────────────────────────────────────────────────────────

describe('kingMustRelease — warning system', () => {
    it('sets kingMustRelease when white king ends turn holding ball (first time)', () => {
        const king = mkPiece('king', 'white', 4, 0)
        const state = mkBoard({
            pieces: [king],
            ball: { pos: pos(4, 0), holderId: king.id },
            turn: 'white',
        })
        const newState = applyEndTurn(state)
        expect(newState.kingMustRelease).toBe('white')
    })

    it('sets kingMustRelease when black king ends turn holding ball (first time)', () => {
        const king = mkPiece('king', 'black', 4, 11)
        const state = mkBoard({
            pieces: [king],
            ball: { pos: pos(4, 11), holderId: king.id },
            turn: 'black',
        })
        const newState = applyEndTurn(state)
        expect(newState.kingMustRelease).toBe('black')
    })

    it('auto-releases ball when king ends turn holding ball a second consecutive time', () => {
        const king = mkPiece('king', 'white', 4, 0)
        const state = mkBoard({
            pieces: [king],
            ball: { pos: pos(4, 0), holderId: king.id },
            turn: 'white',
            kingMustRelease: 'white', // already warned
        })
        const newState = applyEndTurn(state)
        expect(newState.ball.holderId).toBeNull()
        expect(newState.kingMustRelease).toBeUndefined()
        expect(newState.keeperBlockedId).toBe(king.id)
    })

    it('auto-released ball is placed on an adjacent square', () => {
        const king = mkPiece('king', 'white', 4, 0)
        const state = mkBoard({
            pieces: [king],
            ball: { pos: pos(4, 0), holderId: king.id },
            turn: 'white',
            kingMustRelease: 'white',
        })
        const newState = applyEndTurn(state)
        // Ball should move to an adjacent square, not stay at king's position
        const ballPos = newState.ball.pos
        const distX = Math.abs(ballPos.x - 4)
        const distY = Math.abs(ballPos.y - 0)
        expect(distX <= 1 && distY <= 1).toBe(true)
        expect(distX + distY).toBeGreaterThan(0) // not same square as king
    })

    it('clears kingMustRelease when king ends turn NOT holding ball', () => {
        const king = mkPiece('king', 'white', 4, 0)
        const state = mkBoard({
            pieces: [king],
            ball: { pos: pos(4, 5), holderId: null }, // ball is loose
            turn: 'white',
            kingMustRelease: 'white',
        })
        const newState = applyEndTurn(state)
        expect(newState.kingMustRelease).toBeUndefined()
    })

    it('preserves other side warning when non-warned side ends turn without king holding ball', () => {
        // White was warned; black ends turn without black king holding ball
        const blackKing = mkPiece('king', 'black', 4, 11)
        const state = mkBoard({
            pieces: [blackKing],
            ball: { pos: pos(4, 5), holderId: null },
            turn: 'black',
            kingMustRelease: 'white',
        })
        const newState = applyEndTurn(state)
        expect(newState.kingMustRelease).toBe('white') // white's warning persists
    })

    it('does not set kingMustRelease when king is not holding ball', () => {
        const king = mkPiece('king', 'white', 4, 0)
        const state = mkBoard({
            pieces: [king],
            ball: { pos: pos(4, 5), holderId: null },
            turn: 'white',
        })
        const newState = applyEndTurn(state)
        expect(newState.kingMustRelease).toBeUndefined()
    })
})

// ─────────────────────────────────────────────────────────
// keeperBlockedId — backpass prevention
// After the king passes the ball, it cannot receive a pass back
// until the opponent touches the ball.
// ─────────────────────────────────────────────────────────

describe('keeperBlockedId — backpass prevention', () => {
    it('applyPass by king sets keeperBlockedId to king id', () => {
        const king = mkPiece('king', 'white', 4, 1)
        const state = mkBoard({
            pieces: [king],
            ball: { pos: pos(4, 1), holderId: king.id },
            turn: 'white',
            actionPoints: 3,
        })
        const { boardState } = applyPass(state, pos(4, 2))
        expect(boardState.keeperBlockedId).toBe(king.id)
    })

    it('applyPass by king also clears kingMustRelease for that side if active', () => {
        const king = mkPiece('king', 'white', 4, 1)
        const state = mkBoard({
            pieces: [king],
            ball: { pos: pos(4, 1), holderId: king.id },
            turn: 'white',
            actionPoints: 3,
            kingMustRelease: 'white',
        })
        const { boardState } = applyPass(state, pos(3, 2))
        expect(boardState.keeperBlockedId).toBe(king.id)
        expect(boardState.kingMustRelease).toBeUndefined()
    })

    it('applyPass by non-king piece does not set keeperBlockedId', () => {
        const queen = mkPiece('queen', 'white', 4, 5)
        const state = mkBoard({
            pieces: [queen],
            ball: { pos: pos(4, 5), holderId: queen.id },
            actionPoints: 3,
        })
        const { boardState } = applyPass(state, pos(4, 8))
        expect(boardState.keeperBlockedId).toBeUndefined()
    })

    it('applyPass by non-king piece preserves existing keeperBlockedId', () => {
        const queen = mkPiece('queen', 'white', 4, 5)
        const king = mkPiece('king', 'white', 4, 0)
        const state = mkBoard({
            pieces: [queen, king],
            ball: { pos: pos(4, 5), holderId: queen.id },
            actionPoints: 3,
            keeperBlockedId: king.id,
        })
        const { boardState } = applyPass(state, pos(4, 8))
        expect(boardState.keeperBlockedId).toBe(king.id) // unchanged
    })

    it('getValidPasses excludes the blocked keeper position', () => {
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

    it('getValidPasses includes keeper position when block is not set', () => {
        const queen = mkPiece('queen', 'white', 4, 5)
        const king = mkPiece('king', 'white', 4, 0)
        const state = mkBoard({
            pieces: [queen, king],
            ball: { pos: pos(4, 5), holderId: queen.id },
        })
        const passes = getValidPasses(queen, state)
        expect(passes.some(p => p.x === 4 && p.y === 0)).toBe(true)
    })

    it('tackle by opponent clears keeperBlockedId', () => {
        const whiteKing = mkPiece('king', 'white', 4, 0)
        const whitePiece = mkPiece('queen', 'white', 4, 5)
        const blackRook = mkPiece('rook', 'black', 0, 5)
        const state = mkBoard({
            pieces: [whiteKing, whitePiece, blackRook],
            ball: { pos: pos(4, 5), holderId: whitePiece.id },
            turn: 'black',
            keeperBlockedId: whiteKing.id, // white keeper blocked
        })
        // Black rook tackles white queen (who holds ball)
        const { boardState } = applyMove(state, blackRook.id, pos(4, 5))
        expect(boardState.ball.holderId).toBe(blackRook.id)
        expect(boardState.keeperBlockedId).toBeUndefined()
    })

    it('tackle by own piece does NOT clear own keeperBlockedId', () => {
        // White rook tackles black queen; white keeper is blocked — should stay blocked
        const whiteKing = mkPiece('king', 'white', 4, 0)
        const blackPiece = mkPiece('queen', 'black', 4, 7)
        const whiteRook = mkPiece('rook', 'white', 0, 7)
        const state = mkBoard({
            pieces: [whiteKing, blackPiece, whiteRook],
            ball: { pos: pos(4, 7), holderId: blackPiece.id },
            turn: 'white',
            keeperBlockedId: whiteKing.id,
        })
        const { boardState } = applyMove(state, whiteRook.id, pos(4, 7))
        // White tackled → white keeper block persists (only opponent touching ball unblocks it)
        expect(boardState.keeperBlockedId).toBe(whiteKing.id)
    })

    it('interception by opponent clears keeperBlockedId', () => {
        const whiteKing = mkPiece('king', 'white', 4, 0)
        const whitePasser = mkPiece('queen', 'white', 4, 5)
        const blackInterceptor = mkPiece('rook', 'black', 4, 8)
        const state = mkBoard({
            pieces: [whiteKing, whitePasser, blackInterceptor],
            ball: { pos: pos(4, 5), holderId: whitePasser.id },
            turn: 'white',
            keeperBlockedId: whiteKing.id,
        })
        const { boardState } = applyPass(state, pos(4, 11))
        expect(boardState.ball.holderId).toBe(blackInterceptor.id)
        expect(boardState.keeperBlockedId).toBeUndefined()
    })

    it('interception that is a goal also clears keeperBlockedId', () => {
        // A pass that reaches the rival king directly (goal) also clears keeperBlockedId
        const whiteKing = mkPiece('king', 'white', 4, 0)
        const whitePasser = mkPiece('queen', 'white', 4, 5)
        const blackKing = mkPiece('king', 'black', 4, 11)
        const state = mkBoard({
            pieces: [whiteKing, whitePasser, blackKing],
            ball: { pos: pos(4, 5), holderId: whitePasser.id },
            turn: 'white',
            keeperBlockedId: whiteKing.id,
        })
        const { boardState, goalScored } = applyPass(state, pos(4, 11))
        expect(goalScored).toBe(true)
        expect(boardState.keeperBlockedId).toBeUndefined()
    })
})

// ─────────────────────────────────────────────────────────
// King AP penalty
// When kingMustRelease is active and the current move would leave exactly 1 AP,
// the turn ends immediately (using that last AP as a penalty).
// ─────────────────────────────────────────────────────────

describe('King AP penalty', () => {
    it('ends turn early when king holds ball, must release, and nextAP would be 1', () => {
        const king = mkPiece('king', 'white', 4, 0)
        const rook = mkPiece('rook', 'white', 0, 3)
        const state = mkBoard({
            pieces: [king, rook],
            ball: { pos: pos(4, 0), holderId: king.id },
            turn: 'white',
            actionPoints: 2,
            kingMustRelease: 'white',
        })
        // Move rook (not king): AP 2→1; king still holds ball + kingMustRelease → turn ends
        const { boardState } = applyMove(state, rook.id, pos(0, 5))
        expect(boardState.turn).toBe('black')
        expect(boardState.actionPoints).toBe(5)
    })

    it('penalty also auto-releases ball from king on forced turn end', () => {
        const king = mkPiece('king', 'white', 4, 0)
        const rook = mkPiece('rook', 'white', 0, 3)
        const state = mkBoard({
            pieces: [king, rook],
            ball: { pos: pos(4, 0), holderId: king.id },
            turn: 'white',
            actionPoints: 2,
            kingMustRelease: 'white',
        })
        const { boardState } = applyMove(state, rook.id, pos(0, 5))
        expect(boardState.ball.holderId).toBeNull()
        expect(boardState.keeperBlockedId).toBe(king.id)
    })

    it('does NOT trigger penalty when kingMustRelease is NOT set', () => {
        const king = mkPiece('king', 'white', 4, 0)
        const rook = mkPiece('rook', 'white', 0, 3)
        const state = mkBoard({
            pieces: [king, rook],
            ball: { pos: pos(4, 0), holderId: king.id },
            turn: 'white',
            actionPoints: 2,
            // No kingMustRelease
        })
        const { boardState } = applyMove(state, rook.id, pos(0, 5))
        expect(boardState.turn).toBe('white')
        expect(boardState.actionPoints).toBe(1)
    })

    it('does NOT trigger penalty when AP drops to 2 (only triggers at nextAP=1)', () => {
        const king = mkPiece('king', 'white', 4, 0)
        const rook = mkPiece('rook', 'white', 0, 3)
        const state = mkBoard({
            pieces: [king, rook],
            ball: { pos: pos(4, 0), holderId: king.id },
            turn: 'white',
            actionPoints: 3,
            kingMustRelease: 'white',
        })
        const { boardState } = applyMove(state, rook.id, pos(0, 5))
        // AP 3→2; nextAP=2 ≠ 1 → no penalty
        expect(boardState.turn).toBe('white')
        expect(boardState.actionPoints).toBe(2)
    })

    it('does NOT trigger penalty when king releases ball before AP drops to 1', () => {
        const king = mkPiece('king', 'white', 4, 1)
        const state = mkBoard({
            pieces: [king],
            ball: { pos: pos(4, 1), holderId: king.id },
            turn: 'white',
            actionPoints: 2,
            kingMustRelease: 'white',
        })
        // King passes ball away — ball no longer with king
        const { boardState } = applyPass(state, pos(4, 2))
        // Pass sets keeperBlockedId and clears kingMustRelease
        expect(boardState.kingMustRelease).toBeUndefined()
        expect(boardState.keeperBlockedId).toBe(king.id)
    })
})

// ─────────────────────────────────────────────────────────
// Full scenario: king holds ball across two turns
// ─────────────────────────────────────────────────────────

describe('King ball possession — full two-turn scenario', () => {
    it('warns first turn, auto-releases second turn', () => {
        const king = mkPiece('king', 'white', 4, 0)

        // Turn 1: white king ends turn holding ball → warning set
        const state1 = mkBoard({
            pieces: [king],
            ball: { pos: pos(4, 0), holderId: king.id },
            turn: 'white',
        })
        const afterTurn1 = applyEndTurn(state1)
        expect(afterTurn1.kingMustRelease).toBe('white')
        expect(afterTurn1.ball.holderId).toBe(king.id) // still holds ball

        // Turn 2: black does nothing (end turn), white king still holds ball
        const state2 = { ...afterTurn1, turn: 'black' }
        const afterBlack = applyEndTurn(state2)

        // Now white ends turn again still holding ball
        const state3 = { ...afterBlack, turn: 'white' }
        const afterTurn3 = applyEndTurn(state3)

        // Ball auto-released
        expect(afterTurn3.ball.holderId).toBeNull()
        expect(afterTurn3.kingMustRelease).toBeUndefined()
        expect(afterTurn3.keeperBlockedId).toBe(king.id)
    })
})
