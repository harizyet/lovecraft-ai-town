import { Agent } from '@/agent/Agent'
import { ActionType, AgentAction, Building, BuildingType, DailySchedule, EmotionalState, ScheduleBlock } from '@/types'
import { PropheticTask } from '@/ai/AIProvider'
import { MIN_BRIBE_WEALTH } from './PoliticalSystem'
import { CultSystem } from './CultSystem'
import { ActiveBlockEntry, SystemDeps } from './SystemDeps'

const SPONTANEOUS_NIGHTMARE_FLAVORS = [
  'something vast and hungry stirring beneath the village',
  "neighbors' faces twisting into something not quite human",
  'a voice chanting words that hurt to remember',
  'the ground splitting open onto endless black water',
  'countless eyes watching from just past the firelight',
  'a shape in the fog that knew their name',
  'the church bell tolling a note no bell should make',
  'their own shadow moving a beat behind them',
]

export interface ScheduleState {
  dailySchedules: Map<string, DailySchedule>
  scheduleCursors: Map<string, number>
  activeBlocks: Map<string, ActiveBlockEntry>
  pendingActivityLabels: Map<string, string>
  idleSinceMinute: Map<string, number>
}

export function createScheduleState(): ScheduleState {
  return {
    dailySchedules: new Map(),
    scheduleCursors: new Map(),
    activeBlocks: new Map(),
    pendingActivityLabels: new Map(),
    idleSinceMinute: new Map(),
  }
}

export class ScheduleSystem {
  constructor(private deps: SystemDeps, public readonly state: ScheduleState) { }

  beginDay(day: number): void {
    this.deps.setCurrentDay(day)
    this.state.dailySchedules.clear()
    this.state.scheduleCursors.clear()
    this.state.activeBlocks.clear()
    for (const agent of this.deps.getAgents()) {
      const isKnight = agent.state.currentJob === 'Knight' || agent.state.outsider?.kind === 'knight'
      this.deps.llmRequestStatuses.set(agent.state.id, agent.state.alive && !agent.state.demon && !isKnight ? 'pending' : 'idle')
    }
    this.compactMemories()
  }

  ensureDailyPlans(): void {
    if (!this.deps.aiProvider?.isAvailable() || this.deps.isLLMRequestInFlight() || this.deps.story.hasPendingNarrations()) return

    for (const agent of this.deps.getAgents().filter((candidate) => candidate.state.alive && !candidate.state.demon)) {
      const isKnight = agent.state.currentJob === 'Knight' || agent.state.outsider?.kind === 'knight'
      if (isKnight) continue
      if (this.state.dailySchedules.has(agent.state.id) || this.deps.pendingDecisions.has(agent.state.id)) continue
      const plannedDay = this.deps.getCurrentDay()
      const promise = (async () => {
        const minuteOfDay = this.getMinuteOfDay()
        const prompt = this.deps.promptBuilder.buildDailySchedulePrompt(
          agent,
          this.deps.getAgents(),
          plannedDay,
          minuteOfDay
        )
        const blocks = await this.deps.runLLMRequestWithRetry(
          agent.state.id,
          `${agent.state.name} daily plan`,
          () => this.deps.aiProvider!.planDay(agent.state.name, prompt)
        )
        if (plannedDay !== this.deps.simManager.getDayNight().day || !agent.state.alive) return
        if (this.deps.decisionQueue.get(agent.state.id)?.some((trigger) =>
          trigger.type === 'world_event' || trigger.type === 'prophecy'
        )) {
          // The plan was generated before a priority event arrived. Discard it
          // so a new event-informed schedule is requested afterward.
          return
        }
        if (this.state.activeBlocks.get(agent.state.id)?.fallback) {
          this.state.activeBlocks.delete(agent.state.id)
        }
        const prayerRepaired = this.deps.ensureBelieverPrayerBlock(agent, blocks, minuteOfDay)
        const repairedBlocks = this.ensureNightSleepBlock(agent, prayerRepaired, minuteOfDay)
        this.state.dailySchedules.set(agent.state.id, { day: plannedDay, blocks: repairedBlocks })
        this.state.scheduleCursors.set(agent.state.id, 0)
        this.deps.coordinateScheduledSummons()
        console.log(`[AgentManager] Planned ${repairedBlocks.length} blocks for ${agent.state.name} on day ${plannedDay}`)
      })()

      this.deps.setLLMRequestInFlight(true)
      this.state.pendingActivityLabels.set(agent.state.id, 'planning the day')
      this.deps.pendingDecisions.set(agent.state.id, promise)
      promise
        .catch((error) => {
          console.error(`[AgentManager] Failed to apply ${agent.state.name}'s completed daily plan:`, error)
        })
        .finally(() => {
          this.deps.pendingDecisions.delete(agent.state.id)
          this.state.pendingActivityLabels.delete(agent.state.id)
          this.deps.setLLMRequestInFlight(false)
        })
      return
    }
  }

  startDueScheduleBlocks(): void {
    const minuteOfDay = this.getMinuteOfDay()
    for (const agent of this.deps.getAgents().filter((candidate) => candidate.state.alive && !candidate.state.demon)) {
      if (
        this.state.activeBlocks.has(agent.state.id) ||
        this.deps.pendingDecisions.has(agent.state.id) ||
        (this.deps.decisionQueue.get(agent.state.id)?.length ?? 0) > 0
      ) continue
      const schedule = this.state.dailySchedules.get(agent.state.id)
      if (!schedule) continue

      let cursor = this.state.scheduleCursors.get(agent.state.id) ?? 0
      while (cursor < schedule.blocks.length) {
        const block = schedule.blocks[cursor]
        if (block.startMinute + block.durationMinutes > minuteOfDay) break
        cursor++
      }
      this.state.scheduleCursors.set(agent.state.id, cursor)

      const block = schedule.blocks[cursor]
      if (block && block.startMinute <= minuteOfDay) {
        this.startBlock(agent, block)
        this.state.scheduleCursors.set(agent.state.id, cursor + 1)
      }
    }
  }

  startBlock(
    agent: Agent,
    action: AgentAction,
    causationIds: string[] = [],
    rumourId?: string,
    fallback = false,
    propheticTask?: PropheticTask
  ): void {
    if (agent.isInsane()) {
      if (action.action === 'sleep' || action.action === 'eat' || action.action === 'rest') {
        action.action = 'idle'
        action.target = null
        action.dialogue = ''
        action.reasoning = `Fractured mind prevents ${action.action}; obsessively pacing and muttering instead.`
      }
    }
    if (action.action === 'build') {
      action.action = 'work'
      action.target = this.deps.findJobBuilding(agent)?.name ?? null
      action.dialogue = ''
      action.reasoning = 'Construction is disabled; returning to ordinary work'
    }
    const isCultLeader = agent.state.cult != null && ['leader', 'founder'].includes(agent.state.cult.role)
    if ((agent.state.currentJob === 'Prophet' || isCultLeader) && action.action === 'work') {
      action.action = agent.state.cult ? 'preach' : 'pray'
      action.target = this.deps.findBuildingOfType(agent, 'church')?.name ?? null
      action.dialogue = ''
      action.reasoning = agent.state.cult
        ? `Serving as leader of ${agent.state.cult.name} through preaching and religious organization`
        : 'Devoting working hours to prayer and interpretation of divine guidance'
      if (action.action === 'preach') {
        // Cap preaching blocks short so leaders cycle back to it often instead
        // of preaching once and vanishing into a multi-hour work block.
        action.durationMinutes = Math.min(60, action.durationMinutes ?? 60)
      }
    }
    const cultAbilities = ['pray', 'conjure', 'summon', 'resurrect', 'heal', 'bless', 'curse', 'ritual', 'preach']
    const personalWorship = ['pray', 'preach'].includes(action.action) &&
      agent.state.beliefSystem.religiousStance === 'believer'
    if (cultAbilities.includes(action.action) && !agent.state.cult && !personalWorship) {
      action.action = 'work'
      action.target = this.deps.findJobBuilding(agent)?.name ?? null
      action.dialogue = ''
      action.reasoning = 'Returning to ordinary duties because cult rites require cult membership'
    }
    if (action.action === 'invite_cult' && (
      !agent.state.cult || agent.state.cult.role !== 'leader'
    )) {
      action.action = 'work'
      action.target = this.deps.findJobBuilding(agent)?.name ?? null
      action.dialogue = ''
      action.reasoning = agent.state.cult?.role === 'founder'
        ? 'The Church of Christ does not actively recruit outsiders; its founder only shepherds those who already believe'
        : 'Returning to ordinary duties because only a cult leader can invite members'
    }
    if (action.action === 'bribe' && (
      !action.target ||
      action.target === agent.state.name ||
      agent.state.wealth < MIN_BRIBE_WEALTH
    )) {
      action.action = 'work'
      action.target = this.deps.findJobBuilding(agent)?.name ?? null
      action.dialogue = ''
      action.reasoning = 'Returning to ordinary duties: too little wealth, or no one named, to make a worthwhile bribe'
    }
    if (action.action === 'build_shrine') {
      const isLeader = Boolean(agent.state.cult && ['leader', 'founder'].includes(agent.state.cult.role))
      const alreadyHasShrine = isLeader && Boolean(this.deps.findCultShrine(agent.state.cult!.id))
      const isChurchOfChristWithChurch = isLeader &&
        agent.state.cult!.id.startsWith('cult_christian_') &&
        Array.from(this.deps.world.buildings.values()).some((b) => b.type === BuildingType.CHURCH)

      if (!isLeader || alreadyHasShrine || isChurchOfChristWithChurch) {
        action.action = 'work'
        action.target = this.deps.findJobBuilding(agent)?.name ?? null
        action.dialogue = ''
        action.reasoning = !isLeader
          ? 'Only a cult leader can raise a shrine for the cult'
          : alreadyHasShrine
            ? 'The cult already has a shrine'
            : 'The Church of Christ already has a church in the world'
      }
    }
    if (action.action === 'summon') {
      const emptyLocation = this.deps.findEmptySummoningBuilding(action.target, undefined, agent.state.cult?.id)
      if (!agent.state.cult || !['leader', 'founder'].includes(agent.state.cult.role) || !emptyLocation) {
        action.action = 'ritual'
        action.target = null
        action.reasoning = emptyLocation
          ? 'A summoning must be led by the cult leader'
          : 'The summoning was postponed because no known ritual location was empty'
      } else {
        action.target = emptyLocation.name
      }
    }
    if (action.action === 'interrogate') {
      const target = action.target ? this.deps.findAgentByName(action.target, this.deps.getAgents()) : undefined
      const priestHasInquiry = ['Priest', 'Inquisitor'].includes(agent.state.currentJob ?? '') &&
        (agent.state.knownCultGroups?.length ?? 0) > 0
      const cultistInquiry = Boolean(agent.state.cult)
      if (!target?.state.alive || target.state.id === agent.state.id || (!priestHasInquiry && !cultistInquiry)) {
        action.action = 'work'
        action.target = this.deps.findJobBuilding(agent)?.name ?? null
        action.dialogue = ''
        action.reasoning = priestHasInquiry || cultistInquiry
          ? 'Returning to ordinary duties because no valid interrogation target was named'
          : 'Investigation must establish a cult before a priest can interrogate suspected members'
      }
    }
    if (action.action === 'call_inquisitor' && !this.deps.canPriestCallInquisitor(agent)) {
      action.action = 'work'
      action.target = this.deps.findJobBuilding(agent)?.name ?? null
      action.dialogue = ''
      action.reasoning = this.deps.isInquisitorOutsiderSpawned()
        ? 'An Inquisitor has already answered the town’s call'
        : 'A Priest must confirm at least two cultists by interrogation before calling an Inquisitor'
    }
    if (agent.state.cult && this.deps.isVisibleCultActivity(action.action) && this.deps.hasNearbyPriest(agent)) {
      action.action = 'rest'
      action.target = null
      action.dialogue = ''
      action.reasoning = 'Keeping cult activity hidden while a priest is nearby'
    }
    if (action.action === 'investigate' && !rumourId) {
      const undecidedRumour = [...this.deps.rumours.values()].reverse().find(
        (rumour) =>
          rumour.heardBy.includes(agent.state.id) &&
          this.deps.isAgentUndecidedAboutRumour(agent.state.id, rumour.id) &&
          this.deps.isRumourUnresolved(rumour.id)
      )
      if (undecidedRumour) {
        rumourId = undecidedRumour.id
        const authority = this.deps.getInvestigationAuthority(agent, undecidedRumour) ?? 'personal fact finding'
        this.deps.prepareInvestigationDecision(agent, action, undecidedRumour, authority)
      } else {
        action.action = 'work'
        action.target = this.deps.findJobBuilding(agent)?.name ?? null
        action.dialogue = ''
        action.reasoning = 'Returning to regular duties because no rumour remains undecided'
      }
    }
    const eventId = this.deps.executeLLMDecision(agent, action, causationIds)
    if (propheticTask?.kind === 'form_cult') {
      // Founding is a state transition, not a delayed reward. Commit it as
      // soon as the formation action starts so another urgent trigger or a
      // save/reload cannot erase the cult before the timed block completes.
      this.deps.formCult(agent, propheticTask, eventId)
    }
    this.state.activeBlocks.set(agent.state.id, {
      action,
      endsAt: this.deps.getAbsoluteMinute() + (action.durationMinutes ?? 30),
      eventId,
      rumourId: action.action === 'investigate' ? rumourId : undefined,
      fallback,
      propheticTask,
    })
    if (action.action === 'summon') this.deps.gatherCultForSummoning(agent, action)
  }

  ensureFallbackActivities(): void {
    for (const agent of this.deps.getAgents()) {
      if (!agent.state.alive) continue
      if (this.state.activeBlocks.has(agent.state.id)) continue
      if ((this.deps.decisionQueue.get(agent.state.id)?.length ?? 0) > 0) continue
      if (this.deps.pendingDecisions.has(agent.state.id)) continue
      const jobBuilding = this.deps.findJobBuilding(agent)
      const isDivine = agent.state.currentJob === 'Priest' || agent.state.currentJob === 'Prophet' || agent.state.cult !== undefined
      const isPreaching = agent.state.cult?.role === 'leader' || agent.state.currentJob === 'Priest'
      this.startBlock(agent, {
        action: isDivine ? (agent.state.cult ? 'preach' : 'pray') : 'work',
        target: isDivine
          ? this.deps.findBuildingOfType(agent, 'church')?.name ?? null
          : jobBuilding?.name ?? null,
        reasoning: isDivine
          ? 'Continuing divine and cult duties while waiting for the daily plan'
          : 'Continuing normal duties while waiting for the daily plan',
        dialogue: '',
        emotionalState: 'neutral',
        // Preaching cycles on a short block so a leader with no active daily
        // plan keeps returning to it instead of preaching once every 4 hours.
        durationMinutes: isPreaching ? 60 : 240,
      }, [], undefined, true)
    }
  }

  completeFinishedBlocks(): void {
    const now = this.getAbsoluteMinute()
    for (const [agentId, active] of this.state.activeBlocks) {
      const agent = this.deps.getAgents().find((candidate) => candidate.state.id === agentId)
      if (!agent?.state.alive) {
        this.state.activeBlocks.delete(agentId)
        continue
      }
      if (active.summonLeaderId && active.summonSite) {
        const leaderBlock = this.state.activeBlocks.get(active.summonLeaderId)
        if (!leaderBlock || leaderBlock.action.action !== 'summon') {
          this.state.activeBlocks.delete(agentId)
          continue
        }
        const leader = this.deps.getAgents().find((candidate) => candidate.state.id === active.summonLeaderId)
        const hasBeenInvited = leaderBlock.summonInvitedMemberIds?.includes(agentId) ?? false
        if (hasBeenInvited && leader?.state.alive) {
          const memberIndex = leaderBlock.summonedMemberIds?.indexOf(agentId) ?? 0
          const destination = leaderBlock.summonPhase === 'travelling' && leaderBlock.summonSite
            ? this.deps.getSummoningParticipantSlot(leaderBlock.summonSite, Math.max(0, memberIndex))
            : leader.state.position
          const distanceToDestination = Math.hypot(
            agent.state.position.x - destination.x,
            agent.state.position.y - destination.y
          )
          if (distanceToDestination > 0.75 && (
            agent.state.path.length === 0 || agent.state.pathIndex >= agent.state.path.length
          )) {
            agent.moveTo(destination.x, destination.y)
          }
        }
        active.endsAt = now + 10
        continue
      }
      if (active.action.action === 'summon' && active.summonSite) {
        if (this.deps.advanceSummoningProcess(agent, active, now)) continue
      }
      const movementFinished =
        active.action.action === 'move' &&
        (agent.state.path.length === 0 || agent.state.pathIndex >= agent.state.path.length)
      const stillTravellingHome =
        active.action.action === 'sleep' &&
        agent.state.path.length > 0 &&
        agent.state.pathIndex < agent.state.path.length
      if (stillTravellingHome) continue
      if (active.action.action === 'sleep' && active.sleepStartedAt === undefined) {
        active.sleepStartedAt = now
        active.endsAt = now + (active.action.durationMinutes ?? 120)
        agent.state.dream = undefined
        this.rollSpontaneousNightmare(agent)
        continue
      }
      if (now < active.endsAt && !movementFinished) continue

      if (active.rumourId && active.action.action === 'investigate') {
        if (!active.investigationInterviewStarted) {
          active.endsAt = now + 10
          continue
        }
        const interviewStillActive =
          agent.getConversationPartnerId() === active.investigationIntervieweeId ||
          (active.investigationIntervieweeId !== undefined && (
            this.deps.pendingDecisions.has(active.investigationIntervieweeId) ||
            (this.deps.decisionQueue.get(active.investigationIntervieweeId)?.length ?? 0) > 0
          ))
        if (interviewStillActive) {
          active.endsAt = now + 10
          continue
        }
      }

      this.state.activeBlocks.delete(agentId)
      if (active.fallback) continue
      if (active.demonAttackTargetId) {
        const target = this.deps.getAgents().find((candidate) =>
          candidate.state.id === active.demonAttackTargetId && candidate.state.alive
        )
        if (target) {
          this.startBlock(agent, {
            action: agent.distanceTo(target.state) <= 4 ? 'attack' : 'move',
            target: target.state.name,
            reasoning: `[user command] Pursuing ${target.state.name}`,
            dialogue: '',
            emotionalState: 'angry',
            durationMinutes: agent.distanceTo(target.state) <= 4 ? 10 : 60,
          })
          const pursuit = this.state.activeBlocks.get(agentId)
          if (pursuit?.action.action === 'move') pursuit.demonAttackTargetId = target.state.id
          continue
        }
      }
      if (active.action.action === 'preach') {
        const preachTarget = active.action.target ? this.deps.findAgentByName(active.action.target, this.deps.getAgents()) : undefined
        const shrine = agent.state.cult ? this.deps.findCultShrine(agent.state.cult.id) : undefined
        const stillTraveling = preachTarget?.state.alive
          ? agent.distanceTo(preachTarget.state) > CultSystem.PREACH_LISTEN_RADIUS - 3
          : Boolean(shrine) && (() => {
              const center = this.deps.getSummoningBuildingCenter(shrine!)
              return Math.hypot(agent.state.position.x - center.x, agent.state.position.y - center.y) > 3
            })()
        if (stillTraveling) {
          this.startBlock(agent, { ...active.action, durationMinutes: 15 }, [active.eventId])
          continue
        }
        this.deps.completeCultAbility(agent, active.action, active.eventId)
      } else if (['pray', 'conjure', 'summon', 'resurrect', 'heal', 'bless', 'curse', 'ritual'].includes(active.action.action)) {
        this.deps.completeCultAbility(agent, active.action, active.eventId)
      }
      if (active.action.action === 'build_shrine') {
        this.deps.completeCultShrineConstruction(agent, active.eventId)
      }
      if (active.action.action === 'invite_cult') {
        const target = active.action.target ? this.deps.findAgentByName(active.action.target, this.deps.getAgents()) : undefined
        if (target?.state.alive) {
          if (agent.distanceTo(target.state) <= 4) {
            this.deps.attemptCultRecruitment(agent, target, {
              kind: 'convert',
              target: target.state.name,
              reasoning: active.action.reasoning,
            }, active.eventId)
          } else {
            this.startBlock(agent, { ...active.action, durationMinutes: 10 }, [active.eventId])
            continue
          }
        }
      }
      if (active.action.action === 'bribe') {
        const target = active.action.target ? this.deps.findAgentByName(active.action.target, this.deps.getAgents()) : undefined
        if (target?.state.alive) {
          if (agent.distanceTo(target.state) <= 4) {
            if (this.deps.canAttemptCultBribery(agent, target)) {
              this.deps.attemptCultBribery(agent, target, active.action.reasoning, active.eventId)
            } else {
              this.deps.attemptFavorBribery(agent, target, active.action.reasoning, active.eventId)
            }
          } else {
            this.startBlock(agent, { ...active.action, durationMinutes: 10 }, [active.eventId])
            continue
          }
        }
      }
      if (active.action.action === 'interrogate') {
        const target = active.action.target ? this.deps.findAgentByName(active.action.target, this.deps.getAgents()) : undefined
        if (target?.state.alive && agent.distanceTo(target.state) > 4) {
          this.startBlock(agent, { ...active.action, durationMinutes: 10 }, [active.eventId])
          continue
        }
        this.deps.completeAffiliationInterrogation(agent, active.action, active.eventId)
      }
      if (active.propheticTask) {
        const target = active.propheticTask.target
          ? this.deps.findAgentByName(active.propheticTask.target, this.deps.getAgents())
          : undefined
        if (active.propheticTask.kind === 'form_cult') {
          this.deps.formCult(agent, active.propheticTask, active.eventId)
        } else if (active.propheticTask.kind === 'convert' && target?.state.alive) {
          this.deps.attemptCultRecruitment(agent, target, active.propheticTask, active.eventId)
        }
        const completed = active.propheticTask.kind === 'sacrifice'
          ? Boolean(target && !target.state.alive)
          : active.action.action !== 'move'
        if (!completed) {
          this.deps.enqueueDecision(agentId, {
            type: 'prophetic_task',
            rumourId: active.rumourId,
            propheticTask: active.propheticTask,
            description: `Continue fulfilling the prophetic command: ${active.propheticTask.reasoning}`,
            causationIds: [active.eventId],
          })
          continue
        }
        const completionEvent = this.deps.eventBus.emit({
          type: 'prophetic_task_completed',
          agentId,
          targetId: target?.state.id,
          actionType: active.action.action === 'attack' ? ActionType.ATTACK : ActionType.IDLE,
          outcome: 'completed',
          description: `${agent.state.name} completed the prophetic task: ${active.propheticTask.reasoning}`,
          causationIds: [active.eventId],
          worldStateDelta: { taskKind: active.propheticTask.kind },
          observers: [agentId],
        })
        agent.addRecentMemory(completionEvent)
      }
      if (active.action.reasoning.startsWith('[idle recovery]')) {
        const target = active.action.target
          ? this.deps.findAgentByName(active.action.target, this.deps.getAgents())
          : undefined
        if (target?.state.alive && !agent.isConversationActive()) {
          this.deps.enqueueDecision(agentId, {
            type: 'idle_recovery',
            targetAgentId: target.state.id,
            description: `You sought out ${target.state.name} because you had been inactive. Start a conversation with them now, or continue approaching if they moved away.`,
            causationIds: [active.eventId],
          })
          continue
        }
      }
      const investigationFinding = active.rumourId
        ? this.deps.completeRumourInvestigation(active.rumourId, agent, active.eventId)
        : undefined
      this.deps.enqueueDecision(agentId, {
        type: 'task_complete',
        description: investigationFinding ?? `${agent.state.name} completed the ${active.action.action} block: ${active.action.reasoning}`,
        causationIds: [active.eventId],
      })
    }
  }

  enforceExhaustionSleep(): void {
    for (const agent of this.deps.getAgents().filter((candidate) => candidate.state.alive && !candidate.state.demon && !candidate.isInsane())) {
      if (agent.state.needs.energy > 0) continue
      if (this.state.activeBlocks.get(agent.state.id)?.action.action === 'sleep') continue

      const partnerId = agent.getConversationPartnerId()
      const partner = partnerId
        ? this.deps.getAgents().find((candidate) => candidate.state.id === partnerId)
        : undefined
      if (partner) this.deps.conversationManager.closeConversation(agent, partner)
      else agent.closeActiveConversation()

      this.state.activeBlocks.delete(agent.state.id)
      const home = this.deps.findBuildingOfType(agent, 'home')
      this.startBlock(agent, {
        action: 'sleep',
        target: home?.name ?? null,
        reasoning: 'Too exhausted to continue; going home to sleep',
        dialogue: '',
        emotionalState: 'tired',
        durationMinutes: 120,
      })
    }
  }

  enforceNightSleep(): void {
    if (this.deps.simManager.getDayNight().isDaytime) return
    for (const agent of this.deps.getAgents().filter((candidate) =>
      candidate.state.alive && !candidate.state.demon && !candidate.isInsane() && !candidate.state.outsider
    )) {
      if (this.state.activeBlocks.get(agent.state.id)?.action.action === 'sleep') continue

      const partnerId = agent.getConversationPartnerId()
      const partner = partnerId
        ? this.deps.getAgents().find((candidate) => candidate.state.id === partnerId)
        : undefined
      if (partner) this.deps.conversationManager.closeConversation(agent, partner)
      else agent.closeActiveConversation()

      this.state.activeBlocks.delete(agent.state.id)
      const home = this.deps.findBuildingOfType(agent, 'home')
      this.startBlock(agent, {
        action: 'sleep',
        target: home?.name ?? null,
        reasoning: 'Nightfall has come; heading home to sleep',
        dialogue: '',
        emotionalState: 'tired',
        durationMinutes: 120,
      })
    }
  }

  enforceWeatherSafety(): void {
    const weather = this.deps.simManager.getWeather()
    if (weather.condition !== 'storm') return
    for (const [agentId, active] of this.state.activeBlocks) {
      const agent = this.deps.getAgents().find((candidate) => candidate.state.id === agentId)
      if (!agent?.state.alive || agent.state.demon) continue
      if (!this.isAgentOutdoors(agent)) continue
      const shelter = this.findNearestIndoorShelter(agent)
      if (!shelter || active.action.target === shelter.name) continue
      this.startBlock(agent, {
        action: 'move',
        target: shelter.name,
        reasoning: `Seeking shelter from the ${weather.condition}`,
        dialogue: '',
        emotionalState: 'afraid',
        durationMinutes: 30,
      }, [active.eventId])
    }
  }

  isAgentOutdoors(agent: Agent): boolean {
    const building = this.deps.world.getBuildingAt(
      Math.round(agent.state.position.x),
      Math.round(agent.state.position.y)
    )
    return !building || building.type === BuildingType.PARK || building.type === BuildingType.TOWN_SQUARE
  }

  findNearestIndoorShelter(agent: Agent): Building | null {
    const outdoorTypes = new Set([BuildingType.PARK, BuildingType.TOWN_SQUARE])
    const shelters = Array.from(this.deps.world.buildings.values()).filter(
      (building) => !outdoorTypes.has(building.type)
    )
    if (shelters.length === 0) return null

    return shelters.reduce((nearest, candidate) => {
      const distance = Math.hypot(
        agent.state.position.x - (candidate.position.x + candidate.size.x / 2),
        agent.state.position.y - (candidate.position.y + candidate.size.y / 2)
      )
      const nearestDistance = Math.hypot(
        agent.state.position.x - (nearest.position.x + nearest.size.x / 2),
        agent.state.position.y - (nearest.position.y + nearest.size.y / 2)
      )
      return distance < nearestDistance ? candidate : nearest
    })
  }

  preventProlongedIdle(): void {
    const now = this.getAbsoluteMinute()
    for (const agent of this.deps.getAgents().filter((candidate) => candidate.state.alive && !candidate.state.demon)) {
      const agentId = agent.state.id
      const inactive =
        !this.state.activeBlocks.has(agentId) &&
        !this.deps.pendingDecisions.has(agentId) &&
        (this.deps.decisionQueue.get(agentId)?.length ?? 0) === 0 &&
        !agent.isConversationActive() &&
        (agent.state.path.length === 0 || agent.state.pathIndex >= agent.state.path.length)
      if (!inactive) {
        this.state.idleSinceMinute.delete(agentId)
        continue
      }
      const idleSince = this.state.idleSinceMinute.get(agentId) ?? now
      this.state.idleSinceMinute.set(agentId, idleSince)
      if (now - idleSince < 15) continue

      const target = this.deps.findNearestAvailableSocialTarget(agent)
      this.deps.enqueueDecision(agentId, {
        type: 'idle_recovery',
        targetAgentId: target?.state.id,
        description: target
          ? `You have had no activity for 15 simulated minutes. Seek out ${target.state.name} and start a conversation rather than remaining idle.`
          : 'You have had no activity for 15 simulated minutes. Find something useful to do rather than remaining idle.',
        causationIds: [],
      })
      this.state.idleSinceMinute.delete(agentId)
    }
  }

  getRemainingSchedule(agentId: string): DailySchedule | undefined {
    const schedule = this.state.dailySchedules.get(agentId)
    if (!schedule) return undefined
    const cursor = this.state.scheduleCursors.get(agentId) ?? 0
    return { ...schedule, blocks: schedule.blocks.slice(cursor) }
  }

  getMinuteOfDay(): number {
    const clock = this.deps.simManager.getDayNight()
    return clock.hour * 60 + clock.minute
  }

  getAbsoluteMinute(): number {
    const clock = this.deps.simManager.getDayNight()
    return (clock.day - 1) * 1440 + this.getMinuteOfDay()
  }

  compactMemories(): void {
    const maxSummaryLength = 1500
    for (const agent of this.deps.getAgents()) {
      const recent = agent.state.memory.recent
      if (recent.length <= 15) continue
      const older = recent.slice(0, -15).map((event) => event.description).join('; ')
      const combined = [agent.state.memory.summary, older].filter(Boolean).join('; ')
      agent.state.memory.summary = this.trimSummaryToEntryBoundary(combined, maxSummaryLength)
      agent.state.memory.recent = recent.slice(-15)
    }
  }

  // A raw slice(-maxLength) can land mid-entry, so the displayed summary
  // always started with a fragment of whatever event happened to fall on the
  // cut point. Trimming forward to the next "; " boundary keeps the summary
  // starting cleanly at a whole entry instead.
  trimSummaryToEntryBoundary(summary: string, maxLength: number): string {
    if (summary.length <= maxLength) return summary
    const truncated = summary.slice(summary.length - maxLength)
    const boundary = truncated.indexOf('; ')
    return boundary === -1 ? truncated : truncated.slice(boundary + 2)
  }

  resetSchedulesLocationsAndQueries(): { success: boolean; message: string; relocated: number } {
    const queryEpoch = this.deps.bumpQueryEpoch()
    this.deps.pendingDecisions.clear()
    this.state.pendingActivityLabels.clear()
    this.deps.decisionQueue.clear()
    this.state.dailySchedules.clear()
    this.state.scheduleCursors.clear()
    this.state.activeBlocks.clear()
    this.deps.resetCrossSystemStateForRefresh()
    this.deps.setLLMRequestInFlight(false)
    for (const rumour of this.deps.rumours.values()) {
      if (rumour.resolutionCourt?.status !== 'resolved') rumour.resolutionCourt = undefined
    }

    const occupied = new Set<string>()
    let relocated = 0
    for (const agent of this.deps.getAgents().filter((candidate) => candidate.state.alive)) {
      agent.closeActiveConversation()
      agent.state.path = []
      agent.state.pathIndex = 0
      let position: { x: number; y: number } | undefined
      for (let attempt = 0; attempt < 100; attempt++) {
        const candidate = this.deps.findRandomWalkablePosition()
        const key = `${candidate.x},${candidate.y}`
        if (!occupied.has(key)) {
          position = candidate
          occupied.add(key)
          break
        }
      }
      position ??= this.deps.findRandomWalkablePosition()
      agent.state.position = position
      agent.state.lastReasoning = 'Schedule, movement, and pending-query state were refreshed by simulation controls.'
      const isKnight = agent.state.currentJob === 'Knight' || agent.state.outsider?.kind === 'knight'
      this.deps.llmRequestStatuses.set(agent.state.id, (agent.state.demon || isKnight) ? 'idle' : 'pending')
      this.state.idleSinceMinute.set(agent.state.id, this.getAbsoluteMinute())
      relocated++
    }

    const event = this.deps.eventBus.emit({
      type: 'simulation_maintenance',
      agentId: 'simulation',
      actionType: ActionType.IDLE,
      outcome: 'agents_refreshed',
      description: `Simulation controls refreshed schedules, locations, conversations, and pending queries for ${relocated} living agents.`,
      causationIds: [],
      worldStateDelta: { relocated, queryEpoch },
      observers: this.deps.getAgents().filter((agent) => agent.state.alive).map((agent) => agent.state.id),
    })
    for (const agent of this.deps.getAgents().filter((candidate) => candidate.state.alive)) agent.addRecentMemory(event)
    return {
      success: true,
      relocated,
      message: `Refreshed ${relocated} living agents without resetting village history or identities.`,
    }
  }

  // Cult-unaligned villagers are otherwise the only ones exempt from
  // ReligionSystem.plantDream's shielding, so they're also the ones whose
  // dreams can turn on them unprompted: each time one starts a fresh sleep,
  // roll a low chance the town's own ambient corruption bleeds into their
  // sleeping mind as a nightmare, worse the frailer their sanity already is.
  private rollSpontaneousNightmare(agent: Agent): void {
    if (agent.state.cult) return
    const corruption = this.deps.getTownCorruptionLevel()
    if (corruption <= 0) return
    const sanityFactor = Math.max(0.2, (100 - agent.state.sanity) / 100)
    const chancePercent = Math.min(15, 2 * corruption * (0.5 + sanityFactor))
    if (Math.random() * 100 >= chancePercent) return

    const flavor = SPONTANEOUS_NIGHTMARE_FLAVORS[Math.floor(Math.random() * SPONTANEOUS_NIGHTMARE_FLAVORS.length)]
    const previousSanity = agent.state.sanity
    agent.state.sanity = Math.max(0, previousSanity - (3 + Math.round(Math.random() * 7)))
    agent.state.emotionalState = EmotionalState.AFRAID
    agent.state.lastReasoning = `I dreamed of ${flavor}. I woke shaking, and I do not know why it felt so real.`
    agent.state.dream = {
      plantedBy: 'spontaneous',
      biasText: flavor,
      isNightmare: true,
      plantedAtMinute: this.getAbsoluteMinute(),
    }

    const event = this.deps.eventBus.emit({
      type: 'dream_planted',
      agentId: agent.state.id,
      actionType: ActionType.IDLE,
      outcome: 'nightmare',
      description: `${agent.state.name} woke from a nightmare of ${flavor}, sanity slipping from ${previousSanity.toFixed(0)} to ${agent.state.sanity.toFixed(0)}.`,
      causationIds: [],
      worldStateDelta: { isNightmare: true, biasText: flavor, corruption },
      observers: [agent.state.id],
    })
    agent.addRecentMemory(event)
  }

  public ensureNightSleepBlock(agent: Agent, blocks: ScheduleBlock[], minuteOfDay: number): ScheduleBlock[] {
    if (agent.isInsane()) return blocks

    const home = this.deps.findBuildingOfType(agent, 'home')
    const targetHomeName = home?.name ?? null

    const sleep1Start = Math.max(0, minuteOfDay)
    const sleep1End = 360 // 06:00 AM
    const sleep2Start = Math.max(1320, minuteOfDay) // 22:00 PM
    const sleep2End = 1440 // Midnight

    const cleanedBlocks: ScheduleBlock[] = []

    for (const block of blocks) {
      let blockStart = block.startMinute
      let blockEnd = block.startMinute + block.durationMinutes

      // Trim Sleep 1 window
      if (sleep1Start < sleep1End && blockStart < sleep1End && blockEnd > sleep1Start) {
        blockStart = Math.max(blockStart, sleep1End)
      }

      // Trim Sleep 2 window
      if (sleep2Start < sleep2End && blockStart < sleep2End && blockEnd > sleep2Start) {
        blockEnd = Math.min(blockEnd, sleep2Start)
      }

      const duration = blockEnd - blockStart
      if (duration >= 5) {
        cleanedBlocks.push({
          ...block,
          startMinute: blockStart,
          durationMinutes: duration,
        })
      }
    }

    // Now inject the sleep blocks
    if (sleep1Start < sleep1End) {
      cleanedBlocks.push({
        id: `repaired_sleep_morning_${Date.now()}_${Math.floor(Math.random() * 1000)}`,
        startMinute: sleep1Start,
        durationMinutes: sleep1End - sleep1Start,
        action: 'sleep',
        target: targetHomeName,
        reasoning: 'Prioritizing rest during night hours',
        dialogue: '',
        emotionalState: 'tired',
      })
    }

    if (sleep2Start < sleep2End) {
      cleanedBlocks.push({
        id: `repaired_sleep_night_${Date.now()}_${Math.floor(Math.random() * 1000)}`,
        startMinute: sleep2Start,
        durationMinutes: sleep2End - sleep2Start,
        action: 'sleep',
        target: targetHomeName,
        reasoning: 'Prioritizing rest during night hours',
        dialogue: '',
        emotionalState: 'tired',
      })
    }

    return cleanedBlocks.sort((a, b) => a.startMinute - b.startMinute)
  }
}
