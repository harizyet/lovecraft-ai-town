import {
  AgentState,
  AgentNeeds,
  PersonalityTraits,
  AgentMemory,
  AgentRelationship,
  InventoryItem,
  EmotionalState,
  ActionType,
  Vector2,
  SimulationEvent,
  ConversationState,
  ConversationExchange,
} from '@/types'
import { World } from '@/world/World'
import { SimulationManager } from '@/simulation/SimulationManager'
import { AStarPathfinder } from '@/utils/AStarPathfinder'

const FIRST_NAMES = [
  'Elena',
  'Marcus',
  'Freya',
  'Oscar',
  'Iris',
  'Dante',
  'Luna',
  'Silas',
  'Aria',
  'Finn',
  'Mira',
  'Rowan',
  'Thea',
  'Caleb',
  'Nora',
  'Leif',
]

const LAST_NAMES = [
  'Stone',
  'River',
  'Ash',
  'Wolf',
  'Thorn',
  'Bloom',
  'Hawk',
  'Brook',
  'Flint',
  'Moss',
  'Frost',
  'Ember',
]

const JOBS = [
  'Teacher',
  'Mechanic',
  'Retail Worker',
  'Police Officer',
  'Nurse',
  'Accountant',
  'Chef',
  'Paramedic',
]

const JOB_BUILDINGS: Record<string, string[]> = {
  Teacher: [],
  Mechanic: ['workshop'],
  'Retail Worker': ['shop'],
  'Police Officer': ['town_square'],
  Nurse: ['church'],
  Accountant: ['church'],
  Chef: ['restaurant'],
}

function randomBetween(min: number, max: number): number {
  return Math.random() * (max - min) + min
}

function randomInt(min: number, max: number): number {
  return Math.floor(randomBetween(min, max + 1))
}

function pickRandom<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)]
}

export class Agent {
  public state: AgentState
  private world: World
  private pathfinder: AStarPathfinder
  private simManager: SimulationManager
  private decisionTimer: number
  private moveSpeed: number
  private proximityRadius: number
  public conversations: Map<string, ConversationState>
  public getWorld(): World { return this.world }

  constructor(
    id: string,
    name: string,
    world: World,
    simManager: SimulationManager
  ) {
    this.world = world
    this.simManager = simManager
    this.pathfinder = new AStarPathfinder(world)
    this.decisionTimer = 0
    this.moveSpeed = 2.5
    this.proximityRadius = 4
    this.conversations = new Map()

    const personality = this.generatePersonality()
    const job = pickRandom(JOBS)
    const spawnPos = this.findSpawnPosition()

    this.state = {
      id,
      name,
      position: spawnPos,
      personality,
      needs: {
        hunger: 50 + randomInt(0, 30),
        energy: 70 + randomInt(0, 30),
        social: 40 + randomInt(0, 40),
      },
      health: 100,
      maxHealth: 100,
      inventory: [],
      alive: true,
      currentJob: job,
      memory: {
        recent: [],
        summary: '',
      },
      relationships: [],
      fears: [],
      grudges: [],
      alliances: [],
      reputation: 50,
      emotionalState: EmotionalState.NEUTRAL,
      lastActionTime: 0,
      path: [],
      pathIndex: 0,
      activeConversationId: null,
      lastReasoning: '',
    }
  }

  private generatePersonality(): PersonalityTraits {
    return {
      aggression: randomBetween(0, 1),
      friendliness: randomBetween(0, 1),
      curiosity: randomBetween(0, 1),
      caution: randomBetween(0, 1),
      ambition: randomBetween(0, 1),
      creativity: randomBetween(0, 1),
    }
  }

  private findSpawnPosition(): Vector2 {
    const buildings = Array.from(this.world.buildings.values())

    if (buildings.length > 0 && Math.random() > 0.3) {
      const building = pickRandom(buildings)
      const bx = building.position.x + 1
      const by = building.position.y + 1
      if (this.world.isWalkable(bx, by)) {
        return { x: bx, y: by }
      }
    }

    for (let attempt = 0; attempt < 100; attempt++) {
      const x = randomInt(2, this.world.width - 3)
      const y = randomInt(2, this.world.height - 3)
      if (this.world.isWalkable(x, y)) {
        return { x, y }
      }
    }

    return { x: 5, y: 5 }
  }

  public update(deltaMs: number, simTime: number): void {
    if (!this.state.alive) return

    this.decisionTimer += deltaMs
    this.updateNeeds(deltaMs)
    this.updateMovement(deltaMs, simTime)
  }

  private updateNeeds(deltaMs: number): void {
    const decayRate = 0.0001
    this.state.needs.hunger = Math.max(
      0,
      this.state.needs.hunger - deltaMs * decayRate * 0.8
    )
    this.state.needs.energy = Math.max(
      0,
      this.state.needs.energy - deltaMs * decayRate * 0.5
    )
    this.state.needs.social = Math.max(
      0,
      this.state.needs.social - deltaMs * decayRate * 0.3
    )

    // Needs affect decision-making indirectly through the prompt,
    // but don't override the LLM's chosen emotional state
  }

  private updateMovement(deltaMs: number, _simTime: number): void {
    if (this.state.path.length === 0 || this.state.pathIndex >= this.state.path.length) {
      return
    }

    const target = this.state.path[this.state.pathIndex]
    const dx = target.x - this.state.position.x
    const dy = target.y - this.state.position.y
    const dist = Math.sqrt(dx * dx + dy * dy)

    if (dist < 0.1) {
      this.state.position.x = target.x
      this.state.position.y = target.y
      this.state.pathIndex++
      return
    }

    const moveAmount = (this.moveSpeed * deltaMs) / 1000
    const nx = dx / dist
    const ny = dy / dist

    this.state.position.x += nx * moveAmount
    this.state.position.y += ny * moveAmount
  }

  public moveTo(targetX: number, targetY: number): boolean {
    if (!this.state.alive) return false

    const path = this.pathfinder.findPath(
      { x: Math.round(this.state.position.x), y: Math.round(this.state.position.y) },
      { x: targetX, y: targetY }
    )

    if (path.length > 0) {
      this.state.path = path
      this.state.pathIndex = 0
      return true
    }
    return false
  }

  public getNearbyAgents(allAgents: Agent[]): Agent[] {
    return allAgents.filter(
      (other) =>
        other.state.id !== this.state.id &&
        other.state.alive &&
        this.distanceTo(other.state) <= this.proximityRadius
    )
  }

  public distanceTo(other: AgentState): number {
    const dx = this.state.position.x - other.position.x
    const dy = this.state.position.y - other.position.y
    return Math.sqrt(dx * dx + dy * dy)
  }

  public observeEvent(event: SimulationEvent): void {
    if (!this.state.alive) return

    const distance = this.getEventDistance(event)
    if (distance <= this.proximityRadius * 2) {
      this.addRecentMemory(event)
    }
  }

  private getEventDistance(event: SimulationEvent): number {
    const agentPos =
      event.agentId === this.state.id
        ? this.state.position
        : this.simManager.getAgent(event.agentId)?.position ?? { x: 0, y: 0 }

    const dx = this.state.position.x - agentPos.x
    const dy = this.state.position.y - agentPos.y
    return Math.sqrt(dx * dx + dy * dy)
  }

  public addRecentMemory(event: SimulationEvent): void {
    this.state.memory.recent.push(event)
    const maxRecent = 30
    if (this.state.memory.recent.length > maxRecent) {
      this.state.memory.recent.shift()
    }
  }

  public takeDamage(amount: number, attackerId: string): boolean {
    if (!this.state.alive) return false

    this.state.health -= amount
    this.state.emotionalState = EmotionalState.AFRAID

    if (this.state.health <= 0) {
      this.state.health = 0
      this.state.alive = false
      this.state.path = []
      this.state.pathIndex = 0

      this.simManager.logEvent({
        type: 'death',
        agentId: this.state.id,
        actionType: ActionType.ATTACK,
        targetId: attackerId,
        outcome: 'agent_died',
        description: `${this.state.name} has been killed by ${attackerId}`,
        causationIds: [],
        worldStateDelta: { agentHealth: 0, agentAlive: false },
        observers: [],
      })

      return true
    }

    return false
  }

  public heal(amount: number): void {
    if (!this.state.alive) return
    this.state.health = Math.min(this.state.maxHealth, this.state.health + amount)
  }

  public rest(): void {
    this.state.needs.energy = Math.min(100, this.state.needs.energy + 30)
    this.state.needs.hunger = Math.max(0, this.state.needs.hunger - 10)
    this.state.emotionalState = EmotionalState.NEUTRAL
  }

  public eat(): void {
    this.state.needs.hunger = Math.min(100, this.state.needs.hunger + 40)
    this.state.emotionalState = EmotionalState.HAPPY
  }

  public socialize(): void {
    this.state.needs.social = Math.min(100, this.state.needs.social + 25)
    this.state.emotionalState = EmotionalState.HAPPY
  }

  public startConversation(partnerId: string, partnerName: string, topic: string): string {
    const convId = `conv_${this.state.id}_${partnerId}_${Date.now()}`
    const conv: ConversationState = {
      id: convId,
      participants: [this.state.id, partnerId],
      exchanges: [],
      topic,
      createdAt: this.simManager.getSimTime(),
      lastActiveAt: this.simManager.getSimTime(),
      maxTurns: 6,
    }
    this.conversations.set(convId, conv)
    this.state.activeConversationId = convId
    return convId
  }

  public getActiveConversation(): ConversationState | null {
    if (!this.state.activeConversationId) return null
    return this.conversations.get(this.state.activeConversationId) ?? null
  }

  public addConversationExchange(partnerId: string, partnerName: string, dialogue: string): void {
    const conv = this.getActiveConversation()
    if (!conv) return

    const exchange: ConversationExchange = {
      speakerId: partnerId,
      speakerName: partnerName,
      dialogue,
      timestamp: this.simManager.getSimTime(),
    }
    conv.exchanges.push(exchange)
    conv.lastActiveAt = this.simManager.getSimTime()

    if (conv.exchanges.length > 10) {
      conv.exchanges.shift()
    }
  }

  public closeActiveConversation(): void {
    if (!this.state.activeConversationId) return
    this.conversations.delete(this.state.activeConversationId)
    this.state.activeConversationId = null
  }

  public isConversationActive(): boolean {
    return this.state.activeConversationId !== null && this.conversations.has(this.state.activeConversationId)
  }

  public getConversationPartnerId(): string | null {
    const conv = this.getActiveConversation()
    if (!conv) return null
    return conv.participants.find((id) => id !== this.state.id) ?? null
  }

  public shouldCloseConversation(simTime: number): boolean {
    const conv = this.getActiveConversation()
    if (!conv) return false

    if (conv.exchanges.length >= conv.maxTurns) return true
    if (simTime - conv.lastActiveAt > 60) return true

    return false
  }

  public getObservations(allAgents: Agent[]): string {
    const nearby = this.getNearbyAgents(allAgents)
    const building = this.world.getBuildingAt(
      Math.round(this.state.position.x),
      Math.round(this.state.position.y)
    )

    let obs = `Time: ${this.simManager.getDayNight().hour}:${Math.floor(this.simManager.getDayNight().minute).toString().padStart(2, '0')}\n`
    obs += `Location: ${building?.name ?? 'Outside'}\n`
    obs += `Health: ${this.state.health}/${this.state.maxHealth}\n`

    if (nearby.length > 0) {
      obs += `Nearby agents: ${nearby.map((a) => a.state.name).join(', ')}\n`
    }


    return obs
  }

  public static createAgentPool(
    count: number,
    world: World,
    simManager: SimulationManager
  ): Agent[] {
    const agents: Agent[] = []
    const usedNames = new Set<string>()

    const availableNames = [...FIRST_NAMES]
    const availableLastNames = [...LAST_NAMES]

    for (let i = 0; i < count; i++) {
      const firstName = availableNames[i % availableNames.length]
      const lastName = availableLastNames[i % availableLastNames.length]
      const name = `${firstName} ${lastName}`

      if (usedNames.has(name)) continue
      usedNames.add(name)

      const id = `agent_${i}`
      const agent = new Agent(id, name, world, simManager)
      agents.push(agent)
      simManager.addAgent(agent.state)
    }

    return agents
  }
}
