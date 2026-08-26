import { Agent } from '@/agent/Agent'
import {
  ActionType,
  AgentAction,
  Building,
  BuildingType,
  CourtVote,
  CultAgenda,
  CultRequest,
  EmotionalState,
  RelationshipType,
  Rumour,
  ScheduleBlock,
  SimulationEvent,
  WeatherCondition,
} from '@/types'
import { isCultRelatedRumour } from '@/utils/RumourRules'
import { PropheticTask } from '@/ai/AIProvider'
import { SystemDeps } from './SystemDeps'

// Duplicated from AgentManager's module-level ACTION_MAP (kept private there)
// rather than imported, to avoid a circular import between AgentManager.ts
// and this file.
const ACTION_MAP: Record<string, ActionType> = {
  move: ActionType.MOVE,
  talk: ActionType.TALK,
  work: ActionType.WORK,
  rest: ActionType.REST,
  attack: ActionType.ATTACK,
  steal: ActionType.STEAL,
  destroy: ActionType.DESTROY,
  help: ActionType.HELP,
  flee: ActionType.FLEE,
  gather: ActionType.GATHER,
  eat: ActionType.EAT,
  sleep: ActionType.SLEEP,
  idle: ActionType.IDLE,
  investigate: ActionType.INVESTIGATE,
  interrogate: ActionType.INTERROGATE,
  call_inquisitor: ActionType.CALL_INQUISITOR,
  cry: ActionType.CRY,
  pray: ActionType.PRAY,
  conjure: ActionType.CONJURE,
  summon: ActionType.SUMMON,
  resurrect: ActionType.RESURRECT,
  heal: ActionType.HEAL,
  bless: ActionType.BLESS,
  curse: ActionType.CURSE,
  ritual: ActionType.RITUAL,
  preach: ActionType.PREACH,
  invite_cult: ActionType.INVITE_CULT,
  build_shrine: ActionType.BUILD_SHRINE,
  bribe: ActionType.BRIBE,
}

export interface CultState {
  lastCultMobCheckMinute: Map<string, number>
  cultMobCooldownUntil: Map<string, number>
  cultMobTargets: Map<string, string>
  cultShrineCommandIssued: Set<string>
}

export function createCultState(): CultState {
  return {
    lastCultMobCheckMinute: new Map(),
    cultMobCooldownUntil: new Map(),
    cultMobTargets: new Map(),
    cultShrineCommandIssued: new Set(),
  }
}

// Cult: formation, summoning rituals, cult mobs, conversion/recruitment,
// requests/agendas, defections, and the cult side of court influence.
export class CultSystem {
  constructor(private deps: SystemDeps, public readonly state: CultState) {}

  public getCultCourtDirection(
    voter: Agent,
    court: NonNullable<Rumour['resolutionCourt']>
  ): { choice: CourtVote['choice']; sourceName: string } | null {
    const cultId = voter.state.cult?.id
    if (!cultId) return null
    const cultVotes = court.votes.flatMap((vote) => {
      const member = this.deps.getAgents().find((agent) => agent.state.id === vote.agentId)
      return member?.state.cult?.id === cultId ? [{ vote, member }] : []
    })
    if (cultVotes.length === 0) return null
    const leaderVote = cultVotes.find(({ member }) =>
      member.state.cult?.role === 'leader' || member.state.cult?.role === 'founder'
    ) ?? cultVotes[0]
    return { choice: leaderVote.vote.choice, sourceName: leaderVote.member.state.name }
  }

  public applyCultCourtInfluence(
    voter: Agent,
    accused: Agent,
    court: NonNullable<Rumour['resolutionCourt']>,
    vote: Omit<CourtVote, 'agentId'>
  ): Omit<CourtVote, 'agentId'> {
    const direction = this.deps.getCultCourtDirection(voter, court)
    const sameCultAsAccused = Boolean(voter.state.cult?.id && voter.state.cult.id === accused.state.cult?.id)
    if (!direction) {
      return sameCultAsAccused && vote.choice === 'execute'
        ? {
            ...vote,
            choice: 'exile',
            statement: `I will not execute a fellow member of ${voter.state.cult?.name}, but I vote for exile.`,
            reasoning: `I will not kill a fellow member of ${voter.state.cult?.name}; ${vote.reasoning}`,
          }
        : vote
    }
    const cultName = voter.state.cult?.name ?? 'the cult'
    const choice = sameCultAsAccused && direction.choice === 'execute' ? 'exile' : direction.choice
    return {
      ...vote,
      choice,
      statement: sameCultAsAccused && direction.choice === 'execute'
        ? `I will not execute a fellow member of ${cultName}, but I vote for exile.`
        : vote.statement,
      reasoning: sameCultAsAccused && direction.choice === 'execute'
        ? `I will not execute a fellow member of ${cultName}, so the cult's lethal position is reduced to exile; ${vote.reasoning}`
        : `my membership in ${cultName} and ${direction.sourceName}'s influence bind me to the cult's ${choice} position; ${vote.reasoning}`,
    }
  }

  public findProvenCult(): { id: string; name: string } | undefined {
    const hasVerifiedCultRumour = Array.from(this.deps.rumours.values()).some(
      (rumour) => rumour.status === 'verified' && isCultRelatedRumour(rumour.text)
    )
    if (!hasVerifiedCultRumour) return undefined
    const livingCultMember = this.deps.getAgents().find((agent) => agent.state.alive && agent.state.cult)
    return livingCultMember?.state.cult
      ? { id: livingCultMember.state.cult.id, name: livingCultMember.state.cult.name }
      : undefined
  }

  public disbandCult(cultId: string, cultName: string): string[] {
    const now = this.deps.getAbsoluteMinute()
    const members = this.deps.getAgents().filter((agent) => agent.state.alive && agent.state.cult?.id === cultId)
    const outlawedIds: string[] = []
    for (const member of members) {
      member.state.formerCults ??= []
      if (!member.state.formerCults.some((cult) => cult.id === cultId)) {
        member.state.formerCults.push({ id: cultId, name: cultName, leftAtMinute: now })
      }
      member.state.cult = undefined
      member.state.cultRequests = []
      member.state.cultAgendas = []
      member.state.cultDesperation = undefined
      outlawedIds.push(member.state.id)
    }
    return outlawedIds
  }

  public gatherCultForSummoning(leader: Agent, action: AgentAction): void {
    const site = this.deps.resolveTarget(action.target)
    if (!site || !leader.state.cult) return
    const scheduleBlockId = (action as Partial<ScheduleBlock>).id
    const scheduledParticipantIds = scheduleBlockId
      ? this.deps.getAgents().filter((candidate) => this.deps.dailySchedules.get(candidate.state.id)?.blocks.some(
          (block) => block.id === `coordinated_summon_${leader.state.id}_${scheduleBlockId}`
        )).map((candidate) => candidate.state.id)
      : []
    const candidates = this.deps.getAgents()
      .filter((candidate) =>
        candidate.state.alive &&
        candidate.state.id !== leader.state.id &&
        candidate.state.cult?.id === leader.state.cult?.id
      )
      .sort((first, second) => {
        const firstScheduled = scheduledParticipantIds.includes(first.state.id) ? 1 : 0
        const secondScheduled = scheduledParticipantIds.includes(second.state.id) ? 1 : 0
        if (firstScheduled !== secondScheduled) return secondScheduled - firstScheduled
        const firstDistance = Math.hypot(first.state.position.x - site.x, first.state.position.y - site.y)
        const secondDistance = Math.hypot(second.state.position.x - site.x, second.state.position.y - site.y)
        return firstDistance - secondDistance
      })
    const participants = candidates.slice(0, 2)
    const leaderBlock = this.deps.activeBlocks.get(leader.state.id)
    if (leaderBlock) {
      leaderBlock.summonSite = site
      leaderBlock.summonedMemberIds = participants.map((member) => member.state.id)
      leaderBlock.summonInvitedMemberIds = []
      leaderBlock.summonPhase = 'recruiting'
      leaderBlock.summonInitialDistances = Object.fromEntries(
        [leader, ...participants].map((member) => [
          member.state.id,
          Math.hypot(member.state.position.x - site.x, member.state.position.y - site.y),
        ])
      )
      leaderBlock.endsAt = this.deps.getAbsoluteMinute() + Math.max(60, action.durationMinutes ?? 60)
    }
    if (!scheduleBlockId) {
      this.recordImmediateSummonSchedules(leader, participants, action, leaderBlock?.eventId ?? '')
    }
    const firstParticipant = participants[0]
    if (firstParticipant) leader.moveTo(firstParticipant.state.position.x, firstParticipant.state.position.y)
    for (const member of participants) {
      this.closeConversationForSummoning(member)
      member.state.path = []
      member.state.pathIndex = 0
      this.deps.activeBlocks.set(member.state.id, {
        action: {
          action: 'move',
          target: leader.state.name,
          reasoning: `Waiting for ${leader.state.name} to personally call them to the summoning ritual`,
          dialogue: '',
          emotionalState: 'determined',
          durationMinutes: 240,
        },
        endsAt: this.deps.getAbsoluteMinute() + 240,
        eventId: leaderBlock?.eventId ?? '',
        summonLeaderId: leader.state.id,
        summonSite: site,
      })
    }
  }

  public closeConversationForSummoning(agent: Agent): void {
    const partnerId = agent.getConversationPartnerId()
    const partner = partnerId
      ? this.deps.getAgents().find((candidate) => candidate.state.id === partnerId)
      : undefined
    if (partner) this.deps.conversationManager.closeConversation(agent, partner)
    else agent.closeActiveConversation()
    for (const participant of [agent, partner].filter((candidate): candidate is Agent => Boolean(candidate))) {
      const queued = this.deps.decisionQueue.get(participant.state.id)?.filter(
        (trigger) => trigger.type !== 'interaction'
      ) ?? []
      if (queued.length > 0) this.deps.decisionQueue.set(participant.state.id, queued)
      else this.deps.decisionQueue.delete(participant.state.id)
    }
  }

  public recordImmediateSummonSchedules(
    leader: Agent,
    participants: Agent[],
    action: AgentAction,
    eventId: string
  ): void {
    const startMinute = this.deps.getMinuteOfDay()
    const durationMinutes = Math.max(60, action.durationMinutes ?? 60)
    const endMinute = startMinute + durationMinutes
    const blockId = `active_summon_${leader.state.id}_${eventId || startMinute}`
    const assignments: Array<{ agent: Agent; block: ScheduleBlock }> = [
      {
        agent: leader,
        block: {
          id: blockId,
          startMinute,
          durationMinutes,
          ...action,
          action: 'summon',
        },
      },
      ...participants.map((participant) => ({
        agent: participant,
        block: {
          id: `${blockId}_${participant.state.id}`,
          startMinute,
          durationMinutes,
          action: 'move' as const,
          target: action.target,
          reasoning: `Scheduled with ${leader.state.name} to answer the whispered summoning command`,
          dialogue: '',
          emotionalState: 'determined',
        },
      })),
    ]
    for (const assignment of assignments) {
      const existing = this.deps.dailySchedules.get(assignment.agent.state.id)
      const preserved = existing?.day === this.deps.getCurrentDay()
        ? existing.blocks.filter((block) =>
            block.startMinute + block.durationMinutes <= startMinute || block.startMinute >= endMinute
          )
        : []
      preserved.push(assignment.block)
      preserved.sort((first, second) => first.startMinute - second.startMinute)
      this.deps.dailySchedules.set(assignment.agent.state.id, { day: this.deps.getCurrentDay(), blocks: preserved })
      this.deps.scheduleCursors.set(
        assignment.agent.state.id,
        preserved.findIndex((block) => block.id === assignment.block.id) + 1
      )
    }
  }

  public coordinateScheduledSummons(): void {
    const coordinatedPrefix = 'coordinated_summon_'
    for (const [agentId, schedule] of this.deps.dailySchedules) {
      const retained = schedule.blocks.filter((block) => !block.id.startsWith(coordinatedPrefix))
      if (retained.length !== schedule.blocks.length) {
        this.deps.dailySchedules.set(agentId, { ...schedule, blocks: retained })
        const cursor = retained.findIndex((block) =>
          block.startMinute + block.durationMinutes > this.deps.getMinuteOfDay()
        )
        this.deps.scheduleCursors.set(agentId, cursor < 0 ? retained.length : cursor)
      }
    }

    for (const leader of this.deps.getAgents().filter((candidate) =>
      candidate.state.alive &&
      candidate.state.cult &&
      ['leader', 'founder'].includes(candidate.state.cult.role)
    )) {
      const leaderSchedule = this.deps.dailySchedules.get(leader.state.id)
      if (!leaderSchedule || leaderSchedule.day !== this.deps.getCurrentDay()) continue
      for (const summonBlock of leaderSchedule.blocks.filter((block) =>
        block.action === 'summon' && Boolean(this.deps.resolveTarget(block.target))
      )) {
        const site = this.deps.resolveTarget(summonBlock.target)!
        const participants = this.deps.getAgents()
          .filter((candidate) =>
            candidate.state.alive &&
            candidate.state.id !== leader.state.id &&
            candidate.state.cult?.id === leader.state.cult?.id
          )
          .sort((first, second) => {
            const firstDistance = Math.hypot(first.state.position.x - site.x, first.state.position.y - site.y)
            const secondDistance = Math.hypot(second.state.position.x - site.x, second.state.position.y - site.y)
            return firstDistance - secondDistance
          })
          .slice(0, 2)
        for (const participant of participants) {
          const schedule = this.deps.dailySchedules.get(participant.state.id)
          if (!schedule || schedule.day !== leaderSchedule.day) continue
          const summonEnd = summonBlock.startMinute + summonBlock.durationMinutes
          const preserved = schedule.blocks.filter((block) =>
            block.startMinute + block.durationMinutes <= summonBlock.startMinute ||
            block.startMinute >= summonEnd
          )
          preserved.push({
            id: `${coordinatedPrefix}${leader.state.id}_${summonBlock.id}`,
            startMinute: summonBlock.startMinute,
            durationMinutes: summonBlock.durationMinutes,
            action: 'move',
            target: summonBlock.target,
            reasoning: `Scheduled with ${leader.state.name} to gather and participate in the cult's summoning ritual`,
            dialogue: '',
            emotionalState: 'determined',
          })
          preserved.sort((first, second) => first.startMinute - second.startMinute)
          this.deps.dailySchedules.set(participant.state.id, { ...schedule, blocks: preserved })
          const cursor = preserved.findIndex((block) =>
            block.startMinute + block.durationMinutes > this.deps.getMinuteOfDay()
          )
          this.deps.scheduleCursors.set(participant.state.id, cursor < 0 ? preserved.length : cursor)
        }
      }
    }
  }

  public advanceSummoningProcess(
    leader: Agent,
    active: {
      action: AgentAction
      endsAt: number
      eventId: string
      summonSite?: { x: number; y: number }
      summonedMemberIds?: string[]
      summonInvitedMemberIds?: string[]
      summonPhase?: 'recruiting' | 'travelling'
    },
    now: number
  ): boolean {
    let site = active.summonSite
    if (!site || !leader.state.cult) return false
    const selectedIds = active.summonedMemberIds ?? []
    const validMembers = selectedIds
      .map((id) => this.deps.getAgents().find((candidate) => candidate.state.id === id))
      .filter((member): member is Agent => Boolean(
        member?.state.alive && member.state.cult?.id === leader.state.cult?.id
      ))
    active.summonedMemberIds = validMembers.map((member) => member.state.id)
    active.summonInvitedMemberIds = (active.summonInvitedMemberIds ?? []).filter((id) =>
      validMembers.some((member) => member.state.id === id)
    )

    if ((active.summonPhase ?? 'recruiting') === 'recruiting') {
      const nextMember = validMembers.find((member) =>
        !active.summonInvitedMemberIds!.includes(member.state.id)
      )
      if (nextMember) {
        if (leader.distanceTo(nextMember.state) > 4) {
          if (leader.state.path.length === 0 || leader.state.pathIndex >= leader.state.path.length) {
            const routed = this.moveWithinSummoningConversationRange(leader, nextMember)
            if (!routed) {
              leader.state.lastReasoning = `Searching for a reachable approach to invite ${nextMember.state.name} to the summoning ritual.`
              active.endsAt = now + 10
              return true
            }
          }
          leader.state.lastReasoning = `Going to personally invite ${nextMember.state.name} to the summoning ritual.`
          active.endsAt = now + 10
          return true
        }
        const dialogue = `${nextMember.state.name}, I intend to perform a summoning ritual at ${active.action.target}. Follow me and take your place in the rite.`
        this.closeConversationForSummoning(leader)
        this.closeConversationForSummoning(nextMember)
        const conversationEventId = this.deps.agentInteraction.handleConversation(
          leader,
          nextMember,
          dialogue,
          [active.eventId],
          { summoningInvitation: true, acknowledgement: 'automatic' }
        )
        active.summonInvitedMemberIds.push(nextMember.state.id)
        nextMember.state.emotionalState = EmotionalState.DETERMINED
        nextMember.state.lastReasoning = `${leader.state.name} personally called me to follow them to a summoning ritual.`
        const memberBlock = this.deps.activeBlocks.get(nextMember.state.id)
        if (memberBlock) {
          memberBlock.eventId = conversationEventId
          memberBlock.action.reasoning = `Following ${leader.state.name} after accepting the personal summons to the ritual`
        }
        active.endsAt = now + 5
        return true
      }
      const invitedMembers = validMembers.filter((member) =>
        active.summonInvitedMemberIds!.includes(member.state.id)
      )
      if (invitedMembers.length >= 2 && invitedMembers.some((member) => leader.distanceTo(member.state) > 4)) {
        leader.state.path = []
        leader.state.pathIndex = 0
        leader.state.lastReasoning = 'Waiting for both personally invited cultists to gather before leading them to the ritual site.'
        active.endsAt = now + 10
        return true
      }
      const partyIds = new Set([leader.state.id, ...invitedMembers.map((member) => member.state.id)])
      const emptyLocation = this.findEmptySummoningBuilding(active.action.target, partyIds)
      if (!emptyLocation) {
        leader.state.path = []
        leader.state.pathIndex = 0
        leader.state.lastReasoning = 'Waiting for an empty, reachable summoning location before starting the procession.'
        active.endsAt = now + 10
        return true
      }
      site = this.getSummoningBuildingCenter(emptyLocation)
      active.summonSite = site
      active.action.target = emptyLocation.name
      active.summonPhase = 'travelling'
      leader.moveTo(site.x, site.y)
      const processionSite = site
      invitedMembers.forEach((member, index) => {
        const destination = this.getSummoningParticipantSlot(processionSite, index)
        member.state.path = []
        member.state.pathIndex = 0
        member.moveTo(destination.x, destination.y)
      })
      leader.state.lastReasoning = active.summonInvitedMemberIds.length >= 2
        ? `Leading the gathered cultists to ${active.action.target} for the summoning ritual.`
        : `Proceeding to ${active.action.target}, though too few cultists answered the summons.`
    }

    if (Math.hypot(leader.state.position.x - site.x, leader.state.position.y - site.y) > 2 && (
      leader.state.path.length === 0 || leader.state.pathIndex >= leader.state.path.length
    )) {
      leader.moveTo(site.x, site.y)
    }
    const ritualParty = [leader, ...validMembers.filter((member) =>
      active.summonInvitedMemberIds!.includes(member.state.id)
    )]
    const ritualPartyIds = new Set(ritualParty.map((member) => member.state.id))
    const location = [...this.deps.world.buildings.values()].find((building) =>
      building.name === active.action.target
    )
    const currentSite = site
    const unrelatedOccupants = this.deps.getAgents().filter((candidate) =>
      candidate.state.alive &&
      !ritualPartyIds.has(candidate.state.id) &&
      (location
        ? this.isAgentAtSummoningBuilding(candidate, location)
        : Math.hypot(candidate.state.position.x - currentSite.x, candidate.state.position.y - currentSite.y) <= 3)
    )
    if (unrelatedOccupants.length > 0) {
      const replacement = this.findEmptySummoningBuilding(undefined, ritualPartyIds)
      if (replacement && replacement.name !== active.action.target) {
        site = this.getSummoningBuildingCenter(replacement)
        active.summonSite = site
        active.action.target = replacement.name
        leader.state.path = []
        leader.state.pathIndex = 0
        leader.moveTo(site.x, site.y)
        for (const follower of ritualParty.slice(1)) {
          follower.state.path = []
          follower.state.pathIndex = 0
        }
        leader.state.lastReasoning = `${location?.name ?? 'The ritual site'} became occupied, so I am leading the procession to empty ${replacement.name}.`
        active.endsAt = now + 10
        return true
      }
      leader.state.lastReasoning = `Waiting for ${active.action.target} to be empty because no alternate ritual site is available.`
      active.endsAt = now + 10
      return true
    }
    const gathered = ritualParty.filter((member) => Math.hypot(
      member.state.position.x - site.x,
      member.state.position.y - site.y
    ) <= 2)
    if (ritualParty.length >= 3 && gathered.length >= 3) {
      active.endsAt = now
      return false
    }
    if (ritualParty.length < 3 && Math.hypot(
      leader.state.position.x - site.x,
      leader.state.position.y - site.y
    ) <= 2) {
      active.endsAt = now
      return false
    }
    active.endsAt = now + 10
    return true
  }

  public moveWithinSummoningConversationRange(leader: Agent, member: Agent): boolean {
    const targetX = Math.round(member.state.position.x)
    const targetY = Math.round(member.state.position.y)
    const occupied = new Set(this.deps.getAgents()
      .filter((candidate) => candidate.state.alive && candidate.state.id !== leader.state.id)
      .map((candidate) => `${Math.round(candidate.state.position.x)},${Math.round(candidate.state.position.y)}`))
    const approaches: Array<{ x: number; y: number }> = []
    for (let dx = -3; dx <= 3; dx++) {
      for (let dy = -3; dy <= 3; dy++) {
        if (Math.hypot(dx, dy) > 3.5) continue
        const candidate = { x: targetX + dx, y: targetY + dy }
        if (!this.deps.world.isWalkable(candidate.x, candidate.y)) continue
        if (occupied.has(`${candidate.x},${candidate.y}`)) continue
        approaches.push(candidate)
      }
    }
    approaches.sort((first, second) => {
      const firstDistance = Math.hypot(
        leader.state.position.x - first.x,
        leader.state.position.y - first.y
      )
      const secondDistance = Math.hypot(
        leader.state.position.x - second.x,
        leader.state.position.y - second.y
      )
      return firstDistance - secondDistance
    })
    return approaches.some((candidate) => leader.moveTo(candidate.x, candidate.y))
  }

  public isAgentAtSummoningBuilding(agent: Agent, building: Building): boolean {
    const margin = 1
    return agent.state.position.x >= building.position.x - margin &&
      agent.state.position.x <= building.position.x + building.size.x + margin &&
      agent.state.position.y >= building.position.y - margin &&
      agent.state.position.y <= building.position.y + building.size.y + margin
  }

  public getSummoningBuildingCenter(building: Building): { x: number; y: number } {
    return {
      x: building.position.x + Math.floor(building.size.x / 2),
      y: building.position.y + Math.floor(building.size.y / 2),
    }
  }

  public getSummoningParticipantSlot(site: { x: number; y: number }, index: number): { x: number; y: number } {
    const offsets = [
      { x: 1, y: 0 },
      { x: -1, y: 0 },
      { x: 0, y: 1 },
      { x: 0, y: -1 },
      { x: 1, y: 1 },
      { x: -1, y: -1 },
    ]
    for (let offsetIndex = 0; offsetIndex < offsets.length; offsetIndex++) {
      const offset = offsets[(index + offsetIndex) % offsets.length]
      const destination = { x: site.x + offset.x, y: site.y + offset.y }
      if (this.deps.world.isWalkable(destination.x, destination.y)) return destination
    }
    return site
  }

  public findCultShrine(cultId: string): Building | undefined {
    return [...this.deps.world.buildings.values()].find(
      (building) => building.type === BuildingType.CULT_SHRINE && building.cultId === cultId
    )
  }

  public findEmptySummoningBuilding(
    requestedName?: string | null,
    ignoredAgentIds: Set<string> = new Set(),
    preferredCultId?: string
  ): Building | undefined {
    const requested = requestedName?.trim().toLowerCase()
    // A cult's own shrine, once built, is the natural default summoning
    // site: it outranks a generic church but still yields to an explicit
    // name match.
    const preferredShrineId = preferredCultId ? this.findCultShrine(preferredCultId)?.id : undefined
    const buildings = [...this.deps.world.buildings.values()]
    const ordered = [...buildings].sort((first, second) => {
      const requestedScore = (building: Building): number => requested && (
        building.name.toLowerCase() === requested ||
        building.name.toLowerCase().includes(requested) ||
        requested.includes(building.name.toLowerCase())
      )
        ? 3
        : building.id === preferredShrineId
          ? 2
          : building.type === 'church' ? 1 : 0
      return requestedScore(second) - requestedScore(first)
    })
    return ordered.find((building) => {
      const center = this.getSummoningBuildingCenter(building)
      return this.deps.world.isWalkable(center.x, center.y) &&
        !this.deps.getAgents().some((agent) =>
          agent.state.alive &&
          !ignoredAgentIds.has(agent.state.id) &&
          this.isAgentAtSummoningBuilding(agent, building)
        )
    })
  }

  public maybeFormCultMobs(): void {
    if (this.deps.isCourtActive()) return
    const now = this.deps.getAbsoluteMinute()
    const cults = new Map<string, Agent[]>()
    for (const member of this.deps.getAgents().filter((agent) => agent.state.alive && agent.state.cult)) {
      const cultId = member.state.cult!.id
      const members = cults.get(cultId) ?? []
      members.push(member)
      cults.set(cultId, members)
    }

    for (const [cultId, members] of cults) {
      if (members.length < 2 || now < (this.state.cultMobCooldownUntil.get(cultId) ?? 0)) continue
      const lastCheck = this.state.lastCultMobCheckMinute.get(cultId)
      if (lastCheck === undefined) {
        this.state.lastCultMobCheckMinute.set(cultId, now)
        continue
      }
      if (now - lastCheck < 30) continue
      this.state.lastCultMobCheckMinute.set(cultId, now)

      const averageAggression = members.reduce(
        (total, member) => total + member.state.personality.aggression,
        0
      ) / members.length
      if (averageAggression < 0.65) continue
      const mob = members.filter((member) =>
        member.state.personality.aggression >= 0.45 &&
        !this.state.cultMobTargets.has(member.state.id) &&
        this.deps.activeBlocks.get(member.state.id)?.action.action !== 'sleep'
      )
      if (mob.length < 2) continue
      const outsiders = this.deps.getAgents().filter((candidate) =>
        candidate.state.alive &&
        candidate.state.cult?.id !== cultId &&
        ['nonbeliever', 'atheist'].includes(candidate.state.beliefSystem.religiousStance)
      )
      if (outsiders.length === 0) continue
      const formationChance = Math.min(0.2, (averageAggression - 0.6) * 0.35)
      if (Math.random() >= formationChance) continue

      const target = outsiders[Math.floor(Math.random() * outsiders.length)]
      this.state.cultMobCooldownUntil.set(cultId, now + 360)
      for (const member of mob) {
        member.closeActiveConversation()
        this.deps.activeBlocks.delete(member.state.id)
        this.state.cultMobTargets.set(member.state.id, target.state.id)
      }
      const cultName = members[0].state.cult?.name ?? 'the cult'
      const event = this.deps.eventBus.emit({
        type: 'cult_mob',
        agentId: mob[0].state.id,
        targetId: target.state.id,
        actionType: ActionType.ATTACK,
        outcome: 'formed',
        description: `${mob.map((member) => member.state.name).join(', ')} formed a mob for ${cultName} and set out to attack ${target.state.name} for rejecting religion.`,
        causationIds: [],
        worldStateDelta: {
          cultId,
          cultName,
          memberIds: mob.map((member) => member.state.id),
          targetId: target.state.id,
          averageAggression,
          formationChance,
        },
        observers: mob.map((member) => member.state.id),
      })
      for (const member of mob) member.addRecentMemory(event)
      target.addRecentMemory(event)
    }
  }

  public advanceCultMobs(): void {
    for (const [memberId, targetId] of this.state.cultMobTargets) {
      const member = this.deps.getAgents().find((agent) => agent.state.id === memberId && agent.state.alive)
      const target = this.deps.getAgents().find((agent) => agent.state.id === targetId && agent.state.alive)
      if (!member || !target || member.state.cult?.id === target.state.cult?.id) {
        this.state.cultMobTargets.delete(memberId)
        continue
      }
      if (member.distanceTo(target.state) <= 4) {
        this.deps.activeBlocks.delete(memberId)
        this.state.cultMobTargets.delete(memberId)
        this.deps.startBlock(member, {
          action: 'attack',
          target: target.state.name,
          reasoning: `Attacking ${target.state.name} as part of a cult mob`,
          dialogue: '',
          emotionalState: 'angry',
          durationMinutes: 5,
        })
        continue
      }
      const active = this.deps.activeBlocks.get(memberId)
      if (active?.action.action === 'move' && member.state.path.length > 0) continue
      this.deps.activeBlocks.delete(memberId)
      this.deps.startBlock(member, {
        action: 'move',
        target: target.state.name,
        reasoning: `Moving with a cult mob to confront ${target.state.name}`,
        dialogue: '',
        emotionalState: 'angry',
        durationMinutes: 240,
      })
    }
  }

  public buildSeekCultLeaderDecision(agent: Agent): AgentAction {
    const seeking = agent.state.seekingCultJoin
    if (!seeking) {
      return {
        action: 'idle',
        target: null,
        reasoning: 'The urge to seek out a cult has faded.',
        dialogue: '',
        emotionalState: 'neutral',
        durationMinutes: 5,
      }
    }
    const leader = this.deps.getAgents().find((candidate) =>
      candidate.state.alive &&
      candidate.state.cult?.id === seeking.cultId &&
      ['leader', 'founder'].includes(candidate.state.cult.role)
    )
    if (!leader) {
      agent.state.seekingCultJoin = undefined
      return {
        action: 'idle',
        target: null,
        reasoning: `I sought out ${seeking.cultName}, but could find no leader to receive me.`,
        dialogue: '',
        emotionalState: 'sad',
        durationMinutes: 10,
      }
    }
    const nearby = agent.distanceTo(leader.state) <= 4
    return {
      action: nearby ? 'talk' : 'move',
      target: leader.state.name,
      reasoning: `${seeking.deityName} spoke to me directly, and I believe. I must join ${seeking.cultName}.`,
      dialogue: nearby
        ? `${seeking.deityName} spoke to me. I believe now, with all my heart -- please, let me join ${seeking.cultName}.`
        : '',
      emotionalState: 'excited',
      durationMinutes: nearby ? 15 : 30,
    }
  }

  public formCult(prophet: Agent, task: PropheticTask, causationId: string): void {
    if (
      !prophet.state.alive ||
      prophet.state.currentJob !== 'Prophet' ||
      this.deps.getProphetAgentId() !== prophet.state.id
    ) return
    if (prophet.state.cult?.role === 'leader' || prophet.state.cult?.role === 'founder') return
    const name = (task.cultName?.trim() || `The Fellowship of ${prophet.state.name.split(' ')[0]}`).slice(0, 80)
    const cult = {
      id: `cult_${prophet.state.id}_${Math.round(this.deps.simManager.getSimTime())}`,
      name,
      role: 'leader' as const,
      joinedAtMinute: this.deps.getAbsoluteMinute(),
      joinMethod: 'founded' as const,
    }
    prophet.state.cult = cult
    prophet.state.cultAgendas = this.createCultLeaderAgendas(prophet)
    const event = this.deps.eventBus.emit({
      type: 'cult_formed',
      agentId: prophet.state.id,
      actionType: ActionType.TALK,
      outcome: 'founded',
      description: `${prophet.state.name} founded the cult "${name}" in response to the revelation.`,
      causationIds: [causationId],
      worldStateDelta: { cultId: cult.id, cultName: name, role: 'leader' },
      observers: [prophet.state.id],
    })
    this.deps.story.queueStoryMoment(
      'cult_formed',
      name,
      `${prophet.state.name}, the village's Prophet, founded a new cult named "${name}" in response to a divine revelation.`,
      prophet.state.id,
      event.id
    )
    prophet.addRecentMemory(event)
  }

  public completeCultShrineConstruction(leader: Agent, causationId: string): void {
    const cult = leader.state.cult
    if (!leader.state.alive || !cult || !['leader', 'founder'].includes(cult.role)) return
    if (this.findCultShrine(cult.id)) return
    if (cult.id.startsWith('cult_christian_') && Array.from(this.deps.world.buildings.values()).some((b) => b.type === BuildingType.CHURCH)) return

    const size = { w: 4, h: 4 }
    const building = this.deps.world.tryPlaceBuilding(BuildingType.CULT_SHRINE, leader.state.position, size.w, size.h, {
      cultId: cult.id,
      name: `Shrine of ${cult.name}`,
    })
    const observers = this.deps.getAgents()
      .filter((candidate) => candidate.state.alive && candidate.state.cult?.id === cult.id)
      .map((candidate) => candidate.state.id)

    if (!building) {
      const event = this.deps.eventBus.emit({
        type: 'cult_shrine_built',
        agentId: leader.state.id,
        actionType: ActionType.BUILD_SHRINE,
        outcome: 'failed',
        description: `${leader.state.name} tried to raise a shrine for ${cult.name}, but no suitable site could be found nearby.`,
        causationIds: [causationId],
        worldStateDelta: { cultId: cult.id },
        observers,
      })
      leader.addRecentMemory(event)
      return
    }

    const event = this.deps.eventBus.emit({
      type: 'cult_shrine_built',
      agentId: leader.state.id,
      actionType: ActionType.BUILD_SHRINE,
      outcome: 'built',
      description: `${leader.state.name} raised ${building.name} as a shrine for ${cult.name}. Its preaching and summoning rites will now take place there.`,
      causationIds: [causationId],
      worldStateDelta: { cultId: cult.id, buildingId: building.id, buildingName: building.name },
      observers,
    })
    for (const member of this.deps.getAgents().filter((candidate) => observers.includes(candidate.state.id))) {
      member.addRecentMemory(event)
    }
  }

  public maybeCommandCultShrineConstruction(): void {
    for (const leader of this.deps.getAgents()) {
      const cult = leader.state.cult
      if (!leader.state.alive || !cult || !['leader', 'founder'].includes(cult.role)) continue
      if (this.state.cultShrineCommandIssued.has(cult.id)) continue
      if (this.findCultShrine(cult.id)) {
        this.state.cultShrineCommandIssued.add(cult.id)
        continue
      }
      if (cult.id.startsWith('cult_christian_') && Array.from(this.deps.world.buildings.values()).some((b) => b.type === BuildingType.CHURCH)) {
        this.state.cultShrineCommandIssued.add(cult.id)
        continue
      }
      const livingMembers = this.deps.getAgents().filter(
        (candidate) => candidate.state.alive && candidate.state.cult?.id === cult.id
      )
      if (livingMembers.length < 3) continue
      this.state.cultShrineCommandIssued.add(cult.id)

      const deityName = this.deps.chooseDeityName(leader)
      const partnerId = leader.getConversationPartnerId()
      const partner = partnerId ? this.deps.getAgents().find((candidate) => candidate.state.id === partnerId) : undefined
      if (partner) this.deps.conversationManager.closeConversation(leader, partner)
      else leader.closeActiveConversation()
      this.deps.activeBlocks.delete(leader.state.id)
      this.deps.dailySchedules.delete(leader.state.id)
      this.deps.scheduleCursors.delete(leader.state.id)
      this.deps.decisionQueue.set(leader.state.id, [])
      leader.state.path = []
      leader.state.pathIndex = 0

      const event = this.deps.eventBus.emit({
        type: 'thought',
        agentId: leader.state.id,
        actionType: ActionType.BUILD_SHRINE,
        outcome: 'commanded',
        description: `${leader.state.name} feels ${deityName}'s will pressing on them: now that ${cult.name} has grown to ${livingMembers.length} members, it falls to ${leader.state.name} to raise it a shrine.`,
        causationIds: [],
        worldStateDelta: { cultId: cult.id, cultName: cult.name, deityName, memberCount: livingMembers.length },
        observers: [leader.state.id],
      })
      leader.addRecentMemory(event)
      this.deps.startBlock(leader, {
        action: 'build_shrine',
        target: null,
        reasoning: `${deityName} commands me to raise a shrine now that ${cult.name} has grown to ${livingMembers.length} members`,
        dialogue: '',
        emotionalState: 'determined',
        durationMinutes: 90,
      }, [event.id])
    }
  }

  public findMatchingCultLeader(deityName: string): Agent | undefined {
    const normalize = (name: string): string => name
      .toLowerCase()
      .replace(/^the\s+/, '')
      .replace(/[^a-z0-9]/g, '')
    const target = normalize(deityName)
    if (!target) return undefined
    return this.deps.getAgents().find((candidate) =>
      candidate.state.alive &&
      candidate.state.cult &&
      ['leader', 'founder'].includes(candidate.state.cult.role) &&
      candidate.state.beliefSystem.deities.some((deity) => normalize(deity.name) === target)
    )
  }

  public maybeTriggerWillingCultJoin(target: Agent, deityName: string, causationId: string): void {
    if (!target.state.alive || target.state.permanentInsanity) return
    if (target.state.beliefSystem.religiousStance !== 'believer') return
    if (target.state.currentJob === 'Priest') return
    const leader = this.findMatchingCultLeader(deityName)
    if (!leader?.state.cult) return
    if (target.state.cult?.id === leader.state.cult.id) return
    if (target.state.seekingCultJoin?.cultId === leader.state.cult.id) return
    target.state.seekingCultJoin = {
      cultId: leader.state.cult.id,
      cultName: leader.state.cult.name,
      deityName,
      sinceMinute: this.deps.getAbsoluteMinute(),
    }
    target.state.lastReasoning = `${deityName} has spoken to me. I must find ${leader.state.name} and join ${leader.state.cult.name}.`
    this.deps.enqueueDecision(target.state.id, {
      type: 'seek_cult_leader',
      description: `Seek out ${leader.state.name} to join ${leader.state.cult.name} after being spoken to by ${deityName}.`,
      targetAgentId: leader.state.id,
      causationIds: [causationId],
    })
  }

  public completeWillingCultJoin(agent: Agent, leader: Agent): void {
    const cult = leader.state.cult
    const seeking = agent.state.seekingCultJoin
    if (!cult || !seeking || seeking.cultId !== cult.id) return
    if (agent.state.cult?.id === cult.id) {
      agent.state.seekingCultJoin = undefined
      return
    }
    const deityName = seeking.deityName
    this.recordFormerCultOnConversion(agent)
    agent.state.cult = {
      id: cult.id,
      name: cult.name,
      role: 'member',
      joinedAtMinute: this.deps.getAbsoluteMinute(),
      recruitedByAgentId: leader.state.id,
      joinMethod: 'devotion',
    }
    agent.state.antiCultGroup = undefined
    agent.state.beliefSystem.religiousStance = 'believer'
    agent.state.beliefSystem.faith = Math.max(40, agent.state.beliefSystem.faith)
    if (agent.state.cultConversionProgress) delete agent.state.cultConversionProgress[cult.id]
    agent.state.seekingCultJoin = undefined

    const event = this.deps.eventBus.emit({
      type: 'cult_recruitment',
      agentId: agent.state.id,
      targetId: leader.state.id,
      actionType: ActionType.TALK,
      outcome: 'devotion_join',
      description: `${agent.state.name}, having heard ${deityName} speak directly to them, sought out ${leader.state.name} and joined "${cult.name}" of their own free will.`,
      causationIds: [],
      worldStateDelta: { cultId: cult.id, cultName: cult.name, joined: true, deityName, joinMethod: 'devotion' },
      observers: [agent.state.id, leader.state.id],
    })
    agent.addRecentMemory(event)
    leader.addRecentMemory(event)
    this.deps.fulfillCultRequests(cult.id, (request) => request.kind === 'grow_influence', event.id)
    this.deps.story.queueFirstCultRecruitMoment(leader, cult.id, cult.name, agent, event.id)
  }

  public attemptCultRecruitment(
    prophet: Agent,
    target: Agent,
    task: PropheticTask,
    causationId: string
  ): void {
    if (!prophet.state.alive) return
    const cult = prophet.state.cult
    if (!cult || cult.role !== 'leader' || !this.isConvertibleToCult(target, cult.id)) return
    if (this.deps.isConversionImmune(target)) {
      this.revealWorldviewToCultLeader(target, prophet, causationId)
      const event = this.deps.eventBus.emit({
        type: 'cult_recruitment',
        agentId: prophet.state.id,
        targetId: target.state.id,
        actionType: ActionType.TALK,
        outcome: 'refused',
        description: `${target.state.name} rejected ${prophet.state.name}'s invitation to join "${cult.name}" because they do not believe.`,
        causationIds: [causationId],
        worldStateDelta: { cultId: cult.id, cultName: cult.name, joined: false, conversionImmune: true },
        observers: [prophet.state.id, target.state.id],
      })
      prophet.addRecentMemory(event)
      target.addRecentMemory(event)
      return
    }
    if (this.isChristianCultConversionBlocked(target, cult.id)) {
      const event = this.deps.eventBus.emit({
        type: 'cult_recruitment',
        agentId: prophet.state.id,
        targetId: target.state.id,
        actionType: ActionType.TALK,
        outcome: 'refused',
        description: `${target.state.name} rejected ${prophet.state.name}'s invitation to join "${cult.name}", already devoted to their own faith.`,
        causationIds: [causationId],
        worldStateDelta: { cultId: cult.id, cultName: cult.name, joined: false, alreadyDevoutBeliever: true },
        observers: [prophet.state.id, target.state.id],
      })
      prophet.addRecentMemory(event)
      target.addRecentMemory(event)
      return
    }
    const relationship = target.state.relationships.find((entry) => entry.agentId === prophet.state.id)?.strength ?? 50
    const sharedDeityConfidence = this.getSharedDeityConversionConfidence(prophet, target)
    const blessingMultiplier = this.getConversionBlessingMultiplier(prophet, target)
    const politicalResistance = this.deps.hasOpposingPoliticalCamps(prophet, target)
    const isChristian = target.state.cult?.id.startsWith('cult_christian_')
    const chance = Math.max(0.1, Math.min(0.9, blessingMultiplier * (
      0.2 + prophet.state.personality.friendliness * 0.2 + prophet.state.beliefSystem.faith / 250 +
      target.state.personality.curiosity * 0.2 + relationship / 500 - target.state.personality.caution * 0.2 +
      sharedDeityConfidence / 250 - (politicalResistance ? 0.15 : 0) - (isChristian ? 0.2 : 0)
    )))
    const joined = Math.random() < chance
    const formerCult = target.state.cult
    if (joined) {
      this.recordFormerCultOnConversion(target)
      target.state.cult = {
        id: cult.id,
        name: cult.name,
        role: 'member',
        joinedAtMinute: this.deps.getAbsoluteMinute(),
        recruitedByAgentId: prophet.state.id,
        joinMethod: 'invitation',
      }
      target.state.antiCultGroup = undefined
      target.state.beliefSystem.religiousStance = 'believer'
      target.state.beliefSystem.faith = Math.max(30, target.state.beliefSystem.faith)
      if (target.state.cultConversionProgress) delete target.state.cultConversionProgress[cult.id]
    }
    const event = this.deps.eventBus.emit({
      type: 'cult_recruitment',
      agentId: prophet.state.id,
      targetId: target.state.id,
      actionType: ActionType.TALK,
      outcome: joined ? 'joined' : 'resisted',
      description: joined
        ? `${target.state.name} joined "${cult.name}" after ${prophet.state.name}'s recruitment appeal${formerCult ? `, leaving ${formerCult.name} behind` : ''}.`
        : `${target.state.name} resisted ${prophet.state.name}'s attempt to recruit them into "${cult.name}".`,
      causationIds: [causationId],
      worldStateDelta: {
        cultId: cult.id,
        cultName: cult.name,
        joined,
        sharedDeityConfidence,
        blessingMultiplier,
        politicalResistance,
        taskReasoning: task.reasoning,
        poachedFromCultId: formerCult?.id,
      },
      observers: [prophet.state.id, target.state.id],
    })
    prophet.addRecentMemory(event)
    target.addRecentMemory(event)
    if (joined) {
      this.deps.fulfillCultRequests(cult.id, (request) => request.kind === 'grow_influence', event.id)
      this.deps.story.queueFirstCultRecruitMoment(prophet, cult.id, cult.name, target, event.id)
      if (formerCult) this.deps.story.queueBelieverPoachedMoment(prophet, cult.id, cult.name, target, formerCult.name, event.id)
    }
  }

  public reconcileCultFormationFromPropheticClaims(): void {
    if (!this.deps.getProphetAgentId()) return
    const prophet = this.deps.getAgents().find((agent) => agent.state.id === this.deps.getProphetAgentId() && agent.state.alive)
    if (!prophet || prophet.state.cult) return
    const alreadyPlanned =
      this.deps.activeBlocks.get(prophet.state.id)?.propheticTask?.kind === 'form_cult' ||
      (this.deps.decisionQueue.get(prophet.state.id) ?? []).some((trigger) =>
        trigger.propheticTask?.kind === 'form_cult'
      )
    if (alreadyPlanned) return
    const claim = [...this.deps.rumours.values()].reverse().find((rumour) =>
      rumour.sourceAgentId === prophet.state.id &&
      rumour.provenance.description.includes('interpreted a divine revelation') &&
      /\b(?:cult|religious group|fellowship|order of followers|sect)\b/i.test(rumour.text)
    )
    if (!claim) return
    this.deps.activeBlocks.delete(prophet.state.id)
    this.deps.dailySchedules.delete(prophet.state.id)
    this.deps.scheduleCursors.delete(prophet.state.id)
    prophet.state.path = []
    prophet.state.pathIndex = 0
    this.deps.enqueueDecision(prophet.state.id, {
      type: 'prophetic_task',
      rumourId: claim.parentRumourId,
      propheticTask: {
        kind: 'form_cult',
        target: null,
        cultName: this.inferCultName(claim.text),
        reasoning: `Acting on the prophetic claim: ${claim.text}`,
      },
      description: `Form the group described by your prophetic claim: ${claim.text}`,
      causationIds: claim.sourceEventId ? [claim.sourceEventId] : [],
    })
  }

  public removeExtinctCults(): void {
    const cults = new Map<string, Agent[]>()
    for (const agent of this.deps.getAgents()) {
      const cultId = agent.state.cult?.id
      if (!cultId) continue
      const members = cults.get(cultId) ?? []
      members.push(agent)
      cults.set(cultId, members)
    }
    for (const members of cults.values()) {
      if (members.some((member) => member.state.alive)) continue
      const cultName = members[0]?.state.cult?.name ?? 'unknown cult'
      for (const member of members) member.state.cult = undefined
      this.deps.eventBus.emit({
        type: 'cult_dissolved',
        agentId: members[0]?.state.id ?? 'world',
        actionType: ActionType.IDLE,
        outcome: 'extinct',
        description: `${cultName} was removed after its last remaining member died.`,
        causationIds: [],
        worldStateDelta: { cultName, formerMemberIds: members.map((member) => member.state.id) },
        observers: [],
      })
    }
  }

  public handleCultLeaderKilled(event: SimulationEvent): void {
    if (event.type !== 'attack' || event.outcome !== 'death' || !event.targetId) return
    const formerLeader = this.deps.getAgents().find((agent) => agent.state.id === event.targetId)
    if (!formerLeader?.state.cult || !['leader', 'founder'].includes(formerLeader.state.cult.role)) return
    const killer = this.deps.getAgents().find((agent) => agent.state.id === event.agentId)
    const preferredSuccessor = killer?.state.alive && killer.state.cult?.id === formerLeader.state.cult.id
      ? killer.state.id
      : undefined
    this.deps.promoteCultSuccessor(
      formerLeader,
      preferredSuccessor,
      preferredSuccessor
        ? `${killer!.state.name} killed the former cult leader`
        : 'the cult leader was killed without a living cult-member killer'
    )
  }

  public reconcileCultLeadership(): void {
    const cultIds = new Set(
      this.deps.getAgents().filter((agent) => agent.state.alive && agent.state.cult).map((agent) => agent.state.cult!.id)
    )
    for (const cultId of cultIds) {
      const livingLeader = this.deps.getAgents().some((agent) =>
        agent.state.alive && agent.state.cult?.id === cultId &&
        (agent.state.cult.role === 'leader' || agent.state.cult.role === 'founder')
      )
      if (livingLeader) continue
      const formerLeader = this.deps.getAgents().find((agent) =>
        agent.state.cult?.id === cultId &&
        (agent.state.cult.role === 'leader' || agent.state.cult.role === 'founder')
      )
      if (formerLeader) this.deps.promoteCultSuccessor(formerLeader, undefined, 'the former leader is dead or exiled')
    }
  }

  public promoteCultSuccessor(
    formerLeader: Agent,
    preferredSuccessorId: string | undefined,
    reason: string
  ): void {
    const cult = formerLeader.state.cult
    if (!cult || !['leader', 'founder'].includes(cult.role)) return
    const livingMembers = this.deps.getAgents().filter((agent) =>
      agent.state.alive && agent.state.id !== formerLeader.state.id && agent.state.cult?.id === cult.id
    )
    if (livingMembers.length === 0) return
    const preferred = preferredSuccessorId
      ? livingMembers.find((member) => member.state.id === preferredSuccessorId)
      : undefined
    const successor = preferred ?? livingMembers.sort(
      (first, second) => second.state.personality.ambition - first.state.personality.ambition
    )[0]
    cult.role = 'member'
    successor.state.cult!.role = 'leader'
    successor.state.cultAgendas = this.createCultLeaderAgendas(successor)
    const event = this.deps.eventBus.emit({
      type: 'cult_leadership',
      agentId: successor.state.id,
      targetId: formerLeader.state.id,
      actionType: ActionType.TALK,
      outcome: 'succeeded',
      description: `${successor.state.name} became leader of ${cult.name} because ${reason}.`,
      causationIds: [],
      worldStateDelta: {
        cultId: cult.id,
        cultName: cult.name,
        formerLeaderId: formerLeader.state.id,
        successorId: successor.state.id,
        preferredSuccessor: Boolean(preferred),
        reason,
      },
      observers: livingMembers.map((member) => member.state.id),
    })
    for (const member of livingMembers) member.addRecentMemory(event)
    formerLeader.addRecentMemory(event)
  }

  public async generateCultName(claimText: string, revelationText: string): Promise<string> {
    const fallback = this.inferCultName(claimText)
    if (fallback !== 'The Fellowship of Revelation') return fallback
    if (this.deps.aiProvider?.isAvailable()) {
      try {
        return await this.deps.aiProvider.generateCultName(claimText, revelationText)
      } catch (error) {
        console.warn('[AgentManager] Cult name generation failed; using heuristic fallback.', error)
      }
    }
    return fallback
  }

  public inferCultName(text: string): string {
    const named = text.match(/(?:called|named)\s+["']([^"']{2,80})["']/i)?.[1]
      ?? text.match(/(?:called|named)\s+(?:the\s+)?([a-z][a-z '-]{2,60})/i)?.[1]
    return (named?.trim() || 'The Fellowship of Revelation').replace(/[.,;:]+$/, '').slice(0, 80)
  }

  public completeCultAbility(agent: Agent, action: AgentAction, causationId: string): void {
    const cult = agent.state.cult ?? (
      ['pray', 'preach'].includes(action.action) &&
      agent.state.beliefSystem.religiousStance === 'believer' &&
      agent.state.beliefSystem.deities.some((deity) => /^god$/i.test(deity.name) && deity.confidence >= 50)
        ? { id: `faith_god_${agent.state.id}`, name: 'the worshippers of God', role: 'member' as const }
        : undefined
    )
    if (!cult || !agent.state.alive) return
    if (agent.state.cult && this.isVisibleCultActivity(action.action) && this.hasNearbyPriest(agent)) {
      const concealed = this.deps.eventBus.emit({
        type: 'cult_activity_concealed',
        agentId: agent.state.id,
        actionType: ACTION_MAP[action.action] ?? ActionType.IDLE,
        outcome: 'abandoned_near_priest',
        description: `${agent.state.name} quietly abandoned a ${action.action} activity to keep ${cult.name} hidden from a nearby priest.`,
        causationIds: [causationId],
        worldStateDelta: { cultId: cult.id, cultName: cult.name, concealedAction: action.action },
        observers: [agent.state.id],
      })
      agent.addRecentMemory(concealed)
      return
    }
    const target = action.target ? this.deps.findAgentByName(action.target, this.deps.getAgents()) : undefined
    let outcome = 'completed'
    let description = `${agent.state.name} completed a ${action.action} rite for ${cult.name}.`
    const delta: Record<string, unknown> = { cultId: cult.id, cultName: cult.name, ability: action.action }

    switch (action.action) {
      case 'pray':
        agent.state.beliefSystem.faith = Math.min(100, agent.state.beliefSystem.faith + 8)
        agent.state.sanity = Math.min(100, agent.state.sanity + 6)
        agent.state.needs.energy = Math.max(0, agent.state.needs.energy - 4)
        for (const member of this.deps.getAgents().filter((candidate) => candidate.state.alive && candidate.state.cult?.id === cult.id)) {
          member.state.beliefSystem.faith = Math.min(100, member.state.beliefSystem.faith + 2)
          member.state.sanity = Math.min(100, member.state.sanity + 2)
        }
        description = `${agent.state.name} led ${cult.name} in prayer, strengthening its members' faith and calming their minds.`
        break
      case 'heal': {
        const recipient = target?.state.alive ? target : agent
        const restored = Math.min(25, recipient.state.maxHealth - recipient.state.health)
        recipient.state.health += restored
        delta.targetId = recipient.state.id
        delta.healthRestored = restored
        description = `${agent.state.name} performed a healing rite that restored ${restored} health to ${recipient.state.name}.`
        break
      }
      case 'bless': {
        const recipient = target?.state.alive ? target : agent
        recipient.state.reputation = Math.min(100, recipient.state.reputation + 5)
        recipient.state.emotionalState = EmotionalState.DETERMINED
        this.applyTimedBlessing(recipient, agent.state.id, cult.id)
        delta.targetId = recipient.state.id
        delta.abilityMultiplier = 1.5
        delta.durationMinutes = 360
        description = `${agent.state.name} blessed ${recipient.state.name}, improving their abilities for six hours.`
        break
      }
      case 'curse':
        if (target?.state.alive) {
          target.state.reputation = Math.max(0, target.state.reputation - 5)
          target.state.emotionalState = EmotionalState.AFRAID
          delta.targetId = target.state.id
          description = `${agent.state.name} placed a cult curse on ${target.state.name}, frightening them and harming their reputation.`
        } else {
          outcome = 'failed'
          description = `${agent.state.name}'s curse found no living target.`
        }
        break
      case 'resurrect':
        if (target && !target.state.alive) {
          target.state.alive = true
          target.state.health = Math.max(25, Math.round(target.state.maxHealth * 0.35))
          target.state.position = { ...agent.state.position }
          target.state.path = []
          target.state.pathIndex = 0
          target.state.emotionalState = EmotionalState.AFRAID
          this.deps.dailySchedules.delete(target.state.id)
          this.deps.scheduleCursors.delete(target.state.id)
          this.deps.enqueueDecision(target.state.id, {
            type: 'world_event',
            description: `You have been resurrected by ${agent.state.name} and ${cult.name}. Reevaluate your identity, relationships, safety, and immediate priorities.`,
            causationIds: [causationId],
          })
          delta.targetId = target.state.id
          delta.resurrected = true
          description = `${agent.state.name} and ${cult.name} resurrected ${target.state.name}.`
          const insaneCount = this.deps.applyResurrectionInsanity(target, agent.state.name, false)
          if (insaneCount > 0) {
            description += ` The sight of the dead returning to life broke the minds of ${insaneCount} who witnessed it.`
          }
        } else {
          outcome = 'failed'
          description = `${agent.state.name}'s resurrection rite failed because no dead villager was named.`
        }
        break
      case 'conjure':
        description = `${agent.state.name} completed a conjuring rite for ${cult.name}; witnesses report an unexplained manifestation.`
        break
      case 'summon': {
        const summonSite = this.deps.resolveTarget(action.target)
        const summoningMembers = agent.state.cult && summonSite
          ? this.deps.getAgents().filter((candidate) =>
              candidate.state.alive &&
              candidate.state.cult?.id === agent.state.cult?.id &&
              Math.hypot(
                candidate.state.position.x - summonSite.x,
                candidate.state.position.y - summonSite.y
              ) <= 2
            )
          : []
        if (summoningMembers.length < 3) {
          outcome = 'failed'
          delta.requiredMembers = 3
          delta.livingMembers = summoningMembers.length
          description = `${agent.state.name}'s summoning rite failed because ${cult.name} has only ${summoningMembers.length} living member${summoningMembers.length === 1 ? '' : 's'}; three are required.`
        } else {
          const newDemonSummonCredits = this.deps.grantDemonSummonCredit(summonSite!)
          delta.requiredMembers = 3
          delta.livingMembers = summoningMembers.length
          delta.demonSummonCredits = newDemonSummonCredits
          delta.summonSite = summonSite
          description = `${agent.state.name} gathered ${summoningMembers.length - 1} fellow members of ${cult.name} at ${action.target} and completed the summoning ritual, granting the user one Demon summon charge.`
        }
        break
      }
      case 'ritual':
        agent.state.beliefSystem.faith = Math.min(100, agent.state.beliefSystem.faith + 4)
        description = `${agent.state.name} completed a collective ritual for ${cult.name}.`
        break
      case 'preach':
        agent.state.reputation = Math.min(100, agent.state.reputation + 2)
        if (agent.state.cult && agent.state.cult.role === 'leader') {
          this.advanceCultConversionFromPreaching(agent, cult, causationId)
        }
        description = `${agent.state.name} publicly preached the doctrine of ${cult.name}.`
        break
    }

    const witnesses = [
      agent,
      ...agent.getNearbyAgents(this.deps.getAgents()).filter((candidate) => candidate.state.currentJob !== 'Priest'),
    ].filter((candidate, index, all) =>
      all.findIndex((entry) => entry.state.id === candidate.state.id) === index
    )
    const event = this.deps.eventBus.emit({
      type: 'cult_ability',
      agentId: agent.state.id,
      targetId: target?.state.id,
      actionType: ACTION_MAP[action.action] ?? ActionType.IDLE,
      outcome,
      description,
      causationIds: [causationId],
      worldStateDelta: delta,
      observers: witnesses.map((candidate) => candidate.state.id),
    })
    for (const witness of witnesses) witness.addRecentMemory(event)
    if (agent.state.cult && ['pray', 'ritual'].includes(action.action)) {
      this.maybeCreateCultRequest(agent, event.id)
    }
    if (agent.state.cult) this.fulfillCultRequestsFromAbility(agent, action.action, target, event.id)
  }

  public isVisibleCultActivity(action: string): boolean {
    return [
      'pray', 'preach', 'invite_cult', 'bribe', 'interrogate', 'conjure', 'summon', 'resurrect',
      'heal', 'bless', 'curse', 'ritual', 'build_shrine',
    ].includes(action)
  }

  public hasNearbyPriest(agent: Agent): boolean {
    return agent.getNearbyAgents(this.deps.getAgents()).some((candidate) =>
      candidate.state.alive && candidate.state.currentJob === 'Priest'
    )
  }

  public tryMakePriestHostile(
    priest: Agent,
    cultist: Agent,
    cause: string,
    causationId: string
  ): void {
    if (priest.state.grudges.includes(cultist.state.id)) return
    const hostilityChance = Math.min(0.9,
      0.2 + priest.state.beliefSystem.faith / 200 + priest.state.personality.aggression * 0.2
    )
    if (Math.random() >= hostilityChance) return

    priest.state.grudges.push(cultist.state.id)
    const relationship = priest.state.relationships.find((entry) => entry.agentId === cultist.state.id)
    if (relationship) {
      relationship.type = RelationshipType.ENEMY
      relationship.strength = Math.min(relationship.strength, 15)
    } else {
      priest.state.relationships.push({
        agentId: cultist.state.id,
        type: RelationshipType.ENEMY,
        strength: 15,
        lastInteraction: this.deps.simManager.getSimTime(),
      })
    }
    priest.state.emotionalState = EmotionalState.ANGRY
    const event = this.deps.eventBus.emit({
      type: 'priest_cult_hostility',
      agentId: priest.state.id,
      targetId: cultist.state.id,
      actionType: ActionType.IDLE,
      outcome: 'hostile',
      description: `${priest.state.name} became hostile toward ${cultist.state.name} and ${cultist.state.cult?.name ?? 'their cult'} after ${cause}.`,
      causationIds: [causationId],
      worldStateDelta: {
        cultId: cultist.state.cult?.id,
        hostilityChance,
        grudgeTargetId: cultist.state.id,
      },
      observers: [priest.state.id],
    })
    priest.addRecentMemory(event)
  }

  public createCultLeaderAgendas(leader: Agent): CultAgenda[] {
    const agendas: CultAgenda[] = []
    if (leader.state.personality.ambition >= 0.6) {
      agendas.push({
        kind: leader.state.personality.aggression >= 0.6 ? 'power' : 'influence',
        description: leader.state.personality.aggression >= 0.6
          ? 'Accumulate personal power and command greater obedience from the cult.'
          : 'Increase the cult’s reputation and influence across the village.',
        intensity: Math.round(leader.state.personality.ambition * 100),
      })
    }
    if (leader.state.personality.aggression >= 0.72) {
      agendas.push({
        kind: 'purge_nonbelievers',
        description: 'Remove or kill nonbelievers who resist the cult.',
        intensity: Math.round(leader.state.personality.aggression * 100),
      })
    }
    if (agendas.length === 0 || leader.state.personality.friendliness >= 0.45) {
      agendas.push({
        kind: 'expansion',
        description: 'Recruit new members and expand the cult peacefully.',
        intensity: Math.round(Math.max(leader.state.personality.ambition, leader.state.personality.friendliness) * 100),
      })
    }
    return agendas
  }

  public maybeCreateCultRequest(requester: Agent, causationId: string): void {
    const cult = requester.state.cult
    if (!cult) return
    requester.state.cultRequests ??= []
    const now = this.deps.getAbsoluteMinute()
    const latest = requester.state.cultRequests.reduce(
      (maximum, request) => Math.max(maximum, request.createdAtMinute),
      -Infinity
    )
    if (now - latest < 360) return
    for (const request of requester.state.cultRequests) {
      if (request.status === 'pending' && now - request.createdAtMinute >= 1440) request.status = 'expired'
    }

    const members = this.deps.getAgents().filter((agent) => agent.state.alive && agent.state.cult?.id === cult.id)
    const injured = members.find((member) => member.state.health < member.state.maxHealth * 0.7)
    const outsider = this.deps.getAgents().find((agent) =>
      agent.state.alive && agent.state.cult?.id !== cult.id && this.deps.isConversionImmune(agent)
    )
    const hazardousWeather = this.deps.simManager.getWeather().hazardousOutdoors
    let kind: CultRequest['kind'] = 'bless_member'
    let target: Agent | undefined = members.find((member) => member.state.id !== requester.state.id) ?? requester
    let description = `${requester.state.name} asks for ${target.state.name} to receive a blessing.`

    if (injured) {
      kind = 'heal_member'
      target = injured
      description = `${requester.state.name} prays for ${injured.state.name} to be healed.`
    } else if (hazardousWeather) {
      kind = 'better_weather'
      target = undefined
      description = `${requester.state.name} prays for safer, better weather.`
    } else if (['leader', 'founder'].includes(cult.role) && requester.state.cultAgendas?.some((agenda) => agenda.kind === 'purge_nonbelievers') && outsider) {
      kind = 'punish_nonbeliever'
      target = outsider
      description = `${requester.state.name} asks the cult to punish or kill ${outsider.state.name} for rejecting belief.`
    } else if (['leader', 'founder'].includes(cult.role) && requester.state.cultAgendas?.some((agenda) => agenda.kind === 'power')) {
      kind = 'leader_power'
      target = requester
      description = `${requester.state.name} prays for greater personal power over the cult.`
    } else if (['leader', 'founder'].includes(cult.role)) {
      kind = 'grow_influence'
      target = requester
      description = `${requester.state.name} asks for greater cult influence and more followers.`
    }

    const request: CultRequest = {
      id: `cult_request_${requester.state.id}_${Math.round(now)}`,
      cultId: cult.id,
      requesterId: requester.state.id,
      kind,
      description,
      targetAgentId: target?.state.id,
      createdAtMinute: now,
      status: 'pending',
    }
    requester.state.cultRequests.push(request)
    const event = this.deps.eventBus.emit({
      type: 'cult_request',
      agentId: requester.state.id,
      targetId: target?.state.id,
      actionType: ActionType.PRAY,
      outcome: 'requested',
      description,
      causationIds: [causationId],
      worldStateDelta: { cultId: cult.id, requestId: request.id, kind },
      observers: members.map((member) => member.state.id),
    })
    for (const member of members) member.addRecentMemory(event)
  }

  public fulfillCultRequestsFromAbility(
    actor: Agent,
    ability: string,
    target: Agent | undefined,
    eventId: string
  ): void {
    const cultId = actor.state.cult?.id
    if (!cultId) return
    const matches = (request: CultRequest): boolean => {
      if (request.status !== 'pending') return false
      if (ability === 'heal') return request.kind === 'heal_member' && (!request.targetAgentId || request.targetAgentId === target?.state.id)
      if (ability === 'bless') return ['bless_member', 'leader_power'].includes(request.kind) && (!request.targetAgentId || request.targetAgentId === target?.state.id)
      if (ability === 'preach' || ability === 'invite_cult' || ability === 'bribe') return request.kind === 'grow_influence'
      if (ability === 'curse') return request.kind === 'punish_nonbeliever' && request.targetAgentId === target?.state.id
      return false
    }
    this.deps.fulfillCultRequests(cultId, matches, eventId)
  }

  public fulfillCultRequests(
    cultId: string,
    matches: (request: CultRequest) => boolean,
    eventId: string
  ): void {
    const now = this.deps.getAbsoluteMinute()
    for (const member of this.deps.getAgents().filter((agent) => agent.state.cult?.id === cultId)) {
      for (const request of member.state.cultRequests ?? []) {
        if (!matches(request)) continue
        request.status = 'fulfilled'
        request.fulfilledAtMinute = now
        request.fulfilledByEventId = eventId
        member.state.cultDesperation = undefined
      }
    }
  }

  public fulfillRequestsFromGodAbility(
    ability: 'bless' | 'heal' | 'smite' | 'resurrect' | 'manifest' | 'weather',
    target: Agent | undefined,
    weatherCondition: WeatherCondition | undefined,
    eventId: string
  ): void {
    for (const agent of this.deps.getAgents()) {
      for (const request of agent.state.cultRequests ?? []) {
        if (request.status !== 'pending') continue
        const fulfilled =
          (ability === 'heal' && request.kind === 'heal_member' && request.targetAgentId === target?.state.id) ||
          (ability === 'bless' && ['bless_member', 'leader_power'].includes(request.kind) && request.targetAgentId === target?.state.id) ||
          (ability === 'weather' && request.kind === 'better_weather' && (weatherCondition === 'clear' || weatherCondition === 'cloudy')) ||
          (ability === 'smite' && request.kind === 'punish_nonbeliever' && request.targetAgentId === target?.state.id)
        if (!fulfilled) continue
        request.status = 'fulfilled'
        request.fulfilledAtMinute = this.deps.getAbsoluteMinute()
        request.fulfilledByEventId = eventId
        agent.state.cultDesperation = undefined
      }
    }
  }

  public maintainCultRequestsAndAgendas(): void {
    const now = this.deps.getAbsoluteMinute()
    for (const agent of this.deps.getAgents()) {
      for (const request of agent.state.cultRequests ?? []) {
        if (request.status !== 'pending' || now - request.createdAtMinute < 1440) continue
        request.status = 'expired'
        const forsakenChance = Math.max(0.1, Math.min(0.75,
          0.2 + (100 - agent.state.beliefSystem.faith) / 160 +
          agent.state.personality.aggression * 0.15 - agent.state.personality.caution * 0.1
        ))
        if (agent.state.cult && !agent.state.cultDesperation && Math.random() < forsakenChance) {
          agent.state.cultDesperation = {
            reason: `God did not answer: ${request.description}`,
            feltForsakenAtMinute: now,
            lastConsideredMinute: now,
          }
          const event = this.deps.eventBus.emit({
            type: 'cult_forsaken',
            agentId: agent.state.id,
            actionType: ActionType.PRAY,
            outcome: 'forsaken',
            description: `${agent.state.name} feels forsaken after an unanswered prayer and begins considering a sacrifice to regain God's attention.`,
            causationIds: [],
            worldStateDelta: { cultId: agent.state.cult.id, requestId: request.id, forsakenChance },
            observers: [agent.state.id],
          })
          agent.addRecentMemory(event)
        }
      }
      if (
        agent.state.cult &&
        ['leader', 'founder'].includes(agent.state.cult.role) &&
        (agent.state.cultAgendas?.length ?? 0) === 0
      ) {
        agent.state.cultAgendas = this.createCultLeaderAgendas(agent)
      }
    }
  }

  public updateForsakenCultists(): void {
    const now = this.deps.getAbsoluteMinute()
    for (const cultist of this.deps.getAgents().filter((agent) => agent.state.alive && agent.state.cult && agent.state.cultDesperation)) {
      const desperation = cultist.state.cultDesperation!
      if (now - desperation.feltForsakenAtMinute < 120 || now - desperation.lastConsideredMinute < 60) continue
      desperation.lastConsideredMinute = now
      const sacrificeChance = Math.max(0.01, Math.min(0.18,
        0.02 + cultist.state.personality.aggression * 0.08 + cultist.state.personality.ambition * 0.06 +
        cultist.state.beliefSystem.faith / 1000 - cultist.state.personality.caution * 0.08
      ))
      if (Math.random() >= sacrificeChance) continue

      const fellowMembers = this.deps.getAgents().filter((candidate) =>
        candidate.state.alive &&
        candidate.state.id !== cultist.state.id &&
        candidate.state.cult?.id === cultist.state.cult?.id &&
        cultist.distanceTo(candidate.state) <= 4
      )
      const isLeader = ['leader', 'founder'].includes(cultist.state.cult?.role ?? '')
      if (isLeader && fellowMembers.length === 0) continue
      const selfSacrificeChance = Math.max(0.15, Math.min(0.8,
        0.35 + cultist.state.beliefSystem.faith / 250 - cultist.state.personality.ambition * 0.3
      ))
      const victim = fellowMembers.length === 0 || (!isLeader && Math.random() < selfSacrificeChance)
        ? cultist
        : fellowMembers.sort((first, second) => {
            const firstRelationship = cultist.state.relationships.find((relationship) => relationship.agentId === first.state.id)?.strength ?? 50
            const secondRelationship = cultist.state.relationships.find((relationship) => relationship.agentId === second.state.id)?.strength ?? 50
            return firstRelationship - secondRelationship
          })[0]
      cultist.state.cultDesperation = undefined
      const result = this.deps.agentInteraction.handleCultSacrifice(cultist, victim, this.deps.getAgents())
      if (result.eventId) {
        this.deps.fulfillCultRequests(
          cultist.state.cult?.id ?? '',
          (request) => request.kind === 'leader_power',
          result.eventId
        )
      }
    }
  }

  public updateCultDefections(): void {
    const now = this.deps.getAbsoluteMinute()
    const candidates = this.deps.getAgents().filter((agent) =>
      agent.state.alive && agent.state.cult?.role === 'member'
    )
    for (const cultist of candidates) {
      const lastCheck = cultist.state.cultDefectionLastCheckMinute
      if (lastCheck === undefined) {
        cultist.state.cultDefectionLastCheckMinute = now
        continue
      }
      if (now - lastCheck < 60) continue
      cultist.state.cultDefectionLastCheckMinute = now
      const expiredRequests = (cultist.state.cultRequests ?? []).filter((request) => request.status === 'expired').length
      const disillusioned = cultist.state.beliefSystem.faith <= 25 || expiredRequests > 0 || Boolean(cultist.state.cultDesperation)
      if (!disillusioned) continue
      const leaveChance = Math.max(0.01, Math.min(0.3,
        0.02 + Math.max(0, 30 - cultist.state.beliefSystem.faith) / 100 +
        expiredRequests * 0.04 + cultist.state.personality.curiosity * 0.05 +
        cultist.state.personality.caution * 0.04 - cultist.state.personality.ambition * 0.04
      ))
      if (Math.random() >= leaveChance) continue
      this.leaveCultAndBecomeEnemy(cultist, leaveChance)
    }
  }

  public leaveCultAndBecomeEnemy(defector: Agent, leaveChance: number): void {
    const formerCult = defector.state.cult
    if (!formerCult) return
    const now = this.deps.getAbsoluteMinute()
    const remainingMembers = this.deps.getAgents().filter((agent) =>
      agent.state.alive && agent.state.id !== defector.state.id && agent.state.cult?.id === formerCult.id
    )
    defector.state.formerCults ??= []
    defector.state.cultEnemies ??= []
    if (!defector.state.formerCults.some((cult) => cult.id === formerCult.id)) {
      defector.state.formerCults.push({ id: formerCult.id, name: formerCult.name, leftAtMinute: now })
    }
    if (!defector.state.cultEnemies.some((cult) => cult.cultId === formerCult.id)) {
      defector.state.cultEnemies.push({ cultId: formerCult.id, cultName: formerCult.name, markedAtMinute: now })
    }
    defector.state.cult = undefined
    defector.state.cultRequests = []
    defector.state.cultAgendas = []
    defector.state.cultDesperation = undefined

    for (const member of remainingMembers) {
      if (!member.state.grudges.includes(defector.state.id)) member.state.grudges.push(defector.state.id)
      let relationship = member.state.relationships.find((entry) => entry.agentId === defector.state.id)
      if (!relationship) {
        relationship = {
          agentId: defector.state.id,
          type: RelationshipType.ENEMY,
          strength: 20,
          lastInteraction: Date.now(),
        }
        member.state.relationships.push(relationship)
      } else {
        relationship.type = RelationshipType.ENEMY
        relationship.strength = Math.min(20, relationship.strength)
        relationship.lastInteraction = Date.now()
      }
    }

    const existingGroupMember = this.deps.getAgents().find((agent) =>
      agent.state.antiCultGroup?.opposedCultId === formerCult.id
    )
    const formsOrJoinsGroup = Math.random() < Math.min(0.85,
      0.25 + defector.state.personality.ambition * 0.3 + defector.state.personality.aggression * 0.15 +
      defector.state.personality.curiosity * 0.15
    )
    if (formsOrJoinsGroup) {
      const existing = existingGroupMember?.state.antiCultGroup
      defector.state.antiCultGroup = existing
        ? { ...existing, role: 'member', joinedAtMinute: now }
        : {
            id: `anti_cult_${formerCult.id}_${defector.state.id}`,
            name: `Opposition to ${formerCult.name}`,
            opposedCultId: formerCult.id,
            opposedCultName: formerCult.name,
            founderId: defector.state.id,
            role: 'leader',
            joinedAtMinute: now,
          }
    }

    const event = this.deps.eventBus.emit({
      type: 'cult_defection',
      agentId: defector.state.id,
      actionType: ActionType.TALK,
      outcome: defector.state.antiCultGroup ? 'formed_opposition' : 'left_as_enemy',
      description: defector.state.antiCultGroup
        ? `${defector.state.name} left ${formerCult.name}, was marked as its enemy, and ${defector.state.antiCultGroup.role === 'leader' ? 'formed' : 'joined'} ${defector.state.antiCultGroup.name}.`
        : `${defector.state.name} left ${formerCult.name} and was marked as an enemy of the cult.`,
      causationIds: [],
      worldStateDelta: {
        formerCultId: formerCult.id,
        formerCultName: formerCult.name,
        formerRole: formerCult.role,
        leftAtMinute: now,
        markedAsCultEnemy: true,
        remainingMemberIds: remainingMembers.map((member) => member.state.id),
        leaveChance,
        antiCultGroupId: defector.state.antiCultGroup?.id,
        antiCultRole: defector.state.antiCultGroup?.role,
        antiCultGroup: defector.state.antiCultGroup,
      },
      observers: [defector.state.id, ...remainingMembers.map((member) => member.state.id)],
    })
    defector.addRecentMemory(event)
    for (const member of remainingMembers) member.addRecentMemory(event)
    console.log(`[CULT DEFECTION] ${event.description}`)

    const shepherd = remainingMembers.find((member) =>
      member.state.currentJob === 'Priest' &&
      (member.state.cult?.role === 'leader' || member.state.cult?.role === 'founder')
    )
    if (shepherd) this.triggerPriestFlockSuspicion(shepherd, defector, formerCult)
  }

  public triggerPriestFlockSuspicion(
    priest: Agent,
    defector: Agent,
    formerCult: { id: string; name: string }
  ): void {
    if (!priest.state.alive) return
    const text = `${defector.state.name} has left ${formerCult.name} and may be secretly drawn to a hidden cult.`
    const rumour = this.deps.createRumour(
      text,
      'invented',
      priest.state.id,
      undefined,
      0.4,
      undefined,
      { kind: 'intuition', description: `${priest.state.name}'s pastoral suspicion after a member left the flock` }
    )
    this.deps.registerAgentCreatedRumour(rumour, priest, 'invented')
    // Steers the forthcoming investigation toward interviewing the departed
    // member specifically, rather than whichever bystander is nearest.
    if (!rumour.heardBy.includes(defector.state.id)) rumour.heardBy.push(defector.state.id)
    this.deps.enqueueDecision(priest.state.id, {
      type: 'rumour',
      rumourId: rumour.id,
      description: `${defector.state.name} just left your flock, ${formerCult.name}. You do not trust that this is innocent, and you intend to investigate them.`,
      causationIds: [],
    })
  }

  public fulfillPunishmentRequestsFromEvent(event: SimulationEvent): void {
    if (event.type !== 'attack' || event.outcome !== 'death' || !event.targetId) return
    const attacker = this.deps.getAgents().find((agent) => agent.state.id === event.agentId)
    const cultId = attacker?.state.cult?.id
    if (!cultId) return
    this.deps.fulfillCultRequests(
      cultId,
      (request) => request.kind === 'punish_nonbeliever' && request.targetAgentId === event.targetId,
      event.id
    )
  }

  public static readonly PREACH_LISTEN_RADIUS = 10

  public advanceCultConversionFromPreaching(
    preacher: Agent,
    cult: { id: string; name: string; role: 'leader' | 'member' | 'founder' | 'associate' },
    causationId: string
  ): void {
    const listeners = this.deps.getAgents().filter((candidate) =>
      candidate.state.id !== preacher.state.id &&
      candidate.state.alive &&
      preacher.distanceTo(candidate.state) <= CultSystem.PREACH_LISTEN_RADIUS
    )
    this.advanceCultConversionProgress(preacher, listeners, cult, causationId, 1, 'preaching')
  }

  public advanceCultConversionFromConversation(
    leader: Agent,
    listener: Agent,
    cult: { id: string; name: string; role: 'leader' | 'member' | 'founder' | 'associate' },
    causationId: string
  ): void {
    this.advanceCultConversionProgress(leader, [listener], cult, causationId, 0.35, 'conversation')
  }

  public advanceCultConversionProgress(
    preacher: Agent,
    listeners: Agent[],
    cult: { id: string; name: string; role: 'leader' | 'member' | 'founder' | 'associate' },
    causationId: string,
    influenceScale: number,
    source: 'preaching' | 'conversation'
  ): void {
    for (const listener of listeners) {
      if (!this.isConvertibleToCult(listener, cult.id)) continue
      if (this.deps.isConversionImmune(listener)) {
        this.revealWorldviewToCultLeader(listener, preacher, causationId)
        continue
      }
      if (this.isChristianCultConversionBlocked(listener, cult.id)) continue

      const formerCult = listener.state.cult
      listener.state.cultConversionProgress ??= {}
      const previous = listener.state.cultConversionProgress[cult.id] ?? 0
      const sharedDeityConfidence = this.getSharedDeityConversionConfidence(preacher, listener)
      const blessingMultiplier = this.getConversionBlessingMultiplier(preacher, listener)
      const politicalResistance = this.deps.hasOpposingPoliticalCamps(preacher, listener)
      const baseInfluence = Math.max(5, Math.round(blessingMultiplier * influenceScale * (
        12 + preacher.state.personality.friendliness * 8 + preacher.state.beliefSystem.faith / 10 +
        listener.state.personality.curiosity * 8 - listener.state.personality.caution * 8 +
        sharedDeityConfidence / 5 - (politicalResistance ? 7 : 0)
      )))
      const isChristian = formerCult?.id.startsWith('cult_christian_')
      const influence = isChristian ? Math.max(1, Math.round(baseInfluence * 0.5)) : baseInfluence
      const progress = Math.min(100, previous + influence)
      listener.state.cultConversionProgress[cult.id] = progress
      const joined = progress >= 100
      if (joined) {
        this.recordFormerCultOnConversion(listener)
        listener.state.cult = {
          id: cult.id,
          name: cult.name,
          role: 'member',
          joinedAtMinute: this.deps.getAbsoluteMinute(),
          recruitedByAgentId: preacher.state.id,
          joinMethod: source,
        }
        listener.state.antiCultGroup = undefined
        listener.state.beliefSystem.religiousStance = 'believer'
        listener.state.beliefSystem.faith = Math.max(30, listener.state.beliefSystem.faith)
        delete listener.state.cultConversionProgress[cult.id]
      }
      const worldviewDecision = !joined
        ? this.maybeDecideWorldviewFromPreaching(listener, preacher, cult.id, progress, sharedDeityConfidence)
        : 'believer'

      const sourceVerb = source === 'preaching' ? 'preach' : 'talk'
      const sourceGerund = source === 'preaching' ? 'preaching' : 'private conversations'
      const event = this.deps.eventBus.emit({
        type: 'cult_recruitment',
        agentId: preacher.state.id,
        targetId: listener.state.id,
        actionType: ActionType.TALK,
        outcome: joined ? 'joined' : 'progressed',
        description: joined
          ? `${listener.state.name} joined "${cult.name}" after repeatedly listening to ${preacher.state.name}'s ${sourceGerund}${formerCult ? `, leaving ${formerCult.name} behind` : ''}.`
          : `${listener.state.name} moved closer to joining "${cult.name}" while listening to ${preacher.state.name} ${sourceVerb} (${progress}% converted).${worldviewDecision
              ? ` They decided their worldview and became a ${worldviewDecision}.`
              : ''}`,
        causationIds: [causationId],
        worldStateDelta: {
          cultId: cult.id,
          cultName: cult.name,
          previousProgress: previous,
          conversionProgress: progress,
          sharedDeityConfidence,
          blessingMultiplier,
          politicalResistance,
          worldviewDecision,
          joined,
          poachedFromCultId: formerCult?.id,
          source,
        },
        observers: [preacher.state.id, listener.state.id],
      })
      preacher.addRecentMemory(event)
      listener.addRecentMemory(event)
      if (joined) {
        this.deps.story.queueFirstCultRecruitMoment(preacher, cult.id, cult.name, listener, event.id)
        if (formerCult) this.deps.story.queueBelieverPoachedMoment(preacher, cult.id, cult.name, listener, formerCult.name, event.id)
      }
    }
  }

  public applyTimedBlessing(recipient: Agent, sourceAgentId: string, sourceCultId?: string): void {
    recipient.state.blessing = {
      sourceAgentId,
      sourceCultId,
      abilityMultiplier: 1.5,
      expiresAtMinute: this.deps.getAbsoluteMinute() + 360,
    }
  }

  public getBlessingAbilityMultiplier(agent: Agent): number {
    const blessing = agent.state.blessing
    if (!blessing) return 1
    if (blessing.expiresAtMinute <= this.deps.getAbsoluteMinute()) {
      agent.state.blessing = undefined
      return 1
    }
    return blessing.abilityMultiplier
  }

  public getConversionBlessingMultiplier(cultLeader: Agent, candidate: Agent): number {
    return this.deps.isConversionImmune(candidate) ? 1 : this.getBlessingAbilityMultiplier(cultLeader)
  }

  public maybeDecideWorldviewFromPreaching(
    listener: Agent,
    preacher: Agent,
    cultId: string,
    progress: number,
    sharedDeityConfidence: number
  ): 'believer' | 'nonbeliever' | null {
    if (listener.state.beliefSystem.religiousStance !== 'undecided') return null
    if (progress < 35 && sharedDeityConfidence < 60) return null
    if (Math.random() >= 0.25) return null
    const beliefChance = Math.max(0.15, Math.min(0.9,
      0.2 + progress / 200 + sharedDeityConfidence / 250 +
      preacher.state.personality.friendliness * 0.1 + listener.state.personality.curiosity * 0.1 -
      listener.state.personality.caution * 0.15
    ))
    const stance = Math.random() < beliefChance ? 'believer' : 'nonbeliever'
    listener.state.beliefSystem.religiousStance = stance
    if (stance === 'believer') {
      listener.state.beliefSystem.faith = Math.max(25, listener.state.beliefSystem.faith)
    } else {
      delete listener.state.cultConversionProgress?.[cultId]
    }
    return stance
  }

  public isConversionImmune(agent: Agent): boolean {
    return agent.state.beliefSystem.religiousStance === 'nonbeliever' ||
      agent.state.beliefSystem.religiousStance === 'atheist'
  }

  public isChristianCultConversionBlocked(candidate: Agent, cultId: string): boolean {
    return cultId.startsWith('cult_christian_') &&
      candidate.state.beliefSystem.religiousStance === 'believer'
  }

  public isConvertibleToCult(candidate: Agent, recruitingCultId: string): boolean {
    if (candidate.state.currentJob === 'Priest') return false
    const currentCultId = candidate.state.cult?.id
    if (!currentCultId) return true
    return currentCultId.startsWith('cult_christian_') && !recruitingCultId.startsWith('cult_christian_')
  }

  public recordFormerCultOnConversion(agent: Agent): void {
    const formerCult = agent.state.cult
    if (!formerCult) return
    agent.state.formerCults ??= []
    if (!agent.state.formerCults.some((entry) => entry.id === formerCult.id)) {
      agent.state.formerCults.push({
        id: formerCult.id,
        name: formerCult.name,
        leftAtMinute: this.deps.getAbsoluteMinute(),
      })
    }
  }

  public enforceConversionImmunity(): void {
    for (const agent of this.deps.getAgents()) {
      if (this.deps.isConversionImmune(agent) && agent.state.cultConversionProgress) {
        agent.state.cultConversionProgress = {}
        continue
      }
      if (!agent.state.cultConversionProgress) continue
      for (const cultId of Object.keys(agent.state.cultConversionProgress)) {
        if (this.isChristianCultConversionBlocked(agent, cultId)) {
          delete agent.state.cultConversionProgress[cultId]
        }
      }
    }
  }

  public revealWorldviewToCultLeader(target: Agent, cultLeader: Agent, causationId: string): void {
    if (target.state.religiousStanceRevealed !== false || !this.deps.isConversionImmune(target)) return
    target.state.religiousStanceRevealed = true
    const event = this.deps.eventBus.emit({
      type: 'worldview_revealed',
      agentId: target.state.id,
      targetId: cultLeader.state.id,
      actionType: ActionType.TALK,
      outcome: target.state.beliefSystem.religiousStance,
      description: `${target.state.name} revealed that they are an atheist while rejecting ${cultLeader.state.name}'s cult conversion attempt.`,
      causationIds: [causationId],
      worldStateDelta: {
        religiousStance: target.state.beliefSystem.religiousStance,
        religiousStanceRevealed: true,
      },
      observers: [target.state.id, cultLeader.state.id],
    })
    target.addRecentMemory(event)
    cultLeader.addRecentMemory(event)
  }

  public hasOpposingPoliticalCamps(leader: Agent, candidate: Agent): boolean {
    const leaderCamp = leader.state.politicalCamp?.id
    const candidateCamp = candidate.state.politicalCamp?.id
    return Boolean(leaderCamp && candidateCamp && leaderCamp !== candidateCamp)
  }

  public getSharedDeityConversionConfidence(cultLeader: Agent, candidate: Agent): number {
    const normalize = (name: string): string => name
      .toLowerCase()
      .replace(/^the\s+/, '')
      .replace(/[^a-z0-9]/g, '')
    let strongestCandidateConfidence = 0
    for (const leaderDeity of cultLeader.state.beliefSystem.deities) {
      if (leaderDeity.confidence < 50) continue
      const leaderName = normalize(leaderDeity.name)
      if (!leaderName) continue
      for (const candidateDeity of candidate.state.beliefSystem.deities) {
        if (candidateDeity.confidence < 60) continue
        const candidateName = normalize(candidateDeity.name)
        const similar = leaderName === candidateName || (
          Math.min(leaderName.length, candidateName.length) >= 4 &&
          (leaderName.includes(candidateName) || candidateName.includes(leaderName))
        )
        if (similar) strongestCandidateConfidence = Math.max(strongestCandidateConfidence, candidateDeity.confidence)
      }
    }
    return strongestCandidateConfidence
  }
}
