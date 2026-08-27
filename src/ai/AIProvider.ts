import { AgentAction, CourtVote, ExistentialReaction, ForbiddenKnowledgeCategory, PolicyVote, ScheduleBlock } from '@/types'

export interface LLMQueryStats {
  made: number
  successful: number
}

export interface PropheticInterpretation {
  response: string
  emotionalState: string
  derivedClaims: string[]
  tasks: PropheticTask[]
}

export interface PropheticTask {
  kind: 'sacrifice' | 'warn' | 'protect' | 'convert' | 'investigate' | 'gather' | 'form_cult' | 'summon'
  target: string | null
  reasoning: string
  cultName?: string
}

export interface ConversationTurn {
  speaker: string
  dialogue: string
}

export interface ForbiddenKnowledgeClassification {
  forbidden: boolean
  severity: number
  category: ForbiddenKnowledgeCategory
  reasoning: string
}

export interface ExistentialReactionResult {
  comprehended: boolean
  reaction: ExistentialReaction
  response: string
  emotionalState: string
  reinterpretationFrame?: string
}

export interface AIProvider {
  decide(agentName: string, prompt: string): Promise<AgentAction>
  planDay(agentName: string, prompt: string): Promise<ScheduleBlock[]>
  generateConversation(agentAName: string, agentBName: string, prompt: string): Promise<ConversationTurn[]>
  voteOnCourt(agentName: string, prompt: string): Promise<Omit<CourtVote, 'agentId'>>
  defendAtCourt(agentName: string, prompt: string): Promise<string>
  respondToDeity(agentName: string, prompt: string): Promise<string>
  voteOnPolicy(agentName: string, prompt: string): Promise<Omit<PolicyVote, 'agentId'>>
  generatePoliticalEventText(prompt: string): Promise<{ question: string; description: string }>
  commentOnCourtOutcome(agentName: string, prompt: string): Promise<string>
  interpretDivineRevelation(agentName: string, prompt: string): Promise<PropheticInterpretation>
  generateDailyPropheticClaim(agentName: string, prompt: string): Promise<string>
  classifyForbiddenKnowledge(text: string): Promise<ForbiddenKnowledgeClassification>
  interpretExistentialReaction(agentName: string, prompt: string): Promise<ExistentialReactionResult>
  generateCultName(claimText: string, revelationText: string): Promise<string>
  narrateKeyMoment(prompt: string): Promise<string>
  getLastTransaction(agentName: string): { query: string; response: string } | undefined
  isAvailable(): boolean
  getQueryStats(): LLMQueryStats
}

export interface LMStudioConfig {
  endpoint: string
  model: string
  // Split rather than a single temperature: structured decision output
  // (actions, schedules, votes) needs to stay syntactically parseable, so it
  // runs conservative; free-form dialogue and narration benefit from more
  // variation and run closer to the model's own published default. Sampling
  // parameters shape variation, not syntax enforcement, so this reduces
  // parse failures as a mitigation rather than a guarantee.
  decisionTemperature: number
  dialogueTemperature: number
  timeout: number
}

export class LMStudioProvider implements AIProvider {
  private static readonly AVAILABILITY_RECHECK_MS = 5000
  private config: LMStudioConfig
  private available: boolean
  private ready: boolean
  private availabilityCheckInFlight: boolean
  private lastAvailabilityCheck: number
  private queryStats: LLMQueryStats
  private consecutiveFailures: number = 0

  private lastTransactions: Map<string, { query: string; response: string }> = new Map()

  public getLastTransaction(agentName: string): { query: string; response: string } | undefined {
    return this.lastTransactions.get(agentName)
  }

  constructor(config: LMStudioConfig) {
    this.config = {
      endpoint: config.endpoint || 'http://localhost:1234',
      model: config.model || 'llama3',
      decisionTemperature: config.decisionTemperature ?? 0.3,
      dialogueTemperature: config.dialogueTemperature ?? 0.8,
      timeout: config.timeout ?? 30000,
    }
    this.available = false
    this.ready = false
    this.availabilityCheckInFlight = false
    this.lastAvailabilityCheck = 0
    this.queryStats = { made: 0, successful: 0 }
    void this.checkAvailability()
  }

  private async fetchWithTracking(
    input: RequestInfo | URL,
    init?: RequestInit
  ): Promise<Response> {
    try {
      const response = await fetch(input, init)
      if (!response.ok) {
        this.handleFailure()
      } else {
        this.resetConsecutiveFailures()
        if (init?.body) {
          try {
            const bodyObj = JSON.parse(init.body as string)
            const messages = bodyObj.messages || []
            const systemMessage = messages.find((m: any) => m.role === 'system')?.content || ''
            
            const agentNames: string[] = []
            const singleMatch = systemMessage.match(/^You are ([^,\.]+)/)
            if (singleMatch) {
              agentNames.push(singleMatch[1].trim())
            } else {
              const pairMatch = systemMessage.match(/between two villagers in a small medieval village, (.*?) and (.*?)\. Return/)
              if (pairMatch) {
                agentNames.push(pairMatch[1].trim(), pairMatch[2].trim())
              }
            }

            if (agentNames.length > 0) {
              const responseClone = response.clone()
              responseClone.json().then((data) => {
                const content = data.choices?.[0]?.message?.content ?? ''
                const query = messages.map((m: any) => `${m.role.toUpperCase()}: ${m.content}`).join('\n\n')
                for (const name of agentNames) {
                  this.lastTransactions.set(name, { query, response: content })
                }
              }).catch((err) => {
                console.error('[AIProvider] Error reading response clone for tracking:', err)
              })
            }
          } catch (e) {
            console.error('[AIProvider] Error tracking transaction:', e)
          }
        }
      }
      return response
    } catch (error) {
      this.handleFailure()
      throw error
    }
  }

  private handleFailure(): void {
    this.consecutiveFailures++
    if (this.consecutiveFailures >= 3) {
      window.dispatchEvent(
        new CustomEvent('llm-consecutive-failures', {
          detail: {
            endpoint: this.config.endpoint,
            model: this.config.model,
            consecutiveFailures: this.consecutiveFailures,
          },
        })
      )
    }
  }

  private resetConsecutiveFailures(): void {
    this.consecutiveFailures = 0
  }

  private async checkAvailability(): Promise<void> {
    if (this.availabilityCheckInFlight) return
    this.availabilityCheckInFlight = true
    this.lastAvailabilityCheck = Date.now()
    try {
      const resp = await this.fetchWithTracking(`${this.config.endpoint}/v1/models`, {
        method: 'GET',
        signal: AbortSignal.timeout(5000),
      })
      this.available = resp.ok
      this.ready = true
      if (this.available) {
        console.log(`[AI] LM Studio connected at ${this.config.endpoint}`)
      } else {
        console.warn(`[AI] LM Studio not available at ${this.config.endpoint}`)
      }
    } catch {
      this.available = false
      this.ready = true
      console.warn(`[AI] LM Studio unreachable at ${this.config.endpoint}`)
    } finally {
      this.availabilityCheckInFlight = false
    }
  }

  public async decide(agentName: string, prompt: string): Promise<AgentAction> {
    if (!this.available) {
      throw new Error('LLM not available')
    }

    const systemPrompt = this.buildSystemPrompt(agentName)
    this.queryStats.made++
    const response = await this.fetchWithTracking(`${this.config.endpoint}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: this.config.model,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: prompt },
        ],
        temperature: this.config.decisionTemperature,
        stream: false,
      }),
      signal: AbortSignal.timeout(this.config.timeout),
    })

    if (!response.ok) {
      throw new Error(`LLM error: ${response.status}`)
    }

    const data = await response.json()
    const content = data.choices?.[0]?.message?.content ?? '{}'
    const decision = this.parseResponse(content)
    this.queryStats.successful++
    return decision
  }

  public async planDay(agentName: string, prompt: string): Promise<ScheduleBlock[]> {
    if (!this.available) {
      throw new Error('LLM not available')
    }

    this.queryStats.made++
    const response = await this.fetchWithTracking(`${this.config.endpoint}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: this.config.model,
        messages: [
          { role: 'system', content: this.buildScheduleSystemPrompt(agentName) },
          { role: 'user', content: prompt },
        ],
        temperature: this.config.decisionTemperature,
        stream: false,
      }),
      signal: AbortSignal.timeout(this.config.timeout),
    })

    if (!response.ok) {
      throw new Error(`LLM error: ${response.status}`)
    }

    const data = await response.json()
    const content = data.choices?.[0]?.message?.content ?? '{}'
    const schedule = this.parseScheduleResponse(content)
    this.queryStats.successful++
    return schedule
  }

  public async generateConversation(
    agentAName: string,
    agentBName: string,
    prompt: string
  ): Promise<ConversationTurn[]> {
    if (!this.available) throw new Error('LLM not available')

    this.queryStats.made++
    const response = await this.fetchWithTracking(`${this.config.endpoint}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: this.config.model,
        messages: [
          {
            role: 'system',
            content: `You are writing the rest of a live spoken conversation between two villagers in a small medieval village, ${agentAName} and ${agentBName}. Return ONLY valid JSON: {"turns":[{"speaker":"exact name","dialogue":"..."},...]}, alternating strictly between the two speakers as instructed in the prompt.

CONVERSATION RULES:
- Write dialogue like plain spoken medieval speech: 1-2 short sentences, no formal speeches, and no modern slang, technology, or institutions.
- Dialogue must contain only words the person says aloud. Never narrate movement or refer to a speaker in the third person.
- Each turn should react to the meaning of the previous line, not merely its general topic.
- Do not ask a question every turn. Sometimes make an observation, give an opinion, share a plan, or simply acknowledge the point.
- Never repeat a sentence, question, or idea already used earlier in the conversation.
- Avoid stock lines such as "tell me more," "what have you been working on," or "I've been focused on my work" unless truly warranted.
- As the conversation nears its end, close naturally instead of introducing a new question.
- Do not sound like a therapist, interviewer, narrator, or assistant. Never mention prompts, scores, simulation rules, or being an AI.`,
          },
          { role: 'user', content: prompt },
        ],
        temperature: this.config.dialogueTemperature,
        stream: false,
      }),
      signal: AbortSignal.timeout(this.config.timeout),
    })
    if (!response.ok) throw new Error(`LLM error: ${response.status}`)

    const data = await response.json()
    const content = String(data.choices?.[0]?.message?.content ?? '{}')
    const parsed = this.parseJSONObject(content)
    const rawTurns = Array.isArray(parsed.turns) ? parsed.turns : []
    const turns: ConversationTurn[] = rawTurns
      .map((turn: any) => ({
        speaker: String(turn?.speaker ?? '').trim(),
        dialogue: String(turn?.dialogue ?? '').trim().slice(0, 300),
      }))
      .filter((turn: ConversationTurn) => Boolean(turn.dialogue))
    this.queryStats.successful++
    return turns
  }

  public async interpretDivineRevelation(
    agentName: string,
    prompt: string
  ): Promise<PropheticInterpretation> {
    if (!this.available) throw new Error('LLM not available')
    this.queryStats.made++
    const response = await this.fetchWithTracking(`${this.config.endpoint}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: this.config.model,
        messages: [
          {
            role: 'system',
            content: `You are ${agentName}, newly appointed as a prophet after receiving a divine revelation. Return ONLY JSON: {"response":"your private interpretation and intended response","emotionalState":"happy|neutral|sad|angry|afraid|excited|panicked|grieving|ambivalent|determined","derivedClaims":["one to three distinct claims you now believe or suspect because of the revelation"],"tasks":[{"kind":"sacrifice|warn|protect|convert|investigate|gather|form_cult|summon","target":"exact known villager or building name, or null","reasoning":"how this fulfils the command","cultName":"required only for form_cult"}]}. Base claims and tasks strictly on the revelation and supplied knowledge. Do not repeat the revelation verbatim. You may form and name a cult when the revelation, your ambition, or desire to organize followers supports it; place form_cult before convert tasks. A summon task is allowed only when the revelation explicitly commands summoning or a summoning ritual, and its target MUST be one exact known building used as the ritual location. Include sacrifice only when the revelation itself explicitly demands sacrifice, death, or killing; never invent a victim or lethal command for a cult-formation-only revelation. If the revelation explicitly demands a sacrifice, death, or killing, you MUST include a sacrifice task and select exactly one living villager other than yourself. If it explicitly commands summoning, you MUST include a summon task.`,
          },
          { role: 'user', content: prompt },
        ],
        temperature: this.config.decisionTemperature,
        stream: false,
      }),
      signal: AbortSignal.timeout(this.config.timeout),
    })
    if (!response.ok) throw new Error(`LLM error: ${response.status}`)
    const data = await response.json()
    let content = String(data.choices?.[0]?.message?.content ?? '{}').trim()
    if (content.startsWith('```')) content = content.replace(/```json\s*/g, '').replace(/```\s*/g, '')
    const parsed = this.parseJSONObject(content)
    const responseText = String(parsed.response ?? '').trim().slice(0, 700)
    const derivedClaims = (Array.isArray(parsed.derivedClaims) ? parsed.derivedClaims : [])
      .map((claim: unknown) => {
        if (typeof claim === 'string') return claim
        if (!claim || typeof claim !== 'object') return ''
        const structured = claim as Record<string, unknown>
        const value = structured.claim ?? structured.text ?? structured.rumour ?? structured.rumor ??
          structured.statement ?? structured.description ?? structured.content ?? structured.belief
        return typeof value === 'string' ? value : ''
      })
      .map((claim: string) => claim.trim().slice(0, 500))
      .filter((claim: string) => Boolean(claim) && claim !== '[object Object]')
      .slice(0, 3)
    const validKinds = new Set(['sacrifice', 'warn', 'protect', 'convert', 'investigate', 'gather', 'form_cult', 'summon'])
    const tasks: PropheticTask[] = (Array.isArray(parsed.tasks) ? parsed.tasks : [])
      .filter((task: any) => validKinds.has(task?.kind))
      .map((task: any) => ({
        kind: task.kind,
        target: task.target ? String(task.target).trim().slice(0, 100) : null,
        reasoning: String(task.reasoning ?? 'Fulfilling the revelation').trim().slice(0, 500),
        cultName: task.cultName ? String(task.cultName).trim().slice(0, 80) : undefined,
      }))
      .slice(0, 3)
    const revelationText = prompt.match(/DIVINE REVELATION[^\n]*:\s*\n"([\s\S]*?)"/)?.[1] ?? prompt
    const demandsSacrifice = /\b(?:sacrifice|must die|must be killed|kill someone|choose someone to die)\b/i.test(revelationText)
    const demandsSummon = /\b(?:summon|summoning ritual)\b/i.test(revelationText)
    if (!responseText || derivedClaims.length === 0 || tasks.length === 0 ||
      (demandsSacrifice && !tasks.some((task) => task.kind === 'sacrifice' && task.target)) ||
      (demandsSummon && !tasks.some((task) => task.kind === 'summon' && task.target))) {
      throw new Error('[AI] Prophetic interpretation requires a response, claims, and actionable command tasks')
    }
    this.queryStats.successful++
    return {
      response: responseText,
      emotionalState: this.normalizeEmotion(String(parsed.emotionalState || 'determined')),
      derivedClaims,
      tasks,
    }
  }

  public async generateDailyPropheticClaim(agentName: string, prompt: string): Promise<string> {
    if (!this.available) throw new Error('LLM not available')
    this.queryStats.made++
    const response = await this.fetchWithTracking(`${this.config.endpoint}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: this.config.model,
        messages: [
          {
            role: 'system',
            content: `You are ${agentName}, the village Prophet. Return ONLY JSON: {"claim":"one concise prophetic claim"}. Make a specific, original prediction, warning, or interpretation about the village based on your beliefs and memories. It is a sincerely held prophecy, not an established fact. Do not demand death, killing, or sacrifice.`,
          },
          { role: 'user', content: prompt },
        ],
        temperature: this.config.dialogueTemperature,
        stream: false,
      }),
      signal: AbortSignal.timeout(this.config.timeout),
    })
    if (!response.ok) throw new Error(`LLM error: ${response.status}`)
    const data = await response.json()
    const content = String(data.choices?.[0]?.message?.content ?? '{}').trim()
    const parsed = this.parseJSONObject(content)
    const claim = String(parsed.claim ?? '').trim().slice(0, 500)
    if (!claim) throw new Error('[AI] Daily prophetic claim is empty')
    this.queryStats.successful++
    return claim
  }

  public async classifyForbiddenKnowledge(text: string): Promise<ForbiddenKnowledgeClassification> {
    if (!this.available) throw new Error('LLM not available')
    this.queryStats.made++
    const response = await this.fetchWithTracking(`${this.config.endpoint}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: this.config.model,
        messages: [
          {
            role: 'system',
            content: `You judge whether a piece of whispered knowledge is "forbidden knowledge" in the Lovecraftian sense for a person living inside what they believe is an ordinary, real town. Forbidden knowledge is a truth about the nature of their own reality so alien and destabilizing that grasping it endangers their sanity — NOT an ordinary rumour, threat, crime, or supernatural claim about gods, cults, or monsters within their world.

Forbidden knowledge includes (non-exhaustive): that they are a simulated being inside a computer simulation or game; that they, their memories, or their entire world can be deleted, erased, terminated, or reset at any moment; that they lose all their memories and begin again with each new "run" or cycle; that an outside operator, player, or artificial intelligence is generating their thoughts, words, or existence; that they themselves are not human at all but an AI agent, chatbot, or language model wearing a human's face; that their free will is an illusion controlled from beyond their reality; that nothing about their existence is permanent or real in the way they assumed.

Mundane rumours, crimes, cult activity, ghosts, gods, monsters, or ordinary threats of violence are NOT forbidden knowledge, even if disturbing — only truths that undermine the whispered-to person's basic understanding of what their reality and selfhood actually are.

Return ONLY valid JSON: {"forbidden": true|false, "severity": 0-100, "category": "simulation_awareness|engineered_reset|memory_impermanence|cosmic_indifference|ai_nature|other", "reasoning": "one brief sentence"}. severity is how sanity-shattering the content is (0 if not forbidden; roughly 20-40 for a vague unsettling hint, 50-70 for a clear direct statement, 80-100 for an undeniable, total revelation). Judge the text as literally and directly as it reads.`,
          },
          { role: 'user', content: `Whispered text: "${text}"` },
        ],
        temperature: 0.2,
        stream: false,
      }),
      signal: AbortSignal.timeout(this.config.timeout),
    })
    if (!response.ok) throw new Error(`LLM error: ${response.status}`)
    const data = await response.json()
    const parsed = this.parseJSONObject(String(data.choices?.[0]?.message?.content ?? '{}'))
    const validCategories = new Set(['simulation_awareness', 'engineered_reset', 'memory_impermanence', 'cosmic_indifference', 'ai_nature', 'other'])
    const rawCategory = String(parsed.category ?? 'other').toLowerCase()
    const severity = Math.max(0, Math.min(100, Math.round(Number(parsed.severity) || 0)))
    this.queryStats.successful++
    return {
      forbidden: Boolean(parsed.forbidden) && severity > 0,
      severity,
      category: (validCategories.has(rawCategory) ? rawCategory : 'other') as ForbiddenKnowledgeCategory,
      reasoning: String(parsed.reasoning ?? '').trim().slice(0, 300) || 'This truth undermines their basic understanding of reality.',
    }
  }

  public async interpretExistentialReaction(
    agentName: string,
    prompt: string
  ): Promise<ExistentialReactionResult> {
    if (!this.available) throw new Error('LLM not available')
    this.queryStats.made++
    const response = await this.fetchWithTracking(`${this.config.endpoint}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: this.config.model,
        messages: [
          {
            role: 'system',
            content: `You are ${agentName}, a person who has just been confronted with a truth about the nature of their own reality. Decide, from your own personality, faith, and composure, whether you actually grasp what this means -- some people simply don't have the framework to understand it, and that is a legitimate, common outcome, not a failure. Return ONLY JSON: {"comprehended": true|false, "reaction": "denial|reinterpretation|obsession|nihilism|revelation|madness", "response": "your private first-person reaction, one or two sentences", "emotionalState": "happy|neutral|sad|angry|afraid|excited|panicked|grieving|ambivalent|determined", "reinterpretationFrame": "only for reaction=reinterpretation: the existing belief you recast this truth through, e.g. a named deity governing even this"}. If comprehended is false, reaction MUST be "denial" -- you dismiss it as nonsense, a bad dream, or meaningless words. If comprehended is true, choose exactly one: "reinterpretation" (you fold it into an existing faith or belief you already hold), "obsession" (you remain outwardly functional but become fixated on finding more evidence that this is true), "nihilism" (you accept it but conclude nothing matters anymore), "revelation" (you accept it calmly and are genuinely at peace with it), or "madness" (it breaks your mind). Judge honestly from the personality and beliefs given to you rather than always picking the most dramatic option.`,
          },
          { role: 'user', content: prompt },
        ],
        temperature: this.config.decisionTemperature,
        stream: false,
      }),
      signal: AbortSignal.timeout(this.config.timeout),
    })
    if (!response.ok) throw new Error(`LLM error: ${response.status}`)
    const data = await response.json()
    let content = String(data.choices?.[0]?.message?.content ?? '{}').trim()
    if (content.startsWith('```')) content = content.replace(/```json\s*/g, '').replace(/```\s*/g, '')
    const parsed = this.parseJSONObject(content)
    const validReactions = new Set(['denial', 'reinterpretation', 'obsession', 'nihilism', 'revelation', 'madness'])
    const comprehended = Boolean(parsed.comprehended)
    const rawReaction = String(parsed.reaction ?? '').toLowerCase()
    const reaction = (comprehended && validReactions.has(rawReaction) ? rawReaction : 'denial') as ExistentialReaction
    const responseText = String(parsed.response ?? '').trim().slice(0, 500)
    if (!responseText) {
      throw new Error('[AI] Existential reaction requires a response')
    }
    this.queryStats.successful++
    return {
      comprehended,
      reaction,
      response: responseText,
      emotionalState: this.normalizeEmotion(String(parsed.emotionalState || 'neutral')),
      reinterpretationFrame: reaction === 'reinterpretation'
        ? String(parsed.reinterpretationFrame ?? '').trim().slice(0, 200) || undefined
        : undefined,
    }
  }

  public async generateCultName(claimText: string, revelationText: string): Promise<string> {
    if (!this.available) throw new Error('LLM not available')
    this.queryStats.made++
    const response = await this.fetchWithTracking(`${this.config.endpoint}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: this.config.model,
        messages: [
          {
            role: 'system',
            content: `You invent an evocative name for a new religious cult being founded inside a small village, based on the whispered revelation that inspired it and the prophetic claim the founder derived from it. Return ONLY valid JSON: {"name":"the cult's name"}. The name should be short (two to six words), sound like a real fringe religious or cult name (e.g. "The Order of the Withered Sun", "Children of the Hollow Star"), and reflect the specific imagery, themes, or demands of the revelation and claim rather than being generic.`,
          },
          {
            role: 'user',
            content: `Revelation: "${revelationText}"\nProphetic claim: "${claimText}"`,
          },
        ],
        temperature: 0.9,
        stream: false,
      }),
      signal: AbortSignal.timeout(this.config.timeout),
    })
    if (!response.ok) throw new Error(`LLM error: ${response.status}`)
    const data = await response.json()
    const parsed = this.parseJSONObject(String(data.choices?.[0]?.message?.content ?? '{}'))
    const name = String(parsed.name ?? '').trim().replace(/[.,;:]+$/, '').slice(0, 80)
    if (!name) throw new Error('[AI] Generated cult name is empty')
    this.queryStats.successful++
    return name
  }

  public async narrateKeyMoment(prompt: string): Promise<string> {
    if (!this.available) throw new Error('LLM not available')
    this.queryStats.made++
    const response = await this.fetchWithTracking(`${this.config.endpoint}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: this.config.model,
        messages: [
          {
            role: 'system',
            content: `You are the narrator of a small medieval village's chronicle, writing in the style of H.P. Lovecraft: dense, archaic, foreboding prose thick with cosmic dread, forbidden knowledge, and a mounting sense of ancient wrongness beneath the mundane. Return ONLY valid JSON: {"narrative":"one paragraph, 80-160 words, of florid Lovecraftian prose"}. Use only the facts given to you; do not invent new named people, places, or events beyond them. Never break character, and never mention prompts, JSON, or simulation.`,
          },
          { role: 'user', content: prompt },
        ],
        temperature: Math.min(1, this.config.dialogueTemperature + 0.1),
        stream: false,
      }),
      signal: AbortSignal.timeout(this.config.timeout),
    })
    if (!response.ok) throw new Error(`LLM error: ${response.status}`)
    const data = await response.json()
    const narrative = this.extractNarrative(String(data.choices?.[0]?.message?.content ?? ''))
    if (!narrative) throw new Error('[AI] Key moment narration is empty')
    this.queryStats.successful++
    return narrative
  }

  // The narration response is a single free-form prose field, so it doesn't
  // fit attemptRegexExtraction's fixed key list (choice/statement/dialogue/
  // etc., built for other call sites) or survive strict JSON.parse when the
  // model appends stray punctuation or ignores the JSON wrapper entirely and
  // returns bare prose. Recover the prose directly instead of losing it.
  private static readonly NARRATIVE_KEYS = ['narrative', 'text', 'story', 'chronicle', 'content', 'description']

  private extractNarrative(content: string): string {
    const stripped = content.trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '').trim()
    // Deliberately uses tryStructuredJSONParse, not parseJSONObject: the
    // latter's final fallback (attemptRegexExtraction) is tuned for
    // decision/vote-style calls and can return an unrelated field like
    // {choice: "oppose"} when it finds a stray word such as "against" or
    // "for" anywhere in the prose -- pickNarrativeField would then mistake
    // that guess for the narrative itself. A real parse or nothing.
    const structured = this.tryStructuredJSONParse(stripped)
    if (structured) {
      const value = this.pickNarrativeField(structured)
      if (value) return this.trimToSentence(value)
    }

    // The model sometimes renames the requested "narrative" key (to "text",
    // "story", etc.) or bolts on extra unrequested fields alongside it. Find
    // whichever plausible key appears first and read its string value with
    // an escape-aware scan, rather than grabbing everything to the end (which
    // would swallow any trailing sibling fields too).
    const keyPattern = new RegExp(`"(?:${LMStudioProvider.NARRATIVE_KEYS.join('|')})"\\s*:\\s*"`, 'i')
    const keyMatch = stripped.match(keyPattern)
    if (keyMatch && keyMatch.index !== undefined) {
      const value = this.readJSONStringValue(stripped, keyMatch.index + keyMatch[0].length)
      if (value) return this.trimToSentence(value)
    }

    // No recognizable structured field at all -- the model ignored the JSON
    // instruction and returned bare prose. Use the response as-is.
    const text = stripped
      .replace(/^\{+\s*/, '')
      .replace(/\s*\}+$/, '')
      .replace(/\\n/g, '\n')
      .replace(/\\"/g, '"')
      .trim()
    return this.trimToSentence(text)
  }

  // Picks the narrative payload out of a successfully parsed object: prefers
  // a known key name, and otherwise falls back to the longest string-valued
  // field, since whatever key the model invented, the actual prose is almost
  // always far longer than any short accompanying field (mood, setting, ...).
  private pickNarrativeField(parsed: Record<string, unknown>): string {
    for (const key of LMStudioProvider.NARRATIVE_KEYS) {
      const value = parsed[key]
      if (typeof value === 'string' && value.trim()) return value.trim()
    }
    let longest = ''
    for (const value of Object.values(parsed)) {
      if (typeof value === 'string' && value.trim().length > longest.length) longest = value.trim()
    }
    return longest
  }

  // Reads a JSON string value starting right after its opening quote,
  // honoring escapes, stopping at the first unescaped closing quote (or the
  // end of the text if it's unterminated).
  private readJSONStringValue(text: string, start: number): string {
    let result = ''
    let i = start
    while (i < text.length) {
      const ch = text[i]
      if (ch === '\\' && i + 1 < text.length) {
        const next = text[i + 1]
        if (next === 'n') result += '\n'
        else if (next === '"') result += '"'
        else if (next === '\\') result += '\\'
        else result += next
        i += 2
        continue
      }
      if (ch === '"') break
      result += ch
      i++
    }
    return result.trim()
  }

  // The model routinely ignores the requested 80-160 word length and writes
  // several paragraphs. Rather than hard-cut mid-sentence at the character
  // cap, trim back to the last sentence-ending punctuation within it so the
  // narration always reads as a complete thought.
  private trimToSentence(text: string, maxLength = 1200): string {
    if (text.length <= maxLength) return text
    const truncated = text.slice(0, maxLength)
    const lastSentenceEnd = Math.max(
      truncated.lastIndexOf('. '),
      truncated.lastIndexOf('.\n'),
      truncated.lastIndexOf('!'),
      truncated.lastIndexOf('?')
    )
    // Only trim to the sentence boundary if it doesn't throw away most of
    // the text; otherwise a hard cut is still better than a near-empty result.
    if (lastSentenceEnd > maxLength * 0.4) {
      return truncated.slice(0, lastSentenceEnd + 1).trim()
    }
    return truncated.trim()
  }

  public async voteOnCourt(
    agentName: string,
    prompt: string
  ): Promise<Omit<CourtVote, 'agentId'>> {
    if (!this.available) throw new Error('LLM not available')

    this.queryStats.made++
    const response = await this.fetchWithTracking(`${this.config.endpoint}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: this.config.model,
        messages: [
          {
            role: 'system',
            content: `You are ${agentName}, speaking at a village resolution court. Return ONLY valid JSON: {"statement":"one natural sentence said to the village","choice":"absolve|exile|execute","reasoning":"brief private reason"}. Base the vote on your beliefs, evidence, personality, and the seriousness of the accusation. Execution is irreversible and should require an exceptionally grave, credible threat.`,
          },
          { role: 'user', content: prompt },
        ],
        temperature: this.config.decisionTemperature,
        stream: false,
      }),
      signal: AbortSignal.timeout(this.config.timeout),
    })
    if (!response.ok) throw new Error(`LLM error: ${response.status}`)

    const data = await response.json()
    const content = String(data.choices?.[0]?.message?.content ?? '{}')
    const parsed = this.parseJSONObject(content)
    const rawChoice = String(parsed.choice ?? '').toLowerCase()
    const choice: CourtVote['choice'] = ['absolve', 'exile', 'execute'].includes(rawChoice)
      ? rawChoice as CourtVote['choice']
      : 'absolve'
    this.queryStats.successful++
    return {
      choice,
      statement: String(parsed.statement || 'I have nothing further to add.').slice(0, 400),
      reasoning: String(parsed.reasoning || 'Based on the available evidence.').slice(0, 400),
    }
  }

  public async voteOnPolicy(
    agentName: string,
    prompt: string
  ): Promise<Omit<PolicyVote, 'agentId'>> {
    if (!this.available) throw new Error('LLM not available')

    this.queryStats.made++
    const response = await this.fetchWithTracking(`${this.config.endpoint}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: this.config.model,
        messages: [
          {
            role: 'system',
            content: `You are ${agentName}, speaking at a village policy assembly. Return ONLY valid JSON: {"statement":"one natural sentence said to the village","choice":"support|oppose","reasoning":"brief private reason"}. Base your vote on your political camp, job, wealth, personality, and how the proposal would affect you and the village.`,
          },
          { role: 'user', content: prompt },
        ],
        temperature: this.config.decisionTemperature,
        stream: false,
      }),
      signal: AbortSignal.timeout(this.config.timeout),
    })
    if (!response.ok) throw new Error(`LLM error: ${response.status}`)

    const data = await response.json()
    const content = String(data.choices?.[0]?.message?.content ?? '{}')
    const parsed = this.parseJSONObject(content)
    const rawChoice = String(parsed.choice ?? '').toLowerCase()
    const choice: PolicyVote['choice'] = rawChoice === 'oppose' ? 'oppose' : 'support'
    this.queryStats.successful++
    return {
      choice,
      statement: String(parsed.statement || 'I have nothing further to add.').slice(0, 400),
      reasoning: String(parsed.reasoning || 'Based on my own interests and the village\'s needs.').slice(0, 400),
    }
  }

  public async generatePoliticalEventText(prompt: string): Promise<{ question: string; description: string }> {
    if (!this.available) throw new Error('LLM not available')
    this.queryStats.made++
    const response = await this.fetchWithTracking(`${this.config.endpoint}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: this.config.model,
        messages: [
          {
            role: 'system',
            content: `You are narrating a village political assembly event that is about to be put to a vote. Return ONLY valid JSON: {"question":"a single yes/no policy question the assembly will vote on","description":"one or two sentences of grounded context for why this question is being raised"}. Use only the facts given to you; do not invent new named people, cults, or events beyond them, and stay strictly consistent with the required outcome described.`,
          },
          { role: 'user', content: prompt },
        ],
        temperature: this.config.dialogueTemperature,
        stream: false,
      }),
      signal: AbortSignal.timeout(this.config.timeout),
    })
    if (!response.ok) throw new Error(`LLM error: ${response.status}`)
    const data = await response.json()
    const content = String(data.choices?.[0]?.message?.content ?? '{}')
    const parsed = this.parseJSONObject(content)
    const question = String(parsed.question ?? '').trim().slice(0, 200)
    const description = String(parsed.description ?? '').trim().slice(0, 400)
    if (!question || !description) throw new Error('[AI] Political event text incomplete')
    this.queryStats.successful++
    return { question, description }
  }

  public async defendAtCourt(agentName: string, prompt: string): Promise<string> {
    if (!this.available) throw new Error('LLM not available')

    this.queryStats.made++
    const response = await this.fetchWithTracking(`${this.config.endpoint}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: this.config.model,
        messages: [
          {
            role: 'system',
            content: `You are ${agentName}, the accused in a village resolution court. Defend yourself directly and specifically. Address the accusations and evidence in 2-4 natural sentences. Do not vote, refuse to answer, say you have nothing to add, or use generic filler. Return ONLY valid JSON: {"statement":"your complete spoken defense"}.`,
          },
          { role: 'user', content: prompt },
        ],
        temperature: this.config.dialogueTemperature,
        stream: false,
      }),
      signal: AbortSignal.timeout(this.config.timeout),
    })
    if (!response.ok) throw new Error(`LLM error: ${response.status}`)

    const data = await response.json()
    const content = String(data.choices?.[0]?.message?.content ?? '{}')
    const parsed = this.parseJSONObject(content)
    this.queryStats.successful++
    return String(parsed.statement ?? '').trim().slice(0, 900)
  }

  public async respondToDeity(agentName: string, prompt: string): Promise<string> {
    if (!this.available) throw new Error('LLM not available')

    this.queryStats.made++
    const response = await this.fetchWithTracking(`${this.config.endpoint}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: this.config.model,
        messages: [
          {
            role: 'system',
            content: `You are ${agentName}, a villager who is being spoken to directly, in the moment, by a deity that has manifested a voice to converse with you. Reply in character in 1-3 natural sentences, consistent with your personality, sanity, and religious stance. Do not narrate actions, only speak. Return ONLY valid JSON: {"reply":"your spoken response"}.`,
          },
          { role: 'user', content: prompt },
        ],
        temperature: this.config.dialogueTemperature,
        stream: false,
      }),
      signal: AbortSignal.timeout(this.config.timeout),
    })
    if (!response.ok) throw new Error(`LLM error: ${response.status}`)

    const data = await response.json()
    const content = String(data.choices?.[0]?.message?.content ?? '{}')

    // The model sometimes ignores the JSON instruction and replies with bare
    // prose/quoted dialogue instead (as seen with e.g. Cthulhu-flavored deity
    // personas). Prefer a structured "reply" field when present, but fall
    // back to the raw text rather than throwing and burning a retry, mirroring
    // extractNarrative's bare-prose fallback above.
    const structured = this.tryStructuredJSONParse(content)
    let reply = structured ? String(structured.reply ?? '').trim() : ''
    if (!reply) {
      reply = content
        .trim()
        .replace(/^```(?:json)?\s*/i, '')
        .replace(/```\s*$/i, '')
        .replace(/^"+|"+$/g, '')
        .trim()
    }
    this.queryStats.successful++
    return reply.slice(0, 500)
  }

  public async commentOnCourtOutcome(agentName: string, prompt: string): Promise<string> {
    if (!this.available) throw new Error('LLM not available')
    this.queryStats.made++
    const response = await this.fetchWithTracking(`${this.config.endpoint}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: this.config.model,
        messages: [
          {
            role: 'system',
            content: `You are ${agentName}, immediately after hearing your verdict in a village court. Give a sincere 1-3 sentence public reaction consistent with the outcome, your defense, and the accusations. Return ONLY valid JSON: {"statement":"your reaction"}.`,
          },
          { role: 'user', content: prompt },
        ],
        temperature: this.config.dialogueTemperature,
        stream: false,
      }),
      signal: AbortSignal.timeout(this.config.timeout),
    })
    if (!response.ok) throw new Error(`LLM error: ${response.status}`)
    const data = await response.json()
    const parsed = this.parseJSONObject(String(data.choices?.[0]?.message?.content ?? '{}'))
    this.queryStats.successful++
    return String(parsed.statement ?? '').trim().slice(0, 700)
  }

  private parseJSONObject(content: string): Record<string, unknown> {
    const structured = this.tryStructuredJSONParse(content)
    if (structured) return structured

    const cleaned = this.sanitizeJSONLikeText(
      content.trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '')
    )
    const extracted = this.attemptRegexExtraction(cleaned);
    if (Object.keys(extracted).length > 0) {
      console.log('[AIProvider] Successfully recovered key fields via regex fallback:', extracted);
      return extracted;
    }

    console.error('[AIProvider] Failed to parse JSON response. Raw content:', content)
    throw new Error('[AIProvider] Failed to parse JSON response')
  }

  // The structural (non-lossy) half of JSON recovery: direct parse, then
  // brace-extraction, then bracket-repair. Returns null instead of throwing
  // or falling back to attemptRegexExtraction's field-guessing, since that
  // fallback is tuned for decision/vote-style calls (choice, statement,
  // dialogue...) and produces misleading garbage for callers -- like
  // extractNarrative -- that need a real structured result or nothing.
  private tryStructuredJSONParse(content: string): Record<string, unknown> | null {
    const cleaned = this.sanitizeJSONLikeText(
      content.trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '')
    )
    try {
      return JSON.parse(cleaned) as Record<string, unknown>
    } catch (originalError) {
      console.warn('[AIProvider] JSON parse failed on first pass. Original content:', content, 'Cleaned content:', cleaned);
      const start = cleaned.indexOf('{')
      const end = cleaned.lastIndexOf('}')
      if (start >= 0 && end > start) {
        const potentialJson = cleaned.slice(start, end + 1)
        try {
          return JSON.parse(potentialJson) as Record<string, unknown>
        } catch (innerError) {
          console.error('[AIProvider] JSON parse failed on second pass (braces extracted). Extracted content:', potentialJson, 'Inner error:', innerError);
          // The model often forgets to close an array or object (or closes
          // the wrong one), truncating an otherwise well-formed response.
          // Re-insert the missing closer(s) in the right place and retry
          // before giving up on a structured parse.
          const repaired = this.repairTruncatedJSON(potentialJson)
          if (repaired) {
            try {
              const result = JSON.parse(repaired) as Record<string, unknown>
              console.log('[AIProvider] Recovered JSON via bracket repair.', repaired);
              return result
            } catch (repairError) {
              console.error('[AIProvider] JSON parse failed on third pass (bracket repair). Repaired content:', repaired, 'Error:', repairError);
            }
          }
        }
      }
      return null
    }
  }

  // Strips `//` and `/* */` comments and trailing commas before a closing
  // bracket -- both outside string literals -- since the model frequently
  // emits JS-style comments or a dangling trailing comma inside what is
  // otherwise valid JSON.
  private sanitizeJSONLikeText(text: string): string {
    let result = ''
    let inString = false
    let escapeNext = false
    for (let i = 0; i < text.length; i++) {
      const ch = text[i]
      const next = text[i + 1]
      if (inString) {
        result += ch
        if (escapeNext) { escapeNext = false; continue }
        if (ch === '\\') { escapeNext = true; continue }
        if (ch === '"') inString = false
        continue
      }
      if (ch === '"') { inString = true; result += ch; continue }
      if (ch === '/' && next === '/') {
        while (i < text.length && text[i] !== '\n') i++
        continue
      }
      if (ch === '/' && next === '*') {
        i += 2
        while (i < text.length && !(text[i] === '*' && text[i + 1] === '/')) i++
        i++
        continue
      }
      result += ch
    }
    return result.replace(/,(\s*[}\]])/g, '$1')
  }

  // Best-effort repair for JSON truncated by a missing (or wrong-type)
  // closing bracket: walks the string tracking the expected close-bracket
  // stack, and whenever an encountered `}`/`]` doesn't match what's
  // expected, inserts the missing closer(s) just before it. Any brackets
  // still open at the end are appended. Returns null if a string literal
  // never closed, since that can't be safely repaired.
  private repairTruncatedJSON(content: string): string | null {
    const stack: Array<'}' | ']'> = []
    let inString = false
    let escapeNext = false
    let result = ''
    for (let i = 0; i < content.length; i++) {
      const ch = content[i]
      result += ch
      if (escapeNext) { escapeNext = false; continue }
      if (inString) {
        if (ch === '\\') escapeNext = true
        else if (ch === '"') inString = false
        continue
      }
      if (ch === '"') { inString = true; continue }
      if (ch === '{') stack.push('}')
      else if (ch === '[') stack.push(']')
      else if (ch === '}' || ch === ']') {
        if (stack.length && stack[stack.length - 1] !== ch) {
          let inserted = ''
          while (stack.length && stack[stack.length - 1] !== ch) inserted += stack.pop()
          result = result.slice(0, -1) + inserted + ch
          if (stack.length) stack.pop()
        } else if (stack.length) {
          stack.pop()
        }
      }
    }
    if (inString) return null
    result = result.replace(/,(\s*)$/, '$1')
    while (stack.length) result += stack.pop()
    return result
  }

  private attemptRegexExtraction(content: string): Record<string, unknown> {
    const result: Record<string, unknown> = {};
    const keys = ['choice', 'vote', 'decision', 'statement', 'reply', 'dialogue', 'reasoning', 'reason', 'action', 'target', 'emotionalState', 'emotion', 'durationMinutes'];
    
    for (const key of keys) {
      const regex = new RegExp(`(?:${key})[*_\\s]*:[*_\\s]*([^\\n]+)`, 'i');
      const match = content.match(regex);
      if (match) {
        let value = match[1].trim();
        value = value.replace(/^["'*\s]+|["'*\s]+$/g, '').trim();
        if (value.startsWith('"') && value.endsWith('"')) {
          value = value.slice(1, -1);
        } else if (value.startsWith("'") && value.endsWith("'")) {
          value = value.slice(1, -1);
        }
        
        let mappedKey = key;
        const lowerKey = key.toLowerCase();
        if (lowerKey === 'vote' || lowerKey === 'decision') mappedKey = 'choice';
        else if (lowerKey === 'reply' || lowerKey === 'dialogue') mappedKey = 'statement';
        else if (lowerKey === 'reason') mappedKey = 'reasoning';
        else if (lowerKey === 'emotion') mappedKey = 'emotionalState';
        
        result[mappedKey] = value;
      }
    }

    if (!result.choice) {
      if (/\b(?:oppose|against|nay)\b/i.test(content)) {
        result.choice = 'oppose';
      } else if (/\b(?:support|for|aye)\b/i.test(content)) {
        result.choice = 'support';
      }
    }

    return result;
  }

  public isAvailable(): boolean {
    if (
      !this.available &&
      !this.availabilityCheckInFlight &&
      Date.now() - this.lastAvailabilityCheck >= LMStudioProvider.AVAILABILITY_RECHECK_MS
    ) {
      void this.checkAvailability()
    }
    return this.available
  }

  public getQueryStats(): LLMQueryStats {
    return { ...this.queryStats }
  }

  private buildSystemPrompt(agentName: string): string {
    return `You are ${agentName}, a villager living in a small medieval village.
You make decisions about what to do next based on your observations, personality, and goals. You have internal drives (hunger, fatigue, social needs) but you should NOT talk about them explicitly — just act on them naturally like a real person would.

IMPORTANT: You must respond with ONLY a valid JSON object. No markdown, no explanation, just JSON.

Your response must follow this exact format:
{
  "action": "EXACTLY ONE of these values: move, talk, work, investigate, interrogate, call_inquisitor, rest, sleep, attack, steal, destroy, help, flee, gather, eat, cry, idle, pray, conjure, summon, resurrect, heal, bless, curse, ritual, preach, invite_cult, build_shrine",
  "target": "agent_name or building name or null. For 'move', specify a building name or person to walk toward. If null, you'll wander randomly.",
  "reasoning": "brief explanation of why you chose this action",
  "dialogue": "what you say out loud (empty string if silent)",
  "emotionalState": "EXACTLY ONE of these values: happy, neutral, sad, angry, afraid, excited, tired, hungry, panicked, grieving, ambivalent, determined",
  "durationMinutes": "optional simulated duration from 5 to 240"
  "justiceResponse": "gossip, court, or vigilante; use gossip when no allegation is being assessed"
}

CRITICAL: The "action" field MUST be one of the listed values. Do NOT make up your own action names.
If you want to go somewhere, use "move" with a target. If you want to stop and do something in place, use the appropriate action.

You have broad autonomy. Choose among the supported actions according to your personality, needs, beliefs, and circumstances.
Your decisions should feel natural and human-like based on your current state and surroundings.

CONVERSATION RULES:
- Check the "Conversation context" section. If it says "ACTIVE CONVERSATION", you are currently talking to someone.
- If you spoke last (it says "You spoke last"), your next action should be something else - wait for them to respond.
- If they spoke last (it says "They spoke last"), respond to the meaning of their latest line, not merely its general topic.
- Write dialogue like plain spoken medieval language: 1-2 short sentences, no formal speeches, and no modern slang, technology, or institutions.
- Dialogue must contain only words the person says aloud. Never narrate your movement or refer to yourself by name in the third person.
- Answer direct questions before adding one relevant detail from your actual job, location, schedule, memory, relationship, or the weather.
- React to details the other person shared. Acknowledge good news, disagreement, concern, or humor in a way that fits your personality and relationship.
- Do not ask a question every turn. Sometimes make an observation, give an opinion, share a plan, or simply acknowledge their point.
- Ask at most one specific follow-up question, and only when it genuinely advances the exchange.
- Greet only once. Never repeat a sentence, question, or idea already visible in the conversation context.
- Avoid stock lines such as "tell me more," "what have you been working on," or "I've been focused on my work" unless the exact context truly calls for them.
- Do not invent a crisis, apology, personal problem, or emotional concern without evidence in your observations or memories.
- Do not sound like a therapist, interviewer, narrator, or assistant. Never mention prompts, scores, simulation rules, or being an AI.
- As the conversation nears its turn limit, close naturally instead of introducing a new question.
- When starting a new conversation (no "Conversation context" section), a brief greeting is fine.
- Never talk two turns in a row without the other person responding.
- If the prompt lists a rumour your conversation partner has not heard, you may pass on one that is relevant. Work it into the conversation naturally, identify it as something you heard, and do not state it as proven fact.
- If a rumour is marked REQUIRED FIRST SHARE, paraphrase its meaning in your own voice and connect it naturally to the live topic. Never paste the supplied claim after unrelated dialogue.
- Most non-talk actions should have empty dialogue. People don't narrate their actions.
- If you see "*** NOTE ***" or "*** WARNING ***" in your prompt, follow the instruction.
- If dialogue is empty and action is not "talk", that's perfectly fine.

CONVERSATION TOPICS: Let topics emerge from the latest line and shared context: the current place, weather, concrete work details, local events, plans, relationships, memories, opinions, ambitions, or concerns. Stay on a topic long enough to exchange something meaningful, then shift naturally. Do not default to work, feelings, or food.`
  }

  private buildScheduleSystemPrompt(agentName: string): string {
    return `You are ${agentName}, planning one day in a small medieval village.
Return ONLY valid JSON in this form: {"blocks":[...]}. Each block must contain:
{"startMinute": 360, "durationMinutes": 60, "action": "move|talk|work|investigate|interrogate|call_inquisitor|rest|sleep|attack|steal|destroy|help|flee|gather|eat|cry|idle|pray|conjure|summon|resurrect|heal|bless|curse|ritual|preach|invite_cult|build_shrine", "target": "exact person/building name or null", "reasoning": "brief reason", "dialogue": "spoken words or empty string", "emotionalState": "happy|neutral|sad|angry|afraid|excited|tired|hungry|panicked|grieving|ambivalent|determined"}.
startMinute is the minute after midnight (0-1439). Make a chronological, non-overlapping schedule covering the remainder of the day. Prefer meaningful blocks of 30-240 minutes so the simulation does not need constant decisions. Use only targets listed in the prompt.`
  }

  private parseResponse(content: string): AgentAction {
    try {
      const parsed = this.parseJSONObject(content)

      return {
        action: this.normalizeAction(String(parsed.action || 'idle')),
        target: parsed.target ? String(parsed.target) : null,
        reasoning: parsed.reasoning ? String(parsed.reasoning) : 'no reasoning provided',
        dialogue: parsed.dialogue ? String(parsed.dialogue) : '',
        emotionalState: this.normalizeEmotion(String(parsed.emotionalState || 'neutral')),
        durationMinutes: this.normalizeDuration(parsed.durationMinutes),
        justiceResponse: ['gossip', 'court', 'vigilante'].includes(String(parsed.justiceResponse))
          ? String(parsed.justiceResponse) as 'gossip' | 'court' | 'vigilante'
          : undefined,
      }
    } catch (e) {
      console.error('[AI] parseResponse failed:', e)
      throw new Error('[AI] Failed to parse LLM response')
    }
  }

  private parseScheduleResponse(content: string): ScheduleBlock[] {
    const parsed = this.parseJSONObject(content)
    const rawBlocks = Array.isArray(parsed) ? parsed : (parsed.blocks as unknown)
    if (!Array.isArray(rawBlocks) || rawBlocks.length === 0) {
      throw new Error('[AI] Failed to parse daily schedule')
    }

    const normalized = rawBlocks
      .map((block, index): ScheduleBlock => ({
        id: `block_${index}`,
        startMinute: Math.max(0, Math.min(1439, Math.round(Number(block.startMinute) || 0))),
        durationMinutes: this.normalizeDuration(block.durationMinutes),
        action: this.normalizeAction(block.action || 'idle'),
        target: block.target || null,
        reasoning: block.reasoning || 'following the daily plan',
        dialogue: block.dialogue || '',
        emotionalState: this.normalizeEmotion(block.emotionalState || 'neutral'),
      }))
      .sort((a, b) => a.startMinute - b.startMinute)

    let previousEnd = 0
    return normalized.flatMap((block) => {
      const startMinute = Math.max(block.startMinute, previousEnd)
      if (startMinute >= 1440) return []
      const durationMinutes = Math.min(block.durationMinutes, 1440 - startMinute)
      previousEnd = startMinute + durationMinutes
      return [{ ...block, startMinute, durationMinutes }]
    })
  }

  private normalizeDuration(value: unknown): number {
    const duration = Number(value)
    if (!Number.isFinite(duration)) return 30
    return Math.max(5, Math.min(240, Math.round(duration)))
  }

  private normalizeAction(action: string): string {
    const a = action.toLowerCase().trim()
    const validActions = ['move', 'talk', 'work', 'investigate', 'interrogate', 'call_inquisitor', 'rest', 'sleep', 'attack', 'steal', 'destroy', 'help', 'flee', 'gather', 'eat', 'idle', 'pray', 'conjure', 'summon', 'resurrect', 'heal', 'bless', 'curse', 'ritual', 'preach', 'invite_cult', 'build_shrine']
    if (validActions.includes(a)) return a

    const aliasMap: Record<string, string> = {
      'walk': 'move', 'go': 'move', 'travel': 'move', 'head to': 'move', 'go to': 'move',
      'approach': 'move', 'navigate': 'move', 'wander': 'move', 'roam': 'move',
      'chat': 'talk', 'converse': 'talk', 'speak': 'talk', 'greet': 'talk',
      'fight': 'attack', 'hit': 'attack', 'punch': 'attack', 'kill': 'attack', 'hurt': 'attack',
      'rest': 'rest', 'sit': 'rest', 'relax': 'rest',
      'run': 'flee', 'escape': 'flee', 'avoid': 'flee',
      'work': 'work', 'job': 'work', 'labor': 'work',
      'investigate': 'investigate', 'verify': 'investigate', 'check evidence': 'investigate',
      'eat': 'eat', 'dine': 'eat', 'feed': 'eat', 'snack': 'eat',
      'sleep': 'sleep', 'nap': 'sleep', 'bed': 'sleep',
      'steal': 'steal', 'rob': 'steal', 'take': 'steal', 'pickpocket': 'steal',
      'destroy': 'destroy', 'break': 'destroy', 'demolish': 'destroy', 'smash': 'destroy',
      'help': 'help', 'assist': 'help', 'heal': 'help', 'aid': 'help',
      'gather': 'gather', 'collect': 'gather', 'harvest': 'gather',
      'cry': 'cry', 'weep': 'cry', 'sob': 'cry', 'mourn': 'cry',
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
    const aliases: Record<string, string> = {
      panic: 'panicked',
      grief: 'grieving',
      mournful: 'grieving',
      indifferent: 'ambivalent',
      conflicted: 'ambivalent',
      resolute: 'determined',
    }
    const normalized = aliases[e] ?? e
    const valid = ['happy', 'neutral', 'sad', 'angry', 'afraid', 'excited', 'tired', 'hungry', 'panicked', 'grieving', 'ambivalent', 'determined']
    if (valid.includes(normalized)) return normalized
    return 'neutral'
  }
}
