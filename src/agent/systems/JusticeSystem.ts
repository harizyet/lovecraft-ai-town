import { Agent } from '@/agent/Agent'
import { ActionType, BuildingType, CourtVote, Rumour, SimulationEvent } from '@/types'
import { isCourtEligibleRumour, isCultRelatedRumour } from '@/utils/RumourRules'
import { SystemDeps } from './SystemDeps'

export interface CourtState {
  activeCourtRumourId: string | null
  courtCounter: number
}

export function createCourtState(): CourtState {
  return {
    activeCourtRumourId: null,
    courtCounter: 0,
  }
}

// Court/Justice: convening, gathering, defending, voting on, and resolving
// the village's resolution courts.
export class JusticeSystem {
  constructor(private deps: SystemDeps, public readonly state: CourtState) {}

  public maybeStartResolutionCourt(): void {
    // Convening the court must not wait for the serialized LLM lane. A busy
    // village can otherwise keep that lane occupied indefinitely even after
    // the rumour has reached the entire living village.
    if (this.state.activeCourtRumourId || this.deps.isPolicyVoteActive()) return
    const living = this.deps.getAgents().filter((agent) => agent.state.alive)
    if (living.length < 2) return
    const livingIds = new Set(living.map((agent) => agent.state.id))

    for (const rumour of Array.from(this.deps.rumours.values()).reverse()) {
      if (rumour.status === 'resolved' || rumour.archived || !isCourtEligibleRumour(rumour)) continue
      const accused = this.deps.findAccusedAgent(rumour)
      if (!accused?.state.alive) continue
      let root = rumour
      while (root.parentRumourId) {
        const parent = this.deps.rumours.get(root.parentRumourId)
        if (!parent) break
        root = parent
      }
      if (root.sourceAgentId === accused.state.id) continue
      const reachedEntireVillage = living.every((agent) => rumour.heardBy.includes(agent.state.id))
      const forcingAuthority = this.findCertainCourtAuthority(rumour, living, accused)
      if (!reachedEntireVillage && !forcingAuthority) continue
      if (forcingAuthority) {
        for (const uninformed of living.filter((agent) => !rumour.heardBy.includes(agent.state.id))) {
          this.deps.deliverRumour(rumour, uninformed, forcingAuthority.state.id, [], false)
        }
      }
      const relatedRumours = this.deps.getRelatedRumourCluster(rumour).filter(
        (candidate) =>
          candidate.status !== 'resolved' &&
          isCourtEligibleRumour(candidate) &&
          this.deps.findAccusedAgent(candidate)?.state.id === accused.state.id
      )
      if (relatedRumours.some((candidate) => candidate.resolutionCourt)) continue
      const eligibleVoters = living.filter((agent) => agent.state.id !== accused.state.id)

      const courtCenter = this.getCourtCenter()
      if (!courtCenter) continue
      const sessionId = `court_${++this.state.courtCounter}`
      rumour.resolutionCourt = {
        id: sessionId,
        rumourId: rumour.id,
        rumourIds: relatedRumours.map((candidate) => candidate.id),
        accusedAgentId: accused.state.id,
        accusedName: accused.state.name,
        participantIds: eligibleVoters.map((agent) => agent.state.id),
        status: 'gathering',
        startedAt: this.deps.getAbsoluteMinute(),
        gatheringDeadline: this.deps.getAbsoluteMinute() + 60,
        gatheringStartedAtMs: Date.now(),
        lastGatheringRerouteAtMs: Date.now(),
        votes: [],
      }
      this.state.activeCourtRumourId = rumour.id

      for (const agent of living) {
        agent.closeActiveConversation()
        this.deps.activeBlocks.delete(agent.state.id)
        // Court supersedes ordinary thoughts and schedule decisions. Leaving
        // these queued makes every attendee appear LLM-pending and can keep
        // stale work ahead of the proceeding.
        this.deps.decisionQueue.delete(agent.state.id)
        agent.moveTo(
          courtCenter.x + ((living.indexOf(agent) % 3) - 1),
          courtCenter.y + (Math.floor(living.indexOf(agent) / 3) % 2)
        )
      }
      const event = this.deps.eventBus.emit({
        type: 'court',
        agentId: forcingAuthority?.state.id ?? accused.state.id,
        actionType: ActionType.MOVE,
        outcome: 'convened',
        description: `${forcingAuthority?.state.currentJob === 'Priest' && isCultRelatedRumour(rumour.text)
          ? `${forcingAuthority.state.name} called a resolution court over a cult allegation`
          : 'A resolution court convened'} over ${relatedRumours.length} related accusation${relatedRumours.length === 1 ? '' : 's'} against ${accused.state.name}: ${relatedRumours.map((candidate) => candidate.text).join(' / ')}`,
        causationIds: [],
        worldStateDelta: {
          rumourId: rumour.id,
          rumourIds: relatedRumours.map((candidate) => candidate.id),
          rumourStatuses: relatedRumours.map((candidate) => candidate.status),
          villageReach: rumour.heardBy.filter((agentId) => livingIds.has(agentId)).length,
          livingVillagers: living.length,
          forcedByAuthorityId: forcingAuthority?.state.id,
          calledByPriestId: forcingAuthority?.state.currentJob === 'Priest' && isCultRelatedRumour(rumour.text)
            ? forcingAuthority.state.id
            : undefined,
          courtSessionId: sessionId,
        },
        observers: living.map((agent) => agent.state.id),
      })
      for (const agent of living) agent.addRecentMemory(event)
      return
    }
  }

  public cancelInvalidResolutionCourt(): void {
    if (!this.state.activeCourtRumourId) return
    const root = this.deps.rumours.get(this.state.activeCourtRumourId)
    const court = root?.resolutionCourt
    if (!root || !court || court.status === 'resolved') return
    const courtRumours = (court.rumourIds ?? [root.id])
      .map((id) => this.deps.rumours.get(id))
      .filter((rumour): rumour is Rumour => Boolean(rumour))
    if (courtRumours.some((rumour) => rumour.status !== 'resolved' && isCourtEligibleRumour(rumour))) return

    for (const rumour of courtRumours) rumour.resolutionCourt = undefined
    this.state.activeCourtRumourId = null
    const affected = this.deps.getAgents().filter((agent) =>
      agent.state.alive && (agent.state.id === court.accusedAgentId || court.participantIds.includes(agent.state.id))
    )
    for (const agent of affected) {
      agent.state.path = []
      agent.state.pathIndex = 0
      this.deps.dailySchedules.delete(agent.state.id)
      this.deps.scheduleCursors.delete(agent.state.id)
    }
    const event = this.deps.eventBus.emit({
      type: 'court_cancelled',
      agentId: court.accusedAgentId,
      actionType: ActionType.IDLE,
      outcome: 'ineligible_claims',
      description: `The resolution court against ${court.accusedName} was cancelled because none of its claims alleged court-worthy misconduct.`,
      causationIds: [],
      worldStateDelta: { courtSessionId: court.id, rumourIds: courtRumours.map((rumour) => rumour.id) },
      observers: affected.map((agent) => agent.state.id),
    })
    for (const agent of affected) agent.addRecentMemory(event)
  }

  private findCertainCourtAuthority(rumour: Rumour, living: Agent[], accused: Agent): Agent | undefined {
    return living.find((agent) => {
      if (agent.state.id === accused.state.id || !rumour.heardBy.includes(agent.state.id)) return false
      if (!this.deps.getInvestigationAuthority(agent, rumour)) return false
      const belief = rumour.beliefs.find((candidate) => candidate.agentId === agent.state.id)
      if (!belief || belief.stance !== 'believer') return false
      const confidence = belief.confidence ?? (belief.extreme || belief.seeded ? 1 : rumour.credibility)
      const priestCallingCultCourt = agent.state.currentJob === 'Priest' && isCultRelatedRumour(rumour.text)
      return confidence >= (priestCallingCultCourt ? 0.55 : 0.9)
    })
  }

  public updateAgentJusticeResponse(
    rumour: Rumour,
    agent: Agent,
    belief: Rumour['beliefs'][number]
  ): void {
    if (belief.stance !== 'believer' || rumour.status === 'resolved') {
      belief.justiceResponse = 'gossip'
      belief.justiceResponseExplicit = false
      return
    }

    const accused = this.deps.findAccusedAgent(rumour)
    if (!accused || accused.state.id === agent.state.id) {
      belief.justiceResponse = 'gossip'
      return
    }
    if (belief.justiceResponseExplicit) return
    const livingOthers = this.deps.getAgents().filter(
      (candidate) => candidate.state.alive && candidate.state.id !== accused.state.id
    )
    const crowdSupport = livingOthers.length === 0 ? 0 : rumour.beliefs.filter(
      (candidate) => candidate.stance === 'believer' && livingOthers.some(
        (other) => other.state.id === candidate.agentId
      )
    ).length / livingOthers.length
    const relationship = agent.state.relationships.find(
      (candidate) => candidate.agentId === accused.state.id
    )?.type
    const relationshipPressure = relationship === 'enemy'
      ? 0.18
      : relationship === 'fear'
        ? 0.12
        : relationship === 'friend' || relationship === 'ally' || relationship === 'romantic'
          ? -0.22
          : 0
    const seriousness =
      (isCourtEligibleRumour(rumour) ? 0.5 : 0.08) +
      crowdSupport * 0.3 +
      agent.state.personality.aggression * 0.12 +
      agent.state.personality.ambition * 0.08 +
      relationshipPressure

    if (seriousness < 0.55) {
      belief.justiceResponse = 'gossip'
      return
    }

    const mobImpulse =
      agent.state.personality.aggression * 0.48 +
      crowdSupport * 0.42 -
      agent.state.personality.caution * 0.25 +
      (relationship === 'enemy' ? 0.16 : 0)
    belief.justiceResponse = mobImpulse >= 0.62 ? 'vigilante' : 'court'

    if (belief.justiceResponse === 'vigilante' && !belief.justiceActionQueued) {
      belief.justiceActionQueued = true
      this.deps.enqueueDecision(agent.state.id, {
        type: 'rumour',
        description: `You believe the allegation against ${accused.state.name} is serious. Crowd support and your temperament make you consider immediate vigilante action instead of waiting for court. Decide whether to confront, attack, steal from, warn, or stand down.`,
        rumourId: rumour.id,
        causationIds: [],
      })
    }
  }

  public getCourtCenter(): { x: number; y: number } | null {
    const square = Array.from(this.deps.world.buildings.values()).find(
      (building) => building.type === BuildingType.TOWN_SQUARE
    )
    if (square) {
      return {
        x: square.position.x + Math.floor(square.size.x / 2),
        y: square.position.y + Math.floor(square.size.y / 2),
      }
    }

    const centerX = Math.floor(this.deps.world.width / 2)
    const centerY = Math.floor(this.deps.world.height / 2)
    const maxRadius = Math.max(this.deps.world.width, this.deps.world.height)
    for (let radius = 0; radius <= maxRadius; radius++) {
      for (let y = centerY - radius; y <= centerY + radius; y++) {
        for (let x = centerX - radius; x <= centerX + radius; x++) {
          if (this.deps.world.isWalkable(x, y)) return { x, y }
        }
      }
    }
    return null
  }

  public advanceResolutionCourt(): boolean {
    if (!this.state.activeCourtRumourId) return false
    const rumour = this.deps.rumours.get(this.state.activeCourtRumourId)
    const court = rumour?.resolutionCourt
    if (!rumour || !court || court.status === 'resolved') {
      this.state.activeCourtRumourId = null
      return false
    }
    const courtRumours = (court.rumourIds ?? [rumour.id])
      .map((id) => this.deps.rumours.get(id))
      .filter((candidate): candidate is Rumour => Boolean(candidate))
    const combinedClaims = courtRumours
      .map((candidate, index) => `${index + 1}. ${candidate.text} (${Math.round(candidate.credibility * 100)}% credibility)`)
      .join('\n')

    const accused = this.deps.getAgents().find((agent) => agent.state.id === court.accusedAgentId)
    const courtCenter = this.getCourtCenter()
    if (!accused || !courtCenter) {
      court.status = 'resolved'
      court.outcome = 'absolved'
      court.resolution = 'The court dissolved because the accused was no longer present.'
      this.state.activeCourtRumourId = null
      return false
    }

    if (court.status === 'gathering') {
      const attendees = this.deps.getAgents().filter(
        (agent) => agent.state.alive && (
          court.participantIds.includes(agent.state.id) || agent.state.id === court.accusedAgentId
        )
      )
      const isAtCourt = (agent: Agent): boolean => {
        const dx = agent.state.position.x - courtCenter.x
        const dy = agent.state.position.y - courtCenter.y
        return Math.sqrt(dx * dx + dy * dy) <= 6
      }
      const gathered = attendees.every(isAtCourt)
      const now = Date.now()
      const gatheringStartedAtMs = court.gatheringStartedAtMs ?? now
      court.gatheringStartedAtMs = gatheringStartedAtMs

      // Recover attendees whose path was exhausted or invalidated while the
      // court had exclusive control of simulation decisions.
      if (!gathered && now - (court.lastGatheringRerouteAtMs ?? 0) >= 2000) {
        for (const agent of attendees.filter((candidate) => !isAtCourt(candidate))) {
          if (agent.state.path.length === 0 || agent.state.pathIndex >= agent.state.path.length) {
            agent.moveTo(courtCenter.x, courtCenter.y)
          }
        }
        court.lastGatheringRerouteAtMs = now
      }

      // A disconnected or unreachable attendee must never deadlock the whole
      // village. Proceed remotely after either the simulation-time deadline or
      // a short real-time grace period.
      const gatheringTimedOut =
        this.deps.getAbsoluteMinute() >= court.gatheringDeadline ||
        now - gatheringStartedAtMs >= 20_000
      if (!gathered && !gatheringTimedOut) return true
      court.status = 'voting'
      for (const agent of attendees) {
        agent.state.path = []
        agent.state.pathIndex = 0
      }
    }

    if (court.status === 'commenting') {
      if (this.deps.isLLMRequestInFlight() || this.deps.story.hasPendingNarrations()) return true
      if (!court.outcome || !court.resolution) return true
      if (!this.deps.aiProvider?.isAvailable()) {
        court.outcomeStatement = this.buildFallbackOutcomeStatement(court.outcome)
        this.finalizeResolutionCourt(rumour)
        return true
      }
      const prompt = `Verdict: ${court.resolution}\nAccusations:\n${combinedClaims}\nYour defense: ${court.defenseStatement ?? 'No defense was recorded.'}\nReact publicly to what the village decided. Do not change or reinterpret the verdict.`
      const promise = (async () => {
        try {
          const result = await this.deps.runLLMRequestWithRetry(
            accused.state.id,
            `${accused.state.name} post-verdict statement`,
            () => this.deps.aiProvider!.commentOnCourtOutcome(accused.state.name, prompt),
            4
          )
          court.outcomeStatement = this.isWeakCourtStatement(result)
            ? this.buildFallbackOutcomeStatement(court.outcome!)
            : result
        } catch (error) {
          if (this.deps.isAgentRefreshCancellation(error)) return
          console.warn('[AgentManager] Post-verdict statement failed; using fallback for this statement.', error)
          court.outcomeStatement = this.buildFallbackOutcomeStatement(court.outcome!)
        }
        this.finalizeResolutionCourt(rumour)
      })()
      this.deps.setLLMRequestInFlight(true)
      this.deps.pendingActivityLabels.set(accused.state.id, 'responding to the court verdict')
      this.deps.pendingDecisions.set(accused.state.id, promise)
      promise.finally(() => {
        this.deps.pendingDecisions.delete(accused.state.id)
        this.deps.pendingActivityLabels.delete(accused.state.id)
        this.deps.setLLMRequestInFlight(false)
      })
      return true
    }

    if (court.status !== 'voting' || this.deps.isLLMRequestInFlight() || this.deps.story.hasPendingNarrations()) return true
    if (!court.defenseStatement || this.isWeakCourtStatement(court.defenseStatement)) {
      const relevantMemories = accused.state.memory.recent
        .slice(-10)
        .map((memory) => `- ${memory.description}`)
        .join('\n')
      const prompt = `Related accusations:\n${combinedClaims}\nYour relevant recent memories:\n${relevantMemories || '- None recorded'}\nGive a substantive defense in 2-4 sentences. Address what you did or did not do, challenge unsupported claims, and cite any relevant memory or evidence. Do not vote.`
      if (!this.deps.aiProvider?.isAvailable()) {
        court.defenseStatement = this.buildFallbackCourtDefense(accused, courtRumours)
        this.recordCourtDefense(court, rumour, accused)
        return true
      }
      const promise = (async () => {
        let result: string
        try {
          result = await this.deps.runLLMRequestWithRetry(
          accused.state.id,
          `${accused.state.name} resolution court defense`,
          () => this.deps.aiProvider!.defendAtCourt(accused.state.name, prompt),
          4
          )
        } catch (error) {
          if (this.deps.isAgentRefreshCancellation(error)) return
          console.warn('[AgentManager] Court defense failed; using a fallback for this defense only.', error)
          result = this.buildFallbackCourtDefense(accused, courtRumours)
        }
        court.defenseStatement = this.isWeakCourtStatement(result)
          ? this.buildFallbackCourtDefense(accused, courtRumours)
          : result
        this.recordCourtDefense(court, rumour, accused)
      })()
      this.deps.setLLMRequestInFlight(true)
      this.deps.pendingActivityLabels.set(accused.state.id, 'defending against charges in court')
      this.deps.pendingDecisions.set(accused.state.id, promise)
      promise.finally(() => {
        this.deps.pendingDecisions.delete(accused.state.id)
        this.deps.pendingActivityLabels.delete(accused.state.id)
        this.deps.setLLMRequestInFlight(false)
      })
      return true
    }

    const unvotedVoters = court.participantIds
      .map((id) => this.deps.getAgents().find((agent) => agent.state.id === id && agent.state.alive))
      .filter((agent): agent is Agent => Boolean(agent) && !court.votes.some((vote) => vote.agentId === agent!.state.id))
    // Let a living cult leader establish the bloc position before followers.
    // If the leader is the accused or otherwise ineligible, the first eligible
    // member establishes it and the remaining members follow.
    const voter = unvotedVoters.find((candidate) => {
      if (!candidate.state.cult || candidate.state.cult.role === 'leader' || candidate.state.cult.role === 'founder') {
        return true
      }
      return !unvotedVoters.some((other) => {
        const otherCult = other.state.cult
        if (!otherCult || otherCult.id !== candidate.state.cult?.id) return false
        return otherCult.role === 'leader' || otherCult.role === 'founder'
      })
    }) ?? unvotedVoters[0]
    if (!voter) {
      this.beginResolutionCourtVerdict(rumour)
      return true
    }

    const voterBeliefs = courtRumours.map((candidate) => ({
      rumour: candidate,
      belief: candidate.beliefs.find((belief) => belief.agentId === voter.state.id),
    }))
    const priorStatements = court.votes.map((vote) => {
      const speaker = this.deps.getAgents().find((agent) => agent.state.id === vote.agentId)?.state.name ?? vote.agentId
      return `${speaker}: ${vote.statement}`
    }).join('\n')
    const beliefSummary = voterBeliefs.map(({ rumour: claim, belief }, index) =>
      `${index + 1}. ${claim.text} — ${belief?.stance ?? 'uncertain'}${belief?.extreme ? ' (unshakeable)' : ''}`
    ).join('\n')
    const cultDirectionValue = this.deps.getCultCourtDirection(voter, court)
    const sameCultAsAccused = Boolean(voter.state.cult?.id && voter.state.cult.id === accused.state.cult?.id)
    const accusedRejectsReligion = ['nonbeliever', 'atheist'].includes(accused.state.beliefSystem.religiousStance)
    const cultContext = voter.state.cult
      ? `\nCult affiliation: ${voter.state.cult.name} (${voter.state.cult.role}). ${cultDirectionValue
          ? `${cultDirectionValue.sourceName} has established the cult's vote as ${cultDirectionValue.choice}; as a member of this coordinated bloc, you must vote ${cultDirectionValue.choice}, though explain the influence naturally in your own words.`
          : 'You are establishing the coordinated vote that every other eligible cult member will follow.'}${sameCultAsAccused
            ? ` ${accused.state.name} belongs to your cult, so you must never vote to execute them; choose absolve or exile.`
            : accusedRejectsReligion
              ? ` ${accused.state.name} is a ${accused.state.beliefSystem.religiousStance}; your cult loyalty may make you favor execution when you believe the court's accusations justify punishment.`
              : ''}`
      : ''
    const prompt = `Accused: ${accused.state.name}\nRelated accusations:\n${combinedClaims}\nYour beliefs about each claim:\n${beliefSummary}\nYour relationship with the accused: ${voter.state.relationships.find((relationship) => relationship.agentId === accused.state.id)?.type ?? 'none'}${cultContext}\nStatements already made:\n${priorStatements || 'None yet.'}\nConsider the related claims together. Your vote must be consistent with your stated beliefs: a fixed or confident believer should not absolve merely because a claim remains unverified, while a denier should not punish the accused for that claim. Reserve execution for exceptionally grave and credible danger. Give your own concise public statement, then vote.`
    if (!this.deps.aiProvider?.isAvailable()) {
      this.recordCourtVote(
        court,
        rumour,
        accused,
        voter,
        this.deps.applyCultCourtInfluence(voter, accused, court, this.buildFallbackCourtVote(voter, accused, courtRumours))
      )
      return true
    }
    const promise = (async () => {
      let result: Omit<CourtVote, 'agentId'>
      try {
        result = await this.deps.runLLMRequestWithRetry(
          voter.state.id,
          `${voter.state.name} resolution court vote`,
          () => this.deps.aiProvider!.voteOnCourt(voter.state.name, prompt),
          4
        )
      } catch (error) {
        if (this.deps.isAgentRefreshCancellation(error)) return
        console.warn(`[AgentManager] ${voter.state.name}'s court vote failed; using fallback for this vote only.`, error)
        result = this.buildFallbackCourtVote(voter, accused, courtRumours)
      }
      result = this.deps.applyCultCourtInfluence(voter, accused, court, result)
      result = this.enforceBeliefConsistentCourtVote(voter, courtRumours, result)
      const reasoning = result.reasoning.trim() || 'the available evidence and my beliefs support this outcome'
      const originalStatement = this.isWeakCourtStatement(result.statement)
        ? ''
        : result.statement.trim().replace(/[.!?]+$/, '')
      const spokenReason = `I vote to ${result.choice} because ${reasoning.replace(/[.!?]+$/, '')}.`
      const vote: CourtVote = {
        agentId: voter.state.id,
        ...result,
        reasoning,
        statement: originalStatement ? `${originalStatement}. ${spokenReason}` : spokenReason,
      }
      this.recordCourtVote(court, rumour, accused, voter, vote)
    })()
    this.deps.setLLMRequestInFlight(true)
    this.deps.pendingActivityLabels.set(voter.state.id, 'speaking and voting in court')
    this.deps.pendingDecisions.set(voter.state.id, promise)
    promise.finally(() => {
      this.deps.pendingDecisions.delete(voter.state.id)
      this.deps.pendingActivityLabels.delete(voter.state.id)
      this.deps.setLLMRequestInFlight(false)
    })
    return true
  }

  public isWeakCourtStatement(statement: string): boolean {
    const cleaned = statement.trim()
    return cleaned.length < 20 || /nothing (further|more) to (add|say)|no comment|decline to (comment|answer)/i.test(cleaned)
  }

  // Cult members follow their bloc's directed vote regardless of personal
  // belief (see applyCultCourtInfluence), so this only constrains voters
  // outside any cult: an undecided or disbelieving voter should not be able
  // to punish, and execution specifically requires an actually-held,
  // high-confidence belief in a grave claim rather than a nominal LLM choice.
  private enforceBeliefConsistentCourtVote(
    voter: Agent,
    claims: Rumour[],
    vote: Omit<CourtVote, 'agentId'>
  ): Omit<CourtVote, 'agentId'> {
    if (voter.state.cult || vote.choice === 'absolve') return vote
    const beliefs = claims.map((claim) => claim.beliefs.find((belief) => belief.agentId === voter.state.id))
    const believedClaims = claims.filter((_claim, index) => beliefs[index]?.stance === 'believer')
    if (believedClaims.length === 0) {
      return {
        ...vote,
        choice: 'absolve',
        statement: 'I remain unconvinced by these accusations and will not punish someone for claims I do not believe.',
        reasoning: 'I do not actually believe the accusation, so I cannot in good conscience vote to punish',
      }
    }
    if (vote.choice === 'execute') {
      const strongestConfidence = Math.max(0, ...beliefs.map((belief) =>
        belief?.stance === 'believer' ? belief.confidence ?? (belief.extreme || belief.seeded ? 1 : 0.8) : 0
      ))
      const graveClaim = believedClaims.some((claim) => isCourtEligibleRumour(claim))
      if (!graveClaim || strongestConfidence < 0.85) {
        return {
          ...vote,
          choice: 'exile',
          statement: `I believe ${believedClaims.length === 1 ? 'this accusation' : 'these accusations'}, but not with enough certainty to take a life; I vote for exile instead.`,
          reasoning: 'my belief in the accusation is not firm enough to warrant execution, so I favor exile',
        }
      }
    }
    return vote
  }

  private buildFallbackCourtDefense(accused: Agent, claims: Rumour[]): string {
    const descriptions = claims.map((claim) => `“${claim.text}”`).join('; ')
    const evidence = claims.some((claim) => claim.status === 'verified')
      ? 'Some claims are marked verified, but the court must distinguish evidence of an event from proof that I am responsible.'
      : 'These claims have not established reliable evidence that I am responsible.'
    return `I directly dispute the accusations against me: ${descriptions}. ${evidence} I ask the village to judge my actual actions and records rather than repetition alone.`
  }

  private buildFallbackCourtVote(voter: Agent, accused: Agent, claims: Rumour[]): Omit<CourtVote, 'agentId'> {
    const beliefs = claims.map((claim) => claim.beliefs.find((belief) => belief.agentId === voter.state.id))
    const believedClaims = claims.filter((_claim, index) => beliefs[index]?.stance === 'believer')
    const verifiedBelief = claims.some((claim, index) =>
      claim.status === 'verified' && beliefs[index]?.stance === 'believer'
    )
    const strongestConfidence = Math.max(0, ...beliefs.map((belief) =>
      belief?.stance === 'believer'
        ? belief.confidence ?? (belief.extreme || belief.seeded ? 1 : 0.8)
        : 0
    ))
    const graveClaim = believedClaims.some((claim) => isCourtEligibleRumour(claim))
    const sameCultAsAccused = Boolean(voter.state.cult?.id && voter.state.cult.id === accused.state.cult?.id)
    const cultTargetsNonbeliever = Boolean(voter.state.cult) &&
      ['nonbeliever', 'atheist'].includes(accused.state.beliefSystem.religiousStance)
    const choice: CourtVote['choice'] = believedClaims.length === 0
      ? 'absolve'
      : !sameCultAsAccused && graveClaim && strongestConfidence >= 0.85 && (
          (verifiedBelief && voter.state.personality.aggression >= 0.65) ||
          (cultTargetsNonbeliever && voter.state.personality.aggression >= 0.45)
        )
        ? 'execute'
        : 'exile'
    if (choice === 'execute') {
      return {
        choice,
        reasoning: 'I strongly believe the verified accusation describes an exceptionally grave continuing danger',
        statement: 'I believe the accusation and consider the demonstrated danger too severe to leave unresolved.',
      }
    }
    if (choice === 'exile') {
      return {
        choice,
        reasoning: verifiedBelief
          ? 'I believe the accusation and the verified evidence warrants removal from the village'
          : 'I believe the accusation and cannot support allowing the accused to remain in the village',
        statement: `I believe ${believedClaims.length === 1 ? 'this accusation' : 'these accusations'} and think the village must act on that belief.`,
      }
    }
    return {
      choice,
      reasoning: 'I do not believe the accusations establish a basis for punishment',
      statement: 'I reject or remain unconvinced by the accusations and will not punish someone for claims I do not believe.',
    }
  }

  private recordCourtDefense(court: NonNullable<Rumour['resolutionCourt']>, rumour: Rumour, accused: Agent): void {
    const event = this.deps.eventBus.emit({
      type: 'court_statement', agentId: accused.state.id, actionType: ActionType.TALK,
      outcome: 'defense', description: `${accused.state.name} defended themselves before the resolution court: "${court.defenseStatement}"`,
      causationIds: [], worldStateDelta: { rumourId: rumour.id, courtSessionId: court.id }, observers: court.participantIds,
    })
    for (const agent of this.deps.getAgents().filter((candidate) => candidate.state.alive)) agent.addRecentMemory(event)
  }

  private recordCourtVote(court: NonNullable<Rumour['resolutionCourt']>, rumour: Rumour, accused: Agent, voter: Agent, vote: CourtVote | Omit<CourtVote, 'agentId'>): void {
    const protectsCultMember = vote.choice === 'execute' && Boolean(
      voter.state.cult?.id && voter.state.cult.id === accused.state.cult?.id
    )
    const safeVote = protectsCultMember
      ? {
          ...vote,
          choice: 'exile' as const,
          statement: 'I will not execute a fellow cult member, but I vote for exile.',
          reasoning: `I will not execute a fellow cult member; ${vote.reasoning}`,
        }
      : vote
    const recordedVote: CourtVote = { agentId: voter.state.id, ...safeVote }
    court.votes.push(recordedVote)
    const event = this.deps.eventBus.emit({
      type: 'court_statement', agentId: voter.state.id, targetId: accused.state.id, actionType: ActionType.TALK,
      outcome: recordedVote.choice, description: `${voter.state.name} told the resolution court: "${recordedVote.statement}" and voted to ${recordedVote.choice} ${accused.state.name}.`,
      causationIds: [], worldStateDelta: { rumourId: rumour.id, courtSessionId: court.id, vote: recordedVote.choice }, observers: court.participantIds,
    })
    for (const agent of this.deps.getAgents().filter((candidate) => candidate.state.alive)) agent.addRecentMemory(event)
  }

  // A living Alderman holds binding authority over the court: their own vote
  // is the verdict outright, rather than one ballot counted toward a
  // majority. This only applies when the Alderman is an eligible voter in
  // this case (not the accused themselves), so a court trying the Alderman
  // still falls back to an ordinary majority.
  private findVotingAlderman(court: NonNullable<Rumour['resolutionCourt']>): { agent: Agent; vote: CourtVote } | null {
    const alderman = this.deps.getAgents().find((agent) => agent.state.alive && agent.state.alderman)
    if (!alderman || alderman.state.id === court.accusedAgentId) return null
    const vote = court.votes.find((candidate) => candidate.agentId === alderman.state.id)
    return vote ? { agent: alderman, vote } : null
  }

  private beginResolutionCourtVerdict(rumour: Rumour): void {
    const court = rumour.resolutionCourt
    if (!court) return
    const accused = this.deps.getAgents().find((agent) => agent.state.id === court.accusedAgentId)
    if (!accused) return
    const votingAlderman = this.findVotingAlderman(court)
    const outcome: NonNullable<typeof court.outcome> = votingAlderman
      ? votingAlderman.vote.choice === 'execute'
        ? 'executed'
        : votingAlderman.vote.choice === 'exile'
          ? 'exiled'
          : 'absolved'
      : (() => {
          const executeVotes = court.votes.filter((vote) => vote.choice === 'execute').length
          const exileVotes = court.votes.filter((vote) => vote.choice === 'exile').length
          const majority = Math.floor(court.votes.length / 2) + 1
          // Execution is irreversible, so a bare majority is not enough: it
          // requires a two-thirds supermajority. A narrow win (e.g. 5 of 9)
          // falls through to exile or absolve instead.
          const executeThreshold = Math.ceil((court.votes.length * 2) / 3)
          return executeVotes >= executeThreshold
            ? 'executed'
            : executeVotes + exileVotes >= majority
              ? 'exiled'
              : 'absolved'
        })()
    court.status = 'commenting'
    court.outcome = outcome
    court.resolution = votingAlderman
      ? `By decree of Alderman ${votingAlderman.agent.state.name}, ${accused.state.name} was ${outcome}` +
        `${outcome === 'exiled' ? ' and removed from the village' : outcome === 'absolved' ? ' and remains in the village' : ''}.`
      : outcome === 'executed'
        ? `${accused.state.name} was executed by majority vote.`
        : outcome === 'exiled'
          ? `${accused.state.name} was exiled and removed from the village.`
          : `${accused.state.name} was absolved and remains in the village.`
  }

  private buildFallbackOutcomeStatement(
    outcome: NonNullable<NonNullable<Rumour['resolutionCourt']>['outcome']>
  ): string {
    if (outcome === 'absolved') {
      return `I accept the village's decision to absolve me and hope this ends the accusations against me.`
    }
    if (outcome === 'exiled') {
      return `I hear the village's decision to exile me, though I maintain my defense and will leave under protest.`
    }
    return `I hear the sentence against me and maintain my final defense before the village.`
  }

  private finalizeResolutionCourt(rumour: Rumour): void {
    const court = rumour.resolutionCourt
    if (!court?.outcome || !court.resolution) return
    const accused = this.deps.getAgents().find((agent) => agent.state.id === court.accusedAgentId)
    if (!accused) return
    court.status = 'resolved'
    const resolvedClaimIds = new Set(court.rumourIds ?? [rumour.id])
    for (const claimId of resolvedClaimIds) {
      const claim = this.deps.rumours.get(claimId)
      if (!claim) continue
      claim.status = 'resolved'
      claim.resolvedAt = this.deps.getAbsoluteMinute()
      claim.pendingFirstShareBy = []
      claim.relatedRumourIds = []
    }
    for (const remaining of this.deps.rumours.values()) {
      if (resolvedClaimIds.has(remaining.id)) continue
      remaining.relatedRumourIds = remaining.relatedRumourIds.filter((id) => !resolvedClaimIds.has(id))
    }
    court.postVerdictStatements = this.deps.getAgents()
      .filter((agent) => agent.state.alive)
      .map((agent) => {
        if (agent.state.id === accused.state.id) {
          return {
            agentId: agent.state.id,
            agentName: agent.state.name,
            statement: court.outcomeStatement ?? this.buildFallbackOutcomeStatement(court.outcome!),
          }
        }
        const vote = court.votes.find((candidate) => candidate.agentId === agent.state.id)
        if (!vote) {
          return {
            agentId: agent.state.id,
            agentName: agent.state.name,
            statement: `I witnessed the ${court.outcome} verdict and will consider what it means for the village.`,
          }
        }
        const aligned = court.outcome === 'absolved'
          ? vote.choice === 'absolve'
          : court.outcome === 'executed'
            ? vote.choice === 'execute'
            : vote.choice === 'exile' || vote.choice === 'execute'
        return {
          agentId: agent.state.id,
          agentName: agent.state.name,
          statement: aligned
            ? `The ${court.outcome} verdict reflects my vote to ${vote.choice}. I stand by it because ${vote.reasoning.replace(/[.!?]+$/, '')}.`
            : `The court decided ${court.outcome}, though I voted to ${vote.choice}. I still believe ${vote.reasoning.replace(/[.!?]+$/, '')}.`,
        }
      })
    const statementEvent = this.deps.eventBus.emit({
      type: 'court_statement',
      agentId: accused.state.id,
      actionType: ActionType.TALK,
      outcome: 'post_verdict',
      description: `${accused.state.name} responded to the ${court.outcome} verdict: "${court.outcomeStatement}"`,
      causationIds: [],
      worldStateDelta: { rumourId: rumour.id, courtSessionId: court.id, outcome: court.outcome },
      observers: court.participantIds,
    })
    for (const agent of this.deps.getAgents().filter((candidate) => candidate.state.alive)) agent.addRecentMemory(statementEvent)
    for (const statement of court.postVerdictStatements.filter((candidate) => candidate.agentId !== accused.state.id)) {
      const reactionEvent = this.deps.eventBus.emit({
        type: 'court_statement',
        agentId: statement.agentId,
        actionType: ActionType.TALK,
        outcome: 'post_verdict',
        description: `${statement.agentName} commented after the ${court.outcome} verdict: "${statement.statement}"`,
        causationIds: [statementEvent.id],
        worldStateDelta: { rumourId: rumour.id, courtSessionId: court.id, outcome: court.outcome },
        observers: court.participantIds,
      })
      for (const agent of this.deps.getAgents().filter((candidate) => candidate.state.alive)) agent.addRecentMemory(reactionEvent)
    }

    const event = this.deps.eventBus.emit({
      type: 'court_resolution',
      agentId: accused.state.id,
      actionType: court.outcome === 'executed' ? ActionType.ATTACK : ActionType.FLEE,
      outcome: court.outcome,
      description: court.resolution,
      causationIds: [statementEvent.id],
      worldStateDelta: { rumourId: rumour.id, courtSessionId: court.id, outcome: court.outcome },
      observers: court.participantIds,
    })
    for (const agent of this.deps.getAgents().filter((candidate) => candidate.state.alive)) {
      agent.addRecentMemory(event)
    }

    if (court.outcome === 'executed') {
      accused.takeDamage(accused.state.maxHealth, 'resolution court')
      accused.state.lastDeath = {
        witnessIds: court.participantIds.filter((id) => id !== accused.state.id),
        courtSessionId: court.id,
        executeVoterIds: court.votes.filter((vote) => vote.choice === 'execute').map((vote) => vote.agentId),
      }
    } else if (court.outcome === 'exiled') {
      for (const agent of this.deps.getAgents()) {
        if (agent.getConversationPartnerId() === accused.state.id) agent.closeActiveConversation()
      }
      accused.closeActiveConversation()
      this.deps.activeBlocks.delete(accused.state.id)
      this.deps.decisionQueue.delete(accused.state.id)
      this.deps.pendingDecisions.delete(accused.state.id)
      this.deps.llmRequestStatuses.delete(accused.state.id)
      this.deps.dailySchedules.delete(accused.state.id)
      this.deps.scheduleCursors.delete(accused.state.id)
      accused.state.path = []
      accused.state.pathIndex = 0
      accused.state.alive = false
      accused.state.exiled = {
        atMinute: this.deps.getAbsoluteMinute(),
        courtSessionId: court.id,
        reason: court.resolution,
      }
      const preferredSuccessor = court.votes.find((vote) => {
        const voter = this.deps.getAgents().find((agent) => agent.state.id === vote.agentId)
        return voter?.state.alive && voter.state.cult?.id === accused.state.cult?.id &&
          (vote.choice === 'exile' || vote.choice === 'execute')
      })?.agentId
      this.deps.promoteCultSuccessor(accused, preferredSuccessor, 'the cult leader was exiled by the village court')
    }
    this.queuePostCourtDiscussions(court, event)
    this.state.activeCourtRumourId = null
    this.resumeSchedulesAfterCourt(court.participantIds.concat(court.accusedAgentId))
  }

  private queuePostCourtDiscussions(
    court: NonNullable<Rumour['resolutionCourt']>,
    resolutionEvent: SimulationEvent
  ): void {
    const survivors = this.deps.getAgents().filter((agent) => agent.state.alive)
    for (const agent of survivors) {
      const nearbyNames = survivors
        .filter((candidate) => candidate.state.id !== agent.state.id && agent.distanceTo(candidate.state) <= 8)
        .map((candidate) => candidate.state.name)
      const ownVote = court.votes.find((vote) => vote.agentId === agent.state.id)
      const perspective = agent.state.id === court.accusedAgentId
        ? 'You were the accused and have just heard the verdict.'
        : ownVote
          ? `You voted to ${ownVote.choice}.`
          : 'You witnessed the proceeding without casting a vote.'
      this.deps.enqueueDecision(agent.state.id, {
        type: 'world_event',
        eventId: resolutionEvent.id,
        causationIds: [resolutionEvent.id],
        description: `POST-COURT DISCUSSION: ${court.resolution} ${perspective}
The court has ended. Seek a nearby villager and discuss the outcome now. Express your own view about the verdict, fairness, evidence, and consequences; agreement is not required. Prefer the talk action and address one of these nearby villagers: ${nearbyNames.join(', ') || 'whoever you encounter next'}.`,
      })
    }
  }

  public resumeSchedulesAfterCourt(participantIds: string[]): void {
    const minuteOfDay = this.deps.getMinuteOfDay()
    for (const agentId of new Set(participantIds)) {
      const agent = this.deps.getAgents().find(
        (candidate) => candidate.state.id === agentId && candidate.state.alive
      )
      if (!agent) continue

      agent.closeActiveConversation()
      agent.state.path = []
      agent.state.pathIndex = 0
      this.deps.activeBlocks.delete(agentId)
      this.deps.decisionQueue.delete(agentId)

      const schedule = this.deps.dailySchedules.get(agentId)
      if (!schedule || schedule.day !== this.deps.getCurrentDay()) {
        this.disperseAgentAfterCourt(agent)
        continue
      }
      const currentIndex = schedule.blocks.findIndex((block) =>
        block.startMinute <= minuteOfDay &&
        block.startMinute + block.durationMinutes > minuteOfDay
      )
      if (currentIndex >= 0) {
        const block = schedule.blocks[currentIndex]
        const remainingMinutes = Math.max(
          5,
          block.startMinute + block.durationMinutes - minuteOfDay
        )
        this.deps.scheduleCursors.set(agentId, currentIndex + 1)
        this.deps.startBlock(agent, {
          ...block,
          durationMinutes: remainingMinutes,
          reasoning: `Resuming the daily schedule after court: ${block.reasoning}`,
        })
        if (agent.state.path.length === 0) {
          this.disperseAgentAfterCourt(agent, block.target)
        }
        continue
      }

      const nextIndex = schedule.blocks.findIndex((block) => block.startMinute > minuteOfDay)
      this.deps.scheduleCursors.set(
        agentId,
        nextIndex >= 0 ? nextIndex : schedule.blocks.length
      )
      this.disperseAgentAfterCourt(
        agent,
        nextIndex >= 0 ? schedule.blocks[nextIndex].target : undefined
      )
    }
  }

  private disperseAgentAfterCourt(agent: Agent, preferredTarget?: string | null): void {
    let destination = preferredTarget ? this.deps.resolveTarget(preferredTarget) : null
    let destinationName = preferredTarget ?? ''
    if (!destination) {
      const building = this.deps.findJobBuilding(agent) ?? this.deps.findBuildingOfType(agent, 'home')
      if (building) {
        destination = {
          x: building.position.x + Math.floor(building.size.x / 2),
          y: building.position.y + Math.floor(building.size.y / 2),
        }
        destinationName = building.name
      }
    }
    if (!destination) {
      destination = this.deps.findRandomWalkablePosition()
      destinationName = 'another part of the village'
    }
    if (!agent.moveTo(destination.x, destination.y)) {
      const fallback = this.deps.findRandomWalkablePosition()
      agent.moveTo(fallback.x, fallback.y)
      destinationName = 'another part of the village'
    }

    const event = this.deps.eventBus.emit({
      type: 'court_dispersal',
      agentId: agent.state.id,
      actionType: ActionType.MOVE,
      outcome: 'resuming_schedule',
      description: `${agent.state.name} left the court and headed toward ${destinationName || 'their next activity'}`,
      causationIds: [],
      worldStateDelta: { destination: destinationName },
      observers: [agent.state.id],
    })
    agent.addRecentMemory(event)
  }

  public sendAttackVictimToAuthority(attackEvent: SimulationEvent): void {
    const victim = this.deps.getAgents().find((agent) => agent.state.id === attackEvent.targetId && agent.state.alive)
    if (!victim) return
    const candidates = this.deps.getAgents().filter((agent) =>
      agent.state.alive &&
      agent.state.id !== victim.state.id &&
      agent.state.id !== attackEvent.agentId
    )
    const authority = candidates.find((agent) => agent.state.currentJob === 'Sheriff')
      ?? candidates.find((agent) => ['Nurse', 'Paramedic'].includes(agent.state.currentJob ?? ''))
      ?? [...candidates].sort((first, second) => second.state.reputation - first.state.reputation)[0]
    if (!authority) return

    victim.closeActiveConversation()
    this.deps.activeBlocks.delete(victim.state.id)
    victim.moveTo(
      Math.round(authority.state.position.x),
      Math.round(authority.state.position.y)
    )
    const requestEvent = this.deps.eventBus.emit({
      type: 'authority_request',
      agentId: victim.state.id,
      targetId: authority.state.id,
      actionType: ActionType.MOVE,
      outcome: 'seeking_help',
      description: `${victim.state.name} stopped their current activity and sought help from ${authority.state.name} after being attacked.`,
      causationIds: [attackEvent.id],
      worldStateDelta: {
        attackEventId: attackEvent.id,
        attackerId: attackEvent.agentId,
        authorityId: authority.state.id,
      },
      observers: [victim.state.id, authority.state.id],
    })
    victim.addRecentMemory(requestEvent)
    authority.addRecentMemory(requestEvent)
    this.deps.enqueueDecision(victim.state.id, {
      type: 'interaction',
      eventId: attackEvent.id,
      causationIds: [attackEvent.id, requestEvent.id],
      description: `You were just attacked by ${this.deps.getAgentState(attackEvent.agentId)?.name ?? 'someone'} and survived. Seeking help is your immediate priority. Go to ${authority.state.name}, report who attacked you and what happened, and ask for protection, medical help, or an investigation. Prefer talking if close enough; otherwise move toward ${authority.state.name}.`,
    })
    this.deps.enqueueDecision(authority.state.id, {
      type: 'interaction',
      eventId: requestEvent.id,
      causationIds: [attackEvent.id, requestEvent.id],
      description: `${victim.state.name} is coming to you for help after being attacked by ${this.deps.getAgentState(attackEvent.agentId)?.name ?? 'someone'}. Prioritize meeting them, hearing their report, offering appropriate protection or care, and deciding whether the attack requires investigation or intervention.`,
    })
  }
}
