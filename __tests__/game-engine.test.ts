import { describe, it, expect } from 'vitest'
import { getPath, applyMove, applyPass, applyEndTurn } from '../src/game-engine'
import { mkBoard, mkPiece, pieceAt, pos } from './helpers'

// ─────────────────────────────────────────────────────────
// getPath
// ─────────────────────────────────────────────────────────
describe('getPath', () => {
    it('returns a straight vertical path including destination', () => {
        const path = getPath(pos(4, 1), pos(4, 5))
        expect(path).toEqual([pos(4, 2), pos(4, 3), pos(4, 4), pos(4, 5)])
    })

    it('returns a straight horizontal path', () => {
        const path = getPath(pos(0, 3), pos(4, 3))
        expect(path).toEqual([pos(1, 3), pos(2, 3), pos(3, 3), pos(4, 3)])
    })

    it('returns a diagonal path', () => {
        const path = getPath(pos(0, 0), pos(3, 3))
        expect(path).toEqual([pos(1, 1), pos(2, 2), pos(3, 3)])
    })

    it('returns a single-element array for adjacent squares', () => {
        expect(getPath(pos(3, 3), pos(4, 3))).toEqual([pos(4, 3)])
    })
})

// ─────────────────────────────────────────────────────────
// applyMove
// ─────────────────────────────────────────────────────────
describe('applyMove', () => {
    it('moves the piece and decrements AP', () => {
        const rook = mkPiece('rook', 'white', 0, 0)
        const state = mkBoard({ pieces: [rook], actionPoints: 5 })
        const { boardState } = applyMove(state, rook.id, pos(0, 4))
        expect(pieceAt(boardState, 0, 4)?.id).toBe(rook.id)
        expect(boardState.actionPoints).toBe(4)
        expect(boardState.turn).toBe('white')
    })

    it('marks the piece as hasMovedThisTurn', () => {
        const rook = mkPiece('rook', 'white', 0, 0)
        const state = mkBoard({ pieces: [rook] })
        const { boardState } = applyMove(state, rook.id, pos(0, 2))
        const moved = boardState.pieces.find(p => p.id === rook.id)!
        expect(moved.hasMovedThisTurn).toBe(true)
    })

    it('switches turn and resets AP when AP reaches 0', () => {
        const rook = mkPiece('rook', 'white', 0, 0)
        const state = mkBoard({ pieces: [rook], actionPoints: 1 })
        const { boardState } = applyMove(state, rook.id, pos(0, 1))
        expect(boardState.turn).toBe('black')
        expect(boardState.actionPoints).toBe(5)
    })

    it('resets hasMovedThisTurn for all pieces on turn switch', () => {
        const rook = mkPiece('rook', 'white', 0, 0, true)
        const state = mkBoard({ pieces: [rook], actionPoints: 1 })
        const { boardState } = applyMove(state, rook.id, pos(0, 1))
        expect(boardState.pieces.every(p => !p.hasMovedThisTurn)).toBe(true)
    })

    it('ball carrier conducts the ball when moving', () => {
        const queen = mkPiece('queen', 'white', 4, 3)
        const state = mkBoard({
            pieces: [queen],
            ball: { pos: pos(4, 3), holderId: queen.id },
        })
        const { boardState } = applyMove(state, queen.id, pos(4, 6))
        expect(boardState.ball.pos).toEqual(pos(4, 6))
        expect(boardState.ball.holderId).toBe(queen.id)
    })

    it('rook picks up loose ball on its path', () => {
        const rook = mkPiece('rook', 'white', 0, 1)
        const state = mkBoard({
            pieces: [rook],
            ball: { pos: pos(0, 4), holderId: null },
        })
        const { boardState } = applyMove(state, rook.id, pos(0, 7))
        expect(boardState.ball.holderId).toBe(rook.id)
        expect(boardState.ball.pos).toEqual(pos(0, 7))
    })

    it('knight picks up ball only if landing on it', () => {
        const knight = mkPiece('knight', 'white', 3, 3)
        const ballPos = pos(4, 5)
        const state = mkBoard({
            pieces: [knight],
            ball: { pos: ballPos, holderId: null },
        })
        const { boardState } = applyMove(state, knight.id, ballPos)
        expect(boardState.ball.holderId).toBe(knight.id)
    })

    it('tackle: piece moves to rival ball-holder, gets ball, displaces rival', () => {
        const attacker = mkPiece('rook', 'white', 4, 1)
        const defender = mkPiece('king', 'black', 4, 5)
        const state = mkBoard({
            pieces: [attacker, defender],
            ball: { pos: pos(4, 5), holderId: defender.id },
        })
        const { boardState, moveType } = applyMove(state, attacker.id, pos(4, 5))
        expect(moveType).toBe('tackle')
        expect(boardState.ball.holderId).toBe(attacker.id)
        // defender was displaced to an adjacent square
        const displaced = boardState.pieces.find(p => p.id === defender.id)!
        expect(displaced.pos).not.toEqual(pos(4, 5))
    })
})

// ─────────────────────────────────────────────────────────
// applyPass
// ─────────────────────────────────────────────────────────
describe('applyPass', () => {
    it('passes to empty square — ball lands loose', () => {
        const queen = mkPiece('queen', 'white', 4, 3)
        const state = mkBoard({
            pieces: [queen],
            ball: { pos: pos(4, 3), holderId: queen.id },
        })
        const { boardState, forcedTurnEnd } = applyPass(state, pos(4, 8))
        expect(boardState.ball.pos).toEqual(pos(4, 8))
        expect(boardState.ball.holderId).toBeNull()
        expect(forcedTurnEnd).toBe(false)
    })

    it('passes to a teammate — teammate picks up ball', () => {
        const passer  = mkPiece('queen', 'white', 4, 3)
        const receiver = mkPiece('rook', 'white', 4, 8)
        const state = mkBoard({
            pieces: [passer, receiver],
            ball: { pos: pos(4, 3), holderId: passer.id },
        })
        const { boardState } = applyPass(state, pos(4, 8))
        expect(boardState.ball.holderId).toBe(receiver.id)
    })

    it('interception: rival on the path catches the ball', () => {
        const passer    = mkPiece('rook', 'white', 0, 3)
        const rival     = mkPiece('rook', 'black', 0, 6)
        const state = mkBoard({
            pieces: [passer, rival],
            ball: { pos: pos(0, 3), holderId: passer.id },
        })
        const { boardState, forcedTurnEnd } = applyPass(state, pos(0, 9))
        expect(forcedTurnEnd).toBe(true)
        expect(boardState.ball.holderId).toBe(rival.id)
        expect(boardState.ball.pos).toEqual(pos(0, 6))
        expect(boardState.turn).toBe('black') // turn forced to switch
    })

    it('knight passes are never intercepted', () => {
        const knight    = mkPiece('knight', 'white', 3, 3)
        const rival     = mkPiece('rook', 'black', 4, 5) // on a "path" between knight pos and dest
        const state = mkBoard({
            pieces: [knight, rival],
            ball: { pos: pos(3, 3), holderId: knight.id },
        })
        // Knight passes are not blocked — no path check
        const { forcedTurnEnd } = applyPass(state, pos(5, 5))
        expect(forcedTurnEnd).toBe(false)
    })

    it('pass decrements AP', () => {
        const queen = mkPiece('queen', 'white', 4, 3)
        const state = mkBoard({
            pieces: [queen],
            ball: { pos: pos(4, 3), holderId: queen.id },
            actionPoints: 3,
        })
        const { boardState } = applyPass(state, pos(4, 7))
        expect(boardState.actionPoints).toBe(2)
    })

    it('pass at AP=1 triggers turn end', () => {
        const queen = mkPiece('queen', 'white', 4, 3)
        const state = mkBoard({
            pieces: [queen],
            ball: { pos: pos(4, 3), holderId: queen.id },
            actionPoints: 1,
        })
        const { boardState } = applyPass(state, pos(4, 7))
        expect(boardState.turn).toBe('black')
        expect(boardState.actionPoints).toBe(5)
    })
})

// ─────────────────────────────────────────────────────────
// applyEndTurn
// ─────────────────────────────────────────────────────────
describe('applyEndTurn', () => {
    it('switches from white to black', () => {
        const state = mkBoard({ turn: 'white' })
        expect(applyEndTurn(state).turn).toBe('black')
    })

    it('switches from black to white', () => {
        const state = mkBoard({ turn: 'black' })
        expect(applyEndTurn(state).turn).toBe('white')
    })

    it('resets AP to 5', () => {
        const state = mkBoard({ actionPoints: 2 })
        expect(applyEndTurn(state).actionPoints).toBe(5)
    })

    it('resets hasMovedThisTurn on all pieces', () => {
        const p1 = mkPiece('rook', 'white', 0, 0, true)
        const p2 = mkPiece('queen', 'white', 4, 3, true)
        const state = mkBoard({ pieces: [p1, p2] })
        const newState = applyEndTurn(state)
        expect(newState.pieces.every(p => !p.hasMovedThisTurn)).toBe(true)
    })

    it('does not mutate the original state', () => {
        const state = mkBoard({ turn: 'white', actionPoints: 3 })
        applyEndTurn(state)
        expect(state.turn).toBe('white')
        expect(state.actionPoints).toBe(3)
    })
})

// ─────────────────────────────────────────────────────────
// getPath — edge cases
// ─────────────────────────────────────────────────────────
describe('getPath — edge cases', () => {
    it('returns a right-to-left horizontal path', () => {
        const path = getPath(pos(5, 3), pos(1, 3))
        expect(path).toEqual([pos(4, 3), pos(3, 3), pos(2, 3), pos(1, 3)])
    })

    it('returns a bottom-to-top vertical path', () => {
        const path = getPath(pos(2, 7), pos(2, 4))
        expect(path).toEqual([pos(2, 6), pos(2, 5), pos(2, 4)])
    })

    it('returns a SW diagonal path', () => {
        const path = getPath(pos(4, 4), pos(2, 6))
        expect(path).toEqual([pos(3, 5), pos(2, 6)])
    })

    it('handles NW diagonal path', () => {
        const path = getPath(pos(4, 5), pos(2, 3))
        expect(path).toEqual([pos(3, 4), pos(2, 3)])
    })
})

// ─────────────────────────────────────────────────────────
// applyMove — immutability
// ─────────────────────────────────────────────────────────
describe('applyMove — immutability', () => {
    it('does not mutate the original board state', () => {
        const rook = mkPiece('rook', 'white', 0, 3)
        const state = mkBoard({ pieces: [rook], actionPoints: 3 })
        const beforePieces = JSON.stringify(state.pieces)
        const beforeAP = state.actionPoints
        applyMove(state, rook.id, pos(0, 5))
        expect(JSON.stringify(state.pieces)).toBe(beforePieces)
        expect(state.actionPoints).toBe(beforeAP)
    })
})

// ─────────────────────────────────────────────────────────
// applyMove — ball capture on path
// ─────────────────────────────────────────────────────────
describe('applyMove — ball capture on path', () => {
    it('bishop picks up loose ball on diagonal path', () => {
        const bishop = mkPiece('bishop', 'white', 2, 2)
        const state = mkBoard({
            pieces: [bishop],
            ball: { pos: pos(4, 4), holderId: null },
        })
        const { boardState } = applyMove(state, bishop.id, pos(6, 6))
        expect(boardState.ball.holderId).toBe(bishop.id)
        expect(boardState.ball.pos).toEqual(pos(6, 6))
    })

    it('queen picks up loose ball on horizontal path', () => {
        const queen = mkPiece('queen', 'white', 0, 5)
        const state = mkBoard({
            pieces: [queen],
            ball: { pos: pos(3, 5), holderId: null },
        })
        const { boardState } = applyMove(state, queen.id, pos(7, 5))
        expect(boardState.ball.holderId).toBe(queen.id)
    })

    it('knight does not pick up loose ball NOT at landing square', () => {
        const knight = mkPiece('knight', 'white', 2, 3)
        // (4,4) is a valid L-move from (2,3); ball at (3,4) is not the destination
        const state = mkBoard({
            pieces: [knight],
            ball: { pos: pos(3, 4), holderId: null },
        })
        const { boardState } = applyMove(state, knight.id, pos(4, 4))
        expect(boardState.ball.holderId).toBeNull()
        expect(boardState.ball.pos).toEqual(pos(3, 4))
    })

    it('piece does not pick up ball already held by a teammate', () => {
        const rook = mkPiece('rook', 'white', 0, 3)
        const holder = mkPiece('queen', 'white', 4, 3)
        const state = mkBoard({
            pieces: [rook, holder],
            ball: { pos: pos(4, 3), holderId: holder.id },
        })
        // Rook moves vertically; ball at (4,3) is held by teammate — not affected
        const { boardState } = applyMove(state, rook.id, pos(0, 8))
        expect(boardState.ball.holderId).toBe(holder.id)
        expect(boardState.ball.pos).toEqual(pos(4, 3))
    })
})

// ─────────────────────────────────────────────────────────
// applyMove — lastMove recording
// ─────────────────────────────────────────────────────────
describe('applyMove — lastMove recording', () => {
    it('records lastMove with type move, from, to, playerId', () => {
        const rook = mkPiece('rook', 'white', 0, 3)
        const state = mkBoard({ pieces: [rook] })
        const { boardState } = applyMove(state, rook.id, pos(0, 6))
        expect(boardState.lastMove?.type).toBe('move')
        expect(boardState.lastMove?.from).toEqual(pos(0, 3))
        expect(boardState.lastMove?.to).toEqual(pos(0, 6))
        expect(boardState.lastMove?.playerId).toBe(rook.id)
    })

    it('records lastMove.type as tackle when tackling ball-holder', () => {
        const attacker = mkPiece('rook', 'white', 0, 3)
        const defender = mkPiece('queen', 'black', 0, 7)
        const state = mkBoard({
            pieces: [attacker, defender],
            ball: { pos: pos(0, 7), holderId: defender.id },
        })
        const { boardState } = applyMove(state, attacker.id, pos(0, 7))
        expect(boardState.lastMove?.type).toBe('tackle')
        expect(boardState.lastMove?.playerId).toBe(attacker.id)
    })
})

// ─────────────────────────────────────────────────────────
// applyPass — immutability
// ─────────────────────────────────────────────────────────
describe('applyPass — immutability', () => {
    it('does not mutate the original board state', () => {
        const queen = mkPiece('queen', 'white', 4, 3)
        const state = mkBoard({
            pieces: [queen],
            ball: { pos: pos(4, 3), holderId: queen.id },
            actionPoints: 3,
        })
        const beforeAP = state.actionPoints
        const beforeBallPos = { ...state.ball.pos }
        applyPass(state, pos(4, 7))
        expect(state.actionPoints).toBe(beforeAP)
        expect(state.ball.pos).toEqual(beforeBallPos)
    })
})

// ─────────────────────────────────────────────────────────
// applyPass — forced turn end scenarios
// ─────────────────────────────────────────────────────────
describe('applyPass — forced turn end', () => {
    it('goal switches turn immediately regardless of remaining AP', () => {
        const queen = mkPiece('queen', 'white', 4, 5)
        const blackKing = mkPiece('king', 'black', 4, 11)
        const state = mkBoard({
            pieces: [queen, blackKing],
            ball: { pos: pos(4, 5), holderId: queen.id },
            actionPoints: 4,
        })
        const { boardState, goalScored } = applyPass(state, pos(4, 11))
        expect(goalScored).toBe(true)
        expect(boardState.turn).toBe('black')
        expect(boardState.actionPoints).toBe(5)
    })

    it('interception switches turn immediately regardless of remaining AP', () => {
        const queen = mkPiece('queen', 'white', 0, 3)
        const rival = mkPiece('rook', 'black', 0, 7)
        const state = mkBoard({
            pieces: [queen, rival],
            ball: { pos: pos(0, 3), holderId: queen.id },
            actionPoints: 4,
        })
        const { boardState, forcedTurnEnd } = applyPass(state, pos(0, 9))
        expect(forcedTurnEnd).toBe(true)
        expect(boardState.turn).toBe('black')
        expect(boardState.actionPoints).toBe(5)
    })

    it('normal pass does NOT force turn end when AP > 1', () => {
        const queen = mkPiece('queen', 'white', 4, 3)
        const state = mkBoard({
            pieces: [queen],
            ball: { pos: pos(4, 3), holderId: queen.id },
            actionPoints: 3,
        })
        const { boardState, forcedTurnEnd } = applyPass(state, pos(4, 8))
        expect(forcedTurnEnd).toBe(false)
        expect(boardState.turn).toBe('white')
    })

    it('pass by non-king piece does not set keeperBlockedId', () => {
        const queen = mkPiece('queen', 'white', 4, 5)
        const state = mkBoard({
            pieces: [queen],
            ball: { pos: pos(4, 5), holderId: queen.id },
            actionPoints: 3,
        })
        const { boardState } = applyPass(state, pos(4, 8))
        expect(boardState.keeperBlockedId).toBeUndefined()
    })

    it('pass records lastMove with correct type and positions', () => {
        const queen = mkPiece('queen', 'white', 4, 3)
        const state = mkBoard({
            pieces: [queen],
            ball: { pos: pos(4, 3), holderId: queen.id },
            actionPoints: 3,
        })
        const { boardState } = applyPass(state, pos(4, 8))
        expect(boardState.lastMove?.type).toBe('pass')
        expect(boardState.lastMove?.from).toEqual(pos(4, 3))
        expect(boardState.lastMove?.playerId).toBe(queen.id)
    })

    it('interception records lastMove.type as interception', () => {
        const passer = mkPiece('rook', 'white', 0, 3)
        const rival = mkPiece('rook', 'black', 0, 6)
        const state = mkBoard({
            pieces: [passer, rival],
            ball: { pos: pos(0, 3), holderId: passer.id },
        })
        const { boardState } = applyPass(state, pos(0, 9))
        expect(boardState.lastMove?.type).toBe('interception')
    })
})
