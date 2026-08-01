/**
 * Generates the goal-reel data consumed by chess-football-webapp's
 * `LandingBoardDemo` (the animated board on the marketing landing page).
 *
 * Every frame is produced by literally applying real engine actions
 * (applyMove/applyPass/applyEndTurn, gated by getValidMoves/getValidPasses) chosen
 * by real CHAMPIONSHIP_ROSTER bots playing each other — so every position and every
 * transition between frames is provably legal. Nothing here is hand-authored, which
 * is the fix for the original bug: a hand-picked "knight move" in the old demo data
 * was not a legal knight move, and only 2 of the 16 pieces were ever shown.
 *
 * Produces:
 *   - OPENING_CLIP: kickoff position + 2 real turns (no goal expected, just play).
 *   - GOAL_CLIPS: 5 short clips, each the last turn of a different simulated match,
 *     picked for variety (different scoring piece types / build-up lengths).
 *
 * Usage:
 *   npx tsx scripts/gen-landing-clips.ts [outFile]
 *   (outFile defaults to a sibling checkout of chess-football-webapp; pass an
 *   explicit path if your workspace layout differs.)
 */
import * as fs from 'node:fs'
import * as path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
import { getInitialBoardState } from '../src/initial-board'
import { getValidMoves, getValidPasses } from '../src/game-logic'
import { applyMove, applyPass, applyEndTurn } from '../src/game-engine'
import { CHAMPIONSHIP_ROSTER } from '../src/bot-engine'
import type { BoardState, Piece, Ball, Side, PieceType } from '../src/types/game'
import type { BotAction } from '../src/types/bot'

interface DemoFrame { pieces: Piece[]; ball: Ball; isGoal?: true }
interface DemoClip { frames: DemoFrame[] }

const other = (s: Side): Side => (s === 'white' ? 'black' : 'white')

const snapshot = (b: BoardState): DemoFrame => ({
    pieces: b.pieces.map(p => ({ ...p, pos: { ...p.pos } })),
    ball: { ...b.ball },
})

interface TurnResult { frames: DemoFrame[]; state: BoardState; scored: boolean; scorerType?: PieceType }

/** Plays one full bot turn, returning a frame per legal action actually applied. */
function playTurn(state: BoardState, script: { play: (b: BoardState, s: Side) => BotAction[] }, side: Side): TurnResult {
    let actions: BotAction[]
    try {
        actions = script.play(structuredClone(state), side)
        if (!Array.isArray(actions)) throw new Error('non-array')
    } catch {
        actions = [{ type: 'end_turn' }]
    }

    const frames: DemoFrame[] = []
    let scored = false
    let scorerType: PieceType | undefined

    for (const a of actions) {
        if (!a || typeof a !== 'object') continue
        if (a.type === 'end_turn') { state = applyEndTurn(state); break }

        if (a.type === 'move' && a.pieceId && a.to) {
            const pc = state.pieces.find(p => p.id === a.pieceId && p.side === side)
            if (!pc || pc.hasMovedThisTurn || !getValidMoves(pc, state).some(m => m.x === a.to!.x && m.y === a.to!.y)) continue
            state = applyMove(state, a.pieceId, a.to).boardState
            frames.push(snapshot(state))
        } else if (a.type === 'pass' && a.pieceId && a.to) {
            const pc = state.pieces.find(p => p.id === a.pieceId && p.side === side)
            if (!pc || state.ball.holderId !== pc.id || !getValidPasses(pc, state).some(m => m.x === a.to!.x && m.y === a.to!.y)) continue
            const r = applyPass(state, a.to)
            state = r.boardState
            const f = snapshot(state)
            if (r.goalScored) { f.isGoal = true; scored = true; scorerType = pc.type }
            frames.push(f)
            if (r.goalScored || r.forcedTurnEnd) break
        }
        if (state.turn !== side) break
    }
    if (!scored && state.turn === side) state = applyEndTurn(state)
    return { frames, state, scored, scorerType }
}

// ── Opening clip: real kickoff, 2 real turns ──────────────────────────────────

function genOpeningClip(): DemoClip {
    const white = CHAMPIONSHIP_ROSTER[0] // striker-direct — lively, moves pieces early
    const black = CHAMPIONSHIP_ROSTER[2] // defender-positional — visibly different style
    let state = getInitialBoardState('white')
    const frames: DemoFrame[] = [snapshot(state)]

    for (const [script, side] of [[white, 'white'], [black, 'black']] as const) {
        const r = playTurn(state, script, side)
        frames.push(...r.frames)
        state = r.state
    }
    return { frames }
}

// ── Goal clips: simulate matches, capture the scoring turn ───────────────────

interface Candidate { clip: DemoClip; scorerType: PieceType; actionCount: number; scorer: Side }

function simulateUntilGoal(
    white: (typeof CHAMPIONSHIP_ROSTER)[number],
    black: (typeof CHAMPIONSHIP_ROSTER)[number],
    maxTurns: number,
): Candidate | null {
    let state = getInitialBoardState('white')
    for (let t = 0; t < maxTurns; t++) {
        const side = state.turn
        const script = side === 'white' ? white : black
        const turnStart = snapshot(state)
        const r = playTurn(state, script, side)
        if (r.scored) {
            return {
                clip: { frames: [turnStart, ...r.frames] },
                scorerType: r.scorerType!,
                actionCount: r.frames.length,
                scorer: side,
            }
        }
        state = r.state
    }
    return null
}

function pickDiverse(pool: Candidate[], n: number): Candidate[] {
    const chosen: Candidate[] = []
    const usedTypes = new Set<PieceType>()
    for (const c of pool) {
        if (chosen.length >= n) break
        if (!usedTypes.has(c.scorerType)) { chosen.push(c); usedTypes.add(c.scorerType) }
    }
    for (const c of pool) {
        if (chosen.length >= n) break
        if (!chosen.includes(c)) chosen.push(c)
    }
    return chosen.slice(0, n)
}

function genGoalClips(count: number): DemoClip[] {
    const roster = CHAMPIONSHIP_ROSTER
    const pairings: Array<[number, number]> = []
    for (let i = 0; i < roster.length; i++) {
        for (let j = 0; j < roster.length; j++) {
            if (i !== j) pairings.push([i, j]) // both color orders
        }
    }

    const pool: Candidate[] = []
    let attempts = 0
    let pairingCursor = 0
    // Reused singleton bots drift via their internal moveCounter, so replaying the
    // same pairing again still yields a different game — keep cycling until the pool
    // is comfortably larger than what we need to pick a diverse `count` from.
    while (pool.length < count * 3 && attempts < 60) {
        const [wi, bi] = pairings[pairingCursor % pairings.length]
        pairingCursor++
        attempts++
        const found = simulateUntilGoal(roster[wi], roster[bi], 80)
        if (found) pool.push(found)
    }

    if (pool.length < count) {
        throw new Error(`Only found ${pool.length} goal clips after ${attempts} attempts (needed ${count}).`)
    }
    return pickDiverse(pool, count).map(c => c.clip)
}

// ── Serialize ──────────────────────────────────────────────────────────────────

function renderClip(clip: DemoClip): string {
    return JSON.stringify(clip, null, 4)
}

function main() {
    const outArg = process.argv[2]
    const outFile = outArg
        ? path.resolve(outArg)
        : path.resolve(__dirname, '../../chess-football-webapp/components/game/landing-demo-clips.ts')

    const opening = genOpeningClip()
    const goals = genGoalClips(5)

    const banner = `// AUTO-GENERATED by chess-football-engine/scripts/gen-landing-clips.ts — do not hand-edit.
// Every frame here comes from actually applying real engine actions (applyMove /
// applyPass), chosen by real CHAMPIONSHIP_ROSTER bots — every position and every
// transition between frames is a legal chess.football move. Regenerate with:
//   cd chess-football-engine && npx tsx scripts/gen-landing-clips.ts
`

    const content = `${banner}
import type { Piece, Ball } from '@scriptonita/chess-football-engine'

export interface DemoFrame {
    pieces: Piece[]
    ball: Ball
    /** True on the frame where the pass just reached the rival king. */
    isGoal?: true
}

export interface DemoClip {
    frames: DemoFrame[]
}

/** Kickoff position + two real turns (no goal expected — just live play). */
export const OPENING_CLIP: DemoClip = ${renderClip(opening)}

/** Five short clips, each the scoring turn of a different simulated match. */
export const GOAL_CLIPS: DemoClip[] = ${JSON.stringify(goals, null, 4)}
`

    fs.mkdirSync(path.dirname(outFile), { recursive: true })
    fs.writeFileSync(outFile, content)
    console.log(`Wrote ${outFile}`)
    console.log(`  opening: ${opening.frames.length} frames`)
    goals.forEach((g, i) => console.log(`  goal ${i + 1}: ${g.frames.length} frames`))
}

main()
