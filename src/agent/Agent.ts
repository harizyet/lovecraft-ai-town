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
  AgentBeliefSystem,
  PoliticalCampId,
} from '@/types'
import { World } from '@/world/World'
import { SimulationManager } from '@/simulation/SimulationManager'
import { AStarPathfinder } from '@/utils/AStarPathfinder'

const FIRST_NAMES = [
  'William',
  'John',
  'Richard',
  'Robert',
  'Henry',
  'Thomas',
  'Geoffrey',
  'Walter',
  'Hugh',
  'Roger',
  'Edmund',
  'Gilbert',
  'Simon',
  'Nicholas',
  'Martin',
  'Stephen',
  'Peter',
  'Adam',
  'Matthew',
  'Philip',
  'Roland',
  'Oswin',
  'Edwin',
  'Godfrey',
  'Alice',
  'Matilda',
  'Agnes',
  'Margaret',
  'Joan',
  'Isabel',
  'Eleanor',
  'Edith',
  'Emma',
  'Beatrice',
  'Cecily',
  'Juliana',
  'Maud',
  'Anne',
  'Katherine',
  'Elizabeth',
  'Rose',
  'Marion',
  'Aveline',
  'Constance',
  'Mabel',
  'Sybil',
  'Adela',
  'Emmeline',
]

const LAST_NAMES = [
  // Occupational
  'Smith',
  'Baker',
  'Miller',
  'Fletcher',
  'Cooper',
  'Carter',
  'Fisher',
  'Taylor',
  'Weaver',
  'Mason',
  'Carpenter',
  'Shepherd',
  'Cook',
  'Brewer',
  'Tanner',
  'Hunter',
  'Forester',
  'Turner',
  'Wright',
  'Chandler',

  // Geographic / settlement
  'Hill',
  'Wood',
  'Ford',
  'Brook',
  'Field',
  'Marsh',
  'Green',
  'Stone',
  'Vale',
  'Meadow',
  'Bridge',
  'Well',
  'Grove',
  'Heath',
  'Dale',
  'Atwood',
  'Underhill',
  'Westbrook',
  'Eastwood',
  'Northfield',

  // Descriptive / medieval-fantasy style
  'Strong',
  'Long',
  'Little',
  'White',
  'Black',
  'Brown',
  'Grey',
  'Goodman',
  'Hardy',
  'Swift',
  'Stern',
  'Fair',
  'Young',
  'Elder',

  // Slightly more atmospheric
  'Ash',
  'Thorn',
  'Hawke',
  'Flint',
  'Oakley',
  'Raven',
  'Wolf',
  'Fox',
  'Crow',
  'Hart',
  'Rowan',
  'Blackwood',
  'Oakwood',
  'Ashford',
  'Redbrook',
  'Greenwood',
]

const JOBS = [
  'Blacksmith',
  'Carpenter',
  'Merchant',
  'Town Guard',
  'Healer',
  'Steward',
  'Innkeeper',
  'Farmer',
  'Priest',
]

const JOB_BUILDINGS: Record<string, string[]> = {
  Blacksmith: ['smithy'],
  Carpenter: ['carpenter_workshop'],
  Merchant: ['market'],
  'Town Guard': ['guardhouse', 'town_square'],
  Healer: ['apothecary'],
  Steward: ['manor'],
  Innkeeper: ['tavern'],
  Farmer: ['farm'],
  Priest: ['church'],
}

const WEALTHY_JOBS = new Set(['Merchant', 'Steward', 'Innkeeper'])
const MODEST_JOBS = new Set(['Farmer', 'Carpenter'])

const POLITICAL_CAMPS: Record<PoliticalCampId, { id: PoliticalCampId; name: string }> = {
  gentry: { id: 'gentry', name: 'The Gentry' },
  commons: { id: 'commons', name: 'The Commons' },
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
  private moveSpeed: number
  private proximityRadius: number
  public conversations: Map<string, ConversationState>
  public getWorld(): World { return this.world }

  constructor(
    id: string,
    name: string,
    world: World,
    simManager: SimulationManager,
    assignedJob?: string
  ) {
    this.world = world
    this.simManager = simManager
    this.pathfinder = new AStarPathfinder(world)
    this.moveSpeed = 2.5
    this.proximityRadius = 4
    this.conversations = new Map()

    const personality = this.generatePersonality()
    const job = assignedJob ?? pickRandom(JOBS)
    const spawnPos = this.findSpawnPosition()
    const religiousStance: AgentBeliefSystem['religiousStance'] = 'undecided'

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
      wealth: this.generateWealth(job),
      beliefSystem: {
        religiousStance,
        faith: Math.round(randomBetween(5, 20)),
        deities: [],
      },
      religiousStanceRevealed: true,
      cultRequests: [],
      cultAgendas: [],
      formerCults: [],
      cultEnemies: [],
      knownCultGroups: [],
      secretAffiliationKnowledge: [],
      emotionalState: EmotionalState.NEUTRAL,
      sanity: 100,
      forbiddenKnowledge: [],
      lastActionTime: 0,
      path: [],
      pathIndex: 0,
      activeConversationId: null,
      lastReasoning: '',
    }
  }

  private generateWealth(job: string): number {
    const base = WEALTHY_JOBS.has(job) ? [55, 100] : MODEST_JOBS.has(job) ? [10, 55] : [25, 80]
    return Math.round(randomBetween(base[0], base[1]))
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

    this.updateNeeds(deltaMs)
    if (!this.isConversationActive()) {
      this.updateMovement(deltaMs, simTime)
    }
  }

  public isInsane(): boolean {
    return this.state.alive && (this.state.sanity <= 20 || !!this.state.permanentInsanity)
  }

  public isObsessed(): boolean {
    return this.state.alive && !!this.state.obsession
  }

  private updateNeeds(deltaMs: number): void {
    const decayRate = 0.000015
    this.state.needs.hunger = Math.min(
      100,
      this.state.needs.hunger + deltaMs * decayRate * 0.8
    )
    this.state.needs.energy = Math.max(
      0,
      this.state.needs.energy - deltaMs * decayRate * 0.5
    )
    this.state.needs.social = Math.max(
      0,
      this.state.needs.social - deltaMs * decayRate * 0.3
    )

    if (this.state.needs.hunger >= 100) {
      this.takeDamage(deltaMs * 0.000005, 'starvation')
    }
    if (this.state.needs.energy <= 0) {
      this.takeDamage(deltaMs * 0.000003, 'exhaustion')
    }
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
    if (moveAmount >= dist) {
      this.state.position.x = target.x
      this.state.position.y = target.y
      this.state.pathIndex++
      return
    }
    const nx = dx / dist
    const ny = dy / dist

    this.state.position.x += nx * moveAmount
    this.state.position.y += ny * moveAmount
  }

  public moveTo(targetX: number, targetY: number): boolean {
    if (!this.state.alive) return false

    const destination = this.resolveUnoccupiedDestination(targetX, targetY)
    const path = this.pathfinder.findPath(
      { x: Math.round(this.state.position.x), y: Math.round(this.state.position.y) },
      destination
    )

    if (path.length > 0) {
      // A* includes the rounded start tile. Keeping it can pull an agent that
      // is already between tiles backward whenever its route is refreshed.
      this.state.path = path.slice(1)
      this.state.pathIndex = 0
      return true
    }
    return false
  }

  // Many callers (conversation approach, court/policy gathering, investigation,
  // pursuit) send several agents toward the same coordinate, or toward another
  // agent's exact tile. Retarget onto the nearest free, walkable tile so
  // agents end up standing next to each other instead of stacked on top.
  // Reserving each other agent's in-flight path destination (not just their
  // current tile) is what makes several agents converging in the same tick
  // fan out around a shared rally point instead of all landing on it.
  private resolveUnoccupiedDestination(targetX: number, targetY: number): Vector2 {
    const tx = Math.round(targetX)
    const ty = Math.round(targetY)
    const occupied = new Set<string>()
    for (const other of this.simManager.getAgentsArray()) {
      if (!other.alive || other.id === this.state.id) continue
      occupied.add(`${Math.round(other.position.x)},${Math.round(other.position.y)}`)
      const destination = other.path[other.path.length - 1]
      if (destination) occupied.add(`${Math.round(destination.x)},${Math.round(destination.y)}`)
    }
    if (!occupied.has(`${tx},${ty}`)) return { x: targetX, y: targetY }

    for (let radius = 1; radius <= 6; radius++) {
      const candidates: Vector2[] = []
      for (let dx = -radius; dx <= radius; dx++) {
        for (let dy = -radius; dy <= radius; dy++) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== radius) continue
          const cx = tx + dx
          const cy = ty + dy
          if (this.world.isWalkable(cx, cy) && !occupied.has(`${cx},${cy}`)) {
            candidates.push({ x: cx, y: cy })
          }
        }
      }
      if (candidates.length > 0) {
        candidates.sort((a, b) => {
          const da = (a.x - tx) * (a.x - tx) + (a.y - ty) * (a.y - ty)
          const db = (b.x - tx) * (b.x - tx) + (b.y - ty) * (b.y - ty)
          return da - db
        })
        return candidates[0]
      }
    }
    return { x: targetX, y: targetY }
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
    if (this.state.demon) {
      const attacker = this.simManager.getAgent(attackerId)
      if (!attacker?.outsider || !['knight', 'inquisitor'].includes(attacker.outsider.kind)) {
        return false
      }
    }

    this.state.health -= amount
    const isNeedsDamage = attackerId === 'starvation' || attackerId === 'exhaustion'
    if (!isNeedsDamage) {
      this.state.emotionalState = EmotionalState.AFRAID
    }

    if (this.state.health <= 0) {
      this.state.health = 0
      this.state.alive = false
      this.state.path = []
      this.state.pathIndex = 0

      const deathEvent = {
        type: 'death' as const,
        agentId: this.state.id,
        actionType: ActionType.ATTACK,
        targetId: attackerId,
        outcome: 'agent_died',
        description: `${this.state.name} has been killed by ${attackerId}`,
        causationIds: [],
        worldStateDelta: { agentHealth: 0, agentAlive: false },
        observers: [],
      }
      const eventId = this.simManager.logEvent(deathEvent)
      this.addRecentMemory({ ...deathEvent, id: eventId, timestamp: this.simManager.getSimTime() })

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
    this.heal(5)
    this.state.emotionalState = EmotionalState.NEUTRAL
  }

  public sleep(deltaMs: number): void {
    if (!this.state.alive) return
    const recoveryRate = 0.0002
    this.state.needs.energy = Math.min(
      100,
      this.state.needs.energy + deltaMs * recoveryRate
    )
    this.heal(deltaMs * 0.000005)
    this.state.emotionalState = this.state.needs.energy >= 90
      ? EmotionalState.NEUTRAL
      : EmotionalState.TIRED
  }

  public eat(): void {
    this.state.needs.hunger = Math.max(0, this.state.needs.hunger - 40)
    this.heal(10)
    this.state.wealth = Math.max(0, this.state.wealth - 10)
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
    if (simTime - conv.lastActiveAt > 5 * 60_000) return true

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
    const weather = this.simManager.getWeather()
    obs += `Weather: ${weather.condition}, ${weather.temperatureC}°C\n`
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
    const shuffledJobs = [...JOBS]
    for (let i = shuffledJobs.length - 1; i > 0; i--) {
      const swapIndex = Math.floor(Math.random() * (i + 1))
        ;[shuffledJobs[i], shuffledJobs[swapIndex]] = [shuffledJobs[swapIndex], shuffledJobs[i]]
    }

    const homes = Array.from(world.buildings.values()).filter(
      (b) => b.type === 'home'
    )

    for (let i = 0; i < count; i++) {
      const firstName = availableNames[i % availableNames.length]
      const lastName = availableLastNames[i % availableLastNames.length]
      const name = `${firstName} ${lastName}`

      if (usedNames.has(name)) continue
      usedNames.add(name)

      const id = `agent_${i}`
      const assignedJob = shuffledJobs[i % shuffledJobs.length]
      const agent = new Agent(id, name, world, simManager, assignedJob)
      
      if (homes.length > 0) {
        agent.state.homeId = homes[i % homes.length].id
      }

      agents.push(agent)
      simManager.addAgent(agent.state)
    }

    if (agents.length > 0) {
      const initialAtheist = agents.reduce((lowestFaith, candidate) =>
        candidate.state.beliefSystem.faith < lowestFaith.state.beliefSystem.faith
          ? candidate
          : lowestFaith
      )
      initialAtheist.state.beliefSystem.religiousStance = 'atheist'
      initialAtheist.state.religiousStanceRevealed = false
      initialAtheist.state.beliefSystem.faith = Math.min(5, initialAtheist.state.beliefSystem.faith)
      initialAtheist.state.beliefSystem.deities = []
      initialAtheist.state.cultConversionProgress = {}
    }

    Agent.assignPoliticalCamps(agents, 0)

    return agents
  }

  /**
   * Splits agents into two political camps of roughly equal size, ranked by
   * wealth (wealthier half -> Gentry, poorer half -> Commons). Only agents
   * without an existing camp assignment are (re)placed, so restored saves
   * keep prior membership and only backfill agents missing one.
   */
  public static assignPoliticalCamps(agents: Agent[], atMinute: number): void {
    const unassigned = agents.filter((agent) => !agent.state.politicalCamp)
    if (unassigned.length === 0) return

    const sorted = [...unassigned].sort((a, b) => b.state.wealth - a.state.wealth)
    const gentryCount = Math.ceil(sorted.length / 2)

    sorted.forEach((agent, index) => {
      const campId: PoliticalCampId = index < gentryCount ? 'gentry' : 'commons'
      agent.state.politicalCamp = { ...POLITICAL_CAMPS[campId], joinedAtMinute: atMinute }
    })
  }

  public static restore(
    state: AgentState,
    conversations: ConversationState[],
    world: World,
    simManager: SimulationManager
  ): Agent {
    const agent = new Agent(state.id, state.name, world, simManager, state.currentJob)
    state.beliefSystem.religiousStance ??= 'undecided'
    state.religiousStanceRevealed ??= true
    state.cultConversionProgress ??= {}
    state.cultRequests ??= []
    state.cultAgendas ??= []
    state.formerCults ??= []
    state.cultEnemies ??= []
    state.knownCultGroups ??= []
    state.secretAffiliationKnowledge ??= []
    state.wealth ??= agent.state.wealth
    state.sanity ??= 100
    state.forbiddenKnowledge ??= []
    agent.state = state
    agent.conversations = new Map(
      conversations.map((conversation) => [conversation.id, conversation])
    )
    return agent
  }
}
