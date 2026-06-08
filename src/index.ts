// Public API of @scriptonita/chess-football-engine
//
// Canonical CODE implementation of the Chess.Football rules.
// Rules source of truth (human-readable spec): https://github.com/Scriptonita/chess.football
//
// Pure, framework-agnostic: no DOM, no Node, no state-management library.

// Types
export * from './types/game'
export * from './types/ai-player'

// Rules / movement logic
export * from './game-logic'

// Game engine (state transitions)
export * from './game-engine'

// Board notation
export * from './notation'

// AI opponents (pure deterministic scripts) + registry
export * from './ai-players/registry'
