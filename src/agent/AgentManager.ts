import { Agent } from '@/agent/Agent'
import { World } from '@/world/World'
import { SimulationManager } from '@/simulation/SimulationManager'
import { ActionType, EmotionalState, SimulationEvent, AgentAction, BuildingType } from '@/types'
import { AIProvider } from '@/ai/AIProvider'
import { PromptBuilder } from '@/ai/PromptBuilder'
import { EventBus } from '@/interaction/EventBus'
import { AgentInteraction } from '@/interaction/AgentInteraction'
import { WorldInteraction } from '@/interaction/WorldInteraction'
import { ConversationManager } from '@/interaction/ConversationManager'

const EMOTION_MAP: Record<string, EmotionalState> = {
  happy: EmotionalState.HAPPY,
  neutral: EmotionalState.NEUTRAL,
  sad: EmotionalState.SAD,
  angry: EmotionalState.ANGRY,
  afraid: EmotionalState.AFRAID,
  excited: EmotionalState.EXCITED,
  tired: EmotionalState.TIRED,
  hungry: EmotionalState.HUNGRY,
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
  build: ActionType.BUILD,
}

export class AgentManager {
  private agents: Agent[]
  private world: World
  private simManager: SimulationManager
  private decisionInterval: number
  private decisionTimer: number
  private aiProvider: AIProvider | null
  private promptBuilder: PromptBuilder
  private pendingDecisions: Map<string, Promise<void>>
  private summarizationTimer: number
  private lastActions: Map<string, { action: string; timestamp: number }>

  private eventBus: EventBus
  private agentInteraction: AgentInteraction
  private worldInteraction: WorldInteraction
  private conversationManager: ConversationManager

  constructor(
    world: World,
    simManager: SimulationManager,
    decisionInterval: number,
    aiProvider: AIProvider | null = null,
    sharedEventBus: EventBus | null = null
  ) {
    this.agents = []
    this.world = world
    this.simManager = simManager
    this.decisionInterval = decisionInterval
    this.decisionTimer = 0
    this.aiProvider = aiProvider
    this.promptBuilder = new PromptBuilder()
    this.pendingDecisions = new Map()
    this.summarizationTimer = 0
    this.lastActions = new Map()

    this.eventBus = sharedEventBus ?? new EventBus()
    this.agentInteraction = new AgentInteraction(this.eventBus)
    this.worldInteraction = new WorldInteraction(world, this.eventBus)
    this.conversationManager = new ConversationManager(this.eventBus)

    this.setupEventListeners()
  }

  private setupEventListeners(): void {
    this.eventBus.on(ActionType.ATTACK, (event) => {
      console.log(`[EVENT] ${event.description}`)
    })

    this.eventBus.on(ActionType.STEAL, (event) => {
      console.log(`[EVENT] ${event.description}`)
    })

    this.eventBus.on(ActionType.DESTROY, (event) => {
      console.log(`[EVENT] ${event.description}`)
    })
  }

  public initialize(count: number): void {
    this.agents = Agent.createAgentPool(count, this.world, this.simManager)
    console.log(`Created ${this.agents.length} agents`)
    for (const agent of this.agents) {
      console.log(
        `  - ${agent.state.name} (${agent.state.currentJob}) at (${Math.round(agent.state.position.x)}, ${Math.round(agent.state.position.y)})`
      )
    }

    if (this.aiProvider?.isAvailable()) {
      console.log('[AgentManager] LLM decisions enabled')
    } else {
      console.warn('[AgentManager] LLM not available — agents will not make decisions')
    }
  }

  public update(deltaMs: number, simTime: number): void {
    this.decisionTimer += deltaMs
    this.summarizationTimer += deltaMs

    for (const agent of this.agents) {
      agent.update(deltaMs, simTime)
      this.conversationManager.autoCloseInactiveConversations(agent, this.agents, simTime)
    }

    if (this.decisionTimer >= this.decisionInterval) {
      this.decisionTimer = 0
      this.makeDecisions()
    }

    if (this.summarizationTimer >= this.simManager.getConfig().summaryInterval * 1000) {
      this.summarizationTimer = 0
      this.summarizeMemories()
    }
  }

  private async makeDecisions(): Promise<void> {
    await this.makeLLMDecisions()
  }

  private async makeLLMDecisions(): Promise<void> {
    const activeAgents = this.agents.filter(
      (a) => a.state.alive && !this.pendingDecisions.has(a.state.id)
    )

    for (const agent of activeAgents) {
      const promise = (async () => {
        const lastAction = this.lastActions.get(agent.state.id)
        const conversationContext = this.conversationManager.getConversationContext(agent, this.agents)
        const prompt = this.promptBuilder.buildDecisionPrompt(agent, this.agents, lastAction, conversationContext)
        const decision = await this.aiProvider!.decide(agent.state.name, prompt)
        this.executeLLMDecision(agent, decision)
      })()

      this.pendingDecisions.set(agent.state.id, promise)
      promise.finally(() => this.pendingDecisions.delete(agent.state.id))
    }
  }

  private executeLLMDecision(agent: Agent, decision: AgentAction): void {
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
            ? nearby.find((a) => a.state.name === decision.target)
            : nearby[Math.floor(Math.random() * nearby.length)]
          if (targetAgent && decision.dialogue) {
            const simTime = this.simManager.getSimTime()
            const status = this.conversationManager.checkConversationEligibility(agent, targetAgent, simTime)

            if (status === 'tooFar') {
              description = `${targetAgent.state.name} is too far to talk to`
            } else if (status === 'cooldown') {
              description = 'Too soon to talk to them again'
            } else if (status === 'active') {
              this.conversationManager.addTurn(agent, targetAgent, decision.dialogue, simTime)
              this.agentInteraction.handleConversation(agent, targetAgent, decision.dialogue)
              targetId = targetAgent.state.id
              description = `Continuing conversation with ${targetAgent.state.name}: ${decision.dialogue}`
            } else {
              const topic = decision.reasoning || 'general'
              this.conversationManager.initiateConversation(agent, targetAgent, decision.dialogue, topic, simTime)
              this.agentInteraction.handleConversation(agent, targetAgent, decision.dialogue)
              targetId = targetAgent.state.id
              description = `Started conversation with ${targetAgent.state.name}: ${decision.dialogue}`
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

      case 'rest':
      case 'sleep': {
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
          const targetAgent = nearby[Math.floor(Math.random() * nearby.length)]
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

      case 'build': {
        agent.state.path = []
        agent.state.pathIndex = 0
        const buildingTypes = Object.values(BuildingType)
        const chosenType = buildingTypes[Math.floor(Math.random() * buildingTypes.length)]
        const built = this.worldInteraction.handleBuild(agent, chosenType)
        description = built ? `Built a ${chosenType}` : 'Could not build here'
        break
      }

      case 'idle':
      default:
        agent.state.path = []
        agent.state.pathIndex = 0
        description = decision.reasoning || 'Idling'
        break
    }

    this.logAction(agent, actionType, targetId, description)

    this.lastActions.set(agent.state.id, { action: decision.action, timestamp: this.simManager.getSimTime() })

    if (decision.dialogue) {
      const nearby = agent.getNearbyAgents(this.agents)
      if (nearby.length > 0) {
        console.log(`[${agent.state.name}]: "${decision.dialogue}"`)
      }
    }
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



  private async summarizeMemories(): Promise<void> {
    if (!this.aiProvider?.isAvailable()) return

    for (const agent of this.agents.filter((a) => a.state.alive)) {
      const eventsText = agent.state.memory.recent
        .map((e) => `[${e.type}] ${e.description}`)
        .join('\n')

      if (eventsText.length > 200) {
        const summary = await this.aiProvider!.summarizeMemory(
          agent.state.name,
          eventsText
        )
        agent.state.memory.summary = summary
      }
    }
  }

  private logAction(
    agent: Agent,
    actionType: ActionType,
    targetId: string | null,
    description: string
  ): void {
    const eventId = this.simManager.logEvent({
      type: actionType,
      agentId: agent.state.id,
      actionType,
      targetId: targetId ?? undefined,
      outcome: 'completed',
      description,
      causationIds: [],
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
      causationIds: [],
      worldStateDelta: {},
      observers: [],
    })
  }

  private findBuildingOfType(
    agent: Agent,
    type: string
  ): import('@/types').Building | null {
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
      Teacher: 'home',
      Mechanic: 'workshop',
      'Retail Worker': 'shop',
      'Police Officer': 'town_square',
      Nurse: 'church',
      Accountant: 'church',
      Chef: 'restaurant',
      Paramedic: 'park',
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

  public getEventBus(): EventBus {
    return this.eventBus
  }
}
