import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { CHAMPIONSHIP_ROSTER, LEGACY_BOT_ID_MAP, TIERS, makeTier } from '../src/bot-engine'
import { getInitialBoardState } from '../src/initial-board'

// ── Brand-purge guard ─────────────────────────────────────────────────────────
// The "AI players" concept and its commercial brand names were purged (FR-52).
// This guard keeps them from creeping back into the published source. The ONLY
// place brand strings may appear is the legacy-id migration map (its keys ARE the
// old ids by design), which lives after a marker comment at the end of bot-engine.ts.

const SRC = join(__dirname, '..', 'src')
const LEGACY_MARKER = 'Legacy id migration map'
const BRANDS = /chatgpt|gemini|claude/i
const AI_PLAYER_CONCEPT = /ai[-_ ]?players?\b/i

function srcFiles(dir: string): string[] {
    return readdirSync(dir).flatMap((name) => {
        const p = join(dir, name)
        return statSync(p).isDirectory() ? srcFiles(p) : [p]
    })
}

describe('brand purge guard (FR-52 / AD-6)', () => {
    it('no brand names in src/ outside the legacy migration map', () => {
        for (const file of srcFiles(SRC)) {
            let content = readFileSync(file, 'utf8')
            const marker = content.indexOf(LEGACY_MARKER)
            if (marker !== -1) content = content.slice(0, marker)
            expect(content, `brand name found in ${file}`).not.toMatch(BRANDS)
        }
    })

    it('no "AI player" concept in src/ outside the legacy migration map', () => {
        for (const file of srcFiles(SRC)) {
            let content = readFileSync(file, 'utf8')
            const marker = content.indexOf(LEGACY_MARKER)
            if (marker !== -1) content = content.slice(0, marker)
            expect(content, `"AI player" concept found in ${file}`).not.toMatch(AI_PLAYER_CONCEPT)
        }
    })

    it('roster identity fields carry no brands', () => {
        for (const bot of CHAMPIONSHIP_ROSTER) {
            for (const field of [bot.id, bot.name, bot.description, bot.badgeName, bot.badgeIcon]) {
                expect(field).not.toMatch(BRANDS)
                expect(field).not.toMatch(AI_PLAYER_CONCEPT)
            }
        }
    })
})

// ── Canonical identity contract (AD-6) ────────────────────────────────────────

const CANONICAL_IDS = ['striker-direct', 'midfield-possession', 'defender-positional', 'champion-boss']

describe('championship roster identity (AD-6)', () => {
    it('exposes the four canonical stable ids, in bracket order', () => {
        expect(CHAMPIONSHIP_ROSTER.map((b) => b.id)).toEqual(CANONICAL_IDS)
    })

    it('every bot exposes the full identity: id, name, description, avatar, difficulty, badge', () => {
        for (const bot of CHAMPIONSHIP_ROSTER) {
            expect(bot.id).toMatch(/^[a-z]+(-[a-z]+)*$/)
            expect(bot.name.length).toBeGreaterThan(0)
            expect(bot.description.length).toBeGreaterThan(0)
            expect(bot.avatar.length).toBeGreaterThan(0)
            expect(Object.keys(TIERS)).toContain(bot.difficulty)
            expect(bot.badgeName.length).toBeGreaterThan(0)
            expect(bot.badgeIcon.length).toBeGreaterThan(0)
            expect(typeof bot.play).toBe('function')
        }
    })

    it('roster ids are unique', () => {
        const ids = CHAMPIONSHIP_ROSTER.map((b) => b.id)
        expect(new Set(ids).size).toBe(ids.length)
    })
})

describe('legacy id migration map (AD-12)', () => {
    // Union of the old CHAMPIONSHIP_ROSTER ids and the removed legacy script
    // registry ids — every id that ever leaked into persisted app state.
    const LEGACY_IDS = [
        // old roster ids (also Supabase script_id seeds and SPA URL slugs)
        'chatgpt-tactico', 'gemini-tikitaka', 'claude-tactico', 'claude-fable',
        // removed hand-written registry script ids
        'claude-tactico', 'chatgpt-tactico', 'gemini-tikitaka', 'claude-fable', 'claude-opus',
    ]

    it('covers every legacy id that apps may have persisted', () => {
        for (const legacy of LEGACY_IDS) {
            expect(LEGACY_BOT_ID_MAP[legacy], `missing legacy id: ${legacy}`).toBeDefined()
        }
    })

    it('every mapping lands on a current canonical roster id', () => {
        for (const [legacy, target] of Object.entries(LEGACY_BOT_ID_MAP)) {
            expect(CANONICAL_IDS, `${legacy} maps to unknown id ${target}`).toContain(target)
        }
    })

    it('no legacy key survives as a canonical id', () => {
        for (const legacy of Object.keys(LEGACY_BOT_ID_MAP)) {
            expect(CANONICAL_IDS).not.toContain(legacy)
        }
    })
})

// ── Behavioural smoke ─────────────────────────────────────────────────────────

describe('bot engine smoke', () => {
    it('a tier bot produces a legal, non-empty action plan from kickoff', () => {
        const bot = makeTier('beginner', 0x1234)
        const board = getInitialBoardState('white')
        const actions = bot.play(board, 'white')
        expect(actions.length).toBeGreaterThan(0)
        for (const a of actions) expect(['move', 'pass', 'end_turn']).toContain(a.type)
    })
})
