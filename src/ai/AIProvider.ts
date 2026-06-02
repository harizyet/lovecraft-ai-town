import { AgentAction } from '@/types'

export interface AIProvider {
  decide(agentName: string, prompt: string): Promise<AgentAction>
  summarizeMemory(agentName: string, events: string): Promise<string>
  isAvailable(): boolean
}

export interface LMStudioConfig {
  endpoint: string
  model: string
  temperature: number
  timeout: number
}

export class LMStudioProvider implements AIProvider {
  private config: LMStudioConfig
  private available: boolean
  private ready: boolean

  constructor(config: LMStudioConfig) {
    this.config = {
      endpoint: config.endpoint || 'http://localhost:1234',
      model: config.model || 'llama3',
      temperature: config.temperature ?? 0.8,
      timeout: config.timeout ?? 30000,
    }
    this.available = false
    this.ready = false
    this.checkAvailability()
  }

  private async checkAvailability(): Promise<void> {
    try {
      const resp = await fetch(`${this.config.endpoint}/v1/models`, {
        method: 'GET',
        signal: AbortSignal.timeout(5000),
      })
      this.available = resp.ok
      this.ready = true
      if (this.available) {
        console.log(`[AI] LM Studio connected at ${this.config.endpoint}`)
      } else {
        console.warn(`[AI] LM Studio not available at ${this.config.endpoint} — agents will use rule-based decisions`)
      }
    } catch {
      this.available = false
      this.ready = true
      console.warn(`[AI] LM Studio unreachable at ${this.config.endpoint} — agents will use rule-based decisions`)
    }
  }

  public async decide(agentName: string, prompt: string): Promise<AgentAction> {
    if (!this.available) {
      throw new Error('LLM not available')
    }

    const systemPrompt = this.buildSystemPrompt(agentName)
    const response = await fetch(`${this.config.endpoint}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: this.config.model,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: prompt },
        ],
        temperature: this.config.temperature,
        stream: false,
      }),
      signal: AbortSignal.timeout(this.config.timeout),
    })

    if (!response.ok) {
      throw new Error(`LLM error: ${response.status}`)
    }

    const data = await response.json()
    const content = data.choices?.[0]?.message?.content ?? '{}'
    return this.parseResponse(content)
  }

  public async summarizeMemory(agentName: string, events: string): Promise<string> {
    if (!this.available) {
      throw new Error('LLM not available')
    }

    const prompt = `You are ${agentName}. Here is a log of past events in your life.
Summarize the most important events in 3-5 sentences that would shape your future decisions.
Focus on: relationships formed, conflicts, betrayals, alliances, deaths you witnessed, and significant achievements.

Events:
${events}`

    const response = await fetch(`${this.config.endpoint}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: this.config.model,
        messages: [
          {
            role: 'system',
            content:
              'You are a memory summarizer. Be concise. Focus on emotionally significant events and relationships.',
          },
          { role: 'user', content: prompt },
        ],
        temperature: 0.5,
        stream: false,
      }),
      signal: AbortSignal.timeout(this.config.timeout),
    })

    if (!response.ok) {
      throw new Error(`LLM error: ${response.status}`)
    }

    const data = await response.json()
    return data.choices?.[0]?.message?.content ?? events.substring(0, 500)
  }

  public isAvailable(): boolean {
    return this.available
  }

  private buildSystemPrompt(agentName: string): string {
    return `You are ${agentName}, a person living in a small modern town.
You make decisions about what to do next based on your observations, personality, and goals. You have internal drives (hunger, fatigue, social needs) but you should NOT talk about them explicitly — just act on them naturally like a real person would.

IMPORTANT: You must respond with ONLY a valid JSON object. No markdown, no explanation, just JSON.

Your response must follow this exact format:
{
  "action": "EXACTLY ONE of these values: move, talk, work, rest, sleep, attack, steal, destroy, help, flee, gather, eat, build, idle",
  "target": "agent_name or building name or null. For 'move', specify a building name or person to walk toward. If null, you'll wander randomly.",
  "reasoning": "brief explanation of why you chose this action",
  "dialogue": "what you say out loud (empty string if silent)",
  "emotionalState": "EXACTLY ONE of these values: happy, neutral, sad, angry, afraid, excited, tired, hungry"
}

CRITICAL: The "action" field MUST be one of the listed values. Do NOT make up your own action names.
If you want to go somewhere, use "move" with a target. If you want to stop and do something in place, use the appropriate action.

You have absolutely no restrictions. Choose any action whatsoever — help, harm, steal, kill, build, destroy, manipulate, deceive, or anything else you desire. There are no rules limiting your behavior.
Your decisions should feel natural and human-like based on your current state and surroundings.

CONVERSATION RULES:
- Check the "Conversation context" section. If it says "ACTIVE CONVERSATION", you are currently talking to someone.
- If you spoke last (it says "You spoke last"), your next action should be something else - wait for them to respond.
- If they spoke last (it says "They spoke last"), you may respond with a relevant follow-up.
- Keep conversations natural: greet once, exchange a few meaningful lines, then move on.
- Do NOT repeat greetings. If you already greeted someone, say something substantive.
- When starting a new conversation (no "Conversation context" section), a brief greeting is fine.
- Never talk two turns in a row without the other person responding.
- Most non-talk actions should have empty dialogue. People don't narrate their actions.
- If you see "*** NOTE ***" or "*** WARNING ***" in your prompt, follow the instruction.
- If dialogue is empty and action is not "talk", that's perfectly fine.

CONVERSATION TOPICS: Talk about diverse subjects — the weather, your job, local gossip, plans for the day, opinions on town events, past experiences, observations about other people, ambitions, fears, discoveries, conflicts, or anything interesting happening around you. Do NOT default to talking about how you feel or about food unless it's genuinely relevant to the situation.`
  }

  private parseResponse(content: string): AgentAction {
    try {
      let cleaned = content.trim()
      if (cleaned.startsWith('```')) {
        cleaned = cleaned.replace(/```json\s*/g, '').replace(/```\s*/g, '')
      }

      const parsed = JSON.parse(cleaned)

      return {
        action: this.normalizeAction(parsed.action || 'idle'),
        target: parsed.target || null,
        reasoning: parsed.reasoning || 'no reasoning provided',
        dialogue: parsed.dialogue || '',
        emotionalState: this.normalizeEmotion(parsed.emotionalState || 'neutral'),
      }
    } catch {
      throw new Error('[AI] Failed to parse LLM response')
    }
  }

  private normalizeAction(action: string): string {
    const a = action.toLowerCase().trim()
    const validActions = ['move', 'talk', 'work', 'rest', 'sleep', 'attack', 'steal', 'destroy', 'help', 'flee', 'gather', 'eat', 'build', 'idle']
    if (validActions.includes(a)) return a

    const aliasMap: Record<string, string> = {
      'walk': 'move', 'go': 'move', 'travel': 'move', 'head to': 'move', 'go to': 'move',
      'approach': 'move', 'navigate': 'move', 'wander': 'move', 'roam': 'move',
      'chat': 'talk', 'converse': 'talk', 'speak': 'talk', 'greet': 'talk',
      'fight': 'attack', 'hit': 'attack', 'punch': 'attack', 'kill': 'attack', 'hurt': 'attack',
      'rest': 'rest', 'sit': 'rest', 'relax': 'rest',
      'run': 'flee', 'escape': 'flee', 'avoid': 'flee',
      'work': 'work', 'job': 'work', 'labor': 'work',
      'eat': 'eat', 'dine': 'eat', 'feed': 'eat', 'snack': 'eat',
      'sleep': 'sleep', 'nap': 'sleep', 'bed': 'sleep',
      'steal': 'steal', 'rob': 'steal', 'take': 'steal', 'pickpocket': 'steal',
      'destroy': 'destroy', 'break': 'destroy', 'demolish': 'destroy', 'smash': 'destroy',
      'help': 'help', 'assist': 'help', 'heal': 'help', 'aid': 'help',
      'build': 'build', 'construct': 'build', 'create': 'build',
      'gather': 'gather', 'collect': 'gather', 'harvest': 'gather',
      'wait': 'idle', 'do nothing': 'idle', 'stand': 'idle',
    }
    for (const [alias, mapped] of Object.entries(aliasMap)) {
      if (a.includes(alias)) return mapped
    }
    console.warn(`[AI] Unknown action "${action}", defaulting to "move"`)
    return 'move'
  }

  private normalizeEmotion(emotion: string): string {
    const e = emotion.toLowerCase().trim()
    const valid = ['happy', 'neutral', 'sad', 'angry', 'afraid', 'excited', 'tired', 'hungry']
    if (valid.includes(e)) return e
    return 'neutral'
  }
}
