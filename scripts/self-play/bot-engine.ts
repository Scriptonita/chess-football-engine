// Re-exports the production bot engine for use by the self-play training scripts.
// The canonical implementation lives in src/bot-engine.ts.
export {
  createBot,
  createChampionBot,
  makeTier,
  TIERS,
  CHAMPIONSHIP_ROSTER,
  type BotConfig,
  type EvalBias,
  type TierName,
  type BotPersona,
  type ChampionBot,
} from '../../src/bot-engine'

