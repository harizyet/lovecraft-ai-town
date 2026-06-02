import { SimulationConfig, DayNightCycle, SimulationEvent, ActionType, AgentState } from '@/types'
import { World } from '@/world/World'
import { Camera } from '@/rendering/Camera'
import { Renderer } from '@/rendering/Renderer'
import { AgentManager } from '@/agent/AgentManager'
import { LMStudioProvider, LMStudioConfig } from '@/ai/AIProvider'
import { DebugOverlay } from '@/rendering/DebugOverlay'
import { EventBus } from '@/interaction/EventBus'

export class SimulationManager {
  private world: World
  private camera: Camera
  private renderer: Renderer
  private agentManager: AgentManager | null
  private debugOverlay: DebugOverlay
  private eventBus: EventBus
  private config: SimulationConfig

  private agents: Map<string, AgentState>
  private events: SimulationEvent[]
  private eventCounter: number

  private running: boolean
  private paused: boolean
  private speedMultiplier: number
  private lastTick: number
  private simTime: number
  private debugUpdateTimer: number

  private dayNight: DayNightCycle
  private selectedAgentId: string | undefined
  private keys: Map<string, boolean>

  constructor(config: SimulationConfig) {
    this.config = config
    this.world = new World(config.mapWidth, config.mapHeight)
    this.camera = new Camera()
    this.renderer = new Renderer(
      document.getElementById('gameCanvas') as HTMLCanvasElement,
      this.world,
      this.camera,
      config
    )

    this.agentManager = null
    this.agents = new Map()
    this.events = []
    this.eventCounter = 0
    this.running = false
    this.paused = false
    this.speedMultiplier = 1
    this.lastTick = 0
    this.simTime = 0
    this.debugUpdateTimer = 0
    this.selectedAgentId = undefined
    this.keys = new Map()

    this.dayNight = {
      hour: 6,
      minute: 0,
      day: 1,
      isDaytime: true,
      brightness: 1,
    }

    this.eventBus = new EventBus()
    this.debugOverlay = new DebugOverlay(this.eventBus)

    this.setupInput()
    this.setupDebugControls()
  }

  private setupInput(): void {
    window.addEventListener('keydown', (e) => {
      this.keys.set(e.key, true)

      if (e.key === ' ') {
        e.preventDefault()
        this.paused = !this.paused
      }

      if (e.key === '=' || e.key === '+') {
        this.camera.zoomIn()
      }
      if (e.key === '-') {
        this.camera.zoomOut()
      }

      if (e.key >= '1' && e.key <= '9') {
        const idx = parseInt(e.key) - 1
        const agentList = this.agentManager?.getAgents() ?? []
        if (idx < agentList.length) {
          this.selectAgent(agentList[idx].state.id)
        }
      }

      if (e.key === '0') {
        this.selectAgent(undefined)
      }
    })

    window.addEventListener('keyup', (e) => {
      this.keys.set(e.key, false)
    })

    const canvas = document.getElementById('gameCanvas') as HTMLCanvasElement
    canvas.addEventListener('click', (e) => {
      this.handleClick(e)
    })
  }

  private setupDebugControls(): void {
    window.addEventListener('debug-pause', () => {
      this.paused = !this.paused
    })

    window.addEventListener('debug-speed', () => {
      this.speedMultiplier = this.speedMultiplier >= 4 ? 1 : this.speedMultiplier + 1
    })
  }

  private handleClick(e: MouseEvent): void {
    if (!this.agentManager) return

    const tileSize = this.config.tileSize
    const worldPos = this.camera.screenToWorld(
      e.clientX,
      e.clientY,
      this.canvasWidth(),
      this.canvasHeight()
    )

    const tileX = Math.floor(worldPos.x / tileSize)
    const tileY = Math.floor(worldPos.y / tileSize)

    for (const agent of this.agentManager.getAgents()) {
      const agentTileX = Math.round(agent.state.position.x)
      const agentTileY = Math.round(agent.state.position.y)
      if (
        Math.abs(tileX - agentTileX) <= 1 &&
        Math.abs(tileY - agentTileY) <= 1
      ) {
        this.selectAgent(agent.state.id)
        return
      }
    }
  }

  private canvasWidth(): number {
    return (this.renderer as any).canvas?.width ?? window.innerWidth
  }

  private canvasHeight(): number {
    return (this.renderer as any).canvas?.height ?? window.innerHeight
  }

  public selectAgent(agentId: string | undefined): void {
    this.selectedAgentId = agentId
    this.renderer.setSelectedAgent(agentId)
    this.debugOverlay.setSelectedAgent(agentId)

    if (agentId && this.agentManager) {
      const agent = this.agentManager.getAgentState(agentId)
      if (agent) {
        this.camera.setTarget(agentId)
        this.camera.followPosition(agent.position, this.config.tileSize)
      }
    } else {
      this.camera.setTarget(undefined)
    }
  }

  public initializeAgents(count: number): void {
    const lmStudioConfig: LMStudioConfig = {
      endpoint: this.config.llmEndpoint,
      model: this.config.llmModel,
      temperature: 0.8,
      timeout: 1800000,
    }

    const aiProvider = new LMStudioProvider(lmStudioConfig)

    this.agentManager = new AgentManager(
      this.world,
      this,
      this.config.decisionInterval,
      aiProvider,
      this.eventBus
    )
    this.agentManager.initialize(count)
  }

  start(): void {
    this.world.generate()
    this.initializeAgents(this.config.agentCount)
    this.running = true
    this.lastTick = performance.now()
    this.gameLoop()
  }

  stop(): void {
    this.running = false
  }

  private gameLoop = (): void => {
    if (!this.running) return

    const now = performance.now()
    const delta = now - this.lastTick

    if (delta >= this.config.tickRate) {
      this.lastTick = now

      if (!this.paused) {
        const adjustedDelta = delta * this.speedMultiplier
        this.simTime += adjustedDelta

        this.updateCameraMovement(adjustedDelta)
        this.updateDayNight(adjustedDelta)

        if (this.agentManager) {
          this.agentManager.update(adjustedDelta, this.simTime)
        }
      }

      this.updateSelectedAgentFollow()
      this.camera.update()
      this.renderer.render(this.getAgentsArray(), this.dayNight)

      this.debugUpdateTimer += delta
      if (this.debugUpdateTimer >= 500) {
        this.debugUpdateTimer = 0
        this.updateDebugOverlay()
      }
    }

    requestAnimationFrame(this.gameLoop)
  }

  private updateDebugOverlay(): void {
    if (!this.debugOverlay.isVisible()) return
    if (!this.agentManager) return

    this.debugOverlay.updateEventLog()
    this.debugOverlay.updateAgentStates(this.getAgentsArray())
    this.debugOverlay.updateWorldState(
      this.dayNight,
      this.world.buildings.size,
      this.events.length
    )
  }

  private updateSelectedAgentFollow(): void {
    if (this.selectedAgentId && this.agentManager) {
      const agent = this.agentManager.getAgentState(this.selectedAgentId)
      if (agent) {
        this.camera.followPosition(agent.position, this.config.tileSize)
      }
    }
  }

  private updateCameraMovement(deltaMs: number): void {
    if (this.selectedAgentId) return

    const speed = 0.15 * (deltaMs / 16) * this.config.tileSize
    let dx = 0
    let dy = 0

    if (this.keys.get('w') || this.keys.get('ArrowUp')) dy -= speed
    if (this.keys.get('s') || this.keys.get('ArrowDown')) dy += speed
    if (this.keys.get('a') || this.keys.get('ArrowLeft')) dx -= speed
    if (this.keys.get('d') || this.keys.get('ArrowRight')) dx += speed

    if (dx !== 0 || dy !== 0) {
      this.camera.followPosition(
        {
          x: (this.camera.position.x + dx) / this.config.tileSize,
          y: (this.camera.position.y + dy) / this.config.tileSize,
        },
        this.config.tileSize
      )
    }
  }

  private updateDayNight(deltaMs: number): void {
    const simSecondsPerMs = 0.01
    const secondsElapsed = deltaMs * simSecondsPerMs

    this.dayNight.minute += secondsElapsed / 60

    if (this.dayNight.minute >= 60) {
      this.dayNight.minute -= 60
      this.dayNight.hour++
    }

    if (this.dayNight.hour >= 24) {
      this.dayNight.hour = 0
      this.dayNight.day++
    }

    this.dayNight.isDaytime =
      this.dayNight.hour >= 6 && this.dayNight.hour < 20

    const dawnStart = 5
    const dawnEnd = 7
    const duskStart = 17
    const duskEnd = 19

    const hour = this.dayNight.hour + this.dayNight.minute / 60

    if (hour >= dawnEnd && hour <= duskStart) {
      this.dayNight.brightness = 1
    } else if (hour >= duskStart && hour <= duskEnd) {
      this.dayNight.brightness = 1 - (hour - duskStart)
    } else if (hour >= 19 || hour <= dawnStart) {
      this.dayNight.brightness = 0.3
    } else if (hour >= dawnStart && hour <= dawnEnd) {
      this.dayNight.brightness = 0.3 + (hour - dawnStart) * 0.7
    } else {
      this.dayNight.brightness = 0.3
    }
  }

  getWorld(): World {
    return this.world
  }

  getCamera(): Camera {
    return this.camera
  }

  getAgentsArray(): AgentState[] {
    return Array.from(this.agents.values())
  }

  getAgent(id: string): AgentState | undefined {
    return this.agents.get(id)
  }

  addAgent(agent: AgentState): void {
    this.agents.set(agent.id, agent)
  }

  removeAgent(id: string): void {
    this.agents.delete(id)
  }

  hasAgent(id: string): boolean {
    return this.agents.has(id)
  }

  getActiveAgents(): AgentState[] {
    return Array.from(this.agents.values()).filter((a) => a.alive)
  }

  logEvent(event: Omit<SimulationEvent, 'id' | 'timestamp'>): string {
    const eventId = `event_${this.eventCounter++}`
    const fullEvent: SimulationEvent = {
      ...event,
      id: eventId,
      timestamp: this.simTime,
    }
    this.events.push(fullEvent)
    this.eventBus.emit({
      type: event.type,
      agentId: event.agentId,
      actionType: event.actionType,
      targetId: event.targetId,
      outcome: event.outcome,
      description: event.description,
      causationIds: event.causationIds,
      worldStateDelta: event.worldStateDelta,
      observers: event.observers,
    })
    return eventId
  }

  getEvents(): SimulationEvent[] {
    return this.events
  }

  getEventsByAgent(agentId: string): SimulationEvent[] {
    return this.events.filter((e) => e.agentId === agentId)
  }

  getEventsByType(actionType: ActionType): SimulationEvent[] {
    return this.events.filter((e) => e.actionType === actionType)
  }

  getSimTime(): number {
    return this.simTime
  }

  getDayNight(): DayNightCycle {
    return this.dayNight
  }

  getConfig(): SimulationConfig {
    return this.config
  }

  isPaused(): boolean {
    return this.paused
  }

  getSelectedAgentId(): string | undefined {
    return this.selectedAgentId
  }

  getDebugOverlay(): DebugOverlay {
    return this.debugOverlay
  }

  getEventBus(): EventBus {
    return this.eventBus
  }
}
