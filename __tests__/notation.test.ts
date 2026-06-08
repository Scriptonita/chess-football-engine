/**
 * Tests for lib/notation.ts
 * Covers squareName, FILE_LABELS, RANK_LABELS, SHORT_KEY, LONG_KEY.
 */
import { describe, it, expect } from 'vitest'
import { squareName, FILE_LABELS, RANK_LABELS, SHORT_KEY, LONG_KEY } from '../src/notation'

// ─────────────────────────────────────────────────────────
// squareName — position to algebraic notation
// ─────────────────────────────────────────────────────────
describe('squareName', () => {
    it('converts (0,0) → "A1"', () => {
        expect(squareName({ x: 0, y: 0 })).toBe('A1')
    })

    it('converts (8,11) → "I12"', () => {
        expect(squareName({ x: 8, y: 11 })).toBe('I12')
    })

    it('converts (4,0) → "E1" (white king start)', () => {
        expect(squareName({ x: 4, y: 0 })).toBe('E1')
    })

    it('converts (4,11) → "E12" (black king start)', () => {
        expect(squareName({ x: 4, y: 11 })).toBe('E12')
    })

    it('converts (3,4) → "D5"', () => {
        expect(squareName({ x: 3, y: 4 })).toBe('D5')
    })

    it('converts (0,11) → "A12"', () => {
        expect(squareName({ x: 0, y: 11 })).toBe('A12')
    })

    it('converts (8,0) → "I1"', () => {
        expect(squareName({ x: 8, y: 0 })).toBe('I1')
    })

    it('converts (2,9) → "C10"', () => {
        expect(squareName({ x: 2, y: 9 })).toBe('C10')
    })

    it('returns "?" for out-of-range x', () => {
        expect(squareName({ x: 9, y: 0 })).toBe('?1')
    })

    it('all 9 columns map to A through I', () => {
        const expected = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I']
        for (let x = 0; x < 9; x++) {
            expect(squareName({ x, y: 0 })).toBe(`${expected[x]}1`)
        }
    })

    it('all 12 rows map to ranks 1 through 12', () => {
        for (let y = 0; y < 12; y++) {
            expect(squareName({ x: 0, y })).toBe(`A${y + 1}`)
        }
    })
})

// ─────────────────────────────────────────────────────────
// FILE_LABELS and RANK_LABELS
// ─────────────────────────────────────────────────────────
describe('FILE_LABELS', () => {
    it('has 9 entries (A–I)', () => {
        expect(FILE_LABELS).toHaveLength(9)
    })

    it('starts with A and ends with I', () => {
        expect(FILE_LABELS[0]).toBe('A')
        expect(FILE_LABELS[8]).toBe('I')
    })

    it('contains all expected letters in order', () => {
        expect([...FILE_LABELS]).toEqual(['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I'])
    })
})

describe('RANK_LABELS', () => {
    it('has 12 entries (1–12)', () => {
        expect(RANK_LABELS).toHaveLength(12)
    })

    it('starts at 1 and ends at 12', () => {
        expect(RANK_LABELS[0]).toBe(1)
        expect(RANK_LABELS[11]).toBe(12)
    })

    it('contains consecutive integers 1 through 12', () => {
        expect([...RANK_LABELS]).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12])
    })
})

// ─────────────────────────────────────────────────────────
// SHORT_KEY and LONG_KEY mappings
// ─────────────────────────────────────────────────────────
describe('SHORT_KEY', () => {
    it('king maps to kingShort', () => {
        expect(SHORT_KEY.king).toBe('kingShort')
    })

    it('queen maps to queenShort', () => {
        expect(SHORT_KEY.queen).toBe('queenShort')
    })

    it('rook maps to rookShort', () => {
        expect(SHORT_KEY.rook).toBe('rookShort')
    })

    it('bishop maps to bishopShort', () => {
        expect(SHORT_KEY.bishop).toBe('bishopShort')
    })

    it('knight maps to knightShort', () => {
        expect(SHORT_KEY.knight).toBe('knightShort')
    })
})

describe('LONG_KEY', () => {
    it('king maps to king', () => {
        expect(LONG_KEY.king).toBe('king')
    })

    it('queen maps to queen', () => {
        expect(LONG_KEY.queen).toBe('queen')
    })

    it('rook maps to rook', () => {
        expect(LONG_KEY.rook).toBe('rook')
    })

    it('bishop maps to bishop', () => {
        expect(LONG_KEY.bishop).toBe('bishop')
    })

    it('knight maps to knight', () => {
        expect(LONG_KEY.knight).toBe('knight')
    })
})
