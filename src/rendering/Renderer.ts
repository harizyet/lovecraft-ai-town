import { TileType, BuildingType, SimulationConfig, DayNightCycle, AgentState, EmotionalState } from '@/types'
import { World } from '@/world/World'
import { Camera } from '@/rendering/Camera'

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
    }

    this.buildingColors = {
      [BuildingType.HOME]: '#d4a574',
      [BuildingType.SHOP]: '#8b6914',
      [BuildingType.TOWN_SQUARE]: '#c0c0c0',
      [BuildingType.RESTAURANT]: '#8b4513',
      [BuildingType.WORKSHOP]: '#696969',
      [BuildingType.CHURCH]: '#deb887',
      [BuildingType.PARK]: '#6b8e23',
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

  render(agents: AgentState[], dayNight: DayNightCycle): void {
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height)

    this.ctx.save()
    this.applyCamera()
    this.renderTiles()
    this.renderBuildings()
    this.renderDeadBodies(agents)
    this.renderAgents(agents)
    this.ctx.restore()

    this.renderDayNightOverlay(dayNight)
    this.renderHUD(agents, dayNight)
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

      this.ctx.fillStyle = '#fff'
      this.ctx.font = `${Math.max(10, this.tileSize * 0.3)}px sans-serif`
      this.ctx.textAlign = 'center'
      this.ctx.fillText(
        building.name,
        x + w / 2,
        y - 5
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
      if (agent.alive) continue

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

  private renderAgents(agents: AgentState[]): void {
    for (const agent of agents) {
      if (!agent.alive) continue

      const x = agent.position.x * this.tileSize
      const y = agent.position.y * this.tileSize
      const cx = x + this.tileSize / 2
      const cy = y + this.tileSize / 2
      const r = this.tileSize * 0.35

      if (agent.id === this.selectedAgentId) {
        this.ctx.strokeStyle = '#ffd700'
        this.ctx.lineWidth = 3
        this.ctx.beginPath()
        this.ctx.arc(cx, cy, r + 4, 0, Math.PI * 2)
        this.ctx.stroke()
      }

      this.ctx.fillStyle = this.getAgentColor(agent)
      this.ctx.beginPath()
      this.ctx.arc(cx, cy, r, 0, Math.PI * 2)
      this.ctx.fill()

      this.ctx.strokeStyle = '#333'
      this.ctx.lineWidth = 2
      this.ctx.stroke()

      this.ctx.fillStyle = '#fff'
      this.ctx.font = `bold ${Math.max(9, this.tileSize * 0.25)}px sans-serif`
      this.ctx.textAlign = 'center'
      this.ctx.fillText(agent.name, cx, y - 5)

      this.renderHealthBar(agent, x, y)
      this.renderEmotionIcon(agent, cx, y)
    }
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

  private renderHUD(agents: AgentState[], dayNight: DayNightCycle): void {
    const padding = 15
    const lineHeight = 18
    const panelWidth = 280

    let panelHeight = 140

    this.ctx.fillStyle = '#fff'
    this.ctx.font = '13px sans-serif'
    this.ctx.textAlign = 'left'

    const timeStr = `${dayNight.hour.toString().padStart(2, '0')}:${Math.floor(dayNight.minute).toString().padStart(2, '0')}`
    let y = padding + 20
    this.ctx.fillText(`Day ${dayNight.day}  |  ${timeStr}  |  ${dayNight.isDaytime ? 'Daytime' : 'Nighttime'}`, padding + 10, y)
    y += lineHeight

    const alive = agents.filter((a) => a.alive).length
    const dead = agents.filter((a) => !a.alive).length
    this.ctx.fillText(`Agents: ${alive} alive, ${dead} dead`, padding + 10, y)
    y += lineHeight

    let reasoningText = ''
    if (this.selectedAgentId) {
      const selected = agents.find((a) => a.id === this.selectedAgentId)
      if (selected) {
        this.ctx.fillStyle = '#ffd700'
        this.ctx.fillText(`Selected: ${selected.name}`, padding + 10, y)
        y += lineHeight
        this.ctx.fillStyle = '#fff'
        this.ctx.fillText(
          `HP: ${selected.health}/${selected.maxHealth}  Hunger: ${Math.round(selected.needs.hunger)}  Energy: ${Math.round(selected.needs.energy)}`,
          padding + 10,
          y
        )
        y += lineHeight
        this.ctx.fillText(
          `Social: ${Math.round(selected.needs.social)}  Emotion: ${selected.emotionalState}`,
          padding + 10,
          y
        )
        y += lineHeight
        reasoningText = selected.lastReasoning
      }
    }

    if (reasoningText) {
      panelHeight += this.wrapTextHeight(reasoningText, panelWidth - 20, lineHeight) + lineHeight + 10
    }

    this.ctx.fillStyle = 'rgba(0, 0, 0, 0.7)'
    this.ctx.fillRect(padding, padding, panelWidth, panelHeight)

    if (reasoningText) {
      y = padding + 20
      this.ctx.fillStyle = '#fff'
      this.ctx.font = '13px sans-serif'
      this.ctx.textAlign = 'left'

      this.ctx.fillText(`Day ${dayNight.day}  |  ${timeStr}  |  ${dayNight.isDaytime ? 'Daytime' : 'Nighttime'}`, padding + 10, y)
      y += lineHeight

      this.ctx.fillText(`Agents: ${alive} alive, ${dead} dead`, padding + 10, y)
      y += lineHeight

      const selected = agents.find((a) => a.id === this.selectedAgentId)
      if (selected) {
        this.ctx.fillStyle = '#ffd700'
        this.ctx.fillText(`Selected: ${selected.name}`, padding + 10, y)
        y += lineHeight
        this.ctx.fillStyle = '#fff'
        this.ctx.fillText(
          `HP: ${selected.health}/${selected.maxHealth}  Hunger: ${Math.round(selected.needs.hunger)}  Energy: ${Math.round(selected.needs.energy)}`,
          padding + 10,
          y
        )
        y += lineHeight
        this.ctx.fillText(
          `Social: ${Math.round(selected.needs.social)}  Emotion: ${selected.emotionalState}`,
          padding + 10,
          y
        )
        y += lineHeight + 5

        this.ctx.fillStyle = '#aaa'
        this.ctx.font = '11px sans-serif'
        this.ctx.fillText('Thinking:', padding + 10, y)
        y += 14

        this.ctx.fillStyle = '#e0e0e0'
        this.ctx.font = '12px sans-serif'
        this.wrapText(reasoningText, padding + 10, y, panelWidth - 20, lineHeight)
      }
    }
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
