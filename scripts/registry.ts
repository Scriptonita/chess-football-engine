// Dev-only benchmarking registry — NOT part of the published package (`files: ["dist"]`).
//
// Reproduces each difficulty tier and each championship rung as a fixed-seed entry so
// ladder/tournament/bench/train runs stay regression-comparable across engine changes.
// Calibration is tier-vs-tier (`engine-*` vs `engine-*`); the legacy hand-written
// baseline scripts were removed in the bot-identity purge.
import { createBot, makeTier, TIERS } from '../src/bot-engine'
import type { BotScript } from '../src/types/bot'

const registry: Record<string, BotScript> = {
    // Difficulty tiers (fixed seeds → reproducible runs)
    'engine-beginner':       makeTier('beginner', 0x1234),
    'engine-intermediate':   makeTier('intermediate', 0x1234),
    'engine-advanced':       makeTier('advanced', 0x1234),
    'engine-expert':         makeTier('expert', 0x1234),
    'engine-legendary':      makeTier('legendary', 0x1234),

    // Championship strength backbone (mirrors CHAMPIONSHIP_ROSTER's tiers so the ladder
    // can be regression-benchmarked). R16 = the floor (pure expert, NO eval bias: even a
    // mild aggressive bias measurably degrades the tuned weights); QF = "expert+" (still
    // lookahead 1, wider beam + sharper temp); SF = boss-grade lookahead 2 with a
    // narrower veto than the final boss; final = the strongest tune.
    'engine-champ-r16':      createBot('engine-champ-r16', 'Champ R16',
        { ...TIERS.expert }, {}, 0x1234),
    'engine-champ-qf':       createBot('engine-champ-qf', 'Champ QF',
        { ...TIERS.expert, beamWidth: 12, temperature: 5, lookaheadWidth: 6 }, {}, 0x1234),
    'engine-champ-sf':       createBot('engine-champ-sf', 'Champ SF',
        { ...TIERS.legendary, beamWidth: 12, temperature: 5, lookaheadWidth: 2 }, {}, 0x1234),
    // Final boss = plain legendary. Post-dedupe, softmax spreads over DISTINCT plans,
    // so a temperature-5 "sharpening" weakens it (measured: it LOST 4-6 to the SF
    // tune); legendary's default temp 2 still varies via the board-seeded RNG.
    'engine-champ-final':    createBot('engine-champ-final', 'Champ Final',
        { ...TIERS.legendary }, {}, 0x1234),
}

export const REGISTERED_IDS = Object.keys(registry)

export function getScript(id: string): BotScript | null {
    return registry[id] ?? null
}
