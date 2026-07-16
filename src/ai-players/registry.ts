import { AIPlayerScript } from '../types/ai-player'
import { aiPlayer as claudeTactico } from './claude_sonnet-4.6_AI_player'
import { aiPlayer as chatgptTactico } from './chatGPT_AI_player'
import { aiPlayer as geminiTikitaka } from './gemini_3_AI_player'
import { aiPlayer as claudeFable } from './claude_fable_AI_player'
import { aiPlayer as claudeOpus } from './claude_opus_AI_player'
import { makeTier, createAI, TIERS } from '../ai-engine'

/**
 * Maps script_id (stored in ai_players.script_id) to the AIPlayerScript module.
 * Add new scripts here as they are created.
 */
const registry: Record<string, AIPlayerScript> = {
    'claude-tactico':        claudeTactico,
    'chatgpt-tactico':       chatgptTactico,
    'gemini-tikitaka':       geminiTikitaka,
    'claude-fable':          claudeFable,
    'claude-opus':           claudeOpus,

    // Production ai-engine.ts tiers, registered for benchmarking via
    // scripts/simulate.ts and scripts/train.ts (fixed seeds → reproducible runs).
    'engine-beginner':       makeTier('beginner', 0x1234),
    'engine-intermediate':   makeTier('intermediate', 0x1234),
    'engine-advanced':       makeTier('advanced', 0x1234),
    'engine-expert':         makeTier('expert', 0x1234),
    'engine-legendary':      makeTier('legendary', 0x1234),

    // Championship strength backbone (mirrors CHAMPIONSHIP_ROSTER's tiers so the ladder
    // can be regression-benchmarked). Validated tier-vs-tier — vs-Fable saturates above
    // the floor. R16 = the floor (≈ the hand-written Fable script); QF = "expert+" (still
    // lookahead 1, wider beam + sharper temp); SF = boss-grade lookahead 2 with a narrower
    // veto than the final boss; final = the strongest tune.
    // R16 carries NO eval bias: post-dedupe the beam follows the eval faithfully, and
    // even a mild aggressive bias (shooting +15) measurably degrades the tuned weights
    // (50% → 21–31% vs Fable). Pure expert IS the floor.
    'engine-champ-r16':      createAI('engine-champ-r16', 'Champ R16',
        { ...TIERS.expert }, {}, 0x1234),
    'engine-champ-qf':       createAI('engine-champ-qf', 'Champ QF',
        { ...TIERS.expert, beamWidth: 12, temperature: 5, lookaheadWidth: 6 }, {}, 0x1234),
    'engine-champ-sf':       createAI('engine-champ-sf', 'Champ SF',
        { ...TIERS.legendary, beamWidth: 12, temperature: 5, lookaheadWidth: 2 }, {}, 0x1234),
    // Final boss = plain legendary. Post-dedupe, softmax spreads over DISTINCT plans,
    // so the old temperature-5 "sharpening" now weakens it (measured: it LOST 4-6 to
    // the SF tune); legendary's default temp 2 still varies via the board-seeded RNG.
    'engine-champ-final':    createAI('engine-champ-final', 'Champ Final',
        { ...TIERS.legendary }, {}, 0x1234),
}

export function getAIScript(scriptId: string): AIPlayerScript | null {
    return registry[scriptId] ?? null
}
