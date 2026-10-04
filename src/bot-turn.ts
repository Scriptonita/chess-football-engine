// Expansion of a bot's action plan into the board states of its turn.
//
// `BotScript.play` only returns intentions. Turning them into states — with the
// legality gate, the forced-turn-end cut and the closing end-turn — used to be
// re-implemented by every app, and the copies drifted. This is the single
// implementation: apps replay `states` and never apply bot actions themselves.

import { getValidMoves, getValidPasses, checkGoal } from './game-logic'
import { applyMove, applyPass, applyEndTurn } from './game-engine'
import type { BoardState, Position, Side } from './types/game'
import type { BotAction, BotScript } from './types/bot'

export interface BotTurn {
    /**
     * Board after each applied action, in order. Never empty: the last state always
     * has the turn handed over (or holds the goal that ends the turn).
     */
    states: BoardState[]
    /**
     * True when the last state is a bare end-of-turn (no piece or ball moved in it).
     * Replays can apply it without giving it a display step of its own.
     */
    closedByEndTurn: boolean
    /** Side that scored during this turn, or null. */
    goalScored: Side | null
}

const samePos = (a: Position, b: Position) => a.x === b.x && a.y === b.y

/**
 * Pure function: runs `bot` for one turn as `side` on `board` and returns every
 * resulting state.
 *
 * - `applyMove` / `applyPass` do not validate legality, so every action is gated by
 *   the same rules a human is bound to; illegal actions are dropped, not applied.
 * - Stops as soon as the turn changes hands (last action point, interception,
 *   forced king release) or a goal is scored.
 * - If the turn is still the bot's once the plan is exhausted, it is ended — so a
 *   bot that returns nothing, only illegal actions, or throws still yields the turn.
 */
export function playBotTurn(bot: Pick<BotScript, 'play'>, board: BoardState, side: Side): BotTurn {
    let actions: BotAction[]
    try {
        actions = bot.play(board, side)
    } catch {
        actions = []
    }

    const states: BoardState[] = []
    let state = board
    let goalScored: Side | null = null

    for (const action of actions) {
        if (action.type === 'end_turn') break

        const to = action.to
        if (!to) continue

        if (action.type === 'move') {
            const piece = state.pieces.find((p) => p.id === action.pieceId && p.side === side)
            if (!piece || piece.hasMovedThisTurn) continue
            if (!getValidMoves(piece, state).some((m) => samePos(m, to))) continue
            state = applyMove(state, piece.id, to).boardState
            states.push(state)
        } else {
            const holder = state.pieces.find((p) => p.id === state.ball.holderId && p.side === side)
            if (!holder || (action.pieceId && action.pieceId !== holder.id)) continue
            if (!getValidPasses(holder, state).some((m) => samePos(m, to))) continue
            const result = applyPass(state, to)
            state = result.boardState
            states.push(state)
            if (result.goalScored) {
                goalScored = checkGoal(state)
                break
            }
        }

        if (state.turn !== side) break
    }

    let closedByEndTurn = false
    if (!goalScored && state.turn === side) {
        state = applyEndTurn(state)
        states.push(state)
        closedByEndTurn = true
    }

    return { states, closedByEndTurn, goalScored }
}
