export interface Vector2 {
  x: number
  y: number
}

export const SIMULATION_SPEEDS = [1, 2, 4, 8, 12] as const

export type WeatherCondition = 'clear' | 'cloudy' | 'rain' | 'storm'

export interface WeatherState {
  condition: WeatherCondition
  temperatureC: number
  hazardousOutdoors: boolean
  changedAtMinute: number
}

export interface Rect {
  x: number
  y: number
  width: number
  height: number
}

export enum TileType {
  GRASS = 'grass',
  ROAD = 'road',
  WATER = 'water',
  BUILDING = 'building',
  TREE = 'tree',
  PATH = 'path',
  // Permanent scars left by sustained EnvironmentSystem corruption: a grass
  // tile that stayed heavily corrupted long enough becomes anomalous ground
  // that never reverts to ordinary grass, even after the corrupting source
  // is gone and the tile's transient corruption value has fully decayed.
  BLIGHTED = 'blighted',
  // The water equivalent -- a lake or pond tile that has been permanently
  // fouled rather than merely tinted while corruption is active.
  BRACKISH_WATER = 'brackish_water',
}

export enum BuildingType {
  HOME = 'home',
  SHOP = 'shop',
  TOWN_SQUARE = 'town_square',
  PARK = 'park',
  RESTAURANT = 'restaurant',
  CHURCH = 'church',
  WORKSHOP = 'workshop',
  SMITHY = 'smithy',
  CARPENTER_WORKSHOP = 'carpenter_workshop',
  MARKET = 'market',
  GUARDHOUSE = 'guardhouse',
  APOTHECARY = 'apothecary',
  MANOR = 'manor',
  TAVERN = 'tavern',
  FARM = 'farm',
  CULT_SHRINE = 'cult_shrine',
}

export interface Tile {
  type: TileType
  walkable: boolean
  buildingId?: string
  // 0..1 intensity of environmental corruption bleeding from nearby cult
  // shrines, demons, or summoning rituals (see EnvironmentSystem). Absent
  // (rather than 0) on every tile the system has never touched, so save
  // files for existing worlds stay small and untouched tiles need no
  // migration.
  corruption?: number
}

export interface Building {
  id: string
  type: BuildingType
  position: Vector2
  size: Vector2
  name: string
  description: string
  interiorTiles?: Tile[][]
  cultId?: string
}

export interface WorldObject {
  id: string
  type: 'body' | 'debris' | 'resource' | 'structure'
  position: Vector2
  data: Record<string, unknown>
  createdAt: number
  expiresAt?: number
}

// A physical object a Priest/Inquisitor/investigator may leave behind after
// completing an investigation (see RelicSystem): their written findings,
// possibly laced with forbidden knowledge if the investigation brushed up
// against something that shouldn't be understood. Visible on the map and
// persists until the world is regenerated -- unlike a rumour or a whisper,
// it is a standing, re-discoverable hazard/lure rather than a one-time
// narrative beat.
export interface ForbiddenRelic {
  id: string
  position: Vector2
  title: string
  // The investigator's penned findings -- what a reader actually learns.
  text: string
  authorAgentId: string
  authorName: string
  // Set only when the author belonged to a cult at the time of writing: ties
  // the relic to that cult's deity, so a non-member who is swayed by it is
  // pulled toward that specific faith rather than a generic one.
  cultId?: string
  cultName?: string
  deityName?: string
  containsForbiddenKnowledge: boolean
  // 0 when containsForbiddenKnowledge is false; otherwise the severity fed
  // into applyExistentialWitnessReaction for both the author (at creation)
  // and any later reader (at discovery).
  severity: number
  createdAtMinute: number
  discoveredByAgentIds: string[]
}

export enum ActionType {
  MOVE = 'move',
  TALK = 'talk',
  WORK = 'work',
  REST = 'rest',
  ATTACK = 'attack',
  STEAL = 'steal',
  DESTROY = 'destroy',
  HELP = 'help',
  FLEE = 'flee',
  BUILD = 'build',
  GATHER = 'gather',
  EAT = 'eat',
  SLEEP = 'sleep',
  IDLE = 'idle',
  INVESTIGATE = 'investigate',
  INTERROGATE = 'interrogate',
  CALL_INQUISITOR = 'call_inquisitor',
  CRY = 'cry',
  PRAY = 'pray',
  CONJURE = 'conjure',
  SUMMON = 'summon',
  RESURRECT = 'resurrect',
  HEAL = 'heal',
  BLESS = 'bless',
  CURSE = 'curse',
  RITUAL = 'ritual',
  PREACH = 'preach',
  INVITE_CULT = 'invite_cult',
  BUILD_SHRINE = 'build_shrine',
  BRIBE = 'bribe',
  CORRUPT = 'corrupt',
}

export enum EmotionalState {
  HAPPY = 'happy',
  NEUTRAL = 'neutral',
  SAD = 'sad',
  ANGRY = 'angry',
  AFRAID = 'afraid',
  EXCITED = 'excited',
  TIRED = 'tired',
  HUNGRY = 'hungry',
  PANICKED = 'panicked',
  GRIEVING = 'grieving',
  AMBIVALENT = 'ambivalent',
  DETERMINED = 'determined',
}

export enum RelationshipType {
  NEUTRAL = 'neutral',
  FRIEND = 'friend',
  ENEMY = 'enemy',
  ALLY = 'ally',
  ROMANTIC = 'romantic',
  FEAR = 'fear',
}

export interface AgentAction {
  action: string
  target?: string | null
  reasoning: string
  dialogue?: string
  emotionalState: string
  durationMinutes?: number
  justiceResponse?: 'gossip' | 'court' | 'vigilante'
}

export type DecisionTriggerType =
  | 'day_start'
  | 'task_complete'
  | 'interaction'
  | 'rumour'
  | 'world_event'
  | 'prophecy'
  | 'prophetic_task'
  | 'idle_recovery'
  | 'seek_cult_leader'

export interface DecisionTrigger {
  type: DecisionTriggerType
  description: string
  eventId?: string
  rumourId?: string
  targetAgentId?: string
  propheticTask?: import('@/ai/AIProvider').PropheticTask
  causationIds: string[]
}

export interface ScheduleBlock extends AgentAction {
  id: string
  startMinute: number
  durationMinutes: number
}

export interface DailySchedule {
  day: number
  blocks: ScheduleBlock[]
}

export interface AgentDebugDetails {
  schedule?: DailySchedule
  scheduleCursor: number
  activeAction?: AgentAction
  activeEndsAt?: number
  queuedTriggers: DecisionTrigger[]
  lastLLMQuery?: string
  lastLLMResponse?: string
}

export type LLMRequestStatus = 'idle' | 'pending' | 'sent' | 'retrying' | 'failed'

export interface RumourResponse {
  agentId: string
  action: string
  reasoning: string
  emotionalState: string
  timestamp: number
}

export interface RumourBelief {
  agentId: string
  stance: 'uncertain' | 'believer' | 'denier'
  confidence?: number
  extreme: boolean
  formedAt: number
  heardFromAgentId?: string
  seeded?: boolean
  authored?: boolean
  perceivedSource?: string
  selfTargeted?: boolean
  selfBeliefConsensusChecked?: boolean
  selfBeliefFromConsensus?: boolean
  justiceResponse?: 'gossip' | 'court' | 'vigilante'
  justiceActionQueued?: boolean
  justiceResponseExplicit?: boolean
}

export type RumourProvenanceKind =
  | 'event'
  | 'anonymous'
  | 'intuition'
  | 'dream'
  | 'divine'
  | 'mutation'

export interface RumourProvenance {
  kind: RumourProvenanceKind
  description: string
  deityName?: string
}

export interface DeityBelief {
  name: string
  confidence: number
  revelationCount: number
}

export interface AgentBeliefSystem {
  religiousStance: 'undecided' | 'believer' | 'nonbeliever' | 'atheist'
  faith: number
  deities: DeityBelief[]
}

export type CultRequestKind =
  | 'heal_member'
  | 'bless_member'
  | 'better_weather'
  | 'grow_influence'
  | 'leader_power'
  | 'punish_nonbeliever'

export interface CultRequest {
  id: string
  cultId: string
  requesterId: string
  kind: CultRequestKind
  description: string
  targetAgentId?: string
  createdAtMinute: number
  status: 'pending' | 'fulfilled' | 'expired'
  fulfilledAtMinute?: number
  fulfilledByEventId?: string
}

export interface CultAgenda {
  kind: 'power' | 'influence' | 'expansion' | 'purge_nonbelievers'
  description: string
  intensity: number
}

export type CourtVoteChoice = 'absolve' | 'exile' | 'execute'

export interface CourtVote {
  agentId: string
  choice: CourtVoteChoice
  statement: string
  reasoning: string
}

export interface PostVerdictStatement {
  agentId: string
  agentName: string
  statement: string
}

export interface ResolutionCourtSession {
  id: string
  rumourId: string
  rumourIds: string[]
  accusedAgentId: string
  accusedName?: string
  participantIds: string[]
  status: 'gathering' | 'voting' | 'commenting' | 'resolved'
  startedAt: number
  gatheringDeadline: number
  gatheringStartedAtMs?: number
  lastGatheringRerouteAtMs?: number
  votes: CourtVote[]
  defenseStatement?: string
  outcomeStatement?: string
  postVerdictStatements?: PostVerdictStatement[]
  outcome?: 'absolved' | 'exiled' | 'executed'
  resolution?: string
}

export type PoliticalCampId = 'gentry' | 'commons'

export interface PoliticalCamp {
  id: PoliticalCampId
  name: string
  joinedAtMinute: number
}

export type PolicyVoteChoice = 'support' | 'oppose'

export interface PolicyVote {
  agentId: string
  choice: PolicyVoteChoice
  statement: string
  reasoning: string
}

export type PolicyEffect = 'wealth' | 'outlaw_cult' | 'outlaw_knight' | 'outlaw_inquisitor' | 'propose_alderman'

export interface PolicyProposal {
  id: string
  question: string
  description: string
  targetJob: string
  wealthDelta: number
  effect?: PolicyEffect
  effectSummary?: string
  targetCultId?: string
  targetCultName?: string
  targetOutsiderAgentId?: string
  targetOutsiderName?: string
  targetLeaderAgentId?: string
  targetLeaderName?: string
}

export interface PolicySession {
  id: string
  proposalId: string
  question: string
  description: string
  targetJob: string
  wealthDelta: number
  effect?: PolicyEffect
  effectSummary?: string
  targetCultId?: string
  targetCultName?: string
  targetOutsiderAgentId?: string
  targetOutsiderName?: string
  targetLeaderAgentId?: string
  targetLeaderName?: string
  convenerAgentId: string
  convenerName?: string
  participantIds: string[]
  status: 'gathering' | 'voting' | 'resolved'
  startedAt: number
  gatheringDeadline: number
  gatheringStartedAtMs?: number
  lastGatheringRerouteAtMs?: number
  votes: PolicyVote[]
  outcome?: 'passed' | 'rejected'
  resolution?: string
  beneficiaryAgentIds?: string[]
  outlawedAgentIds?: string[]
}

export type ForbiddenKnowledgeCategory =
  | 'simulation_awareness'
  | 'engineered_reset'
  | 'memory_impermanence'
  | 'cosmic_indifference'
  | 'ai_nature'
  | 'other'

export interface ForbiddenKnowledgeEntry {
  text: string
  category: ForbiddenKnowledgeCategory
  severity: number
  revealedAtMinute: number
  sourceRumourId?: string
}

// Only 'comprehended' agents branch beyond denial: whether a villager even
// grasps a reality-breaking revelation depends on their own personality, not
// just the content's severity (see ForbiddenKnowledgeRules.ts and
// AgentManager.applyExistentialWitnessReaction).
export type ExistentialReaction =
  | 'denial'
  | 'reinterpretation'
  | 'obsession'
  | 'nihilism'
  | 'revelation'
  | 'madness'

export interface ExistentialState {
  comprehended: boolean
  reaction: ExistentialReaction
  establishedAtMinute: number
  reasoning: string
  // Only set for 'reinterpretation': the existing belief frame (usually a
  // named deity) the villager recast the revelation through, e.g. "Dagon
  // governs even this."
  reinterpretationFrame?: string
}

export interface ObsessionState {
  since: number
  evidenceCount: number
  lastEvidenceAtMinute: number
  evidenceLog: string[]
}

export interface Rumour {
  id: string
  text: string
  origin: 'natural' | 'whisper' | 'invented' | 'mutated'
  groundTruth?: boolean
  courtEligible?: boolean
  parentRumourId?: string
  provenance: RumourProvenance
  sourceAgentId?: string
  sourceEventId?: string
  createdAt: number
  credibility: number
  credibilitySourceIds: string[]
  relatedRumourIds: string[]
  heardBy: string[]
  pendingFirstShareBy: string[]
  transmissions: number
  responses: RumourResponse[]
  status: 'unverified' | 'investigating' | 'verified' | 'unsubstantiated' | 'resolved'
  resolvedAt?: number
  investigatedAt?: number
  investigatorIds: string[]
  findingHeardBy: string[]
  beliefs: RumourBelief[]
  finding?: string
  resolutionCourt?: ResolutionCourtSession
  archived?: boolean
  archivedAt?: number
  timelineSummary?: string
}

export type StoryMomentKind = 'cult_formed' | 'prophet_appointed' | 'demon_created' | 'priest_corrupted' | 'church_corrupted' | 'flock_corrupted' | 'first_cultist_recruited' | 'believer_poached' | 'deity_ability_first_used' | 'land_corrupted' | 'eldritch_blight' | 'forbidden_relic_created' | 'deity_relic_created' | 'alderman_named' | 'knight_called' | 'inquisitor_called' | 'knight_killed' | 'inquisitor_killed'

export interface StoryMoment {
  id: string
  kind: StoryMomentKind
  title: string
  narrative: string
  status: 'pending' | 'ready' | 'failed'
  createdAtMinute: number
  sourceEventId: string
}

export interface SimulationEvent {
  id: string
  timestamp: number
  type: string
  agentId: string
  actionType: ActionType
  targetId?: string
  outcome: string
  description: string
  causationIds: string[]
  worldStateDelta: Record<string, unknown>
  observers: string[]
}

export interface ConversationExchange {
  speakerId: string
  speakerName: string
  dialogue: string
  timestamp: number
}

export interface ConversationState {
  id: string
  participants: string[]
  exchanges: ConversationExchange[]
  topic: string
  createdAt: number
  lastActiveAt: number
  maxTurns: number
}

export interface AgentMemory {
  recent: SimulationEvent[]
  summary: string
}

export interface AgentRelationship {
  agentId: string
  type: RelationshipType
  strength: number
  lastInteraction: number
}

export interface AgentNeeds {
  hunger: number
  energy: number
  social: number
}

export interface PersonalityTraits {
  aggression: number
  friendliness: number
  curiosity: number
  caution: number
  ambition: number
  creativity: number
}

export interface InventoryItem {
  id: string
  name: string
  type: string
  quantity: number
  data: Record<string, unknown>
}

export interface AgentState {
  id: string
  name: string
  position: Vector2
  targetPosition?: Vector2
  personality: PersonalityTraits
  needs: AgentNeeds
  health: number
  maxHealth: number
  inventory: InventoryItem[]
  alive: boolean
  exiled?: {
    atMinute: number
    courtSessionId: string
    reason: string
  }
  currentBuilding?: string
  currentJob?: string
  homeId?: string
  outsider?: {
    kind: 'knight' | 'inquisitor'
    enteredAtMinute: number
    calledByAgentId?: string
  }
  demon?: {
    createdAtMinute: number
    lastCommand?: string
    commandedAtMinute?: number
  }
  knightPatrol?: {
    currentBuildingId?: string
    visitedBuildingIds: string[]
  }
  memory: AgentMemory
  relationships: AgentRelationship[]
  fears: string[]
  grudges: string[]
  alliances: string[]
  reputation: number
  wealth: number
  politicalCamp?: PoliticalCamp
  beliefSystem: AgentBeliefSystem
  religiousStanceRevealed?: boolean
  cult?: {
    id: string
    name: string
    // An 'associate' is a temporary, bribed affiliation: it grants no
    // genuine belief and lapses the instant the associate casts one policy
    // vote (see AgentManager.recordPolicyVote).
    role: 'leader' | 'member' | 'founder' | 'associate'
    joinedAtMinute?: number
    recruitedByAgentId?: string
    joinMethod?: 'founded' | 'invitation' | 'preaching' | 'conversation' | 'bribery' | 'devotion'
  }
  // Set once a deity has spoken directly to this agent and left them a
  // believer: the agent will seek out that deity's cult leader on their own
  // and ask to join. This is a willing join, driven entirely by the agent's
  // own belief -- it bypasses the ordinary chance-based recruitment/
  // preaching conversion mechanics once the leader is reached.
  seekingCultJoin?: {
    cultId: string
    cultName: string
    deityName: string
    sinceMinute: number
  }
  // True when this agent is secretly the village's Prophet and true cult
  // leader while their public currentJob is deliberately left unchanged
  // (e.g. a Priest whose whispered corruption stays hidden behind their
  // ordinary church duties, Innsmouth-style).
  secretProphet?: boolean
  cultConversionProgress?: Record<string, number>
  blessing?: {
    sourceAgentId: string
    sourceCultId?: string
    abilityMultiplier: number
    expiresAtMinute: number
  }
  permanentInsanity?: {
    causedAtMinute: number
    source: 'divine_manifestation' | 'demon_manifestation' | 'forbidden_knowledge' | 'forbidden_relic'
    reason: string
  }
  // A bias or nightmare either planted by the player while this agent slept
  // (ReligionSystem.plantDream) or arising on its own from the town's
  // ambient corruption (ScheduleSystem's spontaneous nightmare roll, cult-
  // unaligned agents only). Cleared the next time the agent falls asleep
  // (see ScheduleSystem), so it colors roughly one waking day of behaviour
  // and conversation before fading.
  dream?: {
    plantedBy: 'player' | 'spontaneous'
    deityName?: string
    biasText: string
    isNightmare: boolean
    plantedAtMinute: number
  }
  lastDeath?: {
    witnessIds: string[]
    courtSessionId?: string
    executeVoterIds?: string[]
  }
  sanity: number
  lastSuicideCheckMinute?: number
  forbiddenKnowledge?: ForbiddenKnowledgeEntry[]
  existentialState?: ExistentialState
  obsession?: ObsessionState
  cultRequests?: CultRequest[]
  cultAgendas?: CultAgenda[]
  cultDesperation?: {
    reason: string
    feltForsakenAtMinute: number
    lastConsideredMinute: number
  }
  formerCults?: Array<{
    id: string
    name: string
    leftAtMinute: number
  }>
  cultEnemies?: Array<{
    cultId: string
    cultName: string
    markedAtMinute: number
  }>
  antiCultGroup?: {
    id: string
    name: string
    opposedCultId: string
    opposedCultName: string
    founderId: string
    role: 'leader' | 'member'
    joinedAtMinute: number
  }
  cultDefectionLastCheckMinute?: number
  knownCultGroups?: Array<{
    cultId: string
    cultName: string
    discoveredAtMinute: number
  }>
  alderman?: {
    cultId: string
    cultName: string
    sinceMinute: number
    policySessionId: string
  }
  secretAffiliationKnowledge?: Array<{
    agentId: string
    affiliation: 'cult' | 'anti_cult'
    groupId: string
    groupName: string
    discoveredAtMinute: number
  }>
  emotionalState: EmotionalState
  lastActionTime: number
  path: Vector2[]
  pathIndex: number
  activeConversationId: string | null
  lastReasoning: string
}

export interface CameraState {
  position: Vector2
  zoom: number
  targetId?: string
  minZoom: number
  maxZoom: number
}

export interface SimulationConfig {
  tickRate: number
  mapWidth: number
  mapHeight: number
  tileSize: number
  agentCount: number
  llmEndpoint: string
  llmModel: string
  conversationChanceMultiplier: number
  rumourPropagationMultiplier: number
  inventedRumourProbability: number
  rumourExtremeBeliefProbability: number
  memoryBufferSize: number
}

export interface DayNightCycle {
  hour: number
  minute: number
  day: number
  isDaytime: boolean
  brightness: number
}
