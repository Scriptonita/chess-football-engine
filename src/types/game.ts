export type Side = 'white' | 'black'

export type PieceType = 'king' | 'queen' | 'rook' | 'bishop' | 'knight'

export interface Position {
    x: number // 0-8 (A-I)
    y: number // 0-11 (1-12)
}

export interface Piece {
    id: string
    type: PieceType
    side: Side
    pos: Position
    hasMovedThisTurn: boolean
}

export interface Ball {
    pos: Position
    holderId: string | null // Piece ID
}

export type MoveHistoryType = 'move' | 'pass' | 'tackle' | 'goal' | 'interception' | 'offside'

export interface MoveHistoryEntry {
    type: MoveHistoryType
    pieceType: PieceType
    pieceSide: Side
    from?: Position
    to: Position
    at: number
    turnNumber: number
}

export interface BoardState {
    pieces: Piece[]
    ball: Ball
    score: {
        white: number
        black: number
    }
    actionPoints: number
    maxActionPoints?: number
    turn: Side
    lastMove?: {
        type: MoveHistoryType
        from?: Position
        to: Position
        playerId: string
        at: number
    }
    moveHistory: MoveHistoryEntry[]
    turnNumber: number
    kingMustRelease?: Side    // this side's king must release the ball this turn
    keeperBlockedId?: string  // this keeper cannot receive passes until an opponent touches the ball
}

export type GameStatus = 'pending' | 'active' | 'finished'

export interface Match {
    id: string
    name: string
    creator_id: string
    opponent_id: string
    status: GameStatus
    turn_player_id: string
    board_state: BoardState
    winner_id: string | null
    created_at: string
    updated_at: string
}
