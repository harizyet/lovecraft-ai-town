import { Agent } from '@/agent/Agent'
import { ActionType, AgentAction } from '@/types'
import { SystemDeps } from './SystemDeps'

export interface SocialState {
  pregeneratedConversations: Map<string, { lines: { speakerId: string; dialogue: string }[]; nextAt: number }>
  lastActions: Map<string, { action: string; timestamp: number }>
  activeEncounterPairs: Set<string>
  lastEncounterMinute: Map<string, number>
}

export function createSocialState(): SocialState {
  return {
    pregeneratedConversations: new Map(),
    lastActions: new Map(),
    activeEncounterPairs: new Set(),
    lastEncounterMinute: new Map(),
  }
}

export class SocialSystem {
  constructor(private deps: SystemDeps, public readonly state: SocialState) {}

  detectAgentEncounters(): void {
    const activeAgents = this.deps.getAgents().filter((agent) => agent.state.alive && !agent.state.demon)
    const now = this.deps.getAbsoluteMinute()

    for (let i = 0; i < activeAgents.length; i++) {
      for (let j = i + 1; j < activeAgents.length; j++) {
        const first = activeAgents[i]
        const second = activeAgents[j]
        const pairKey = [first.state.id, second.state.id].sort().join(':')
        const distance = first.distanceTo(second.state)

        if (distance > 4) {
          this.state.activeEncounterPairs.delete(pairKey)
          continue
        }
        if (distance > 2) continue

        if (this.state.activeEncounterPairs.has(pairKey)) continue

        const talkingToEachOther =
          first.getConversationPartnerId() === second.state.id ||
          second.getConversationPartnerId() === first.state.id
        if (talkingToEachOther) {
          this.state.activeEncounterPairs.add(pairKey)
          continue
        }

        if (first.isConversationActive() || second.isConversationActive()) continue

        const lastEncounter = this.state.lastEncounterMinute.get(pairKey) ?? -Infinity
        if (now - lastEncounter < 60) continue

        this.state.activeEncounterPairs.add(pairKey)
        this.state.lastEncounterMinute.set(pairKey, now)

        const firstSocialScore = first.state.personality.friendliness + (100 - first.state.needs.social) / 100
        const secondSocialScore = second.state.personality.friendliness + (100 - second.state.needs.social) / 100
        const initiator = firstSocialScore >= secondSocialScore ? first : second
        const encountered = initiator === first ? second : first
        const isKnown = this.agentKnows(initiator, encountered)
        const baseConversationChance = 0.35
        const configuredMultiplier = Math.max(
          0,
          this.deps.simManager.getConfig().conversationChanceMultiplier
        )
        const rumourMultiplier = this.deps.hasRumourPropagationOpportunity(initiator, encountered)
          ? Math.max(0, this.deps.simManager.getConfig().rumourPropagationMultiplier)
          : 1
        const acknowledges = isKnown || Math.random() <= Math.min(
          1,
          baseConversationChance * configuredMultiplier * rumourMultiplier
        )
        const encounterEvent = this.deps.eventBus.emit({
          type: 'encounter',
          agentId: initiator.state.id,
          actionType: ActionType.IDLE,
          targetId: encountered.state.id,
          outcome: acknowledges ? 'acknowledged' : 'ignored',
          description: acknowledges
            ? `${initiator.state.name} acknowledged ${encountered.state.name} nearby`
            : `${initiator.state.name} ignored the unfamiliar ${encountered.state.name}`,
          causationIds: [],
          worldStateDelta: {},
          observers: [initiator.state.id, encountered.state.id],
        })
        initiator.addRecentMemory(encounterEvent)
        encountered.addRecentMemory(encounterEvent)
        if (!acknowledges) continue

        const simTime = this.deps.simManager.getSimTime()
        const eligibility = this.deps.conversationManager.checkConversationEligibility(
          initiator,
          encountered,
          simTime
        )
        if (eligibility !== 'eligible') continue

        const opener: AgentAction = {
          action: 'talk',
          target: encountered.state.name,
          reasoning: 'Acknowledging someone nearby',
          dialogue: this.buildEncounterOpener(initiator, encountered, isKnown),
          emotionalState: 'neutral',
          durationMinutes: 5,
        }
        const dialogue = opener.dialogue ?? ''
        this.deps.conversationManager.initiateConversation(
          initiator,
          encountered,
          dialogue,
          'daily plans, work, and town life',
          simTime
        )
        this.deps.agentInteraction.handleConversation(
          initiator,
          encountered,
          dialogue,
          [encounterEvent.id]
        )
        this.maybeBatchGenerateConversation(
          initiator,
          encountered,
          initiator,
          dialogue,
          'daily plans, work, and town life'
        )
      }
    }
  }

  agentKnows(agent: Agent, other: Agent): boolean {
    if (agent.state.relationships.some((relationship) => relationship.agentId === other.state.id)) {
      return true
    }
    return Array.from(agent.conversations.values()).some((conversation) =>
      conversation.participants.includes(other.state.id)
    )
  }

  forceConversationResponse(
    agent: Agent,
    decision: AgentAction,
    partnerId: string
  ): void {
    const partner = this.deps.getAgents().find((candidate) => candidate.state.id === partnerId && candidate.state.alive)
    if (!partner || agent.distanceTo(partner.state) > 4) return

    decision.action = 'talk'
    decision.target = partner.state.name
    decision.durationMinutes = Math.min(decision.durationMinutes ?? 5, 10)

    const dialogue = decision.dialogue?.trim() ?? ''
    if (this.isWeakOrRepeatedDialogue(agent, dialogue)) {
      decision.dialogue = this.buildContextualConversationResponse(agent, partner)
    }
    this.deps.maybeAddRumourToConversation(agent, partner, decision)
    decision.reasoning = `Responding to ${partner.state.name}'s conversation`
  }

  conversationPairKey(agentId: string, partnerId: string): string {
    return [agentId, partnerId].sort().join('-')
  }

  canBatchGenerateConversation(a: Agent, b: Agent): boolean {
    if (!this.deps.aiProvider?.isAvailable()) return false
    if (a.state.demon || b.state.demon) return false
    if (a.state.cult || b.state.cult) return false
    const isKnight = (agent: Agent) => agent.state.currentJob === 'Knight' || agent.state.outsider?.kind === 'knight'
    if (isKnight(a) || isKnight(b)) return false

    const specialTriggerTypes = new Set(['rumour', 'prophecy', 'prophetic_task', 'world_event'])
    const hasSpecialTrigger = (agentId: string) =>
      (this.deps.decisionQueue.get(agentId) ?? []).some((trigger) => specialTriggerTypes.has(trigger.type))
    if (hasSpecialTrigger(a.state.id) || hasSpecialTrigger(b.state.id)) return false

    if (this.deps.buildRumourConversationContext(a, b.state.id) || this.deps.buildRumourConversationContext(b, a.state.id)) {
      return false
    }

    const activeCourtRumourId = this.deps.getActiveCourtRumourId()
    if (activeCourtRumourId) {
      const court = this.deps.rumours.get(activeCourtRumourId)?.resolutionCourt
      if (
        court &&
        (court.participantIds.includes(a.state.id) || court.participantIds.includes(b.state.id) ||
          court.accusedAgentId === a.state.id || court.accusedAgentId === b.state.id)
      ) return false
    }

    return true
  }

  maybeBatchGenerateConversation(
    initiator: Agent,
    target: Agent,
    openingSpeaker: Agent,
    openingLine: string,
    topic: string
  ): void {
    if (!this.canBatchGenerateConversation(initiator, target)) return
    const pairKey = this.conversationPairKey(initiator.state.id, target.state.id)
    const respondent = openingSpeaker.state.id === initiator.state.id ? target : initiator
    const maxTurns = initiator.getActiveConversation()?.maxTurns ?? 6
    const remainingTurns = Math.max(0, maxTurns - 1)
    if (remainingTurns === 0) return

    const prompt = this.deps.promptBuilder.buildConversationTranscriptPrompt(
      initiator,
      target,
      this.deps.getAgents(),
      topic,
      openingSpeaker.state.name,
      openingLine,
      remainingTurns
    )

    void (async () => {
      try {
        const turns = await this.deps.aiProvider!.generateConversation(
          initiator.state.name,
          target.state.name,
          prompt
        )
        if (turns.length === 0) return
        // Verify the pair is still exactly as it was when generation started.
        if (
          !initiator.state.alive || !target.state.alive ||
          initiator.getConversationPartnerId() !== target.state.id ||
          target.getConversationPartnerId() !== initiator.state.id
        ) return

        let nextSpeaker = respondent
        let otherSpeaker = respondent.state.id === initiator.state.id ? target : initiator
        const lines: { speakerId: string; dialogue: string }[] = []
        for (const turn of turns.slice(0, remainingTurns)) {
          lines.push({ speakerId: nextSpeaker.state.id, dialogue: turn.dialogue })
          const tmp = nextSpeaker
          nextSpeaker = otherSpeaker
          otherSpeaker = tmp
        }

        this.state.pregeneratedConversations.set(pairKey, {
          lines,
          nextAt: this.deps.simManager.getSimTime() + 2500 + Math.random() * 2500,
        })
        // The opener's 'conversation' event may already have queued a reply trigger; the
        // pre-written lines supersede it.
        const queued = this.deps.decisionQueue.get(respondent.state.id)
        if (queued) {
          this.deps.decisionQueue.set(respondent.state.id, queued.filter((trigger) => trigger.type !== 'interaction'))
        }
      } catch {
        // Leave the normal turn-by-turn path (already queued from the opener event) untouched.
      }
    })()
  }

  advancePregeneratedConversations(simTime: number): void {
    for (const [pairKey, entry] of Array.from(this.state.pregeneratedConversations.entries())) {
      const [firstId, secondId] = pairKey.split('-')
      const first = this.deps.getAgents().find((candidate) => candidate.state.id === firstId)
      const second = this.deps.getAgents().find((candidate) => candidate.state.id === secondId)
      if (
        !first?.state.alive || !second?.state.alive ||
        first.getConversationPartnerId() !== second.state.id ||
        second.getConversationPartnerId() !== first.state.id ||
        first.distanceTo(second.state) > 4
      ) {
        this.state.pregeneratedConversations.delete(pairKey)
        continue
      }

      const specialTriggerTypes = new Set(['world_event', 'prophecy', 'prophetic_task'])
      const wasInterrupted = [first, second].some((agent) =>
        (this.deps.decisionQueue.get(agent.state.id) ?? []).some((trigger) => specialTriggerTypes.has(trigger.type))
      )
      if (wasInterrupted) {
        this.state.pregeneratedConversations.delete(pairKey)
        continue
      }

      if (simTime < entry.nextAt || entry.lines.length === 0) continue

      const line = entry.lines.shift()!
      const speaker = line.speakerId === first.state.id ? first : second
      const listener = speaker === first ? second : first
      const added = this.deps.conversationManager.addTurn(speaker, listener, line.dialogue, simTime)
      if (added) {
        this.deps.agentInteraction.handleConversation(speaker, listener, line.dialogue)
      }
      entry.nextAt = simTime + 2500 + Math.random() * 2500
      if (entry.lines.length === 0) this.state.pregeneratedConversations.delete(pairKey)
    }
  }

  isWeakOrRepeatedDialogue(agent: Agent, dialogue: string): boolean {
    const normalized = dialogue.toLowerCase().replace(/[^a-z0-9\s]/g, '').replace(/\s+/g, ' ').trim()
    if (!normalized || /^(hi|hello|hey)$/.test(normalized)) return true

    const conversation = agent.getActiveConversation()
    if (!conversation) return false
    const previousLines = conversation.exchanges.map((exchange) =>
      exchange.dialogue.toLowerCase().replace(/[^a-z0-9\s]/g, '').replace(/\s+/g, ' ').trim()
    )
    if (previousLines.includes(normalized)) return true

    const repeatedGenericQuestion =
      normalized.includes('what have you been working on') ||
      normalized.includes('tell me more')
    return repeatedGenericQuestion && previousLines.some((line) =>
      line.includes('what have you been working on') || line.includes('tell me more')
    )
  }

  buildContextualConversationResponse(agent: Agent, partner: Agent): string {
    const conversation = agent.getActiveConversation()
    const lastLine = conversation?.exchanges[conversation.exchanges.length - 1]?.dialogue.toLowerCase() ?? ''
    const jobActivities: Record<string, string> = {
      Teacher: 'I have been preparing lessons and checking how my students are progressing.',
      Mechanic: 'I have been diagnosing a difficult repair and waiting on a replacement part.',
      'Retail Worker': 'I have been organizing a new delivery and helping customers find what they need.',
      Sheriff: 'I have been checking the town square and following up on recent disturbances.',
      Nurse: 'I have been checking on patients and making sure our medical supplies are ready.',
      Accountant: 'I have been reviewing the town accounts and tracking an expense that does not add up.',
      Chef: 'I have been planning today’s menu and checking whether we have enough fresh ingredients.',
      Paramedic: 'I have been inspecting the emergency equipment and preparing for the next call.',
      Prophet: 'I have been reflecting on the revelation and speaking with villagers about its meaning.',
    }
    const workDetail = agent.state.currentJob
      ? jobActivities[agent.state.currentJob] ?? `I have been handling my work as a ${agent.state.currentJob}.`
      : 'I have been deciding where I can be most useful around town.'
    const nextBlock = this.deps.getRemainingSchedule(agent.state.id)?.blocks[0]
    const nextPlan = nextBlock
      ? `After that, I plan to ${this.describePlannedAction(nextBlock)}.`
      : 'I have not settled on what I will do afterward.'
    const building = this.deps.world.getBuildingAt(
      Math.round(agent.state.position.x),
      Math.round(agent.state.position.y)
    )
    const weather = this.deps.simManager.getWeather()

    if (/what brings|why are you|what are you doing here/.test(lastLine)) {
      return building
        ? `I came to ${building.name} because it fits into my plans for the day. ${workDetail}`
        : `${workDetail} I was passing through this part of town before my next task.`
    }
    if (/work|working|job/.test(lastLine)) {
      return `${workDetail} ${nextPlan}`
    }
    if (/okay|all right|issues|problem|sorry/.test(lastLine)) {
      return `I'm all right, thanks for checking. ${workDetail} ${weather.hazardousOutdoors ? `The ${weather.condition} is making the day more complicated.` : 'The day has been manageable so far.'}`
    }
    if (/plan|today|later|next/.test(lastLine)) {
      return `${nextPlan} I would rather finish something useful than wander without a purpose.`
    }

    const turn = conversation?.exchanges.length ?? 0
    const alternatives = [
      `${workDetail} The ${weather.condition} weather is also affecting how I organize the rest of the day.`,
      `${nextPlan} I'm curious whether ${partner.state.name.split(' ')[0]} has noticed anything unusual around town.`,
      `I've been thinking about how quickly plans change in this town. ${workDetail}`,
    ]
    return alternatives[turn % alternatives.length]
  }

  describePlannedAction(action: AgentAction): string {
    const target = action.target ? ` ${action.target}` : ''
    const descriptions: Record<string, string> = {
      move: `head toward${target || ' another part of town'}`,
      talk: `speak with${target || ' someone nearby'}`,
      work: `continue working${target ? ` at${target}` : ''}`,
      rest: 'take a proper break',
      sleep: 'get some rest',
      eat: `find something to eat${target ? ` at${target}` : ''}`,
      gather: 'collect useful supplies',
      help: `help${target || ' someone who needs it'}`,
      build: 'work on a new structure',
      idle: 'take a quiet moment to think',
    }
    return descriptions[action.action] ?? `${action.action}${target}`
  }

  buildEncounterOpener(initiator: Agent, encountered: Agent, isKnown: boolean): string {
    const firstName = encountered.state.name.split(' ')[0]
    const greeting = Math.random() < 0.5 ? 'Hi' : 'Hello'
    const building = this.deps.world.getBuildingAt(
      Math.round(initiator.state.position.x),
      Math.round(initiator.state.position.y)
    )
    const priorConversations = this.deps.eventBus.getHistory().filter((event) =>
      event.type === 'conversation' &&
      ((event.agentId === initiator.state.id && event.targetId === encountered.state.id) ||
        (event.agentId === encountered.state.id && event.targetId === initiator.state.id))
    ).length

    if (priorConversations > 0) {
      const place = building ? ` here at ${building.name}` : ''
      const repeatOpeners = [
        `${greeting}, ${firstName}. Good to see you again${place}. Has anything changed since we last spoke?`,
        `${greeting}, ${firstName}. We keep crossing paths${place}; I was just thinking about how the day has unfolded.`,
        `${greeting}, ${firstName}. Since we last talked, have you noticed anything unusual around town?`,
      ]
      return repeatOpeners[(priorConversations - 1) % repeatOpeners.length]
    }

    if (building) {
      return `${greeting}, ${firstName}. What brings you to ${building.name} today?`
    }
    if (isKnown) {
      return `${greeting}, ${firstName}. What are you working on today?`
    }
    if (encountered.state.currentJob && encountered.state.currentJob !== 'Prophet') {
      return `${greeting}, ${firstName}. How is your work as a ${encountered.state.currentJob} going today?`
    }
    return `${greeting}, ${firstName}. What are your plans for today?`
  }

  findNearestAvailableSocialTarget(agent: Agent): Agent | undefined {
    return this.deps.getAgents()
      .filter((candidate) =>
        candidate.state.alive &&
        candidate.state.id !== agent.state.id &&
        !candidate.isConversationActive()
      )
      .sort((first, second) => agent.distanceTo(first.state) - agent.distanceTo(second.state))[0]
  }
}
