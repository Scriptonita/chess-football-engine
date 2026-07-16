/**
 * AI training simulator with failure diagnosis.
 *
 * Extends the simulate.ts harness: besides counting failures it CLASSIFIES them
 * (why was each action invalid) and detects MISSED OPPORTUNITIES per turn
 * (available goal shots not taken, available tackles ignored, loose balls not
 * contested, king left exposed to a clean shot). The output is a training
 * report meant to feed back into docs/AI_GAME_RULES.md and AI_PLAYER_PROMPT.md.
 *
 * Usage:
 *   npm run train -- <scriptIdWhite> <scriptIdBlack> [games] [maxTurnsPerGame]
 *   npm run train -- --all 10 [maxTurns]
 *   npm run train -- --all 10 200 --md reports/training.md
 */
import { writeFileSync, mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { getAIScript } from '../src/ai-players/registry'
import { getValidMoves, getValidPasses, isInOwnArea } from '../src/game-logic'
import { applyMove, applyPass, applyEndTurn } from '../src/game-engine'
import { AIAction, AIPlayerScript } from '../src/types/ai-player'
import { BoardState, Piece, PieceType, Position, Side } from '../src/types/game'

const REGISTERED = ['claude-tactico', 'chatgpt-tactico', 'gemini-tikitaka', 'claude-fable', 'claude-opus',
    'engine-beginner', 'engine-intermediate', 'engine-advanced', 'engine-expert', 'engine-legendary']

// ─────────────────────────────────────────────────────────
// Initial board (mirrors simulate.ts / getInitialBoardState in the UI package)
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
// Board oracles (ground truth about what was possible)
// ─────────────────────────────────────────────────────────

const otherSide = (s: Side): Side => (s === 'white' ? 'black' : 'white')
const pieceAt = (state: BoardState, pos: Position): Piece | undefined =>
    state.pieces.find(p => p.pos.x === pos.x && p.pos.y === pos.y)
const fmtPos = (p: Position) => `{${p.x},${p.y}}`

/** True if a pass from->to by `side` resolves without interception (goal counts as safe). */
function isPassSafe(state: BoardState, holder: Piece, to: Position): boolean {
    if (holder.type === 'knight') {
        const atDest = pieceAt(state, to)
        if (atDest && atDest.side !== holder.side && atDest.type !== 'king') return false
        return true
    }
    const dx = Math.sign(to.x - holder.pos.x)
    const dy = Math.sign(to.y - holder.pos.y)
    let cx = holder.pos.x + dx
    let cy = holder.pos.y + dy
    let steps = 0
    while ((cx !== to.x || cy !== to.y) && steps < 20) {
        const inPath = pieceAt(state, { x: cx, y: cy })
        if (inPath && inPath.side !== holder.side) return inPath.type === 'king'
        cx += dx
        cy += dy
        steps++
    }
    const atDest = pieceAt(state, to)
    if (atDest && atDest.side !== holder.side && atDest.type !== 'king') return false
    return true
}

/** Direct safe shot on the rival king from the holder's current square (1 AP). */
function hasDirectShot(state: BoardState, side: Side): boolean {
    const holder = state.pieces.find(p => p.id === state.ball.holderId)
    if (!holder || holder.side !== side) return false
    const rivalKing = state.pieces.find(p => p.type === 'king' && p.side !== side)!
    return getValidPasses(holder, state).some(t => {
        const hitsKing = (t.x === rivalKing.pos.x && t.y === rivalKing.pos.y) ||
            (holder.type !== 'knight' && isOnSegment(holder.pos, t, rivalKing.pos))
        return hitsKing && isPassSafe(state, holder, t)
    })
}

function isOnSegment(from: Position, to: Position, point: Position): boolean {
    const dx = Math.sign(to.x - from.x)
    const dy = Math.sign(to.y - from.y)
    let cx = from.x + dx
    let cy = from.y + dy
    let steps = 0
    while ((cx !== to.x || cy !== to.y) && steps < 20) {
        if (cx === point.x && cy === point.y) return true
        cx += dx
        cy += dy
        steps++
    }
    return false
}

/** Goal reachable in 2 AP: conduct+shoot with the holder, or safe pass to a teammate who has a direct shot. */
function hasTwoApShot(state: BoardState, side: Side): 'conduct+shoot' | 'pass+shoot' | null {
    const holder = state.pieces.find(p => p.id === state.ball.holderId)
    if (!holder || holder.side !== side || holder.type === 'king') return null

    if (!holder.hasMovedThisTurn) {
        for (const dest of getValidMoves(holder, state)) {
            const sim = simulateConduct(state, holder, dest)
            if (hasDirectShot(sim, side)) return 'conduct+shoot'
        }
    }

    for (const target of getValidPasses(holder, state)) {
        const mate = pieceAt(state, target)
        if (!mate || mate.side !== side || mate.type === 'king') continue
        if (!isPassSafe(state, holder, target)) continue
        const sim: BoardState = { ...state, ball: { pos: { ...target }, holderId: mate.id } }
        if (hasDirectShot(sim, side)) return 'pass+shoot'
    }
    return null
}

function simulateConduct(state: BoardState, holder: Piece, dest: Position): BoardState {
    const pieces = state.pieces
        .filter(p => !(p.pos.x === dest.x && p.pos.y === dest.y && p.side !== holder.side)) // tackled rival: ignore exact displacement
        .map(p => (p.id === holder.id ? { ...p, pos: { ...dest }, hasMovedThisTurn: true } : p))
    return { ...state, pieces, ball: { pos: { ...dest }, holderId: holder.id } }
}

/** Tackle available: some piece of `side` can move onto the rival ball holder. */
function findTackle(state: BoardState, side: Side): { piece: Piece; to: Position } | null {
    const holder = state.pieces.find(p => p.id === state.ball.holderId)
    if (!holder || holder.side === side || holder.type === 'king') return null
    for (const p of state.pieces) {
        if (p.side !== side || p.type === 'king' || p.hasMovedThisTurn) continue
        if (getValidMoves(p, state).some(m => m.x === holder.pos.x && m.y === holder.pos.y)) {
            return { piece: p, to: holder.pos }
        }
    }
    return null
}

/** Loose ball capturable this turn by `side` (linear cross or exact landing). */
function canCaptureLooseBall(state: BoardState, side: Side): boolean {
    if (state.ball.holderId !== null) return false
    const ballPos = state.ball.pos
    for (const p of state.pieces) {
        if (p.side !== side || p.hasMovedThisTurn) continue
        for (const dest of getValidMoves(p, state)) {
            if (dest.x === ballPos.x && dest.y === ballPos.y) return true
            if (p.type !== 'knight' && p.type !== 'king' && isOnSegment(p.pos, dest, ballPos)) return true
            if (p.type === 'king' && dest.x === ballPos.x && dest.y === ballPos.y) return true
        }
    }
    return false
}

/** Opponent holder has a clean direct shot at `side`'s king right now. */
function kingExposedDirect(state: BoardState, side: Side): boolean {
    return hasDirectShot(state, otherSide(side))
}

/** Opponent holder can move once and then shoot cleanly at `side`'s king. */
function kingExposedAfterMove(state: BoardState, side: Side): boolean {
    const opp = otherSide(side)
    const holder = state.pieces.find(p => p.id === state.ball.holderId)
    if (!holder || holder.side !== opp || holder.type === 'king') return false
    for (const dest of getValidMoves(holder, { ...state, pieces: state.pieces.map(p => p.id === holder.id ? { ...p, hasMovedThisTurn: false } : p) })) {
        const sim = simulateConduct(state, { ...holder, hasMovedThisTurn: false }, dest)
        if (hasDirectShot(sim, opp)) return true
    }
    return false
}

// ─────────────────────────────────────────────────────────
// Invalid-action classifiers
// ─────────────────────────────────────────────────────────

function matchesMovePattern(piece: Piece, to: Position): boolean {
    const dx = to.x - piece.pos.x
    const dy = to.y - piece.pos.y
    const adx = Math.abs(dx), ady = Math.abs(dy)
    if (adx === 0 && ady === 0) return false
    switch (piece.type) {
        case 'king': return adx <= 1 && ady <= 1
        case 'rook': return dx === 0 || dy === 0
        case 'bishop': return adx === ady
        case 'queen': return dx === 0 || dy === 0 || adx === ady
        case 'knight': return (adx === 1 && ady === 2) || (adx === 2 && ady === 1)
    }
}

function classifyInvalidMove(state: BoardState, action: AIAction, aiSide: Side): string {
    const piece = state.pieces.find(p => p.id === action.pieceId)
    if (!piece) return 'pieceId inexistente (¿ID reconstruido desde la posición actual?)'
    if (piece.side !== aiSide) return 'la pieza es del rival'
    if (piece.hasMovedThisTurn) return 'pieza ya movida este turno (hasMovedThisTurn) — plan desincronizado'
    const to = action.to!
    if (to.x < 0 || to.x > 8 || to.y < 0 || to.y > 11) return 'destino fuera del tablero'
    const occ = pieceAt(state, to)
    if (occ && occ.type === 'king' && occ.side !== aiSide) return 'destino = casilla del rey rival (intocable)'
    if (occ && occ.side === aiSide) return 'destino ocupado por pieza propia — plan desincronizado o sin chequear'
    if (piece.type === 'king' && !isInOwnArea(to, aiSide)) return 'rey fuera de su área'
    if (piece.type !== 'king' && isInOwnArea(to, aiSide)) return 'pieza no-rey intentando entrar en su PROPIA área'
    if (!matchesMovePattern(piece, to)) return `destino no sigue el patrón de movimiento de ${piece.type}`
    if (occ && occ.side !== aiSide && state.ball.holderId !== occ.id) return 'mover sobre rival SIN balón (no es tackle válido)'
    if (occ && occ.side !== aiSide && state.ball.holderId === occ.id) return 'tackle imposible: portador sin ortogonal libre para desplazarlo'
    if (piece.type !== 'knight') return 'trayectoria bloqueada por otra pieza (los moves NO saltan)'
    return 'otro motivo'
}

function classifyInvalidPass(state: BoardState, action: AIAction, aiSide: Side): string {
    const piece = state.pieces.find(p => p.id === action.pieceId)
    if (!piece) return 'pieceId inexistente (¿ID reconstruido desde la posición actual?)'
    if (piece.side !== aiSide) return 'la pieza es del rival'
    if (state.ball.holderId !== piece.id) {
        const holder = state.pieces.find(p => p.id === state.ball.holderId)
        const where = holder ? `lo tiene ${holder.id}` : 'está suelto'
        return `la pieza NO tiene el balón en ese momento (${where}) — plan desincronizado`
    }
    const to = action.to!
    if (to.x < 0 || to.x > 8 || to.y < 0 || to.y > 11) return 'destino fuera del tablero'
    const keeper = state.keeperBlockedId ? state.pieces.find(p => p.id === state.keeperBlockedId) : null
    if (keeper && keeper.pos.x === to.x && keeper.pos.y === to.y) return 'destino = portero bloqueado (regla de cesión, keeperBlockedId)'
    if (!matchesMovePattern(piece, to)) return `destino no sigue el patrón direccional de ${piece.type}`
    return 'otro motivo'
}

// ─────────────────────────────────────────────────────────
// Stats with diagnosis
// ─────────────────────────────────────────────────────────

const SAMPLES_PER_REASON = 3

interface Tally {
    count: number
    samples: string[]
}

interface TrainStats {
    goals: number
    turns: number
    actionsReturned: number
    actionsExecuted: number
    wastedAP: number
    scriptErrors: number
    tackles: number
    passesIntercepted: Tally
    offsides: Tally
    invalidMoves: Record<string, Tally>
    invalidPasses: Record<string, Tally>
    missedDirectShots: Tally       // had a 1-AP clean shot, turn ended without goal
    missedTwoApShots: Tally        // goal reachable in 2 AP, not taken (and no direct shot counted)
    missedTackles: Tally           // tackle available, turn ended without tackling rival holder
    missedLooseBalls: Tally        // loose ball capturable, turn ended without possession
    kingLeftExposedDirect: Tally   // own turn ended with rival holder having a clean direct shot
    kingLeftExposedOneMove: Tally  // ... or a clean move+shoot
}

function tally(): Tally { return { count: 0, samples: [] } }
function emptyStats(): TrainStats {
    return {
        goals: 0, turns: 0, actionsReturned: 0, actionsExecuted: 0,
        wastedAP: 0, scriptErrors: 0, tackles: 0,
        passesIntercepted: tally(), offsides: tally(),
        invalidMoves: {}, invalidPasses: {},
        missedDirectShots: tally(), missedTwoApShots: tally(),
        missedTackles: tally(), missedLooseBalls: tally(),
        kingLeftExposedDirect: tally(), kingLeftExposedOneMove: tally(),
    }
}

function record(t: Tally, sample: string) {
    t.count++
    if (t.samples.length < SAMPLES_PER_REASON) t.samples.push(sample)
}

function recordReason(map: Record<string, Tally>, reason: string, sample: string) {
    if (!map[reason]) map[reason] = tally()
    record(map[reason], sample)
}

// ─────────────────────────────────────────────────────────
// Turn executor with diagnosis
// ─────────────────────────────────────────────────────────

interface TurnContext { game: number; turn: number }

function playTurn(
    state: BoardState,
    script: AIPlayerScript,
    aiSide: Side,
    stats: TrainStats,
    ctx: TurnContext,
): { state: BoardState; goalBy: Side | null } {
    stats.turns++
    const tag = `[g${ctx.game} t${ctx.turn} ${aiSide}]`

    // ── Pre-turn oracle ──
    const ap = state.actionPoints
    const oracleDirectShot = hasDirectShot(state, aiSide)
    const oracleTwoApShot = !oracleDirectShot && ap >= 2 ? hasTwoApShot(state, aiSide) : null
    const oracleTackle = findTackle(state, aiSide)
    const oracleLooseBall = canCaptureLooseBall(state, aiSide)

    let actions: AIAction[]
    try {
        actions = script.play(structuredClone(state), aiSide)
        if (!Array.isArray(actions)) throw new Error('play() did not return an array')
    } catch {
        stats.scriptErrors++
        actions = [{ type: 'end_turn' }]
    }
    stats.actionsReturned += actions.length

    let goalBy: Side | null = null
    let tackledThisTurn = false

    for (const action of actions) {
        if (!action || typeof action !== 'object') {
            recordReason(stats.invalidMoves, 'acción malformada (no es objeto)', `${tag} ${JSON.stringify(action)}`)
            continue
        }

        if (action.type === 'end_turn') {
            stats.wastedAP += state.actionPoints
            state = applyEndTurn(state)
            stats.actionsExecuted++
            break
        }

        if (action.type === 'move' && action.pieceId && action.to) {
            const piece = state.pieces.find(p => p.id === action.pieceId && p.side === aiSide)
            const valid = piece && !piece.hasMovedThisTurn &&
                getValidMoves(piece, state).some(m => m.x === action.to!.x && m.y === action.to!.y)
            if (!valid) {
                const reason = classifyInvalidMove(state, action, aiSide)
                recordReason(stats.invalidMoves, reason, `${tag} move ${action.pieceId} → ${fmtPos(action.to)}`)
                continue
            }
            const { boardState: next, moveType } = applyMove(state, action.pieceId, action.to)
            if (moveType === 'tackle') { stats.tackles++; tackledThisTurn = true }
            if (next.lastMove?.type === 'offside') record(stats.offsides, `${tag} tras move ${action.pieceId} → ${fmtPos(action.to)}, offside de ${next.lastMove.playerId} en ${next.lastMove.from ? fmtPos(next.lastMove.from) : '?'}`)
            state = next
            stats.actionsExecuted++
        } else if (action.type === 'pass' && action.pieceId && action.to) {
            const piece = state.pieces.find(p => p.id === action.pieceId && p.side === aiSide)
            const valid = piece && state.ball.holderId === piece.id &&
                getValidPasses(piece, state).some(p => p.x === action.to!.x && p.y === action.to!.y)
            if (!valid) {
                const reason = classifyInvalidPass(state, action, aiSide)
                recordReason(stats.invalidPasses, reason, `${tag} pass ${action.pieceId} → ${fmtPos(action.to)}`)
                continue
            }
            const { boardState: next, goalScored, forcedTurnEnd } = applyPass(state, action.to)
            if (next.lastMove?.type === 'offside') record(stats.offsides, `${tag} tras pass ${action.pieceId} → ${fmtPos(action.to)}, offside de ${next.lastMove.playerId} en ${next.lastMove.from ? fmtPos(next.lastMove.from) : '?'}`)
            state = next
            stats.actionsExecuted++
            if (goalScored) { goalBy = aiSide; break }
            if (forcedTurnEnd) {
                record(stats.passesIntercepted, `${tag} pass ${action.pieceId} → ${fmtPos(action.to)} interceptado`)
            }
        } else {
            recordReason(stats.invalidMoves, 'acción malformada (faltan pieceId/to)', `${tag} ${JSON.stringify(action)}`)
        }

        if (state.turn !== aiSide) break
    }

    if (goalBy === null && state.turn === aiSide) {
        stats.wastedAP += state.actionPoints
        const holder = state.pieces.find(p => p.id === state.ball.holderId)
        const next = applyEndTurn(state)
        if (next.lastMove?.type === 'offside' && holder?.side === aiSide) {
            record(stats.offsides, `${tag} fin de turno con ${holder.id} portando el balón en ${fmtPos(holder.pos)} (área rival)`)
        }
        state = next
    }

    // ── Post-turn missed-opportunity accounting ──
    if (goalBy === null) {
        if (oracleDirectShot) record(stats.missedDirectShots, `${tag} había disparo directo limpio al rey y no se chutó`)
        else if (oracleTwoApShot) record(stats.missedTwoApShots, `${tag} había gol en 2 AP (${oracleTwoApShot}) y no se ejecutó`)
    }
    if (oracleTackle && !tackledThisTurn) {
        const holderNow = state.pieces.find(p => p.id === state.ball.holderId)
        if (holderNow && holderNow.side !== aiSide) {
            record(stats.missedTackles, `${tag} ${oracleTackle.piece.id} podía tacklear en ${fmtPos(oracleTackle.to)} y no lo hizo`)
        }
    }
    if (oracleLooseBall) {
        const holderNow = state.pieces.find(p => p.id === state.ball.holderId)
        if (!holderNow || holderNow.side !== aiSide) {
            record(stats.missedLooseBalls, `${tag} balón suelto capturable y el turno acabó sin posesión`)
        }
    }
    if (goalBy === null) {
        if (kingExposedDirect(state, aiSide)) {
            record(stats.kingLeftExposedDirect, `${tag} turno terminado con disparo directo rival limpio a nuestro rey`)
        } else if (kingExposedAfterMove(state, aiSide)) {
            record(stats.kingLeftExposedOneMove, `${tag} turno terminado con gol rival disponible en mover+chutar`)
        }
    }

    return { state, goalBy }
}

// ─────────────────────────────────────────────────────────
// Match runner
// ─────────────────────────────────────────────────────────

function playMatch(
    whiteScript: AIPlayerScript,
    blackScript: AIPlayerScript,
    statsBySide: Record<Side, TrainStats>,
    maxTurns: number,
    game: number,
): { score: { white: number; black: number } } {
    let state = getInitialBoardState('white')
    let turnsPlayed = 0

    while (turnsPlayed < maxTurns) {
        const side = state.turn
        const script = side === 'white' ? whiteScript : blackScript
        const { state: next, goalBy } = playTurn(state, script, side, statsBySide[side], { game, turn: turnsPlayed + 1 })
        turnsPlayed++

        if (goalBy) {
            statsBySide[goalBy].goals++
            const score = {
                white: next.score.white + (goalBy === 'white' ? 1 : 0),
                black: next.score.black + (goalBy === 'black' ? 1 : 0),
            }
            state = getInitialBoardState(goalBy === 'white' ? 'black' : 'white', score)
        } else {
            state = next
        }
    }
    return { score: state.score }
}

// ─────────────────────────────────────────────────────────
// Reporting
// ─────────────────────────────────────────────────────────

const out: string[] = []
function log(line = '') {
    out.push(line)
    console.log(line)
}

function printTallyMap(title: string, map: Record<string, Tally>) {
    const entries = Object.entries(map).sort((a, b) => b[1].count - a[1].count)
    if (entries.length === 0) return
    log(`    ${title}:`)
    for (const [reason, t] of entries) {
        log(`      · ${t.count}× ${reason}`)
        for (const s of t.samples) log(`          ej: ${s}`)
    }
}

function printTally(title: string, t: Tally) {
    if (t.count === 0) return
    log(`    ${title}: ${t.count}`)
    for (const s of t.samples) log(`        ej: ${s}`)
}

function printStats(label: string, s: TrainStats) {
    const fmt = (n: number) => (s.turns ? (n / s.turns).toFixed(2) : '0')
    log(`  ── ${label} ──`)
    log(`    goles: ${s.goals} (${s.turns ? (100 * s.goals / s.turns).toFixed(1) : 0}/100 turnos) | turnos: ${s.turns} | tackles: ${s.tackles} | errores de script: ${s.scriptErrors}`)
    log(`    acciones devueltas/turno: ${fmt(s.actionsReturned)} | ejecutadas/turno: ${fmt(s.actionsExecuted)} | AP desperdiciados/turno: ${fmt(s.wastedAP)}`)
    printTallyMap('MOVES inválidos por motivo', s.invalidMoves)
    printTallyMap('PASSES inválidos por motivo', s.invalidPasses)
    printTally('pases interceptados', s.passesIntercepted)
    printTally('offsides cometidos', s.offsides)
    printTally('GOL DIRECTO disponible y no chutado', s.missedDirectShots)
    printTally('gol en 2 AP disponible y no ejecutado', s.missedTwoApShots)
    printTally('tackle disponible e ignorado', s.missedTackles)
    printTally('balón suelto capturable y no disputado', s.missedLooseBalls)
    printTally('turno acabado con disparo directo rival a nuestro rey', s.kingLeftExposedDirect)
    printTally('turno acabado con mover+chutar rival a nuestro rey', s.kingLeftExposedOneMove)
}

function runPairing(idA: string, idB: string, games: number, maxTurns: number) {
    const scriptA = getAIScript(idA)
    const scriptB = getAIScript(idB)
    if (!scriptA || !scriptB) {
        console.error(`Script no registrado: ${!scriptA ? idA : idB}. Registrados: ${REGISTERED.join(', ')}`)
        process.exit(1)
    }

    const statsByScript: Record<string, TrainStats> = { [idA]: emptyStats(), [idB]: emptyStats() }
    let winsA = 0, winsB = 0, draws = 0

    for (let g = 0; g < games; g++) {
        const aPlaysWhite = g % 2 === 0
        const statsBySide: Record<Side, TrainStats> = {
            white: statsByScript[aPlaysWhite ? idA : idB],
            black: statsByScript[aPlaysWhite ? idB : idA],
        }
        const result = playMatch(aPlaysWhite ? scriptA : scriptB, aPlaysWhite ? scriptB : scriptA, statsBySide, maxTurns, g + 1)
        const scoreA = aPlaysWhite ? result.score.white : result.score.black
        const scoreB = aPlaysWhite ? result.score.black : result.score.white
        if (scoreA > scoreB) winsA++
        else if (scoreB > scoreA) winsB++
        else draws++
    }

    log(`\n══════ ${idA} vs ${idB} — ${games} partidas de ${maxTurns} turnos ══════`)
    log(`  resultado: ${idA} ${winsA}W / ${idB} ${winsB}W / ${draws} empates`)
    printStats(idA, statsByScript[idA])
    printStats(idB, statsByScript[idB])
}

// ─────────────────────────────────────────────────────────
// CLI
// ─────────────────────────────────────────────────────────

const rawArgs = process.argv.slice(2)
const mdIdx = rawArgs.indexOf('--md')
const mdFile = mdIdx >= 0 ? rawArgs[mdIdx + 1] : null
const args = mdIdx >= 0 ? [...rawArgs.slice(0, mdIdx), ...rawArgs.slice(mdIdx + 2)] : rawArgs

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
    console.log('Uso: npm run train -- <scriptIdA> <scriptIdB> [partidas] [maxTurnos] [--md informe.md]')
    console.log('     npm run train -- --all [partidas] [maxTurnos] [--md informe.md]')
    console.log(`Scripts registrados: ${REGISTERED.join(', ')}`)
    process.exit(1)
}

if (mdFile) {
    mkdirSync(dirname(mdFile), { recursive: true })
    writeFileSync(mdFile, `# Informe de entrenamiento IA — ${new Date().toISOString().slice(0, 10)}\n\n\`\`\`\n${out.join('\n')}\n\`\`\`\n`)
    console.log(`\nInforme guardado en ${mdFile}`)
}
