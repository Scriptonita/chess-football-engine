import { describe, it, expect } from 'vitest'
import { getAIScript } from '../../src/ai-players/registry'

function expectValidScript(scriptId: string) {
    const script = getAIScript(scriptId)
    expect(script, `script "${scriptId}" should exist`).not.toBeNull()
    expect(typeof script!.name).toBe('string')
    expect(typeof script!.description).toBe('string')
    expect(typeof script!.avatar).toBe('string')
    expect(['beginner', 'intermediate', 'advanced', 'expert']).toContain(script!.difficulty)
    expect(typeof script!.badgeName).toBe('string')
    expect(typeof script!.badgeIcon).toBe('string')
    expect(typeof script!.play).toBe('function')
}

describe('getAIScript', () => {
    it.each(['claude-tactico', 'chatgpt-tactico', 'gemini-tikitaka'])(
        '"%s" has all required AIPlayerScript fields',
        (id) => { expectValidScript(id) }
    )

    it('claude-tactico has difficulty advanced', () => {
        expect(getAIScript('claude-tactico')!.difficulty).toBe('advanced')
    })

    it('chatgpt-tactico has difficulty advanced', () => {
        expect(getAIScript('chatgpt-tactico')!.difficulty).toBe('advanced')
    })

    it('gemini-tikitaka has difficulty advanced', () => {
        expect(getAIScript('gemini-tikitaka')!.difficulty).toBe('advanced')
    })

    it('returns null for an unknown script_id', () => {
        expect(getAIScript('does-not-exist')).toBeNull()
    })

    it('returns null for an empty string', () => {
        expect(getAIScript('')).toBeNull()
    })
})
