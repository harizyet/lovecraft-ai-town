import { Agent } from '@/agent/Agent'
import { ConversationExchange } from '@/types'
import { EventBus } from '@/interaction/EventBus'

export class ConversationManager {
  private eventBus: EventBus
  private conversationCooldowns: Map<string, number>
  private cooldownDuration: number
  private proximityRadius: number

  constructor(eventBus: EventBus) {
    this.eventBus = eventBus
    this.conversationCooldowns = new Map()
    this.cooldownDuration = 45_000
    this.proximityRadius = 4
  }

  public checkConversationEligibility(agent: Agent, target: Agent, simTime: number): 'active' | 'busy' | 'cooldown' | 'eligible' | 'tooFar' {
    if (agent.distanceTo(target.state) > this.proximityRadius) {
      return 'tooFar'
    }

    const agentPartnerId = agent.getConversationPartnerId()
    const targetPartnerId = target.getConversationPartnerId()
    if (agentPartnerId === target.state.id && targetPartnerId === agent.state.id) return 'active'
    if (agent.isConversationActive() || target.isConversationActive()) return 'busy'

    const cooldownKey = [agent.state.id, target.state.id].sort().join('-')
    const lastTalk = this.conversationCooldowns.get(cooldownKey)
    if (lastTalk !== undefined && simTime - lastTalk < this.cooldownDuration) {
      return 'cooldown'
    }

    return 'eligible'
  }

  public initiateConversation(
    agent: Agent,
    target: Agent,
    dialogue: string,
    topic: string,
    simTime: number,
    ignoreCooldown = false
  ): boolean {
    const eligibility = this.checkConversationEligibility(agent, target, simTime)
    if (eligibility !== 'eligible' && !(ignoreCooldown && eligibility === 'cooldown')) return false
    const cooldownKey = [agent.state.id, target.state.id].sort().join('-')
    this.conversationCooldowns.set(cooldownKey, simTime)

    agent.state.path = []
    agent.state.pathIndex = 0
    target.state.path = []
    target.state.pathIndex = 0

    const convId = agent.startConversation(target.state.id, target.state.name, topic)
    target.startConversation(agent.state.id, agent.state.name, topic)

    const exchange: ConversationExchange = {
      speakerId: agent.state.id,
      speakerName: agent.state.name,
      dialogue,
      timestamp: simTime,
    }

    agent.addConversationExchange(agent.state.id, agent.state.name, dialogue)
    target.addConversationExchange(agent.state.id, agent.state.name, dialogue)

    agent.socialize()
    target.socialize()

    return true
  }

  public addTurn(agent: Agent, target: Agent, dialogue: string, simTime: number): boolean {
    const conv = agent.getActiveConversation()
    if (
      !conv ||
      agent.getConversationPartnerId() !== target.state.id ||
      target.getConversationPartnerId() !== agent.state.id
    ) return false

    agent.state.path = []
    agent.state.pathIndex = 0
    target.state.path = []
    target.state.pathIndex = 0

    const exchange: ConversationExchange = {
      speakerId: agent.state.id,
      speakerName: agent.state.name,
      dialogue,
      timestamp: simTime,
    }

    agent.addConversationExchange(agent.state.id, agent.state.name, dialogue)
    target.addConversationExchange(agent.state.id, agent.state.name, dialogue)

    agent.socialize()
    target.socialize()

    return true
  }

  public closeConversation(agent: Agent, target: Agent): void {
    if (agent.getConversationPartnerId() === target.state.id) agent.closeActiveConversation()
    if (target.getConversationPartnerId() === agent.state.id) target.closeActiveConversation()
  }

  public autoCloseInactiveConversations(agent: Agent, allAgents: Agent[], simTime: number): void {
    if (!agent.isConversationActive()) return

    if (agent.shouldCloseConversation(simTime)) {
      const partnerId = agent.getConversationPartnerId()
      if (partnerId) {
        const partner = allAgents.find((a) => a.state.id === partnerId && a.state.alive)
        if (partner) {
          this.closeConversation(agent, partner)
        } else {
          agent.closeActiveConversation()
        }
      } else {
        agent.closeActiveConversation()
      }
      return
    }

    const partnerId = agent.getConversationPartnerId()
    if (partnerId) {
      const partner = allAgents.find((a) => a.state.id === partnerId && a.state.alive)
      if (partner && agent.distanceTo(partner.state) > this.proximityRadius * 1.5) {
        this.closeConversation(agent, partner)
      } else if (!partner || !partner.state.alive) {
        agent.closeActiveConversation()
      }
    }
  }

  public getConversationContext(agent: Agent, allAgents: Agent[]): string {
    if (!agent.isConversationActive()) {
      return this.getRecentConversationSummary(agent, allAgents)
    }

    const conv = agent.getActiveConversation()
    if (!conv || conv.exchanges.length === 0) {
      return this.getRecentConversationSummary(agent, allAgents)
    }

    const partnerId = agent.getConversationPartnerId()
    const partner = allAgents.find((a) => a.state.id === partnerId)?.state.name ?? 'Unknown'

    let context = `ACTIVE CONVERSATION with ${partner} (topic: ${conv.topic}, turns: ${conv.exchanges.length}/${conv.maxTurns}):\n`

    const recentExchanges = conv.exchanges.slice(-5)
    for (const ex of recentExchanges) {
      const speaker = ex.speakerId === agent.state.id ? 'You' : ex.speakerName
      context += `  ${speaker}: "${ex.dialogue}"\n`
    }

    const lastSpeaker = recentExchanges[recentExchanges.length - 1]
    if (lastSpeaker && lastSpeaker.speakerId === agent.state.id) {
      context += '\n  (You spoke last - wait for them to respond, or do something else)\n'
    } else {
      context += '\n  (They spoke last - you may respond)\n'
    }

    return context
  }

  private getRecentConversationSummary(agent: Agent, allAgents: Agent[]): string {
    const recentConvs = Array.from(agent.conversations.values())
      .sort((a, b) => b.lastActiveAt - a.lastActiveAt)
      .slice(0, 3)

    if (recentConvs.length === 0) return ''

    const parts: string[] = ['Recent conversation history:']
    for (const conv of recentConvs) {
      const partner = allAgents.find((a) => a.state.id !== agent.state.id && conv.participants.includes(a.state.id))?.state.name ?? 'Unknown'
      const lastExchange = conv.exchanges[conv.exchanges.length - 1]
      parts.push(`  - With ${partner} about "${conv.topic}": "${lastExchange?.dialogue ?? '?'}"`)
    }

    return parts.join('\n')
  }
}
