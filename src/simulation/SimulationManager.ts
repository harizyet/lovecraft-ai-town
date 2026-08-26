import {
  SimulationConfig,
  DayNightCycle,
  SimulationEvent,
  ActionType,
  AgentState,
  SIMULATION_SPEEDS,
  WeatherCondition,
  WeatherState,
} from '@/types'
import { World } from '@/world/World'
import { Camera } from '@/rendering/Camera'
import { Renderer } from '@/rendering/Renderer'
import { AgentManager } from '@/agent/AgentManager'
import { LMStudioProvider, LMStudioConfig } from '@/ai/AIProvider'
import { DebugOverlay } from '@/rendering/DebugOverlay'
import { ConversationPanel } from '@/rendering/ConversationPanel'
import { CourtPanel } from '@/rendering/CourtPanel'
import { PolicyPanel } from '@/rendering/PolicyPanel'
import { DeityChatPanel } from '@/rendering/DeityChatPanel'
import { StoryNarrationPanel } from '@/rendering/StoryNarrationPanel'
import { EventBus } from '@/interaction/EventBus'

export class SimulationManager {
  private static readonly STORAGE_KEY = 'ai-town:village-state:v1'
  private static readonly SAVE_INTERVAL_MS = 3000
  private world: World
  private camera: Camera
  private renderer: Renderer
  private agentManager: AgentManager | null
  private debugOverlay: DebugOverlay
  private conversationPanel: ConversationPanel
  private courtPanel: CourtPanel
  private policyPanel: PolicyPanel
  private deityChatPanel: DeityChatPanel
  private storyNarrationPanel: StoryNarrationPanel
  private deityChatAutoPaused: boolean
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
  private persistenceTimer: number
  private resettingState: boolean

  private dayNight: DayNightCycle
  private weather: WeatherState
  private nextWeatherChangeMinute: number
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
    this.persistenceTimer = 0
    this.resettingState = false
    this.deityChatAutoPaused = false
    this.selectedAgentId = undefined
    this.keys = new Map()

    this.dayNight = {
      hour: 6,
      minute: 0,
      day: 1,
      isDaytime: true,
      brightness: 1,
    }
    this.weather = {
      condition: 'clear',
      temperatureC: 24,
      hazardousOutdoors: false,
      changedAtMinute: 360,
    }
    this.nextWeatherChangeMinute = 480

    this.eventBus = new EventBus()
    this.debugOverlay = new DebugOverlay(this.eventBus)
    this.conversationPanel = new ConversationPanel(this.eventBus)
    this.courtPanel = new CourtPanel()
    this.policyPanel = new PolicyPanel()
    this.deityChatPanel = new DeityChatPanel()
    this.storyNarrationPanel = new StoryNarrationPanel()

    this.setupInput()
    this.setupDebugControls()
    window.addEventListener('pagehide', () => this.saveState())
  }

  private setupInput(): void {
    window.addEventListener('keydown', (e) => {
      const target = e.target
      if (
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        target instanceof HTMLSelectElement ||
        (target instanceof HTMLElement && target.isContentEditable)
      ) return

      const key = e.key.length === 1 ? e.key.toLowerCase() : e.key
      this.keys.set(key, true)

      if (['w', 'a', 's', 'd', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(key)) {
        e.preventDefault()
        if (this.selectedAgentId) this.selectAgent(undefined)
      }

      if (key === ' ') {
        e.preventDefault()
        this.togglePaused()
      }

      if (key === '=' || key === '+') {
        this.camera.zoomIn()
      }
      if (key === '-') {
        this.camera.zoomOut()
      }

      if (key >= '1' && key <= '9') {
        const idx = parseInt(key) - 1
        const agentList = this.agentManager?.getAgents() ?? []
        if (idx < agentList.length) {
          this.selectAgent(agentList[idx].state.id)
        }
      }

      if (key === '0') {
        this.selectAgent(undefined)
      }
    })

    window.addEventListener('keyup', (e) => {
      const key = e.key.length === 1 ? e.key.toLowerCase() : e.key
      this.keys.set(key, false)
    })

    const canvas = document.getElementById('gameCanvas') as HTMLCanvasElement
    let dragging = false
    let dragDistance = 0
    let lastPointerX = 0
    let lastPointerY = 0
    let suppressNextClick = false

    canvas.addEventListener('mousedown', (event) => {
      if (event.button !== 0) return
      dragging = true
      dragDistance = 0
      lastPointerX = event.clientX
      lastPointerY = event.clientY
      canvas.style.cursor = 'grabbing'
    })

    window.addEventListener('mousemove', (event) => {
      if (!dragging) return
      const dx = event.clientX - lastPointerX
      const dy = event.clientY - lastPointerY
      lastPointerX = event.clientX
      lastPointerY = event.clientY
      dragDistance += Math.hypot(dx, dy)
      if (dragDistance < 3) return

      if (this.selectedAgentId) this.selectAgent(undefined)
      this.camera.pan(-dx / this.camera.zoom, -dy / this.camera.zoom)
      event.preventDefault()
    })

    window.addEventListener('mouseup', (event) => {
      if (!dragging || event.button !== 0) return
      dragging = false
      suppressNextClick = dragDistance >= 3
      canvas.style.cursor = 'grab'
    })

    canvas.addEventListener('wheel', (event) => {
      event.preventDefault()
      if (event.deltaY < 0) this.camera.zoomIn()
      else if (event.deltaY > 0) this.camera.zoomOut()
    }, { passive: false })

    canvas.style.cursor = 'grab'
    canvas.addEventListener('click', (e) => {
      if (suppressNextClick) {
        suppressNextClick = false
        return
      }
      this.handleClick(e)
    })
  }

  private setupDebugControls(): void {
    window.addEventListener('debug-pause', () => {
      this.togglePaused()
    })

    window.addEventListener('debug-speed', (event) => {
      const requestedSpeed = (event as CustomEvent<{ multiplier?: number }>).detail?.multiplier
      if (requestedSpeed && SIMULATION_SPEEDS.some((speed) => speed === requestedSpeed)) {
        this.speedMultiplier = requestedSpeed
      }
    })

    window.addEventListener('debug-reset-village', () => {
      this.resettingState = true
      this.stop()
      localStorage.removeItem(SimulationManager.STORAGE_KEY)
      localStorage.removeItem(CourtPanel.ACK_STORAGE_KEY)
      localStorage.removeItem(PolicyPanel.ACK_STORAGE_KEY)
      window.location.reload()
    })

    window.addEventListener('debug-refresh-agents', () => {
      const result = this.agentManager
        ? this.agentManager.resetSchedulesLocationsAndQueries()
        : { success: false, message: 'Agent controls are unavailable.', relocated: 0 }
      window.dispatchEvent(new CustomEvent('debug-refresh-agents-result', { detail: result }))
      this.updateDebugOverlay()
      this.saveState()
    })

    window.addEventListener('debug-select-agent', (event) => {
      const agentId = (event as CustomEvent<{ agentId?: string }>).detail?.agentId
      if (!agentId) {
        this.selectAgent(undefined)
      } else if (this.agentManager?.getAgentState(agentId)) {
        this.selectAgent(agentId)
      }
    })

    window.addEventListener('debug-whisper', (event) => {
      const detail = (event as CustomEvent<{
        targetAgentId?: string
        text?: string
        credibilityPercent?: number
        sourceHint?: string
      }>).detail
      const credibilityPercent = Math.max(0, Math.min(100, detail?.credibilityPercent ?? 50))
      const rumourId = detail?.text && this.agentManager
        ? this.agentManager.whisperRumour(
            detail.text,
            detail.targetAgentId === 'all' ? 'all' : detail.targetAgentId ?? 'all',
            credibilityPercent / 100,
            detail.sourceHint ?? ''
          )
        : null
      window.dispatchEvent(new CustomEvent('debug-whisper-result', {
        detail: {
          success: rumourId !== null,
          message: rumourId
            ? `Whisper planted (${rumourId}) at ${credibilityPercent.toFixed(0)}% credibility.`
            : 'Could not deliver that whisper.',
        },
      }))
    })

    window.addEventListener('debug-rumour-truth', (event) => {
      const detail = (event as CustomEvent<{ rumourId?: string; groundTruth?: boolean }>).detail
      if (!detail?.rumourId || !this.agentManager) return
      this.agentManager.setWhisperGroundTruth(detail.rumourId, detail.groundTruth === true)
    })

    window.addEventListener('debug-god-ability', (event) => {
      const detail = (event as CustomEvent<{
        ability?: 'bless' | 'heal' | 'smite' | 'resurrect' | 'manifest' | 'weather'
        targetAgentId?: string
        weatherCondition?: WeatherCondition
        deityName?: string
      }>).detail
      const result = detail?.ability && this.agentManager
        ? this.agentManager.performGodAbility(detail.ability, detail.targetAgentId, detail.weatherCondition, detail.deityName)
        : { success: false, message: 'Deity ability could not be performed.' }
      window.dispatchEvent(new CustomEvent('debug-god-ability-result', { detail: result }))
      this.updateDebugOverlay()
    })

    window.addEventListener('debug-deity-chat-open', (event) => {
      const detail = (event as CustomEvent<{ targetAgentId?: string; deityName?: string }>).detail
      const result = detail?.targetAgentId && this.agentManager
        ? this.agentManager.beginDeityConversation(detail.targetAgentId, detail.deityName)
        : { success: false, message: 'Select a valid villager.' }
      window.dispatchEvent(new CustomEvent('debug-deity-chat-open-result', {
        detail: { ...result, targetAgentId: detail?.targetAgentId },
      }))
      if (result.success) {
        if (!this.paused) {
          this.deityChatAutoPaused = true
          this.togglePaused()
        }
      }
      this.updateDebugOverlay()
    })

    window.addEventListener('debug-deity-chat-send', (event) => {
      const detail = (event as CustomEvent<{ targetAgentId?: string; message?: string }>).detail
      if (!detail?.targetAgentId || !this.agentManager) {
        window.dispatchEvent(new CustomEvent('debug-deity-chat-send-result', {
          detail: { success: false, message: 'No open deity conversation with this villager.' },
        }))
        return
      }
      this.agentManager.sendDeityMessage(detail.targetAgentId, detail.message ?? '').then((result) => {
        window.dispatchEvent(new CustomEvent('debug-deity-chat-send-result', { detail: result }))
      })
    })

    window.addEventListener('debug-deity-chat-end', (event) => {
      const detail = (event as CustomEvent<{ targetAgentId?: string }>).detail
      const result = detail?.targetAgentId && this.agentManager
        ? this.agentManager.endDeityConversation(detail.targetAgentId)
        : { success: false, message: 'No open deity conversation with this villager.' }
      window.dispatchEvent(new CustomEvent('debug-deity-chat-end-result', { detail: result }))
      if (this.deityChatAutoPaused) {
        this.deityChatAutoPaused = false
        this.togglePaused()
      }
      this.updateDebugOverlay()
    })

    window.addEventListener('debug-deity-chat-open-result', (event) => {
      const detail = (event as CustomEvent<{
        success: boolean
        message: string
        deityName?: string
        agentName?: string
        targetAgentId?: string
      }>).detail
      if (detail?.success && detail.targetAgentId && detail.deityName && detail.agentName) {
        this.deityChatPanel.open(detail.targetAgentId, detail.agentName, detail.deityName)
      }
    })
    window.addEventListener('debug-deity-chat-send-result', (event) => {
      const detail = (event as CustomEvent<{ success: boolean; message: string; agentReply?: string }>).detail
      this.deityChatPanel.handleSendResult(detail.success, detail.message, detail.agentReply)
    })
    window.addEventListener('debug-deity-chat-end-result', (event) => {
      const detail = (event as CustomEvent<{
        success: boolean
        message: string
        becameInsane?: boolean
        believerStrengthened?: boolean
      }>).detail
      this.deityChatPanel.handleEndResult(detail.success, detail.message, detail.becameInsane, detail.believerStrengthened)
    })

    window.addEventListener('debug-demon-action', (event) => {
      const detail = (event as CustomEvent<{
        action?: 'create' | 'command'
        demonId?: string
        prompt?: string
      }>).detail
      const result = !this.agentManager
        ? { success: false, message: 'Demon controls are unavailable.' }
        : detail?.action === 'create'
          ? this.agentManager.createDemon(detail.prompt ?? '')
          : detail?.action === 'command'
            ? this.agentManager.commandDemon(detail.demonId, detail.prompt ?? '')
            : { success: false, message: 'Choose a Demon action.' }
      window.dispatchEvent(new CustomEvent('debug-demon-action-result', { detail: result }))
      this.updateDebugOverlay()
    })
  }

  private togglePaused(): void {
    this.paused = !this.paused
    window.dispatchEvent(new CustomEvent('simulation-pause-changed', {
      detail: { paused: this.paused },
    }))
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
      decisionTemperature: 0.3,
      dialogueTemperature: 0.8,
      timeout: 1800000,
    }

    const aiProvider = new LMStudioProvider(lmStudioConfig)

    this.agentManager = new AgentManager(
      this.world,
      this,
      aiProvider,
      this.eventBus
    )
    this.agentManager.initialize(count)
  }

  start(): void {
    if (!this.restoreState()) {
      this.world.generate()
      this.initializeAgents(this.config.agentCount)
    }

    const selectedAgent = this.selectedAgentId
      ? this.agentManager?.getAgentState(this.selectedAgentId)
      : undefined
    const firstAgent = this.agentManager?.getAgents()?.[0]
    if (selectedAgent) this.selectAgent(selectedAgent.id)
    else if (firstAgent) this.selectAgent(firstAgent.state.id)

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

        this.updateDayNight(adjustedDelta)
        this.updateWeather()

        if (this.agentManager) {
          this.agentManager.update(adjustedDelta, this.simTime)
        }
      }

      this.updateCameraMovement(delta)

      this.persistenceTimer += delta
      if (this.persistenceTimer >= SimulationManager.SAVE_INTERVAL_MS) {
        this.persistenceTimer = 0
        this.saveState()
      }

      this.updateSelectedAgentFollow()
      this.camera.update()
      this.renderer.render(this.getAgentsArray(), this.dayNight, this.weather, {
        paused: this.paused,
        speedMultiplier: this.speedMultiplier,
        eventCount: this.events.length,
        rumourCount: this.agentManager?.getRumours().length ?? 0,
        rumourImpactCounts: this.agentManager?.getRumourImpactCounts() ?? {},
        llmQueries: this.agentManager?.getLLMQueryStats() ?? { made: 0, successful: 0 },
        conversationChanceMultiplier: this.config.conversationChanceMultiplier,
        rumourPropagationMultiplier: this.config.rumourPropagationMultiplier,
        inventedRumourProbability: this.config.inventedRumourProbability,
        rumourExtremeBeliefProbability: this.config.rumourExtremeBeliefProbability,
      })

      this.debugUpdateTimer += delta
      if (this.debugUpdateTimer >= 500) {
        this.debugUpdateTimer = 0
        this.updateDebugOverlay()
      }
    }

    requestAnimationFrame(this.gameLoop)
  }

  private updateDebugOverlay(): void {
    if (!this.agentManager) return

    if (this.debugOverlay.isVisible()) {
      this.debugOverlay.updateAgentStates(
        this.getAgentsArray(),
        this.agentManager.getLLMRequestStatuses(),
        this.agentManager.getAgentActivityStatuses(),
        this.agentManager.getAgentDebugDetails(),
        (this.dayNight.day - 1) * 1440 + this.dayNight.hour * 60 + this.dayNight.minute
      )
      this.debugOverlay.updateRumours(
        this.agentManager.getRumours(),
        this.getAgentsArray()
      )
    }

    this.debugOverlay.updateRumourTracker(
      this.agentManager.getRumours(),
      this.getAgentsArray()
    )
    this.debugOverlay.updateCultsAndGroups(
      this.getAgentsArray(),
      this.agentManager.getAgentDebugDetails(),
      this.agentManager.getAgentActivityStatuses(),
      (this.dayNight.day - 1) * 1440 + this.dayNight.hour * 60 + this.dayNight.minute
    )
    this.debugOverlay.updateGodControls(
      this.getAgentsArray(),
      this.agentManager.getGodInterventionState()
    )

    this.conversationPanel.update(this.agentManager.getAgents())
    this.courtPanel.update(this.agentManager.getRumours(), this.getAgentsArray())
    this.policyPanel.update(this.agentManager.getPolicySessions(), this.getAgentsArray())
    this.storyNarrationPanel.update(this.agentManager.getStoryMoments())
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
      this.camera.pan(dx, dy)
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

  private updateWeather(): void {
    const absoluteMinute =
      (this.dayNight.day - 1) * 1440 + this.dayNight.hour * 60 + this.dayNight.minute
    if (absoluteMinute < this.nextWeatherChangeMinute) return

    const previous = this.weather.condition
    const next = this.chooseWeatherCondition()
    this.nextWeatherChangeMinute = absoluteMinute + 90 + Math.random() * 150
    if (next === previous) return

    const temperatureRanges: Record<WeatherCondition, [number, number]> = {
      clear: [23, 31],
      cloudy: [20, 27],
      rain: [18, 24],
      storm: [17, 22],
    }
    const [minimum, maximum] = temperatureRanges[next]
    this.weather = {
      condition: next,
      temperatureC: Math.round(minimum + Math.random() * (maximum - minimum)),
      hazardousOutdoors: next === 'rain' || next === 'storm',
      changedAtMinute: absoluteMinute,
    }

    this.logEvent({
      type: 'weather',
      agentId: 'world',
      actionType: ActionType.IDLE,
      outcome: next,
      description: `Weather changed from ${previous} to ${next}`,
      causationIds: [],
      worldStateDelta: { weather: this.weather },
      observers: this.getActiveAgents().map((agent) => agent.id),
    })
  }

  private chooseWeatherCondition(): WeatherCondition {
    const roll = Math.random()
    if (roll < 0.42) return 'clear'
    if (roll < 0.7) return 'cloudy'
    if (roll < 0.92) return 'rain'
    return 'storm'
  }

  public setWeatherByDivineIntervention(condition: WeatherCondition): WeatherCondition {
    const previous = this.weather.condition
    const absoluteMinute =
      (this.dayNight.day - 1) * 1440 + this.dayNight.hour * 60 + this.dayNight.minute
    const temperatureRanges: Record<WeatherCondition, [number, number]> = {
      clear: [23, 31],
      cloudy: [20, 27],
      rain: [18, 24],
      storm: [17, 22],
    }
    const [minimum, maximum] = temperatureRanges[condition]
    this.weather = {
      condition,
      temperatureC: Math.round(minimum + Math.random() * (maximum - minimum)),
      hazardousOutdoors: condition === 'rain' || condition === 'storm',
      changedAtMinute: absoluteMinute,
    }
    this.nextWeatherChangeMinute = absoluteMinute + 180
    return previous
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
    if (this.selectedAgentId === id) this.selectAgent(undefined)
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

  getWeather(): WeatherState {
    return this.weather
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

  private saveState(): void {
    if (!this.agentManager || this.resettingState) return
    try {
      localStorage.setItem(SimulationManager.STORAGE_KEY, JSON.stringify({
        version: 1,
        mapWidth: this.config.mapWidth,
        mapHeight: this.config.mapHeight,
        world: {
          tiles: this.world.tiles,
          buildings: Array.from(this.world.buildings.entries()),
          objects: Array.from(this.world.objects.entries()),
        },
        agents: this.agentManager.createSnapshot(),
        events: this.events,
        eventBusEvents: this.eventBus.toJSON(),
        eventCounter: this.eventCounter,
        simTime: this.simTime,
        dayNight: this.dayNight,
        weather: this.weather,
        nextWeatherChangeMinute: this.nextWeatherChangeMinute,
        paused: this.paused,
        speedMultiplier: this.speedMultiplier,
        selectedAgentId: this.selectedAgentId,
      }))
    } catch (error) {
      console.warn('[Simulation] Could not persist village state:', error)
    }
  }

  private restoreState(): boolean {
    try {
      const raw = localStorage.getItem(SimulationManager.STORAGE_KEY)
      if (!raw) return false
      const saved = JSON.parse(raw)
      if (
        saved.version !== 1 ||
        saved.mapWidth !== this.config.mapWidth ||
        saved.mapHeight !== this.config.mapHeight
      ) return false

      this.world.tiles = saved.world.tiles
      this.world.buildings = new Map(saved.world.buildings ?? [])
      this.world.objects = new Map(saved.world.objects ?? [])
      const repairedBuildings = this.world.repairBuildingOverlaps()
      if (repairedBuildings > 0) {
        console.log(`[Simulation] Repositioned ${repairedBuildings} overlapping saved building${repairedBuildings === 1 ? '' : 's'}`)
      }
      this.events = saved.events ?? []
      this.eventCounter = saved.eventCounter ?? this.events.length
      this.simTime = saved.simTime ?? 0
      this.dayNight = saved.dayNight ?? this.dayNight
      this.weather = saved.weather ?? this.weather
      this.nextWeatherChangeMinute = saved.nextWeatherChangeMinute ?? 480
      this.paused = saved.paused ?? false
      this.speedMultiplier = saved.speedMultiplier ?? 1
      this.eventBus.restore(saved.eventBusEvents ?? [])
      this.initializeAgents(0)
      this.agentManager!.restoreSnapshot(saved.agents)
      this.selectedAgentId = saved.selectedAgentId
      console.log('[Simulation] Restored village state from browser storage')
      return true
    } catch (error) {
      console.warn('[Simulation] Saved village state was invalid; starting fresh:', error)
      return false
    }
  }

  getConversationPanel(): ConversationPanel {
    return this.conversationPanel
  }
}
