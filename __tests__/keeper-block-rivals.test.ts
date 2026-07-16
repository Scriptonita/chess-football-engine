/**
 * Keeper backpass block — scope and lift conditions.
 *
 * The block only restricts TEAMMATES of the blocked keeper; rivals must always
 * be able to shoot at the keeper's square. The block lifts on ANY opponent
 * ball touch: interception, tackle, loose-ball capture, or offside handover.
 *
 * Regression tests for two bugs found via the AI training simulator
 * (scripts/train.ts): rival shots at a blocked keeper were excluded from
 * getValidPasses, and loose-ball pickups by the opponent never lifted the
 * block — together they made goals impossible for whole stretches of play.
 */
import { describe, it, expect } from 'vitest'
import { applyMove, applyEndTurn } from '../src/game-engine'
import { getValidPasses } from '../src/game-logic'
import { mkBoard, mkPiece, pos } from './helpers'

describe('keeperBlockedId — only restricts teammates', () => {
    it('rival pieces CAN target the blocked keeper square (shot on goal)', () => {
        const whiteKing = mkPiece('king', 'white', 4, 1)
        const blackRook = mkPiece('rook', 'black', 4, 8)
        const state = mkBoard({
            pieces: [whiteKing, blackRook],
            ball: { pos: pos(4, 8), holderId: blackRook.id },
            turn: 'black',
            keeperBlockedId: whiteKing.id,
        })
        const passes = getValidPasses(blackRook, state)
        expect(passes.some(p => p.x === 4 && p.y === 1)).toBe(true)
    })

    it('rival knight CAN target the blocked keeper square', () => {
        const whiteKing = mkPiece('king', 'white', 4, 1)
        const blackKnight = mkPiece('knight', 'black', 3, 3)
        const state = mkBoard({
            pieces: [whiteKing, blackKnight],
            ball: { pos: pos(3, 3), holderId: blackKnight.id },
            turn: 'black',
            keeperBlockedId: whiteKing.id,
        })
        const passes = getValidPasses(blackKnight, state)
        expect(passes.some(p => p.x === 4 && p.y === 1)).toBe(true)
    })

    it('teammates still CANNOT target the blocked keeper square', () => {
        const whiteKing = mkPiece('king', 'white', 4, 1)
        const whiteQueen = mkPiece('queen', 'white', 4, 5)
        const state = mkBoard({
            pieces: [whiteKing, whiteQueen],
            ball: { pos: pos(4, 5), holderId: whiteQueen.id },
            turn: 'white',
            keeperBlockedId: whiteKing.id,
        })
        const passes = getValidPasses(whiteQueen, state)
        expect(passes.some(p => p.x === 4 && p.y === 1)).toBe(false)
    })
})

describe('keeperBlockedId — lifted by opponent loose-ball capture', () => {
    it('opponent picking up a loose ball lifts the block', () => {
        const whiteKing = mkPiece('king', 'white', 4, 1)
        const blackRook = mkPiece('rook', 'black', 2, 6)
        const state = mkBoard({
            pieces: [whiteKing, blackRook],
            ball: { pos: pos(2, 3), holderId: null },
            turn: 'black',
            keeperBlockedId: whiteKing.id,
        })
        const { boardState } = applyMove(state, blackRook.id, pos(2, 3))
        expect(boardState.ball.holderId).toBe(blackRook.id)
        expect(boardState.keeperBlockedId).toBeUndefined()
    })

    it('opponent linear piece crossing the loose ball lifts the block', () => {
        const whiteKing = mkPiece('king', 'white', 4, 1)
        const blackQueen = mkPiece('queen', 'black', 2, 8)
        const state = mkBoard({
            pieces: [whiteKing, blackQueen],
            ball: { pos: pos(2, 5), holderId: null },
            turn: 'black',
            keeperBlockedId: whiteKing.id,
        })
        // Queen moves through the ball square (2,5) down to (2,3)
        const { boardState } = applyMove(state, blackQueen.id, pos(2, 3))
        expect(boardState.ball.holderId).toBe(blackQueen.id)
        expect(boardState.keeperBlockedId).toBeUndefined()
    })

    it('teammate picking up the loose ball does NOT lift the block', () => {
        const whiteKing = mkPiece('king', 'white', 4, 1)
        const whiteRook = mkPiece('rook', 'white', 2, 6)
        const state = mkBoard({
            pieces: [whiteKing, whiteRook],
            ball: { pos: pos(2, 3), holderId: null },
            turn: 'white',
            keeperBlockedId: whiteKing.id,
        })
        const { boardState } = applyMove(state, whiteRook.id, pos(2, 3))
        expect(boardState.ball.holderId).toBe(whiteRook.id)
        expect(boardState.keeperBlockedId).toBe(whiteKing.id)
    })
})

describe('keeperBlockedId — lifted by offside handover', () => {
    it('offside handing the ball to the rival king lifts the offending side\'s keeper block', () => {
        const whiteKing = mkPiece('king', 'white', 4, 1)
        const blackKing = mkPiece('king', 'black', 4, 10)
        const whiteQueen = mkPiece('queen', 'white', 3, 10) // in black's area, holding the ball
        const state = mkBoard({
            pieces: [whiteKing, blackKing, whiteQueen],
            ball: { pos: pos(3, 10), holderId: whiteQueen.id },
            turn: 'white',
            keeperBlockedId: whiteKing.id,
        })
        const next = applyEndTurn(state)
        expect(next.lastMove?.type).toBe('offside')
        expect(next.ball.holderId).toBe(blackKing.id)
        expect(next.keeperBlockedId).toBeUndefined()
    })
})
