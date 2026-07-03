/**
 * Compact benchmark: one engine vs a set of opponents, N games each, alternating
 * colors, at a configurable action-point budget. Prints a one-line summary per
 * opponent (W-D-L and goals for/against).
 *
 * Usage:
 *   npx tsx scripts/bench.ts <engineId> [games] [maxTurns] [ap] [opp1,opp2,...]
 *   npx tsx scripts/bench.ts engine-expert 20 200 5
 *   npx tsx scripts/bench.ts engine-expert 20 200 3 claude-fable,claude-opus
 */
import { getAIScript } from '../src/ai-players/registry'
import { getValidMoves, getValidPasses } from '../src/game-logic'
import { applyMove, applyPass, applyEndTurn } from '../src/game-engine'
import { AIPlayerScript } from '../src/types/ai-player'
import { BoardState, Piece, PieceType, Side } from '../src/types/game'

function initial(servingSide: Side, score = { white: 0, black: 0 }, ap = 5): BoardState {
    const pieces: Piece[] = []
    const add = (type: PieceType, side: Side, x: number, y: number) =>
        pieces.push({ id: `${side}_${type}_${x}_${y}`, type, side, pos: { x, y }, hasMovedThisTurn: false })
    add('rook', 'white', 0, 1); add('rook', 'white', 8, 1)
    add('bishop', 'white', 3, 2); add('bishop', 'white', 5, 2)
    add('king', 'white', 4, 1); add('queen', 'white', 4, 5)
    add('knight', 'white', 2, 4); add('knight', 'white', 6, 4)
    add('rook', 'black', 0, 10); add('rook', 'black', 8, 10)
    add('bishop', 'black', 3, 9); add('bishop', 'black', 5, 9)
    add('king', 'black', 4, 10); add('queen', 'black', 4, 6)
    add('knight', 'black', 2, 7); add('knight', 'black', 6, 7)
    const q = pieces.find(p => p.side === servingSide && p.type === 'queen')!
    return { pieces, ball: { pos: { ...q.pos }, holderId: q.id }, score, actionPoints: ap, maxActionPoints: ap, turn: servingSide, moveHistory: [], turnNumber: 1 }
}

const other = (s: Side): Side => (s === 'white' ? 'black' : 'white')

function playTurn(state: BoardState, script: AIPlayerScript, side: Side): { state: BoardState; goalBy: Side | null } {
    let actions
    try { actions = script.play(structuredClone(state), side); if (!Array.isArray(actions)) throw 0 } catch { actions = [{ type: 'end_turn' as const }] }
    let goalBy: Side | null = null
    for (const a of actions) {
        if (!a || typeof a !== 'object') continue
        if (a.type === 'end_turn') { state = applyEndTurn(state); break }
        if (a.type === 'move' && a.pieceId && a.to) {
            const pc = state.pieces.find(p => p.id === a.pieceId && p.side === side)
            if (!pc || pc.hasMovedThisTurn || !getValidMoves(pc, state).some(m => m.x === a.to!.x && m.y === a.to!.y)) continue
            state = applyMove(state, a.pieceId, a.to).boardState
        } else if (a.type === 'pass' && a.pieceId && a.to) {
            const pc = state.pieces.find(p => p.id === a.pieceId && p.side === side)
            if (!pc || state.ball.holderId !== pc.id || !getValidPasses(pc, state).some(m => m.x === a.to!.x && m.y === a.to!.y)) continue
            const r = applyPass(state, a.to); state = r.boardState
            if (r.goalScored) { goalBy = side; break }
        }
        if (state.turn !== side) break
    }
    if (goalBy === null && state.turn === side) state = applyEndTurn(state)
    return { state, goalBy }
}

function playMatch(w: AIPlayerScript, b: AIPlayerScript, maxTurns: number, ap: number): { white: number; black: number } {
    let state = initial('white', { white: 0, black: 0 }, ap)
    for (let t = 0; t < maxTurns; t++) {
        const side = state.turn
        const { state: next, goalBy } = playTurn(state, side === 'white' ? w : b, side)
        if (goalBy) {
            const score = { white: next.score.white + (goalBy === 'white' ? 1 : 0), black: next.score.black + (goalBy === 'black' ? 1 : 0) }
            state = initial(other(goalBy), score, ap)
        } else state = next
    }
    return state.score
}

const engineId = process.argv[2] ?? 'engine-expert'
const games = Number(process.argv[3] ?? 20)
const maxTurns = Number(process.argv[4] ?? 200)
const ap = Number(process.argv[5] ?? 5)
const opps = (process.argv[6] ?? 'claude-fable,claude-opus,gemini-tikitaka,chatgpt-tactico,claude-tactico').split(',')

const engine = getAIScript(engineId)!
if (!engine) { console.error(`unknown engine ${engineId}`); process.exit(1) }

console.log(`\n### ${engineId} — ${games} games × ${maxTurns} turns @ ${ap} AP\n`)
let totW = 0, totL = 0, totD = 0
for (const oppId of opps) {
    const opp = getAIScript(oppId)
    if (!opp) { console.log(`  ${oppId}: NOT REGISTERED`); continue }
    let W = 0, D = 0, L = 0, gf = 0, ga = 0
    for (let g = 0; g < games; g++) {
        const engWhite = g % 2 === 0
        const score = playMatch(engWhite ? engine : opp, engWhite ? opp : engine, maxTurns, ap)
        const es = engWhite ? score.white : score.black
        const os = engWhite ? score.black : score.white
        gf += es; ga += os
        if (es > os) W++; else if (os > es) L++; else D++
    }
    totW += W; totL += L; totD += D
    const pct = ((W + D / 2) / games * 100).toFixed(0)
    console.log(`  vs ${oppId.padEnd(18)} ${W}W ${D}D ${L}L  (${pct}%)  goals ${gf}-${ga}`)
}
console.log(`\n  TOTAL ${totW}W ${totD}D ${totL}L  (${((totW + totD / 2) / (totW + totD + totL) * 100).toFixed(0)}%)\n`)
