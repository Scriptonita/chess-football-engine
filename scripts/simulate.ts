/**
 * AI vs AI simulation harness.
 *
 * Replicates the turn executor used by the apps (see futbolajedrez
 * app/api/training/turn/route.ts): each AI's `play()` is called once per turn,
 * every action is validated against the CURRENT (evolved) state, invalid
 * actions are silently skipped, and the turn is force-ended if the script
 * didn't end it.
 *
 * Usage:
 *   npm run simulate -- <scriptIdWhite> <scriptIdBlack> [games] [maxTurnsPerGame]
 *   npm run simulate -- claude-tactico chatgpt-tactico 20
 *   npm run simulate -- --all 10        # round-robin between all registered scripts
 */
import { getAIScript } from '../src/ai-players/registry'
import { getValidMoves, getValidPasses } from '../src/game-logic'
import { applyMove, applyPass, applyEndTurn } from '../src/game-engine'
import { AIPlayerScript } from '../src/types/ai-player'
import { BoardState, Piece, PieceType, Side } from '../src/types/game'

const REGISTERED = ['claude-tactico', 'chatgpt-tactico', 'gemini-tikitaka', 'claude-fable']

// ─────────────────────────────────────────────────────────
// Initial board (mirrors getInitialBoardState in @scriptonita/chess-football-ui)
// ─────────────────────────────────────────────────────────

function getInitialBoardState(servingSide: Side, currentScore = { white: 0, black: 0 }, maxActionPoints = 5): BoardState {
    const pieces: Piece[] = []
    const addPiece = (type: PieceType, side: Side, x: number, y: number) => {
        pieces.push({ id: `${side}_${type}_${x}_${y}`, type, side, pos: { x, y }, hasMovedThisTurn: false })
    }

    addPiece('rook',   'white', 0, 1)
    addPiece('rook',   'white', 8, 1)
    addPiece('bishop', 'white', 3, 2)
    addPiece('bishop', 'white', 5, 2)
    addPiece('king',   'white', 4, 1)
    addPiece('queen',  'white', 4, 5)
    addPiece('knight', 'white', 2, 4)
    addPiece('knight', 'white', 6, 4)

    addPiece('rook',   'black', 0, 10)
    addPiece('rook',   'black', 8, 10)
    addPiece('bishop', 'black', 3, 9)
    addPiece('bishop', 'black', 5, 9)
    addPiece('king',   'black', 4, 10)
    addPiece('queen',  'black', 4, 6)
    addPiece('knight', 'black', 2, 7)
    addPiece('knight', 'black', 6, 7)

    const servingQueen = pieces.find(p => p.side === servingSide && p.type === 'queen')!

    return {
        pieces,
        ball: { pos: { ...servingQueen.pos }, holderId: servingQueen.id },
        score: currentScore,
        actionPoints: maxActionPoints,
        maxActionPoints,
        turn: servingSide,
        moveHistory: [],
        turnNumber: 1,
    }
}

// ─────────────────────────────────────────────────────────
// Per-side stats
// ─────────────────────────────────────────────────────────

interface SideStats {
    goals: number
    turns: number
    actionsReturned: number
    actionsExecuted: number
    invalidMoves: number
    invalidPasses: number
    malformedActions: number
    passesIntercepted: number
    tackles: number
    offsidesCommitted: number
    wastedAP: number          // AP forfeited via forced/voluntary end_turn with actions remaining
    scriptErrors: number
}

function emptyStats(): SideStats {
    return {
        goals: 0, turns: 0, actionsReturned: 0, actionsExecuted: 0,
        invalidMoves: 0, invalidPasses: 0, malformedActions: 0,
        passesIntercepted: 0, tackles: 0, offsidesCommitted: 0,
        wastedAP: 0, scriptErrors: 0,
    }
}

// ─────────────────────────────────────────────────────────
// Turn executor (faithful to the app's training/turn route)
// ─────────────────────────────────────────────────────────

function playTurn(state: BoardState, script: AIPlayerScript, aiSide: Side, stats: SideStats): { state: BoardState; goalBy: Side | null } {
    stats.turns++
    let actions
    try {
        actions = script.play(structuredClone(state), aiSide)
        if (!Array.isArray(actions)) throw new Error('play() did not return an array')
    } catch {
        stats.scriptErrors++
        actions = [{ type: 'end_turn' as const }]
    }
    stats.actionsReturned += actions.length

    let goalBy: Side | null = null

    for (const action of actions) {
        if (!action || typeof action !== 'object') { stats.malformedActions++; continue }

        if (action.type === 'end_turn') {
            stats.wastedAP += state.actionPoints
            state = applyEndTurn(state)
            stats.actionsExecuted++
            break
        }

        if (action.type === 'move' && action.pieceId && action.to) {
            const piece = state.pieces.find(p => p.id === action.pieceId && p.side === aiSide)
            if (!piece || piece.hasMovedThisTurn) { stats.invalidMoves++; continue }

            const validMoves = getValidMoves(piece, state)
            if (!validMoves.some(m => m.x === action.to!.x && m.y === action.to!.y)) {
                stats.invalidMoves++
                continue
            }

            const { boardState: next, moveType } = applyMove(state, action.pieceId, action.to)
            if (moveType === 'tackle') stats.tackles++
            if (next.lastMove?.type === 'offside') stats.offsidesCommitted++
            state = next
            stats.actionsExecuted++
        } else if (action.type === 'pass' && action.pieceId && action.to) {
            const piece = state.pieces.find(p => p.id === action.pieceId && p.side === aiSide)
            if (!piece || state.ball.holderId !== piece.id) { stats.invalidPasses++; continue }

            const validPasses = getValidPasses(piece, state)
            if (!validPasses.some(p => p.x === action.to!.x && p.y === action.to!.y)) {
                stats.invalidPasses++
                continue
            }

            const { boardState: next, goalScored, forcedTurnEnd } = applyPass(state, action.to)
            if (next.lastMove?.type === 'offside') stats.offsidesCommitted++
            state = next
            stats.actionsExecuted++

            if (goalScored) {
                goalBy = aiSide
                break
            }
            if (forcedTurnEnd) stats.passesIntercepted++
        } else {
            stats.malformedActions++
        }

        if (state.turn !== aiSide) break
    }

    if (goalBy === null && state.turn === aiSide) {
        stats.wastedAP += state.actionPoints
        if (state.ball.holderId) {
            const holder = state.pieces.find(p => p.id === state.ball.holderId)
            const next = applyEndTurn(state)
            if (next.lastMove?.type === 'offside' && holder?.side === aiSide) stats.offsidesCommitted++
            state = next
        } else {
            state = applyEndTurn(state)
        }
    }

    return { state, goalBy }
}

// ─────────────────────────────────────────────────────────
// Match runner
// ─────────────────────────────────────────────────────────

interface MatchResult {
    score: { white: number; black: number }
    turnsPlayed: number
}

function playMatch(
    whiteScript: AIPlayerScript,
    blackScript: AIPlayerScript,
    statsBySide: Record<Side, SideStats>,
    maxTurns: number,
): MatchResult {
    let state = getInitialBoardState('white')
    let turnsPlayed = 0

    while (turnsPlayed < maxTurns) {
        const side = state.turn
        const script = side === 'white' ? whiteScript : blackScript
        const { state: next, goalBy } = playTurn(state, script, side, statsBySide[side])
        turnsPlayed++

        if (goalBy) {
            statsBySide[goalBy].goals++
            const score = {
                white: next.score.white + (goalBy === 'white' ? 1 : 0),
                black: next.score.black + (goalBy === 'black' ? 1 : 0),
            }
            const conceding: Side = goalBy === 'white' ? 'black' : 'white'
            state = getInitialBoardState(conceding, score)
        } else {
            state = next
        }
    }

    return { score: state.score, turnsPlayed }
}

// ─────────────────────────────────────────────────────────
// Reporting
// ─────────────────────────────────────────────────────────

function printStats(label: string, s: SideStats) {
    const invalid = s.invalidMoves + s.invalidPasses + s.malformedActions
    const fmt = (n: number) => (s.turns ? (n / s.turns).toFixed(2) : '0')
    console.log(`  ${label}`)
    console.log(`    goles: ${s.goals} | turnos: ${s.turns} | goles/100 turnos: ${s.turns ? (100 * s.goals / s.turns).toFixed(1) : 0}`)
    console.log(`    acciones devueltas/turno: ${fmt(s.actionsReturned)} | ejecutadas/turno: ${fmt(s.actionsExecuted)}`)
    console.log(`    acciones INVÁLIDAS descartadas: ${invalid} (moves: ${s.invalidMoves}, passes: ${s.invalidPasses}, malformed: ${s.malformedActions})`)
    console.log(`    intercepciones sufridas: ${s.passesIntercepted} | tackles hechos: ${s.tackles} | offsides cometidos: ${s.offsidesCommitted}`)
    console.log(`    AP desperdiciados/turno: ${fmt(s.wastedAP)} | errores de script: ${s.scriptErrors}`)
}

function runPairing(idA: string, idB: string, games: number, maxTurns: number) {
    const scriptA = getAIScript(idA)
    const scriptB = getAIScript(idB)
    if (!scriptA || !scriptB) {
        console.error(`Script no registrado: ${!scriptA ? idA : idB}. Registrados: ${REGISTERED.join(', ')}`)
        process.exit(1)
    }

    // Alternate colors each game so neither script gets a permanent first-move edge
    const statsByScript: Record<string, SideStats> = { [idA]: emptyStats(), [idB]: emptyStats() }
    let winsA = 0, winsB = 0, draws = 0

    for (let g = 0; g < games; g++) {
        const aPlaysWhite = g % 2 === 0
        const statsBySide: Record<Side, SideStats> = {
            white: statsByScript[aPlaysWhite ? idA : idB],
            black: statsByScript[aPlaysWhite ? idB : idA],
        }
        const result = playMatch(
            aPlaysWhite ? scriptA : scriptB,
            aPlaysWhite ? scriptB : scriptA,
            statsBySide,
            maxTurns,
        )
        const scoreA = aPlaysWhite ? result.score.white : result.score.black
        const scoreB = aPlaysWhite ? result.score.black : result.score.white
        if (scoreA > scoreB) winsA++
        else if (scoreB > scoreA) winsB++
        else draws++
    }

    console.log(`\n══ ${idA} vs ${idB} — ${games} partidas de ${maxTurns} turnos ══`)
    console.log(`  resultado: ${idA} ${winsA}W / ${idB} ${winsB}W / ${draws} empates`)
    printStats(idA, statsByScript[idA])
    printStats(idB, statsByScript[idB])
}

// ─────────────────────────────────────────────────────────
// CLI
// ─────────────────────────────────────────────────────────

const args = process.argv.slice(2)

if (args[0] === '--all') {
    const games = Number(args[1] ?? 10)
    const maxTurns = Number(args[2] ?? 200)
    for (let i = 0; i < REGISTERED.length; i++) {
        for (let j = i + 1; j < REGISTERED.length; j++) {
            runPairing(REGISTERED[i], REGISTERED[j], games, maxTurns)
        }
    }
} else if (args.length >= 2) {
    runPairing(args[0], args[1], Number(args[2] ?? 10), Number(args[3] ?? 200))
} else {
    console.log('Uso: npm run simulate -- <scriptIdA> <scriptIdB> [partidas] [maxTurnos]')
    console.log('     npm run simulate -- --all [partidas] [maxTurnos]')
    console.log(`Scripts registrados: ${REGISTERED.join(', ')}`)
    process.exit(1)
}
