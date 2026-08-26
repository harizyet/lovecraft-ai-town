import { Agent } from '@/agent/Agent'
import { World } from '@/world/World'
import { SimulationManager } from '@/simulation/SimulationManager'
import { AIProvider, PropheticTask } from '@/ai/AIProvider'
import { PromptBuilder } from '@/ai/PromptBuilder'
import { EventBus } from '@/interaction/EventBus'
import { AgentInteraction } from '@/interaction/AgentInteraction'
import { WorldInteraction } from '@/interaction/WorldInteraction'
import { ConversationManager } from '@/interaction/ConversationManager'
import {
  ActionType,
  AgentAction,
  AgentState,
  Building,
  CourtVote,
  CultAgenda,
  CultRequest,
  DailySchedule,
  DecisionTrigger,
  LLMRequestStatus,
  Rumour,
  RumourProvenance,
  ScheduleBlock,
  StoryMomentKind,
  WeatherCondition,
} from '@/types'

// Mirrors the shape of AgentManager's private `activeBlocks` map values --
// duplicated here (rather than imported) because the field stays private on
// AgentManager; TypeScript's structural typing makes the duplicate safe.
export type ActiveBlockEntry = {
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
}

// Narrow surface of StorySystem exposed to other extracted subsystems, so
// they can trigger narration side effects without holding a reference to
// the full StorySystem class.
export interface StoryDeps {
  hasPendingNarrations(): boolean
  queueStoryMoment(kind: StoryMomentKind, title: string, facts: string, agentId: string, sourceEventId: string): void
  queueFirstCultRecruitMoment(leader: Agent, cultId: string, cultName: string, recruit: Agent, sourceEventId: string): void
  queueBelieverPoachedMoment(
    recruiter: Agent,
    cultId: string,
    cultName: string,
    convert: Agent,
    formerCultName: string,
    sourceEventId: string
  ): void
  queueFirstDeityAbilityMoment(ability: string, facts: string, agentId: string, sourceEventId: string): void
}

// Dependencies extracted subsystems (StorySystem, PoliticalSystem,
// JusticeSystem) need from AgentManager. Built once by AgentManager from its
// own fields/bound methods and handed to each system's constructor -- the
// extracted classes hold this narrow interface instead of a full
// back-reference to AgentManager.
export interface SystemDeps {
  getAgents(): Agent[]
  world: World
  eventBus: EventBus
  aiProvider: AIProvider | null
  promptBuilder: PromptBuilder
  simManager: SimulationManager
  story: StoryDeps
  agentInteraction: AgentInteraction
  worldInteraction: WorldInteraction
  conversationManager: ConversationManager

  activeBlocks: Map<string, ActiveBlockEntry>
  decisionQueue: Map<string, DecisionTrigger[]>
  dailySchedules: Map<string, DailySchedule>
  scheduleCursors: Map<string, number>
  pendingDecisions: Map<string, Promise<void>>
  pendingActivityLabels: Map<string, string>
  llmRequestStatuses: Map<string, LLMRequestStatus>
  rumours: Map<string, Rumour>
  getCurrentDay(): number
  setCurrentDay(day: number): void
  isLLMRequestInFlight(): boolean
  setLLMRequestInFlight(value: boolean): void

  getAbsoluteMinute(): number
  getMinuteOfDay(): number

  // Court and the policy assembly cannot run at the same time; each needs to
  // know whether the other currently has the floor.
  isCourtActive(): boolean
  isPolicyVoteActive(): boolean

  runLLMRequestWithRetry<T>(agentId: string, label: string, request: () => Promise<T>, maxAttempts?: number): Promise<T>
  isAgentRefreshCancellation(error: unknown): boolean

  enqueueDecision(agentId: string, trigger: DecisionTrigger): void
  startBlock(
    agent: Agent,
    action: AgentAction,
    causationIds?: string[],
    rumourId?: string,
    fallback?: boolean,
    propheticTask?: PropheticTask
  ): void
  resolveTarget(targetName: string | null | undefined): { x: number; y: number } | null
  findBuildingOfType(agent: Agent, type: string): Building | null
  findJobBuilding(agent: Agent): Building | null
  findRandomWalkablePosition(): { x: number; y: number }
  getAgentState(id: string): AgentState | undefined

  // Rumour subsystem (RumourSystem.ts) -- also covers Investigation, which
  // has no state of its own and lives entirely on rumour/belief structures.
  findAccusedAgent(rumour: Rumour): Agent | undefined
  getRelatedRumourCluster(seed: Rumour): Rumour[]
  deliverRumour(
    rumour: Rumour,
    recipient: Agent,
    sourceAgentId: string,
    causationIds: string[],
    forceSeedBelief?: boolean,
    directExperience?: boolean
  ): void
  getInvestigationAuthority(agent: Agent, rumour: Rumour): string | null
  createRumour(
    text: string,
    origin: Rumour['origin'],
    sourceAgentId?: string,
    sourceEventId?: string,
    credibility?: number,
    parentRumourId?: string,
    provenance?: RumourProvenance
  ): Rumour
  registerAgentCreatedRumour(rumour: Rumour, agent: Agent, kind: 'invented' | 'mutated', parent?: Rumour): void
  applyRumourProvenanceBelief(
    rumour: Rumour,
    agent: Agent,
    belief: Rumour['beliefs'][number],
    forceAcceptance?: boolean
  ): void
  applyExistentialWitnessReaction(
    witness: Agent,
    sourceText: string,
    severityHint: number,
    insanitySource: NonNullable<AgentState['permanentInsanity']>['source']
  ): void
  // Cult subsystem (CultSystem.ts).
  promoteCultSuccessor(formerLeader: Agent, preferredSuccessorId: string | undefined, reason: string): void
  isConversionImmune(agent: Agent): boolean
  hasOpposingPoliticalCamps(leader: Agent, candidate: Agent): boolean
  fulfillCultRequests(cultId: string, matches: (request: CultRequest) => boolean, eventId: string): void
  findProvenCult(): { id: string; name: string } | undefined
  disbandCult(cultId: string, cultName: string): string[]
  tryMakePriestHostile(priest: Agent, cultist: Agent, cause: string, causationId: string): void
  createCultLeaderAgendas(leader: Agent): CultAgenda[]
  findEmptySummoningBuilding(
    requestedName?: string | null,
    ignoredAgentIds?: Set<string>,
    preferredCultId?: string
  ): Building | undefined
  fulfillRequestsFromGodAbility(
    ability: 'bless' | 'heal' | 'smite' | 'resurrect' | 'manifest' | 'weather',
    target: Agent | undefined,
    weatherCondition: WeatherCondition | undefined,
    eventId: string
  ): void
  generateCultName(claimText: string, revelationText: string): Promise<string>
  maybeTriggerWillingCultJoin(target: Agent, deityName: string, causationId: string): void
  applyTimedBlessing(recipient: Agent, sourceAgentId: string, sourceCultId?: string): void

  // Court reads cult state via this cult/court coupling.
  getCultCourtDirection(
    voter: Agent,
    court: NonNullable<Rumour['resolutionCourt']>
  ): { choice: CourtVote['choice']; sourceName: string } | null
  applyCultCourtInfluence(
    voter: Agent,
    accused: Agent,
    court: NonNullable<Rumour['resolutionCourt']>,
    vote: Omit<CourtVote, 'agentId'>
  ): Omit<CourtVote, 'agentId'>

  // Religion/Prophecy/Deity subsystem (ReligionSystem.ts).
  chooseDeityName(agent: Agent): string
  maybeTriggerReligiousFervour(agent: Agent, rumour: Rumour, belief: Rumour['beliefs'][number]): void
  maybeAppointProphet(agent: Agent, rumour: Rumour, deityName: string): void
  queuePropheticInterpretation(agent: Agent, rumour: Rumour, deityName: string, eventId?: string): void
  applyResurrectionInsanity(target: Agent, sourceName: string, includeExecuteVoterInsanity: boolean): number
  getProphetAgentId(): string | null
  grantDemonSummonCredit(site: { x: number; y: number }): number

  // Shared by JusticeSystem and PoliticalSystem verdicts/outcomes.
  banishAgent(agent: Agent, reason: string, policySessionId: string): void

  // Owned by JusticeSystem but called from PoliticalSystem (assembly votes
  // gather at the same court center, and reuse the same "is this statement
  // too weak to use verbatim" and post-verdict schedule-resumption logic).
  getCourtCenter(): { x: number; y: number } | null
  isWeakCourtStatement(statement: string): boolean
  resumeSchedulesAfterCourt(participantIds: string[]): void
  updateAgentJusticeResponse(rumour: Rumour, agent: Agent, belief: Rumour['beliefs'][number]): void

  // Generic AgentManager helpers used by the extracted subsystems.
  findAgentByName(targetName: string, candidates: Agent[]): Agent | undefined
  formatAbsoluteMinute(minute: number): string
  findTownEntrance(): { x: number; y: number }

  // Social subsystem (SocialSystem.ts).
  lastActions: Map<string, { action: string; timestamp: number }>
  hasRumourPropagationOpportunity(a: Agent, b: Agent): boolean
  buildRumourConversationContext(agent: Agent, otherAgentId: string | null): string
  maybeAddRumourToConversation(agent: Agent, partner: Agent, decision: AgentAction): void
  getActiveCourtRumourId(): string | null
  getRemainingSchedule(agentId: string): DailySchedule | undefined

  // Schedule subsystem (ScheduleSystem.ts).
  executeLLMDecision(agent: Agent, decision: AgentAction, causationIds?: string[]): string
  ensureBelieverPrayerBlock(agent: Agent, blocks: ScheduleBlock[], minuteOfDay: number): ScheduleBlock[]
  findCultShrine(cultId: string): Building | undefined
  isVisibleCultActivity(action: string): boolean
  hasNearbyPriest(agent: Agent): boolean
  formCult(prophet: Agent, task: PropheticTask, causationId: string): void
  gatherCultForSummoning(leader: Agent, action: AgentAction): void
  getSummoningParticipantSlot(site: { x: number; y: number }, index: number): { x: number; y: number }
  advanceSummoningProcess(leader: Agent, active: ActiveBlockEntry, now: number): boolean
  getSummoningBuildingCenter(building: Building): { x: number; y: number }
  completeCultAbility(agent: Agent, action: AgentAction, causationId: string): void
  completeCultShrineConstruction(leader: Agent, causationId: string): void
  attemptCultRecruitment(prophet: Agent, target: Agent, task: PropheticTask, causationId: string): void
  coordinateScheduledSummons(): void
  isAgentUndecidedAboutRumour(agentId: string, rumourId: string): boolean
  isRumourUnresolved(rumourId: string): boolean
  prepareInvestigationDecision(agent: Agent, decision: AgentAction, rumour: Rumour, authority: string): void
  completeAffiliationInterrogation(interrogator: Agent, action: AgentAction, causationId: string): void
  completeRumourInvestigation(rumourId: string, agent: Agent, causationId: string): string | undefined
  canAttemptCultBribery(briber: Agent, target: Agent): boolean
  attemptCultBribery(briber: Agent, target: Agent, reasoning: string, causationId: string): void
  attemptFavorBribery(briber: Agent, target: Agent, reasoning: string, causationId: string): void
  resetCrossSystemStateForRefresh(): void
  canPriestCallInquisitor(priest: Agent): boolean
  isInquisitorOutsiderSpawned(): boolean
  findNearestAvailableSocialTarget(agent: Agent): Agent | undefined
  bumpQueryEpoch(): number

  // Decision engine subsystem (DecisionEngine.ts).
  logAction(agent: Agent, actionType: ActionType, targetId: string | null, description: string, causationIds: string[]): string
}
