import { Agent } from '@/agent/Agent'
import {
  ActionType,
  AgentAction,
  AgentState,
  DecisionTrigger,
  EmotionalState,
  ForbiddenKnowledgeEntry,
  Rumour,
  RumourProvenance,
  SimulationEvent,
} from '@/types'
import { ExistentialReactionResult, ForbiddenKnowledgeClassification } from '@/ai/AIProvider'
import { classifyCourtEligibility, isCourtEligibleRumour, isCultRelatedRumour } from '@/utils/RumourRules'
import { classifyExistentialReactionFallback, classifyForbiddenKnowledgeFallback } from '@/utils/ForbiddenKnowledgeRules'
import { SystemDeps } from './SystemDeps'

export interface RumourState {
  rumourCounter: number
  naturalRumourKeys: Set<string>
  rumourMutationKeys: Set<string>
  lastRumourInventionMinute: Map<string, number>
  divineEvangelismKeys: Set<string>
}

export function createRumourState(): RumourState {
  return {
    rumourCounter: 0,
    naturalRumourKeys: new Set(),
    rumourMutationKeys: new Set(),
    lastRumourInventionMinute: new Map(),
    divineEvangelismKeys: new Set(),
  }
}

// Rumour/gossip/Investigation: inventing, spreading, believing, and
// investigating rumours -- including whispers, forbidden knowledge, and
// existential reactions. Investigation is folded into this file rather than
// split out: it has no state of its own and operates entirely on the
// `rumours` map and belief structures Rumour methods already own.
export class RumourSystem {
  constructor(private deps: SystemDeps, public readonly state: RumourState) {}

  public refreshRumourBeliefStances(): void {
    for (const rumour of this.deps.rumours.values()) {
      for (const belief of rumour.beliefs) {
        this.synchronizeBeliefStance(belief, rumour)
        const agent = this.deps.getAgents().find((candidate) => candidate.state.id === belief.agentId)
        if (agent) {
          this.applyTargetedRumourReaction(rumour, agent, belief)
          this.deps.updateAgentJusticeResponse(rumour, agent, belief)
          this.requireBelievedDivineRumourShare(agent, rumour, belief)
        }
      }
    }
  }

  public resolveRejectedRumours(): void {
    const livingIds = new Set(
      this.deps.getAgents().filter((agent) => agent.state.alive).map((agent) => agent.state.id)
    )
    const required = Math.floor(livingIds.size / 2) + 1
    if (livingIds.size === 0) return

    for (const rumour of this.deps.rumours.values()) {
      if (
        rumour.status === 'resolved' ||
        rumour.archived ||
        (rumour.resolutionCourt && rumour.resolutionCourt.status !== 'resolved')
      ) continue
      // Belief cannot dismiss a claim before it has had the opportunity to
      // reach everyone. Once a targeted claim has reached every living
      // villager, maybeStartResolutionCourt handles it first, regardless of
      // verification status, credibility, or anyone's belief stance.
      if (!Array.from(livingIds).every((agentId) => rumour.heardBy.includes(agentId))) continue
      const nonBelievers = new Set(
        rumour.beliefs
          .filter((belief) => livingIds.has(belief.agentId) && belief.stance === 'denier')
          .map((belief) => belief.agentId)
      )
      if (nonBelievers.size < required) continue

      rumour.status = 'resolved'
      rumour.resolvedAt = this.deps.getAbsoluteMinute()
      rumour.pendingFirstShareBy = []
      const formerRelatedIds = [...rumour.relatedRumourIds]
      rumour.relatedRumourIds = []
      for (const related of this.deps.rumours.values()) {
        related.relatedRumourIds = related.relatedRumourIds.filter((id) => id !== rumour.id)
      }

      this.deps.eventBus.emit({
        type: 'rumour_resolution',
        agentId: 'world',
        actionType: ActionType.IDLE,
        outcome: 'resolved_by_rejection',
        description: `The village dismissed "${rumour.text}" after ${nonBelievers.size} of ${livingIds.size} living villagers denied or did not believe it. It no longer contributes to related claims.`,
        causationIds: [],
        worldStateDelta: {
          rumourId: rumour.id,
          status: rumour.status,
          nonBelievers: nonBelievers.size,
          required,
          removedRelatedRumourIds: formerRelatedIds,
        },
        observers: [...livingIds],
      })
    }
  }

  public getRumourExpiryMinute(rumour: Rumour): number {
    if (rumour.status === 'resolved') return (rumour.resolvedAt ?? rumour.createdAt) + 1440
    if (rumour.status === 'verified' || rumour.status === 'unsubstantiated') {
      return (rumour.investigatedAt ?? rumour.createdAt) + 1440
    }
    return rumour.createdAt + 4320
  }

  public archiveExpiredRumours(): void {
    const now = this.deps.getAbsoluteMinute()
    for (const [rumourId, rumour] of this.deps.rumours) {
      if (rumour.archived) continue
      if (rumour.resolutionCourt && rumour.resolutionCourt.status !== 'resolved') continue
      if (rumour.status === 'resolved') {
        rumour.resolvedAt ??= now
      }
      if (now < this.getRumourExpiryMinute(rumour)) continue
      rumour.archived = true
      rumour.archivedAt = now
      rumour.timelineSummary = this.buildRumourTimelineSummary(rumour)
      rumour.pendingFirstShareBy = []
      for (const remaining of this.deps.rumours.values()) {
        remaining.relatedRumourIds = remaining.relatedRumourIds.filter((id) => id !== rumourId)
      }
      for (const [agentId, triggers] of this.deps.decisionQueue) {
        const filtered = triggers.filter((trigger) => trigger.rumourId !== rumourId)
        if (filtered.length > 0) this.deps.decisionQueue.set(agentId, filtered)
        else this.deps.decisionQueue.delete(agentId)
      }
    }
  }

  public buildRumourTimelineSummary(rumour: Rumour): string {
    const steps = [`Created ${this.deps.formatAbsoluteMinute(rumour.createdAt)}`]
    if (rumour.investigatedAt !== undefined) {
      steps.push(`Investigated (${rumour.status === 'verified' ? 'verified' : 'unsubstantiated'}) ${this.deps.formatAbsoluteMinute(rumour.investigatedAt)}`)
    }
    if (rumour.resolutionCourt?.resolution) {
      steps.push(`Court: ${rumour.resolutionCourt.resolution}`)
    } else if (rumour.resolvedAt !== undefined) {
      steps.push(`Resolved by consensus ${this.deps.formatAbsoluteMinute(rumour.resolvedAt)}`)
    }
    return steps.join(' · ')
  }

  public findAccusedAgent(rumour: Rumour): Agent | undefined {
    const text = rumour.text.toLowerCase()
    const target = this.deps.getAgents().find((agent) => {
      const fullName = agent.state.name.toLowerCase()
      const firstName = fullName.split(' ')[0]
      return text.includes(fullName) || new RegExp(`\\b${firstName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`).test(text)
    })
    if (target?.state.demon) return undefined
    return target
  }

  public getRelatedRumourCluster(seed: Rumour): Rumour[] {
    const cluster: Rumour[] = []
    const pending = [seed.id]
    const visited = new Set<string>()
    while (pending.length > 0) {
      const id = pending.shift()!
      if (visited.has(id)) continue
      visited.add(id)
      const rumour = this.deps.rumours.get(id)
      if (!rumour) continue
      cluster.push(rumour)
      for (const relatedId of rumour.relatedRumourIds) pending.push(relatedId)
    }
    return cluster
  }

  public hasPrioritySheriffRumour(agentId: string, triggers: DecisionTrigger[]): boolean {
    const agent = this.deps.getAgents().find((candidate) => candidate.state.id === agentId)
    return agent?.state.currentJob === 'Sheriff' && triggers.some(
      (trigger) => trigger.rumourId &&
        this.isRumourUnresolved(trigger.rumourId) &&
        this.isAgentUndecidedAboutRumour(agentId, trigger.rumourId)
    )
  }

  public isRumourUnresolved(rumourId: string): boolean {
    const rumour = this.deps.rumours.get(rumourId)
    if (!rumour || rumour.archived) return false
    return rumour.status === 'unverified' || rumour.status === 'investigating'
  }

  public isAgentUndecidedAboutRumour(agentId: string, rumourId: string): boolean {
    const rumour = this.deps.rumours.get(rumourId)
    if (!rumour) return false
    const belief = rumour.beliefs.find((candidate) => candidate.agentId === agentId)
    if (!belief) return true
    this.synchronizeBeliefStance(belief, rumour)
    return belief.stance === 'uncertain'
  }

  public buildRumourConversationContext(agent: Agent, partnerId: string | null): string {
    if (!partnerId) return ''
    const partner = this.deps.getAgents().find((candidate) => candidate.state.id === partnerId)
    if (!partner) return ''

    const shareable = Array.from(this.deps.rumours.values())
      .filter((rumour) =>
        rumour.status !== 'resolved' && !rumour.archived &&
        rumour.heardBy.includes(agent.state.id) &&
        (!rumour.heardBy.includes(partnerId) ||
          (rumour.findingHeardBy.includes(agent.state.id) && !rumour.findingHeardBy.includes(partnerId)))
      )
      .slice(-3)
    if (shareable.length === 0) return ''

    const lines = shareable.map((rumour) => {
      const knowsFinding = rumour.findingHeardBy.includes(agent.state.id)
      const belief = rumour.beliefs.find((candidate) => candidate.agentId === agent.state.id)
      const stance = belief?.extreme ? ` Your fixed stance: ${belief.stance}.` : ' Your stance: uncertain.'
      const required = rumour.pendingFirstShareBy.includes(agent.state.id) ? 'REQUIRED FIRST SHARE' : 'optional'
      return `- [${required}; ${knowsFinding ? rumour.status : 'unverified'}, credibility ${(rumour.credibility * 100).toFixed(0)}%] ${rumour.text} Claimed source: ${rumour.provenance.description}.${knowsFinding && rumour.finding ? ` Finding: ${rumour.finding}` : ''}${stance}`
    })
    return `
RUMOURS RELEVANT TO THIS CONVERSATION:
${lines.join('\n')}
If a claim is marked REQUIRED FIRST SHARE, weave its meaning naturally into your response to the partner's latest words. Paraphrase it in your own conversational voice; do not copy the claim verbatim, bolt it onto an unrelated sentence, or abruptly change subjects without a bridge. Mention at most one claim. Optional claims should appear only when they genuinely fit. Your fixed stance overrides evidence: a believer continues to insist it is true after an unsubstantiated finding, while a denier rejects it after verification. An uncertain agent follows the available evidence.
`
  }

  public buildBeliefActionContext(agent: Agent, rumourId: string): string {
    const rumour = this.deps.rumours.get(rumourId)
    if (!rumour) return ''
    const belief = this.getOrCreateRumourBelief(rumour, agent)
    const accused = this.findAccusedAgent(rumour)
    return `BELIEF-GROUNDED ACTION:\n- Claim: ${rumour.text}\n- Your stance: ${belief.stance}${belief.extreme ? ' (fixed)' : ''}; confidence ${Math.round((belief.confidence ?? rumour.credibility) * 100)}%.\n- Your justice response: ${belief.justiceResponse ?? 'gossip'}. This is your own assessment, not an objective label.\n- Directly implicated person: ${accused?.state.name ?? 'none identified'}.\n- Any attack or theft motivated by this claim must follow that stance and target only the directly implicated person.`
  }

  public attachHostileActionToBelief(
    agent: Agent,
    rumour: Rumour,
    decision: AgentAction
  ): void {
    if (decision.action !== 'attack' && decision.action !== 'steal') return
    const belief = this.getOrCreateRumourBelief(rumour, agent)
    const accused = this.findAccusedAgent(rumour)
    if (belief.stance === 'believer' && accused && accused.state.id !== agent.state.id) {
      decision.target = accused.state.name
      decision.reasoning = `${decision.reasoning} Acting against ${accused.state.name} because I believe the claim: "${rumour.text}".`
      return
    }

    decision.action = accused ? 'talk' : 'idle'
    decision.target = accused?.state.name ?? null
    decision.dialogue = accused
      ? `I heard a claim involving you, but I don't believe it enough to act against you.`
      : ''
    decision.durationMinutes = 5
    decision.reasoning = belief.stance === 'denier'
      ? `Refusing a hostile response because I reject the claim: "${rumour.text}".`
      : `Refusing a hostile response without a believed claim and a directly implicated target.`
  }

  public maybeAddRumourToConversation(agent: Agent, partner: Agent, decision: AgentAction): void {
    const candidates = Array.from(this.deps.rumours.values()).filter((rumour) =>
      rumour.status !== 'resolved' && !rumour.archived &&
      rumour.heardBy.includes(agent.state.id) &&
      (!rumour.heardBy.includes(partner.state.id) ||
        (rumour.findingHeardBy.includes(agent.state.id) && !rumour.findingHeardBy.includes(partner.state.id)))
    )
    if (candidates.length === 0) {
      const invented = this.maybeInventRumour(agent, partner)
      if (invented) this.ensureRumourMentioned(agent, decision, invented, false)
      return
    }

    const pending = candidates.filter((rumour) => rumour.pendingFirstShareBy.includes(agent.state.id))
    const rumour = pending[pending.length - 1] ?? candidates[candidates.length - 1]
    if (this.dialogueMentionsRumour(decision.dialogue ?? '', rumour)) return
    if (rumour.pendingFirstShareBy.includes(agent.state.id)) {
      this.ensureRumourMentioned(agent, decision, rumour, false)
      return
    }
    const authorityBoost = this.getInvestigationAuthority(partner, rumour) ? 0.25 : 0
    const propagationMultiplier = Math.max(
      0,
      this.deps.simManager.getConfig().rumourPropagationMultiplier
    )
    const chance = Math.min(
      1,
      (0.45 + agent.state.personality.friendliness * 0.25 + authorityBoost) * propagationMultiplier
    )
    if (Math.random() > chance) return
    this.ensureRumourMentioned(agent, decision, rumour)
  }

  public hasRumourPropagationOpportunity(first: Agent, second: Agent): boolean {
    return Array.from(this.deps.rumours.values()).some((rumour) => {
      if (rumour.status === 'resolved' || rumour.archived) return false
      const firstIntroducer = rumour.beliefs.find(
        (belief) => belief.agentId === first.state.id
      )?.heardFromAgentId
      const secondIntroducer = rumour.beliefs.find(
        (belief) => belief.agentId === second.state.id
      )?.heardFromAgentId
      const firstCanShare = rumour.heardBy.includes(first.state.id) && (
        !rumour.heardBy.includes(second.state.id) ||
        (rumour.pendingFirstShareBy.includes(first.state.id) && firstIntroducer !== second.state.id)
      )
      const secondCanShare = rumour.heardBy.includes(second.state.id) && (
        !rumour.heardBy.includes(first.state.id) ||
        (rumour.pendingFirstShareBy.includes(second.state.id) && secondIntroducer !== first.state.id)
      )
      return firstCanShare || secondCanShare
    })
  }

  public maybeInventRumour(agent: Agent, partner: Agent): Rumour | null {
    const now = this.deps.getAbsoluteMinute()
    const lastInvention = this.state.lastRumourInventionMinute.get(agent.state.id) ?? -Infinity
    if (now - lastInvention < 180) return null

    const chance = Math.max(
      0,
      Math.min(1, this.deps.simManager.getConfig().inventedRumourProbability)
    )
    if (Math.random() > chance) return null

    const buildings = Array.from(this.deps.world.buildings.values())
    const building = buildings[Math.floor(Math.random() * buildings.length)]
    const place = building?.name ?? 'Town Square'
    const partnerFirstName = partner.state.name.split(' ')[0]
    const weather = this.deps.simManager.getWeather().condition
    const claims = [
      `People have been seeing unusual activity near ${place} after dark.`,
      `Supplies may have been disappearing from ${place} without anyone reporting it.`,
      partner.state.currentJob === 'Prophet'
        ? `${partnerFirstName} may be considering a major change in their daily work.`
        : `${partnerFirstName} may be considering a major change to their work as a ${partner.state.currentJob ?? 'town resident'}.`,
      `The recent ${weather} weather may have damaged something important at ${place}.`,
      `Someone connected to ${place} may be keeping a serious problem quiet.`,

       // Cult / cultist rumours
      `Strange chanting has reportedly been heard near ${place} late at night.`,
      `Several villagers believe a secret cult has begun meeting somewhere near ${place}.`,
      `Someone claims to have seen hooded figures entering ${place} after midnight.`,
      `Unfamiliar symbols have reportedly appeared on the walls near ${place}.`,
      `A villager insists that cultists have been leaving offerings near ${place}.`,
      `People are whispering that someone connected to ${place} belongs to a forbidden sect.`,
      `${partnerFirstName} may have been seen speaking privately with suspected cultists near ${place}.`,
      `A secret gathering may have taken place at ${place} during the night.`,
      `Candles arranged in a strange pattern were reportedly discovered near ${place}.`,
      `Someone claims that livestock near ${place} have been marked with strange symbols.`,
      `A missing villager may have been seen following robed figures toward ${place}.`,
      `There are rumours that a hidden shrine has been constructed somewhere inside ${place}.`,
      `Someone connected to ${place} may be recruiting villagers into a secretive religious group.`,
      `A strange procession was reportedly seen moving toward ${place} before dawn.`,
      `Villagers have begun avoiding ${place} after hearing rumours of forbidden rituals.`,
      `An old symbol associated with heretics has supposedly been carved near the entrance to ${place}.`,
      `Someone claims that cultists are storing supplies beneath ${place}.`,
      `${partnerFirstName} may know more about the strange gatherings near ${place} than they have admitted.`,
      `The recent ${weather} weather exposed what some villagers believe is a hidden ritual site near ${place}.`,
      `A traveller claims that the symbols found near ${place} belong to a dangerous secret sect.`,
      `People have reported hearing bells from ${place} at hours when nobody should be there.`,
      `A villager says they saw masked figures carrying lanterns away from ${place}.`,
      `Someone may have been performing forbidden rites somewhere near ${place}.`,
      `Rumours suggest that a cult leader has recently arrived in the village.`,
      `Several residents believe disappearances around ${place} are connected to a hidden cult.`,
    ]
    const text = claims[Math.floor(Math.random() * claims.length)]
    const divineChance = Math.min(
      0.35,
      0.04 + agent.state.personality.creativity * 0.06 + agent.state.beliefSystem.faith / 500
    )
    const divine = Math.random() < divineChance
    const deityName = divine ? this.deps.chooseDeityName(agent) : undefined
    const provenance: RumourProvenance = divine
      ? {
          kind: 'divine',
          deityName,
          description: `${agent.state.name} believes ${deityName} revealed the message`,
        }
      : {
          kind: 'intuition',
          description: `${agent.state.name} formed the suspicion organically`,
        }
    const rumour = this.createRumour(
      text,
      'invented',
      agent.state.id,
      undefined,
      0.25,
      undefined,
      provenance
    )
    this.registerAgentCreatedRumour(rumour, agent, 'invented')
    this.state.lastRumourInventionMinute.set(agent.state.id, now)
    return rumour
  }

  public maybeMutateRumour(agent: Agent, parent: Rumour): Rumour {
    if (parent.parentRumourId || parent.status === 'resolved') return parent
    const mutationKey = `${parent.id}:${agent.state.id}`
    if (this.state.rumourMutationKeys.has(mutationKey)) return parent

    const multiplier = Math.max(0, this.deps.simManager.getConfig().rumourPropagationMultiplier)
    const chance = Math.min(0.3, (0.04 + agent.state.personality.creativity * 0.08) * multiplier)
    if (Math.random() > chance) return parent
    this.state.rumourMutationKeys.add(mutationKey)

    const escalations = [
      'Some people say it has happened more than once.',
      'The story now says more than one person may be involved.',
      'People are saying someone important may be covering it up.',
      'The latest version says the situation is more serious than first reported.',
    ]
    const softenings = [
      'Others now say it may have been a misunderstanding.',
      'The latest version says the situation may be less serious than first reported.',
      'Some people think there may be an innocent explanation.',
      'The story now says the original account may have exaggerated what happened.',
    ]
    const escalated = Math.random() < 0.5
    const variants = escalated ? escalations : softenings
    const base = parent.text.replace(/[.!?]+$/, '')
    const addition = variants[Math.floor(Math.random() * variants.length)]
    const mutated = this.createRumour(
      `${base}. ${addition}`,
      'mutated',
      agent.state.id,
      undefined,
      Math.max(0.1, parent.credibility - (escalated ? 0.1 : 0.05)),
      parent.id,
      parent.provenance.kind === 'divine'
        ? {
            kind: 'divine',
            deityName: parent.provenance.deityName,
            description: `${agent.state.name} ${escalated ? 'intensified' : 'softened'} a message attributed to ${parent.provenance.deityName ?? 'the divine'}`,
          }
        : {
            kind: 'mutation',
            description: `${agent.state.name} ${escalated ? 'made a story sound worse' : 'made a story sound less severe'} during a rumour-driven interaction`,
          }
    )
    this.registerAgentCreatedRumour(mutated, agent, 'mutated', parent)
    return mutated
  }

  public registerAgentCreatedRumour(
    rumour: Rumour,
    agent: Agent,
    kind: 'invented' | 'mutated',
    parent?: Rumour
  ): void {
    rumour.heardBy.push(agent.state.id)
    this.maybeRequireRumourShare(rumour, agent)
    const belief = this.getOrCreateRumourBelief(rumour, agent)
    belief.authored = true
    const parentBelief = parent?.beliefs.find((candidate) => candidate.agentId === agent.state.id)
    if (parentBelief) {
      belief.stance = parentBelief.stance
      belief.confidence = parentBelief.confidence
      belief.extreme = parentBelief.extreme
      belief.seeded = false
    } else {
      belief.stance = 'uncertain'
      belief.confidence = rumour.credibility
      belief.extreme = false
    }
    if (rumour.provenance.description.includes('interpreted a divine revelation into a new prophetic claim')) {
      belief.stance = 'believer'
      belief.confidence = Math.max(0.8, belief.confidence ?? rumour.credibility)
      belief.extreme = false
      belief.seeded = false
    }
    this.applyRumourProvenanceBelief(
      rumour,
      agent,
      belief,
      kind === 'invented' && rumour.provenance.kind === 'divine'
    )
    this.applyKnownRumourCorroboration(agent, rumour)

    const thought = kind === 'mutated'
      ? `The story may be bigger than I first heard: "${rumour.text}"`
      : `I have a suspicion worth mentioning, even though I have no proof: "${rumour.text}"`
    const event = this.deps.eventBus.emit({
      type: 'thought',
      agentId: agent.state.id,
      actionType: ActionType.IDLE,
      outcome: belief.stance,
      description: `${agent.state.name} thinks: ${thought}`,
      causationIds: [],
      worldStateDelta: {
        rumourId: rumour.id,
        origin: kind,
        parentRumourId: parent?.id,
      },
      observers: [agent.state.id],
    })
    agent.addRecentMemory(event)
  }

  public ensureRumourMentioned(
    agent: Agent,
    decision: AgentAction,
    rumour: Rumour,
    allowMutation = true
  ): void {
    if (this.dialogueMentionsRumour(decision.dialogue ?? '', rumour)) return
    // Whispers must be expressed by the LLM in the speaker's own voice. Keep
    // the first-share marker pending when it omits the topic instead of
    // mechanically appending the raw claim to otherwise unrelated dialogue.
    if (rumour.origin === 'whisper') return
    const spokenRumour = allowMutation ? this.maybeMutateRumour(agent, rumour) : rumour
    const lead = decision.dialogue?.trim()
    const knowsFinding = spokenRumour.findingHeardBy.includes(agent.state.id)
    const belief = this.getOrCreateRumourBelief(spokenRumour, agent)
    const authoredHere = spokenRumour.sourceAgentId === agent.state.id &&
      (spokenRumour.origin === 'invented' || spokenRumour.origin === 'mutated')
    const deityName = spokenRumour.provenance.deityName ?? 'the divine'
    const report = spokenRumour.provenance.kind === 'divine'
      ? belief.stance === 'denier'
        ? `People claim ${deityName} revealed that ${this.lowercaseFirst(spokenRumour.text)}, but I do not believe them.`
        : belief.stance === 'believer'
          ? `I believe ${deityName} revealed that ${this.lowercaseFirst(spokenRumour.text)}`
          : `I heard a claim that ${deityName} revealed that ${this.lowercaseFirst(spokenRumour.text)}, though I am unsure.`
      : authoredHere
      ? spokenRumour.origin === 'invented'
        ? `I have a suspicion that ${this.lowercaseFirst(spokenRumour.text)}, though I have no proof.`
        : `The story I heard may be bigger: ${this.lowercaseFirst(spokenRumour.text)}`
      : belief.stance === 'believer'
      ? knowsFinding && spokenRumour.status === 'unsubstantiated'
        ? `They say there is no evidence, but I am certain that ${this.lowercaseFirst(spokenRumour.text)}`
        : `I am convinced that ${this.lowercaseFirst(spokenRumour.text)}`
      : belief.stance === 'denier'
        ? knowsFinding && spokenRumour.status === 'verified'
          ? `I know they claim it was verified, but I refuse to believe that ${this.lowercaseFirst(spokenRumour.text)}`
          : `I heard the claim that ${this.lowercaseFirst(spokenRumour.text)}, but I do not believe it.`
        : knowsFinding && spokenRumour.status === 'verified'
          ? `It was checked and confirmed that ${this.lowercaseFirst(spokenRumour.text)}`
          : knowsFinding && spokenRumour.status === 'unsubstantiated'
            ? `Someone checked that story about ${this.lowercaseFirst(spokenRumour.text)}, but could not substantiate it.`
            : `I heard that ${this.lowercaseFirst(spokenRumour.text)}, though I do not know if it is true.`
    decision.dialogue = lead ? `${lead} ${report}` : report
    decision.reasoning = `${agent.state.name} is passing on a relevant rumour as unverified information`
  }

  public ensurePendingRumourShare(agent: Agent, partner: Agent, decision: AgentAction): void {
    const rumour = [...this.deps.rumours.values()].reverse().find((candidate) =>
      candidate.pendingFirstShareBy.includes(agent.state.id) &&
      candidate.heardBy.includes(agent.state.id) &&
      candidate.beliefs.find((belief) => belief.agentId === agent.state.id)?.heardFromAgentId !== partner.state.id
    )
    if (!rumour) return
    if (rumour.origin === 'whisper') return
    this.ensureRumourMentioned(agent, decision, rumour, false)
  }

  public maybeRequireRumourShare(rumour: Rumour, agent: Agent): void {
    if (rumour.pendingFirstShareBy.includes(agent.state.id)) return
    const propagationMultiplier = Math.max(
      0,
      this.deps.simManager.getConfig().rumourPropagationMultiplier
    )
    const socialNeed = (100 - agent.state.needs.social) / 100
    const chance = Math.min(
      1,
      (0.25 + agent.state.personality.friendliness * 0.2 + socialNeed * 0.25) *
        propagationMultiplier
    )
    if (Math.random() <= chance) {
      rumour.pendingFirstShareBy.push(agent.state.id)
    }
  }

  public requireBelievedDivineRumourShare(
    agent: Agent,
    rumour: Rumour,
    belief: Rumour['beliefs'][number]
  ): void {
    if (
      rumour.provenance.kind !== 'divine' ||
      belief.stance !== 'believer' ||
      !rumour.heardBy.includes(agent.state.id)
    ) return
    const key = `${rumour.id}:${agent.state.id}`
    if (this.state.divineEvangelismKeys.has(key)) return
    this.state.divineEvangelismKeys.add(key)
    if (!rumour.pendingFirstShareBy.includes(agent.state.id)) {
      rumour.pendingFirstShareBy.push(agent.state.id)
    }

    const deityName = rumour.provenance.deityName ?? 'The Divine'
    const event = this.deps.eventBus.emit({
      type: 'divine_evangelism',
      agentId: agent.state.id,
      actionType: ActionType.TALK,
      outcome: 'must_share',
      description: `${agent.state.name} believes the message came from ${deityName} and feels compelled to spread it: "${rumour.text}"`,
      causationIds: [],
      worldStateDelta: { rumourId: rumour.id, deityName },
      observers: [agent.state.id],
    })
    agent.addRecentMemory(event)
  }

  public dialogueMentionsRumour(dialogue: string, rumour: Rumour): boolean {
    const dialogueTokens = this.significantTokens(dialogue)
    const rumourTokens = this.significantTokens(rumour.text)
    if (dialogueTokens.size === 0 || rumourTokens.size === 0) return false
    let overlap = 0
    for (const token of rumourTokens) {
      if (dialogueTokens.has(token)) overlap++
    }
    return overlap >= Math.min(3, Math.max(2, Math.ceil(rumourTokens.size * 0.35)))
  }

  public significantTokens(text: string): Set<string> {
    const ignored = new Set(['about', 'after', 'again', 'been', 'from', 'have', 'heard', 'into', 'just', 'that', 'their', 'there', 'they', 'this', 'town', 'with', 'would'])
    return new Set(
      text.toLowerCase().match(/[a-z0-9]+/g)?.filter((token) => token.length >= 4 && !ignored.has(token)) ?? []
    )
  }

  public lowercaseFirst(text: string): string {
    return text.length > 0 ? text[0].toLowerCase() + text.slice(1) : text
  }

  public maybeCreateNaturalRumour(event: SimulationEvent): void {
    const eligible =
      (event.type === 'attack' && event.outcome === 'injury') ||
      (event.type === 'theft' && event.outcome === 'success') ||
      (event.type === 'death' && event.outcome === 'death') ||
      (event.type === 'destroy_building' && event.outcome === 'destroyed')
    if (!eligible) return

    // Each recorded incident creates its own event-backed belief, including
    // repeated attacks involving the same villagers on the same day.
    const key = event.id
    if (this.state.naturalRumourKeys.has(key)) return
    this.state.naturalRumourKeys.add(key)

    const rumour = this.createRumour(
      event.description,
      'natural',
      event.agentId,
      event.id,
      0.8
    )
    const source = this.deps.getAgents().find((agent) => agent.state.id === event.agentId)
    const recipients = this.deps.getAgents().filter((agent) => {
      if (!agent.state.alive) return false
      if (agent.state.id === event.agentId) return false
      if (agent.state.id === event.targetId) return true
      return source ? agent.distanceTo(source.state) <= 8 : false
    })
    for (const recipient of recipients) {
      const directAttackExperience = event.type === 'attack' && recipient.state.id === event.targetId
      this.deliverRumour(rumour, recipient, event.agentId, [event.id], false, directAttackExperience)
    }
  }

  public maybeSpreadRumour(event: SimulationEvent): void {
    if (!event.targetId) return
    const speaker = this.deps.getAgents().find((agent) => agent.state.id === event.agentId)
    const listener = this.deps.getAgents().find((agent) => agent.state.id === event.targetId)
    if (!speaker || !listener || !listener.state.alive) return

    const dialogue = event.description.match(/: "([\s\S]*)"$/)?.[1] ?? ''
    const mentioned = Array.from(this.deps.rumours.values()).filter((rumour) =>
      rumour.status !== 'resolved' && !rumour.archived &&
      rumour.heardBy.includes(speaker.state.id) &&
      this.dialogueMentionsRumour(dialogue, rumour)
    )
    for (const rumour of mentioned) {
      const introducingSource = rumour.beliefs.find(
        (belief) => belief.agentId === speaker.state.id
      )?.heardFromAgentId
      if (introducingSource !== listener.state.id) {
        rumour.pendingFirstShareBy = rumour.pendingFirstShareBy.filter((id) => id !== speaker.state.id)
      }
    }
    const candidates = mentioned.filter((rumour) =>
      !rumour.heardBy.includes(listener.state.id) ||
      (rumour.findingHeardBy.includes(speaker.state.id) && !rumour.findingHeardBy.includes(listener.state.id))
    )
    if (candidates.length === 0) return

    const rumour = candidates[candidates.length - 1]
    rumour.transmissions++
    this.applySourceCredibility(rumour, speaker)
    if (!rumour.heardBy.includes(listener.state.id)) {
      this.deliverRumour(rumour, listener, speaker.state.id, [event.id])
    }
    if (rumour.findingHeardBy.includes(speaker.state.id) && !rumour.findingHeardBy.includes(listener.state.id)) {
      this.deliverRumourFinding(rumour, listener, speaker.state.id, [event.id])
    }
  }

  public createRumour(
    text: string,
    origin: Rumour['origin'],
    sourceAgentId?: string,
    sourceEventId?: string,
    credibility = 0.5,
    parentRumourId?: string,
    provenance?: RumourProvenance
  ): Rumour {
    const rumour: Rumour = {
      id: `rumour_${this.state.rumourCounter++}`,
      text: text.trim(),
      origin,
      groundTruth: origin === 'whisper' ? false : undefined,
      courtEligible: classifyCourtEligibility(text),
      parentRumourId,
      provenance: provenance ?? this.defaultRumourProvenance(origin, sourceAgentId),
      sourceAgentId,
      sourceEventId,
      createdAt: this.deps.simManager.getSimTime(),
      credibility,
      credibilitySourceIds: [],
      relatedRumourIds: [],
      heardBy: [],
      pendingFirstShareBy: [],
      transmissions: 0,
      responses: [],
      status: 'unverified',
      investigatorIds: [],
      findingHeardBy: [],
      beliefs: [],
    }
    const source = sourceAgentId
      ? this.deps.getAgents().find((agent) => agent.state.id === sourceAgentId)
      : undefined
    if (source) this.applySourceCredibility(rumour, source)
    this.deps.rumours.set(rumour.id, rumour)
    this.linkRelatedRumours(rumour)
    if (this.deps.rumours.size > 50) {
      const archivedCandidates = Array.from(this.deps.rumours.values())
        .filter((candidate) => candidate.archived)
        .sort((first, second) => (first.archivedAt ?? first.createdAt) - (second.archivedAt ?? second.createdAt))
      const resolvedCandidates = Array.from(this.deps.rumours.values())
        .filter((candidate) => !candidate.archived && candidate.status === 'resolved')
        .sort((first, second) => (first.resolvedAt ?? first.createdAt) - (second.resolvedAt ?? second.createdAt))
      const replaceable = archivedCandidates[0] ?? resolvedCandidates[0]
      const oldestId = replaceable?.id ?? this.deps.rumours.keys().next().value
      if (oldestId && oldestId !== rumour.id) {
        this.deps.rumours.delete(oldestId)
        for (const remaining of this.deps.rumours.values()) {
          remaining.relatedRumourIds = remaining.relatedRumourIds.filter((id) => id !== oldestId)
        }
      }
    }
    return rumour
  }

  public defaultRumourProvenance(
    origin: Rumour['origin'],
    sourceAgentId?: string
  ): RumourProvenance {
    const source = sourceAgentId
      ? this.deps.getAgents().find((agent) => agent.state.id === sourceAgentId)
      : undefined
    if (origin === 'natural') {
      return { kind: 'event', description: 'A witnessed or recorded town event' }
    }
    if (origin === 'invented') {
      return {
        kind: 'intuition',
        description: `${source?.state.name ?? 'Someone'} formed the idea from intuition`,
      }
    }
    if (origin === 'mutated') {
      return {
        kind: 'mutation',
        description: `${source?.state.name ?? 'Someone'} embellished an existing story`,
      }
    }
    return { kind: 'anonymous', description: 'An unexplained whisper' }
  }

  public applySourceCredibility(rumour: Rumour, source: Agent): void {
    if (rumour.credibilitySourceIds.includes(source.state.id)) return
    rumour.credibilitySourceIds.push(source.state.id)

    const sourceReliability = Math.max(0, Math.min(1, source.state.reputation / 100))
    const adjustment = (sourceReliability - 0.5) * 0.4
    rumour.credibility = Math.max(0.05, Math.min(0.95, rumour.credibility + adjustment))
  }

  public linkRelatedRumours(rumour: Rumour): void {
    for (const existing of this.deps.rumours.values()) {
      if (rumour.status === 'resolved' || existing.status === 'resolved') continue
      if (rumour.archived || existing.archived) continue
      if (existing.id === rumour.id || existing.relatedRumourIds.includes(rumour.id)) continue
      if (!this.areRumoursRelated(rumour, existing)) continue

      const sharedTargets = this.getRumourTargetKeys(rumour)
      const existingTargets = this.getRumourTargetKeys(existing)
      const sharedTargetCount = [...sharedTargets].filter((target) => existingTargets.has(target)).length
      const credibilityBoost = sharedTargetCount > 0 ? 0.15 : 0.1
      rumour.relatedRumourIds.push(existing.id)
      existing.relatedRumourIds.push(rumour.id)
      rumour.credibility = Math.min(0.95, rumour.credibility + credibilityBoost)
      existing.credibility = Math.min(0.95, existing.credibility + credibilityBoost)

      for (const agent of this.deps.getAgents()) {
        if (rumour.heardBy.includes(agent.state.id) && existing.heardBy.includes(agent.state.id)) {
          this.reinforceAgentBeliefFromRelatedRumour(agent, rumour, existing, sharedTargetCount > 0)
        }
      }

      this.deps.eventBus.emit({
        type: 'rumour_corroboration',
        agentId: rumour.sourceAgentId ?? existing.sourceAgentId ?? 'world',
        actionType: ActionType.IDLE,
        outcome: 'related',
        description: `${sharedTargetCount > 0 ? 'Multiple rumours pointed to the same target' : 'Related rumours corroborated each other'}: "${existing.text}" and "${rumour.text}"`,
        causationIds: [existing.sourceEventId, rumour.sourceEventId].filter((id): id is string => Boolean(id)),
        worldStateDelta: {
          rumourIds: [existing.id, rumour.id],
          credibilityBoost,
          sharedTargetCount,
        },
        observers: [...new Set([...existing.heardBy, ...rumour.heardBy])],
      })
    }
  }

  public areRumoursRelated(first: Rumour, second: Rumour): boolean {
    if (first.sourceEventId && first.sourceEventId === second.sourceEventId) return true
    const firstTargets = this.getRumourTargetKeys(first)
    const secondTargets = this.getRumourTargetKeys(second)
    if ([...firstTargets].some((target) => secondTargets.has(target))) return true
    const firstTokens = this.significantTokens(first.text)
    const secondTokens = this.significantTokens(second.text)
    if (firstTokens.size === 0 || secondTokens.size === 0) return false

    let overlap = 0
    for (const token of firstTokens) {
      if (secondTokens.has(token)) overlap++
    }
    const smallerClaimSize = Math.min(firstTokens.size, secondTokens.size)
    return overlap >= 2 && overlap / smallerClaimSize >= 0.4
  }

  public getRumourTargetKeys(rumour: Rumour): Set<string> {
    const text = rumour.text.toLowerCase()
    const targets = new Set<string>()
    for (const agent of this.deps.getAgents()) {
      const fullName = agent.state.name.toLowerCase()
      const firstName = fullName.split(' ')[0]
      if (text.includes(fullName) || new RegExp(`\\b${firstName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`).test(text)) {
        targets.add(`agent:${agent.state.id}`)
      }
    }
    for (const building of this.deps.world.buildings.values()) {
      if (text.includes(building.name.toLowerCase())) targets.add(`building:${building.id}`)
    }
    if (rumour.sourceEventId) {
      const sourceEvent = this.deps.eventBus.getHistory().find((event) => event.id === rumour.sourceEventId)
      if (sourceEvent?.targetId) targets.add(`event-target:${sourceEvent.targetId}`)
    }
    return targets
  }

  public applyTargetedRumourReaction(
    rumour: Rumour,
    agent: Agent,
    belief: Rumour['beliefs'][number]
  ): void {
    const sourceEvent = rumour.origin === 'natural' && rumour.sourceEventId
      ? this.deps.eventBus.getHistory().find((event) => event.id === rumour.sourceEventId)
      : undefined
    const isDirectVictim = sourceEvent?.targetId === agent.state.id &&
      ['attack', 'theft', 'help'].includes(sourceEvent.type)
    if (isDirectVictim) {
      // A direct participant does not doubt an event they personally
      // experienced merely because their name is present in its description.
      belief.selfTargeted = false
      belief.stance = 'believer'
      belief.confidence = 1
      belief.extreme = false
      belief.seeded = false
      return
    }

    // Self-denial applies to the person accused of conduct, not every person
    // named in the claim (particularly not its victim).
    const accused = this.findAccusedAgent(rumour)
    if (accused?.state.id !== agent.state.id) return
    const authored = belief.authored === true || (
      rumour.sourceAgentId === agent.state.id && (rumour.origin === 'invented' || rumour.origin === 'mutated')
    )
    if (authored) {
      belief.authored = true
      belief.selfTargeted = false
      if (rumour.provenance.description.includes('interpreted a divine revelation into a new prophetic claim')) {
        belief.stance = 'believer'
        belief.confidence = Math.max(0.8, belief.confidence ?? rumour.credibility)
        belief.extreme = false
        belief.seeded = false
      }
      return
    }

    belief.selfTargeted = true
    const acceptedConsensus = belief.selfBeliefFromConsensus === true
    if (belief.selfBeliefConsensusChecked) {
      belief.stance = acceptedConsensus ? 'believer' : 'denier'
      belief.confidence = acceptedConsensus ? 0.75 : 0.1
      belief.extreme = false
      belief.seeded = false
      return
    }

    // A person named by gossip initially rejects it, regardless of its source
    // or credibility. Only broad social consensus gives it a one-time chance
    // to become an internalized false belief.
    belief.stance = 'denier'
    belief.confidence = 0.1
    belief.extreme = false
    belief.seeded = false

    const eligibleOthers = this.deps.getAgents().filter(
      (candidate) => candidate.state.alive && candidate.state.id !== agent.state.id
    )
    const believers = rumour.beliefs.filter((candidate) =>
      candidate.agentId !== agent.state.id &&
      candidate.stance === 'believer' &&
      eligibleOthers.some((other) => other.state.id === candidate.agentId)
    ).length
    const required = Math.ceil(eligibleOthers.length * 0.6)
    if (required === 0 || believers < required) return

    belief.selfBeliefConsensusChecked = true
    belief.selfBeliefFromConsensus = Math.random() < 0.08
    if (!belief.selfBeliefFromConsensus) return

    belief.stance = 'believer'
    belief.confidence = 0.75
    const event = this.deps.eventBus.emit({
      type: 'thought',
      agentId: agent.state.id,
      actionType: ActionType.IDLE,
      outcome: 'internalized_rumour',
      description: `${agent.state.name} begins to doubt their own denial after ${believers} other villagers accepted the rumour: "${rumour.text}"`,
      causationIds: [],
      worldStateDelta: {
        rumourId: rumour.id,
        believers,
        required,
        stance: belief.stance,
      },
      observers: [agent.state.id],
    })
    agent.addRecentMemory(event)
    this.deps.enqueueDecision(agent.state.id, {
      type: 'rumour',
      description: `So many villagers believe the rumour about you that you have begun to internalize it as true: "${rumour.text}"`,
      eventId: event.id,
      rumourId: rumour.id,
      causationIds: [event.id],
    })
  }

  public reinforceAgentBeliefFromRelatedRumour(
    agent: Agent,
    first: Rumour,
    second: Rumour,
    sharedTarget: boolean
  ): void {
    const boost = sharedTarget ? 0.35 : 0.18
    for (const rumour of [first, second]) {
      const belief = this.getOrCreateRumourBelief(rumour, agent)
      if (belief.extreme) continue
      const startingConfidence = belief.confidence ?? (
        belief.stance === 'believer' ? 0.8 : belief.stance === 'denier' ? 0.2 : rumour.credibility
      )
      belief.confidence = Math.min(1, startingConfidence + boost)
      this.synchronizeBeliefStance(belief, rumour)
    }
  }

  public applyKnownRumourCorroboration(agent: Agent, rumour: Rumour): void {
    for (const relatedId of rumour.relatedRumourIds) {
      const related = this.deps.rumours.get(relatedId)
      if (!related?.heardBy.includes(agent.state.id)) continue
      const targets = this.getRumourTargetKeys(rumour)
      const relatedTargets = this.getRumourTargetKeys(related)
      this.reinforceAgentBeliefFromRelatedRumour(
        agent,
        rumour,
        related,
        [...targets].some((target) => relatedTargets.has(target))
      )
    }
    this.maybeMergeRelatedRumours(agent, rumour)
  }

  public maybeMergeRelatedRumours(agent: Agent, newlyHeard: Rumour): void {
    // Merged branches do not recursively merge during their own creation.
    if (newlyHeard.parentRumourId || newlyHeard.status === 'resolved') return
    const candidates = newlyHeard.relatedRumourIds
      .map((id) => this.deps.rumours.get(id))
      .filter((candidate): candidate is Rumour => Boolean(
        candidate &&
        !candidate.parentRumourId &&
        candidate.status !== 'resolved' &&
        candidate.heardBy.includes(agent.state.id)
      ))

    for (const related of candidates) {
      const pair = [newlyHeard.id, related.id].sort()
      const mergeKey = `merge:${pair[0]}:${pair[1]}`
      if (this.state.rumourMutationKeys.has(mergeKey)) continue
      const existingMerge = Array.from(this.deps.rumours.values()).some((candidate) =>
        candidate.origin === 'mutated' &&
        pair.every((parentId) =>
          candidate.parentRumourId === parentId || candidate.relatedRumourIds.includes(parentId)
        )
      )
      if (existingMerge) {
        this.state.rumourMutationKeys.add(mergeKey)
        continue
      }
      const multiplier = Math.max(0, this.deps.simManager.getConfig().rumourPropagationMultiplier)
      const chance = Math.min(
        0.35,
        (0.03 + agent.state.personality.creativity * 0.1 + agent.state.personality.curiosity * 0.05) * multiplier
      )
      if (Math.random() > chance) continue
      this.state.rumourMutationKeys.add(mergeKey)

      const firstText = newlyHeard.text.replace(/[.!?]+$/, '')
      const secondText = this.lowercaseFirst(related.text.replace(/[.!?]+$/, ''))
      const merged = this.createRumour(
        `${firstText}. People now connect this with the claim that ${secondText}; both may be part of the same situation.`,
        'mutated',
        agent.state.id,
        undefined,
        Math.max(0.1, (newlyHeard.credibility + related.credibility) / 2 - 0.08),
        newlyHeard.id,
        {
          kind: 'mutation',
          description: `${agent.state.name} merged two related stories into a new combined claim`,
        }
      )
      for (const parent of [newlyHeard, related]) {
        if (!merged.relatedRumourIds.includes(parent.id)) merged.relatedRumourIds.push(parent.id)
        if (!parent.relatedRumourIds.includes(merged.id)) parent.relatedRumourIds.push(merged.id)
      }
      this.registerAgentCreatedRumour(merged, agent, 'mutated', newlyHeard)
      return
    }
  }

  public getOrCreateRumourBelief(rumour: Rumour, agent: Agent): Rumour['beliefs'][number] {
    const existing = rumour.beliefs.find((belief) => belief.agentId === agent.state.id)
    if (existing) {
      this.synchronizeBeliefStance(existing, rumour)
      return existing
    }

    const extremeProbability = Math.max(
      0,
      Math.min(1, this.deps.simManager.getConfig().rumourExtremeBeliefProbability)
    )
    const extreme = Math.random() < extremeProbability
    const beliefBias = Math.max(
      0.2,
      Math.min(0.8, 0.5 + (agent.state.personality.curiosity - agent.state.personality.caution) * 0.3)
    )
    const belief: Rumour['beliefs'][number] = {
      agentId: agent.state.id,
      stance: extreme ? (Math.random() < beliefBias ? 'believer' : 'denier') : 'uncertain',
      confidence: extreme ? undefined : rumour.credibility,
      extreme,
      formedAt: this.deps.simManager.getSimTime(),
      perceivedSource: rumour.provenance.description,
    }
    rumour.beliefs.push(belief)
    this.synchronizeBeliefStance(belief, rumour)
    return belief
  }

  public synchronizeBeliefStance(
    belief: Rumour['beliefs'][number],
    rumour: Rumour
  ): void {
    if (belief.extreme || belief.seeded) return
    belief.confidence = Math.max(
      0,
      Math.min(1, belief.confidence ?? (
        belief.stance === 'believer'
          ? 0.8
          : belief.stance === 'denier'
            ? 0.2
            : rumour.credibility
      ))
    )
    belief.stance = belief.confidence >= 0.55
      ? 'believer'
      : belief.confidence <= 0.3
        ? 'denier'
        : 'uncertain'
  }

  public applyRumourProvenanceBelief(
    rumour: Rumour,
    agent: Agent,
    belief: Rumour['beliefs'][number],
    forceAcceptance = false
  ): void {
    belief.perceivedSource = rumour.provenance.description
    if (rumour.origin === 'whisper' && agent.state.beliefSystem.religiousStance === 'atheist') {
      belief.stance = 'denier'
      belief.confidence = 0
      belief.extreme = true
      belief.seeded = false
      belief.perceivedSource = 'Rejected as a false whisper because the recipient is an atheist'
      return
    }
    if (rumour.provenance.kind !== 'divine') return

    const acceptanceChance = Math.min(
      1,
      0.1 + agent.state.beliefSystem.faith / 125 + rumour.credibility * 0.2
    )
    const worldviewFactor = agent.state.beliefSystem.religiousStance === 'believer'
      ? 1
      : agent.state.beliefSystem.religiousStance === 'nonbeliever'
        ? 0.45
        : agent.state.beliefSystem.religiousStance === 'atheist'
          ? 0.12
          : 0.7
    const accepts = forceAcceptance || (agent.state.beliefSystem.religiousStance === 'believer'
      ? belief.stance === 'believer' ||
        (belief.stance === 'uncertain' && Math.random() < acceptanceChance)
      : Math.random() < acceptanceChance * worldviewFactor)
    if (!accepts) {
      if (belief.stance === 'denier') {
        agent.state.beliefSystem.faith = Math.max(0, agent.state.beliefSystem.faith - 3)
        if (agent.state.beliefSystem.religiousStance === 'undecided') {
          agent.state.beliefSystem.religiousStance = agent.state.beliefSystem.faith <= 5 && Math.random() < 0.35
            ? 'atheist'
            : 'nonbeliever'
        }
      }
      return
    }

    if (belief.stance === 'uncertain') belief.stance = 'believer'
    agent.state.beliefSystem.religiousStance = 'believer'
    if (!belief.extreme) belief.confidence = Math.max(0.75, belief.confidence ?? 0.5)
    agent.state.beliefSystem.faith = Math.min(
      100,
      agent.state.beliefSystem.faith + (forceAcceptance ? 18 : 6)
    )
    const deityName = rumour.provenance.deityName ?? 'The Divine'
    let deity = agent.state.beliefSystem.deities.find((candidate) => candidate.name === deityName)
    if (!deity) {
      deity = { name: deityName, confidence: forceAcceptance ? 70 : 45, revelationCount: 0 }
      agent.state.beliefSystem.deities.push(deity)
    }
    deity.revelationCount++
    deity.confidence = Math.min(100, deity.confidence + (forceAcceptance ? 15 : 8))
    const wasAlreadyProphet = this.deps.getProphetAgentId() === agent.state.id
    this.deps.maybeAppointProphet(agent, rumour, deityName)
    if (wasAlreadyProphet && forceAcceptance) {
      this.deps.queuePropheticInterpretation(agent, rumour, deityName)
    }
  }

  public reviseBeliefFromFinding(rumour: Rumour, agent: Agent): void {
    const belief = this.getOrCreateRumourBelief(rumour, agent)
    if (!belief.extreme && !belief.seeded) {
      belief.stance = rumour.status === 'verified' ? 'believer' : 'denier'
      belief.confidence = rumour.status === 'verified' ? 1 : 0
    }
    if (rumour.provenance.kind !== 'divine' || belief.extreme || belief.seeded) return

    const deityName = rumour.provenance.deityName ?? 'The Divine'
    const deity = agent.state.beliefSystem.deities.find((candidate) => candidate.name === deityName)
    const delta = rumour.status === 'verified' ? 4 : -6
    agent.state.beliefSystem.faith = Math.max(
      0,
      Math.min(100, agent.state.beliefSystem.faith + delta)
    )
    if (deity) deity.confidence = Math.max(0, Math.min(100, deity.confidence + delta * 2))
    if (agent.state.beliefSystem.religiousStance === 'undecided') {
      if (rumour.status === 'verified') {
        agent.state.beliefSystem.religiousStance = 'believer'
        agent.state.beliefSystem.faith = Math.max(25, agent.state.beliefSystem.faith)
      } else {
        agent.state.beliefSystem.religiousStance = agent.state.beliefSystem.faith <= 5 && Math.random() < 0.5
          ? 'atheist'
          : 'nonbeliever'
      }
    }
  }

  public addRumourThought(
    rumour: Rumour,
    agent: Agent,
    causationIds: string[],
    learnedFinding = false
  ): SimulationEvent {
    const belief = this.getOrCreateRumourBelief(rumour, agent)
    let thought: string
    if (belief.stance === 'believer') {
      thought = learnedFinding && rumour.status === 'unsubstantiated'
        ? `I still completely believe "${rumour.text}"; the investigation must have missed something.`
        : learnedFinding && rumour.status === 'verified'
          ? `The investigation confirms "${rumour.text}", so I accept it as true.`
          : `I completely believe "${rumour.text}" and will treat it as true.`
    } else if (belief.stance === 'denier') {
      thought = learnedFinding && rumour.status === 'verified'
        ? `I still refuse to believe "${rumour.text}" despite the investigation's evidence.`
        : `I reject "${rumour.text}" and do not believe it happened.`
    } else if (learnedFinding) {
      thought = rumour.status === 'verified'
        ? `The evidence confirms "${rumour.text}", so I now accept it as true.`
        : `No evidence supported "${rumour.text}", so I no longer consider it credible.`
    } else {
      thought = `I heard "${rumour.text}", but I am uncertain whether it is true; its current credibility is ${(rumour.credibility * 100).toFixed(0)}%.`
    }
    if (rumour.provenance.kind === 'divine') {
      const deity = rumour.provenance.deityName ?? 'the divine'
      thought += belief.stance === 'believer'
        ? ` I believe this message came from ${deity}.`
        : belief.stance === 'denier'
          ? ` I also reject the claim that ${deity} sent it.`
          : ` It is said to have come from ${deity}, but I am unsure.`
    } else if (rumour.provenance.kind === 'intuition') {
      thought += ' This appears to have begun as someone’s intuition rather than witnessed evidence.'
    }

    const thoughtEvent = this.deps.eventBus.emit({
      type: 'thought',
      agentId: agent.state.id,
      actionType: ActionType.IDLE,
      outcome: belief.stance,
      description: `${agent.state.name} thinks: ${thought}`,
      causationIds,
      worldStateDelta: {
        rumourId: rumour.id,
        stance: belief.stance,
        extreme: belief.extreme,
        seeded: belief.seeded ?? false,
        perceivedSource: belief.perceivedSource,
      },
      observers: [agent.state.id],
    })
    agent.addRecentMemory(thoughtEvent)
    return thoughtEvent
  }

  public deliverRumour(
    rumour: Rumour,
    recipient: Agent,
    sourceAgentId: string,
    causationIds: string[],
    forceSeedBelief = false,
    directExperience = false
  ): void {
    if (recipient.state.demon) return
    if (rumour.heardBy.includes(recipient.state.id)) return
    rumour.heardBy.push(recipient.state.id)
    this.maybeRequireRumourShare(rumour, recipient)

    const source = directExperience
      ? undefined
      : this.deps.getAgents().find((agent) => agent.state.id === sourceAgentId)
    const sourceContext = directExperience
      ? 'their own direct experience'
      : source
      ? `${source.state.name} (reputation ${Math.round(source.state.reputation)}/100)`
      : 'a whisper with no known source'
    const provenanceContext = rumour.provenance.description
    const deliveryEvent = this.deps.eventBus.emit({
      type: 'rumour',
      agentId: directExperience ? recipient.state.id : sourceAgentId,
      actionType: directExperience ? ActionType.IDLE : ActionType.TALK,
      targetId: recipient.state.id,
      outcome: directExperience ? 'experienced' : 'heard',
      description: directExperience
        ? `${recipient.state.name} formed a belief from personally experiencing the recorded event: "${rumour.text}"`
        : `${recipient.state.name} heard from ${sourceContext}: "${rumour.text}" (claimed origin: ${provenanceContext}; credibility ${(rumour.credibility * 100).toFixed(0)}%)`,
      causationIds,
      worldStateDelta: { rumourId: rumour.id, credibility: rumour.credibility },
      observers: [recipient.state.id],
    })
    recipient.addRecentMemory(deliveryEvent)
    const belief = this.getOrCreateRumourBelief(rumour, recipient)
    belief.heardFromAgentId = directExperience ? undefined : sourceAgentId
    if (directExperience) {
      belief.stance = 'believer'
      belief.confidence = 1
      belief.extreme = false
      belief.seeded = false
      belief.perceivedSource = 'Direct personal experience of a recorded event'
    }
    const atheistRejectsWhisper = forceSeedBelief &&
      recipient.state.beliefSystem.religiousStance === 'atheist'
    if (atheistRejectsWhisper) {
      belief.stance = 'denier'
      belief.confidence = 0
      belief.extreme = true
      belief.seeded = false
      belief.perceivedSource = 'Rejected as false because the recipient does not believe in God or divine commands'
    } else if (forceSeedBelief) {
      belief.stance = 'believer'
      belief.confidence = 1
      belief.extreme = true
      belief.seeded = true
    }
    this.applyRumourProvenanceBelief(rumour, recipient, belief, forceSeedBelief && !atheistRejectsWhisper)
    this.applyGriefForKnownDeath(recipient, rumour, [deliveryEvent.id])
    this.applyKnownRumourCorroboration(recipient, rumour)
    this.applyTargetedRumourReaction(rumour, recipient, belief)
    this.maybeReactToReportedNonbelief(recipient, rumour)
    this.requireBelievedDivineRumourShare(recipient, rumour, belief)
    this.deps.maybeTriggerReligiousFervour(recipient, rumour, belief)
    const thoughtEvent = this.addRumourThought(rumour, recipient, [deliveryEvent.id])
    this.deps.enqueueDecision(recipient.state.id, {
      type: 'rumour',
      description: directExperience
        ? `You personally experienced this recorded attack and formed a fully confident belief that it happened: "${rumour.text}".
Your private reaction: ${thoughtEvent.description}`
        : `You heard an unverified rumour from ${sourceContext}: "${rumour.text}". It is said to come from ${provenanceContext}. Current credibility is ${(rumour.credibility * 100).toFixed(0)}%.
Your private reaction: ${thoughtEvent.description}`,
      eventId: deliveryEvent.id,
      rumourId: rumour.id,
      causationIds: [deliveryEvent.id, thoughtEvent.id],
    })
  }

  public maybeReactToReportedNonbelief(believer: Agent, rumour: Rumour): void {
    if (
      believer.state.beliefSystem.religiousStance !== 'believer' ||
      !/\b(?:non[- ]?believer|atheist|does not believe in (?:god|the divine)|rejects? (?:god|the divine))\b/i.test(rumour.text)
    ) return
    const target = this.findAccusedAgent(rumour)
    if (!target?.state.alive || target.state.id === believer.state.id) return
    const aggravated = Math.random() < Math.min(0.75,
      believer.state.beliefSystem.faith / 130 + believer.state.personality.aggression * 0.2
    )
    this.deps.enqueueDecision(believer.state.id, {
      type: 'rumour', rumourId: rumour.id, causationIds: [],
      description: `You were told that ${target.state.name} is a nonbeliever. ${aggravated
        ? 'This aggravates your religious convictions. Decide whether to seek them out for conversion, confront them, or—only if your aggression overcomes your caution—attack.'
        : 'You are concerned but not enraged. Prefer a peaceful conversation or conversion attempt, while remaining free to dismiss the report.'}`,
    })
  }

  public findKnownDeceased(agent: Agent, rumour: Rumour): Agent | undefined {
    if (!/\b(?:died|dead|death|killed|murdered|passed away|lost (?:his|her|their) life)\b/i.test(rumour.text)) {
      return undefined
    }
    const knownIds = new Set(agent.state.relationships.map((relationship) => relationship.agentId))
    const named = this.deps.getAgents().filter((candidate) => {
      if (candidate.state.id === agent.state.id || !knownIds.has(candidate.state.id)) return false
      const fullName = candidate.state.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      return new RegExp(`\\b${fullName}\\b`, 'i').test(rumour.text)
    })
    return named.find((candidate) => !candidate.state.alive) ?? named[0]
  }

  public applyGriefForKnownDeath(agent: Agent, rumour: Rumour, causationIds: string[]): void {
    if (agent.state.demon) return
    const deceased = this.findKnownDeceased(agent, rumour)
    if (!deceased) return
    agent.state.emotionalState = EmotionalState.GRIEVING
    const relationship = agent.state.relationships.find((entry) => entry.agentId === deceased.state.id)
    const griefEvent = this.deps.eventBus.emit({
      type: 'grief',
      agentId: agent.state.id,
      targetId: deceased.state.id,
      actionType: ActionType.CRY,
      outcome: 'grieving',
      description: `${agent.state.name} is grieving the loss of ${deceased.state.name}, whom they knew as ${relationship?.type ?? 'an acquaintance'}.`,
      causationIds,
      worldStateDelta: { emotionalState: EmotionalState.GRIEVING },
      observers: [agent.state.id],
    })
    agent.addRecentMemory(griefEvent)
  }

  public deliverRumourFinding(
    rumour: Rumour,
    recipient: Agent,
    sourceAgentId: string,
    causationIds: string[]
  ): void {
    if (recipient.state.demon) return
    if (!rumour.finding || rumour.findingHeardBy.includes(recipient.state.id)) return
    rumour.findingHeardBy.push(recipient.state.id)
    const source = this.deps.getAgents().find((agent) => agent.state.id === sourceAgentId)
    const findingEvent = this.deps.eventBus.emit({
      type: 'investigation',
      agentId: sourceAgentId,
      actionType: ActionType.TALK,
      targetId: recipient.state.id,
      outcome: rumour.status,
      description: `${recipient.state.name} heard ${source ? `from ${source.state.name}` : 'an investigator'} that the rumour was ${rumour.status}: ${rumour.finding}`,
      causationIds,
      worldStateDelta: { rumourId: rumour.id, status: rumour.status },
      observers: [recipient.state.id],
    })
    recipient.addRecentMemory(findingEvent)
    this.reviseBeliefFromFinding(rumour, recipient)
    const thoughtEvent = this.addRumourThought(rumour, recipient, [findingEvent.id], true)
    this.deps.enqueueDecision(recipient.state.id, {
      type: 'rumour',
      description: `You learned the investigation result for "${rumour.text}": ${rumour.finding}
Your private reaction: ${thoughtEvent.description}`,
      eventId: findingEvent.id,
      rumourId: rumour.id,
      causationIds: [findingEvent.id, thoughtEvent.id],
    })
  }

  public recordRumourResponse(rumourId: string, agent: Agent, decision: AgentAction): void {
    const rumour = this.deps.rumours.get(rumourId)
    if (!rumour) return
    const belief = this.getOrCreateRumourBelief(rumour, agent)
    if (belief.extreme) {
      const stanceReason = belief.stance === 'believer'
        ? `I fully believe this rumour regardless of conflicting evidence.`
        : `I completely deny this rumour regardless of supporting evidence.`
      decision.reasoning = `${stanceReason} ${decision.reasoning}`
    }
    rumour.responses.push({
      agentId: agent.state.id,
      action: decision.action,
      reasoning: decision.reasoning,
      emotionalState: decision.emotionalState,
      timestamp: this.deps.simManager.getSimTime(),
    })
    if (rumour.responses.length > 30) rumour.responses.shift()
  }

  public getInvestigationAuthority(agent: Agent, rumour: Rumour): string | null {
    const job = agent.state.currentJob
    const text = rumour.text.toLowerCase()
    const matches = (terms: string[]) => terms.some((term) => text.includes(term))

    if (job === 'Sheriff') return 'town-wide fact finding and public safety'
    if ((job === 'Priest' || job === 'Inquisitor') && matches([
      'cult', 'cultist', 'sect', 'ritual', 'forbidden rite', 'hidden shrine', 'hooded', 'heretic',
    ])) return 'religious inquiry into suspected secret worship'
    if ((job === 'Nurse' || job === 'Paramedic') && matches([
      'hurt', 'injur', 'sick', 'ill', 'dead', 'death', 'poison', 'medicine', 'hospital',
      'health', 'collapse', 'accident', 'attack', 'assault', 'damage',
    ])) return 'health and medical safety'
    if (job === 'Accountant' && matches([
      'money', 'fund', 'account', 'payment', 'debt', 'fraud', 'stole', 'theft', 'missing',
    ])) return 'financial records'
    if (job === 'Mechanic' && matches([
      'machine', 'vehicle', 'equipment', 'tool', 'repair', 'broken', 'workshop', 'engine',
    ])) return 'mechanical evidence and equipment safety'
    if (job === 'Retail Worker' && matches([
      'store', 'shop', 'stock', 'delivery', 'product', 'stole', 'theft', 'customer',
    ])) return 'store operations and records'
    return null
  }

  public prepareInvestigationDecision(
    agent: Agent,
    decision: AgentAction,
    rumour: Rumour,
    authority: string
  ): void {
    const interviewee = this.selectInvestigationInterviewee(agent, rumour)
    decision.action = 'investigate'
    decision.target = interviewee?.state.name ?? null
    decision.dialogue = ''
    decision.durationMinutes = Math.max(20, Math.min(60, decision.durationMinutes ?? 30))
    decision.reasoning = `Using authority over ${authority} to check evidence for the rumour: ${rumour.text}`
    rumour.status = 'investigating'
    if (!rumour.investigatorIds.includes(agent.state.id)) rumour.investigatorIds.push(agent.state.id)
  }

  public selectInvestigationInterviewee(
    investigator: Agent,
    rumour: Rumour,
    excludedIds: string[] = []
  ): Agent | undefined {
    const excluded = new Set([investigator.state.id, ...excludedIds])
    return this.deps.getAgents()
      .filter((candidate) => candidate.state.alive && !excluded.has(candidate.state.id))
      .sort((first, second) => {
        const priority = (candidate: Agent): number => {
          if (candidate.state.id === rumour.sourceAgentId) return 3
          if (rumour.heardBy.includes(candidate.state.id)) return 2
          return 1
        }
        return priority(second) - priority(first) ||
          investigator.distanceTo(first.state) - investigator.distanceTo(second.state)
      })[0]
  }

  public advanceRumourInvestigations(): void {
    for (const [agentId, active] of this.deps.activeBlocks) {
      if (
        active.action.action !== 'investigate' ||
        !active.rumourId
      ) continue

      const investigator = this.deps.getAgents().find(
        (candidate) => candidate.state.id === agentId && candidate.state.alive
      )
      const rumour = this.deps.rumours.get(active.rumourId)
      if (!investigator || !rumour) continue

      if (rumour.status === 'resolved' || !this.isAgentUndecidedAboutRumour(agentId, rumour.id)) {
        const interviewee = active.investigationIntervieweeId
          ? this.deps.getAgents().find((candidate) => candidate.state.id === active.investigationIntervieweeId)
          : undefined
        if (interviewee && investigator.getConversationPartnerId() === interviewee.state.id) {
          this.deps.conversationManager.closeConversation(investigator, interviewee)
        }
        investigator.state.path = []
        investigator.state.pathIndex = 0
        this.deps.activeBlocks.delete(agentId)
        this.deps.startBlock(investigator, {
          action: 'work',
          target: this.deps.findJobBuilding(investigator)?.name ?? null,
          reasoning: `Returning to regular duties after reaching a conclusion about the rumour`,
          dialogue: '',
          emotionalState: 'neutral',
          durationMinutes: 30,
        })
        continue
      }
      if (active.investigationInterviewStarted) continue

      let interviewee = active.action.target
        ? this.deps.findAgentByName(active.action.target, this.deps.getAgents())
        : undefined
      if (!interviewee?.state.alive || interviewee.state.id === investigator.state.id) {
        interviewee = this.selectInvestigationInterviewee(investigator, rumour)
        active.action.target = interviewee?.state.name ?? null
      }
      if (!interviewee) continue

      const eligibility = this.deps.conversationManager.checkConversationEligibility(
        investigator,
        interviewee,
        this.deps.simManager.getSimTime()
      )
      if (eligibility === 'tooFar') {
        if (investigator.state.path.length === 0) {
          investigator.moveTo(
            Math.round(interviewee.state.position.x),
            Math.round(interviewee.state.position.y)
          )
        }
        continue
      }
      if (eligibility === 'busy') {
        const alternate = this.selectInvestigationInterviewee(
          investigator,
          rumour,
          [interviewee.state.id]
        )
        if (alternate && !alternate.isConversationActive()) {
          active.action.target = alternate.state.name
          investigator.moveTo(
            Math.round(alternate.state.position.x),
            Math.round(alternate.state.position.y)
          )
        }
        continue
      }

      const dialogue = `I'm checking a rumour that ${rumour.text.replace(/[.!?]+$/, '')}. Have you seen or heard anything that could confirm it?`
      const started = eligibility === 'active'
        ? this.deps.conversationManager.addTurn(
            investigator,
            interviewee,
            dialogue,
            this.deps.simManager.getSimTime()
          )
        : this.deps.conversationManager.initiateConversation(
            investigator,
            interviewee,
            dialogue,
            `investigating the rumour: ${rumour.text}`,
            this.deps.simManager.getSimTime(),
            true
          )
      if (!started) continue

      active.investigationInterviewStarted = true
      active.investigationIntervieweeId = interviewee.state.id
      active.endsAt = Math.max(active.endsAt, this.deps.getAbsoluteMinute() + 10)
      this.deps.agentInteraction.handleConversation(
        investigator,
        interviewee,
        dialogue,
        [active.eventId]
      )
    }
  }

  public completeRumourInvestigation(
    rumourId: string,
    agent: Agent,
    causationId: string
  ): string | undefined {
    const rumour = this.deps.rumours.get(rumourId)
    if (!rumour) return undefined

    const sourceEvent = rumour.sourceEventId
      ? this.deps.eventBus.getHistory().find((event) => event.id === rumour.sourceEventId)
      : undefined
    const supportingEvent = sourceEvent ?? this.deps.eventBus.getHistory()
      .filter((event) => !['conversation', 'rumour', 'investigation'].includes(event.type))
      .find((event) => this.textsDescribeSameEvent(rumour.text, event.description))
    const authoritative = this.getInvestigationAuthority(agent, rumour) !== null
    const controlledWhisperFinding = rumour.origin === 'whisper' && authoritative
    const cultExistenceInvestigation = ['Priest', 'Inquisitor'].includes(agent.state.currentJob ?? '') &&
      /cult|cultist|sect|ritual|forbidden rite|hidden shrine|hooded|heretic/i.test(rumour.text)
    const existingCults = cultExistenceInvestigation
      ? Array.from(new Map(this.deps.getAgents()
          .filter((candidate) => candidate.state.alive && candidate.state.cult)
          .map((candidate) => [candidate.state.cult!.id, candidate.state.cult!])).values())
      : []
    const confirmed = cultExistenceInvestigation
      ? existingCults.length > 0
      : controlledWhisperFinding
      ? rumour.groundTruth === true
      : supportingEvent !== undefined
    rumour.status = confirmed ? 'verified' : 'unsubstantiated'
    rumour.investigatedAt = this.deps.getAbsoluteMinute()
    rumour.credibility = confirmed ? Math.max(0.9, rumour.credibility) : Math.min(0.2, rumour.credibility)
    rumour.finding = confirmed
      ? supportingEvent
        ? `${agent.state.name} found evidence matching: ${supportingEvent.description}`
        : `${agent.state.name} found corroborating witness records and physical evidence supporting the whisper.`
      : `${agent.state.name} found no supporting event, witness record, or physical evidence.`
    for (const sourceId of rumour.credibilitySourceIds) {
      const source = this.deps.getAgents().find((candidate) => candidate.state.id === sourceId)
      if (!source) continue
      source.state.reputation = Math.max(0, Math.min(100, source.state.reputation + (confirmed ? 2 : -4)))
    }
    if (!rumour.findingHeardBy.includes(agent.state.id)) rumour.findingHeardBy.push(agent.state.id)
    if (confirmed && cultExistenceInvestigation) {
      agent.state.knownCultGroups ??= []
      for (const cult of existingCults) {
        if (!agent.state.knownCultGroups.some((known) => known.cultId === cult.id)) {
          agent.state.knownCultGroups.push({
            cultId: cult.id,
            cultName: cult.name,
            discoveredAtMinute: this.deps.getAbsoluteMinute(),
          })
        }
      }
    }

    const event = this.deps.eventBus.emit({
      type: 'investigation',
      agentId: agent.state.id,
      actionType: ActionType.INVESTIGATE,
      outcome: confirmed ? 'verified' : 'unsubstantiated',
      description: `${agent.state.name} investigated "${rumour.text}" and ${confirmed ? 'verified it' : 'could not substantiate it'}`,
      causationIds: [causationId],
      worldStateDelta: {
        rumourId,
        status: rumour.status,
        credibility: rumour.credibility,
        cultExistenceConfirmed: confirmed && cultExistenceInvestigation,
        discoveredCultIds: confirmed && cultExistenceInvestigation ? existingCults.map((cult) => cult.id) : [],
      },
      observers: [agent.state.id],
    })
    agent.addRecentMemory(event)
    this.reviseBeliefFromFinding(rumour, agent)
    this.addRumourThought(rumour, agent, [event.id], true)
    this.deps.maybeCreateForbiddenRelic(agent, rumour, causationId)
    return `${event.description}. ${rumour.finding}`
  }

  public textsDescribeSameEvent(first: string, second: string): boolean {
    const firstTokens = this.significantTokens(first)
    const secondTokens = this.significantTokens(second)
    if (firstTokens.size === 0 || secondTokens.size === 0) return false
    let overlap = 0
    for (const token of firstTokens) {
      if (secondTokens.has(token)) overlap++
    }
    return overlap >= Math.min(3, Math.max(2, Math.ceil(firstTokens.size * 0.5)))
  }

  public whisperRumour(
    text: string,
    targetAgentId: string | 'all',
    initialCredibility = 0.5,
    sourceHint = ''
  ): string | null {
    const cleaned = text.trim().slice(0, 500)
    if (!cleaned) return null

    const recipients = targetAgentId === 'all'
      ? this.deps.getAgents().filter((agent) => agent.state.alive)
      : this.deps.getAgents().filter((agent) => agent.state.alive && agent.state.id === targetAgentId)
    if (recipients.length === 0) return null

    const credibility = Math.max(0, Math.min(1, initialCredibility))
    const inferredSource = sourceHint.trim() || (
      RumourSystem.DIVINE_KEYWORD_RE.test(cleaned)
        ? cleaned
        : ''
    )
    const provenance = this.inferWhisperProvenance(inferredSource)
    const rumour = this.createRumour(
      cleaned,
      'whisper',
      undefined,
      undefined,
      credibility,
      undefined,
      provenance
    )
    for (const recipient of recipients) {
      this.deliverRumour(rumour, recipient, 'chaos', [], true)
    }
    console.log(`[Chaos] Whispered rumour to ${targetAgentId}: ${cleaned}`)
    void this.classifyAndApplyForbiddenKnowledge(rumour, recipients)
    return rumour.id
  }

  public async classifyAndApplyForbiddenKnowledge(rumour: Rumour, recipients: Agent[]): Promise<void> {
    let classification: ForbiddenKnowledgeClassification = classifyForbiddenKnowledgeFallback(rumour.text)
    if (this.deps.aiProvider?.isAvailable()) {
      try {
        classification = await this.deps.aiProvider.classifyForbiddenKnowledge(rumour.text)
      } catch (error) {
        console.warn('[AgentManager] Forbidden knowledge classification failed; using heuristic fallback.', error)
      }
    }
    if (!classification.forbidden) return
    for (const recipient of recipients) {
      if (!recipient.state.alive) continue
      await this.applyForbiddenKnowledge(recipient, rumour, classification)
    }
  }

  public async applyForbiddenKnowledge(
    recipient: Agent,
    rumour: Rumour,
    classification: ForbiddenKnowledgeClassification
  ): Promise<void> {
    // A cultist (secret prophet, leader, or rank-and-file member) is meant to
    // survive whatever revelation created or was embraced by the cult --
    // conviction in a hidden truth is unlikely to break someone who has
    // already organized their life around it. Flooring their sanity just
    // above zero isn't enough -- isInsane() treats sanity <= 20 as insane on
    // its own, independent of permanentInsanity, so even a floored-at-1
    // member would sit in that state permanently and still get caught by
    // update()'s ongoing panic/suicide roll. Only a full exemption from the
    // damage keeps them out of that loop.
    const isCultist = recipient.state.secretProphet || recipient.state.cult != null
    const severity = Math.max(1, Math.min(100, Math.round(classification.severity)))
    // The classifier itself grades severity by directness (see its prompt: a
    // vague unsettling hint scores 20-40, a clear direct statement scores
    // 50+). Only an actual telling should be able to damage sanity at all --
    // a mere hint is unsettling, not sanity-shattering, and shouldn't nudge
    // anyone toward panic or insanity.
    const isMereHint = severity < 50
    const entry: ForbiddenKnowledgeEntry = {
      text: rumour.text,
      category: classification.category,
      severity,
      revealedAtMinute: this.deps.getAbsoluteMinute(),
      sourceRumourId: rumour.id,
    }
    recipient.state.forbiddenKnowledge = [...(recipient.state.forbiddenKnowledge ?? []), entry]

    if (isCultist || isMereHint) {
      recipient.state.lastReasoning = isMereHint
        ? 'Something about what I just heard doesn\'t sit right with me. A hint of a truth I can\'t quite place.'
        : recipient.state.lastReasoning
      const event = this.deps.eventBus.emit({
        type: 'forbidden_knowledge',
        agentId: recipient.state.id,
        actionType: ActionType.IDLE,
        outcome: isCultist ? 'resisted' : 'hinted',
        description: isCultist
          ? `${recipient.state.name} learned something no mind should hold: "${rumour.text}". Their conviction as a cult leader held their sanity steady.`
          : `${recipient.state.name} caught only a vague, unsettling hint in "${rumour.text}" -- too indirect to shake their sanity, but it lingers.`,
        causationIds: [],
        worldStateDelta: { rumourId: rumour.id, category: classification.category, severity, sanity: recipient.state.sanity },
        observers: [recipient.state.id],
      })
      recipient.addRecentMemory(event)
      return
    }

    let interpretation: ExistentialReactionResult
    try {
      interpretation = await this.deps.runLLMRequestWithRetry(
        recipient.state.id,
        `${recipient.state.name} existential reaction`,
        () => this.deps.aiProvider!.interpretExistentialReaction(
          recipient.state.name,
          this.deps.promptBuilder.buildExistentialRevelationPrompt(recipient, rumour.text, classification.category, severity)
        ),
        3
      )
    } catch (error) {
      if (this.deps.isAgentRefreshCancellation(error)) return
      interpretation = classifyExistentialReactionFallback(recipient.state, severity)
    }

    this.resolveExistentialReaction(recipient, interpretation, severity, rumour.text, 'forbidden_knowledge')
  }

  public resolveExistentialReaction(
    recipient: Agent,
    interpretation: ExistentialReactionResult,
    severity: number,
    sourceText: string,
    insanitySource: NonNullable<AgentState['permanentInsanity']>['source']
  ): void {
    const previousSanity = recipient.state.sanity
    recipient.state.existentialState = {
      comprehended: interpretation.comprehended,
      reaction: interpretation.reaction,
      establishedAtMinute: this.deps.getAbsoluteMinute(),
      reasoning: interpretation.response,
      reinterpretationFrame: interpretation.reinterpretationFrame,
    }

    let outcome = interpretation.reaction as string
    let description = `${recipient.state.name} confronted something no mind should hold: "${sourceText}".`

    switch (interpretation.reaction) {
      case 'denial':
        description += ` They dismissed it outright: "${interpretation.response}"`
        break
      case 'reinterpretation': {
        recipient.state.beliefSystem.faith = Math.min(100, recipient.state.beliefSystem.faith + 10)
        const strongestDeity = [...recipient.state.beliefSystem.deities].sort((a, b) => b.confidence - a.confidence)[0]
        if (strongestDeity) {
          strongestDeity.confidence = Math.min(100, strongestDeity.confidence + 10)
          strongestDeity.revelationCount++
        }
        description += ` They folded it into their faith instead of fearing it: "${interpretation.response}"`
        break
      }
      case 'obsession':
        recipient.state.sanity = Math.max(0, previousSanity - Math.round(severity / 2))
        recipient.state.obsession = recipient.state.obsession ?? {
          since: this.deps.getAbsoluteMinute(),
          evidenceCount: 0,
          lastEvidenceAtMinute: this.deps.getAbsoluteMinute(),
          evidenceLog: [],
        }
        description += ` A quiet, obsessive need to know more took root: "${interpretation.response}"`
        break
      case 'nihilism':
        recipient.state.sanity = Math.max(0, previousSanity - Math.round(severity * 0.6))
        recipient.state.reputation = Math.max(0, recipient.state.reputation - 3)
        recipient.state.emotionalState = EmotionalState.SAD
        description += ` They concluded nothing matters anymore: "${interpretation.response}"`
        break
      case 'revelation':
        description += ` They accepted it with unsettling calm: "${interpretation.response}"`
        break
      case 'madness':
        recipient.state.sanity = Math.max(0, previousSanity - severity)
        if (!recipient.state.permanentInsanity) {
          recipient.state.permanentInsanity = {
            causedAtMinute: this.deps.getAbsoluteMinute(),
            source: insanitySource,
            reason: `Learned forbidden knowledge: ${interpretation.response}`,
          }
        }
        outcome = 'sanity_shattered'
        description += ` Their mind broke under the weight of it. Sanity fell from ${previousSanity.toFixed(0)} to ${recipient.state.sanity.toFixed(0)}.`
        break
    }

    // A secret prophet's entire cover depends on outwardly appearing like an
    // ordinary, composed Priest (see PromptBuilder's secretProphet framing);
    // visibly panicking the instant they're corrupted would blow that cover,
    // so their damaged sanity stays hidden behind a calm face.
    if (recipient.state.sanity <= 40 && !recipient.state.secretProphet &&
      (interpretation.reaction === 'madness' || interpretation.reaction === 'nihilism' || interpretation.reaction === 'obsession')) {
      recipient.state.emotionalState = interpretation.reaction === 'madness' ? EmotionalState.PANICKED : recipient.state.emotionalState
    }
    recipient.state.lastReasoning = interpretation.response
    this.deps.dailySchedules.delete(recipient.state.id)
    this.deps.scheduleCursors.delete(recipient.state.id)
    this.deps.activeBlocks.delete(recipient.state.id)

    const event = this.deps.eventBus.emit({
      type: 'forbidden_knowledge',
      agentId: recipient.state.id,
      actionType: ActionType.IDLE,
      outcome,
      description,
      causationIds: [],
      worldStateDelta: {
        comprehended: interpretation.comprehended,
        reaction: interpretation.reaction,
        severity,
        sanity: recipient.state.sanity,
      },
      observers: [recipient.state.id],
    })
    recipient.addRecentMemory(event)
  }

  public applyExistentialWitnessReaction(
    witness: Agent,
    sourceText: string,
    severityHint: number,
    insanitySource: NonNullable<AgentState['permanentInsanity']>['source']
  ): void {
    const obsession = witness.state.obsession
    if (obsession) {
      obsession.evidenceCount++
      obsession.lastEvidenceAtMinute = this.deps.getAbsoluteMinute()
      obsession.evidenceLog = [...obsession.evidenceLog, sourceText].slice(-5)
      if (obsession.evidenceCount < 3) return
      // Enough accumulated evidence resolves the obsession one way or the
      // other rather than looping forever.
      const resolved = classifyExistentialReactionFallback(witness.state, severityHint)
      witness.state.obsession = undefined
      this.resolveExistentialReaction(
        witness,
        resolved.reaction === 'denial' || resolved.reaction === 'obsession'
          ? { ...resolved, reaction: witness.state.personality.curiosity >= 0.5 ? 'revelation' : 'madness' }
          : resolved,
        severityHint,
        sourceText,
        insanitySource
      )
      return
    }
    const interpretation = classifyExistentialReactionFallback(witness.state, severityHint)
    this.resolveExistentialReaction(witness, interpretation, severityHint, sourceText, insanitySource)
  }

  public setWhisperGroundTruth(rumourId: string, groundTruth: boolean): boolean {
    const rumour = this.deps.rumours.get(rumourId)
    if (!rumour || rumour.origin !== 'whisper') return false
    rumour.groundTruth = groundTruth

    // Changing the debug truth flag invalidates any previous finding so an
    // authoritative agent can investigate the newly selected world truth.
    if (rumour.status !== 'investigating') rumour.status = 'unverified'
    rumour.finding = undefined
    rumour.findingHeardBy = []
    rumour.investigatorIds = []
    return true
  }

  public static readonly DIVINE_KEYWORD_RE =
    /\b(?:god|goddess|divine|deity|angel|spirit|holy|revelation|prophecy|old one|elder god|great one|entity|eldritch|cosmic)\b/i

  public inferWhisperProvenance(sourceHint: string): RumourProvenance {
    const cleaned = sourceHint.trim().slice(0, 160)
    if (!cleaned) return { kind: 'anonymous', description: 'An unexplained whisper' }

    const titleCase = (value: string): string => value.trim().replace(/\b\w/g, (letter) => letter.toUpperCase())
    const namedDeity =
      cleaned.match(/(?:god|goddess|spirit|deity|old one|elder god)\s+(?:named|called)\s+([a-z][a-z '-]{1,40})/i)?.[1] ??
      cleaned.match(/\bthe\s+(?:god|goddess|deity|spirit|old one|elder god)\s+([a-z][a-z'-]{1,40})/i)?.[1] ??
      // "Dagon, an ancient god of the deep" / "Cthulhu, a great old one"
      cleaned.match(/^([a-z][a-z'-]{1,40}(?:\s[a-z][a-z'-]{1,40}){0,3}),\s+(?:an?\s+|the\s+)?(?:ancient\s+|elder\s+|old\s+|great\s+)*(?:god|goddess|deity|old one|entity)\b/i)?.[1]

    const hasDivineKeyword = RumourSystem.DIVINE_KEYWORD_RE.test(cleaned)
    // A short, capitalized, name-like source with no other classification
    // cue ("Dagon", "Cthulhu", "The Nameless One") is treated as a named
    // higher power speaking directly, the same way typing "God" is. A
    // villager's own name is excluded so attributing a whisper to a known
    // villager (a mundane, non-divine source) is never misread as divine.
    const matchesKnownAgentName = this.deps.getAgents().some(
      (agent) => agent.state.name.toLowerCase() === cleaned.toLowerCase()
    )
    const looksLikeBareDeityName = !hasDivineKeyword && !matchesKnownAgentName &&
      /^[A-Z][A-Za-z'-]*(?:\s(?:the\s)?[A-Z][A-Za-z'-]*){0,3}$/.test(cleaned) &&
      !/\b(dream|vision|nightmare|witness|saw|record|evidence|report|feeling|intuition|hunch|suspicion)\b/i.test(cleaned)

    if (hasDivineKeyword || looksLikeBareDeityName) {
      const deityName = namedDeity
        ? titleCase(namedDeity)
        : looksLikeBareDeityName
          ? cleaned
          : /\bgod\b/i.test(cleaned)
            ? 'God'
            : 'The Divine'
      return { kind: 'divine', description: cleaned, deityName }
    }
    if (/\b(dream|vision|nightmare)\b/i.test(cleaned)) {
      return { kind: 'dream', description: cleaned }
    }
    if (/\b(witness|saw|record|evidence|report)\b/i.test(cleaned)) {
      return { kind: 'event', description: cleaned }
    }
    if (/\b(feeling|intuition|hunch|suspicion)\b/i.test(cleaned)) {
      return { kind: 'intuition', description: cleaned }
    }
    return { kind: 'anonymous', description: cleaned }
  }

  public completeAffiliationInterrogation(
    interrogator: Agent,
    action: AgentAction,
    causationId: string
  ): void {
    const target = action.target ? this.deps.findAgentByName(action.target, this.deps.getAgents()) : undefined
    if (!target?.state.alive || target.state.id === interrogator.state.id) return

    const seekingCult = ['Priest', 'Inquisitor'].includes(interrogator.state.currentJob ?? '') &&
      (interrogator.state.knownCultGroups?.length ?? 0) > 0
    const seekingAntiCult = Boolean(interrogator.state.cult)
    if (!seekingCult && !seekingAntiCult) return

    const affiliation = seekingCult && target.state.cult
      ? {
          affiliation: 'cult' as const,
          groupId: target.state.cult.id,
          groupName: target.state.cult.name,
        }
      : seekingAntiCult && target.state.antiCultGroup
        ? {
            affiliation: 'anti_cult' as const,
            groupId: target.state.antiCultGroup.id,
            groupName: target.state.antiCultGroup.name,
          }
        : undefined
    const revealChance = Math.max(0.1, Math.min(0.9,
      0.25 + interrogator.state.personality.curiosity * 0.3 +
      interrogator.state.personality.aggression * 0.2 - target.state.personality.caution * 0.25
    ))
    const revealed = Boolean(affiliation) && Math.random() < revealChance

    if (revealed && affiliation) {
      interrogator.state.secretAffiliationKnowledge ??= []
      const existing = interrogator.state.secretAffiliationKnowledge.find((entry) =>
        entry.agentId === target.state.id && entry.affiliation === affiliation.affiliation
      )
      if (existing) {
        existing.groupId = affiliation.groupId
        existing.groupName = affiliation.groupName
        existing.discoveredAtMinute = this.deps.getAbsoluteMinute()
      } else {
        interrogator.state.secretAffiliationKnowledge.push({
          agentId: target.state.id,
          ...affiliation,
          discoveredAtMinute: this.deps.getAbsoluteMinute(),
        })
      }
    }

    const description = revealed && affiliation
      ? `${interrogator.state.name} interrogated ${target.state.name} and privately uncovered their membership in ${affiliation.groupName}.`
      : `${interrogator.state.name} interrogated ${target.state.name} but did not uncover a hidden affiliation.`
    const event = this.deps.eventBus.emit({
      type: 'interrogation',
      agentId: interrogator.state.id,
      targetId: target.state.id,
      actionType: ActionType.INTERROGATE,
      outcome: revealed ? 'affiliation_revealed' : 'inconclusive',
      description,
      causationIds: [causationId],
      worldStateDelta: {
        revealed,
        affiliation: revealed ? affiliation?.affiliation : undefined,
        groupId: revealed ? affiliation?.groupId : undefined,
        revealChance,
      },
      observers: [interrogator.state.id, target.state.id],
    })
    interrogator.addRecentMemory(event)
    target.addRecentMemory(event)

    if (revealed && affiliation?.affiliation === 'cult' && interrogator.state.currentJob === 'Priest') {
      this.deps.tryMakePriestHostile(
        interrogator,
        target,
        `confirming their cult membership through interrogation`,
        event.id
      )
    }
  }

  public getRumours(): Rumour[] {
    return Array.from(this.deps.rumours.values())
  }

  public getRumourImpactCounts(): Record<string, number> {
    const impactedRumours = new Map<string, Set<string>>()
    for (const rumour of this.deps.rumours.values()) {
      if (rumour.status === 'resolved') continue
      for (const targetKey of this.getRumourTargetKeys(rumour)) {
        const separator = targetKey.indexOf(':')
        const kind = targetKey.slice(0, separator)
        const agentId = targetKey.slice(separator + 1)
        if ((kind !== 'agent' && kind !== 'event-target') || !this.deps.getAgentState(agentId)) continue

        const claims = impactedRumours.get(agentId) ?? new Set<string>()
        claims.add(rumour.id)
        impactedRumours.set(agentId, claims)
      }
    }

    return Object.fromEntries(
      Array.from(impactedRumours, ([agentId, claims]) => [agentId, claims.size])
    )
  }
}
