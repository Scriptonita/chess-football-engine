import { describe, it, expect } from 'vitest'
import { applyEndTurn, applyMove } from '../src/game-engine'
import { mkBoard, mkPiece, pos } from './helpers'

// ─────────────────────────────────────────────────────────
// Offside rule
// A side may not END its turn with one of its NON-KING pieces holding the ball
// inside the ENEMY area (the rival keeper can't be tackled there). When it does,
// the piece is "offside" and the ball is handed to the rival king.
//   White's enemy area = BLACK_AREA (x 2-6, y 10-11)
//   Black's enemy area = WHITE_AREA (x 2-6, y 0-1)
// ─────────────────────────────────────────────────────────

describe('offside — turn ends with a non-king piece holding the ball in the enemy area', () => {
    it('white queen in the black area loses the ball to the black king (applyEndTurn)', () => {
        const queen = mkPiece('queen', 'white', 4, 11) // inside BLACK_AREA
        const blackKing = mkPiece('king', 'black', 2, 10)
        const state = mkBoard({
            pieces: [queen, blackKing],
            ball: { pos: pos(4, 11), holderId: queen.id },
            turn: 'white',
        })

        const next = applyEndTurn(state)

        expect(next.ball.holderId).toBe(blackKing.id)
        expect(next.ball.pos).toEqual(pos(2, 10))
        expect(next.lastMove?.type).toBe('offside')
        expect(next.turn).toBe('black')
    })

    it('black rook in the white area loses the ball to the white king (applyEndTurn)', () => {
        const rook = mkPiece('rook', 'black', 3, 0) // inside WHITE_AREA
        const whiteKing = mkPiece('king', 'white', 4, 1)
        const state = mkBoard({
            pieces: [rook, whiteKing],
            ball: { pos: pos(3, 0), holderId: rook.id },
            turn: 'black',
        })

        const next = applyEndTurn(state)

        expect(next.ball.holderId).toBe(whiteKing.id)
        expect(next.ball.pos).toEqual(pos(4, 1))
        expect(next.lastMove?.type).toBe('offside')
    })

    it('records an offside entry in the move history', () => {
        const queen = mkPiece('queen', 'white', 4, 11)
        const blackKing = mkPiece('king', 'black', 2, 10)
        const state = mkBoard({
            pieces: [queen, blackKing],
            ball: { pos: pos(4, 11), holderId: queen.id },
            turn: 'white',
        })

        const next = applyEndTurn(state)
        const last = next.moveHistory[next.moveHistory.length - 1]
        expect(last.type).toBe('offside')
        expect(last.pieceSide).toBe('white')
    })

    it('triggers when conducting the ball into the enemy area uses the last AP (applyMove)', () => {
        const queen = mkPiece('queen', 'white', 4, 9) // just outside BLACK_AREA
        const blackKing = mkPiece('king', 'black', 2, 10)
        const state = mkBoard({
            pieces: [queen, blackKing],
            ball: { pos: pos(4, 9), holderId: queen.id },
            turn: 'white',
            actionPoints: 1, // last AP → turn ends after this move
        })

        const { boardState: next } = applyMove(state, queen.id, pos(4, 10)) // into BLACK_AREA

        expect(next.turn).toBe('black') // turn ended
        expect(next.ball.holderId).toBe(blackKing.id)
        expect(next.lastMove?.type).toBe('offside')
    })
})

describe('offside — situations that must NOT be penalised', () => {
    it('a king holding the ball in its OWN area is not offside (its own rule applies)', () => {
        const king = mkPiece('king', 'white', 4, 0)
        const state = mkBoard({
            pieces: [king],
            ball: { pos: pos(4, 0), holderId: king.id },
            turn: 'white',
        })

        const next = applyEndTurn(state)

        // Ball stays with the king; the king-release warning is what applies, not offside.
        expect(next.ball.holderId).toBe(king.id)
        expect(next.kingMustRelease).toBe('white')
        expect(next.lastMove?.type).not.toBe('offside')
    })

    it('a piece holding the ball outside any area is not offside', () => {
        const queen = mkPiece('queen', 'white', 4, 6) // midfield
        const blackKing = mkPiece('king', 'black', 4, 10)
        const state = mkBoard({
            pieces: [queen, blackKing],
            ball: { pos: pos(4, 6), holderId: queen.id },
            turn: 'white',
        })

        const next = applyEndTurn(state)

        expect(next.ball.holderId).toBe(queen.id)
        expect(next.lastMove?.type).not.toBe('offside')
    })

    it('a piece standing in the enemy area but NOT holding the ball is not offside', () => {
        const queen = mkPiece('queen', 'white', 4, 11) // in BLACK_AREA but no ball
        const blackKing = mkPiece('king', 'black', 2, 10)
        const state = mkBoard({
            pieces: [queen, blackKing],
            ball: { pos: pos(4, 6), holderId: null }, // loose ball elsewhere
            turn: 'white',
        })

        const next = applyEndTurn(state)

        expect(next.ball.holderId).toBeNull()
        expect(next.lastMove?.type).not.toBe('offside')
    })
})
