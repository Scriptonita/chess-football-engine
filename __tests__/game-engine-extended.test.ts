/**
 * Extended game-engine tests — covers rules not already in game-engine.test.ts:
 * - moveHistory appended and capped
 * - turnNumber increments
 * - maxActionPoints respected
 * - King picks up loose ball by moving to it
 * - Tackle displacement edge cases
 * - applyEndTurn with custom AP
 * - Ball interaction edge cases
 */
import { describe, it, expect } from 'vitest'
import { applyMove, applyPass, applyEndTurn, getPath } from '../src/game-engine'
import { mkBoard, mkPiece, pos } from './helpers'

// ─────────────────────────────────────────────────────────
// moveHistory — append and cap
// ─────────────────────────────────────────────────────────
describe('moveHistory — appended on every action', () => {
    it('applyMove appends to moveHistory', () => {
        const rook = mkPiece('rook', 'white', 0, 3)
        const state = mkBoard({ pieces: [rook], moveHistory: [] })
        const { boardState } = applyMove(state, rook.id, pos(0, 5))
        expect(boardState.moveHistory).toHaveLength(1)
        expect(boardState.moveHistory[0].type).toBe('move')
        expect(boardState.moveHistory[0].pieceType).toBe('rook')
        expect(boardState.moveHistory[0].pieceSide).toBe('white')
        expect(boardState.moveHistory[0].from).toEqual(pos(0, 3))
        expect(boardState.moveHistory[0].to).toEqual(pos(0, 5))
    })

    it('applyPass appends to moveHistory', () => {
        const queen = mkPiece('queen', 'white', 4, 5)
        const state = mkBoard({
            pieces: [queen],
            ball: { pos: pos(4, 5), holderId: queen.id },
            moveHistory: [],
        })
        const { boardState } = applyPass(state, pos(4, 8))
        expect(boardState.moveHistory).toHaveLength(1)
        expect(boardState.moveHistory[0].type).toBe('pass')
        expect(boardState.moveHistory[0].pieceType).toBe('queen')
    })

    it('tackle appends type tackle to moveHistory', () => {
        const rook = mkPiece('rook', 'white', 0, 3)
        const rival = mkPiece('queen', 'black', 0, 7)
        const state = mkBoard({
            pieces: [rook, rival],
            ball: { pos: pos(0, 7), holderId: rival.id },
            moveHistory: [],
        })
        const { boardState } = applyMove(state, rook.id, pos(0, 7))
        expect(boardState.moveHistory[0].type).toBe('tackle')
    })

    it('interception appends type interception to moveHistory', () => {
        const passer = mkPiece('rook', 'white', 0, 3)
        const rival = mkPiece('rook', 'black', 0, 6)
        const state = mkBoard({
            pieces: [passer, rival],
            ball: { pos: pos(0, 3), holderId: passer.id },
            moveHistory: [],
        })
        const { boardState } = applyPass(state, pos(0, 9))
        expect(boardState.moveHistory[0].type).toBe('interception')
    })

    it('goal appends type goal to moveHistory', () => {
        const queen = mkPiece('queen', 'white', 4, 5)
        const blackKing = mkPiece('king', 'black', 4, 11)
        const state = mkBoard({
            pieces: [queen, blackKing],
            ball: { pos: pos(4, 5), holderId: queen.id },
            moveHistory: [],
        })
        const { boardState } = applyPass(state, pos(4, 11))
        expect(boardState.moveHistory[0].type).toBe('goal')
    })

    it('multiple moves accumulate in moveHistory', () => {
        const rook = mkPiece('rook', 'white', 0, 3)
        let state = mkBoard({ pieces: [rook], actionPoints: 5, moveHistory: [] })
        state = applyMove(state, rook.id, pos(0, 4)).boardState
        state = applyMove(state, rook.id, pos(0, 5)).boardState
        expect(state.moveHistory).toHaveLength(2)
    })

    it('moveHistory is capped at 60 entries', () => {
        const rook = mkPiece('rook', 'white', 0, 4)
        // Pre-fill history with 60 entries
        const existingHistory = Array.from({ length: 60 }, (_, i) => ({
            type: 'move' as const,
            pieceType: 'rook' as const,
            pieceSide: 'white' as const,
            from: pos(0, 3),
            to: pos(0, 4),
            at: Date.now() - i * 1000,
            turnNumber: i + 1,
        }))
        const state = mkBoard({
            pieces: [rook],
            moveHistory: existingHistory,
            actionPoints: 5,
        })
        const { boardState } = applyMove(state, rook.id, pos(0, 5))
        // Should still be 60 (oldest removed, newest added)
        expect(boardState.moveHistory).toHaveLength(60)
        // Last entry should be the new move
        expect(boardState.moveHistory[59].to).toEqual(pos(0, 5))
    })

    it('moveHistory entries include turnNumber', () => {
        const rook = mkPiece('rook', 'white', 0, 3)
        const state = mkBoard({ pieces: [rook], turnNumber: 7, moveHistory: [] })
        const { boardState } = applyMove(state, rook.id, pos(0, 5))
        expect(boardState.moveHistory[0].turnNumber).toBe(7)
    })
})

// ─────────────────────────────────────────────────────────
// turnNumber — increments on every turn switch
// ─────────────────────────────────────────────────────────
describe('turnNumber increments on turn switch', () => {
    it('applyMove increments turnNumber when AP reaches 0', () => {
        const rook = mkPiece('rook', 'white', 0, 3)
        const state = mkBoard({ pieces: [rook], actionPoints: 1, turnNumber: 3 })
        const { boardState } = applyMove(state, rook.id, pos(0, 5))
        expect(boardState.turnNumber).toBe(4)
    })

    it('applyMove does NOT increment turnNumber mid-turn', () => {
        const rook = mkPiece('rook', 'white', 0, 3)
        const state = mkBoard({ pieces: [rook], actionPoints: 3, turnNumber: 3 })
        const { boardState } = applyMove(state, rook.id, pos(0, 5))
        expect(boardState.turnNumber).toBe(3)
    })

    it('applyPass increments turnNumber on forced turn end (interception)', () => {
        const passer = mkPiece('rook', 'white', 0, 3)
        const rival = mkPiece('rook', 'black', 0, 6)
        const state = mkBoard({
            pieces: [passer, rival],
            ball: { pos: pos(0, 3), holderId: passer.id },
            actionPoints: 4,
            turnNumber: 5,
        })
        const { boardState } = applyPass(state, pos(0, 9))
        expect(boardState.turnNumber).toBe(6)
    })

    it('applyEndTurn increments turnNumber', () => {
        const state = mkBoard({ turnNumber: 2 })
        const newState = applyEndTurn(state)
        expect(newState.turnNumber).toBe(3)
    })
})

// ─────────────────────────────────────────────────────────
// maxActionPoints — custom AP reset value
// ─────────────────────────────────────────────────────────
describe('maxActionPoints — custom AP reset', () => {
    it('applyMove resets AP to maxActionPoints (not 5) on turn end', () => {
        const rook = mkPiece('rook', 'white', 0, 3)
        const state = mkBoard({
            pieces: [rook],
            actionPoints: 1,
            maxActionPoints: 3,
        })
        const { boardState } = applyMove(state, rook.id, pos(0, 5))
        expect(boardState.actionPoints).toBe(3)
    })

    it('applyPass resets AP to maxActionPoints on forced turn end', () => {
        const queen = mkPiece('queen', 'white', 4, 5)
        const blackKing = mkPiece('king', 'black', 4, 11)
        const state = mkBoard({
            pieces: [queen, blackKing],
            ball: { pos: pos(4, 5), holderId: queen.id },
            actionPoints: 4,
            maxActionPoints: 2,
        })
        const { boardState } = applyPass(state, pos(4, 11))
        expect(boardState.actionPoints).toBe(2)
    })

    it('applyEndTurn resets AP to maxActionPoints', () => {
        const state = mkBoard({ actionPoints: 2, maxActionPoints: 3 })
        expect(applyEndTurn(state).actionPoints).toBe(3)
    })

    it('when maxActionPoints is undefined, AP resets to 5', () => {
        const rook = mkPiece('rook', 'white', 0, 3)
        const state = mkBoard({ pieces: [rook], actionPoints: 1 })
        const { boardState } = applyMove(state, rook.id, pos(0, 5))
        expect(boardState.actionPoints).toBe(5)
    })
})

// ─────────────────────────────────────────────────────────
// King picks up loose ball by moving to it
// ─────────────────────────────────────────────────────────
describe('king picks up loose ball', () => {
    it('king moving to loose ball square picks it up (linear piece)', () => {
        const king = mkPiece('king', 'white', 4, 0)
        const state = mkBoard({
            pieces: [king],
            ball: { pos: pos(4, 1), holderId: null }, // loose ball in own area
        })
        const { boardState } = applyMove(state, king.id, pos(4, 1))
        expect(boardState.ball.holderId).toBe(king.id)
        expect(boardState.ball.pos).toEqual(pos(4, 1))
    })

    it('king picks up ball on path when moving through it', () => {
        // King at (4,0) moving to (4,1) — ball is at (4,1) which is the destination
        const king = mkPiece('king', 'white', 3, 0)
        const state = mkBoard({
            pieces: [king],
            ball: { pos: pos(4, 0), holderId: null }, // adjacent to king
        })
        // King moves to (4,0) — same as ball position
        const { boardState } = applyMove(state, king.id, pos(4, 0))
        expect(boardState.ball.holderId).toBe(king.id)
    })
})

// ─────────────────────────────────────────────────────────
// Ball capture on path — edge cases
// ─────────────────────────────────────────────────────────
describe('applyMove — ball capture edge cases', () => {
    it('rook moving to square BEFORE the ball does not capture it', () => {
        // Rook at (0,3), ball at (0,7), rook moves to (0,5)
        const rook = mkPiece('rook', 'white', 0, 3)
        const state = mkBoard({
            pieces: [rook],
            ball: { pos: pos(0, 7), holderId: null },
        })
        const { boardState } = applyMove(state, rook.id, pos(0, 5))
        // Ball at (0,7) not on path [3→5] which is (0,4),(0,5)
        expect(boardState.ball.holderId).toBeNull()
        expect(boardState.ball.pos).toEqual(pos(0, 7))
    })

    it('queen picks up ball at any point on its path', () => {
        // Queen at (0,3), ball at (4,3), queen moves to (7,3)
        const queen = mkPiece('queen', 'white', 0, 3)
        const state = mkBoard({
            pieces: [queen],
            ball: { pos: pos(4, 3), holderId: null },
        })
        const { boardState } = applyMove(state, queen.id, pos(7, 3))
        expect(boardState.ball.holderId).toBe(queen.id)
    })

    it('bishop does NOT pick up ball that is not on its diagonal path', () => {
        // Bishop at (2,2) going NE to (6,6); ball at (4,3) — not on diagonal
        const bishop = mkPiece('bishop', 'white', 2, 2)
        const state = mkBoard({
            pieces: [bishop],
            ball: { pos: pos(4, 3), holderId: null },
        })
        const { boardState } = applyMove(state, bishop.id, pos(6, 6))
        expect(boardState.ball.holderId).toBeNull()
    })
})

// ─────────────────────────────────────────────────────────
// Tackle — displacement edge cases
// ─────────────────────────────────────────────────────────
describe('applyMove — tackle displacement', () => {
    it('displaced rival gets moved to an adjacent empty square', () => {
        const attacker = mkPiece('rook', 'white', 0, 3)
        const defender = mkPiece('queen', 'black', 0, 7)
        const state = mkBoard({
            pieces: [attacker, defender],
            ball: { pos: pos(0, 7), holderId: defender.id },
        })
        const { boardState } = applyMove(state, attacker.id, pos(0, 7))
        const displacedDefender = boardState.pieces.find(p => p.id === defender.id)!
        // Defender must be adjacent to the tackle square (0,7)
        const dist = Math.abs(displacedDefender.pos.x - 0) + Math.abs(displacedDefender.pos.y - 7)
        expect(dist).toBe(1) // exactly 1 step away
        expect(displacedDefender.pos).not.toEqual(pos(0, 7))
    })

    it('tackler takes possession of the ball', () => {
        const attacker = mkPiece('rook', 'white', 4, 3)
        const defender = mkPiece('queen', 'black', 4, 7)
        const state = mkBoard({
            pieces: [attacker, defender],
            ball: { pos: pos(4, 7), holderId: defender.id },
        })
        const { boardState, moveType } = applyMove(state, attacker.id, pos(4, 7))
        expect(moveType).toBe('tackle')
        expect(boardState.ball.holderId).toBe(attacker.id)
        expect(boardState.ball.pos).toEqual(pos(4, 7))
    })

    it('tackle decrements AP', () => {
        const attacker = mkPiece('rook', 'white', 0, 3)
        const defender = mkPiece('queen', 'black', 0, 7)
        const state = mkBoard({
            pieces: [attacker, defender],
            ball: { pos: pos(0, 7), holderId: defender.id },
            actionPoints: 4,
        })
        const { boardState } = applyMove(state, attacker.id, pos(0, 7))
        expect(boardState.actionPoints).toBe(3)
    })
})

// ─────────────────────────────────────────────────────────
// applyPass — teammate at destination picks up ball
// ─────────────────────────────────────────────────────────
describe('applyPass — teammate reception', () => {
    it('king receiving a pass picks up the ball', () => {
        const queen = mkPiece('queen', 'white', 4, 5)
        const king = mkPiece('king', 'white', 4, 0)
        const state = mkBoard({
            pieces: [queen, king],
            ball: { pos: pos(4, 5), holderId: queen.id },
            actionPoints: 3,
        })
        const { boardState } = applyPass(state, pos(4, 0))
        expect(boardState.ball.holderId).toBe(king.id)
        expect(boardState.ball.pos).toEqual(pos(4, 0))
    })

    it('pass to empty square leaves ball loose at destination', () => {
        const rook = mkPiece('rook', 'white', 0, 3)
        const state = mkBoard({
            pieces: [rook],
            ball: { pos: pos(0, 3), holderId: rook.id },
            actionPoints: 3,
        })
        const { boardState } = applyPass(state, pos(0, 8))
        expect(boardState.ball.holderId).toBeNull()
        expect(boardState.ball.pos).toEqual(pos(0, 8))
    })
})

// ─────────────────────────────────────────────────────────
// getPath — edge cases not in base test
// ─────────────────────────────────────────────────────────
describe('getPath — additional edge cases', () => {
    it('getPath from identical points (same square) returns just destination', () => {
        // The loop condition prevents infinite loop; result includes destination
        const path = getPath(pos(3, 3), pos(3, 3))
        // dx=0, dy=0 → immediate push of destination
        expect(path).toEqual([pos(3, 3)])
    })

    it('anti-diagonal path NE is correct', () => {
        const path = getPath(pos(2, 4), pos(5, 7))
        expect(path).toEqual([pos(3, 5), pos(4, 6), pos(5, 7)])
    })

    it('long vertical path includes all intermediate squares', () => {
        const path = getPath(pos(4, 2), pos(4, 8))
        expect(path).toHaveLength(6) // 3,4,5,6,7,8
        expect(path[0]).toEqual(pos(4, 3))
        expect(path[5]).toEqual(pos(4, 8))
    })
})

// ─────────────────────────────────────────────────────────
// applyEndTurn — comprehensive
// ─────────────────────────────────────────────────────────
describe('applyEndTurn — comprehensive', () => {
    it('preserves score unchanged', () => {
        const state = mkBoard({ score: { white: 2, black: 1 } })
        const newState = applyEndTurn(state)
        expect(newState.score).toEqual({ white: 2, black: 1 })
    })

    it('preserves ball position when king does not hold it', () => {
        const state = mkBoard({
            ball: { pos: pos(4, 5), holderId: null },
            turn: 'white',
        })
        const newState = applyEndTurn(state)
        expect(newState.ball.pos).toEqual(pos(4, 5))
        expect(newState.ball.holderId).toBeNull()
    })

    it('preserves pieces positions (does not move pieces)', () => {
        const rook = mkPiece('rook', 'white', 3, 5)
        const state = mkBoard({ pieces: [rook] })
        const newState = applyEndTurn(state)
        const rookAfter = newState.pieces.find(p => p.id === rook.id)!
        expect(rookAfter.pos).toEqual(pos(3, 5))
    })

    it('alternates correctly across multiple turn ends', () => {
        let state = mkBoard({ turn: 'white' })
        state = applyEndTurn(state)
        expect(state.turn).toBe('black')
        state = applyEndTurn(state)
        expect(state.turn).toBe('white')
        state = applyEndTurn(state)
        expect(state.turn).toBe('black')
    })
})
