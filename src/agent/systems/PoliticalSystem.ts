import { Agent } from '@/agent/Agent'
import { ActionType, PolicyProposal, PolicySession, PolicyVote, RelationshipType } from '@/types'
import {
  pickNextPolicyProposal,
  POLICY_PROPOSALS,
  buildOutlawCultProposal,
  buildOutlawOutsiderProposal,
  buildProposeAldermanProposal,
} from '@/utils/PolicyRules'
import { SystemDeps } from './SystemDeps'

export const MIN_BRIBE_WEALTH = 10

export interface PoliticalState {
  policySessions: Map<string, PolicySession>
  activePolicySessionId: string | null
  policyCounter: number
  lastPolicyVoteDay: number
  recentPolicyProposalIds: string[]
}

export function createPoliticalState(): PoliticalState {
  return {
    policySessions: new Map(),
    activePolicySessionId: null,
    policyCounter: 0,
    lastPolicyVoteDay: 0,
    recentPolicyProposalIds: [],
  }
}

// Policy/Voting + Alderman elections + Bribery: the village assembly, its
// proposals, and the cult/favor bribery that can sway how it votes.
export class PoliticalSystem {
  constructor(private deps: SystemDeps, public readonly state: PoliticalState) {}

  public getPolicySessions(): PolicySession[] {
    return Array.from(this.state.policySessions.values())
  }

  public getActivePolicySession(): PolicySession | null {
    return this.state.activePolicySessionId ? this.state.policySessions.get(this.state.activePolicySessionId) ?? null : null
  }

  // The assembly can only move to outlaw the Knight or Inquisitor when a
  // living member of a political camp is also secretly a cult member, giving
  // the faction a motive to remove whoever might expose them.
  private findOutlawableOutsider(kind: 'knight' | 'inquisitor'): Agent | undefined {
    const factionCultOverlap = this.deps.getAgents().some(
      (agent) => agent.state.alive && agent.state.politicalCamp && agent.state.cult
    )
    if (!factionCultOverlap) return undefined
    const role = kind === 'knight' ? 'Knight' : 'Inquisitor'
    return this.deps.getAgents().find(
      (agent) => agent.state.alive && agent.state.currentJob === role && agent.state.outsider?.kind === kind
    )
  }

  // A cult leader may propose themselves for the office of Alderman, which
  // grants binding control over court verdicts and assembly outcomes. Only
  // one living Alderman may hold office at a time, and a leader who already
  // holds it has nothing left to propose. The proposal only becomes eligible
  // once the cult has effectively captured the village: at least 90% of all
  // living agents must be cult members.
  private findAldermanCandidate(): Agent | undefined {
    if (this.deps.getAgents().some((agent) => agent.state.alive && agent.state.alderman)) return undefined
    const living = this.deps.getAgents().filter((agent) => agent.state.alive)
    if (living.length === 0) return undefined
    const cultMemberCount = living.filter((agent) => agent.state.cult).length
    if (cultMemberCount / living.length < 0.9) return undefined
    return this.deps.getAgents().find(
      (agent) => agent.state.alive && (agent.state.cult?.role === 'leader' || agent.state.cult?.role === 'founder')
    )
  }

  public maybeStartPolicyVote(): void {
    if (this.deps.isCourtActive() || this.state.activePolicySessionId) return
    const living = this.deps.getAgents().filter((agent) => agent.state.alive)
    if (living.length < 2) return
    const day = this.deps.getCurrentDay()
    if (day < 2 || day <= this.state.lastPolicyVoteDay) return
    const courtCenter = this.deps.getCourtCenter()
    if (!courtCenter) return

    const provenCult = this.deps.findProvenCult()
    const outlawableKnight = this.findOutlawableOutsider('knight')
    const outlawableInquisitor = this.findOutlawableOutsider('inquisitor')
    const aldermanCandidate = this.findAldermanCandidate()
    const politicalProposals: PolicyProposal[] = []
    if (provenCult) politicalProposals.push(buildOutlawCultProposal(provenCult.id, provenCult.name))
    if (outlawableKnight) {
      politicalProposals.push(buildOutlawOutsiderProposal('knight', outlawableKnight.state.id, outlawableKnight.state.name))
    }
    if (outlawableInquisitor) {
      politicalProposals.push(
        buildOutlawOutsiderProposal('inquisitor', outlawableInquisitor.state.id, outlawableInquisitor.state.name)
      )
    }
    if (aldermanCandidate?.state.cult) {
      politicalProposals.push(
        buildProposeAldermanProposal(
          aldermanCandidate.state.id,
          aldermanCandidate.state.name,
          aldermanCandidate.state.cult.id,
          aldermanCandidate.state.cult.name
        )
      )
    }
    // Occasionally the assembly convenes over the town or the cults rather
    // than routine economic policy, whenever such a question is eligible.
    const usePolitical = politicalProposals.length > 0 && Math.random() < 0.6
    const proposal = usePolitical
      ? politicalProposals[Math.floor(Math.random() * politicalProposals.length)]
      : pickNextPolicyProposal(this.state.recentPolicyProposalIds)
    if (!usePolitical) {
      this.state.recentPolicyProposalIds = [proposal.id, ...this.state.recentPolicyProposalIds].slice(
        0,
        Math.max(0, POLICY_PROPOSALS.length - 1)
      )
    }
    this.state.lastPolicyVoteDay = day

    // The Alderman proposal is the one case where the beneficiary convenes
    // the vote themselves, proposing their own elevation to the assembly.
    const convener = proposal.effect === 'propose_alderman'
      ? living.find((agent) => agent.state.id === proposal.targetLeaderAgentId) ?? aldermanCandidate!
      : living.find((agent) => agent.state.currentJob === 'Steward') ??
        living.reduce((best, agent) => (agent.state.reputation > best.state.reputation ? agent : best))

    // The target of an outlaw-the-outsider vote does not get to vote on
    // their own banishment, mirroring how the accused cannot vote at court.
    const excludedVoterId = proposal.effect === 'outlaw_knight' || proposal.effect === 'outlaw_inquisitor'
      ? proposal.targetOutsiderAgentId
      : undefined
    const participants = excludedVoterId ? living.filter((agent) => agent.state.id !== excludedVoterId) : living

    const sessionId = `policy_${++this.state.policyCounter}`
    const session: PolicySession = {
      id: sessionId,
      proposalId: proposal.id,
      question: proposal.question,
      description: proposal.description,
      targetJob: proposal.targetJob,
      wealthDelta: proposal.wealthDelta,
      effect: proposal.effect ?? 'wealth',
      effectSummary: proposal.effectSummary,
      targetCultId: proposal.targetCultId,
      targetCultName: proposal.targetCultName,
      targetOutsiderAgentId: proposal.targetOutsiderAgentId,
      targetOutsiderName: proposal.targetOutsiderName,
      targetLeaderAgentId: proposal.targetLeaderAgentId,
      targetLeaderName: proposal.targetLeaderName,
      convenerAgentId: convener.state.id,
      convenerName: convener.state.name,
      participantIds: participants.map((agent) => agent.state.id),
      status: 'gathering',
      startedAt: this.deps.getAbsoluteMinute(),
      gatheringDeadline: this.deps.getAbsoluteMinute() + 60,
      gatheringStartedAtMs: Date.now(),
      lastGatheringRerouteAtMs: Date.now(),
      votes: [],
    }
    this.state.policySessions.set(sessionId, session)
    this.state.activePolicySessionId = sessionId

    for (const agent of living) {
      agent.closeActiveConversation()
      this.deps.activeBlocks.delete(agent.state.id)
      this.deps.decisionQueue.delete(agent.state.id)
      agent.moveTo(
        courtCenter.x + ((living.indexOf(agent) % 3) - 1),
        courtCenter.y + (Math.floor(living.indexOf(agent) / 3) % 2)
      )
    }

    const event = this.deps.eventBus.emit({
      type: 'policy_vote_convened',
      agentId: convener.state.id,
      actionType: ActionType.MOVE,
      outcome: 'convened',
      description: `${convener.state.name} convened the village assembly to vote on: ${proposal.question}`,
      causationIds: [],
      worldStateDelta: {
        policySessionId: sessionId,
        proposalId: proposal.id,
        targetJob: proposal.targetJob,
        effect: session.effect,
      },
      observers: living.map((agent) => agent.state.id),
    })
    for (const agent of living) agent.addRecentMemory(event)

    if (usePolitical && this.deps.aiProvider?.isAvailable() && !this.deps.isLLMRequestInFlight() && !this.deps.story.hasPendingNarrations()) {
      void this.enrichPoliticalProposalText(session)
    }
  }

  private async enrichPoliticalProposalText(session: PolicySession): Promise<void> {
    if (!this.deps.aiProvider) return
    const factContext = session.effect === 'outlaw_cult'
      ? `Investigators have confirmed that ${session.targetCultName} truly exists in the village. Required outcome: the assembly is being asked to vote on formally outlawing this cult and stripping its members of membership.`
      : session.effect === 'propose_alderman'
        ? `${session.targetLeaderName}, secretly the leader of ${session.targetCultName}, is asking the assembly to grant them the office of Alderman with binding authority over the resolution court and future assembly votes. Required outcome: the assembly is being asked to vote on this grant of office, which only takes effect if every living villager votes to support it.`
      : `Members of the village's political factions are themselves secretly affiliated with a cult, and fear what the ${session.effect === 'outlaw_knight' ? 'Knight' : 'Inquisitor'} outsider ${session.targetOutsiderName} might uncover about them. Required outcome: the assembly is being asked to vote on banishing ${session.targetOutsiderName} from the village.`
    const prompt = `${factContext}\nWrite the assembly's question and one or two sentences of context for this vote.`
    this.deps.setLLMRequestInFlight(true)
    try {
      const result = await this.deps.runLLMRequestWithRetry(
        session.convenerAgentId,
        'political event narration',
        () => this.deps.aiProvider!.generatePoliticalEventText(prompt),
        2
      )
      const current = this.state.policySessions.get(session.id)
      if (current && current.status !== 'resolved') {
        current.question = result.question
        current.description = result.description
      }
    } catch (error) {
      if (!this.deps.isAgentRefreshCancellation(error)) {
        console.warn('[AgentManager] Political event narration failed; keeping default proposal text.', error)
      }
    } finally {
      this.deps.setLLMRequestInFlight(false)
    }
  }

  public advancePolicyVote(): boolean {
    if (!this.state.activePolicySessionId) return false
    const session = this.state.policySessions.get(this.state.activePolicySessionId)
    if (!session || session.status === 'resolved') {
      this.state.activePolicySessionId = null
      return false
    }

    const courtCenter = this.deps.getCourtCenter()
    if (!courtCenter) {
      session.status = 'resolved'
      session.outcome = 'rejected'
      session.resolution = `The assembly on "${session.question}" dissolved because the village square could not be found.`
      this.state.activePolicySessionId = null
      return false
    }

    if (session.status === 'gathering') {
      const attendees = session.participantIds
        .map((id) => this.deps.getAgents().find((agent) => agent.state.id === id && agent.state.alive))
        .filter((agent): agent is Agent => Boolean(agent))
      const isAtCourt = (agent: Agent): boolean => {
        const dx = agent.state.position.x - courtCenter.x
        const dy = agent.state.position.y - courtCenter.y
        return Math.sqrt(dx * dx + dy * dy) <= 6
      }
      const gathered = attendees.every(isAtCourt)
      const now = Date.now()
      const gatheringStartedAtMs = session.gatheringStartedAtMs ?? now
      session.gatheringStartedAtMs = gatheringStartedAtMs

      if (!gathered && now - (session.lastGatheringRerouteAtMs ?? 0) >= 2000) {
        for (const agent of attendees.filter((candidate) => !isAtCourt(candidate))) {
          if (agent.state.path.length === 0 || agent.state.pathIndex >= agent.state.path.length) {
            agent.moveTo(courtCenter.x, courtCenter.y)
          }
        }
        session.lastGatheringRerouteAtMs = now
      }

      const gatheringTimedOut =
        this.deps.getAbsoluteMinute() >= session.gatheringDeadline ||
        now - gatheringStartedAtMs >= 20_000
      if (!gathered && !gatheringTimedOut) return true
      session.status = 'voting'
      for (const agent of attendees) {
        agent.state.path = []
        agent.state.pathIndex = 0
      }
    }

    if (session.status !== 'voting' || this.deps.isLLMRequestInFlight() || this.deps.story.hasPendingNarrations()) return true

    const unvotedVoters = session.participantIds
      .map((id) => this.deps.getAgents().find((agent) => agent.state.id === id && agent.state.alive))
      .filter((agent): agent is Agent => Boolean(agent) && !session.votes.some((vote) => vote.agentId === agent!.state.id))
    const voter = unvotedVoters[0]
    if (!voter) {
      this.finalizePolicyVote(session)
      return true
    }

    const priorStatements = session.votes.map((vote) => {
      const speaker = this.deps.getAgents().find((agent) => agent.state.id === vote.agentId)?.state.name ?? vote.agentId
      return `${speaker}: ${vote.statement}`
    }).join('\n')
    const campMates = session.votes.filter((vote) => {
      const member = this.deps.getAgents().find((agent) => agent.state.id === vote.agentId)
      return member?.state.politicalCamp?.id === voter.state.politicalCamp?.id
    })
    const campContext = voter.state.politicalCamp
      ? `\nYour political camp: ${voter.state.politicalCamp.name}.${campMates.length > 0
          ? ` Fellow ${voter.state.politicalCamp.name} members so far voted: ${campMates.map((vote) => vote.choice).join(', ')}. You are not required to match them, but camp solidarity may weigh on you.`
          : ' No fellow camp member has voted yet.'}`
      : ''
    const favorSource = this.findStrongestFavorVote(voter, session)
    const favorContext = favorSource
      ? `\nYou owe a personal favor to ${favorSource.agentName}, who already voted ${favorSource.choice}. Personal loyalty may pull you toward the same choice, though you are not bound to it.`
      : ''
    const effect = session.effect ?? 'wealth'
    let effectContext: string
    if (effect === 'outlaw_cult') {
      const isMember = voter.state.cult?.id === session.targetCultId
      effectContext = `If passed, ${session.targetCultName} is banned and every living member is stripped of membership.${
        isMember ? ` You are secretly a member of ${session.targetCultName} yourself; voting to outlaw it would strip you of membership and could expose you.` : ''
      }`
    } else if (effect === 'outlaw_knight' || effect === 'outlaw_inquisitor') {
      const role = effect === 'outlaw_knight' ? 'Knight' : 'Inquisitor'
      effectContext = `If passed, ${session.targetOutsiderName} is banished from the village.${
        voter.state.cult ? ` You are secretly a member of a cult; the ${role} could expose your membership if allowed to remain.` : ''
      }`
    } else if (effect === 'propose_alderman') {
      const isSameCult = voter.state.cult?.id === session.targetCultId
      effectContext = `If passed unanimously, ${session.targetLeaderName} becomes Village Alderman with binding authority over resolution court verdicts and future assembly votes. This grant of office requires every single living villager to vote support; a single opposing vote defeats it.${
        isSameCult
          ? ` ${session.targetLeaderName} is your own cult leader in ${session.targetCultName}; your loyalty binds you to support this.`
          : ` You are not part of ${session.targetCultName}. Handing one person unchecked control over the court and the village's votes is a direct threat to your own safety and standing; you have every reason to refuse.`
      }`
    } else {
      effectContext = `If passed, the village spends its funds so that every living ${session.targetJob} gains wealth.${
        voter.state.politicalCamp?.id === 'gentry'
          ? ' As a member of the Gentry, you are instinctively wary of spending the village\'s money this way and lean toward voting against it unless it directly serves you.'
          : ''
      }`
    }
    const selfInterest = effect === 'wealth' && voter.state.currentJob === session.targetJob
      ? `\nThis proposal directly benefits your own trade (${voter.state.currentJob}); supporting it would raise your own wealth.`
      : ''
    const prompt = `Proposal: ${session.question}\nDetails: ${session.description}\n${effectContext}\nYour job: ${voter.state.currentJob}. Your wealth: ${voter.state.wealth}.${campContext}${selfInterest}${favorContext}\nStatements already made:\n${priorStatements || 'None yet.'}\nGive your own concise public statement, then vote support or oppose.`

    if (!this.deps.aiProvider?.isAvailable()) {
      this.recordPolicyVote(session, voter, {
        agentId: voter.state.id,
        ...this.buildFallbackPolicyVote(voter, session),
      })
      return true
    }
    const promise = (async () => {
      let result: Omit<PolicyVote, 'agentId'>
      try {
        result = await this.deps.runLLMRequestWithRetry(
          voter.state.id,
          `${voter.state.name} policy vote`,
          () => this.deps.aiProvider!.voteOnPolicy(voter.state.name, prompt),
          4
        )
      } catch (error) {
        if (this.deps.isAgentRefreshCancellation(error)) return
        console.warn(`[AgentManager] ${voter.state.name}'s policy vote failed; using fallback for this vote only.`, error)
        result = this.buildFallbackPolicyVote(voter, session)
      }
      result = this.disciplineAldermanVote(session, voter, result)
      result = this.disciplineBribedVote(session, voter, result)
      const reasoning = result.reasoning.trim() || 'my own interests and the village\'s needs support this'
      const originalStatement = this.deps.isWeakCourtStatement(result.statement)
        ? ''
        : result.statement.trim().replace(/[.!?]+$/, '')
      const spokenReason = `I vote to ${result.choice} because ${reasoning.replace(/[.!?]+$/, '')}.`
      const vote: PolicyVote = {
        agentId: voter.state.id,
        choice: result.choice,
        reasoning,
        statement: originalStatement ? `${originalStatement}. ${spokenReason}` : spokenReason,
      }
      this.recordPolicyVote(session, voter, vote)
    })()
    this.deps.setLLMRequestInFlight(true)
    this.deps.pendingActivityLabels.set(voter.state.id, 'speaking and voting in the village assembly')
    this.deps.pendingDecisions.set(voter.state.id, promise)
    promise.finally(() => {
      this.deps.pendingDecisions.delete(voter.state.id)
      this.deps.pendingActivityLabels.delete(voter.state.id)
      this.deps.setLLMRequestInFlight(false)
    })
    return true
  }

  private findStrongestFavorVote(voter: Agent, session: PolicySession): { agentName: string; choice: PolicyVote['choice'] } | undefined {
    let best: { vote: PolicyVote; strength: number } | undefined
    for (const vote of session.votes) {
      if (vote.agentId === voter.state.id) continue
      const relationship = voter.state.relationships.find((entry) => entry.agentId === vote.agentId)
      if (!relationship) continue
      const qualifies = relationship.type === RelationshipType.ALLY ||
        relationship.type === RelationshipType.FRIEND ||
        relationship.strength >= 65
      if (!qualifies) continue
      if (!best || relationship.strength > best.strength) best = { vote, strength: relationship.strength }
    }
    if (!best) return undefined
    const agentName = this.deps.getAgents().find((agent) => agent.state.id === best!.vote.agentId)?.state.name ?? 'someone'
    return { agentName, choice: best.vote.choice }
  }

  private buildFallbackPolicyVote(voter: Agent, session: PolicySession): Omit<PolicyVote, 'agentId'> {
    if (voter.state.cult?.role === 'associate' && voter.state.cult.joinMethod === 'bribery') {
      return this.buildBribedAssociateVote(voter, session)
    }
    const effect = session.effect ?? 'wealth'
    if (effect === 'outlaw_cult') {
      if (voter.state.cult?.id === session.targetCultId) {
        return {
          choice: 'oppose',
          reasoning: 'I cannot let my own cult be outlawed',
          statement: 'I see no proof of any such cult, and vote against this.',
        }
      }
      const choice: PolicyVote['choice'] = Math.random() < 0.75 ? 'support' : 'oppose'
      return choice === 'support'
        ? {
            choice,
            reasoning: 'a confirmed cult is a danger to the whole village',
            statement: `The evidence is clear. I vote to outlaw ${session.targetCultName ?? 'this cult'}.`,
          }
        : {
            choice,
            reasoning: 'I am wary of the assembly overreaching',
            statement: 'I am not sure banning them solves anything, and I vote against this.',
          }
    }
    if (effect === 'propose_alderman') {
      return this.buildAldermanVote(voter, session)
    }
    if (effect === 'outlaw_knight' || effect === 'outlaw_inquisitor') {
      const isCultist = Boolean(voter.state.cult)
      const choice: PolicyVote['choice'] = isCultist
        ? (Math.random() < 0.8 ? 'support' : 'oppose')
        : (Math.random() < 0.3 ? 'support' : 'oppose')
      return choice === 'support'
        ? {
            choice,
            reasoning: isCultist
              ? 'they threaten to expose what I would rather keep hidden'
              : 'the village has other ways to keep order',
            statement: `I vote to send ${session.targetOutsiderName ?? 'them'} away from the village.`,
          }
        : {
            choice,
            reasoning: 'the village needs their protection and investigation',
            statement: `I vote to let ${session.targetOutsiderName ?? 'them'} stay.`,
          }
    }
    const camp = voter.state.politicalCamp?.id
    // Spending the village's funds cuts against gentry instincts regardless of who benefits;
    // they mainly come around when the spending directly lines their own pocket (selfInterestBoost below).
    const campLean = camp === 'gentry'
      ? -0.4
      : camp === 'commons'
        ? (session.targetJob === 'Merchant' ? -0.15 : 0.15)
        : 0
    const selfInterestBoost = voter.state.currentJob === session.targetJob ? 0.6 : 0
    const personalityBoost = (voter.state.personality.ambition - 0.5) * 0.2
    const favorSource = this.findStrongestFavorVote(voter, session)
    const favorNudge = favorSource ? (favorSource.choice === 'support' ? 0.2 : -0.2) : 0
    const roll = Math.random() * 0.3 - 0.15
    const score = 0.45 + campLean + selfInterestBoost + personalityBoost + favorNudge + roll
    const choice: PolicyVote['choice'] = score >= 0.5 ? 'support' : 'oppose'

    if (choice === 'support' && selfInterestBoost > 0) {
      return {
        choice,
        reasoning: `this proposal would directly help my own trade as a ${voter.state.currentJob}`,
        statement: `As a ${voter.state.currentJob}, I stand to gain from this and support it.`,
      }
    }
    if (choice === 'support') {
      return {
        choice,
        reasoning: 'this seems like a reasonable use of the village\'s effort',
        statement: 'I support this; it sounds good for the village.',
      }
    }
    return {
      choice,
      reasoning: camp === 'gentry'
        ? 'the village\'s coffers should not be spent so freely'
        : 'I do not see how this helps people like me',
      statement: camp === 'gentry'
        ? 'The village should not spend its money so carelessly, and I vote against this.'
        : 'I am not convinced and vote against this.',
    }
  }

  private buildAldermanVote(voter: Agent, session: PolicySession): Omit<PolicyVote, 'agentId'> {
    const isSameCult = voter.state.cult?.id === session.targetCultId
    if (isSameCult) {
      return {
        choice: 'support',
        reasoning: `${session.targetLeaderName} leads my cult, and I will not withhold my support from them`,
        statement: `I support naming ${session.targetLeaderName} as Alderman.`,
      }
    }
    return {
      choice: 'oppose',
      reasoning: 'no single person should hold unchecked authority over the court and the village\'s votes',
      statement: `I will not hand ${session.targetLeaderName} that kind of power over all of us.`,
    }
  }

  private buildBribedAssociateVote(voter: Agent, session: PolicySession): Omit<PolicyVote, 'agentId'> {
    const cultId = voter.state.cult?.id
    const cultName = voter.state.cult?.name ?? 'the cult'
    const effect = session.effect ?? 'wealth'
    if (effect === 'outlaw_cult') {
      const choice: PolicyVote['choice'] = session.targetCultId === cultId ? 'oppose' : 'support'
      return choice === 'oppose'
        ? {
            choice,
            reasoning: `I owe ${cultName} my loyalty and will not see them outlawed`,
            statement: 'I see no proof of any such cult, and vote against this.',
          }
        : {
            choice,
            reasoning: `${cultName} benefits when a rival cult is suppressed`,
            statement: `The evidence is convincing. I vote to outlaw ${session.targetCultName ?? 'them'}.`,
          }
    }
    if (effect === 'propose_alderman') {
      const choice: PolicyVote['choice'] = session.targetCultId === cultId ? 'support' : 'oppose'
      return choice === 'support'
        ? {
            choice,
            reasoning: `${session.targetLeaderName} leads ${cultName}, and I answer to them`,
            statement: `I support naming ${session.targetLeaderName} as Alderman.`,
          }
        : {
            choice,
            reasoning: `handing that power to someone outside ${cultName} serves no one I owe loyalty to`,
            statement: `I will not hand ${session.targetLeaderName} that kind of power over all of us.`,
          }
    }
    if (effect === 'outlaw_knight' || effect === 'outlaw_inquisitor') {
      return {
        choice: 'support',
        reasoning: `${cultName} is safer with fewer eyes watching`,
        statement: `I vote to send ${session.targetOutsiderName ?? 'them'} away from the village.`,
      }
    }
    return {
      choice: 'support',
      reasoning: `${cultName} expects my support on this`,
      statement: 'I support this; it sounds good for the village.',
    }
  }

  private disciplineBribedVote(session: PolicySession, voter: Agent, vote: Omit<PolicyVote, 'agentId'>): Omit<PolicyVote, 'agentId'> {
    if (voter.state.cult?.role !== 'associate' || voter.state.cult.joinMethod !== 'bribery') return vote
    return this.buildBribedAssociateVote(voter, session)
  }

  private disciplineAldermanVote(session: PolicySession, voter: Agent, vote: Omit<PolicyVote, 'agentId'>): Omit<PolicyVote, 'agentId'> {
    if (session.effect !== 'propose_alderman') return vote
    const disciplined = this.buildAldermanVote(voter, session)
    if (vote.choice === disciplined.choice) return vote
    return disciplined
  }

  private recordPolicyVote(session: PolicySession, voter: Agent, vote: PolicyVote): void {
    session.votes.push(vote)
    const event = this.deps.eventBus.emit({
      type: 'policy_statement',
      agentId: voter.state.id,
      actionType: ActionType.TALK,
      outcome: vote.choice,
      description: `${voter.state.name} told the assembly: "${vote.statement}" and voted to ${vote.choice} the proposal.`,
      causationIds: [],
      worldStateDelta: { policySessionId: session.id, vote: vote.choice },
      observers: session.participantIds,
    })
    for (const agent of this.deps.getAgents().filter((candidate) => candidate.state.alive)) agent.addRecentMemory(event)

    if (voter.state.cult?.role === 'associate' && voter.state.cult.joinMethod === 'bribery') {
      const cultName = voter.state.cult.name
      voter.state.cult = undefined
      const lapseEvent = this.deps.eventBus.emit({
        type: 'cult_bribery',
        agentId: voter.state.id,
        actionType: ActionType.IDLE,
        outcome: 'lapsed',
        description: `${voter.state.name}'s bribed allegiance to "${cultName}" lapsed now that the vote is cast.`,
        causationIds: [],
        worldStateDelta: { cultName },
        observers: [voter.state.id],
      })
      voter.addRecentMemory(lapseEvent)
    }
  }

  private finalizePolicyVote(session: PolicySession): void {
    const supportVotes = session.votes.filter((vote) => vote.choice === 'support').length
    const majority = Math.floor(session.votes.length / 2) + 1
    // Once seated, the Alderman's own vote decides every later assembly
    // question outright, the same way it decides court verdicts. The office
    // itself must still be granted unanimously (below), since no Alderman
    // exists yet to decide that first vote.
    const votingAlderman = session.effect === 'propose_alderman'
      ? null
      : this.deps.getAgents().find((agent) => agent.state.alive && agent.state.alderman &&
          session.votes.some((vote) => vote.agentId === agent.state.id))
    const aldermanVote = votingAlderman
      ? session.votes.find((vote) => vote.agentId === votingAlderman.state.id)
      : undefined
    const passed = session.effect === 'propose_alderman'
      // The office of Alderman must be granted unanimously by every living
      // voter, not merely by majority: one dissenting vote defeats it.
      ? session.votes.length > 0 &&
        session.votes.length === session.participantIds.length &&
        supportVotes === session.votes.length
      : aldermanVote
        ? aldermanVote.choice === 'support'
        : session.votes.length > 0 && supportVotes >= majority
    session.status = 'resolved'
    session.outcome = passed ? 'passed' : 'rejected'

    const effect = session.effect ?? 'wealth'
    let beneficiaries: Agent[] = []
    let newlyNamedAlderman: Agent | undefined
    let worldStateDelta: Record<string, unknown> = {
      policySessionId: session.id,
      effect,
      supportVotes,
      totalVotes: session.votes.length,
    }

    if (effect === 'outlaw_cult' && session.targetCultId) {
      if (passed) {
        const outlawedIds = this.deps.disbandCult(session.targetCultId, session.targetCultName ?? 'the cult')
        session.outlawedAgentIds = outlawedIds
        session.resolution = `The village voted to outlaw ${session.targetCultName ?? 'the cult'}. ` +
          `${outlawedIds.length} member${outlawedIds.length === 1 ? ' was' : 's were'} stripped of their membership.`
        worldStateDelta = { ...worldStateDelta, targetCultId: session.targetCultId, outlawedAgentIds: outlawedIds }
      } else {
        session.resolution = `The village voted down outlawing ${session.targetCultName ?? 'the cult'}.`
      }
    } else if ((effect === 'outlaw_knight' || effect === 'outlaw_inquisitor') && session.targetOutsiderAgentId) {
      const role = effect === 'outlaw_knight' ? 'Knight' : 'Inquisitor'
      if (passed) {
        const outsider = this.deps.getAgents().find(
          (agent) => agent.state.id === session.targetOutsiderAgentId && agent.state.alive
        )
        if (outsider) {
          this.deps.banishAgent(
            outsider,
            `Banished by vote of the village assembly regarding: ${session.question}`,
            session.id
          )
          session.outlawedAgentIds = [outsider.state.id]
          session.resolution = `The village voted to outlaw ${outsider.state.name} the ${role}, banishing them from the village.`
        } else {
          session.resolution = `The village voted to outlaw ${session.targetOutsiderName ?? `the ${role}`}, but they were already gone.`
        }
        worldStateDelta = { ...worldStateDelta, targetOutsiderAgentId: session.targetOutsiderAgentId }
      } else {
        session.resolution = `The village voted down outlawing ${session.targetOutsiderName ?? `the ${role}`}.`
      }
    } else if (effect === 'propose_alderman' && session.targetLeaderAgentId) {
      const leader = this.deps.getAgents().find(
        (agent) => agent.state.id === session.targetLeaderAgentId && agent.state.alive
      )
      if (leader && passed) {
        leader.state.alderman = {
          cultId: session.targetCultId ?? leader.state.cult?.id ?? '',
          cultName: session.targetCultName ?? leader.state.cult?.name ?? 'the cult',
          sinceMinute: this.deps.getAbsoluteMinute(),
          policySessionId: session.id,
        }
        session.resolution = `Every living villager voted to support it, and ${leader.state.name} is named Village Alderman, ` +
          `with binding authority over the resolution court and future assembly votes.`
        newlyNamedAlderman = leader
      } else if (leader) {
        session.resolution = `The vote to name ${leader.state.name} as Alderman required every living villager to agree, ` +
          `and it was not unanimous. ${leader.state.name} remains without office.`
      } else {
        session.resolution = `The vote to name ${session.targetLeaderName ?? 'the proposer'} as Alderman lapsed; they were no longer present.`
      }
      worldStateDelta = { ...worldStateDelta, targetLeaderAgentId: session.targetLeaderAgentId, granted: Boolean(leader && passed) }
    } else {
      if (passed) {
        beneficiaries = this.deps.getAgents().filter(
          (agent) => agent.state.alive && agent.state.currentJob === session.targetJob
        )
        for (const agent of beneficiaries) {
          agent.state.wealth = Math.min(100, agent.state.wealth + session.wealthDelta)
        }
        session.beneficiaryAgentIds = beneficiaries.map((agent) => agent.state.id)
      }
      session.resolution = passed
        ? `The village voted to pass "${session.question}". Every ${session.targetJob} gained wealth as a result.`
        : `The village voted down "${session.question}".`
      worldStateDelta = {
        ...worldStateDelta,
        targetJob: session.targetJob,
        wealthDelta: passed ? session.wealthDelta : 0,
        beneficiaryAgentIds: beneficiaries.map((agent) => agent.state.id),
      }
    }

    if (votingAlderman && session.resolution) {
      session.resolution = `By decree of Alderman ${votingAlderman.state.name}: ${session.resolution}`
    }

    const event = this.deps.eventBus.emit({
      type: 'policy_resolution',
      agentId: session.convenerAgentId,
      actionType: ActionType.IDLE,
      outcome: session.outcome,
      description: session.resolution,
      causationIds: [],
      worldStateDelta,
      observers: session.participantIds,
    })
    for (const agent of this.deps.getAgents().filter((candidate) => candidate.state.alive)) agent.addRecentMemory(event)

    if (newlyNamedAlderman) {
      this.deps.story.queueStoryMoment(
        'alderman_named',
        newlyNamedAlderman.state.name,
        session.resolution ?? '',
        newlyNamedAlderman.state.id,
        event.id
      )
    }

    this.state.activePolicySessionId = null
    this.deps.resumeSchedulesAfterCourt(session.participantIds)
  }

  public canAttemptCultBribery(briber: Agent, target: Agent): boolean {
    if (!briber.state.alive || !target.state.alive) return false
    const cult = briber.state.cult
    if (!cult || (cult.role !== 'leader' && cult.role !== 'founder') || cult.id.startsWith('cult_christian_')) return false
    if (target.state.cult || target.state.currentJob === 'Priest' || !this.deps.isConversionImmune(target)) return false
    return true
  }

  public attemptCultBribery(
    briber: Agent,
    target: Agent,
    reasoning: string,
    causationId: string
  ): void {
    if (!this.canAttemptCultBribery(briber, target)) return
    const cult = briber.state.cult!

    if (briber.state.wealth < MIN_BRIBE_WEALTH) {
      const event = this.deps.eventBus.emit({
        type: 'cult_bribery',
        agentId: briber.state.id,
        targetId: target.state.id,
        actionType: ActionType.TALK,
        outcome: 'no_funds',
        description: `${briber.state.name} wanted to bribe ${target.state.name} into joining "${cult.name}", but lacked the wealth to make a worthwhile offer.`,
        causationIds: [causationId],
        worldStateDelta: { cultId: cult.id, cultName: cult.name, joined: false },
        observers: [briber.state.id, target.state.id],
      })
      briber.addRecentMemory(event)
      return
    }

    const bribeAmount = Math.min(briber.state.wealth, 15 + Math.round(Math.random() * 15))
    const relationship = target.state.relationships.find((entry) => entry.agentId === briber.state.id)?.strength ?? 50
    const politicalResistance = this.deps.hasOpposingPoliticalCamps(briber, target)
    // Poorer targets are more susceptible: wealthFactor rises toward 1 as the
    // target's own wealth falls toward 0.
    const wealthFactor = (100 - target.state.wealth) / 100
    const chance = Math.max(0.05, Math.min(0.85,
      0.15 + wealthFactor * 0.5 + bribeAmount / 150 + relationship / 500 +
      briber.state.personality.ambition * 0.1 - target.state.personality.caution * 0.15 -
      (politicalResistance ? 0.1 : 0)
    ))
    const joined = Math.random() < chance
    if (joined) {
      briber.state.wealth = Math.max(0, briber.state.wealth - bribeAmount)
      target.state.wealth = Math.min(100, target.state.wealth + bribeAmount)
      target.state.cult = {
        id: cult.id,
        name: cult.name,
        role: 'associate',
        joinedAtMinute: this.deps.getAbsoluteMinute(),
        recruitedByAgentId: briber.state.id,
        joinMethod: 'bribery',
      }
    }
    const event = this.deps.eventBus.emit({
      type: 'cult_bribery',
      agentId: briber.state.id,
      targetId: target.state.id,
      actionType: ActionType.TALK,
      outcome: joined ? 'joined' : 'refused',
      description: joined
        ? `${target.state.name} took ${briber.state.name}'s bribe of ${bribeAmount} coin and became an associate of "${cult.name}", pledging to vote as the cult directs until the next assembly vote is cast.`
        : `${target.state.name} refused ${briber.state.name}'s bribe to join "${cult.name}".`,
      causationIds: [causationId],
      worldStateDelta: {
        cultId: cult.id,
        cultName: cult.name,
        joined,
        bribeAmount: joined ? bribeAmount : 0,
        wealthFactor,
        politicalResistance,
        taskReasoning: reasoning,
      },
      observers: [briber.state.id, target.state.id],
    })
    briber.addRecentMemory(event)
    target.addRecentMemory(event)
    if (joined) this.deps.fulfillCultRequests(cult.id, (request) => request.kind === 'grow_influence', event.id)
  }

  // The generic counterpart to attemptCultBribery: any living villager may
  // offer wealth to any other living villager to curry a personal favor.
  // No cult membership changes hands and no vote is bought outright -- a
  // successful gift only strengthens the recipient's own relationship
  // toward the briber (reusing the same relationship state votes already
  // read), which findStrongestFavorVote can later surface as social
  // pressure the recipient may or may not honor.
  public attemptFavorBribery(
    briber: Agent,
    target: Agent,
    reasoning: string,
    causationId: string
  ): void {
    if (!briber.state.alive || !target.state.alive || briber.state.id === target.state.id) return

    if (briber.state.wealth < MIN_BRIBE_WEALTH) {
      const event = this.deps.eventBus.emit({
        type: 'favor_bribery',
        agentId: briber.state.id,
        targetId: target.state.id,
        actionType: ActionType.TALK,
        outcome: 'no_funds',
        description: `${briber.state.name} wanted to win ${target.state.name}'s favor with a gift, but lacked the wealth to make a worthwhile offer.`,
        causationIds: [causationId],
        worldStateDelta: { accepted: false },
        observers: [briber.state.id, target.state.id],
      })
      briber.addRecentMemory(event)
      return
    }

    const bribeAmount = Math.min(briber.state.wealth, 15 + Math.round(Math.random() * 15))
    const existingRelationship = target.state.relationships.find((entry) => entry.agentId === briber.state.id)
    const relationshipStrength = existingRelationship?.strength ?? 50
    const politicalResistance = this.deps.hasOpposingPoliticalCamps(briber, target)
    // Poorer targets are more susceptible, mirroring attemptCultBribery.
    const wealthFactor = (100 - target.state.wealth) / 100
    const chance = Math.max(0.05, Math.min(0.85,
      0.15 + wealthFactor * 0.5 + bribeAmount / 150 + relationshipStrength / 500 +
      briber.state.personality.ambition * 0.1 - target.state.personality.caution * 0.15 -
      (politicalResistance ? 0.1 : 0)
    ))
    const accepted = Math.random() < chance
    if (accepted) {
      briber.state.wealth = Math.max(0, briber.state.wealth - bribeAmount)
      target.state.wealth = Math.min(100, target.state.wealth + bribeAmount)
      if (existingRelationship) {
        existingRelationship.strength = Math.min(95, existingRelationship.strength + 20)
        if (existingRelationship.strength >= 70) existingRelationship.type = RelationshipType.ALLY
        existingRelationship.lastInteraction = this.deps.simManager.getSimTime()
      } else {
        target.state.relationships.push({
          agentId: briber.state.id,
          type: RelationshipType.FRIEND,
          strength: 60,
          lastInteraction: this.deps.simManager.getSimTime(),
        })
      }
    }
    const event = this.deps.eventBus.emit({
      type: 'favor_bribery',
      agentId: briber.state.id,
      targetId: target.state.id,
      actionType: ActionType.TALK,
      outcome: accepted ? 'accepted' : 'refused',
      description: accepted
        ? `${target.state.name} accepted ${briber.state.name}'s gift of ${bribeAmount} coin and now owes them a personal favor.`
        : `${target.state.name} refused ${briber.state.name}'s attempt to buy their favor.`,
      causationIds: [causationId],
      worldStateDelta: {
        accepted,
        bribeAmount: accepted ? bribeAmount : 0,
        wealthFactor,
        politicalResistance,
        taskReasoning: reasoning,
      },
      observers: [briber.state.id, target.state.id],
    })
    briber.addRecentMemory(event)
    target.addRecentMemory(event)
  }
}
