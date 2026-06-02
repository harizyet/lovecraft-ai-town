export interface Vector2 {
  x: number
  y: number
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
}

export enum BuildingType {
  HOME = 'home',
  SHOP = 'shop',
  TOWN_SQUARE = 'town_square',
  PARK = 'park',
  RESTAURANT = 'restaurant',
  CHURCH = 'church',
  WORKSHOP = 'workshop',
}

export interface Tile {
  type: TileType
  walkable: boolean
  buildingId?: string
}

export interface Building {
  id: string
  type: BuildingType
  position: Vector2
  size: Vector2
  name: string
  description: string
  interiorTiles?: Tile[][]
}

export interface WorldObject {
  id: string
  type: 'body' | 'debris' | 'resource' | 'structure'
  position: Vector2
  data: Record<string, unknown>
  createdAt: number
  expiresAt?: number
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
  currentBuilding?: string
  currentJob?: string
  memory: AgentMemory
  relationships: AgentRelationship[]
  fears: string[]
  grudges: string[]
  alliances: string[]
  reputation: number
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
  decisionInterval: number
  mapWidth: number
  mapHeight: number
  tileSize: number
  agentCount: number
  llmEndpoint: string
  llmModel: string
  memoryBufferSize: number
  summaryInterval: number
}

export interface DayNightCycle {
  hour: number
  minute: number
  day: number
  isDaytime: boolean
  brightness: number
}
