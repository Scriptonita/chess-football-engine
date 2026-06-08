import type { PieceType, Position } from './types/game'

const FILES = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I'] as const

/** Translate an internal Position into chess-style algebraic notation (e.g. {x:3,y:4} → "D5"). */
export function squareName(pos: Position): string {
    const file = FILES[pos.x] ?? '?'
    const rank = pos.y + 1
    return `${file}${rank}`
}

export const FILE_LABELS: readonly string[] = FILES
export const RANK_LABELS: readonly number[] = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]

export type PieceShortKey =
    | 'kingShort' | 'queenShort' | 'rookShort' | 'bishopShort' | 'knightShort'
export type PieceLongKey = 'king' | 'queen' | 'rook' | 'bishop' | 'knight'

export const SHORT_KEY: Record<PieceType, PieceShortKey> = {
    king:   'kingShort',
    queen:  'queenShort',
    rook:   'rookShort',
    bishop: 'bishopShort',
    knight: 'knightShort',
}

export const LONG_KEY: Record<PieceType, PieceLongKey> = {
    king:   'king',
    queen:  'queen',
    rook:   'rook',
    bishop: 'bishop',
    knight: 'knight',
}
