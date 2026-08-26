import { TileType, BuildingType, SimulationConfig, DayNightCycle, AgentState, EmotionalState, WeatherState } from '@/types'
import { World } from '@/world/World'
import { Camera } from '@/rendering/Camera'
import { getJobIcon } from '@/utils/JobIcons'

interface RendererSimulationState {
  paused: boolean
  speedMultiplier: number
  eventCount: number
  rumourCount: number
  rumourImpactCounts: Record<string, number>
  llmQueries: { made: number; successful: number }
  conversationChanceMultiplier: number
  rumourPropagationMultiplier: number
  inventedRumourProbability: number
  rumourExtremeBeliefProbability: number
  relicPlacementPreview?: { x: number; y: number }
}

export class Renderer {
  private canvas: HTMLCanvasElement
  private ctx: CanvasRenderingContext2D
  private world: World
  private camera: Camera
  private tileSize: number

  private tileColors: Record<TileType, string>
  private buildingColors: Record<BuildingType, string>
  private selectedAgentId: string | undefined

  private emotionIcons: Record<EmotionalState, string>

  constructor(
    canvas: HTMLCanvasElement,
    world: World,
    camera: Camera,
    config: SimulationConfig
  ) {
    this.canvas = canvas
    this.ctx = canvas.getContext('2d')!
    this.world = world
    this.camera = camera
    this.tileSize = config.tileSize
    this.selectedAgentId = undefined

    this.tileColors = {
      [TileType.GRASS]: '#4a7c59',
      [TileType.ROAD]: '#8b7355',
      [TileType.WATER]: '#4a90d9',
      [TileType.BUILDING]: '#c4a882',
      [TileType.TREE]: '#2d5a27',
      [TileType.PATH]: '#a0896c',
      // Permanent EnvironmentSystem terrain scars -- these are the tile's
      // actual base color, not a transient overlay, since the conversion is
      // irreversible even once corruption itself decays away.
      [TileType.BLIGHTED]: '#4a3b52',
      [TileType.BRACKISH_WATER]: '#4f5330',
    }

    this.buildingColors = {
      [BuildingType.HOME]: '#d4a574',
      [BuildingType.SHOP]: '#8b6914',
      [BuildingType.TOWN_SQUARE]: '#c0c0c0',
      [BuildingType.RESTAURANT]: '#8b4513',
      [BuildingType.WORKSHOP]: '#696969',
      [BuildingType.CHURCH]: '#deb887',
      [BuildingType.PARK]: '#6b8e23',
      [BuildingType.SMITHY]: '#55504a',
      [BuildingType.CARPENTER_WORKSHOP]: '#9a6b3f',
      [BuildingType.MARKET]: '#b88632',
      [BuildingType.GUARDHOUSE]: '#787878',
      [BuildingType.APOTHECARY]: '#718c4b',
      [BuildingType.MANOR]: '#aa8060',
      [BuildingType.TAVERN]: '#7f4428',
      [BuildingType.FARM]: '#8b7d3c',
      [BuildingType.CULT_SHRINE]: '#4a1a5c',
    }

    this.emotionIcons = {
      [EmotionalState.HAPPY]: '',
      [EmotionalState.NEUTRAL]: '',
      [EmotionalState.SAD]: '',
      [EmotionalState.ANGRY]: '',
      [EmotionalState.AFRAID]: '',
      [EmotionalState.EXCITED]: '',
      [EmotionalState.TIRED]: '',
      [EmotionalState.HUNGRY]: '',
      [EmotionalState.PANICKED]: '',
      [EmotionalState.GRIEVING]: '',
      [EmotionalState.AMBIVALENT]: '',
      [EmotionalState.DETERMINED]: '',
    }

    this.resize()
    window.addEventListener('resize', () => this.resize())
  }

  private resize(): void {
    this.canvas.width = window.innerWidth
    this.canvas.height = window.innerHeight
  }

  setSelectedAgent(id: string | undefined): void {
    this.selectedAgentId = id
  }

  render(
    agents: AgentState[],
    dayNight: DayNightCycle,
    weather: WeatherState,
    simulation: RendererSimulationState
  ): void {
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height)

    this.ctx.save()
    this.applyCamera()
    this.renderTiles()
    this.renderBuildings()
    this.renderCorruptionOverlay()
    this.renderRelics()
    if (simulation.relicPlacementPreview) {
      const px = simulation.relicPlacementPreview.x * this.tileSize
      const py = simulation.relicPlacementPreview.y * this.tileSize
      const cx = px + this.tileSize / 2
      const cy = py + this.tileSize / 2
      const r = this.tileSize * 0.22
      this.ctx.fillStyle = 'rgba(255, 0, 0, 0.4)'
      this.ctx.fillRect(px, py, this.tileSize, this.tileSize)
      this.ctx.fillStyle = '#ff5252'
      this.ctx.beginPath()
      this.ctx.moveTo(cx, cy - r)
      this.ctx.lineTo(cx + r, cy)
      this.ctx.lineTo(cx, cy + r)
      this.ctx.lineTo(cx - r, cy)
      this.ctx.closePath()
      this.ctx.fill()
    }
    this.renderDeadBodies(agents)
    this.renderAgents(agents, simulation.rumourImpactCounts)
    this.ctx.restore()

    this.renderDayNightOverlay(dayNight)
    this.renderHUD(agents, dayNight, weather, simulation)
  }

  private applyCamera(): void {
    this.ctx.translate(
      this.canvas.width / 2,
      this.canvas.height / 2
    )
    this.ctx.scale(this.camera.zoom, this.camera.zoom)
    this.ctx.translate(
      -this.camera.position.x,
      -this.camera.position.y
    )
  }

  private renderTiles(): void {
    for (let y = 0; y < this.world.height; y++) {
      for (let x = 0; x < this.world.width; x++) {
        const tile = this.world.getTile(x, y)
        if (!tile) continue

        const screenX = x * this.tileSize
        const screenY = y * this.tileSize

        this.ctx.fillStyle = this.tileColors[tile.type]
        this.ctx.fillRect(screenX, screenY, this.tileSize, this.tileSize)

        if (tile.type === TileType.TREE) {
          this.renderTree(screenX, screenY)
        }
      }
    }
  }

  // Corruption bleeding from cult shrines, demons, or active summoning
  // rituals (see EnvironmentSystem): water is tinted brackish, other tiles
  // are tinted a sickly blight, and past a heavier threshold a translucent
  // fog patch is layered on top -- a persistent, localized haze rather than
  // the ambient, global weather overlay. Drawn as its own pass *after*
  // renderBuildings(), not folded into renderTiles(): a building's solid
  // fill rect is painted directly over its footprint's tiles, so a tint
  // applied during the base tile pass (e.g. on a blighted farm or a cult's
  // own shrine tile) would be invisibly painted over and never actually
  // seen.
  private renderCorruptionOverlay(): void {
    for (let y = 0; y < this.world.height; y++) {
      for (let x = 0; x < this.world.width; x++) {
        const tile = this.world.getTile(x, y)
        if (!tile?.corruption) continue
        this.renderCorruption(x * this.tileSize, y * this.tileSize, tile.type, tile.corruption)
      }
    }
  }

  private renderCorruption(x: number, y: number, tileType: TileType, intensity: number): void {
    const alpha = Math.min(0.85, 0.15 + intensity * 0.7)
    const isWaterLike = tileType === TileType.WATER || tileType === TileType.BRACKISH_WATER
    const tint = isWaterLike ? `rgba(70, 74, 38, ${alpha})` : `rgba(84, 46, 94, ${alpha * 0.75})`
    this.ctx.fillStyle = tint
    this.ctx.fillRect(x, y, this.tileSize, this.tileSize)

    if (intensity >= 0.5) {
      const fogAlpha = (intensity - 0.5) * 0.7
      const cx = x + this.tileSize / 2
      const cy = y + this.tileSize / 2
      const gradient = this.ctx.createRadialGradient(cx, cy, 0, cx, cy, this.tileSize * 0.9)
      gradient.addColorStop(0, `rgba(180, 190, 180, ${fogAlpha})`)
      gradient.addColorStop(1, 'rgba(180, 190, 180, 0)')
      this.ctx.fillStyle = gradient
      this.ctx.fillRect(x - this.tileSize * 0.4, y - this.tileSize * 0.4, this.tileSize * 1.8, this.tileSize * 1.8)
    }
  }

  // Forbidden Relics (see RelicSystem): a diamond marker at the spot an
  // investigation was written up, glowing red if the findings contain
  // forbidden knowledge and purple otherwise. Drawn in the same pass slot as
  // renderCorruptionOverlay (after buildings, so it isn't painted over) but
  // before renderDeadBodies/renderAgents so agent markers stay on top of it.
  private renderRelics(): void {
    for (const relic of this.world.relics.values()) {
      const x = relic.position.x * this.tileSize
      const y = relic.position.y * this.tileSize
      const cx = x + this.tileSize / 2
      const cy = y + this.tileSize / 2
      const r = this.tileSize * 0.22
      const forbidden = relic.containsForbiddenKnowledge

      const glowRadius = r * 2.4
      const glow = this.ctx.createRadialGradient(cx, cy, 0, cx, cy, glowRadius)
      glow.addColorStop(0, forbidden ? 'rgba(180, 20, 20, 0.55)' : 'rgba(130, 100, 210, 0.5)')
      glow.addColorStop(1, 'rgba(0, 0, 0, 0)')
      this.ctx.fillStyle = glow
      this.ctx.fillRect(cx - glowRadius, cy - glowRadius, glowRadius * 2, glowRadius * 2)

      this.ctx.fillStyle = forbidden ? '#4a0d0d' : '#2b1a4a'
      this.ctx.beginPath()
      this.ctx.moveTo(cx, cy - r)
      this.ctx.lineTo(cx + r, cy)
      this.ctx.lineTo(cx, cy + r)
      this.ctx.lineTo(cx - r, cy)
      this.ctx.closePath()
      this.ctx.fill()
      this.ctx.strokeStyle = forbidden ? '#ff5252' : '#b39ddb'
      this.ctx.lineWidth = 1.5
      this.ctx.stroke()
    }
  }

  private renderTree(x: number, y: number): void {
    const cx = x + this.tileSize / 2
    const cy = y + this.tileSize / 2
    const r = this.tileSize * 0.35

    this.ctx.fillStyle = '#1a4a1a'
    this.ctx.beginPath()
    this.ctx.arc(cx, cy, r, 0, Math.PI * 2)
    this.ctx.fill()

    this.ctx.fillStyle = '#2d6a2d'
    this.ctx.beginPath()
    this.ctx.arc(cx - r * 0.2, cy - r * 0.2, r * 0.7, 0, Math.PI * 2)
    this.ctx.fill()
  }

  private renderBuildings(): void {
    for (const building of this.world.buildings.values()) {
      const x = building.position.x * this.tileSize
      const y = building.position.y * this.tileSize
      const w = building.size.x * this.tileSize
      const h = building.size.y * this.tileSize

      this.ctx.fillStyle = this.buildingColors[building.type]
      this.ctx.fillRect(x, y, w, h)

      this.ctx.strokeStyle = '#333'
      this.ctx.lineWidth = 2
      this.ctx.strokeRect(x, y, w, h)

      if (building.type !== BuildingType.TOWN_SQUARE) {
        this.renderRoof(x, y, w, h)
      }

      const labelHeight = Math.max(13, this.tileSize * 0.42)
      this.ctx.fillStyle = 'rgba(0, 0, 0, 0.68)'
      this.ctx.fillRect(x + 2, y + h - labelHeight - 2, Math.max(0, w - 4), labelHeight)
      this.ctx.fillStyle = '#fff'
      this.ctx.font = `${Math.max(9, this.tileSize * 0.27)}px sans-serif`
      this.ctx.textAlign = 'center'
      this.ctx.fillText(
        building.name,
        x + w / 2,
        y + h - 5,
        Math.max(10, w - 8)
      )
    }
  }

  private renderRoof(x: number, y: number, w: number, _h: number): void {
    const roofHeight = this.tileSize * 0.8
    this.ctx.fillStyle = '#8b0000'
    this.ctx.beginPath()
    this.ctx.moveTo(x - 3, y)
    this.ctx.lineTo(x + w / 2, y - roofHeight)
    this.ctx.lineTo(x + w + 3, y)
    this.ctx.closePath()
    this.ctx.fill()
  }

  private renderDeadBodies(agents: AgentState[]): void {
    for (const agent of agents) {
      if (agent.alive || agent.exiled) continue

      const x = agent.position.x * this.tileSize
      const y = agent.position.y * this.tileSize
      const cx = x + this.tileSize / 2
      const cy = y + this.tileSize / 2
      const r = this.tileSize * 0.3

      this.ctx.fillStyle = 'rgba(100, 50, 50, 0.7)'
      this.ctx.beginPath()
      this.ctx.ellipse(cx, cy + r * 0.2, r, r * 0.5, 0, 0, Math.PI * 2)
      this.ctx.fill()

      this.ctx.strokeStyle = '#666'
      this.ctx.lineWidth = 1
      this.ctx.stroke()

      this.ctx.fillStyle = '#aaa'
      this.ctx.font = `${Math.max(8, this.tileSize * 0.2)}px sans-serif`
      this.ctx.textAlign = 'center'
      this.ctx.fillText(`RIP ${agent.name}`, cx, y - 5)
    }
  }

  private renderAgents(agents: AgentState[], rumourImpactCounts: Record<string, number>): void {
    for (const agent of agents) {
      if (!agent.alive) continue

      const x = agent.position.x * this.tileSize
      const y = agent.position.y * this.tileSize
      const cx = x + this.tileSize / 2
      const cy = y + this.tileSize / 2
      const r = this.tileSize * (agent.demon ? 1.4 : 0.35)

      if (agent.id === this.selectedAgentId) {
        this.ctx.strokeStyle = '#ffd700'
        this.ctx.lineWidth = 3
        this.ctx.beginPath()
        this.ctx.arc(cx, cy, r + 4, 0, Math.PI * 2)
        this.ctx.stroke()
      }

      if (agent.demon) this.renderDemon(cx, cy, r)
      else {
        this.ctx.fillStyle = this.getAgentColor(agent)
        this.ctx.beginPath()
        this.ctx.arc(cx, cy, r, 0, Math.PI * 2)
        this.ctx.fill()
        this.ctx.strokeStyle = '#333'
        this.ctx.lineWidth = 2
        this.ctx.stroke()
      }

      this.ctx.fillStyle = '#fff'
      this.ctx.font = `bold ${Math.max(9, this.tileSize * 0.25)}px sans-serif`
      this.ctx.textAlign = 'center'
      this.ctx.fillText(agent.name, cx, agent.demon ? cy - r - 8 : y - 5)

      this.renderHealthBar(agent, x, y)
      this.renderEmotionIcon(agent, cx, y)
      this.renderJobIcon(cx, cy, r, agent.currentJob)
      const rumourCount = rumourImpactCounts[agent.id] ?? 0
      if (rumourCount > 0) this.renderRumourImpactIcon(cx, cy, r, rumourCount)
    }
  }

  private renderJobIcon(cx: number, cy: number, agentRadius: number, job: string | undefined): void {
    const iconX = cx - agentRadius - 5
    const iconY = cy + agentRadius + 5
    const iconRadius = 8

    this.ctx.fillStyle = 'rgba(20, 20, 20, 0.75)'
    this.ctx.beginPath()
    this.ctx.arc(iconX, iconY, iconRadius, 0, Math.PI * 2)
    this.ctx.fill()

    this.ctx.font = '11px sans-serif'
    this.ctx.textAlign = 'center'
    this.ctx.textBaseline = 'middle'
    this.ctx.fillText(getJobIcon(job), iconX, iconY)
    this.ctx.textBaseline = 'alphabetic'
  }

  private renderDemon(cx: number, cy: number, r: number): void {
    const gradient = this.ctx.createRadialGradient(cx, cy, r * 0.25, cx, cy, r)
    gradient.addColorStop(0, '#d32f2f')
    gradient.addColorStop(0.65, '#5b0000')
    gradient.addColorStop(1, '#160000')
    this.ctx.fillStyle = gradient
    this.ctx.beginPath()
    this.ctx.arc(cx, cy, r, 0, Math.PI * 2)
    this.ctx.fill()
    this.ctx.strokeStyle = '#ff3d00'
    this.ctx.lineWidth = 3
    this.ctx.stroke()

    this.ctx.fillStyle = '#130707'
    this.ctx.beginPath()
    this.ctx.moveTo(cx - r * 0.65, cy - r * 0.55)
    this.ctx.lineTo(cx - r * 0.95, cy - r * 1.05)
    this.ctx.lineTo(cx - r * 0.2, cy - r * 0.72)
    this.ctx.moveTo(cx + r * 0.65, cy - r * 0.55)
    this.ctx.lineTo(cx + r * 0.95, cy - r * 1.05)
    this.ctx.lineTo(cx + r * 0.2, cy - r * 0.72)
    this.ctx.fill()

    this.ctx.fillStyle = '#ffd600'
    this.ctx.beginPath()
    this.ctx.ellipse(cx - r * 0.3, cy - r * 0.15, r * 0.14, r * 0.07, 0, 0, Math.PI * 2)
    this.ctx.ellipse(cx + r * 0.3, cy - r * 0.15, r * 0.14, r * 0.07, 0, 0, Math.PI * 2)
    this.ctx.fill()
  }

  private renderRumourImpactIcon(cx: number, cy: number, agentRadius: number, count: number): void {
    const iconX = cx + agentRadius + 5
    const iconY = cy - agentRadius - 7
    const iconRadius = 8

    this.ctx.fillStyle = '#8e44ad'
    this.ctx.beginPath()
    this.ctx.arc(iconX, iconY, iconRadius, 0, Math.PI * 2)
    this.ctx.fill()
    this.ctx.beginPath()
    this.ctx.moveTo(iconX - 4, iconY + 6)
    this.ctx.lineTo(iconX - 7, iconY + 11)
    this.ctx.lineTo(iconX + 1, iconY + 7)
    this.ctx.closePath()
    this.ctx.fill()

    this.ctx.fillStyle = '#fff'
    this.ctx.font = 'bold 10px sans-serif'
    this.ctx.textAlign = 'center'
    this.ctx.textBaseline = 'middle'
    this.ctx.fillText(count > 1 ? String(count) : '!', iconX, iconY)
    this.ctx.textBaseline = 'alphabetic'
  }

  private renderEmotionIcon(agent: AgentState, cx: number, y: number): void {
    const labels: Record<EmotionalState, { text: string; color: string }> = {
      [EmotionalState.HAPPY]: { text: '', color: '#4caf50' },
      [EmotionalState.NEUTRAL]: { text: '', color: '#999' },
      [EmotionalState.SAD]: { text: '', color: '#2196f3' },
      [EmotionalState.ANGRY]: { text: '', color: '#f44336' },
      [EmotionalState.AFRAID]: { text: '', color: '#9c27b0' },
      [EmotionalState.EXCITED]: { text: '', color: '#ff9800' },
      [EmotionalState.TIRED]: { text: '', color: '#607d8b' },
      [EmotionalState.HUNGRY]: { text: '', color: '#795548' },
      [EmotionalState.PANICKED]: { text: '', color: '#e040fb' },
      [EmotionalState.GRIEVING]: { text: '', color: '#3949ab' },
      [EmotionalState.AMBIVALENT]: { text: '', color: '#9e9e9e' },
      [EmotionalState.DETERMINED]: { text: '', color: '#00bfa5' },
    }

    const emotion = labels[agent.emotionalState]
    if (!emotion) return

    const r = this.tileSize * 0.35
    const indicatorY = y - r - 8

    this.ctx.fillStyle = emotion.color
    this.ctx.beginPath()
    this.ctx.arc(cx, indicatorY, 3, 0, Math.PI * 2)
    this.ctx.fill()
  }

  private getAgentColor(agent: AgentState): string {
    if (agent.demon) return '#7f0000'
    const colors = [
      '#ff6b6b', '#4ecdc4', '#45b7d1', '#96ceb4',
      '#feca57', '#ff9ff3', '#54a0ff', '#5f27cd',
    ]
    const hash = agent.name.split('').reduce((acc: number, c: string) => acc + c.charCodeAt(0), 0)
    return colors[hash % colors.length]
  }

  private renderHealthBar(agent: AgentState, x: number, y: number): void {
    const barWidth = this.tileSize * 0.7
    const barHeight = 4
    const barX = x + (this.tileSize - barWidth) / 2
    const barY = y + this.tileSize * 0.7

    this.ctx.fillStyle = '#333'
    this.ctx.fillRect(barX, barY, barWidth, barHeight)

    const healthPercent = agent.health / agent.maxHealth
    const healthColor = healthPercent > 0.5 ? '#4caf50' : healthPercent > 0.25 ? '#ff9800' : '#f44336'
    this.ctx.fillStyle = healthColor
    this.ctx.fillRect(barX, barY, barWidth * healthPercent, barHeight)
  }

  private renderDayNightOverlay(dayNight: DayNightCycle): void {
    if (dayNight.brightness < 1) {
      this.ctx.fillStyle = `rgba(0, 0, 30, ${1 - dayNight.brightness})`
      this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height)
    }
  }

  private renderHUD(
    agents: AgentState[],
    dayNight: DayNightCycle,
    weather: WeatherState,
    simulation: RendererSimulationState
  ): void {
    const padding = 15
    const lineHeight = 18
    const panelWidth = 390
    const panelHeight = 276
    const timeStr = `${dayNight.hour.toString().padStart(2, '0')}:${Math.floor(dayNight.minute).toString().padStart(2, '0')}`
    const alive = agents.filter((a) => a.alive).length
    const dead = agents.filter((a) => !a.alive).length

    this.ctx.fillStyle = 'rgba(0, 0, 0, 0.7)'
    this.ctx.fillRect(padding, padding, panelWidth, panelHeight)
    this.ctx.strokeStyle = 'rgba(150, 206, 180, 0.65)'
    this.ctx.strokeRect(padding, padding, panelWidth, panelHeight)
    this.ctx.textAlign = 'left'
    this.ctx.font = 'bold 14px sans-serif'
    this.ctx.fillStyle = '#96ceb4'
    let y = padding + 22
    this.ctx.fillText('World State', padding + 10, y)
    this.ctx.font = '13px sans-serif'
    this.ctx.fillStyle = '#fff'
    y += lineHeight
    this.ctx.fillText(`Day ${dayNight.day}  |  ${timeStr}  |  ${dayNight.isDaytime ? 'Daytime' : 'Nighttime'}`, padding + 10, y)
    y += lineHeight
    this.ctx.fillText(`Brightness: ${Math.round(dayNight.brightness * 100)}%`, padding + 10, y)
    y += lineHeight
    this.ctx.fillText(`Weather: ${weather.condition}  |  ${weather.temperatureC}°C${weather.hazardousOutdoors ? '  |  Hazardous' : ''}`, padding + 10, y)
    y += lineHeight
    this.ctx.fillText(`Population: ${alive} alive, ${dead} dead  |  Buildings: ${this.world.buildings.size}`, padding + 10, y)
    y += lineHeight
    this.ctx.fillText(`Events: ${simulation.eventCount}  |  Rumours: ${simulation.rumourCount}`, padding + 10, y)
    y += lineHeight
    this.ctx.fillStyle = simulation.paused ? '#ffb74d' : '#81c784'
    this.ctx.fillText(`Simulation: ${simulation.paused ? 'Paused' : 'Running'}  |  Speed: ${simulation.speedMultiplier}x`, padding + 10, y)
    this.ctx.fillStyle = '#fff'
    y += lineHeight
    this.ctx.fillText(`Unfamiliar greeting chance: ${Math.min(100, 35 * Math.max(0, simulation.conversationChanceMultiplier)).toFixed(0)}% (${simulation.conversationChanceMultiplier}x)`, padding + 10, y)
    y += lineHeight
    this.ctx.fillText(`Rumour propagation/conversation: ${Math.max(0, simulation.rumourPropagationMultiplier).toFixed(1)}x`, padding + 10, y)
    y += lineHeight
    this.ctx.fillText(`Invented rumour chance: ${(Math.max(0, Math.min(1, simulation.inventedRumourProbability)) * 100).toFixed(0)}%`, padding + 10, y)
    y += lineHeight
    this.ctx.fillText(`Extreme belief/denial chance: ${(Math.max(0, Math.min(1, simulation.rumourExtremeBeliefProbability)) * 100).toFixed(0)}%`, padding + 10, y)
    y += lineHeight
    this.ctx.fillText(`LLM queries: ${simulation.llmQueries.made}  |  Successful: ${simulation.llmQueries.successful}`, padding + 10, y)
    y += lineHeight
    const corruption = this.computeCorruptionStats()
    this.ctx.fillStyle = corruption.count > 0 ? '#ce93d8' : '#fff'
    this.ctx.fillText(
      corruption.count > 0
        ? `Corruption: ${corruption.count} tile(s) tainted  |  Peak: ${Math.round(corruption.max * 100)}%`
        : 'Corruption: none detected',
      padding + 10,
      y
    )
    y += lineHeight
    const relics = this.computeRelicStats()
    this.ctx.fillStyle = relics.forbidden > 0 ? '#ff5252' : relics.total > 0 ? '#b39ddb' : '#fff'
    this.ctx.fillText(
      relics.total > 0
        ? `Relics: ${relics.total} left behind  |  ${relics.forbidden} forbidden`
        : 'Relics: none left behind',
      padding + 10,
      y
    )
  }

  private computeRelicStats(): { total: number; forbidden: number } {
    let total = 0
    let forbidden = 0
    for (const relic of this.world.relics.values()) {
      total++
      if (relic.containsForbiddenKnowledge) forbidden++
    }
    return { total, forbidden }
  }

  private computeCorruptionStats(): { count: number; max: number } {
    let count = 0
    let max = 0
    for (const row of this.world.tiles) {
      for (const tile of row) {
        if (!tile.corruption) continue
        count++
        if (tile.corruption > max) max = tile.corruption
      }
    }
    return { count, max }
  }

  private wrapText(text: string, x: number, y: number, maxWidth: number, lineHeight: number): void {
    const words = text.split(' ')
    let line = ''

    for (const word of words) {
      const testLine = line + word + ' '
      const metrics = this.ctx.measureText(testLine)
      if (metrics.width > maxWidth && line !== '') {
        this.ctx.fillText(line.trim(), x, y)
        line = word + ' '
        y += lineHeight
      } else {
        line = testLine
      }
    }
    this.ctx.fillText(line.trim(), x, y)
  }

  private wrapTextHeight(text: string, maxWidth: number, lineHeight: number): number {
    const words = text.split(' ')
    let line = ''
    let lines = 1

    for (const word of words) {
      const testLine = line + word + ' '
      const metrics = this.ctx.measureText(testLine)
      if (metrics.width > maxWidth && line !== '') {
        line = word + ' '
        lines++
      } else {
        line = testLine
      }
    }

    return lines * lineHeight
  }

  getTileSize(): number {
    return this.tileSize
  }
}
