import { Agent } from '@/agent/Agent'
import { World } from '@/world/World'
import { SimulationManager } from '@/simulation/SimulationManager'
import {
  ActionType,
  EmotionalState,
  SimulationEvent,
  AgentAction,
  BuildingType,
  DailySchedule,
  ScheduleBlock,
  DecisionTrigger,
  CourtVote,
  LLMRequestStatus,
  Rumour,
  RumourProvenance,
  WeatherCondition,
  CultAgenda,
  CultRequest,
  RelationshipType,
  Building,
  PolicySession,
  PolicyVote,
  ForbiddenKnowledgeEntry,
  StoryMoment,
  AgentState,
} from '@/types'
import { AIProvider, ExistentialReactionResult, ForbiddenKnowledgeClassification, LLMQueryStats, PropheticInterpretation, PropheticTask } from '@/ai/AIProvider'
import { PromptBuilder } from '@/ai/PromptBuilder'
import { EventBus } from '@/interaction/EventBus'
import { AgentInteraction } from '@/interaction/AgentInteraction'
import { WorldInteraction } from '@/interaction/WorldInteraction'
import { ConversationManager } from '@/interaction/ConversationManager'
import { classifyCourtEligibility, isCourtEligibleRumour, isCultRelatedRumour } from '@/utils/RumourRules'
import { classifyExistentialReactionFallback, classifyForbiddenKnowledgeFallback } from '@/utils/ForbiddenKnowledgeRules'
import { SystemDeps } from '@/agent/systems/SystemDeps'
import { StorySystem, createStoryState } from '@/agent/systems/StorySystem'
import { PoliticalSystem, createPoliticalState, MIN_BRIBE_WEALTH } from '@/agent/systems/PoliticalSystem'
import { JusticeSystem, createCourtState } from '@/agent/systems/JusticeSystem'
import { RumourSystem, createRumourState } from '@/agent/systems/RumourSystem'
import { ReligionSystem, createReligionState } from '@/agent/systems/ReligionSystem'
import { CultSystem, createCultState } from '@/agent/systems/CultSystem'

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

export class AgentManager {
  private agents: Agent[]
  private world: World
  private simManager: SimulationManager
  private aiProvider: AIProvider | null
  private promptBuilder: PromptBuilder
  private pendingDecisions: Map<string, Promise<void>>
  private pendingActivityLabels: Map<string, string>
  private lastActions: Map<string, { action: string; timestamp: number }>
  private dailySchedules: Map<string, DailySchedule>
  private scheduleCursors: Map<string, number>
  private activeBlocks: Map<string, {
    action: AgentAction
    endsAt: number
    eventId: string
    rumourId?: string
    fallback?: boolean
    investigationInterviewStarted?: boolean
    investigationIntervieweeId?: string
    sleepStartedAt?: number
    religiousFervour?: boolean
    propheticTask?: PropheticTask
    demonAttackTargetId?: string
    summonLeaderId?: string
    summonSite?: { x: number; y: number }
    summonedMemberIds?: string[]
    summonInitialDistances?: Record<string, number>
    summonInvitedMemberIds?: string[]
    summonPhase?: 'recruiting' | 'travelling'
  }>
  private decisionQueue: Map<string, DecisionTrigger[]>
  private pregeneratedConversations: Map<string, { lines: { speakerId: string; dialogue: string }[]; nextAt: number }>
  private currentDay: number
  private processedEventIds: Set<string>
  private llmRequestStatuses: Map<string, LLMRequestStatus>
  private activeEncounterPairs: Set<string>
  private lastEncounterMinute: Map<string, number>
  private rumours: Map<string, Rumour>
  private llmRequestInFlight: boolean
  private llmQueryStats: LLMQueryStats
  private idleSinceMinute: Map<string, number>
  private knightOutsiderSpawned: boolean
  private inquisitorOutsiderSpawned: boolean
  private queryEpoch: number

  private eventBus: EventBus
  private agentInteraction: AgentInteraction
  private worldInteraction: WorldInteraction
  private conversationManager: ConversationManager
  private storySystem!: StorySystem
  private politicalSystem!: PoliticalSystem
  private justiceSystem!: JusticeSystem
  private rumourSystem!: RumourSystem
  private religionSystem!: ReligionSystem
  private cultSystem!: CultSystem

  constructor(
    world: World,
    simManager: SimulationManager,
    aiProvider: AIProvider | null = null,
    sharedEventBus: EventBus | null = null
  ) {
    this.agents = []
    this.world = world
    this.simManager = simManager
    this.aiProvider = aiProvider
    this.promptBuilder = new PromptBuilder()
    this.pendingDecisions = new Map()
    this.pendingActivityLabels = new Map()
    this.lastActions = new Map()
    this.dailySchedules = new Map()
    this.scheduleCursors = new Map()
    this.activeBlocks = new Map()
    this.decisionQueue = new Map()
    this.pregeneratedConversations = new Map()
    this.currentDay = 0
    this.processedEventIds = new Set()
    this.llmRequestStatuses = new Map()
    this.activeEncounterPairs = new Set()
    this.lastEncounterMinute = new Map()
    this.rumours = new Map()
    this.llmRequestInFlight = false
    this.llmQueryStats = { made: 0, successful: 0 }
    this.idleSinceMinute = new Map()
    this.knightOutsiderSpawned = false
    this.inquisitorOutsiderSpawned = false
    this.queryEpoch = 0

    this.eventBus = sharedEventBus ?? new EventBus()
    this.agentInteraction = new AgentInteraction(this.eventBus)
    this.worldInteraction = new WorldInteraction(world, this.eventBus)
    this.conversationManager = new ConversationManager(this.eventBus)

    this.setupSystems()
    this.setupEventListeners()
  }

  // Builds the shared SystemDeps object (closures over this AgentManager's
  // own fields/bound methods) and instantiates the three extracted
  // subsystems. Cross-system callbacks (e.g. deps.getCourtCenter calling
  // into justiceSystem) are safe to wire before their target system is
  // assigned below: they're closures resolved at call time, not at
  // construction time.
  private setupSystems(): void {
    const deps: SystemDeps = {
      getAgents: () => this.agents,
      world: this.world,
      eventBus: this.eventBus,
      aiProvider: this.aiProvider,
      promptBuilder: this.promptBuilder,
      simManager: this.simManager,
      story: {
        hasPendingNarrations: () => this.storySystem.hasPendingNarrations(),
        queueStoryMoment: (kind, title, facts, agentId, sourceEventId) =>
          this.storySystem.queueStoryMoment(kind, title, facts, agentId, sourceEventId),
        queueFirstCultRecruitMoment: (leader, cultId, cultName, recruit, sourceEventId) =>
          this.storySystem.queueFirstCultRecruitMoment(leader, cultId, cultName, recruit, sourceEventId),
        queueBelieverPoachedMoment: (recruiter, cultId, cultName, convert, formerCultName, sourceEventId) =>
          this.storySystem.queueBelieverPoachedMoment(recruiter, cultId, cultName, convert, formerCultName, sourceEventId),
        queueFirstDeityAbilityMoment: (ability, facts, agentId, sourceEventId) =>
          this.storySystem.queueFirstDeityAbilityMoment(ability, facts, agentId, sourceEventId),
      },
      agentInteraction: this.agentInteraction,
      conversationManager: this.conversationManager,

      activeBlocks: this.activeBlocks,
      decisionQueue: this.decisionQueue,
      dailySchedules: this.dailySchedules,
      scheduleCursors: this.scheduleCursors,
      pendingDecisions: this.pendingDecisions,
      pendingActivityLabels: this.pendingActivityLabels,
      llmRequestStatuses: this.llmRequestStatuses,
      rumours: this.rumours,
      getCurrentDay: () => this.currentDay,
      isLLMRequestInFlight: () => this.llmRequestInFlight,
      setLLMRequestInFlight: (value) => { this.llmRequestInFlight = value },

      isCourtActive: () => this.justiceSystem.state.activeCourtRumourId !== null,
      isPolicyVoteActive: () => this.politicalSystem.state.activePolicySessionId !== null,

      getAbsoluteMinute: () => this.getAbsoluteMinute(),
      getMinuteOfDay: () => this.getMinuteOfDay(),

      runLLMRequestWithRetry: (agentId, label, request, maxAttempts) =>
        this.runLLMRequestWithRetry(agentId, label, request, maxAttempts),
      isAgentRefreshCancellation: (error) => this.isAgentRefreshCancellation(error),

      enqueueDecision: (agentId, trigger) => this.enqueueDecision(agentId, trigger),
      startBlock: (agent, action, causationIds, rumourId, fallback, propheticTask) =>
        this.startBlock(agent, action, causationIds, rumourId, fallback, propheticTask),
      resolveTarget: (targetName) => this.resolveTarget(targetName),
      findBuildingOfType: (agent, type) => this.findBuildingOfType(agent, type),
      findJobBuilding: (agent) => this.findJobBuilding(agent),
      findRandomWalkablePosition: () => this.findRandomWalkablePosition(),
      getAgentState: (id) => this.getAgentState(id),

      findAccusedAgent: (rumour) => this.rumourSystem.findAccusedAgent(rumour),
      getRelatedRumourCluster: (seed) => this.rumourSystem.getRelatedRumourCluster(seed),
      deliverRumour: (rumour, recipient, sourceAgentId, causationIds, forceSeedBelief, directExperience) =>
        this.rumourSystem.deliverRumour(rumour, recipient, sourceAgentId, causationIds, forceSeedBelief, directExperience),
      getInvestigationAuthority: (agent, rumour) => this.rumourSystem.getInvestigationAuthority(agent, rumour),
      createRumour: (text, origin, sourceAgentId, sourceEventId, credibility, parentRumourId, provenance) =>
        this.rumourSystem.createRumour(text, origin, sourceAgentId, sourceEventId, credibility, parentRumourId, provenance),
      registerAgentCreatedRumour: (rumour, agent, kind, parent) =>
        this.rumourSystem.registerAgentCreatedRumour(rumour, agent, kind, parent),
      applyRumourProvenanceBelief: (rumour, agent, belief, forceAcceptance) =>
        this.rumourSystem.applyRumourProvenanceBelief(rumour, agent, belief, forceAcceptance),
      applyExistentialWitnessReaction: (witness, sourceText, severityHint, insanitySource) =>
        this.rumourSystem.applyExistentialWitnessReaction(witness, sourceText, severityHint, insanitySource),

      findProvenCult: () => this.cultSystem.findProvenCult(),
      promoteCultSuccessor: (formerLeader, preferredSuccessorId, reason) =>
        this.cultSystem.promoteCultSuccessor(formerLeader, preferredSuccessorId, reason),
      isConversionImmune: (agent) => this.cultSystem.isConversionImmune(agent),
      hasOpposingPoliticalCamps: (leader, candidate) => this.cultSystem.hasOpposingPoliticalCamps(leader, candidate),
      fulfillCultRequests: (cultId, matches, eventId) => this.cultSystem.fulfillCultRequests(cultId, matches, eventId),
      disbandCult: (cultId, cultName) => this.cultSystem.disbandCult(cultId, cultName),
      tryMakePriestHostile: (priest, cultist, cause, causationId) =>
        this.cultSystem.tryMakePriestHostile(priest, cultist, cause, causationId),
      createCultLeaderAgendas: (leader) => this.cultSystem.createCultLeaderAgendas(leader),
      findEmptySummoningBuilding: (requestedName, ignoredAgentIds, preferredCultId) =>
        this.cultSystem.findEmptySummoningBuilding(requestedName, ignoredAgentIds, preferredCultId),
      fulfillRequestsFromGodAbility: (ability, target, weatherCondition, eventId) =>
        this.cultSystem.fulfillRequestsFromGodAbility(ability, target, weatherCondition, eventId),
      generateCultName: (claimText, revelationText) => this.cultSystem.generateCultName(claimText, revelationText),
      maybeTriggerWillingCultJoin: (target, deityName, causationId) =>
        this.cultSystem.maybeTriggerWillingCultJoin(target, deityName, causationId),
      applyTimedBlessing: (recipient, sourceAgentId, sourceCultId) =>
        this.cultSystem.applyTimedBlessing(recipient, sourceAgentId, sourceCultId),

      getCultCourtDirection: (voter, court) => this.cultSystem.getCultCourtDirection(voter, court),
      applyCultCourtInfluence: (voter, accused, court, vote) =>
        this.cultSystem.applyCultCourtInfluence(voter, accused, court, vote),

      chooseDeityName: (agent) => this.religionSystem.chooseDeityName(agent),
      maybeTriggerReligiousFervour: (agent, rumour, belief) => this.religionSystem.maybeTriggerReligiousFervour(agent, rumour, belief),
      maybeAppointProphet: (agent, rumour, deityName) => this.religionSystem.maybeAppointProphet(agent, rumour, deityName),
      queuePropheticInterpretation: (agent, rumour, deityName, eventId) =>
        this.religionSystem.queuePropheticInterpretation(agent, rumour, deityName, eventId),
      applyResurrectionInsanity: (target, sourceName, includeExecuteVoterInsanity) =>
        this.religionSystem.applyResurrectionInsanity(target, sourceName, includeExecuteVoterInsanity),
      getProphetAgentId: () => this.religionSystem.state.prophetAgentId,
      grantDemonSummonCredit: (site) => {
        this.religionSystem.state.demonSummonCredits++
        this.religionSystem.state.demonSummonSites.push(site)
        return this.religionSystem.state.demonSummonCredits
      },

      banishAgent: (agent, reason, policySessionId) => this.banishAgent(agent, reason, policySessionId),

      getCourtCenter: () => this.justiceSystem.getCourtCenter(),
      isWeakCourtStatement: (statement) => this.justiceSystem.isWeakCourtStatement(statement),
      resumeSchedulesAfterCourt: (participantIds) => this.justiceSystem.resumeSchedulesAfterCourt(participantIds),
      updateAgentJusticeResponse: (rumour, agent, belief) => this.justiceSystem.updateAgentJusticeResponse(rumour, agent, belief),

      findAgentByName: (targetName, candidates) => this.findAgentByName(targetName, candidates),
      formatAbsoluteMinute: (minute) => this.formatAbsoluteMinute(minute),
      findTownEntrance: () => this.findTownEntrance(),
    }

    this.storySystem = new StorySystem(deps, createStoryState())
    this.justiceSystem = new JusticeSystem(deps, createCourtState())
    this.politicalSystem = new PoliticalSystem(deps, createPoliticalState())
    this.rumourSystem = new RumourSystem(deps, createRumourState())
    this.religionSystem = new ReligionSystem(deps, createReligionState())
    this.cultSystem = new CultSystem(deps, createCultState())
  }

  private setupEventListeners(): void {
    this.eventBus.on('*', (event) => {
      if ([ActionType.ATTACK, ActionType.STEAL, ActionType.DESTROY].includes(event.actionType)) {
        console.log(`[EVENT] ${event.description}`)
      }
      this.handleDecisionEvent(event)
      this.religionSystem.registerGodInvocation(event)
      this.cultSystem.fulfillPunishmentRequestsFromEvent(event)
      this.cultSystem.handleCultLeaderKilled(event)
    })
  }



  public resetSchedulesLocationsAndQueries(): { success: boolean; message: string; relocated: number } {
    this.queryEpoch++
    this.pendingDecisions.clear()
    this.pendingActivityLabels.clear()
    this.decisionQueue.clear()
    this.dailySchedules.clear()
    this.scheduleCursors.clear()
    this.activeBlocks.clear()
    this.lastActions.clear()
    this.activeEncounterPairs.clear()
    this.cultSystem.state.cultMobTargets.clear()
    this.religionSystem.state.religiousFervourTargets.clear()
    this.llmRequestInFlight = false
    this.justiceSystem.state.activeCourtRumourId = null
    for (const rumour of this.rumours.values()) {
      if (rumour.resolutionCourt?.status !== 'resolved') rumour.resolutionCourt = undefined
    }
    if (this.politicalSystem.state.activePolicySessionId) {
      const activeSession = this.politicalSystem.state.policySessions.get(this.politicalSystem.state.activePolicySessionId)
      if (activeSession && activeSession.status !== 'resolved') this.politicalSystem.state.policySessions.delete(activeSession.id)
      this.politicalSystem.state.activePolicySessionId = null
    }

    const occupied = new Set<string>()
    let relocated = 0
    for (const agent of this.agents.filter((candidate) => candidate.state.alive)) {
      agent.closeActiveConversation()
      agent.state.path = []
      agent.state.pathIndex = 0
      let position: { x: number; y: number } | undefined
      for (let attempt = 0; attempt < 100; attempt++) {
        const candidate = this.findRandomWalkablePosition()
        const key = `${candidate.x},${candidate.y}`
        if (!occupied.has(key)) {
          position = candidate
          occupied.add(key)
          break
        }
      }
      position ??= this.findRandomWalkablePosition()
      agent.state.position = position
      agent.state.lastReasoning = 'Schedule, movement, and pending-query state were refreshed by simulation controls.'
      const isKnight = agent.state.currentJob === 'Knight' || agent.state.outsider?.kind === 'knight'
      this.llmRequestStatuses.set(agent.state.id, (agent.state.demon || isKnight) ? 'idle' : 'pending')
      this.idleSinceMinute.set(agent.state.id, this.getAbsoluteMinute())
      relocated++
    }

    const event = this.eventBus.emit({
      type: 'simulation_maintenance',
      agentId: 'simulation',
      actionType: ActionType.IDLE,
      outcome: 'agents_refreshed',
      description: `Simulation controls refreshed schedules, locations, conversations, and pending queries for ${relocated} living agents.`,
      causationIds: [],
      worldStateDelta: { relocated, queryEpoch: this.queryEpoch },
      observers: this.agents.filter((agent) => agent.state.alive).map((agent) => agent.state.id),
    })
    for (const agent of this.agents.filter((candidate) => candidate.state.alive)) agent.addRecentMemory(event)
    return {
      success: true,
      relocated,
      message: `Refreshed ${relocated} living agents without resetting village history or identities.`,
    }
  }




  // A villager returning from the dead is a shock to whoever watched them die.
  // Ordinary witnesses of the earlier death have a chance to break; when the
  // deceased was executed by a resolution court and a deity is the one
  // reversing that verdict, everyone who voted to execute them additionally
  // risks going insane over having condemned someone now walking again.




  public initialize(count: number): void {
    this.agents = Agent.createAgentPool(count, this.world, this.simManager)
    console.log(`Created ${this.agents.length} agents`)
    for (const agent of this.agents) {
      this.llmRequestStatuses.set(agent.state.id, 'pending')
      console.log(
        `  - ${agent.state.name} (${agent.state.currentJob}, ${agent.state.politicalCamp?.name}, wealth ${agent.state.wealth}) at (${Math.round(agent.state.position.x)}, ${Math.round(agent.state.position.y)})`
      )
    }
    this.religionSystem.seedInitialChristianCult()

    if (this.aiProvider?.isAvailable()) {
      console.log('[AgentManager] LLM decisions enabled')
    } else {
      console.warn('[AgentManager] Waiting for the LLM before requesting daily schedules')
    }
  }

  // A freshly generated village that includes a Priest starts with that
  // Priest already leading a small, established Christian congregation
  // rather than beginning entirely irreligious. This only seeds a new
  // village; restored saves keep whatever cult state they already had.

  public createSnapshot(): Record<string, unknown> {
    return {
      agents: this.agents.map((agent) => ({
        state: agent.state,
        conversations: Array.from(agent.conversations.values()),
      })),
      lastActions: Array.from(this.lastActions.entries()),
      dailySchedules: Array.from(this.dailySchedules.entries()),
      scheduleCursors: Array.from(this.scheduleCursors.entries()),
      activeBlocks: Array.from(this.activeBlocks.entries()),
      decisionQueue: Array.from(this.decisionQueue.entries()),
      currentDay: this.currentDay,
      processedEventIds: Array.from(this.processedEventIds),
      llmRequestStatuses: Array.from(this.llmRequestStatuses.entries()),
      activeEncounterPairs: Array.from(this.activeEncounterPairs),
      lastEncounterMinute: Array.from(this.lastEncounterMinute.entries()),
      rumours: Array.from(this.rumours.entries()),
      rumourCounter: this.rumourSystem.state.rumourCounter,
      naturalRumourKeys: Array.from(this.rumourSystem.state.naturalRumourKeys),
      rumourMutationKeys: Array.from(this.rumourSystem.state.rumourMutationKeys),
      lastRumourInventionMinute: Array.from(this.rumourSystem.state.lastRumourInventionMinute.entries()),
      llmQueryStats: this.llmQueryStats,
      activeCourtRumourId: this.justiceSystem.state.activeCourtRumourId,
      courtCounter: this.justiceSystem.state.courtCounter,
      policySessions: Array.from(this.politicalSystem.state.policySessions.entries()),
      activePolicySessionId: this.politicalSystem.state.activePolicySessionId,
      policyCounter: this.politicalSystem.state.policyCounter,
      lastPolicyVoteDay: this.politicalSystem.state.lastPolicyVoteDay,
      recentPolicyProposalIds: this.politicalSystem.state.recentPolicyProposalIds,
      religiousFervourCompletedKeys: Array.from(this.religionSystem.state.religiousFervourCompletedKeys),
      religiousFervourIdeas: Array.from(this.religionSystem.state.religiousFervourIdeas.entries()),
      religiousFervourTargets: Array.from(this.religionSystem.state.religiousFervourTargets.entries()),
      divineEvangelismKeys: Array.from(this.rumourSystem.state.divineEvangelismKeys),
      prophetAgentId: this.religionSystem.state.prophetAgentId,
      prophetVacantAfterDeath: this.religionSystem.state.prophetVacantAfterDeath,
      idleSinceMinute: Array.from(this.idleSinceMinute.entries()),
      interpretedProphecyRumourIds: Array.from(this.religionSystem.state.interpretedProphecyRumourIds),
      lastDailyPropheticClaimDay: this.religionSystem.state.lastDailyPropheticClaimDay,
      godInterventionCredits: this.religionSystem.state.godInterventionCredits,
      lastGodInvocation: this.religionSystem.state.lastGodInvocation,
      lastInvokedDeityName: this.religionSystem.state.lastInvokedDeityName,
      lastCultMobCheckMinute: Array.from(this.cultSystem.state.lastCultMobCheckMinute.entries()),
      cultMobCooldownUntil: Array.from(this.cultSystem.state.cultMobCooldownUntil.entries()),
      cultMobTargets: Array.from(this.cultSystem.state.cultMobTargets.entries()),
      cultShrineCommandIssued: Array.from(this.cultSystem.state.cultShrineCommandIssued),
      knightOutsiderSpawned: this.knightOutsiderSpawned,
      inquisitorOutsiderSpawned: this.inquisitorOutsiderSpawned,
      demonSummonCredits: this.religionSystem.state.demonSummonCredits,
      demonSummonSites: this.religionSystem.state.demonSummonSites,
    }
  }

  public restoreSnapshot(snapshot: any): void {
    this.agents = (snapshot.agents ?? []).map((saved: any) =>
      Agent.restore(saved.state, saved.conversations ?? [], this.world, this.simManager)
    )
    for (const agent of this.agents) this.simManager.addAgent(agent.state)
    this.lastActions = new Map(snapshot.lastActions ?? [])
    this.dailySchedules = new Map(snapshot.dailySchedules ?? [])
    this.scheduleCursors = new Map(snapshot.scheduleCursors ?? [])
    this.activeBlocks = new Map(snapshot.activeBlocks ?? [])
    this.decisionQueue = new Map(snapshot.decisionQueue ?? [])
    this.pregeneratedConversations = new Map()
    this.currentDay = snapshot.currentDay ?? this.simManager.getDayNight().day
    this.processedEventIds = new Set(snapshot.processedEventIds ?? [])
    this.llmRequestStatuses = new Map(snapshot.llmRequestStatuses ?? [])
    this.activeEncounterPairs = new Set(snapshot.activeEncounterPairs ?? [])
    this.lastEncounterMinute = new Map(snapshot.lastEncounterMinute ?? [])
    this.rumours = new Map(snapshot.rumours ?? [])
    this.rumourSystem.state.rumourCounter = snapshot.rumourCounter ?? 0
    this.rumourSystem.state.naturalRumourKeys = new Set(snapshot.naturalRumourKeys ?? [])
    this.rumourSystem.state.rumourMutationKeys = new Set(snapshot.rumourMutationKeys ?? [])
    this.rumourSystem.state.lastRumourInventionMinute = new Map(snapshot.lastRumourInventionMinute ?? [])
    this.llmQueryStats = snapshot.llmQueryStats ?? { made: 0, successful: 0 }
    this.justiceSystem.state.activeCourtRumourId = snapshot.activeCourtRumourId ?? null
    this.justiceSystem.state.courtCounter = snapshot.courtCounter ?? 0
    this.politicalSystem.state.policySessions = new Map(snapshot.policySessions ?? [])
    this.politicalSystem.state.activePolicySessionId = snapshot.activePolicySessionId ?? null
    this.politicalSystem.state.policyCounter = snapshot.policyCounter ?? 0
    this.politicalSystem.state.lastPolicyVoteDay = snapshot.lastPolicyVoteDay ?? 0
    this.politicalSystem.state.recentPolicyProposalIds = snapshot.recentPolicyProposalIds ?? []
    Agent.assignPoliticalCamps(this.agents, this.getAbsoluteMinute())
    this.religionSystem.state.religiousFervourCompletedKeys = new Set(snapshot.religiousFervourCompletedKeys ?? [])
    this.religionSystem.state.religiousFervourIdeas = new Map(snapshot.religiousFervourIdeas ?? [])
    this.religionSystem.state.religiousFervourTargets = new Map(snapshot.religiousFervourTargets ?? [])
    this.rumourSystem.state.divineEvangelismKeys = new Set(snapshot.divineEvangelismKeys ?? [])
    this.religionSystem.state.prophetAgentId = snapshot.prophetAgentId ??
      this.agents.find((agent) => agent.state.currentJob === 'Prophet')?.state.id ?? null
    this.religionSystem.state.prophetVacantAfterDeath = snapshot.prophetVacantAfterDeath ?? false
    this.idleSinceMinute = new Map(snapshot.idleSinceMinute ?? [])
    this.religionSystem.state.interpretedProphecyRumourIds = new Set(snapshot.interpretedProphecyRumourIds ?? [])
    this.religionSystem.state.lastDailyPropheticClaimDay = snapshot.lastDailyPropheticClaimDay ?? 0
    this.religionSystem.state.godInterventionCredits = snapshot.godInterventionCredits ?? 0
    this.religionSystem.state.lastGodInvocation = snapshot.lastGodInvocation
    this.religionSystem.state.lastInvokedDeityName = snapshot.lastInvokedDeityName
    this.cultSystem.state.lastCultMobCheckMinute = new Map(snapshot.lastCultMobCheckMinute ?? [])
    this.cultSystem.state.cultMobCooldownUntil = new Map(snapshot.cultMobCooldownUntil ?? [])
    this.cultSystem.state.cultMobTargets = new Map(snapshot.cultMobTargets ?? [])
    this.cultSystem.state.cultShrineCommandIssued = new Set(snapshot.cultShrineCommandIssued ?? [])
    this.knightOutsiderSpawned = snapshot.knightOutsiderSpawned ??
      this.agents.some((agent) => agent.state.outsider?.kind === 'knight')
    this.inquisitorOutsiderSpawned = snapshot.inquisitorOutsiderSpawned ??
      this.agents.some((agent) => agent.state.outsider?.kind === 'inquisitor')
    this.religionSystem.state.demonSummonCredits = snapshot.demonSummonCredits ?? 0
    this.religionSystem.state.demonSummonSites = snapshot.demonSummonSites ?? []
    while (this.religionSystem.state.demonSummonSites.length < this.religionSystem.state.demonSummonCredits) {
      this.religionSystem.state.demonSummonSites.push(this.findTownEntrance())
    }
    const hasPendingSummon = [...this.activeBlocks.values()].some((block) =>
      block.action.action === 'summon' || block.propheticTask?.kind === 'summon'
    ) || [...this.decisionQueue.values()].some((triggers) =>
      triggers.some((trigger) => trigger.propheticTask?.kind === 'summon')
    )
    if (this.religionSystem.state.demonSummonCredits === 0 && !this.agents.some((agent) => agent.state.demon) && !hasPendingSummon) {
      const prophetId = this.religionSystem.state.prophetAgentId
      const missedSummonRevelation = [...this.rumours.values()].reverse().find((rumour) =>
        rumour.origin === 'whisper' &&
        rumour.provenance.kind === 'divine' &&
        /\b(?:summon|summoning ritual)\b/i.test(rumour.text) &&
        rumour.beliefs.some((belief) =>
          belief.agentId === prophetId && belief.seeded === true && belief.stance === 'believer'
        )
      )
      if (missedSummonRevelation) this.religionSystem.state.interpretedProphecyRumourIds.delete(missedSummonRevelation.id)
    }
    this.pendingDecisions.clear()
    this.pendingActivityLabels.clear()
    this.llmRequestInFlight = false
    this.cultSystem.coordinateScheduledSummons()
  }

  public update(deltaMs: number, simTime: number): void {
    for (const agent of this.agents) {
      agent.update(deltaMs, simTime)
      if (agent.isInsane()) {
        agent.state.emotionalState = EmotionalState.PANICKED

        const absoluteMinute = this.getAbsoluteMinute()
        if (agent.state.lastSuicideCheckMinute !== absoluteMinute) {
          agent.state.lastSuicideCheckMinute = absoluteMinute
          const suicideChance = 0.00005
          if (Math.random() < suicideChance) {
            const partnerId = agent.getConversationPartnerId()
            const partner = partnerId
              ? this.agents.find((candidate) => candidate.state.id === partnerId)
              : undefined
            if (partner) this.conversationManager.closeConversation(agent, partner)
            else agent.closeActiveConversation()

            this.activeBlocks.delete(agent.state.id)
            this.agentInteraction.handleSuicide(agent, this.agents)
          }
        }
      }
      const active = this.activeBlocks.get(agent.state.id)
      const sleepingAtDestination =
        active?.action.action === 'sleep' &&
        active.sleepStartedAt !== undefined &&
        (agent.state.path.length === 0 || agent.state.pathIndex >= agent.state.path.length)
      if (sleepingAtDestination) agent.sleep(deltaMs)
    }
    for (const agent of this.agents) {
      const partnerId = agent.getConversationPartnerId()
      if (
        this.pendingDecisions.has(agent.state.id) ||
        (this.decisionQueue.get(agent.state.id)?.length ?? 0) > 0 ||
        (partnerId !== null && (
          this.pendingDecisions.has(partnerId) ||
          (this.decisionQueue.get(partnerId)?.length ?? 0) > 0
        ))
      ) continue
      this.conversationManager.autoCloseInactiveConversations(agent, this.agents, simTime)
    }

    const day = this.simManager.getDayNight().day
    if (day !== this.currentDay) {
      this.beginDay(day)
    }

    this.religionSystem.repairInvalidPropheticSacrifices()
    this.cultSystem.enforceConversionImmunity()
    this.cultSystem.maintainCultRequestsAndAgendas()
    this.cultSystem.updateForsakenCultists()
    this.cultSystem.updateCultDefections()
    this.cultSystem.maybeCommandCultShrineConstruction()
    this.rumourSystem.refreshRumourBeliefStances()
    this.religionSystem.repairMalformedPropheticRumours()
    this.religionSystem.reconcileProphetAppointment()
    this.religionSystem.reconcileUninterpretedProphetRevelations()
    this.cultSystem.reconcileCultFormationFromPropheticClaims()
    this.cultSystem.reconcileCultLeadership()
    this.maybeCreateKnightOutsider()
    this.cultSystem.removeExtinctCults()
    this.religionSystem.enforceProphetVocation()
    this.religionSystem.prioritizePropheticTasks()
    this.enforceExhaustionSleep()
    this.enforceNightSleep()
    this.justiceSystem.cancelInvalidResolutionCourt()
    this.justiceSystem.maybeStartResolutionCourt()
    if (this.justiceSystem.advanceResolutionCourt()) return
    this.politicalSystem.maybeStartPolicyVote()
    if (this.politicalSystem.advancePolicyVote()) return
    this.rumourSystem.resolveRejectedRumours()
    this.rumourSystem.archiveExpiredRumours()
    this.religionSystem.updateReligiousRadicalisation()
    this.religionSystem.advanceReligiousFervour()
    this.cultSystem.maybeFormCultMobs()
    this.cultSystem.advanceCultMobs()

    this.rumourSystem.advanceRumourInvestigations()
    this.detectAgentEncounters()
    this.advancePregeneratedConversations(this.simManager.getSimTime())
    this.completeFinishedBlocks()
    this.startDueScheduleBlocks()
    this.ensureFallbackActivities()
    for (const agent of this.agents) {
      if (agent.state.alive && (agent.state.currentJob === 'Knight' || agent.state.outsider?.kind === 'knight')) {
        this.updateKnightPatrolAndCombat(agent)
      }
    }
    for (const agent of this.agents) {
      if (agent.state.alive && agent.state.demon) {
        this.religionSystem.updateDemonAutonomousBehavior(agent)
      }
    }
    this.preventProlongedIdle()
    this.enforceWeatherSafety()
    this.religionSystem.ensureDailyPropheticClaim()
    this.processDecisionQueue()
    this.ensureDailyPlans()
  }



  // Every rumour eventually leaves the active tracker, not just resolved
  // ones: a resolved claim gets one day of visibility, an investigated but
  // never-resolved claim gets one day from its finding, and a claim nobody
  // ever ran to ground gets three days from creation before it goes stale.
  // Rather than deleting it outright, it is archived in place so the tracker
  // can still show it as a minimized, greyed-out historical entry.


  private formatAbsoluteMinute(minute: number): string {
    const day = Math.floor(minute / 1440) + 1
    const minuteOfDay = ((minute % 1440) + 1440) % 1440
    const hour = Math.floor(minuteOfDay / 60)
    const mins = Math.floor(minuteOfDay % 60)
    return `Day ${day}, ${hour.toString().padStart(2, '0')}:${mins.toString().padStart(2, '0')}`
  }

  // Removes an outlawed outsider from active life, mirroring the shape of a
  // court exile so exiled-status rendering and save/load behave identically.
  private banishAgent(agent: Agent, reason: string, policySessionId: string): void {
    for (const other of this.agents) {
      if (other.getConversationPartnerId() === agent.state.id) other.closeActiveConversation()
    }
    agent.closeActiveConversation()
    this.activeBlocks.delete(agent.state.id)
    this.decisionQueue.delete(agent.state.id)
    this.pendingDecisions.delete(agent.state.id)
    this.llmRequestStatuses.delete(agent.state.id)
    this.dailySchedules.delete(agent.state.id)
    this.scheduleCursors.delete(agent.state.id)
    agent.state.path = []
    agent.state.pathIndex = 0
    agent.state.alive = false
    agent.state.exiled = {
      atMinute: this.getAbsoluteMinute(),
      courtSessionId: policySessionId,
      reason,
    }
  }

  public getPolicySessions(): PolicySession[] {
    return this.politicalSystem.getPolicySessions()
  }

  public getStoryMoments(): StoryMoment[] {
    return this.storySystem.getStoryMoments()
  }

  public whisperRumour(
    text: string,
    targetAgentId: string | 'all',
    initialCredibility?: number,
    sourceHint?: string
  ): string | null {
    return this.rumourSystem.whisperRumour(text, targetAgentId, initialCredibility, sourceHint)
  }

  public setWhisperGroundTruth(rumourId: string, groundTruth: boolean): boolean {
    return this.rumourSystem.setWhisperGroundTruth(rumourId, groundTruth)
  }

  public getRumours(): Rumour[] {
    return this.rumourSystem.getRumours()
  }

  public getRumourImpactCounts(): Record<string, number> {
    return this.rumourSystem.getRumourImpactCounts()
  }

  public getGodInterventionState(): ReturnType<ReligionSystem['getGodInterventionState']> {
    return this.religionSystem.getGodInterventionState()
  }

  public createDemon(command: string): { success: boolean; message: string; demonId?: string } {
    return this.religionSystem.createDemon(command)
  }

  public commandDemon(demonId: string | undefined, command: string): { success: boolean; message: string } {
    return this.religionSystem.commandDemon(demonId, command)
  }

  public performGodAbility(
    ability: 'bless' | 'heal' | 'smite' | 'resurrect' | 'manifest' | 'weather',
    targetAgentId?: string,
    weatherCondition?: WeatherCondition,
    deityNameOverride?: string
  ): { success: boolean; message: string } {
    return this.religionSystem.performGodAbility(ability, targetAgentId, weatherCondition, deityNameOverride)
  }

  public beginDeityConversation(
    targetAgentId: string,
    deityNameOverride?: string
  ): { success: boolean; message: string; deityName?: string; agentName?: string } {
    return this.religionSystem.beginDeityConversation(targetAgentId, deityNameOverride)
  }

  public async sendDeityMessage(
    targetAgentId: string,
    message: string
  ): Promise<{ success: boolean; message: string; agentReply?: string }> {
    return this.religionSystem.sendDeityMessage(targetAgentId, message)
  }

  public endDeityConversation(
    targetAgentId: string
  ): { success: boolean; message: string; becameInsane?: boolean; believerStrengthened?: boolean } {
    return this.religionSystem.endDeityConversation(targetAgentId)
  }

  public getActivePolicySession(): PolicySession | null {
    return this.politicalSystem.getActivePolicySession()
  }

  private beginDay(day: number): void {
    this.currentDay = day
    this.dailySchedules.clear()
    this.scheduleCursors.clear()
    this.activeBlocks.clear()
    for (const agent of this.agents) {
      const isKnight = agent.state.currentJob === 'Knight' || agent.state.outsider?.kind === 'knight'
      this.llmRequestStatuses.set(agent.state.id, agent.state.alive && !agent.state.demon && !isKnight ? 'pending' : 'idle')
    }
    this.compactMemories()
  }

  private ensureDailyPlans(): void {
    if (!this.aiProvider?.isAvailable() || this.llmRequestInFlight || this.storySystem.hasPendingNarrations()) return

    for (const agent of this.agents.filter((candidate) => candidate.state.alive && !candidate.state.demon)) {
      const isKnight = agent.state.currentJob === 'Knight' || agent.state.outsider?.kind === 'knight'
      if (isKnight) continue
      if (this.dailySchedules.has(agent.state.id) || this.pendingDecisions.has(agent.state.id)) continue
      const plannedDay = this.currentDay
      const promise = (async () => {
        const minuteOfDay = this.getMinuteOfDay()
        const prompt = this.promptBuilder.buildDailySchedulePrompt(
          agent,
          this.agents,
          plannedDay,
          minuteOfDay
        )
        const blocks = await this.runLLMRequestWithRetry(
          agent.state.id,
          `${agent.state.name} daily plan`,
          () => this.aiProvider!.planDay(agent.state.name, prompt)
        )
        if (plannedDay !== this.simManager.getDayNight().day || !agent.state.alive) return
        if (this.decisionQueue.get(agent.state.id)?.some((trigger) =>
          trigger.type === 'world_event' || trigger.type === 'prophecy'
        )) {
          // The plan was generated before a priority event arrived. Discard it
          // so a new event-informed schedule is requested afterward.
          return
        }
        if (this.activeBlocks.get(agent.state.id)?.fallback) {
          this.activeBlocks.delete(agent.state.id)
        }
        const repairedBlocks = this.religionSystem.ensureBelieverPrayerBlock(agent, blocks, minuteOfDay)
        this.dailySchedules.set(agent.state.id, { day: plannedDay, blocks: repairedBlocks })
        this.scheduleCursors.set(agent.state.id, 0)
        this.cultSystem.coordinateScheduledSummons()
        console.log(`[AgentManager] Planned ${repairedBlocks.length} blocks for ${agent.state.name} on day ${plannedDay}`)
      })()

      this.llmRequestInFlight = true
      this.pendingActivityLabels.set(agent.state.id, 'planning the day')
      this.pendingDecisions.set(agent.state.id, promise)
      promise
        .catch((error) => {
          console.error(`[AgentManager] Failed to apply ${agent.state.name}'s completed daily plan:`, error)
        })
        .finally(() => {
          this.pendingDecisions.delete(agent.state.id)
          this.pendingActivityLabels.delete(agent.state.id)
          this.llmRequestInFlight = false
        })
      return
    }
  }



  private startDueScheduleBlocks(): void {
    const minuteOfDay = this.getMinuteOfDay()
    for (const agent of this.agents.filter((candidate) => candidate.state.alive && !candidate.state.demon)) {
      if (
        this.activeBlocks.has(agent.state.id) ||
        this.pendingDecisions.has(agent.state.id) ||
        (this.decisionQueue.get(agent.state.id)?.length ?? 0) > 0
      ) continue
      const schedule = this.dailySchedules.get(agent.state.id)
      if (!schedule) continue

      let cursor = this.scheduleCursors.get(agent.state.id) ?? 0
      while (cursor < schedule.blocks.length) {
        const block = schedule.blocks[cursor]
        if (block.startMinute + block.durationMinutes > minuteOfDay) break
        cursor++
      }
      this.scheduleCursors.set(agent.state.id, cursor)

      const block = schedule.blocks[cursor]
      if (block && block.startMinute <= minuteOfDay) {
        this.startBlock(agent, block)
        this.scheduleCursors.set(agent.state.id, cursor + 1)
      }
    }
  }

  private startBlock(
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
      action.target = this.findJobBuilding(agent)?.name ?? null
      action.dialogue = ''
      action.reasoning = 'Construction is disabled; returning to ordinary work'
    }
    const isCultLeader = agent.state.cult != null && ['leader', 'founder'].includes(agent.state.cult.role)
    if ((agent.state.currentJob === 'Prophet' || isCultLeader) && action.action === 'work') {
      action.action = agent.state.cult ? 'preach' : 'pray'
      action.target = this.findBuildingOfType(agent, 'church')?.name ?? null
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
      action.target = this.findJobBuilding(agent)?.name ?? null
      action.dialogue = ''
      action.reasoning = 'Returning to ordinary duties because cult rites require cult membership'
    }
    if (action.action === 'invite_cult' && (
      !agent.state.cult || agent.state.cult.role !== 'leader'
    )) {
      action.action = 'work'
      action.target = this.findJobBuilding(agent)?.name ?? null
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
      action.target = this.findJobBuilding(agent)?.name ?? null
      action.dialogue = ''
      action.reasoning = 'Returning to ordinary duties: too little wealth, or no one named, to make a worthwhile bribe'
    }
    if (action.action === 'build_shrine') {
      const isLeader = Boolean(agent.state.cult && ['leader', 'founder'].includes(agent.state.cult.role))
      const alreadyHasShrine = isLeader && Boolean(this.cultSystem.findCultShrine(agent.state.cult!.id))
      const isChurchOfChristWithChurch = isLeader &&
        agent.state.cult!.id.startsWith('cult_christian_') &&
        Array.from(this.world.buildings.values()).some((b) => b.type === BuildingType.CHURCH)

      if (!isLeader || alreadyHasShrine || isChurchOfChristWithChurch) {
        action.action = 'work'
        action.target = this.findJobBuilding(agent)?.name ?? null
        action.dialogue = ''
        action.reasoning = !isLeader
          ? 'Only a cult leader can raise a shrine for the cult'
          : alreadyHasShrine
          ? 'The cult already has a shrine'
          : 'The Church of Christ already has a church in the world'
      }
    }
    if (action.action === 'summon') {
      const emptyLocation = this.cultSystem.findEmptySummoningBuilding(action.target, undefined, agent.state.cult?.id)
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
      const target = action.target ? this.findAgentByName(action.target, this.agents) : undefined
      const priestHasInquiry = ['Priest', 'Inquisitor'].includes(agent.state.currentJob ?? '') &&
        (agent.state.knownCultGroups?.length ?? 0) > 0
      const cultistInquiry = Boolean(agent.state.cult)
      if (!target?.state.alive || target.state.id === agent.state.id || (!priestHasInquiry && !cultistInquiry)) {
        action.action = 'work'
        action.target = this.findJobBuilding(agent)?.name ?? null
        action.dialogue = ''
        action.reasoning = priestHasInquiry || cultistInquiry
          ? 'Returning to ordinary duties because no valid interrogation target was named'
          : 'Investigation must establish a cult before a priest can interrogate suspected members'
      }
    }
    if (action.action === 'call_inquisitor' && !this.canPriestCallInquisitor(agent)) {
      action.action = 'work'
      action.target = this.findJobBuilding(agent)?.name ?? null
      action.dialogue = ''
      action.reasoning = this.inquisitorOutsiderSpawned
        ? 'An Inquisitor has already answered the town’s call'
        : 'A Priest must confirm at least two cultists by interrogation before calling an Inquisitor'
    }
    if (agent.state.cult && this.cultSystem.isVisibleCultActivity(action.action) && this.cultSystem.hasNearbyPriest(agent)) {
      action.action = 'rest'
      action.target = null
      action.dialogue = ''
      action.reasoning = 'Keeping cult activity hidden while a priest is nearby'
    }
    if (action.action === 'investigate' && !rumourId) {
      const undecidedRumour = [...this.rumours.values()].reverse().find(
        (rumour) =>
          rumour.heardBy.includes(agent.state.id) &&
          this.rumourSystem.isAgentUndecidedAboutRumour(agent.state.id, rumour.id) &&
          this.rumourSystem.isRumourUnresolved(rumour.id)
      )
      if (undecidedRumour) {
        rumourId = undecidedRumour.id
        const authority = this.rumourSystem.getInvestigationAuthority(agent, undecidedRumour) ?? 'personal fact finding'
        this.rumourSystem.prepareInvestigationDecision(agent, action, undecidedRumour, authority)
      } else {
        action.action = 'work'
        action.target = this.findJobBuilding(agent)?.name ?? null
        action.dialogue = ''
        action.reasoning = 'Returning to regular duties because no rumour remains undecided'
      }
    }
    const eventId = this.executeLLMDecision(agent, action, causationIds)
    if (propheticTask?.kind === 'form_cult') {
      // Founding is a state transition, not a delayed reward. Commit it as
      // soon as the formation action starts so another urgent trigger or a
      // save/reload cannot erase the cult before the timed block completes.
      this.cultSystem.formCult(agent, propheticTask, eventId)
    }
    this.activeBlocks.set(agent.state.id, {
      action,
      endsAt: this.getAbsoluteMinute() + (action.durationMinutes ?? 30),
      eventId,
      rumourId: action.action === 'investigate' ? rumourId : undefined,
      fallback,
      propheticTask,
    })
    if (action.action === 'summon') this.cultSystem.gatherCultForSummoning(agent, action)
  }

  // RECOVERY NOTE: this method's original opening logic was lost to an
  // in-session file-corruption bug during the CULT extraction pass and has
  // been reconstructed from its surviving tail, call site, and startBlock
  // signature. The tail below (the startBlock call and its action object)
  // is the original text; everything above it in this method body is a
  // best-effort reconstruction and should be reviewed against the pre-change
  // behavior if available.
  private ensureFallbackActivities(): void {
    for (const agent of this.agents) {
      if (!agent.state.alive) continue
      if (this.activeBlocks.has(agent.state.id)) continue
      if ((this.decisionQueue.get(agent.state.id)?.length ?? 0) > 0) continue
      if (this.pendingDecisions.has(agent.state.id)) continue
      const jobBuilding = this.findJobBuilding(agent)
      const isDivine = agent.state.currentJob === 'Priest' || agent.state.currentJob === 'Prophet' || agent.state.cult !== undefined
      const isPreaching = agent.state.cult?.role === 'leader' || agent.state.currentJob === 'Priest'
      this.startBlock(agent, {
        action: isDivine ? (agent.state.cult ? 'preach' : 'pray') : 'work',
        target: isDivine
          ? this.findBuildingOfType(agent, 'church')?.name ?? null
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

  private completeFinishedBlocks(): void {
    const now = this.getAbsoluteMinute()
    for (const [agentId, active] of this.activeBlocks) {
      const agent = this.agents.find((candidate) => candidate.state.id === agentId)
      if (!agent?.state.alive) {
        this.activeBlocks.delete(agentId)
        continue
      }
      if (active.summonLeaderId && active.summonSite) {
        const leaderBlock = this.activeBlocks.get(active.summonLeaderId)
        if (!leaderBlock || leaderBlock.action.action !== 'summon') {
          this.activeBlocks.delete(agentId)
          continue
        }
        const leader = this.agents.find((candidate) => candidate.state.id === active.summonLeaderId)
        const hasBeenInvited = leaderBlock.summonInvitedMemberIds?.includes(agentId) ?? false
        if (hasBeenInvited && leader?.state.alive) {
          const memberIndex = leaderBlock.summonedMemberIds?.indexOf(agentId) ?? 0
          const destination = leaderBlock.summonPhase === 'travelling' && leaderBlock.summonSite
            ? this.cultSystem.getSummoningParticipantSlot(leaderBlock.summonSite, Math.max(0, memberIndex))
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
        if (this.cultSystem.advanceSummoningProcess(agent, active, now)) continue
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
            this.pendingDecisions.has(active.investigationIntervieweeId) ||
            (this.decisionQueue.get(active.investigationIntervieweeId)?.length ?? 0) > 0
          ))
        if (interviewStillActive) {
          active.endsAt = now + 10
          continue
        }
      }

      this.activeBlocks.delete(agentId)
      if (active.fallback) continue
      if (active.demonAttackTargetId) {
        const target = this.agents.find((candidate) =>
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
          const pursuit = this.activeBlocks.get(agentId)
          if (pursuit?.action.action === 'move') pursuit.demonAttackTargetId = target.state.id
          continue
        }
      }
      if (active.action.action === 'preach') {
        const shrine = agent.state.cult ? this.cultSystem.findCultShrine(agent.state.cult.id) : undefined
        const stillTraveling = shrine && (() => {
          const center = this.cultSystem.getSummoningBuildingCenter(shrine)
          return Math.hypot(agent.state.position.x - center.x, agent.state.position.y - center.y) > 3
        })()
        if (stillTraveling) {
          this.startBlock(agent, { ...active.action, durationMinutes: 15 }, [active.eventId])
          continue
        }
        this.cultSystem.completeCultAbility(agent, active.action, active.eventId)
      } else if (['pray', 'conjure', 'summon', 'resurrect', 'heal', 'bless', 'curse', 'ritual'].includes(active.action.action)) {
        this.cultSystem.completeCultAbility(agent, active.action, active.eventId)
      }
      if (active.action.action === 'build_shrine') {
        this.cultSystem.completeCultShrineConstruction(agent, active.eventId)
      }
      if (active.action.action === 'invite_cult') {
        const target = active.action.target ? this.findAgentByName(active.action.target, this.agents) : undefined
        if (target?.state.alive) {
          if (agent.distanceTo(target.state) <= 4) {
            this.cultSystem.attemptCultRecruitment(agent, target, {
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
        const target = active.action.target ? this.findAgentByName(active.action.target, this.agents) : undefined
        if (target?.state.alive) {
          if (agent.distanceTo(target.state) <= 4) {
            if (this.politicalSystem.canAttemptCultBribery(agent, target)) {
              this.politicalSystem.attemptCultBribery(agent, target, active.action.reasoning, active.eventId)
            } else {
              this.politicalSystem.attemptFavorBribery(agent, target, active.action.reasoning, active.eventId)
            }
          } else {
            this.startBlock(agent, { ...active.action, durationMinutes: 10 }, [active.eventId])
            continue
          }
        }
      }
      if (active.action.action === 'interrogate') {
        const target = active.action.target ? this.findAgentByName(active.action.target, this.agents) : undefined
        if (target?.state.alive && agent.distanceTo(target.state) > 4) {
          this.startBlock(agent, { ...active.action, durationMinutes: 10 }, [active.eventId])
          continue
        }
        this.rumourSystem.completeAffiliationInterrogation(agent, active.action, active.eventId)
      }
      if (active.propheticTask) {
        const target = active.propheticTask.target
          ? this.findAgentByName(active.propheticTask.target, this.agents)
          : undefined
        if (active.propheticTask.kind === 'form_cult') {
          this.cultSystem.formCult(agent, active.propheticTask, active.eventId)
        } else if (active.propheticTask.kind === 'convert' && target?.state.alive) {
          this.cultSystem.attemptCultRecruitment(agent, target, active.propheticTask, active.eventId)
        }
        const completed = active.propheticTask.kind === 'sacrifice'
          ? Boolean(target && !target.state.alive)
          : active.action.action !== 'move'
        if (!completed) {
          this.enqueueDecision(agentId, {
            type: 'prophetic_task',
            rumourId: active.rumourId,
            propheticTask: active.propheticTask,
            description: `Continue fulfilling the prophetic command: ${active.propheticTask.reasoning}`,
            causationIds: [active.eventId],
          })
          continue
        }
        const completionEvent = this.eventBus.emit({
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
          ? this.findAgentByName(active.action.target, this.agents)
          : undefined
        if (target?.state.alive && !agent.isConversationActive()) {
          this.enqueueDecision(agentId, {
            type: 'idle_recovery',
            targetAgentId: target.state.id,
            description: `You sought out ${target.state.name} because you had been inactive. Start a conversation with them now, or continue approaching if they moved away.`,
            causationIds: [active.eventId],
          })
          continue
        }
      }
      const investigationFinding = active.rumourId
        ? this.rumourSystem.completeRumourInvestigation(active.rumourId, agent, active.eventId)
        : undefined
      this.enqueueDecision(agentId, {
        type: 'task_complete',
        description: investigationFinding ?? `${agent.state.name} completed the ${active.action.action} block: ${active.action.reasoning}`,
        causationIds: [active.eventId],
      })
    }
  }




  private processDecisionQueue(): void {
    if (!this.aiProvider?.isAvailable() || this.llmRequestInFlight || this.storySystem.hasPendingNarrations()) return

    const queuedAgents = Array.from(this.decisionQueue.entries()).sort(
      ([firstId, firstTriggers], [secondId, secondTriggers]) =>
        Number(secondTriggers.some((trigger) => trigger.type === 'prophecy' || trigger.type === 'prophetic_task' || trigger.type === 'seek_cult_leader')) -
        Number(firstTriggers.some((trigger) => trigger.type === 'prophecy' || trigger.type === 'prophetic_task' || trigger.type === 'seek_cult_leader')) ||
        Number(secondTriggers.some((trigger) => trigger.type === 'world_event')) -
        Number(firstTriggers.some((trigger) => trigger.type === 'world_event')) ||
        Number(this.rumourSystem.hasPrioritySheriffRumour(secondId, secondTriggers)) -
        Number(this.rumourSystem.hasPrioritySheriffRumour(firstId, firstTriggers))
    )
    for (const [agentId, triggers] of queuedAgents) {
      if (triggers.length === 0 || this.pendingDecisions.has(agentId)) continue
      if (this.activeBlocks.has(agentId) && !triggers.some((trigger) =>
        trigger.type === 'prophecy' || trigger.type === 'prophetic_task' || trigger.type === 'world_event' || trigger.type === 'seek_cult_leader'
      )) continue
      const agent = this.agents.find((candidate) => candidate.state.id === agentId)
      if (!agent?.state.alive) {
        this.decisionQueue.delete(agentId)
        continue
      }
      const isKnight = agent.state.currentJob === 'Knight' || agent.state.outsider?.kind === 'knight'
      if (agent.state.demon || isKnight) {
        this.decisionQueue.delete(agentId)
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
            this.rumourSystem.isRumourUnresolved(candidate.rumourId) &&
            this.rumourSystem.isAgentUndecidedAboutRumour(agentId, candidate.rumourId))
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
        const schedule = this.getRemainingSchedule(agentId)
        let decision: AgentAction
        if (trigger.type === 'prophetic_task' && trigger.propheticTask) {
          decision = this.religionSystem.buildPropheticTaskDecision(agent, trigger.propheticTask)
        } else if (trigger.type === 'seek_cult_leader') {
          decision = this.cultSystem.buildSeekCultLeaderDecision(agent)
        } else if (trigger.type === 'prophecy' && trigger.rumourId) {
          const revelation = this.rumours.get(trigger.rumourId)
          if (!revelation) return
          const deityName = revelation.provenance.deityName ?? 'The Divine'
          let interpretation: PropheticInterpretation
          try {
            interpretation = await this.runLLMRequestWithRetry(
              agentId,
              `${agent.state.name} prophetic interpretation`,
              () => this.aiProvider!.interpretDivineRevelation(
                agent.state.name,
                this.promptBuilder.buildPropheticInterpretationPrompt(
                  agent, this.agents, revelation.text, deityName
                )
              ),
              4
            )
          } catch (error) {
            if (this.isAgentRefreshCancellation(error)) return
            console.warn(`[AgentManager] ${agent.state.name}'s prophetic interpretation failed after four attempts; using a command-aware fallback.`, error)
            interpretation = this.religionSystem.buildFallbackPropheticInterpretation(agent, revelation, deityName)
          }
          decision = await this.religionSystem.applyPropheticInterpretation(agent, revelation, interpretation, trigger.causationIds)
        } else {
          const prompt = this.promptBuilder.buildTriggeredDecisionPrompt(
            agent,
            this.agents,
            trigger,
            schedule,
            this.lastActions.get(agentId),
            this.conversationManager.getConversationContext(agent, this.agents),
            [
              trigger.rumourId ? this.rumourSystem.buildBeliefActionContext(agent, trigger.rumourId) : '',
              this.rumourSystem.buildRumourConversationContext(agent, conversationPartnerId),
            ].filter(Boolean).join('\n')
          )
          decision = await this.runLLMRequestWithRetry(
            agentId,
            `${agent.state.name} ${trigger.type} decision`,
            () => this.aiProvider!.decide(agent.state.name, prompt)
          )
        }
        if (
          trigger.type !== 'world_event' && trigger.type !== 'prophecy' &&
          this.decisionQueue.get(agentId)?.some((queued) => queued.type === 'world_event' || queued.type === 'prophecy')
        ) {
          return
        }
        const activeCourt = this.justiceSystem.state.activeCourtRumourId
          ? this.rumours.get(this.justiceSystem.state.activeCourtRumourId)?.resolutionCourt
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
        if (this.activeBlocks.get(agentId)?.summonLeaderId) {
          // Discard a response requested before ritual selection so it cannot
          // replace deterministic following with a conversational reaction.
          return
        }
        if (mustRespondToPartner && conversationPartnerId) {
          this.forceConversationResponse(agent, decision, conversationPartnerId)
        }
        if (trigger.rumourId && trigger.type !== 'prophecy' && trigger.type !== 'prophetic_task') {
          const rumour = this.rumours.get(trigger.rumourId)
          if (rumour && this.rumourSystem.findKnownDeceased(agent, rumour)) {
            decision.emotionalState = 'grieving'
          }
          const authority = rumour ? this.rumourSystem.getInvestigationAuthority(agent, rumour) : null
          const sheriffMayInvestigate = agent.state.currentJob === 'Sheriff' && rumour?.status === 'investigating'
          const shouldInvestigate = rumour && authority && !rumour.archived &&
            this.rumourSystem.isAgentUndecidedAboutRumour(agentId, rumour.id) &&
            (rumour.status === 'unverified' || sheriffMayInvestigate) &&
            !rumour.investigatorIds.includes(agent.state.id)
          if (shouldInvestigate && rumour && authority) {
            if (mustRespondToPartner) {
              this.rumourSystem.ensureRumourMentioned(agent, decision, rumour, false)
              this.enqueueDecision(agentId, {
                type: 'rumour',
                description: `Follow up on your authority to investigate this rumour: "${rumour.text}"`,
                rumourId: rumour.id,
                causationIds: trigger.causationIds,
              })
            } else {
              this.rumourSystem.prepareInvestigationDecision(agent, decision, rumour, authority)
            }
          } else if (
            rumour &&
            !this.rumourSystem.isAgentUndecidedAboutRumour(agentId, rumour.id) &&
            decision.action === 'investigate'
          ) {
            decision.action = 'work'
            decision.target = this.findJobBuilding(agent)?.name ?? null
            decision.dialogue = ''
            decision.durationMinutes = 30
            decision.reasoning = `Returning to regular duties after deciding the rumour is ${this.rumourSystem.getOrCreateRumourBelief(rumour, agent).stance === 'believer' ? 'credible' : 'not credible'}`
          }
          if (rumour) {
            const belief = this.rumourSystem.getOrCreateRumourBelief(rumour, agent)
            if (
              belief.stance === 'believer' &&
              decision.justiceResponse &&
              this.rumourSystem.findAccusedAgent(rumour)?.state.id !== agent.state.id
            ) {
              belief.justiceResponse = decision.justiceResponse
              belief.justiceResponseExplicit = true
            }
          }
          if (rumour && ['talk', 'attack', 'steal', 'help'].includes(decision.action)) {
            const mutation = this.rumourSystem.maybeMutateRumour(agent, rumour)
            if (mutation.id !== rumour.id && decision.action === 'talk') {
              const mutationLine = `The story may be different now: ${mutation.text}`
              decision.dialogue = decision.dialogue?.trim()
                ? `${decision.dialogue.trim()} ${mutationLine}`
                : mutationLine
            }
          }
          if (rumour) this.rumourSystem.attachHostileActionToBelief(agent, rumour, decision)
          this.rumourSystem.recordRumourResponse(trigger.rumourId, agent, decision)
        }
        if (trigger.type === 'idle_recovery') {
          const socialTarget = this.agents.find((candidate) =>
            candidate.state.id === trigger.targetAgentId &&
            candidate.state.alive &&
            !candidate.isConversationActive()
          ) ?? this.findNearestAvailableSocialTarget(agent)
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
            decision.target = this.findJobBuilding(agent)?.name ?? null
            decision.reasoning = '[idle recovery] Staying occupied because nobody is currently available to talk.'
            decision.durationMinutes = 30
          }
        }
        const isAlreadySleeping = this.activeBlocks.get(agent.state.id)?.action.action === 'sleep'
        const isInReligiousFervour = this.religionSystem.state.religiousFervourTargets.has(agent.state.id)
        if (agent.state.alive && !isAlreadySleeping && !isInReligiousFervour) {
          this.startBlock(agent, decision, trigger.causationIds, trigger.rumourId, false, trigger.propheticTask)
        }
      })()

      this.llmRequestInFlight = true
      const pendingRumourInvestigation = trigger.rumourId
        ? this.rumourSystem.isAgentUndecidedAboutRumour(agentId, trigger.rumourId) &&
          Boolean(this.rumourSystem.getInvestigationAuthority(agent, this.rumours.get(trigger.rumourId)!))
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
      this.pendingActivityLabels.set(agentId, pendingLabel)
      this.pendingDecisions.set(agentId, promise)
      promise
        .catch((error) => {
          console.error(`[AgentManager] Failed to apply ${agent.state.name}'s completed decision:`, error)
        })
        .finally(() => {
          this.pendingDecisions.delete(agentId)
          this.pendingActivityLabels.delete(agentId)
          this.llmRequestInFlight = false
        })
      return
    }
  }



  private isAgentRefreshCancellation(error: unknown): boolean {
    return error instanceof Error && error.message.includes('cancelled by an agent-state refresh')
  }

  private async runLLMRequestWithRetry<T>(
    agentId: string,
    label: string,
    request: () => Promise<T>,
    maxAttempts = 4
  ): Promise<T> {
    const requestEpoch = this.queryEpoch
    let attempt = 0
    while (true) {
      if (requestEpoch !== this.queryEpoch) throw new Error(`${label} was cancelled by an agent-state refresh`)
      if (this.shouldCancelRequestForCourt(agentId, label)) {
        this.llmRequestStatuses.set(agentId, 'idle')
        throw new Error(`${label} was superseded by a resolution court`)
      }
      attempt++
      try {
        this.llmRequestStatuses.set(agentId, 'sent')
        this.llmQueryStats.made++
        const result = await request()
        if (requestEpoch !== this.queryEpoch) throw new Error(`${label} was cancelled by an agent-state refresh`)
        this.llmQueryStats.successful++
        this.llmRequestStatuses.set(agentId, 'idle')
        return result
      } catch (error) {
        if (requestEpoch !== this.queryEpoch) {
          this.llmRequestStatuses.set(agentId, 'idle')
          throw error
        }
        if (this.shouldCancelRequestForCourt(agentId, label)) {
          this.llmRequestStatuses.set(agentId, 'idle')
          throw error
        }
        // A story moment narration takes priority over routine retries: if one is
        // waiting on the shared slot, give it up now rather than burning through
        // the remaining attempts (each with its own LLM round-trip plus backoff),
        // which can easily outlast waitForLLMSlot's wait window and starve the
        // narration out entirely.
        if (label !== 'story moment narration' && this.storySystem.hasPendingNarrations()) {
          this.llmRequestStatuses.set(agentId, 'idle')
          throw error
        }
        if (attempt >= maxAttempts) {
          this.llmRequestStatuses.set(agentId, 'failed')
          throw error
        }
        this.llmRequestStatuses.set(agentId, 'retrying')
        console.error(`[AgentManager] ${label} failed on attempt ${attempt}; retrying in 1 second:`, error)
        await new Promise<void>((resolve) => window.setTimeout(resolve, 1000))
      }
    }
  }


  private shouldCancelRequestForCourt(agentId: string, label: string): boolean {
    // This guard exists to drop an agent's own routine LLM request (a daily
    // plan, a prophecy) when that same agent is urgently needed in a court
    // or policy vote. Story moment narration isn't that -- it's a global
    // chronicle entry that happens to be tagged with an agent's id only for
    // status-tracking, so it must never be cancelled just because that
    // agent (e.g. a prominent Priest) is also a court/policy participant.
    if (/court|verdict|policy|story moment/i.test(label)) return false
    if (this.justiceSystem.state.activeCourtRumourId) {
      const court = this.rumours.get(this.justiceSystem.state.activeCourtRumourId)?.resolutionCourt
      if (court && (court.accusedAgentId === agentId || court.participantIds.includes(agentId))) return true
    }
    if (this.politicalSystem.state.activePolicySessionId) {
      const session = this.politicalSystem.state.policySessions.get(this.politicalSystem.state.activePolicySessionId)
      if (session?.participantIds.includes(agentId)) return true
    }
    return false
  }

  private handleDecisionEvent(event: SimulationEvent): void {
    if (this.processedEventIds.has(event.id)) return
    this.processedEventIds.add(event.id)
    if (this.processedEventIds.size > 1000) {
      this.processedEventIds = new Set(Array.from(this.processedEventIds).slice(-500))
    }
    this.applyReputationEffect(event)

    if (event.worldStateDelta.summoningInvitation === true) return

    if (event.type === 'weather') {
      for (const agent of this.agents.filter((candidate) => candidate.state.alive)) {
        agent.addRecentMemory(event)
      }
      return
    }

    if (event.type === 'attack' && event.outcome === 'injury' && event.targetId) {
      this.justiceSystem.sendAttackVictimToAuthority(event)
    }

    const interactionEvent =
      event.type === 'conversation' ||
      event.type === 'attack' ||
      event.type === 'theft' ||
      event.type === 'death' ||
      (event.type === 'help' && event.outcome === 'healed')
    if (interactionEvent && event.targetId && event.targetId !== event.agentId) {
      const target = this.agents.find((candidate) => candidate.state.id === event.targetId)
      const speaker = this.agents.find((candidate) => candidate.state.id === event.agentId)
      const conversation = event.type === 'conversation' ? target?.getActiveConversation() : null
      if (conversation && conversation.exchanges.length >= conversation.maxTurns) {
        if (target && speaker) this.conversationManager.closeConversation(target, speaker)
      } else if (
        event.type === 'conversation' &&
        this.pregeneratedConversations.has(this.conversationPairKey(event.agentId, event.targetId))
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
      this.rumourSystem.maybeSpreadRumour(event)
      this.religionSystem.maybeResolveReligiousConversion(event)
    }

    this.rumourSystem.maybeCreateNaturalRumour(event)

    const notableWorldEvent = ['death', 'destroy_building', 'build'].includes(event.type)
    if (notableWorldEvent) {
      const source = this.agents.find((candidate) => candidate.state.id === event.agentId)
      if (!source) return
      for (const observer of this.agents) {
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


  private applyReputationEffect(event: SimulationEvent): void {
    const actor = this.agents.find((agent) => agent.state.id === event.agentId)
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

  private detectAgentEncounters(): void {
    const activeAgents = this.agents.filter((agent) => agent.state.alive && !agent.state.demon)
    const now = this.getAbsoluteMinute()

    for (let i = 0; i < activeAgents.length; i++) {
      for (let j = i + 1; j < activeAgents.length; j++) {
        const first = activeAgents[i]
        const second = activeAgents[j]
        const pairKey = [first.state.id, second.state.id].sort().join(':')
        const distance = first.distanceTo(second.state)

        if (distance > 4) {
          this.activeEncounterPairs.delete(pairKey)
          continue
        }
        if (distance > 2) continue

        if (this.activeEncounterPairs.has(pairKey)) continue

        const talkingToEachOther =
          first.getConversationPartnerId() === second.state.id ||
          second.getConversationPartnerId() === first.state.id
        if (talkingToEachOther) {
          this.activeEncounterPairs.add(pairKey)
          continue
        }

        if (first.isConversationActive() || second.isConversationActive()) continue

        const lastEncounter = this.lastEncounterMinute.get(pairKey) ?? -Infinity
        if (now - lastEncounter < 60) continue

        this.activeEncounterPairs.add(pairKey)
        this.lastEncounterMinute.set(pairKey, now)

        const firstSocialScore = first.state.personality.friendliness + (100 - first.state.needs.social) / 100
        const secondSocialScore = second.state.personality.friendliness + (100 - second.state.needs.social) / 100
        const initiator = firstSocialScore >= secondSocialScore ? first : second
        const encountered = initiator === first ? second : first
        const isKnown = this.agentKnows(initiator, encountered)
        const baseConversationChance = 0.35
        const configuredMultiplier = Math.max(
          0,
          this.simManager.getConfig().conversationChanceMultiplier
        )
        const rumourMultiplier = this.rumourSystem.hasRumourPropagationOpportunity(initiator, encountered)
          ? Math.max(0, this.simManager.getConfig().rumourPropagationMultiplier)
          : 1
        const acknowledges = isKnown || Math.random() <= Math.min(
          1,
          baseConversationChance * configuredMultiplier * rumourMultiplier
        )
        const encounterEvent = this.eventBus.emit({
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

        const simTime = this.simManager.getSimTime()
        const eligibility = this.conversationManager.checkConversationEligibility(
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
        this.conversationManager.initiateConversation(
          initiator,
          encountered,
          dialogue,
          'daily plans, work, and town life',
          simTime
        )
        this.agentInteraction.handleConversation(
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

  private enforceExhaustionSleep(): void {
    for (const agent of this.agents.filter((candidate) => candidate.state.alive && !candidate.state.demon && !candidate.isInsane())) {
      if (agent.state.needs.energy > 0) continue
      if (this.activeBlocks.get(agent.state.id)?.action.action === 'sleep') continue

      const partnerId = agent.getConversationPartnerId()
      const partner = partnerId
        ? this.agents.find((candidate) => candidate.state.id === partnerId)
        : undefined
      if (partner) this.conversationManager.closeConversation(agent, partner)
      else agent.closeActiveConversation()

      this.activeBlocks.delete(agent.state.id)
      const home = this.findBuildingOfType(agent, 'home')
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

  private enforceNightSleep(): void {
    if (this.simManager.getDayNight().isDaytime) return
    for (const agent of this.agents.filter((candidate) =>
      candidate.state.alive && !candidate.state.demon && !candidate.isInsane() && !candidate.state.outsider
    )) {
      if (this.activeBlocks.get(agent.state.id)?.action.action === 'sleep') continue

      const partnerId = agent.getConversationPartnerId()
      const partner = partnerId
        ? this.agents.find((candidate) => candidate.state.id === partnerId)
        : undefined
      if (partner) this.conversationManager.closeConversation(agent, partner)
      else agent.closeActiveConversation()

      this.activeBlocks.delete(agent.state.id)
      const home = this.findBuildingOfType(agent, 'home')
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


  // RECOVERY NOTE: this method's original opening logic was lost to an
  // in-session file-corruption bug during the CULT extraction pass and has
  // been reconstructed from its surviving tail (the startBlock call below,
  // which is original text) and its call site. Review against the
  // pre-change behavior if available.
  private enforceWeatherSafety(): void {
    const weather = this.simManager.getWeather()
    if (weather.condition !== 'storm') return
    for (const [agentId, active] of this.activeBlocks) {
      const agent = this.agents.find((candidate) => candidate.state.id === agentId)
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

  private isAgentOutdoors(agent: Agent): boolean {
    const building = this.world.getBuildingAt(
      Math.round(agent.state.position.x),
      Math.round(agent.state.position.y)
    )
    return !building || building.type === BuildingType.PARK || building.type === BuildingType.TOWN_SQUARE
  }

  private findNearestIndoorShelter(agent: Agent): import('@/types').Building | null {
    const outdoorTypes = new Set([BuildingType.PARK, BuildingType.TOWN_SQUARE])
    const shelters = Array.from(this.world.buildings.values()).filter(
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

  private agentKnows(agent: Agent, other: Agent): boolean {
    if (agent.state.relationships.some((relationship) => relationship.agentId === other.state.id)) {
      return true
    }
    return Array.from(agent.conversations.values()).some((conversation) =>
      conversation.participants.includes(other.state.id)
    )
  }

  private forceConversationResponse(
    agent: Agent,
    decision: AgentAction,
    partnerId: string
  ): void {
    const partner = this.agents.find((candidate) => candidate.state.id === partnerId && candidate.state.alive)
    if (!partner || agent.distanceTo(partner.state) > 4) return

    decision.action = 'talk'
    decision.target = partner.state.name
    decision.durationMinutes = Math.min(decision.durationMinutes ?? 5, 10)

    const dialogue = decision.dialogue?.trim() ?? ''
    if (this.isWeakOrRepeatedDialogue(agent, dialogue)) {
      decision.dialogue = this.buildContextualConversationResponse(agent, partner)
    }
    this.rumourSystem.maybeAddRumourToConversation(agent, partner, decision)
    decision.reasoning = `Responding to ${partner.state.name}'s conversation`
  }


  private conversationPairKey(agentId: string, partnerId: string): string {
    return [agentId, partnerId].sort().join('-')
  }

  private canBatchGenerateConversation(a: Agent, b: Agent): boolean {
    if (!this.aiProvider?.isAvailable()) return false
    if (a.state.demon || b.state.demon) return false
    if (a.state.cult || b.state.cult) return false
    const isKnight = (agent: Agent) => agent.state.currentJob === 'Knight' || agent.state.outsider?.kind === 'knight'
    if (isKnight(a) || isKnight(b)) return false

    const specialTriggerTypes = new Set(['rumour', 'prophecy', 'prophetic_task', 'world_event'])
    const hasSpecialTrigger = (agentId: string) =>
      (this.decisionQueue.get(agentId) ?? []).some((trigger) => specialTriggerTypes.has(trigger.type))
    if (hasSpecialTrigger(a.state.id) || hasSpecialTrigger(b.state.id)) return false

    if (this.rumourSystem.buildRumourConversationContext(a, b.state.id) || this.rumourSystem.buildRumourConversationContext(b, a.state.id)) {
      return false
    }

    if (this.justiceSystem.state.activeCourtRumourId) {
      const court = this.rumours.get(this.justiceSystem.state.activeCourtRumourId)?.resolutionCourt
      if (
        court &&
        (court.participantIds.includes(a.state.id) || court.participantIds.includes(b.state.id) ||
          court.accusedAgentId === a.state.id || court.accusedAgentId === b.state.id)
      ) return false
    }

    return true
  }

  private maybeBatchGenerateConversation(
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

    const prompt = this.promptBuilder.buildConversationTranscriptPrompt(
      initiator,
      target,
      this.agents,
      topic,
      openingSpeaker.state.name,
      openingLine,
      remainingTurns
    )

    void (async () => {
      try {
        const turns = await this.aiProvider!.generateConversation(
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

        this.pregeneratedConversations.set(pairKey, {
          lines,
          nextAt: this.simManager.getSimTime() + 2500 + Math.random() * 2500,
        })
        // The opener's 'conversation' event may already have queued a reply trigger; the
        // pre-written lines supersede it.
        const queued = this.decisionQueue.get(respondent.state.id)
        if (queued) {
          this.decisionQueue.set(respondent.state.id, queued.filter((trigger) => trigger.type !== 'interaction'))
        }
      } catch {
        // Leave the normal turn-by-turn path (already queued from the opener event) untouched.
      }
    })()
  }

  private advancePregeneratedConversations(simTime: number): void {
    for (const [pairKey, entry] of Array.from(this.pregeneratedConversations.entries())) {
      const [firstId, secondId] = pairKey.split('-')
      const first = this.agents.find((candidate) => candidate.state.id === firstId)
      const second = this.agents.find((candidate) => candidate.state.id === secondId)
      if (
        !first?.state.alive || !second?.state.alive ||
        first.getConversationPartnerId() !== second.state.id ||
        second.getConversationPartnerId() !== first.state.id ||
        first.distanceTo(second.state) > 4
      ) {
        this.pregeneratedConversations.delete(pairKey)
        continue
      }

      const specialTriggerTypes = new Set(['world_event', 'prophecy', 'prophetic_task'])
      const wasInterrupted = [first, second].some((agent) =>
        (this.decisionQueue.get(agent.state.id) ?? []).some((trigger) => specialTriggerTypes.has(trigger.type))
      )
      if (wasInterrupted) {
        this.pregeneratedConversations.delete(pairKey)
        continue
      }

      if (simTime < entry.nextAt || entry.lines.length === 0) continue

      const line = entry.lines.shift()!
      const speaker = line.speakerId === first.state.id ? first : second
      const listener = speaker === first ? second : first
      const added = this.conversationManager.addTurn(speaker, listener, line.dialogue, simTime)
      if (added) {
        this.agentInteraction.handleConversation(speaker, listener, line.dialogue)
      }
      entry.nextAt = simTime + 2500 + Math.random() * 2500
      if (entry.lines.length === 0) this.pregeneratedConversations.delete(pairKey)
    }
  }
















  private isWeakOrRepeatedDialogue(agent: Agent, dialogue: string): boolean {
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

  private buildContextualConversationResponse(agent: Agent, partner: Agent): string {
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
    const nextBlock = this.getRemainingSchedule(agent.state.id)?.blocks[0]
    const nextPlan = nextBlock
      ? `After that, I plan to ${this.describePlannedAction(nextBlock)}.`
      : 'I have not settled on what I will do afterward.'
    const building = this.world.getBuildingAt(
      Math.round(agent.state.position.x),
      Math.round(agent.state.position.y)
    )
    const weather = this.simManager.getWeather()

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

  private describePlannedAction(action: AgentAction): string {
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

  private buildEncounterOpener(initiator: Agent, encountered: Agent, isKnown: boolean): string {
    const firstName = encountered.state.name.split(' ')[0]
    const greeting = Math.random() < 0.5 ? 'Hi' : 'Hello'
    const building = this.world.getBuildingAt(
      Math.round(initiator.state.position.x),
      Math.round(initiator.state.position.y)
    )
    const priorConversations = this.eventBus.getHistory().filter((event) =>
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

  private enqueueDecision(agentId: string, trigger: DecisionTrigger): void {
    const queue = this.decisionQueue.get(agentId) ?? []
    if (trigger.eventId && queue.some((queued) => queued.eventId === trigger.eventId)) return
    if (trigger.type === 'world_event' || trigger.type === 'prophecy' || trigger.type === 'seek_cult_leader') queue.unshift(trigger)
    else queue.push(trigger)
    this.decisionQueue.set(agentId, queue)
    if (!this.pendingDecisions.has(agentId)) {
      const agent = this.agents.find((a) => a.state.id === agentId)
      const isKnight = agent?.state.currentJob === 'Knight' || agent?.state.outsider?.kind === 'knight'
      this.llmRequestStatuses.set(agentId, isKnight ? 'idle' : 'pending')
    }
  }

  private preventProlongedIdle(): void {
    const now = this.getAbsoluteMinute()
    for (const agent of this.agents.filter((candidate) => candidate.state.alive && !candidate.state.demon)) {
      const agentId = agent.state.id
      const inactive =
        !this.activeBlocks.has(agentId) &&
        !this.pendingDecisions.has(agentId) &&
        (this.decisionQueue.get(agentId)?.length ?? 0) === 0 &&
        !agent.isConversationActive() &&
        (agent.state.path.length === 0 || agent.state.pathIndex >= agent.state.path.length)
      if (!inactive) {
        this.idleSinceMinute.delete(agentId)
        continue
      }
      const idleSince = this.idleSinceMinute.get(agentId) ?? now
      this.idleSinceMinute.set(agentId, idleSince)
      if (now - idleSince < 15) continue

      const target = this.findNearestAvailableSocialTarget(agent)
      this.enqueueDecision(agentId, {
        type: 'idle_recovery',
        targetAgentId: target?.state.id,
        description: target
          ? `You have had no activity for 15 simulated minutes. Seek out ${target.state.name} and start a conversation rather than remaining idle.`
          : 'You have had no activity for 15 simulated minutes. Find something useful to do rather than remaining idle.',
        causationIds: [],
      })
      this.idleSinceMinute.delete(agentId)
    }
  }

  private findNearestAvailableSocialTarget(agent: Agent): Agent | undefined {
    return this.agents
      .filter((candidate) =>
        candidate.state.alive &&
        candidate.state.id !== agent.state.id &&
        !candidate.isConversationActive()
      )
      .sort((first, second) => agent.distanceTo(first.state) - agent.distanceTo(second.state))[0]
  }

  private mergeTriggers(triggers: DecisionTrigger[]): DecisionTrigger {
    const primary = triggers[triggers.length - 1]
    const rumourId = [...triggers].reverse().find((trigger) => trigger.rumourId)?.rumourId
    return {
      ...primary,
      rumourId,
      description: triggers.map((trigger) => trigger.description).join('\n'),
      causationIds: [...new Set(triggers.flatMap((trigger) => trigger.causationIds))],
    }
  }

  private getRemainingSchedule(agentId: string): DailySchedule | undefined {
    const schedule = this.dailySchedules.get(agentId)
    if (!schedule) return undefined
    const cursor = this.scheduleCursors.get(agentId) ?? 0
    return { ...schedule, blocks: schedule.blocks.slice(cursor) }
  }

  private getMinuteOfDay(): number {
    const clock = this.simManager.getDayNight()
    return clock.hour * 60 + clock.minute
  }

  private getAbsoluteMinute(): number {
    const clock = this.simManager.getDayNight()
    return (clock.day - 1) * 1440 + this.getMinuteOfDay()
  }

  private compactMemories(): void {
    const maxSummaryLength = 1500
    for (const agent of this.agents) {
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
  private trimSummaryToEntryBoundary(summary: string, maxLength: number): string {
    if (summary.length <= maxLength) return summary
    const truncated = summary.slice(summary.length - maxLength)
    const boundary = truncated.indexOf('; ')
    return boundary === -1 ? truncated : truncated.slice(boundary + 2)
  }
















  // A Priest who already founded the village's seeded "Church of Christ"
  // resists an ordinary appointment: they are a devout founder, not an
  // undecided villager. Instead, a whispered divine message gives them a
  // chance to be secretly corrupted -- their public job and congregation
  // stay outwardly unchanged while they privately become the true Prophet
  // and, moments later, the hidden leader of a renamed cult (see
  // corruptChurchOfChrist). Stronger faith and a more cautious personality
  // resist the pull; a fraying mind and idle curiosity invite it.


  // The renaming half of a Priest's secret corruption: the congregation
  // they already founded is quietly refounded under a new, Lovecraftian
  // name that only its true believers will ever hear -- every existing
  // member's own cult record is updated too, since cult membership is
  // stored per-agent rather than by reference. Their faith follows the
  // same shift: Christ fades and the deity behind the rumour that turned
  // the Priest takes its place, exactly as it already did for the Priest
  // in maybeAppointProphet, even though the members remain outwardly
  // unaware anything has changed.






  // A believer who has been directly spoken to by a cult's deity heads
  // straight for that cult's leader, ignoring their ordinary schedule, to
  // ask to join. If the leader has since died or the cult has dissolved,
  // the pursuit quietly ends instead.

  // Called whenever a deity conversation or manifestation leaves an agent a
  // believer in a specific deity. If that deity is the one a cult's leader
  // themselves believes in, the agent is moved by their new faith to seek


  // Whispered knowledge can be an ordinary planted rumour, or it can be a
  // Lovecraftian truth about the recipient's own reality (that they are
  // simulated, that they or their world can be deleted or reset, that their
  // memories do not persist between runs). The LLM judges which case this
  // is; a regex heuristic stands in only when the LLM is unavailable or the
  // call fails. Classified once per whisper rather than per recipient, since
  // the verdict depends only on the shared text.


  // Shared branch logic for any moment a villager comprehends (or fails to
  // comprehend) a reality-breaking truth -- both a classified whisper
  // (applyForbiddenKnowledge above) and a witnessed anomaly with no text of
  // its own (applyExistentialWitnessReaction below) resolve through here.

  // For witnessed anomalies (a demon manifesting, a targeted divine
  // manifestation, a resurrection) rather than classified whispered text --
  // these are forbidden by construction, so this skips straight to the
  // comprehension/reaction interpretation using the deterministic fallback
  // (kept synchronous so these combat/ritual-adjacent call sites don't take
  // on LLM latency; see the plan for revisiting this with an async variant).


  // Recognizes any named higher power, not only "God": elder gods, old ones,
  // and other cosmic-horror or pantheon entities all qualify as divine
  // provenance and can appoint a Prophet, the same way God does.


  private executeLLMDecision(agent: Agent, decision: AgentAction, causationIds: string[] = []): string {
    const actionType = ACTION_MAP[decision.action] ?? ActionType.IDLE
    const emotion = EMOTION_MAP[decision.emotionalState] ?? EmotionalState.NEUTRAL

    agent.state.emotionalState = emotion
    agent.state.lastReasoning = decision.reasoning
    let targetId: string | null = null
    let description = decision.reasoning

    switch (decision.action) {
      case 'move': {
        const target = this.resolveTarget(decision.target)
        if (target) {
          agent.moveTo(target.x, target.y)
          description = `Moving to ${decision.target ?? 'a location'}`
        } else {
          const randomPos = this.findRandomWalkablePosition()
          agent.moveTo(randomPos.x, randomPos.y)
          description = 'Wandering'
        }
        break
      }

      case 'talk': {
        agent.state.path = []
        agent.state.pathIndex = 0
        const nearby = agent.getNearbyAgents(this.agents)
        if (nearby.length > 0) {
          const targetAgent = decision.target
            ? this.findAgentByName(decision.target, nearby)
            : nearby[Math.floor(Math.random() * nearby.length)]
          if (targetAgent) this.rumourSystem.ensurePendingRumourShare(agent, targetAgent, decision)
          if (
            targetAgent &&
            agent.state.seekingCultJoin &&
            targetAgent.state.cult?.id === agent.state.seekingCultJoin.cultId &&
            ['leader', 'founder'].includes(targetAgent.state.cult.role)
          ) {
            this.cultSystem.completeWillingCultJoin(agent, targetAgent)
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
            const simTime = this.simManager.getSimTime()
            const status = this.conversationManager.checkConversationEligibility(agent, targetAgent, simTime)

            if (status === 'tooFar') {
              description = `${targetAgent.state.name} is too far to talk to`
            } else if (status === 'busy') {
              description = `${targetAgent.state.name} is already talking to someone else`
            } else if (status === 'cooldown') {
              description = 'Too soon to talk to them again'
            } else if (status === 'active') {
              const added = this.conversationManager.addTurn(agent, targetAgent, decision.dialogue, simTime)
              if (added) {
                this.agentInteraction.handleConversation(agent, targetAgent, decision.dialogue)
                targetId = targetAgent.state.id
                description = `Continuing conversation with ${targetAgent.state.name}: ${decision.dialogue}`
              } else {
                description = `Could not continue conversation with ${targetAgent.state.name}`
              }
            } else {
              const topic = decision.reasoning || 'general'
              const started = this.conversationManager.initiateConversation(
                agent,
                targetAgent,
                decision.dialogue,
                topic,
                simTime
              )
              if (started) {
                this.agentInteraction.handleConversation(agent, targetAgent, decision.dialogue)
                this.maybeBatchGenerateConversation(agent, targetAgent, agent, decision.dialogue, topic)
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
        this.worldInteraction.handleWork(agent, this.agents)
        description = 'Working'
        break
      }

      case 'investigate': {
        const destination = this.resolveTarget(decision.target)
        if (destination) agent.moveTo(destination.x, destination.y)
        else {
          agent.state.path = []
          agent.state.pathIndex = 0
        }
        description = decision.reasoning
        break
      }

      case 'interrogate': {
        const target = decision.target ? this.findAgentByName(decision.target, this.agents) : undefined
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
        const inquisitor = this.createOutsider('inquisitor', agent)
        targetId = inquisitor?.state.id ?? null
        description = inquisitor
          ? `${agent.state.name} called upon ${inquisitor.state.name}, an Inquisitor from outside the town.`
          : `${agent.state.name} could not call another Inquisitor.`
        break
      }

      case 'rest': {
        const home = this.findBuildingOfType(agent, 'home')
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
        const target = decision.target ? this.findAgentByName(decision.target, this.agents) : undefined
        targetId = target?.state.id ?? null
        description = `${agent.state.name} began the ${decision.action} rite${target ? ` for ${target.state.name}` : ''}: ${decision.reasoning}`
        break
      }

      case 'preach': {
        const shrine = agent.state.cult ? this.cultSystem.findCultShrine(agent.state.cult.id) : undefined
        if (shrine) {
          const center = this.cultSystem.getSummoningBuildingCenter(shrine)
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
        const target = decision.target ? this.findAgentByName(decision.target, this.agents) : undefined
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
        const target = decision.target ? this.findAgentByName(decision.target, this.agents) : undefined
        targetId = target?.state.id ?? null
        if (target?.state.alive && agent.distanceTo(target.state) > 4) {
          agent.moveTo(target.state.position.x, target.state.position.y)
        } else {
          agent.state.path = []
          agent.state.pathIndex = 0
        }
        description = target
          ? this.politicalSystem.canAttemptCultBribery(agent, target)
            ? `${agent.state.name} approached ${target.state.name} to offer them a bribe to join ${agent.state.cult?.name ?? 'their cult'}.`
            : `${agent.state.name} approached ${target.state.name} to offer them a bribe to win their favor.`
          : `${agent.state.name} wanted to offer a bribe but named no villager.`
        break
      }

      case 'sleep': {
        const home = this.findBuildingOfType(agent, 'home')
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
        const eatBuilding = this.findBuildingOfType(agent, 'restaurant') || this.findBuildingOfType(agent, 'shop')
        if (eatBuilding) {
          agent.moveTo(eatBuilding.position.x + 1, eatBuilding.position.y + 1)
          agent.eat()
          description = `Eating at ${eatBuilding.name}`
        }
        break
      }

      case 'attack': {
        const nearby = agent.getNearbyAgents(this.agents)
        if (nearby.length > 0) {
          const targetAgent = decision.target
            ? nearby.find((a) => a.state.name === decision.target)
            : nearby[Math.floor(Math.random() * nearby.length)]
          if (targetAgent) {
            agent.state.path = []
            agent.state.pathIndex = 0
            const result = this.agentInteraction.handleAttack(agent, targetAgent, this.agents)
            targetId = targetAgent.state.id
            description = `Attacked ${targetAgent.state.name} for ${result.damage} damage${result.died ? ' - KILLED' : ''}`
          }
        }
        break
      }

      case 'steal': {
        const nearby = agent.getNearbyAgents(this.agents)
        if (nearby.length > 0) {
          const targetAgent = decision.target
            ? this.findAgentByName(decision.target, nearby)
            : nearby[Math.floor(Math.random() * nearby.length)]
          if (!targetAgent) break
          agent.state.path = []
          agent.state.pathIndex = 0
          this.agentInteraction.handleSteal(agent, targetAgent, this.agents)
          targetId = targetAgent.state.id
          description = `Tried to steal from ${targetAgent.state.name}`
        }
        break
      }

      case 'destroy': {
        const targetBuilding = decision.target
          ? Array.from(this.world.buildings.values()).find(
              (b) => b.name.toLowerCase() === decision.target!.toLowerCase()
            )
          : null
        if (targetBuilding) {
          this.worldInteraction.handleDestroy(agent, targetBuilding.id, this.agents)
          description = `Destroyed ${targetBuilding.name}`
        } else {
          const nearby = agent.getNearbyAgents(this.agents)
          if (nearby.length > 0) {
            this.worldInteraction.handleDestroy(agent, null, this.agents)
            description = 'Attempting to destroy something nearby'
          }
        }
        break
      }

      case 'help': {
        agent.state.path = []
        agent.state.pathIndex = 0
        const nearby = agent.getNearbyAgents(this.agents)
        const injured = nearby.find((a) => a.state.health < 50)
        if (injured) {
          this.agentInteraction.handleHelp(agent, injured)
          targetId = injured.state.id
          description = `Helped ${injured.state.name} recover health`
        }
        break
      }

      case 'flee': {
        const threatId = decision.target
          ? this.agents.find((a) => a.state.name === decision.target)?.state.id
          : null
        if (threatId) {
          this.agentInteraction.handleFlee(agent, threatId, this.agents)
          description = `Fleeing from ${decision.target}`
        } else {
          const fleePos = this.findRandomWalkablePosition()
          agent.moveTo(fleePos.x, fleePos.y)
          description = 'Fleeing to safety'
        }
        break
      }

      case 'gather': {
        agent.state.path = []
        agent.state.pathIndex = 0
        const gathered = this.worldInteraction.handleGather(agent)
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

    const eventId = this.logAction(agent, actionType, targetId, description, causationIds)

    if (decision.action === 'talk' && targetId && agent.state.cult &&
      agent.state.cult.role === 'leader') {
      const listener = this.agents.find((candidate) => candidate.state.id === targetId)
      if (listener?.state.alive) {
        this.cultSystem.advanceCultConversionFromConversation(agent, listener, agent.state.cult, eventId)
      }
    }

    this.lastActions.set(agent.state.id, { action: decision.action, timestamp: this.simManager.getSimTime() })

    if (decision.dialogue) {
      const nearby = agent.getNearbyAgents(this.agents)
      if (nearby.length > 0) {
        console.log(`[${agent.state.name}]: "${decision.dialogue}"`)
      }
    }
    return eventId
  }


  private resolveTarget(targetName: string | null | undefined): { x: number; y: number } | null {
    if (!targetName) return null
    const lower = targetName.toLowerCase()

    // Exact match on building name
    for (const building of this.world.buildings.values()) {
      if (building.name.toLowerCase() === lower) {
        return {
          x: building.position.x + Math.floor(building.size.x / 2),
          y: building.position.y + Math.floor(building.size.y / 2),
        }
      }
    }

    // Partial match on building name (e.g. "the shop", "a house", "diner")
    for (const building of this.world.buildings.values()) {
      const bname = building.name.toLowerCase()
      const btype = building.type.toLowerCase()
      if (bname.includes(lower) || lower.includes(bname)) {
        return {
          x: building.position.x + Math.floor(building.size.x / 2),
          y: building.position.y + Math.floor(building.size.y / 2),
        }
      }
      if (btype.includes(lower) || lower.includes(btype)) {
        return {
          x: building.position.x + Math.floor(building.size.x / 2),
          y: building.position.y + Math.floor(building.size.y / 2),
        }
      }
    }

    // Exact match on agent name
    for (const agent of this.agents) {
      if (agent.state.name.toLowerCase() === lower) {
        return { x: Math.round(agent.state.position.x), y: Math.round(agent.state.position.y) }
      }
    }

    // Partial match on agent name
    for (const agent of this.agents) {
      if (agent.state.name.toLowerCase().includes(lower)) {
        return { x: Math.round(agent.state.position.x), y: Math.round(agent.state.position.y) }
      }
    }

    return null
  }

  private findAgentByName(targetName: string, candidates: Agent[]): Agent | undefined {
    const normalizedTarget = targetName.toLowerCase().trim()
    return candidates.find((candidate) => candidate.state.name.toLowerCase() === normalizedTarget)
      ?? candidates.find((candidate) => {
        const name = candidate.state.name.toLowerCase()
        return name.includes(normalizedTarget) || normalizedTarget.includes(name)
      })
  }

  private maybeCreateKnightOutsider(): void {
    if (this.knightOutsiderSpawned) return
    const deathIds = new Set(
      this.eventBus.getHistory()
        .filter((event) => event.type === 'death' || event.outcome === 'death')
        .map((event) => event.type === 'death' ? event.agentId : event.targetId)
        .filter((agentId): agentId is string => Boolean(agentId))
    )
    for (const agent of this.agents) {
      if (!agent.state.alive && !agent.state.exiled) deathIds.add(agent.state.id)
    }
    if (this.agents.length === 0 || deathIds.size < this.agents.length * 0.5) return
    this.createOutsider('knight')
  }

  private canPriestCallInquisitor(priest: Agent): boolean {
    if (this.inquisitorOutsiderSpawned || priest.state.currentJob !== 'Priest' || !priest.state.alive) return false
    const confirmedCultists = new Set(
      (priest.state.secretAffiliationKnowledge ?? [])
        .filter((entry) => entry.affiliation === 'cult')
        .map((entry) => entry.agentId)
    )
    return confirmedCultists.size >= 2
  }

  private createOutsider(kind: 'knight' | 'inquisitor', caller?: Agent): Agent | undefined {
    if (kind === 'knight' ? this.knightOutsiderSpawned : this.inquisitorOutsiderSpawned) return undefined
    const baseName = kind === 'knight' ? 'Sir Aldric Vale' : 'Inquisitor Severin Grey'
    let name = baseName
    let suffix = 2
    while (this.agents.some((agent) => agent.state.name === name)) name = `${baseName} ${suffix++}`
    const id = `outsider_${kind}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
    const outsider = new Agent(
      id,
      name,
      this.world,
      this.simManager,
      kind === 'knight' ? 'Knight' : 'Inquisitor'
    )
    outsider.state.outsider = {
      kind,
      enteredAtMinute: this.getAbsoluteMinute(),
      calledByAgentId: caller?.state.id,
    }
    if (kind === 'inquisitor') {
      outsider.state.beliefSystem.religiousStance = 'believer'
      outsider.state.beliefSystem.faith = Math.max(80, outsider.state.beliefSystem.faith)
      outsider.state.beliefSystem.deities = [{ name: 'God', confidence: 90, revelationCount: 0 }]
      outsider.state.knownCultGroups = (caller?.state.knownCultGroups ?? []).map((cult) => ({ ...cult }))
      outsider.state.secretAffiliationKnowledge = (caller?.state.secretAffiliationKnowledge ?? [])
        .filter((entry) => entry.affiliation === 'cult')
        .map((entry) => ({ ...entry }))
    }
    outsider.state.position = this.findTownEntrance()
    this.agents.push(outsider)
    this.simManager.addAgent(outsider.state)
    this.llmRequestStatuses.set(outsider.state.id, 'pending')
    if (kind === 'knight') this.knightOutsiderSpawned = true
    else this.inquisitorOutsiderSpawned = true

    const destination = Array.from(this.world.buildings.values()).find((building) =>
      building.type === (kind === 'knight' ? BuildingType.GUARDHOUSE : BuildingType.CHURCH)
    ) ?? Array.from(this.world.buildings.values()).find((building) => building.type === BuildingType.TOWN_SQUARE)
    if (destination) {
      outsider.moveTo(
        Math.round(destination.position.x + destination.size.x / 2),
        Math.round(destination.position.y + destination.size.y / 2)
      )
    }

    const witnesses = this.agents.filter((agent) => agent.state.alive)
    const event = this.eventBus.emit({
      type: 'outsider_arrival',
      agentId: outsider.state.id,
      targetId: caller?.state.id,
      actionType: ActionType.MOVE,
      outcome: `${kind}_arrived`,
      description: kind === 'knight'
        ? `${outsider.state.name}, a Knight from beyond the village, entered town after word spread of multiple deaths.`
        : `${outsider.state.name}, an Inquisitor, entered town after ${caller?.state.name ?? 'a Priest'} confirmed multiple cultists and called for aid.`,
      causationIds: [],
      worldStateDelta: {
        outsiderKind: kind,
        outsiderId: outsider.state.id,
        calledByAgentId: caller?.state.id,
      },
      observers: witnesses.map((agent) => agent.state.id),
    })
    for (const witness of witnesses) witness.addRecentMemory(event)
    return outsider
  }

  private findTownEntrance(): { x: number; y: number } {
    const candidates: Array<{ x: number; y: number }> = []
    for (let x = 1; x < this.world.width - 1; x++) {
      candidates.push({ x, y: 1 }, { x, y: this.world.height - 2 })
    }
    for (let y = 2; y < this.world.height - 2; y++) {
      candidates.push({ x: 1, y }, { x: this.world.width - 2, y })
    }
    const walkable = candidates.filter((position) => this.world.isWalkable(position.x, position.y))
    return walkable[Math.floor(Math.random() * walkable.length)] ?? this.findRandomWalkablePosition()
  }

  private findRandomWalkablePosition(): { x: number; y: number } {
    for (let i = 0; i < 50; i++) {
      const x = Math.floor(Math.random() * this.world.width)
      const y = Math.floor(Math.random() * this.world.height)
      if (this.world.isWalkable(x, y)) {
        return { x, y }
      }
    }
    return { x: 5, y: 5 }
  }

  private logAction(
    agent: Agent,
    actionType: ActionType,
    targetId: string | null,
    description: string,
    causationIds: string[]
  ): string {
    const eventId = this.simManager.logEvent({
      type: actionType,
      agentId: agent.state.id,
      actionType,
      targetId: targetId ?? undefined,
      outcome: 'completed',
      description,
      causationIds,
      worldStateDelta: {},
      observers: [],
    })

    agent.addRecentMemory({
      id: eventId,
      timestamp: this.simManager.getSimTime(),
      type: actionType,
      agentId: agent.state.id,
      actionType,
      outcome: 'completed',
      description,
      causationIds,
      worldStateDelta: {},
      observers: [],
    })
    return eventId
  }

  private findBuildingOfType(
    agent: Agent,
    type: string
  ): import('@/types').Building | null {
    if (type === 'home' && agent.state.homeId) {
      const assignedHome = this.world.buildings.get(agent.state.homeId)
      if (assignedHome && assignedHome.type === 'home') {
        return assignedHome
      }
    }
    for (const building of this.world.buildings.values()) {
      if (building.type === type) {
        return building
      }
    }
    return null
  }

  private findJobBuilding(
    agent: Agent
  ): import('@/types').Building | null {
    const job = agent.state.currentJob
    if (!job) return null

    const buildingTypes: Record<string, string> = {
      Blacksmith: 'smithy',
      Carpenter: 'carpenter_workshop',
      Merchant: 'market',
      'Town Guard': 'guardhouse',
      Healer: 'apothecary',
      Steward: 'manor',
      Innkeeper: 'tavern',
      Farmer: 'farm',
      Priest: 'church',
      Prophet: 'church',
      Knight: 'guardhouse',
      Inquisitor: 'church',
    }

    const type = buildingTypes[job]
    if (!type) return null

    return this.findBuildingOfType(agent, type)
  }

  public getAgents(): Agent[] {
    return this.agents
  }

  public getActiveAgents(): Agent[] {
    return this.agents.filter((a) => a.state.alive)
  }

  public getAgentState(id: string): import('@/types').AgentState | undefined {
    return this.agents.find((a) => a.state.id === id)?.state
  }

  public getLLMQueryStats(): LLMQueryStats {
    return { ...this.llmQueryStats }
  }

  public getLLMRequestStatuses(): Record<string, LLMRequestStatus> {
    const statuses = Object.fromEntries(this.llmRequestStatuses) as Record<string, LLMRequestStatus>
    const activeCourt = this.justiceSystem.state.activeCourtRumourId
      ? this.rumours.get(this.justiceSystem.state.activeCourtRumourId)?.resolutionCourt
      : undefined
    for (const agent of this.agents) {
      if (!agent.state.alive) {
        statuses[agent.state.id] = 'idle'
        continue
      }
      if (activeCourt?.status === 'gathering' && (
        activeCourt.accusedAgentId === agent.state.id ||
        activeCourt.participantIds.includes(agent.state.id)
      ) && !this.pendingDecisions.has(agent.state.id)) {
        statuses[agent.state.id] = 'idle'
        continue
      }
      const hasQueuedRequest =
        (this.decisionQueue.get(agent.state.id)?.length ?? 0) > 0 ||
        !this.dailySchedules.has(agent.state.id)
      if (!this.pendingDecisions.has(agent.state.id) && hasQueuedRequest) {
        statuses[agent.state.id] = 'pending'
      }
    }
    return statuses
  }

  public getAgentActivityStatuses(): Record<string, string> {
    const activities: Record<string, string> = {}
    const actionLabels: Record<string, string> = {
      move: 'travelling',
      talk: 'talking',
      work: 'working',
      investigate: 'investigating a rumour',
      interrogate: 'interrogating a suspected secret member',
      call_inquisitor: 'calling an Inquisitor from outside the town',
      rest: 'resting',
      sleep: 'sleeping',
      attack: 'attacking',
      steal: 'attempting theft',
      destroy: 'destroying',
      help: 'helping',
      flee: 'fleeing',
      gather: 'gathering',
      eat: 'eating',
      build: 'building',
      idle: 'reflecting',
      cry: 'crying',
      pray: 'praying',
      conjure: 'conjuring',
      summon: 'performing a summoning rite',
      resurrect: 'performing a resurrection rite',
      heal: 'performing a healing rite',
      bless: 'giving a blessing',
      curse: 'performing a curse',
      ritual: 'performing a cult ritual',
      preach: 'preaching',
      invite_cult: 'inviting a villager to join their cult',
      bribe: 'offering a villager a bribe',
      build_shrine: 'raising a shrine for their cult',
    }

    for (const agent of this.agents) {
      const agentId = agent.state.id
      if (!agent.state.alive) {
        activities[agentId] = agent.state.exiled ? 'exiled' : 'dead'
        continue
      }

      const activeCourt = this.justiceSystem.state.activeCourtRumourId
        ? this.rumours.get(this.justiceSystem.state.activeCourtRumourId)?.resolutionCourt
        : undefined
      if (activeCourt && (
        activeCourt.participantIds.includes(agentId) || activeCourt.accusedAgentId === agentId
      )) {
        if (this.pendingDecisions.has(agentId)) {
          activities[agentId] = this.pendingActivityLabels.get(agentId) ?? 'speaking in court'
        } else if (activeCourt.status === 'gathering') {
          const courtCenter = this.justiceSystem.getCourtCenter()
          const atCourt = courtCenter && Math.hypot(
            agent.state.position.x - courtCenter.x,
            agent.state.position.y - courtCenter.y
          ) <= 6
          activities[agentId] = atCourt
            ? 'waiting for resolution court to begin'
            : 'travelling to resolution court'
        } else if (activeCourt.status === 'commenting') {
          activities[agentId] = activeCourt.accusedAgentId === agentId
            ? 'responding to the court verdict'
            : 'listening to the accused’s final response'
        } else if (activeCourt.accusedAgentId === agentId) {
          activities[agentId] = 'answering charges in court'
        } else if (activeCourt.votes.some((vote) => vote.agentId === agentId)) {
          activities[agentId] = 'listening to the court discussion'
        } else {
          activities[agentId] = 'waiting to speak and vote in court'
        }
        continue
      }

      const partnerId = agent.getConversationPartnerId()
      const partner = partnerId
        ? this.agents.find((candidate) => candidate.state.id === partnerId)
        : undefined
      if (partner) {
        activities[agentId] = this.pendingDecisions.has(agentId)
          ? `thinking of a response to ${partner.state.name}`
          : `in conversation with ${partner.state.name}`
        continue
      }

      if (this.pendingDecisions.has(agentId)) {
        activities[agentId] = this.pendingActivityLabels.get(agentId) ?? 'thinking'
        continue
      }
      if ((this.decisionQueue.get(agentId)?.length ?? 0) > 0) {
        const queued = this.decisionQueue.get(agentId) ?? []
        activities[agentId] = queued.some((trigger) =>
          trigger.type === 'prophecy' || trigger.type === 'prophetic_task'
        ) ? 'preparing to fulfill a divine command' : 'waiting to think'
        continue
      }

      const active = this.activeBlocks.get(agentId)
      if (active) {
        const label = actionLabels[active.action.action] ?? active.action.action
        activities[agentId] = active.action.target
          ? `${label} — ${active.action.target}`
          : label
        continue
      }
      if (agent.state.path.length > 0 && agent.state.pathIndex < agent.state.path.length) {
        activities[agentId] = 'travelling'
        continue
      }
      if (agent.state.demon) {
        activities[agentId] = agent.state.demon.lastCommand
          ? `awaiting another user command — last: ${agent.state.demon.lastCommand}`
          : 'awaiting a user command'
        continue
      }
      if (!this.dailySchedules.has(agentId)) {
        activities[agentId] = this.aiProvider?.isAvailable()
          ? 'waiting for daily plan'
          : 'waiting for LLM'
        continue
      }
      activities[agentId] = 'waiting for the next activity'
    }
    return activities
  }

  public getAgentDebugDetails(): Record<string, import('@/types').AgentDebugDetails> {
    return Object.fromEntries(this.agents.map((agent) => {
      const active = this.activeBlocks.get(agent.state.id)
      return [agent.state.id, {
        schedule: this.dailySchedules.get(agent.state.id),
        scheduleCursor: this.scheduleCursors.get(agent.state.id) ?? 0,
        activeAction: active?.action,
        activeEndsAt: active?.endsAt,
        queuedTriggers: [...(this.decisionQueue.get(agent.state.id) ?? [])],
      }]
    }))
  }



  // The Demon acts on its own between user commands: it prowls, occasionally
  // turns on whoever is nearby, and sometimes just broods. A user command
  // (see commandDemon) always clears any active block and starts its own, so
  // this only ever runs when the Demon isn't currently mid-command — the
  // Demon does what it wants, but still listens the moment it's told to.

  private updateKnightPatrolAndCombat(agent: Agent): void {
    if (!agent.state.alive) return

    // 1. Check for visible demons (distance <= 8)
    const demon = this.agents.find(
      (a) => a.state.alive && a.state.demon && agent.distanceTo(a.state) <= 8
    )

    if (demon) {
      // If we see a demon, engage in combat!
      const active = this.activeBlocks.get(agent.state.id)
      const distance = agent.distanceTo(demon.state)

      if (distance <= 4) {
        // Attack range!
        if (active?.action.action !== 'attack' || active.action.target !== demon.state.name) {
          // Cancel any active path/conversation
          agent.state.path = []
          agent.state.pathIndex = 0
          const partnerId = agent.getConversationPartnerId()
          if (partnerId) {
            const partner = this.agents.find((a) => a.state.id === partnerId)
            if (partner) this.conversationManager.closeConversation(agent, partner)
          }

          // Start attack block
          const action: AgentAction = {
            action: 'attack',
            target: demon.state.name,
            reasoning: `Demon sighted! Engaging the Demon ${demon.state.name} in mortal combat.`,
            emotionalState: 'determined',
            durationMinutes: 1,
          }
          this.startBlock(agent, action, [], undefined, false)

          // Perform actual attack
          this.agentInteraction.handleAttack(agent, demon, this.agents)
        } else {
          // If the attack block is active, check if it's due to hit again
          const now = this.getAbsoluteMinute()
          if (now >= active.endsAt) {
            // Hit again!
            this.agentInteraction.handleAttack(agent, demon, this.agents)
            // Reset block duration
            active.endsAt = now + 1
          }
        }
      } else {
        // Move towards demon
        if (active?.action.action !== 'move' || active.action.target !== demon.state.name) {
          // Close conversation if any
          const partnerId = agent.getConversationPartnerId()
          if (partnerId) {
            const partner = this.agents.find((a) => a.state.id === partnerId)
            if (partner) this.conversationManager.closeConversation(agent, partner)
          }
          agent.moveTo(Math.round(demon.state.position.x), Math.round(demon.state.position.y))
          const action: AgentAction = {
            action: 'move',
            target: demon.state.name,
            reasoning: `Approaching the Demon ${demon.state.name} to engage in combat.`,
            emotionalState: 'determined',
            durationMinutes: 5,
          }
          this.startBlock(agent, action, [], undefined, false)
        }
      }
      return
    }

    // 2. If no demon, patrol and investigate locations
    // Initialize patrol state if not present
    if (!agent.state.knightPatrol) {
      agent.state.knightPatrol = {
        visitedBuildingIds: [],
      }
    }

    const patrol = agent.state.knightPatrol
    const buildings = Array.from(this.world.buildings.values()).sort((a, b) => a.id.localeCompare(b.id))
    if (buildings.length === 0) return

    // If all buildings visited, reset the patrol cycle
    if (patrol.visitedBuildingIds.length >= buildings.length) {
      patrol.visitedBuildingIds = []
    }

    // Find the next building to patrol
    let nextBuilding = buildings.find((b) => !patrol.visitedBuildingIds.includes(b.id))
    if (!nextBuilding) {
      // Fallback
      nextBuilding = buildings[0]
    }

    patrol.currentBuildingId = nextBuilding.id

    const active = this.activeBlocks.get(agent.state.id)
    const targetX = Math.round(nextBuilding.position.x + nextBuilding.size.x / 2)
    const targetY = Math.round(nextBuilding.position.y + nextBuilding.size.y / 2)

    // Calculate distance to the building center
    const dx = agent.state.position.x - targetX
    const dy = agent.state.position.y - targetY
    const distToBuilding = Math.sqrt(dx * dx + dy * dy)

    if (distToBuilding <= 1.5) {
      // Arrived! Start investigation if we are not already investigating it
      if (active?.action.action !== 'investigate' || active.action.target !== nextBuilding.name) {
        // Stop movement
        agent.state.path = []
        agent.state.pathIndex = 0

        const action: AgentAction = {
          action: 'investigate',
          target: nextBuilding.name,
          reasoning: `Investigating ${nextBuilding.name} for any threats or anomalies.`,
          emotionalState: 'determined',
          durationMinutes: 10,
        }
        this.startBlock(agent, action, [], undefined, false)
      } else {
        // If investigation block is finished (or when it completes in completeFinishedBlocks),
        // we add this building to visitedBuildingIds.
        const now = this.getAbsoluteMinute()
        if (now >= active.endsAt) {
          if (!patrol.visitedBuildingIds.includes(nextBuilding.id)) {
            patrol.visitedBuildingIds.push(nextBuilding.id)
          }
          this.activeBlocks.delete(agent.state.id)
        }
      }
    } else {
      // Move to building
      if (active?.action.action !== 'move' || active.action.target !== nextBuilding.name) {
        agent.moveTo(targetX, targetY)
        const action: AgentAction = {
          action: 'move',
          target: nextBuilding.name,
          reasoning: `Patrolling towards ${nextBuilding.name}.`,
          emotionalState: 'neutral',
          durationMinutes: 10,
        }
        this.startBlock(agent, action, [], undefined, false)
      } else {
        // If they get stuck or path is empty but they haven't arrived, recalculate path
        if (agent.state.path.length === 0 || agent.state.pathIndex >= agent.state.path.length) {
          agent.moveTo(targetX, targetY)
        }
      }
    }
  }

  public getEventBus(): EventBus {
    return this.eventBus
  }
}
