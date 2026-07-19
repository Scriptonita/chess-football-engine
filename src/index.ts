// Public API of @scriptonita/chess-football-engine
//
// Canonical CODE implementation of the Chess.Football rules.
// Rules source of truth (human-readable spec): https://github.com/Scriptonita/chess.football
//
// Pure, framework-agnostic: no DOM, no Node, no state-management library.

// Types
export * from './types/game'
export * from './types/bot'

// Rules / movement logic
export * from './game-logic'

// Game engine (state transitions)
export * from './game-engine'

// Canonical initial board (single source of truth for the kickoff position)
export * from './initial-board'

// Board notation
export * from './notation'

// Configurable bot engine: difficulty tiers, championship roster, factory
// functions, and the legacy-id migration map
export * from './bot-engine'
