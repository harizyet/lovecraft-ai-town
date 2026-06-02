import { AgentState, SimulationEvent, EmotionalState } from '@/types'
import { EventBus } from '@/interaction/EventBus'

export class DebugOverlay {
  private container: HTMLDivElement
  private eventLogPanel: HTMLDivElement
  private agentPanel: HTMLDivElement
  private worldPanel: HTMLDivElement
  private controlsPanel: HTMLDivElement
  private visible: boolean
  private eventBus: EventBus
  private maxEvents: number
  private selectedAgentId: string | undefined
  private eventFilter: string

  constructor(eventBus: EventBus) {
    this.eventBus = eventBus
    this.visible = false
    this.maxEvents = 100
    this.selectedAgentId = undefined
    this.eventFilter = ''

    this.container = this.createContainer()
    this.eventLogPanel = this.createEventLogPanel()
    this.agentPanel = this.createAgentPanel()
    this.worldPanel = this.createWorldPanel()
    this.controlsPanel = this.createControlsPanel()

    this.container.appendChild(this.controlsPanel)
    this.container.appendChild(this.eventLogPanel)
    this.container.appendChild(this.agentPanel)
    this.container.appendChild(this.worldPanel)

    document.addEventListener('keydown', (e) => {
      if (e.key === 'F1' || e.key === 'f1') {
        e.preventDefault()
        this.toggle()
      }
    })
  }

  private createContainer(): HTMLDivElement {
    const container = document.createElement('div')
    container.id = 'debug-overlay'
    container.style.cssText = `
      position: fixed;
      top: 0;
      right: 0;
      width: 400px;
      height: 100vh;
      background: rgba(0, 0, 0, 0.85);
      color: #fff;
      font-family: 'Consolas', 'Monaco', monospace;
      font-size: 12px;
      overflow-y: auto;
      transform: translateX(100%);
      transition: transform 0.3s ease;
      z-index: 1000;
      border-left: 2px solid #333;
    `
    document.body.appendChild(container)
    return container
  }

  private createControlsPanel(): HTMLDivElement {
    const panel = document.createElement('div')
    panel.style.cssText = `
      padding: 10px;
      border-bottom: 1px solid #333;
      background: rgba(30, 30, 30, 0.9);
    `

    panel.innerHTML = `
      <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px;">
        <h3 style="margin: 0; color: #4ecdc4;">Simulation Controls</h3>
        <span style="color: #888; font-size: 11px;">F1 to toggle</span>
      </div>
      <div style="display: flex; gap: 8px; flex-wrap: wrap;">
        <button id="debug-pause" style="padding: 4px 12px; background: #4ecdc4; border: none; color: #000; cursor: pointer; border-radius: 3px;">Pause</button>
        <button id="debug-speed" style="padding: 4px 12px; background: #555; border: none; color: #fff; cursor: pointer; border-radius: 3px;">Speed: 1x</button>
        <button id="debug-export-json" style="padding: 4px 12px; background: #555; border: none; color: #fff; cursor: pointer; border-radius: 3px;">Export JSON</button>
        <button id="debug-export-csv" style="padding: 4px 12px; background: #555; border: none; color: #fff; cursor: pointer; border-radius: 3px;">Export CSV</button>
      </div>
      <div style="margin-top: 8px;">
        <input type="text" id="debug-event-filter" placeholder="Filter events..." style="width: 100%; padding: 4px 8px; background: #222; border: 1px solid #444; color: #fff; border-radius: 3px; font-size: 11px;">
      </div>
    `

    const pauseBtn = panel.querySelector<HTMLButtonElement>('#debug-pause')
    const speedBtn = panel.querySelector<HTMLButtonElement>('#debug-speed')
    const exportJsonBtn = panel.querySelector<HTMLButtonElement>('#debug-export-json')
    const exportCsvBtn = panel.querySelector<HTMLButtonElement>('#debug-export-csv')
    const filterInput = panel.querySelector<HTMLInputElement>('#debug-event-filter')

    pauseBtn?.addEventListener('click', () => {
      window.dispatchEvent(new CustomEvent('debug-pause'))
    })

    speedBtn?.addEventListener('click', () => {
      window.dispatchEvent(new CustomEvent('debug-speed'))
    })

    exportJsonBtn?.addEventListener('click', () => {
      this.exportJSON()
    })

    exportCsvBtn?.addEventListener('click', () => {
      this.exportCSV()
    })

    filterInput?.addEventListener('input', (e) => {
      this.eventFilter = (e.target as HTMLInputElement).value.toLowerCase()
      this.updateEventLog()
    })

    return panel
  }

  private createEventLogPanel(): HTMLDivElement {
    const panel = document.createElement('div')
    panel.style.cssText = `
      padding: 10px;
      border-bottom: 1px solid #333;
      max-height: 300px;
      overflow-y: auto;
    `

    panel.innerHTML = `
      <h3 style="margin: 0 0 8px 0; color: #feca57;">Event Log</h3>
      <div id="debug-event-list" style="font-size: 11px; line-height: 1.6;"></div>
    `

    return panel
  }

  private createAgentPanel(): HTMLDivElement {
    const panel = document.createElement('div')
    panel.style.cssText = `
      padding: 10px;
      border-bottom: 1px solid #333;
    `

    panel.innerHTML = `
      <h3 style="margin: 0 0 8px 0; color: #ff6b6b;">Agent States</h3>
      <div id="debug-agent-list" style="font-size: 11px; line-height: 1.6;"></div>
    `

    return panel
  }

  private createWorldPanel(): HTMLDivElement {
    const panel = document.createElement('div')
    panel.style.cssText = `
      padding: 10px;
    `

    panel.innerHTML = `
      <h3 style="margin: 0 0 8px 0; color: #96ceb4;">World State</h3>
      <div id="debug-world-state" style="font-size: 11px; line-height: 1.6;"></div>
    `

    return panel
  }

  public toggle(): void {
    this.visible = !this.visible
    this.container.style.transform = this.visible ? 'translateX(0)' : 'translateX(100%)'
  }

  public setVisible(visible: boolean): void {
    this.visible = visible
    this.container.style.transform = visible ? 'translateX(0)' : 'translateX(100%)'
  }

  public isVisible(): boolean {
    return this.visible
  }

  public setSelectedAgent(id: string | undefined): void {
    this.selectedAgentId = id
  }

  public updateEventLog(): void {
    const listEl = this.container.querySelector<HTMLDivElement>('#debug-event-list')
    if (!listEl) return

    const events = this.eventBus.getHistory().slice(-this.maxEvents)
    const filtered = this.eventFilter
      ? events.filter((e) => e.description.toLowerCase().includes(this.eventFilter))
      : events

    listEl.innerHTML = filtered
      .map((e) => {
        const time = new Date(e.timestamp).toLocaleTimeString()
        const typeColor = this.getEventTypeColor(e.type)
        return `<div style="padding: 2px 0; border-bottom: 1px solid #222;">
          <span style="color: #666;">${time}</span>
          <span style="color: ${typeColor}; font-weight: bold;">[${e.type}]</span>
          <span>${e.description}</span>
        </div>`
      })
      .join('')

    listEl.scrollTop = listEl.scrollHeight
  }

  public updateAgentStates(agents: AgentState[]): void {
    const listEl = this.container.querySelector<HTMLDivElement>('#debug-agent-list')
    if (!listEl) return

    listEl.innerHTML = agents
      .map((a) => {
        const statusColor = a.alive ? '#4caf50' : '#f44336'
        const statusText = a.alive ? 'alive' : 'DEAD'
        const emotionColor = this.getEmotionColor(a.emotionalState)
        const isSelected = a.id === this.selectedAgentId

        return `<div style="padding: 4px 0; border-bottom: 1px solid #222; ${isSelected ? 'background: rgba(255, 215, 0, 0.1); border-left: 3px solid #ffd700; padding-left: 7px;' : ''}">
          <span style="color: ${statusColor}; font-weight: bold;">${a.name}</span>
          <span style="color: ${statusColor};"> (${statusText})</span>
          <span style="color: ${emotionColor};"> ${this.getEmotionLabel(a.emotionalState)}</span>
          <div style="color: #888; margin-top: 2px;">
            HP: ${a.health}/${a.maxHealth} | Hunger: ${Math.round(a.needs.hunger)} | Energy: ${Math.round(a.needs.energy)} | Social: ${Math.round(a.needs.social)}
          </div>
          <div style="color: #666; margin-top: 1px;">
            Pos: (${Math.round(a.position.x)}, ${Math.round(a.position.y)}) | Job: ${a.currentJob ?? 'None'}
          </div>
          ${a.memory.recent.length > 0 ? `<div style="color: #555; margin-top: 1px;">Memory: ${a.memory.recent.length} events${a.memory.summary ? ' + summary' : ''}</div>` : ''}
        </div>`
      })
      .join('')
  }

  public updateWorldState(
    dayNight: { hour: number; minute: number; day: number; isDaytime: boolean; brightness: number },
    buildingCount: number,
    eventCount: number
  ): void {
    const stateEl = this.container.querySelector<HTMLDivElement>('#debug-world-state')
    if (!stateEl) return

    const timeStr = `${dayNight.hour.toString().padStart(2, '0')}:${Math.floor(dayNight.minute).toString().padStart(2, '0')}`

    stateEl.innerHTML = `
      <div>Day: ${dayNight.day} | Time: ${timeStr} | ${dayNight.isDaytime ? 'Daytime' : 'Nighttime'}</div>
      <div>Brightness: ${(dayNight.brightness * 100).toFixed(0)}%</div>
      <div>Buildings: ${buildingCount}</div>
      <div>Events logged: ${eventCount}</div>
    `
  }

  private getEventTypeColor(type: string): string {
    const colors: Record<string, string> = {
      attack: '#f44336',
      death: '#ff0000',
      theft: '#ff9800',
      destroy: '#f44336',
      help: '#4caf50',
      conversation: '#2196f3',
      work: '#9c27b0',
      rest: '#607d8b',
      move: '#8bc34a',
      build: '#00bcd4',
      gather: '#8bc34a',
      idle: '#999',
    }
    return colors[type] ?? '#fff'
  }

  private getEmotionColor(emotion: EmotionalState): string {
    const colors: Record<EmotionalState, string> = {
      [EmotionalState.HAPPY]: '#4caf50',
      [EmotionalState.NEUTRAL]: '#999',
      [EmotionalState.SAD]: '#2196f3',
      [EmotionalState.ANGRY]: '#f44336',
      [EmotionalState.AFRAID]: '#9c27b0',
      [EmotionalState.EXCITED]: '#ff9800',
      [EmotionalState.TIRED]: '#607d8b',
      [EmotionalState.HUNGRY]: '#795548',
    }
    return colors[emotion] ?? '#fff'
  }

  private getEmotionLabel(emotion: EmotionalState): string {
    const labels: Record<EmotionalState, string> = {
      [EmotionalState.HAPPY]: 'Happy',
      [EmotionalState.NEUTRAL]: 'Neutral',
      [EmotionalState.SAD]: 'Sad',
      [EmotionalState.ANGRY]: 'Angry',
      [EmotionalState.AFRAID]: 'Afraid',
      [EmotionalState.EXCITED]: 'Excited',
      [EmotionalState.TIRED]: 'Tired',
      [EmotionalState.HUNGRY]: 'Hungry',
    }
    return labels[emotion] ?? 'Unknown'
  }

  private exportJSON(): void {
    const data = this.eventBus.toJSON()
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `ai-town-events-${Date.now()}.json`
    a.click()
    URL.revokeObjectURL(url)
  }

  private exportCSV(): void {
    const events = this.eventBus.toJSON()
    const headers = ['timestamp', 'type', 'agentId', 'actionType', 'targetId', 'outcome', 'description']

    const csv = [
      headers.join(','),
      ...events.map((e) =>
        headers
          .map((h) => {
            const val = (e as unknown as Record<string, unknown>)[h] ?? ''
            return `"${String(val).replace(/"/g, '""')}"`
          })
          .join(',')
      ),
    ].join('\n')

    const blob = new Blob([csv], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `ai-town-events-${Date.now()}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }
}
