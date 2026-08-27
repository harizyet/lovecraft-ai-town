import { Agent } from '@/agent/Agent'
import { World } from '@/world/World'
import { SimulationManager } from '@/simulation/SimulationManager'
import {
  ActionType,
  EmotionalState,
  AgentAction,
  DailySchedule,
  DecisionTrigger,
  LLMRequestStatus,
  Rumour,
  WeatherCondition,
  PolicySession,
  StoryMoment,
  SimulationEvent,
} from '@/types'
import { AIProvider, LLMQueryStats, PropheticTask } from '@/ai/AIProvider'
import { PromptBuilder } from '@/ai/PromptBuilder'
import { EventBus } from '@/interaction/EventBus'
import { AgentInteraction } from '@/interaction/AgentInteraction'
import { WorldInteraction } from '@/interaction/WorldInteraction'
import { ConversationManager } from '@/interaction/ConversationManager'
import { SystemDeps } from '@/agent/systems/SystemDeps'
import { StorySystem, createStoryState } from '@/agent/systems/StorySystem'
import { PoliticalSystem, createPoliticalState } from '@/agent/systems/PoliticalSystem'
import { JusticeSystem, createCourtState } from '@/agent/systems/JusticeSystem'
import { RumourSystem, createRumourState } from '@/agent/systems/RumourSystem'
import { ReligionSystem, createReligionState } from '@/agent/systems/ReligionSystem'
import { CultSystem, createCultState } from '@/agent/systems/CultSystem'
import { OutsiderSystem, createOutsiderState } from '@/agent/systems/OutsiderSystem'
import { SocialSystem, createSocialState } from '@/agent/systems/SocialSystem'
import { ScheduleSystem, createScheduleState } from '@/agent/systems/ScheduleSystem'
import { DecisionEngine, DecisionEngineSystems, createDecisionEngineState } from '@/agent/systems/DecisionEngine'
import { EnvironmentSystem, createEnvironmentState } from '@/agent/systems/EnvironmentSystem'
import { RelicSystem, createRelicState } from '@/agent/systems/RelicSystem'


export class AgentManager {
  private agents: Agent[]
  private world: World
  private simManager: SimulationManager
  private aiProvider: AIProvider | null
  private promptBuilder: PromptBuilder
  private currentDay: number
  private rumours: Map<string, Rumour>
  private outsiderSystem!: OutsiderSystem
  private socialSystem!: SocialSystem
  private scheduleSystem!: ScheduleSystem
  private decisionEngine!: DecisionEngine

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
  private environmentSystem!: EnvironmentSystem
  private relicSystem!: RelicSystem

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
    this.currentDay = 0
    this.rumours = new Map()

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
    const socialState = createSocialState()
    const scheduleState = createScheduleState()
    const decisionEngineState = createDecisionEngineState()
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
      worldInteraction: this.worldInteraction,
      conversationManager: this.conversationManager,

      activeBlocks: scheduleState.activeBlocks,
      decisionQueue: decisionEngineState.decisionQueue,
      dailySchedules: scheduleState.dailySchedules,
      scheduleCursors: scheduleState.scheduleCursors,
      pendingDecisions: decisionEngineState.pendingDecisions,
      pendingActivityLabels: scheduleState.pendingActivityLabels,
      llmRequestStatuses: decisionEngineState.llmRequestStatuses,
      rumours: this.rumours,
      getCurrentDay: () => this.currentDay,
      isLLMRequestInFlight: () => this.decisionEngine.state.llmRequestInFlight,
      setLLMRequestInFlight: (value) => { this.decisionEngine.state.llmRequestInFlight = value },

      isCourtActive: () => this.justiceSystem.state.activeCourtRumourId !== null,
      isPolicyVoteActive: () => this.politicalSystem.state.activePolicySessionId !== null,

      getAbsoluteMinute: () => this.getAbsoluteMinute(),
      getMinuteOfDay: () => this.getMinuteOfDay(),
      getTownCorruptionLevel: () => this.getTownCorruptionLevel(),
      saturateMapCorruption: () => this.environmentSystem.saturateWholeMap(),

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
      resolveExistentialReaction: (recipient, interpretation, severity, sourceText, insanitySource) =>
        this.rumourSystem.resolveExistentialReaction(recipient, interpretation, severity, sourceText, insanitySource),

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
      maybeCreateForbiddenRelic: (agent, rumour, causationId) =>
        this.relicSystem.maybeCreateRelicFromInvestigation(agent, rumour, causationId),
      createSchemeRelic: (leader, scheme, building, severity, containsForbiddenKnowledge) =>
        this.relicSystem.createSchemeRelic(leader, scheme, building, severity, containsForbiddenKnowledge),

      banishAgent: (agent, reason, policySessionId) => this.banishAgent(agent, reason, policySessionId),

      getCourtCenter: () => this.justiceSystem.getCourtCenter(),
      isWeakCourtStatement: (statement) => this.justiceSystem.isWeakCourtStatement(statement),
      resumeSchedulesAfterCourt: (participantIds) => this.justiceSystem.resumeSchedulesAfterCourt(participantIds),
      updateAgentJusticeResponse: (rumour, agent, belief) => this.justiceSystem.updateAgentJusticeResponse(rumour, agent, belief),

      findAgentByName: (targetName, candidates) => this.findAgentByName(targetName, candidates),
      formatAbsoluteMinute: (minute) => this.formatAbsoluteMinute(minute),
      findTownEntrance: () => this.findTownEntrance(),

      lastActions: socialState.lastActions,
      hasRumourPropagationOpportunity: (a, b) => this.rumourSystem.hasRumourPropagationOpportunity(a, b),
      buildRumourConversationContext: (agent, otherAgentId) =>
        this.rumourSystem.buildRumourConversationContext(agent, otherAgentId),
      maybeAddRumourToConversation: (agent, partner, decision) =>
        this.rumourSystem.maybeAddRumourToConversation(agent, partner, decision),
      getActiveCourtRumourId: () => this.justiceSystem.state.activeCourtRumourId,
      getRemainingSchedule: (agentId) => this.getRemainingSchedule(agentId),

      executeLLMDecision: (agent, decision, causationIds) => this.executeLLMDecision(agent, decision, causationIds),
      ensureBelieverPrayerBlock: (agent, blocks, minuteOfDay) =>
        this.religionSystem.ensureBelieverPrayerBlock(agent, blocks, minuteOfDay),
      findCultShrine: (cultId) => this.cultSystem.findCultShrine(cultId),
      isVisibleCultActivity: (action) => this.cultSystem.isVisibleCultActivity(action),
      hasNearbyPriest: (agent) => this.cultSystem.hasNearbyPriest(agent),
      formCult: (prophet, task, causationId) => this.cultSystem.formCult(prophet, task, causationId),
      gatherCultForSummoning: (leader, action) => this.cultSystem.gatherCultForSummoning(leader, action),
      getSummoningParticipantSlot: (site, index) => this.cultSystem.getSummoningParticipantSlot(site, index),
      advanceSummoningProcess: (leader, active, now) => this.cultSystem.advanceSummoningProcess(leader, active, now),
      getSummoningBuildingCenter: (building) => this.cultSystem.getSummoningBuildingCenter(building),
      completeCultAbility: (agent, action, causationId) => this.cultSystem.completeCultAbility(agent, action, causationId),
      completeCultShrineConstruction: (leader, causationId) =>
        this.cultSystem.completeCultShrineConstruction(leader, causationId),
      attemptCultRecruitment: (prophet, target, task, causationId) =>
        this.cultSystem.attemptCultRecruitment(prophet, target, task, causationId),
      coordinateScheduledSummons: () => this.cultSystem.coordinateScheduledSummons(),
      isAgentUndecidedAboutRumour: (agentId, rumourId) => this.rumourSystem.isAgentUndecidedAboutRumour(agentId, rumourId),
      isRumourUnresolved: (rumourId) => this.rumourSystem.isRumourUnresolved(rumourId),
      prepareInvestigationDecision: (agent, decision, rumour, authority) =>
        this.rumourSystem.prepareInvestigationDecision(agent, decision, rumour, authority),
      completeAffiliationInterrogation: (interrogator, action, causationId) =>
        this.rumourSystem.completeAffiliationInterrogation(interrogator, action, causationId),
      completeRumourInvestigation: (rumourId, agent, causationId) =>
        this.rumourSystem.completeRumourInvestigation(rumourId, agent, causationId),
      canAttemptCultBribery: (briber, target) => this.politicalSystem.canAttemptCultBribery(briber, target),
      attemptCultBribery: (briber, target, reasoning, causationId) =>
        this.politicalSystem.attemptCultBribery(briber, target, reasoning, causationId),
      attemptFavorBribery: (briber, target, reasoning, causationId) =>
        this.politicalSystem.attemptFavorBribery(briber, target, reasoning, causationId),
      resetCrossSystemStateForRefresh: () => {
        this.socialSystem.state.lastActions.clear()
        this.socialSystem.state.activeEncounterPairs.clear()
        this.cultSystem.state.cultMobTargets.clear()
        this.religionSystem.state.religiousFervourTargets.clear()
        this.justiceSystem.state.activeCourtRumourId = null
        if (this.politicalSystem.state.activePolicySessionId) {
          const activeSession = this.politicalSystem.state.policySessions.get(this.politicalSystem.state.activePolicySessionId)
          if (activeSession && activeSession.status !== 'resolved') this.politicalSystem.state.policySessions.delete(activeSession.id)
          this.politicalSystem.state.activePolicySessionId = null
        }
      },
      canPriestCallInquisitor: (priest) => this.outsiderSystem.canPriestCallInquisitor(priest),
      isInquisitorOutsiderSpawned: () => this.outsiderSystem.state.inquisitorOutsiderSpawned,
      findNearestAvailableSocialTarget: (agent) => this.socialSystem.findNearestAvailableSocialTarget(agent),
      bumpQueryEpoch: () => ++this.decisionEngine.state.queryEpoch,
      setCurrentDay: (day) => { this.currentDay = day },
      logAction: (agent, actionType, targetId, description, causationIds) =>
        this.logAction(agent, actionType, targetId, description, causationIds),
    }

    this.storySystem = new StorySystem(deps, createStoryState())
    this.justiceSystem = new JusticeSystem(deps, createCourtState())
    this.politicalSystem = new PoliticalSystem(deps, createPoliticalState())
    this.rumourSystem = new RumourSystem(deps, createRumourState())
    this.religionSystem = new ReligionSystem(deps, createReligionState())
    this.cultSystem = new CultSystem(deps, createCultState())
    this.environmentSystem = new EnvironmentSystem(deps, createEnvironmentState())
    this.relicSystem = new RelicSystem(deps, createRelicState())
    this.outsiderSystem = new OutsiderSystem(deps, createOutsiderState())
    this.socialSystem = new SocialSystem(deps, socialState)
    this.scheduleSystem = new ScheduleSystem(deps, scheduleState)
    const decisionEngineSystems: DecisionEngineSystems = {
      rumourSystem: this.rumourSystem,
      cultSystem: this.cultSystem,
      religionSystem: this.religionSystem,
      justiceSystem: this.justiceSystem,
      politicalSystem: this.politicalSystem,
      storySystem: this.storySystem,
      scheduleSystem: this.scheduleSystem,
      socialSystem: this.socialSystem,
      outsiderSystem: this.outsiderSystem,
    }
    this.decisionEngine = new DecisionEngine(deps, decisionEngineSystems, decisionEngineState)
  }

  private setupEventListeners(): void {
    this.eventBus.on('*', (event) => {
      if ([ActionType.ATTACK, ActionType.STEAL, ActionType.DESTROY].includes(event.actionType)) {
        console.log(`[EVENT] ${event.description}`)
      }
      this.decisionEngine.handleDecisionEvent(event)
      this.religionSystem.registerGodInvocation(event)
      this.cultSystem.fulfillPunishmentRequestsFromEvent(event)
      this.cultSystem.handleCultLeaderKilled(event)
      this.handleOutsiderKilled(event)
    })
  }

  // A Knight or Inquisitor is an outsider called in specifically to protect
  // or judge the village; their death is a distinct narrative beat from an
  // ordinary villager's, so it's detected here off the same 'attack' death
  // event handleCultLeaderKilled already watches, rather than threading a
  // story-moment call through every kill path (combat, sacrifice) that could
  // end an outsider's life.
  private handleOutsiderKilled(event: SimulationEvent): void {
    if (event.type !== 'attack' || event.outcome !== 'death' || !event.targetId) return
    const victim = this.agents.find((agent) => agent.state.id === event.targetId)
    const kind = victim?.state.outsider?.kind
    if (!victim || (kind !== 'knight' && kind !== 'inquisitor')) return
    this.storySystem.queueStoryMoment(
      kind === 'knight' ? 'knight_killed' : 'inquisitor_killed',
      victim.state.name,
      event.description,
      victim.state.id,
      event.id
    )
  }



  public resetSchedulesLocationsAndQueries(): { success: boolean; message: string; relocated: number } {
    return this.scheduleSystem.resetSchedulesLocationsAndQueries()
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
      this.decisionEngine.state.llmRequestStatuses.set(agent.state.id, 'pending')
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
      lastActions: Array.from(this.socialSystem.state.lastActions.entries()),
      dailySchedules: Array.from(this.scheduleSystem.state.dailySchedules.entries()),
      scheduleCursors: Array.from(this.scheduleSystem.state.scheduleCursors.entries()),
      activeBlocks: Array.from(this.scheduleSystem.state.activeBlocks.entries()),
      decisionQueue: Array.from(this.decisionEngine.state.decisionQueue.entries()),
      currentDay: this.currentDay,
      processedEventIds: Array.from(this.decisionEngine.state.processedEventIds),
      llmRequestStatuses: Array.from(this.decisionEngine.state.llmRequestStatuses.entries()),
      activeEncounterPairs: Array.from(this.socialSystem.state.activeEncounterPairs),
      lastEncounterMinute: Array.from(this.socialSystem.state.lastEncounterMinute.entries()),
      rumours: Array.from(this.rumours.entries()),
      rumourCounter: this.rumourSystem.state.rumourCounter,
      naturalRumourKeys: Array.from(this.rumourSystem.state.naturalRumourKeys),
      rumourMutationKeys: Array.from(this.rumourSystem.state.rumourMutationKeys),
      lastRumourInventionMinute: Array.from(this.rumourSystem.state.lastRumourInventionMinute.entries()),
      llmQueryStats: this.decisionEngine.state.llmQueryStats,
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
      idleSinceMinute: Array.from(this.scheduleSystem.state.idleSinceMinute.entries()),
      interpretedProphecyRumourIds: Array.from(this.religionSystem.state.interpretedProphecyRumourIds),
      lastDailyPropheticClaimDay: this.religionSystem.state.lastDailyPropheticClaimDay,
      godInterventionCredits: this.religionSystem.state.godInterventionCredits,
      lastGodInvocation: this.religionSystem.state.lastGodInvocation,
      lastInvokedDeityName: this.religionSystem.state.lastInvokedDeityName,
      lastCultMobCheckMinute: Array.from(this.cultSystem.state.lastCultMobCheckMinute.entries()),
      cultMobCooldownUntil: Array.from(this.cultSystem.state.cultMobCooldownUntil.entries()),
      cultMobTargets: Array.from(this.cultSystem.state.cultMobTargets.entries()),
      cultShrineCommandIssued: Array.from(this.cultSystem.state.cultShrineCommandIssued),
      knightOutsiderSpawned: this.outsiderSystem.state.knightOutsiderSpawned,
      inquisitorOutsiderSpawned: this.outsiderSystem.state.inquisitorOutsiderSpawned,
      demonSummonCredits: this.religionSystem.state.demonSummonCredits,
      demonSummonSites: this.religionSystem.state.demonSummonSites,
      environmentCorruption: Array.from(this.environmentSystem.state.corruption.entries()),
      environmentAnnouncedTileKeys: Array.from(this.environmentSystem.state.announcedTileKeys),
      environmentLandCorruptedEverNarrated: this.environmentSystem.state.landCorruptedEverNarrated,
      environmentSustainedHighMinutes: Array.from(this.environmentSystem.state.sustainedHighMinutes.entries()),
      environmentBlightedTileKeys: Array.from(this.environmentSystem.state.blightedTileKeys),
      environmentEldritchBlightEverNarrated: this.environmentSystem.state.eldritchBlightEverNarrated,
      relicCounter: this.relicSystem.state.relicCounter,
    }
  }

  public restoreSnapshot(snapshot: any): void {
    this.agents = (snapshot.agents ?? []).map((saved: any) =>
      Agent.restore(saved.state, saved.conversations ?? [], this.world, this.simManager)
    )
    for (const agent of this.agents) this.simManager.addAgent(agent.state)
    this.socialSystem.state.lastActions = new Map(snapshot.lastActions ?? [])
    this.scheduleSystem.state.dailySchedules = new Map(snapshot.dailySchedules ?? [])
    this.scheduleSystem.state.scheduleCursors = new Map(snapshot.scheduleCursors ?? [])
    this.scheduleSystem.state.activeBlocks = new Map(snapshot.activeBlocks ?? [])
    this.decisionEngine.state.decisionQueue = new Map(snapshot.decisionQueue ?? [])
    this.socialSystem.state.pregeneratedConversations = new Map()
    this.currentDay = snapshot.currentDay ?? this.simManager.getDayNight().day
    this.decisionEngine.state.processedEventIds = new Set(snapshot.processedEventIds ?? [])
    this.decisionEngine.state.llmRequestStatuses = new Map(snapshot.llmRequestStatuses ?? [])
    this.socialSystem.state.activeEncounterPairs = new Set(snapshot.activeEncounterPairs ?? [])
    this.socialSystem.state.lastEncounterMinute = new Map(snapshot.lastEncounterMinute ?? [])
    this.rumours = new Map(snapshot.rumours ?? [])
    this.rumourSystem.state.rumourCounter = snapshot.rumourCounter ?? 0
    this.rumourSystem.state.naturalRumourKeys = new Set(snapshot.naturalRumourKeys ?? [])
    this.rumourSystem.state.rumourMutationKeys = new Set(snapshot.rumourMutationKeys ?? [])
    this.rumourSystem.state.lastRumourInventionMinute = new Map(snapshot.lastRumourInventionMinute ?? [])
    this.decisionEngine.state.llmQueryStats = snapshot.llmQueryStats ?? { made: 0, successful: 0 }
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
      this.agents.find((agent) => agent.state.currentJob === 'Prophet' || agent.state.secretProphet)?.state.id ?? null
    this.religionSystem.state.prophetVacantAfterDeath = snapshot.prophetVacantAfterDeath ?? false
    this.scheduleSystem.state.idleSinceMinute = new Map(snapshot.idleSinceMinute ?? [])
    this.religionSystem.state.interpretedProphecyRumourIds = new Set(snapshot.interpretedProphecyRumourIds ?? [])
    this.religionSystem.state.lastDailyPropheticClaimDay = snapshot.lastDailyPropheticClaimDay ?? 0
    this.religionSystem.state.godInterventionCredits = snapshot.godInterventionCredits ?? 0
    this.religionSystem.state.lastGodInvocation = snapshot.lastGodInvocation
    this.religionSystem.state.lastInvokedDeityName = snapshot.lastInvokedDeityName
    this.cultSystem.state.lastCultMobCheckMinute = new Map(snapshot.lastCultMobCheckMinute ?? [])
    this.cultSystem.state.cultMobCooldownUntil = new Map(snapshot.cultMobCooldownUntil ?? [])
    this.cultSystem.state.cultMobTargets = new Map(snapshot.cultMobTargets ?? [])
    this.cultSystem.state.cultShrineCommandIssued = new Set(snapshot.cultShrineCommandIssued ?? [])
    this.outsiderSystem.state.knightOutsiderSpawned = snapshot.knightOutsiderSpawned ??
      this.agents.some((agent) => agent.state.outsider?.kind === 'knight')
    this.outsiderSystem.state.inquisitorOutsiderSpawned = snapshot.inquisitorOutsiderSpawned ??
      this.agents.some((agent) => agent.state.outsider?.kind === 'inquisitor')
    this.religionSystem.state.demonSummonCredits = snapshot.demonSummonCredits ?? 0
    this.religionSystem.state.demonSummonSites = snapshot.demonSummonSites ?? []
    this.environmentSystem.state.corruption = new Map(snapshot.environmentCorruption ?? [])
    this.environmentSystem.state.announcedTileKeys = new Set(snapshot.environmentAnnouncedTileKeys ?? [])
    this.environmentSystem.state.landCorruptedEverNarrated = snapshot.environmentLandCorruptedEverNarrated ?? false
    this.environmentSystem.state.sustainedHighMinutes = new Map(snapshot.environmentSustainedHighMinutes ?? [])
    this.environmentSystem.state.blightedTileKeys = new Set(snapshot.environmentBlightedTileKeys ?? [])
    this.environmentSystem.state.eldritchBlightEverNarrated = snapshot.environmentEldritchBlightEverNarrated ?? false
    this.relicSystem.state.relicCounter = snapshot.relicCounter ?? 0
    while (this.religionSystem.state.demonSummonSites.length < this.religionSystem.state.demonSummonCredits) {
      this.religionSystem.state.demonSummonSites.push(this.findTownEntrance())
    }
    const hasPendingSummon = [...this.scheduleSystem.state.activeBlocks.values()].some((block) =>
      block.action.action === 'summon' || block.propheticTask?.kind === 'summon'
    ) || [...this.decisionEngine.state.decisionQueue.values()].some((triggers) =>
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
    this.decisionEngine.state.pendingDecisions.clear()
    this.scheduleSystem.state.pendingActivityLabels.clear()
    this.decisionEngine.state.llmRequestInFlight = false
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

            this.scheduleSystem.state.activeBlocks.delete(agent.state.id)
            this.agentInteraction.handleSuicide(agent, this.agents)
          }
        }
      }
      const active = this.scheduleSystem.state.activeBlocks.get(agent.state.id)
      const sleepingAtDestination =
        active?.action.action === 'sleep' &&
        active.sleepStartedAt !== undefined &&
        (agent.state.path.length === 0 || agent.state.pathIndex >= agent.state.path.length)
      if (sleepingAtDestination) agent.sleep(deltaMs)
    }
    for (const agent of this.agents) {
      const partnerId = agent.getConversationPartnerId()
      if (
        this.decisionEngine.state.pendingDecisions.has(agent.state.id) ||
        (this.decisionEngine.state.decisionQueue.get(agent.state.id)?.length ?? 0) > 0 ||
        (partnerId !== null && (
          this.decisionEngine.state.pendingDecisions.has(partnerId) ||
          (this.decisionEngine.state.decisionQueue.get(partnerId)?.length ?? 0) > 0
        ))
      ) continue
      this.conversationManager.autoCloseInactiveConversations(agent, this.agents, simTime)
    }

    const day = this.simManager.getDayNight().day
    if (day !== this.currentDay) {
      this.scheduleSystem.beginDay(day)
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
    this.outsiderSystem.maybeCreateKnightOutsider()
    this.cultSystem.removeExtinctCults()
    this.religionSystem.enforceProphetVocation()
    this.religionSystem.prioritizePropheticTasks()
    this.scheduleSystem.enforceExhaustionSleep()
    this.scheduleSystem.enforceNightSleep()
    this.scheduleSystem.enforceLowHealthRecovery()
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
    this.cultSystem.maybeProposeCultScheme()
    this.cultSystem.advanceCultSchemes()

    this.rumourSystem.advanceRumourInvestigations()
    this.socialSystem.detectAgentEncounters()
    this.socialSystem.advancePregeneratedConversations(this.simManager.getSimTime())
    this.scheduleSystem.completeFinishedBlocks()
    this.scheduleSystem.startDueScheduleBlocks()
    this.scheduleSystem.ensureFallbackActivities()
    for (const agent of this.agents) {
      if (agent.state.alive && (agent.state.currentJob === 'Knight' || agent.state.outsider?.kind === 'knight')) {
        this.outsiderSystem.updateKnightPatrolAndCombat(agent)
      }
    }
    for (const agent of this.agents) {
      if (agent.state.alive && agent.state.demon) {
        this.religionSystem.updateDemonAutonomousBehavior(agent)
      }
    }
    this.environmentSystem.advanceCorruption()
    this.relicSystem.advanceRelics()
    this.scheduleSystem.preventProlongedIdle()
    this.scheduleSystem.enforceWeatherSafety()
    this.religionSystem.ensureDailyPropheticClaim()
    this.decisionEngine.processDecisionQueue()
    this.scheduleSystem.ensureDailyPlans()
    this.storySystem.checkSurvivorComposition(this.agents)
    this.storySystem.checkCultExtinction(this.agents)
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
    this.scheduleSystem.state.activeBlocks.delete(agent.state.id)
    this.decisionEngine.state.decisionQueue.delete(agent.state.id)
    this.decisionEngine.state.pendingDecisions.delete(agent.state.id)
    this.decisionEngine.state.llmRequestStatuses.delete(agent.state.id)
    this.scheduleSystem.state.dailySchedules.delete(agent.state.id)
    this.scheduleSystem.state.scheduleCursors.delete(agent.state.id)
    this.scheduleSystem.state.recoveringHealthAgentIds.delete(agent.state.id)
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

  public plantDream(
    targetAgentId: string,
    biasText: string,
    deityNameOverride?: string
  ): { success: boolean; message: string } {
    return this.religionSystem.plantDream(targetAgentId, biasText, deityNameOverride)
  }

  public placeDeityForbiddenRelic(
    tileX: number,
    tileY: number,
    text: string,
    deityName?: string
  ): { success: boolean; message: string } {
    if (this.religionSystem.state.godInterventionCredits <= 0) {
      return { success: false, message: 'No worship or cult rite has invoked a deity.' }
    }
    const finalDeityName = deityName?.trim() || this.religionSystem.state.lastInvokedDeityName || 'God'
    this.relicSystem.createDeityForbiddenRelic(tileX, tileY, text, finalDeityName)
    this.religionSystem.state.godInterventionCredits--
    return { success: true, message: `Placed the forbidden relic of ${finalDeityName} on the map!` }
  }

  public getGodInterventionCredits(): number {
    return this.religionSystem.state.godInterventionCredits
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

  private startBlock(
    agent: Agent,
    action: AgentAction,
    causationIds: string[] = [],
    rumourId?: string,
    fallback = false,
    propheticTask?: PropheticTask
  ): void {
    this.scheduleSystem.startBlock(agent, action, causationIds, rumourId, fallback, propheticTask)
  }





  private isAgentRefreshCancellation(error: unknown): boolean {
    return this.decisionEngine.isAgentRefreshCancellation(error)
  }

  private async runLLMRequestWithRetry<T>(
    agentId: string,
    label: string,
    request: () => Promise<T>,
    maxAttempts = 4
  ): Promise<T> {
    const requestEpoch = this.decisionEngine.state.queryEpoch
    let attempt = 0
    while (true) {
      if (requestEpoch !== this.decisionEngine.state.queryEpoch) throw new Error(`${label} was cancelled by an agent-state refresh`)
      if (this.shouldCancelRequestForCourt(agentId, label)) {
        this.decisionEngine.state.llmRequestStatuses.set(agentId, 'idle')
        throw new Error(`${label} was superseded by a resolution court`)
      }
      attempt++
      try {
        this.decisionEngine.state.llmRequestStatuses.set(agentId, 'sent')
        this.decisionEngine.state.llmQueryStats.made++
        const result = await request()
        if (requestEpoch !== this.decisionEngine.state.queryEpoch) throw new Error(`${label} was cancelled by an agent-state refresh`)
        this.decisionEngine.state.llmQueryStats.successful++
        this.decisionEngine.state.llmRequestStatuses.set(agentId, 'idle')
        return result
      } catch (error) {
        if (requestEpoch !== this.decisionEngine.state.queryEpoch) {
          this.decisionEngine.state.llmRequestStatuses.set(agentId, 'idle')
          throw error
        }
        if (this.shouldCancelRequestForCourt(agentId, label)) {
          this.decisionEngine.state.llmRequestStatuses.set(agentId, 'idle')
          throw error
        }
        // A story moment narration takes priority over routine retries: if one is
        // waiting on the shared slot, give it up now rather than burning through
        // the remaining attempts (each with its own LLM round-trip plus backoff),
        // which can easily outlast waitForLLMSlot's wait window and starve the
        // narration out entirely.
        if (label !== 'story moment narration' && this.storySystem.hasPendingNarrations()) {
          this.decisionEngine.state.llmRequestStatuses.set(agentId, 'idle')
          throw error
        }
        if (attempt >= maxAttempts) {
          this.decisionEngine.state.llmRequestStatuses.set(agentId, 'failed')
          throw error
        }
        this.decisionEngine.state.llmRequestStatuses.set(agentId, 'retrying')
        console.error(`[AgentManager] ${label} failed on attempt ${attempt}; retrying in 1 second:`, error)
        await new Promise<void>((resolve) => window.setTimeout(resolve, 1000))
      }
    }
  }


  private shouldCancelRequestForCourt(agentId: string, label: string): boolean {
    return this.decisionEngine.shouldCancelRequestForCourt(agentId, label)
  }







  private enqueueDecision(agentId: string, trigger: DecisionTrigger): void {
    this.decisionEngine.enqueueDecision(agentId, trigger)
  }

  private getRemainingSchedule(agentId: string): DailySchedule | undefined {
    return this.scheduleSystem.getRemainingSchedule(agentId)
  }

  private getMinuteOfDay(): number {
    return this.scheduleSystem.getMinuteOfDay()
  }

  private getAbsoluteMinute(): number {
    return this.scheduleSystem.getAbsoluteMinute()
  }

  private getTownCorruptionLevel(): number {
    const tileCorruptionValues = Array.from(this.environmentSystem.state.corruption.values())
    const avgTileCorruption = tileCorruptionValues.length > 0
      ? tileCorruptionValues.reduce((sum, value) => sum + value, 0) / tileCorruptionValues.length
      : 0
    const livingAgents = this.agents.filter((agent) => agent.state.alive)
    const cultFraction = livingAgents.length > 0
      ? livingAgents.filter((agent) => agent.state.cult).length / livingAgents.length
      : 0
    return Math.min(1, avgTileCorruption * 0.6 + cultFraction * 0.4)
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
    return this.decisionEngine.executeLLMDecision(agent, decision, causationIds)
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
    return { ...this.decisionEngine.state.llmQueryStats }
  }

  public getLLMRequestStatuses(): Record<string, LLMRequestStatus> {
    const statuses = Object.fromEntries(this.decisionEngine.state.llmRequestStatuses) as Record<string, LLMRequestStatus>
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
      ) && !this.decisionEngine.state.pendingDecisions.has(agent.state.id)) {
        statuses[agent.state.id] = 'idle'
        continue
      }
      const hasQueuedRequest =
        (this.decisionEngine.state.decisionQueue.get(agent.state.id)?.length ?? 0) > 0 ||
        !this.scheduleSystem.state.dailySchedules.has(agent.state.id)
      if (!this.decisionEngine.state.pendingDecisions.has(agent.state.id) && hasQueuedRequest) {
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
        if (this.decisionEngine.state.pendingDecisions.has(agentId)) {
          activities[agentId] = this.scheduleSystem.state.pendingActivityLabels.get(agentId) ?? 'speaking in court'
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
        activities[agentId] = this.decisionEngine.state.pendingDecisions.has(agentId)
          ? `thinking of a response to ${partner.state.name}`
          : `in conversation with ${partner.state.name}`
        continue
      }

      if (this.decisionEngine.state.pendingDecisions.has(agentId)) {
        activities[agentId] = this.scheduleSystem.state.pendingActivityLabels.get(agentId) ?? 'thinking'
        continue
      }
      if ((this.decisionEngine.state.decisionQueue.get(agentId)?.length ?? 0) > 0) {
        const queued = this.decisionEngine.state.decisionQueue.get(agentId) ?? []
        activities[agentId] = queued.some((trigger) =>
          trigger.type === 'prophecy' || trigger.type === 'prophetic_task'
        ) ? 'preparing to fulfill a divine command' : 'waiting to think'
        continue
      }

      const active = this.scheduleSystem.state.activeBlocks.get(agentId)
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
      if (!this.scheduleSystem.state.dailySchedules.has(agentId)) {
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
      const active = this.scheduleSystem.state.activeBlocks.get(agent.state.id)
      const lastTx = this.aiProvider?.getLastTransaction(agent.state.name)
      return [agent.state.id, {
        schedule: this.scheduleSystem.state.dailySchedules.get(agent.state.id),
        scheduleCursor: this.scheduleSystem.state.scheduleCursors.get(agent.state.id) ?? 0,
        activeAction: active?.action,
        activeEndsAt: active?.endsAt,
        queuedTriggers: [...(this.decisionEngine.state.decisionQueue.get(agent.state.id) ?? [])],
        lastLLMQuery: lastTx?.query,
        lastLLMResponse: lastTx?.response,
      }]
    }))
  }



  // The Demon acts on its own between user commands: it prowls, occasionally
  // turns on whoever is nearby, and sometimes just broods. A user command
  // (see commandDemon) always clears any active block and starts its own, so
  // this only ever runs when the Demon isn't currently mid-command — the
  // Demon does what it wants, but still listens the moment it's told to.

  public getEventBus(): EventBus {
    return this.eventBus
  }
}
