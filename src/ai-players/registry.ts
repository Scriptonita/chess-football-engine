import { AIPlayerScript } from '../types/ai-player'
import { aiPlayer as claudeTactico } from './claude_sonnet-4.6_AI_player'
import { aiPlayer as chatgptTactico } from './chatGPT_AI_player'
import { aiPlayer as geminiTikitaka } from './gemini_3_AI_player'

/**
 * Maps script_id (stored in ai_players.script_id) to the AIPlayerScript module.
 * Add new scripts here as they are created.
 */
const registry: Record<string, AIPlayerScript> = {
    'claude-tactico':   claudeTactico,
    'chatgpt-tactico':  chatgptTactico,
    'gemini-tikitaka':  geminiTikitaka,
}

export function getAIScript(scriptId: string): AIPlayerScript | null {
    return registry[scriptId] ?? null
}
