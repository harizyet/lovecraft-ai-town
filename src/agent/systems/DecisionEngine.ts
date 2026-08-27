import { Agent } from '@/agent/Agent'
import { ActionType, AgentAction, DecisionTrigger, EmotionalState, LLMRequestStatus, SimulationEvent } from '@/types'
import { LLMQueryStats, PropheticInterpretation } from '@/ai/AIProvider'
import { RumourSystem } from './RumourSystem'
import { CultSystem } from './CultSystem'
import { ReligionSystem } from './ReligionSystem'
import { JusticeSystem } from './JusticeSystem'
import { PoliticalSystem } from './PoliticalSystem'
import { StorySystem } from './StorySystem'
import { ScheduleSystem } from './ScheduleSystem'
import { SocialSystem } from './SocialSystem'
import { OutsiderSystem } from './OutsiderSystem'
import { SystemDeps } from './SystemDeps'

// Duplicated from AgentManager's module-level maps (kept private there)
// rather than imported, to avoid a circular import between AgentManager.ts
// and this file. Mirrors the approach already used by CultSystem.ts.
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

const EMOTION_MAP: Record<string, EmotionalState> = {
  happy: EmotionalState.HAPPY,
  neutral: EmotionalState.NEUTRAL,
  sad: EmotionalState.SAD,
  angry: EmotionalState.ANGRY,
  afraid: EmotionalState.AFRAID,
  excited: EmotionalState.EXCITED,
  tired: EmotionalState.TIRED,
  hungry: EmotionalState.HUNGRY,
  panicked: EmotionalState.PANICKED,
  grieving: EmotionalState.GRIEVING,
  ambivalent: EmotionalState.AMBIVALENT,
  determined: EmotionalState.DETERMINED,
}

export interface DecisionEngineState {
  decisionQueue: Map<string, DecisionTrigger[]>
  pendingDecisions: Map<string, Promise<void>>
  llmRequestStatuses: Map<string, LLMRequestStatus>
  llmRequestInFlight: boolean
  queryEpoch: number
  llmQueryStats: LLMQueryStats
  processedEventIds: Set<string>
}

export function createDecisionEngineState(): DecisionEngineState {
  return {
    decisionQueue: new Map(),
    pendingDecisions: new Map(),
    llmRequestStatuses: new Map(),
    llmRequestInFlight: false,
    queryEpoch: 0,
    llmQueryStats: { made: 0, successful: 0 },
    processedEventIds: new Set(),
  }
}

// Direct references to the other extracted systems -- DecisionEngine is the
// last thing extracted from AgentManager and depends on virtually all of
// them, so a narrow SystemDeps callback surface for each individual method
// it needs would balloon SystemDeps far more than a typed reference bag.
export interface DecisionEngineSystems {
  rumourSystem: RumourSystem
  cultSystem: CultSystem
  religionSystem: ReligionSystem
  justiceSystem: JusticeSystem
  politicalSystem: PoliticalSystem
  storySystem: StorySystem
  scheduleSystem: ScheduleSystem
  socialSystem: SocialSystem
  outsiderSystem: OutsiderSystem
}

export class DecisionEngine {
  constructor(
    private deps: SystemDeps,
    private systems: DecisionEngineSystems,
    public readonly state: DecisionEngineState
  ) {}

  isAgentRefreshCancellation(error: unknown): boolean {
    return error instanceof Error && error.message.includes('cancelled by an agent-state refresh')
  }

  shouldCancelRequestForCourt(agentId: string, label: string): boolean {
    // This guard exists to drop an agent's own routine LLM request (a daily
    // plan, a prophecy) when that same agent is urgently needed in a court
    // or policy vote. Story moment narration isn't that -- it's a global
    // chronicle entry that happens to be tagged with an agent's id only for
    // status-tracking, so it must never be cancelled just because that
    // agent (e.g. a prominent Priest) is also a court/policy participant.
    if (/court|verdict|policy|story moment/i.test(label)) return false
    if (this.systems.justiceSystem.state.activeCourtRumourId) {
      const court = this.deps.rumours.get(this.systems.justiceSystem.state.activeCourtRumourId)?.resolutionCourt
      if (court && (court.accusedAgentId === agentId || court.participantIds.includes(agentId))) return true
    }
    if (this.systems.politicalSystem.state.activePolicySessionId) {
      const session = this.systems.politicalSystem.state.policySessions.get(this.systems.politicalSystem.state.activePolicySessionId)
      if (session?.participantIds.includes(agentId)) return true
    }
    return false
  }

  enqueueDecision(agentId: string, trigger: DecisionTrigger): void {
    const queue = this.state.decisionQueue.get(agentId) ?? []
    if (trigger.eventId && queue.some((queued) => queued.eventId === trigger.eventId)) return
    if (trigger.type === 'world_event' || trigger.type === 'prophecy' || trigger.type === 'seek_cult_leader') queue.unshift(trigger)
    else queue.push(trigger)
    this.state.decisionQueue.set(agentId, queue)
    if (!this.state.pendingDecisions.has(agentId)) {
      const agent = this.deps.getAgents().find((a) => a.state.id === agentId)
      const isKnight = agent?.state.currentJob === 'Knight' || agent?.state.outsider?.kind === 'knight'
      this.state.llmRequestStatuses.set(agentId, isKnight ? 'idle' : 'pending')
    }
  }

  mergeTriggers(triggers: DecisionTrigger[]): DecisionTrigger {
    const primary = triggers[triggers.length - 1]
    const rumourId = [...triggers].reverse().find((trigger) => trigger.rumourId)?.rumourId
    return {
      ...primary,
      rumourId,
      description: triggers.map((trigger) => trigger.description).join('\n'),
      causationIds: [...new Set(triggers.flatMap((trigger) => trigger.causationIds))],
    }
  }

  applyReputationEffect(event: SimulationEvent): void {
    const actor = this.deps.getAgents().find((agent) => agent.state.id === event.agentId)
    if (!actor) return

    let delta = 0
    if (event.type === 'attack') delta = event.outcome === 'death' ? -15 : -10
    else if (event.type === 'theft' && event.outcome === 'success') delta = -12
    else if (event.type === 'destroy_building' && event.outcome === 'destroyed') delta = -10
    else if (event.type === 'help' && event.outcome === 'healed') delta = 6
    else if (event.type === 'build' && event.outcome === 'built') delta = 4
    else if (event.type === 'investigation' && event.actionType === ActionType.INVESTIGATE) delta = 3

    if (delta !== 0) {
      actor.state.reputation = Math.max(0, Math.min(100, actor.state.reputation + delta))
    }
  }

  handleDecisionEvent(event: SimulationEvent): void {
    if (this.state.processedEventIds.has(event.id)) return
    this.state.processedEventIds.add(event.id)
    if (this.state.processedEventIds.size > 1000) {
      this.state.processedEventIds = new Set(Array.from(this.state.processedEventIds).slice(-500))
    }
    this.applyReputationEffect(event)

    if (event.worldStateDelta.summoningInvitation === true) return

    if (event.type === 'weather') {
      for (const agent of this.deps.getAgents().filter((candidate) => candidate.state.alive)) {
        agent.addRecentMemory(event)
      }
      return
    }

    if (event.type === 'attack' && event.outcome === 'injury' && event.targetId) {
      this.systems.justiceSystem.sendAttackVictimToAuthority(event)
    }

    const interactionEvent =
      event.type === 'conversation' ||
      event.type === 'attack' ||
      event.type === 'theft' ||
      event.type === 'death' ||
      (event.type === 'help' && event.outcome === 'healed')
    if (interactionEvent && event.targetId && event.targetId !== event.agentId) {
      const target = this.deps.getAgents().find((candidate) => candidate.state.id === event.targetId)
      const speaker = this.deps.getAgents().find((candidate) => candidate.state.id === event.agentId)
      const conversation = event.type === 'conversation' ? target?.getActiveConversation() : null
      if (conversation && conversation.exchanges.length >= conversation.maxTurns) {
        if (target && speaker) this.deps.conversationManager.closeConversation(target, speaker)
      } else if (
        event.type === 'conversation' &&
        this.systems.socialSystem.state.pregeneratedConversations.has(this.systems.socialSystem.conversationPairKey(event.agentId, event.targetId))
      ) {
        // The rest of this exchange is pre-written; advancePregeneratedConversations drives it directly.
      } else {
        this.enqueueDecision(event.targetId, {
          type: 'interaction',
          description: event.description,
          eventId: event.id,
          causationIds: [event.id],
        })
      }
    }

    if (event.type === 'conversation') {
      this.systems.rumourSystem.maybeSpreadRumour(event)
      this.systems.religionSystem.maybeResolveReligiousConversion(event)
    }

    this.systems.rumourSystem.maybeCreateNaturalRumour(event)

    const notableWorldEvent = ['death', 'destroy_building', 'build'].includes(event.type)
    if (notableWorldEvent) {
      const source = this.deps.getAgents().find((candidate) => candidate.state.id === event.agentId)
      if (!source) return
      for (const observer of this.deps.getAgents()) {
        if (!observer.state.alive || observer.state.id === event.agentId || observer.state.id === event.targetId) continue
        if (observer.distanceTo(source.state) <= 8) {
          observer.addRecentMemory(event)
          this.enqueueDecision(observer.state.id, {
            type: 'world_event',
            description: event.description,
            eventId: event.id,
            causationIds: [event.id],
          })
        }
      }
    }
  }

  processDecisionQueue(): void {
    if (!this.deps.aiProvider?.isAvailable() || this.state.llmRequestInFlight || this.systems.storySystem.hasPendingNarrations()) return

    const queuedAgents = Array.from(this.state.decisionQueue.entries()).sort(
      ([firstId, firstTriggers], [secondId, secondTriggers]) =>
        Number(secondTriggers.some((trigger) => trigger.type === 'prophecy' || trigger.type === 'prophetic_task' || trigger.type === 'seek_cult_leader')) -
        Number(firstTriggers.some((trigger) => trigger.type === 'prophecy' || trigger.type === 'prophetic_task' || trigger.type === 'seek_cult_leader')) ||
        Number(secondTriggers.some((trigger) => trigger.type === 'world_event')) -
        Number(firstTriggers.some((trigger) => trigger.type === 'world_event')) ||
        Number(this.systems.rumourSystem.hasPrioritySheriffRumour(secondId, secondTriggers)) -
        Number(this.systems.rumourSystem.hasPrioritySheriffRumour(firstId, firstTriggers))
    )
    for (const [agentId, triggers] of queuedAgents) {
      if (triggers.length === 0 || this.state.pendingDecisions.has(agentId)) continue
      if (this.systems.scheduleSystem.state.activeBlocks.has(agentId) && !triggers.some((trigger) =>
        trigger.type === 'prophecy' || trigger.type === 'prophetic_task' || trigger.type === 'world_event' || trigger.type === 'seek_cult_leader'
      )) continue
      const agent = this.deps.getAgents().find((candidate) => candidate.state.id === agentId)
      if (!agent?.state.alive) {
        this.state.decisionQueue.delete(agentId)
        continue
      }
      const isKnight = agent.state.currentJob === 'Knight' || agent.state.outsider?.kind === 'knight'
      if (agent.state.demon || isKnight) {
        this.state.decisionQueue.delete(agentId)
        continue
      }

      const priorityProphecyIndex = triggers.findIndex((candidate) =>
        candidate.type === 'prophecy' || candidate.type === 'prophetic_task' || candidate.type === 'seek_cult_leader'
      )
      const priorityWorldEventIndex = priorityProphecyIndex < 0
        ? triggers.findIndex((candidate) => candidate.type === 'world_event')
        : -1
      const priorityRumourIndex = priorityProphecyIndex < 0 && priorityWorldEventIndex < 0 && agent.state.currentJob === 'Sheriff'
        ? triggers.findIndex((candidate) => candidate.rumourId &&
            this.systems.rumourSystem.isRumourUnresolved(candidate.rumourId) &&
            this.systems.rumourSystem.isAgentUndecidedAboutRumour(agentId, candidate.rumourId))
        : -1
      const selectedTriggers = priorityProphecyIndex >= 0
        ? triggers.splice(priorityProphecyIndex, 1)
        : priorityWorldEventIndex >= 0
        ? triggers.splice(priorityWorldEventIndex, 1)
        : priorityRumourIndex >= 0
        ? triggers.splice(priorityRumourIndex, 1)
        : triggers.splice(0)
      const trigger = this.mergeTriggers(selectedTriggers)
      const promise = (async () => {
        const conversationPartnerId = agent.getConversationPartnerId()
        const conversation = agent.getActiveConversation()
        const lastExchange = conversation?.exchanges[conversation.exchanges.length - 1]
        const mustRespondToPartner =
          conversationPartnerId !== null &&
          lastExchange !== undefined &&
          lastExchange.speakerId !== agentId
        const schedule = this.deps.getRemainingSchedule(agentId)
        let decision: AgentAction
        if (trigger.type === 'prophetic_task' && trigger.propheticTask) {
          decision = this.systems.religionSystem.buildPropheticTaskDecision(agent, trigger.propheticTask)
        } else if (trigger.type === 'seek_cult_leader') {
          decision = this.systems.cultSystem.buildSeekCultLeaderDecision(agent)
        } else if (trigger.type === 'prophecy' && trigger.rumourId) {
          const revelation = this.deps.rumours.get(trigger.rumourId)
          if (!revelation) return
          const deityName = revelation.provenance.deityName ?? 'The Divine'
          let interpretation: PropheticInterpretation
          try {
            interpretation = await this.deps.runLLMRequestWithRetry(
              agentId,
              `${agent.state.name} prophetic interpretation`,
              () => this.deps.aiProvider!.interpretDivineRevelation(
                agent.state.name,
                this.deps.promptBuilder.buildPropheticInterpretationPrompt(
                  agent, this.deps.getAgents(), revelation.text, deityName
                )
              ),
              4
            )
          } catch (error) {
            if (this.isAgentRefreshCancellation(error)) return
            console.warn(`[AgentManager] ${agent.state.name}'s prophetic interpretation failed after four attempts; using a command-aware fallback.`, error)
            interpretation = this.systems.religionSystem.buildFallbackPropheticInterpretation(agent, revelation, deityName)
          }
          decision = await this.systems.religionSystem.applyPropheticInterpretation(agent, revelation, interpretation, trigger.causationIds)
        } else {
          const prompt = this.deps.promptBuilder.buildTriggeredDecisionPrompt(
            agent,
            this.deps.getAgents(),
            trigger,
            schedule,
            this.systems.socialSystem.state.lastActions.get(agentId),
            this.deps.conversationManager.getConversationContext(agent, this.deps.getAgents()),
            [
              trigger.rumourId ? this.systems.rumourSystem.buildBeliefActionContext(agent, trigger.rumourId) : '',
              this.systems.rumourSystem.buildRumourConversationContext(agent, conversationPartnerId),
            ].filter(Boolean).join('\n')
          )
          decision = await this.deps.runLLMRequestWithRetry(
            agentId,
            `${agent.state.name} ${trigger.type} decision`,
            () => this.deps.aiProvider!.decide(agent.state.name, prompt)
          )
        }
        if (
          trigger.type !== 'world_event' && trigger.type !== 'prophecy' &&
          this.state.decisionQueue.get(agentId)?.some((queued) => queued.type === 'world_event' || queued.type === 'prophecy')
        ) {
          return
        }
        const activeCourt = this.systems.justiceSystem.state.activeCourtRumourId
          ? this.deps.rumours.get(this.systems.justiceSystem.state.activeCourtRumourId)?.resolutionCourt
          : undefined
        if (
          activeCourt &&
          (activeCourt.participantIds.includes(agent.state.id) ||
            activeCourt.accusedAgentId === agent.state.id)
        ) {
          // This request began before court was convened. Discard its stale
          // result so it cannot pull a participant away from the proceeding.
          return
        }
        if (this.systems.scheduleSystem.state.activeBlocks.get(agentId)?.summonLeaderId) {
          // Discard a response requested before ritual selection so it cannot
          // replace deterministic following with a conversational reaction.
          return
        }
        if (mustRespondToPartner && conversationPartnerId) {
          this.systems.socialSystem.forceConversationResponse(agent, decision, conversationPartnerId)
        }
        if (trigger.rumourId && trigger.type !== 'prophecy' && trigger.type !== 'prophetic_task') {
          const rumour = this.deps.rumours.get(trigger.rumourId)
          if (rumour && this.systems.rumourSystem.findKnownDeceased(agent, rumour)) {
            decision.emotionalState = 'grieving'
          }
          const authority = rumour ? this.systems.rumourSystem.getInvestigationAuthority(agent, rumour) : null
          const sheriffMayInvestigate = agent.state.currentJob === 'Sheriff' && rumour?.status === 'investigating'
          const shouldInvestigate = rumour && authority && !rumour.archived &&
            this.systems.rumourSystem.isAgentUndecidedAboutRumour(agentId, rumour.id) &&
            (rumour.status === 'unverified' || sheriffMayInvestigate) &&
            !rumour.investigatorIds.includes(agent.state.id)
          if (shouldInvestigate && rumour && authority) {
            if (mustRespondToPartner) {
              this.systems.rumourSystem.ensureRumourMentioned(agent, decision, rumour, false)
              this.enqueueDecision(agentId, {
                type: 'rumour',
                description: `Follow up on your authority to investigate this rumour: "${rumour.text}"`,
                rumourId: rumour.id,
                causationIds: trigger.causationIds,
              })
            } else {
              this.systems.rumourSystem.prepareInvestigationDecision(agent, decision, rumour, authority)
            }
          } else if (
            rumour &&
            !this.systems.rumourSystem.isAgentUndecidedAboutRumour(agentId, rumour.id) &&
            decision.action === 'investigate'
          ) {
            decision.action = 'work'
            decision.target = this.deps.findJobBuilding(agent)?.name ?? null
            decision.dialogue = ''
            decision.durationMinutes = 30
            decision.reasoning = `Returning to regular duties after deciding the rumour is ${this.systems.rumourSystem.getOrCreateRumourBelief(rumour, agent).stance === 'believer' ? 'credible' : 'not credible'}`
          }
          if (rumour) {
            const belief = this.systems.rumourSystem.getOrCreateRumourBelief(rumour, agent)
            if (
              belief.stance === 'believer' &&
              decision.justiceResponse &&
              this.systems.rumourSystem.findAccusedAgent(rumour)?.state.id !== agent.state.id
            ) {
              belief.justiceResponse = decision.justiceResponse
              belief.justiceResponseExplicit = true
            }
          }
          if (rumour && ['talk', 'attack', 'steal', 'help'].includes(decision.action)) {
            const mutation = this.systems.rumourSystem.maybeMutateRumour(agent, rumour)
            if (mutation.id !== rumour.id && decision.action === 'talk') {
              const mutationLine = `The story may be different now: ${mutation.text}`
              decision.dialogue = decision.dialogue?.trim()
                ? `${decision.dialogue.trim()} ${mutationLine}`
                : mutationLine
            }
          }
          if (rumour) this.systems.rumourSystem.attachHostileActionToBelief(agent, rumour, decision)
          this.systems.rumourSystem.recordRumourResponse(trigger.rumourId, agent, decision)
        }
        if (trigger.type === 'idle_recovery') {
          const socialTarget = this.deps.getAgents().find((candidate) =>
            candidate.state.id === trigger.targetAgentId &&
            candidate.state.alive &&
            !candidate.isConversationActive()
          ) ?? this.systems.socialSystem.findNearestAvailableSocialTarget(agent)
          if (socialTarget) {
            const nearby = agent.distanceTo(socialTarget.state) <= 4
            decision.action = nearby ? 'talk' : 'move'
            decision.target = socialTarget.state.name
            decision.durationMinutes = nearby ? 15 : 30
            decision.reasoning = `[idle recovery] Seeking out ${socialTarget.state.name} for social contact after prolonged inactivity.`
            if (nearby && !decision.dialogue?.trim()) {
              decision.dialogue = `Hi, ${socialTarget.state.name.split(' ')[0]}. I thought I'd come see how you're doing.`
            }
          } else {
            decision.action = 'work'
            decision.target = this.deps.findJobBuilding(agent)?.name ?? null
            decision.reasoning = '[idle recovery] Staying occupied because nobody is currently available to talk.'
            decision.durationMinutes = 30
          }
        }
        const isAlreadySleeping = this.systems.scheduleSystem.state.activeBlocks.get(agent.state.id)?.action.action === 'sleep'
        const isInReligiousFervour = this.systems.religionSystem.state.religiousFervourTargets.has(agent.state.id)
        if (agent.state.alive && !isAlreadySleeping && !isInReligiousFervour) {
          this.systems.scheduleSystem.startBlock(agent, decision, trigger.causationIds, trigger.rumourId, false, trigger.propheticTask)
        }
      })()

      this.state.llmRequestInFlight = true
      const pendingRumourInvestigation = trigger.rumourId
        ? this.systems.rumourSystem.isAgentUndecidedAboutRumour(agentId, trigger.rumourId) &&
          Boolean(this.systems.rumourSystem.getInvestigationAuthority(agent, this.deps.rumours.get(trigger.rumourId)!))
        : false
      const pendingLabel = trigger.type === 'rumour'
        ? pendingRumourInvestigation
          ? 'planning a rumour investigation'
          : 'reacting to a rumour'
        : trigger.type === 'prophecy'
          ? 'interpreting a divine revelation'
        : trigger.type === 'prophetic_task'
          ? 'fulfilling a prophetic command'
        : trigger.type === 'interaction'
          ? 'thinking about an interaction'
          : trigger.type === 'idle_recovery'
            ? 'looking for someone to talk to'
          : 'thinking'
      this.systems.scheduleSystem.state.pendingActivityLabels.set(agentId, pendingLabel)
      this.state.pendingDecisions.set(agentId, promise)
      promise
        .catch((error) => {
          console.error(`[AgentManager] Failed to apply ${agent.state.name}'s completed decision:`, error)
        })
        .finally(() => {
          this.state.pendingDecisions.delete(agentId)
          this.systems.scheduleSystem.state.pendingActivityLabels.delete(agentId)
          this.state.llmRequestInFlight = false
        })
      return
    }
  }

  executeLLMDecision(agent: Agent, decision: AgentAction, causationIds: string[] = []): string {
    const actionType = ACTION_MAP[decision.action] ?? ActionType.IDLE
    const emotion = EMOTION_MAP[decision.emotionalState] ?? EmotionalState.NEUTRAL

    agent.state.emotionalState = emotion
    agent.state.lastReasoning = decision.reasoning
    let targetId: string | null = null
    let description = decision.reasoning

    switch (decision.action) {
      case 'move': {
        const target = this.deps.resolveTarget(decision.target)
        if (target) {
          agent.moveTo(target.x, target.y)
          description = `Moving to ${decision.target ?? 'a location'}`
        } else {
          const randomPos = this.deps.findRandomWalkablePosition()
          agent.moveTo(randomPos.x, randomPos.y)
          description = 'Wandering'
        }
        break
      }

      case 'talk': {
        agent.state.path = []
        agent.state.pathIndex = 0
        const nearby = agent.getNearbyAgents(this.deps.getAgents())
        if (nearby.length > 0) {
          const targetAgent = decision.target
            ? this.deps.findAgentByName(decision.target, nearby)
            : nearby[Math.floor(Math.random() * nearby.length)]
          if (targetAgent) this.systems.rumourSystem.ensurePendingRumourShare(agent, targetAgent, decision)
          if (
            targetAgent &&
            agent.state.seekingCultJoin &&
            targetAgent.state.cult?.id === agent.state.seekingCultJoin.cultId &&
            ['leader', 'founder'].includes(targetAgent.state.cult.role)
          ) {
            this.systems.cultSystem.completeWillingCultJoin(agent, targetAgent)
          }
          if (
            targetAgent &&
            agent.state.beliefSystem.religiousStance === 'believer' &&
            targetAgent.state.beliefSystem.religiousStance === 'undecided'
          ) {
            const conversionChance = Math.min(0.45, 0.08 + agent.state.beliefSystem.faith / 300)
            if (Math.random() < conversionChance) {
              const appeal = `I hope you will consider faith in God and keep your heart open to belief.`
              decision.dialogue = decision.dialogue?.trim()
                ? `${decision.dialogue.trim()} ${appeal}`
                : appeal
            }
          }
          if (targetAgent && decision.dialogue) {
            const simTime = this.deps.simManager.getSimTime()
            const status = this.deps.conversationManager.checkConversationEligibility(agent, targetAgent, simTime)

            if (status === 'tooFar') {
              description = `${targetAgent.state.name} is too far to talk to`
            } else if (status === 'busy') {
              description = `${targetAgent.state.name} is already talking to someone else`
            } else if (status === 'cooldown') {
              description = 'Too soon to talk to them again'
            } else if (status === 'active') {
              const added = this.deps.conversationManager.addTurn(agent, targetAgent, decision.dialogue, simTime)
              if (added) {
                this.deps.agentInteraction.handleConversation(agent, targetAgent, decision.dialogue)
                targetId = targetAgent.state.id
                description = `Continuing conversation with ${targetAgent.state.name}: ${decision.dialogue}`
              } else {
                description = `Could not continue conversation with ${targetAgent.state.name}`
              }
            } else {
              const topic = decision.reasoning || 'general'
              const started = this.deps.conversationManager.initiateConversation(
                agent,
                targetAgent,
                decision.dialogue,
                topic,
                simTime
              )
              if (started) {
                this.deps.agentInteraction.handleConversation(agent, targetAgent, decision.dialogue)
                this.systems.socialSystem.maybeBatchGenerateConversation(agent, targetAgent, agent, decision.dialogue, topic)
                targetId = targetAgent.state.id
                description = `Started conversation with ${targetAgent.state.name}: ${decision.dialogue}`
              } else {
                description = `Could not start conversation with ${targetAgent.state.name}`
              }
            }
          } else if (!decision.dialogue) {
            description = 'Wanted to talk but had nothing to say'
          }
        }
        break
      }

      case 'work': {
        agent.state.path = []
        agent.state.pathIndex = 0
        this.deps.worldInteraction.handleWork(agent, this.deps.getAgents())
        description = 'Working'
        break
      }

      case 'investigate': {
        const destination = this.deps.resolveTarget(decision.target)
        if (destination) agent.moveTo(destination.x, destination.y)
        else {
          agent.state.path = []
          agent.state.pathIndex = 0
        }
        description = decision.reasoning
        break
      }

      case 'interrogate': {
        const target = decision.target ? this.deps.findAgentByName(decision.target, this.deps.getAgents()) : undefined
        targetId = target?.state.id ?? null
        if (target?.state.alive && agent.distanceTo(target.state) > 4) {
          agent.moveTo(Math.round(target.state.position.x), Math.round(target.state.position.y))
          description = `${agent.state.name} is approaching ${target.state.name} for interrogation.`
        } else {
          agent.state.path = []
          agent.state.pathIndex = 0
          description = target
            ? `${agent.state.name} began interrogating ${target.state.name} about a hidden affiliation.`
            : `${agent.state.name} could not identify anyone to interrogate.`
        }
        break
      }

      case 'call_inquisitor': {
        agent.state.path = []
        agent.state.pathIndex = 0
        const inquisitor = this.systems.outsiderSystem.createOutsider('inquisitor', agent)
        targetId = inquisitor?.state.id ?? null
        description = inquisitor
          ? `${agent.state.name} called upon ${inquisitor.state.name}, an Inquisitor from outside the town.`
          : `${agent.state.name} could not call another Inquisitor.`
        break
      }

      case 'rest': {
        const home = this.deps.findBuildingOfType(agent, 'home')
        if (home) {
          agent.moveTo(home.position.x + 1, home.position.y + 1)
          agent.rest()
          description = 'Resting at home'
        } else {
          agent.state.path = []
          agent.state.pathIndex = 0
          agent.rest()
          description = 'Taking a rest'
        }
        break
      }

      case 'cry': {
        agent.state.path = []
        agent.state.pathIndex = 0
        description = decision.reasoning || `${agent.state.name} stopped to cry`
        break
      }

      case 'pray':
      case 'conjure':
      case 'summon':
      case 'resurrect':
      case 'heal':
      case 'bless':
      case 'curse':
      case 'ritual': {
        agent.state.path = []
        agent.state.pathIndex = 0
        const target = decision.target ? this.deps.findAgentByName(decision.target, this.deps.getAgents()) : undefined
        targetId = target?.state.id ?? null
        description = `${agent.state.name} began the ${decision.action} rite${target ? ` for ${target.state.name}` : ''}: ${decision.reasoning}`
        break
      }

      case 'preach': {
        const cult = agent.state.cult
        const shrine = cult ? this.systems.cultSystem.findCultShrine(cult.id) : undefined
        const convertTarget = cult ? this.systems.cultSystem.findNearestConvertTarget(agent, cult) : undefined
        const preachApproachRadius = CultSystem.PREACH_LISTEN_RADIUS - 3
        if (convertTarget && agent.distanceTo(convertTarget.state) > preachApproachRadius) {
          decision.target = convertTarget.state.name
          agent.moveTo(Math.round(convertTarget.state.position.x), Math.round(convertTarget.state.position.y))
          description = `${agent.state.name} set out from ${shrine ? shrine.name : 'their sanctuary'} to seek out ${convertTarget.state.name} and preach to them.`
        } else if (convertTarget) {
          decision.target = convertTarget.state.name
          agent.state.path = []
          agent.state.pathIndex = 0
          description = `${agent.state.name} began preaching to ${convertTarget.state.name}: ${decision.reasoning}`
        } else if (shrine) {
          const center = this.systems.cultSystem.getSummoningBuildingCenter(shrine)
          if (Math.hypot(agent.state.position.x - center.x, agent.state.position.y - center.y) > 3) {
            agent.moveTo(center.x, center.y)
            description = `${agent.state.name} traveled toward ${shrine.name} to preach before the congregation.`
          } else {
            agent.state.path = []
            agent.state.pathIndex = 0
            description = `${agent.state.name} began preaching at ${shrine.name}: ${decision.reasoning}`
          }
        } else {
          agent.state.path = []
          agent.state.pathIndex = 0
          description = `${agent.state.name} began the preach rite: ${decision.reasoning}`
        }
        break
      }

      case 'build_shrine': {
        agent.state.path = []
        agent.state.pathIndex = 0
        description = `${agent.state.name} began raising a shrine for ${agent.state.cult?.name ?? 'their cult'}: ${decision.reasoning}`
        break
      }

      case 'invite_cult': {
        const target = decision.target ? this.deps.findAgentByName(decision.target, this.deps.getAgents()) : undefined
        targetId = target?.state.id ?? null
        if (target?.state.alive && agent.distanceTo(target.state) > 4) {
          agent.moveTo(target.state.position.x, target.state.position.y)
        } else {
          agent.state.path = []
          agent.state.pathIndex = 0
        }
        description = target
          ? `${agent.state.name} prepared an invitation for ${target.state.name} to join ${agent.state.cult?.name ?? 'their cult'}.`
          : `${agent.state.name} wanted to recruit a cult member but named no villager.`
        break
      }

      case 'bribe': {
        const target = decision.target ? this.deps.findAgentByName(decision.target, this.deps.getAgents()) : undefined
        targetId = target?.state.id ?? null
        if (target?.state.alive && agent.distanceTo(target.state) > 4) {
          agent.moveTo(target.state.position.x, target.state.position.y)
        } else {
          agent.state.path = []
          agent.state.pathIndex = 0
        }
        description = target
          ? this.systems.politicalSystem.canAttemptCultBribery(agent, target)
            ? `${agent.state.name} approached ${target.state.name} to offer them a bribe to join ${agent.state.cult?.name ?? 'their cult'}.`
            : `${agent.state.name} approached ${target.state.name} to offer them a bribe to win their favor.`
          : `${agent.state.name} wanted to offer a bribe but named no villager.`
        break
      }

      case 'sleep': {
        const home = this.deps.findBuildingOfType(agent, 'home')
        if (home) {
          agent.moveTo(home.position.x + 1, home.position.y + 1)
          description = `Going home to sleep at ${home.name}`
        } else {
          agent.state.path = []
          agent.state.pathIndex = 0
          description = 'Sleeping where they are because no home is available'
        }
        break
      }

      case 'eat': {
        const eatBuilding = this.deps.findBuildingOfType(agent, 'restaurant') || this.deps.findBuildingOfType(agent, 'shop')
        if (eatBuilding) {
          agent.moveTo(eatBuilding.position.x + 1, eatBuilding.position.y + 1)
          agent.eat()
          description = `Eating at ${eatBuilding.name}`
        }
        break
      }

      case 'attack': {
        const nearby = agent.getNearbyAgents(this.deps.getAgents())
        if (nearby.length > 0) {
          const targetAgent = decision.target
            ? nearby.find((a) => a.state.name === decision.target)
            : nearby[Math.floor(Math.random() * nearby.length)]
          if (targetAgent) {
            agent.state.path = []
            agent.state.pathIndex = 0
            const result = this.deps.agentInteraction.handleAttack(agent, targetAgent, this.deps.getAgents())
            targetId = targetAgent.state.id
            description = `Attacked ${targetAgent.state.name} for ${result.damage} damage${result.died ? ' - KILLED' : ''}`
          }
        }
        break
      }

      case 'steal': {
        const nearby = agent.getNearbyAgents(this.deps.getAgents())
        if (nearby.length > 0) {
          const targetAgent = decision.target
            ? this.deps.findAgentByName(decision.target, nearby)
            : nearby[Math.floor(Math.random() * nearby.length)]
          if (!targetAgent) break
          agent.state.path = []
          agent.state.pathIndex = 0
          this.deps.agentInteraction.handleSteal(agent, targetAgent, this.deps.getAgents())
          targetId = targetAgent.state.id
          description = `Tried to steal from ${targetAgent.state.name}`
        }
        break
      }

      case 'destroy': {
        const targetBuilding = decision.target
          ? Array.from(this.deps.world.buildings.values()).find(
              (b) => b.name.toLowerCase() === decision.target!.toLowerCase()
            )
          : null
        if (targetBuilding) {
          this.deps.worldInteraction.handleDestroy(agent, targetBuilding.id, this.deps.getAgents())
          description = `Destroyed ${targetBuilding.name}`
        } else {
          const nearby = agent.getNearbyAgents(this.deps.getAgents())
          if (nearby.length > 0) {
            this.deps.worldInteraction.handleDestroy(agent, null, this.deps.getAgents())
            description = 'Attempting to destroy something nearby'
          }
        }
        break
      }

      case 'help': {
        agent.state.path = []
        agent.state.pathIndex = 0
        const nearby = agent.getNearbyAgents(this.deps.getAgents())
        const injured = nearby.find((a) => a.state.health < 50)
        if (injured) {
          this.deps.agentInteraction.handleHelp(agent, injured)
          targetId = injured.state.id
          description = `Helped ${injured.state.name} recover health`
        }
        break
      }

      case 'flee': {
        const threatId = decision.target
          ? this.deps.getAgents().find((a) => a.state.name === decision.target)?.state.id
          : null
        if (threatId) {
          this.deps.agentInteraction.handleFlee(agent, threatId, this.deps.getAgents())
          description = `Fleeing from ${decision.target}`
        } else {
          const fleePos = this.deps.findRandomWalkablePosition()
          agent.moveTo(fleePos.x, fleePos.y)
          description = 'Fleeing to safety'
        }
        break
      }

      case 'gather': {
        agent.state.path = []
        agent.state.pathIndex = 0
        const gathered = this.deps.worldInteraction.handleGather(agent)
        description = gathered ? 'Gathered resources' : 'Nothing to gather here'
        break
      }

      case 'idle':
      default:
        agent.state.path = []
        agent.state.pathIndex = 0
        description = decision.reasoning || 'Idling'
        break
    }

    const eventId = this.deps.logAction(agent, actionType, targetId, description, causationIds)

    if (decision.action === 'talk' && targetId && agent.state.cult &&
      agent.state.cult.role === 'leader') {
      const listener = this.deps.getAgents().find((candidate) => candidate.state.id === targetId)
      if (listener?.state.alive) {
        this.systems.cultSystem.advanceCultConversionFromConversation(agent, listener, agent.state.cult, eventId)
      }
    }

    this.systems.socialSystem.state.lastActions.set(agent.state.id, { action: decision.action, timestamp: this.deps.simManager.getSimTime() })

    if (decision.dialogue) {
      const nearby = agent.getNearbyAgents(this.deps.getAgents())
      if (nearby.length > 0) {
        console.log(`[${agent.state.name}]: "${decision.dialogue}"`)
      }
    }
    return eventId
  }
}
