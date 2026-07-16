/**
 * Single-game tracer: prints each turn's actions + key state so we can SEE the
 * concrete blunders an AI makes. Usage:
 *   npx tsx scripts/trace.ts <whiteId> <blackId> [maxTurns] [fromTurn] [toTurn]
 */
import { getAIScript } from '../src/ai-players/registry'
import { getValidMoves, getValidPasses } from '../src/game-logic'
import { applyMove, applyPass, applyEndTurn } from '../src/game-engine'
import { getInitialBoardState as initial } from '../src/initial-board'
import { AIPlayerScript } from '../src/types/ai-player'
import { BoardState, Side } from '../src/types/game'

const other = (s: Side): Side => (s === 'white' ? 'black' : 'white')
const fmt = (p: { x: number; y: number }) => `(${p.x},${p.y})`

/** Can `side` carry/tackle/grab then directly shoot the rival king (1 extra move + shoot)? */
function moveThenShoot(state: BoardState, side: Side): boolean {
    const rivalKing = state.pieces.find(p => p.type === 'king' && p.side !== side)!
    const holder = state.pieces.find(p => p.id === state.ball.holderId)
    const shoots = (s: BoardState): boolean => {
        const h = s.pieces.find(p => p.id === s.ball.holderId)
        if (!h || h.side !== side) return false
        return getValidPasses(h, s).some(t => applyPass(s, t).goalScored)
    }
    if (holder && holder.side === side && holder.type !== 'king') {
        for (const to of getValidMoves(holder, state)) if (shoots(applyMove(state, holder.id, to).boardState)) return true
    }
    return false
}

function looseGrabbable(state: BoardState, side: Side): boolean {
    if (state.ball.holderId) return false
    const ball = state.ball.pos
    for (const p of state.pieces) {
        if (p.side !== side || p.type === 'king') continue
        for (const m of getValidMoves(p, state)) {
            const nb = applyMove(state, p.id, m).boardState
            if (nb.ball.holderId === p.id) return true
        }
    }
    return false
}

const [wId, bId] = [process.argv[2] ?? 'engine-expert', process.argv[3] ?? 'claude-fable']
const maxTurns = Number(process.argv[4] ?? 60)
const fromT = Number(process.argv[5] ?? 1)
const toT = Number(process.argv[6] ?? maxTurns)
const scripts: Record<Side, AIPlayerScript> = { white: getAIScript(wId)!, black: getAIScript(bId)! }

let state = initial('white')
for (let turn = 1; turn <= maxTurns; turn++) {
    const side = state.turn
    const holder0 = state.pieces.find(p => p.id === state.ball.holderId)
    const holderDesc = holder0 ? `${holder0.id}@${fmt(holder0.pos)}` : `LOOSE@${fmt(state.ball.pos)}`
    let actions
    try { actions = scripts[side].play(structuredClone(state), side) } catch { actions = [{ type: 'end_turn' as const }] }

    const log = turn >= fromT && turn <= toT
    if (log) console.log(`\nT${turn} ${side} [${wId === scripts[side].name || side === 'white' ? wId : bId}] AP=${state.actionPoints} ball=${holderDesc}`)

    let goalBy: Side | null = null
    for (const a of actions) {
        if (!a || typeof a !== 'object') continue
        if (a.type === 'end_turn') { if (log) console.log(`   end_turn (AP left ${state.actionPoints})`); state = applyEndTurn(state); break }
        if (a.type === 'move' && a.pieceId && a.to) {
            const pc = state.pieces.find(p => p.id === a.pieceId && p.side === side)
            if (!pc || pc.hasMovedThisTurn || !getValidMoves(pc, state).some(m => m.x === a.to!.x && m.y === a.to!.y)) { if (log) console.log(`   INVALID move ${a.pieceId}→${fmt(a.to)}`); continue }
            const r = applyMove(state, a.pieceId, a.to); if (log) console.log(`   move ${a.pieceId}→${fmt(a.to)}${r.moveType === 'tackle' ? ' TACKLE' : ''}`); state = r.boardState
        } else if (a.type === 'pass' && a.pieceId && a.to) {
            const pc = state.pieces.find(p => p.id === a.pieceId && p.side === side)
            if (!pc || state.ball.holderId !== pc.id || !getValidPasses(pc, state).some(m => m.x === a.to!.x && m.y === a.to!.y)) { if (log) console.log(`   INVALID pass ${a.pieceId}→${fmt(a.to)}`); continue }
            const r = applyPass(state, a.to); if (log) console.log(`   pass ${a.pieceId}→${fmt(a.to)}${r.goalScored ? ' GOAL!' : r.forcedTurnEnd ? ' INTERCEPTED' : ''}`); state = r.boardState
            if (r.goalScored) { goalBy = side; break }
        }
        if (state.turn !== side) break
    }
    if (goalBy === null && state.turn === side) state = applyEndTurn(state)

    // Post-turn blunder flags (from the perspective of the side that just moved)
    if (log && goalBy === null) {
        const opp = other(side)
        const flags: string[] = []
        if (moveThenShoot(state, opp)) flags.push('LEFT-RIVAL-MOVE+SHOOT')
        if (looseGrabbable(state, side)) flags.push('OWN-LOOSE-BALL-UNGRABBED')
        if (looseGrabbable(state, opp)) flags.push('RIVAL-CAN-GRAB-LOOSE')
        if (flags.length) console.log(`   ⚠ ${flags.join(', ')}`)
    }
    if (goalBy) {
        const ns = { white: state.score.white + (goalBy === 'white' ? 1 : 0), black: state.score.black + (goalBy === 'black' ? 1 : 0) }
        if (log) console.log(`   ⚽ GOAL by ${goalBy}! score ${ns.white}-${ns.black}`)
        state = initial(other(goalBy), ns)
    }
}
console.log(`\nFinal: ${wId} ${state.score.white} - ${state.score.black} ${bId}`)
