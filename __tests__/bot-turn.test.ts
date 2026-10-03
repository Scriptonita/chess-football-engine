import { describe, it, expect } from 'vitest'
import { playBotTurn } from '../src/bot-turn'
import { CHAMPIONSHIP_ROSTER, STARTER_BOT, getBotById, TIERS } from '../src/bot-engine'
import { getInitialBoardState } from '../src/initial-board'
import type { BotAction } from '../src/types/bot'
import { mkBoard, mkPiece, resetIdCounter } from './helpers'

const scripted = (actions: BotAction[]) => ({ play: () => actions })

// White rook holding the ball on an otherwise quiet board; both kings at home.
function quietBoard() {
    resetIdCounter()
    const rook = mkPiece('rook', 'white', 4, 5)
    const mate = mkPiece('queen', 'white', 4, 7)
    const wKing = mkPiece('king', 'white', 4, 0)
    const bKing = mkPiece('king', 'black', 0, 11)
    const board = mkBoard({
        pieces: [rook, mate, wKing, bKing],
        ball: { pos: { x: 4, y: 5 }, holderId: rook.id },
    })
    return { board, rook, mate, wKing, bKing }
}

describe('playBotTurn', () => {
    it('returns one state per applied action and closes the turn with a silent end-turn state', () => {
        const { board, rook } = quietBoard()
        const turn = playBotTurn(scripted([{ type: 'move', pieceId: rook.id, to: { x: 5, y: 5 } }]), board, 'white')

        expect(turn.states).toHaveLength(2)
        expect(turn.states[0].turn).toBe('white')
        expect(turn.states[0].pieces.find((p) => p.id === rook.id)!.pos).toEqual({ x: 5, y: 5 })
        expect(turn.states[1].turn).toBe('black')
        expect(turn.closedByEndTurn).toBe(true)
        expect(turn.goalScored).toBeNull()
    })

    it('drops illegal actions: wrong side, unreachable square, piece that already moved, pass without the ball', () => {
        const { board, rook, mate, bKing } = quietBoard()
        const turn = playBotTurn(scripted([
            { type: 'move', pieceId: bKing.id, to: { x: 1, y: 11 } },   // not the bot's piece
            { type: 'move', pieceId: rook.id, to: { x: 6, y: 8 } },     // a rook cannot go there
            { type: 'pass', pieceId: mate.id, to: { x: 4, y: 9 } },     // mate does not hold the ball
            { type: 'move', pieceId: rook.id, to: { x: 5, y: 5 } },     // legal
            { type: 'move', pieceId: rook.id, to: { x: 6, y: 5 } },     // already moved this turn
        ]), board, 'white')

        expect(turn.states).toHaveLength(2)
        expect(turn.states[0].pieces.find((p) => p.id === rook.id)!.pos).toEqual({ x: 5, y: 5 })
        expect(turn.states[0].pieces.find((p) => p.id === bKing.id)!.pos).toEqual({ x: 0, y: 11 })
        expect(turn.closedByEndTurn).toBe(true)
    })

    it('stops at an explicit end_turn and ignores whatever follows', () => {
        const { board, rook } = quietBoard()
        const turn = playBotTurn(scripted([
            { type: 'end_turn' },
            { type: 'move', pieceId: rook.id, to: { x: 5, y: 5 } },
        ]), board, 'white')

        expect(turn.states).toHaveLength(1)
        expect(turn.states[0].turn).toBe('black')
        expect(turn.states[0].pieces.find((p) => p.id === rook.id)!.pos).toEqual({ x: 4, y: 5 })
        expect(turn.closedByEndTurn).toBe(true)
    })

    it('cuts on a goal, reports the scorer and does not append an end-turn state', () => {
        resetIdCounter()
        const rook = mkPiece('rook', 'white', 4, 5)
        const wKing = mkPiece('king', 'white', 4, 0)
        const bKing = mkPiece('king', 'black', 4, 11)
        const board = mkBoard({
            pieces: [rook, wKing, bKing],
            ball: { pos: { x: 4, y: 5 }, holderId: rook.id },
        })
        const turn = playBotTurn(scripted([
            { type: 'pass', pieceId: rook.id, to: { x: 4, y: 11 } },
            { type: 'move', pieceId: rook.id, to: { x: 5, y: 5 } },
        ]), board, 'white')

        expect(turn.states).toHaveLength(1)
        expect(turn.states[0].lastMove?.type).toBe('goal')
        expect(turn.goalScored).toBe('white')
        expect(turn.closedByEndTurn).toBe(false)
    })

    it('cuts on an interception: the turn already changed hands, so it is not ended twice', () => {
        resetIdCounter()
        const rook = mkPiece('rook', 'white', 4, 5)
        const wKing = mkPiece('king', 'white', 4, 0)
        const blocker = mkPiece('rook', 'black', 4, 8)
        const bKing = mkPiece('king', 'black', 0, 11)
        const board = mkBoard({
            pieces: [rook, wKing, blocker, bKing],
            ball: { pos: { x: 4, y: 5 }, holderId: rook.id },
        })
        const turn = playBotTurn(scripted([
            { type: 'pass', pieceId: rook.id, to: { x: 4, y: 9 } },
            { type: 'move', pieceId: rook.id, to: { x: 5, y: 5 } },
        ]), board, 'white')

        expect(turn.states).toHaveLength(1)
        expect(turn.states[0].turn).toBe('black')
        expect(turn.states[0].ball.holderId).toBe(blocker.id)
        expect(turn.closedByEndTurn).toBe(false)
        expect(turn.goalScored).toBeNull()
    })

    it('does not append an end-turn state when the last action point already passed the turn', () => {
        const { board, rook } = quietBoard()
        const turn = playBotTurn(
            scripted([{ type: 'move', pieceId: rook.id, to: { x: 5, y: 5 } }]),
            { ...board, actionPoints: 1 },
            'white',
        )

        expect(turn.states).toHaveLength(1)
        expect(turn.states[0].turn).toBe('black')
        expect(turn.closedByEndTurn).toBe(false)
    })

    it('always hands the turn over: no actions, only illegal actions, or a bot that throws', () => {
        const { board, bKing } = quietBoard()
        const cases = [
            scripted([]),
            scripted([{ type: 'move', pieceId: bKing.id, to: { x: 1, y: 11 } }]),
            { play: () => { throw new Error('boom') } },
        ]
        for (const bot of cases) {
            const turn = playBotTurn(bot, board, 'white')
            expect(turn.states).toHaveLength(1)
            expect(turn.states[0].turn).toBe('black')
            expect(turn.closedByEndTurn).toBe(true)
        }
    })

    it('never mutates the input board', () => {
        const { board, rook } = quietBoard()
        const snapshot = JSON.stringify(board)
        playBotTurn(scripted([{ type: 'move', pieceId: rook.id, to: { x: 5, y: 5 } }]), board, 'white')
        expect(JSON.stringify(board)).toBe(snapshot)
    })

    it('plays a full real turn for every shipped bot and always yields the turn', () => {
        for (const bot of [STARTER_BOT, ...CHAMPIONSHIP_ROSTER.slice(0, 1)]) {
            const turn = playBotTurn(bot, getInitialBoardState('black'), 'black')
            expect(turn.states.length).toBeGreaterThan(0)
            const last = turn.states[turn.states.length - 1]
            expect(turn.goalScored !== null || last.turn === 'white').toBe(true)
        }
    })
})

describe('starter bot (AD-6)', () => {
    it('has a canonical, stable identity at beginner strength', () => {
        expect(STARTER_BOT.id).toBe('starter-rookie')
        expect(STARTER_BOT.difficulty).toBe('beginner')
        expect(Object.keys(TIERS)).toContain(STARTER_BOT.difficulty)
        for (const field of [STARTER_BOT.name, STARTER_BOT.description, STARTER_BOT.avatar, STARTER_BOT.badgeName, STARTER_BOT.badgeIcon]) {
            expect(field.length).toBeGreaterThan(0)
        }
    })

    it('stays out of the championship roster', () => {
        expect(CHAMPIONSHIP_ROSTER.map((b) => b.id)).not.toContain(STARTER_BOT.id)
    })

    it('getBotById resolves the starter and every roster bot, and nothing else', () => {
        expect(getBotById(STARTER_BOT.id)).toBe(STARTER_BOT)
        for (const bot of CHAMPIONSHIP_ROSTER) expect(getBotById(bot.id)).toBe(bot)
        expect(getBotById('nope')).toBeNull()
        expect(getBotById(undefined)).toBeNull()
    })
})
