// Re-exports the production AI engine for use by the self-play training scripts.
// The canonical implementation lives in src/ai-engine.ts.
export {
  createAI,
  createChampionAI,
  makeTier,
  TIERS,
  CHAMPIONSHIP_ROSTER,
  type AIConfig,
  type EvalBias,
  type TierName,
  type AIPersona,
  type ChampionAI,
} from '../../src/ai-engine'

// Backward-compat alias: self-play scripts historically used AIPlayer for this type.
export type { ChampionAI as AIPlayer } from '../../src/ai-engine'
