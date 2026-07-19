import { BoardState, Position, Side } from './game'

export interface BotAction {
    type: 'move' | 'pass' | 'end_turn'
    /** Required for 'move' and 'pass'. */
    pieceId?: string
    /** Required for 'move' and 'pass'. */
    to?: Position
}

export interface BotScript {
    name: string
    description: string
    /** Emoji or icon identifier. */
    avatar: string
    difficulty: 'beginner' | 'intermediate' | 'advanced' | 'expert' | 'legendary'
    /** Trophy name awarded to a player who defeats this bot. */
    badgeName: string
    /** Lucide icon name for the badge. */
    badgeIcon: string
    /**
     * Pure function called once per bot turn.
     * Receives the full board state and the side the bot plays.
     * Returns an ordered array of actions to execute (max 5, one per AP).
     */
    play: (boardState: BoardState, botSide: Side) => BotAction[]
}
