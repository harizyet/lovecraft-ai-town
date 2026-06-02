import { Agent } from '@/agent/Agent'
import { SimulationEvent, RelationshipType } from '@/types'

interface LastActionInfo {
  action: string
  timestamp: number
}

export class PromptBuilder {
  public buildDecisionPrompt(agent: Agent, allAgents: Agent[], lastAction?: LastActionInfo, conversationContext = ''): string {
    const state = agent.state
    const observations = agent.getObservations(allAgents)
    const buildings = this.formatBuildings(agent)
    const behaviorWarning = this.buildBehaviorWarning(lastAction, agent)

    const recentMemory = this.formatMemory(agent.state.memory.recent)
    const longTermSummary = agent.state.memory.summary
    const relationships = this.formatRelationships(agent, allAgents)
    const fearsGrudges = this.formatFearsGrudges(agent, allAgents)
    const inventory = this.formatInventory(agent)

    return `${observations}

Buildings you can go to (use these exact names as targets when moving):
${buildings}

${behaviorWarning}---

Your personality:
- Aggression: ${state.personality.aggression.toFixed(1)}
- Friendliness: ${state.personality.friendliness.toFixed(1)}
- Curiosity: ${state.personality.curiosity.toFixed(1)}
- Caution: ${state.personality.caution.toFixed(1)}
- Ambition: ${state.personality.ambition.toFixed(1)}

${inventory ? `Your inventory:\n${inventory}\n\n---\n\n` : ''}
${relationships ? `Your relationships:\n${relationships}\n\n---\n\n` : ''}
${fearsGrudges ? `Your fears and grudges:\n${fearsGrudges}\n\n---\n\n` : ''}
${longTermSummary ? `Memory summary:\n${longTermSummary}\n\n---\n\n` : ''}
${conversationContext ? `Conversation context:\n${conversationContext}\n\n---\n\n` : ''}
${recentMemory ? `Recent events:\n${recentMemory}\n\n---\n\n` : ''}
What do you do next? Respond with ONLY a JSON object.`
  }

  private buildBehaviorWarning(lastAction: LastActionInfo | undefined, agent: Agent): string {
    if (!lastAction) return ''

    if (lastAction.action === 'talk') {
      if (agent.isConversationActive()) {
        const conv = agent.getActiveConversation()
        if (conv && conv.exchanges.length >= conv.maxTurns - 1) {
          return `*** WARNING: Your conversation is nearly at the limit. Wrap up or do something else. ***\n\n`
        }
        return `*** NOTE: You just spoke. Your next action should be something else (move, work, eat, rest, idle) unless you're waiting for a response. ***\n\n`
      }
      return `*** NOTE: You just talked. Choose a different action this turn (move, work, eat, rest, etc.). ***\n\n`
    }

    return ''
  }

  private formatMemory(events: SimulationEvent[]): string {
    if (events.length === 0) return ''

    return events
      .slice(-15)
      .map((e) => {
        const target = e.targetId ? ` -> ${e.targetId}` : ''
        return `[${e.type}] ${e.description}${target}`
      })
      .join('\n')
  }

  private formatRelationships(agent: Agent, allAgents: Agent[]): string {
    if (agent.state.relationships.length === 0) return ''

    const typeLabels: Record<string, string> = {
      neutral: 'neutral',
      friend: 'friend',
      enemy: 'enemy',
      ally: 'ally',
      romantic: 'romantic',
      fear: 'feared',
    }

    return agent.state.relationships
      .map((rel) => {
        const target = allAgents.find((a) => a.state.id === rel.agentId)
        const name = target?.state.name ?? rel.agentId
        const relType = typeLabels[rel.type] ?? 'neutral'
        return `${name}: ${relType} (${rel.strength}/100)`
      })
      .join('\n')
  }

  private formatFearsGrudges(agent: Agent, allAgents: Agent[]): string {
    const parts: string[] = []

    if (agent.state.fears.length > 0) {
      const fearNames = agent.state.fears
        .map((id) => allAgents.find((a) => a.state.id === id)?.state.name ?? id)
        .join(', ')
      parts.push(`Feared: ${fearNames}`)
    }

    if (agent.state.grudges.length > 0) {
      const grudgeNames = agent.state.grudges
        .map((id) => allAgents.find((a) => a.state.id === id)?.state.name ?? id)
        .join(', ')
      parts.push(`Grudges: ${grudgeNames}`)
    }

    if (agent.state.alliances.length > 0) {
      const allianceNames = agent.state.alliances
        .map((id) => allAgents.find((a) => a.state.id === id)?.state.name ?? id)
        .join(', ')
      parts.push(`Alliances: ${allianceNames}`)
    }

    return parts.join('\n')
  }

  private formatInventory(agent: Agent): string {
    if (agent.state.inventory.length === 0) return ''

    return agent.state.inventory
      .map((item) => `${item.name} x${item.quantity}`)
      .join(', ')
  }

  private formatBuildings(agent: Agent): string {
    const buildings = agent.getWorld().getBuildings()
    if (buildings.length === 0) return 'No buildings nearby'

    return buildings
      .map((b) => `- ${b.name} (${b.type})`)
      .join('\n')
  }
}
