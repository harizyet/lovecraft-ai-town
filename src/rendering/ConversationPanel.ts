import { Agent } from '@/agent/Agent'
import { EventBus } from '@/interaction/EventBus'

interface ConversationMessage { speakerName: string; targetName: string; dialogue: string; timestamp: number }

export class ConversationPanel {
  private container: HTMLDivElement
  private conversationList!: HTMLDivElement
  private eventList!: HTMLDivElement
  private eventFilter!: HTMLInputElement
  private visible = true
  private maxMessages = 30
  private maxEvents = 100

  constructor(private eventBus: EventBus) {
    this.container = this.createContainer()
  }

  private createContainer(): HTMLDivElement {
    const container = document.createElement('div')
    container.id = 'conversation-panel'
    container.style.cssText = `position:fixed;bottom:20px;left:50%;transform:translateX(-50%);width:500px;max-height:220px;background:rgba(0,0,0,.85);color:#fff;font-family:'Consolas','Monaco',monospace;font-size:12px;overflow:hidden;z-index:1000;border:1px solid #333;border-radius:6px;display:block;`
    container.innerHTML = `
      <div id="activity-tabs" role="tablist" aria-label="Activity view" style="display:flex;gap:6px;padding:8px 12px;border-bottom:1px solid #333;background:rgba(30,30,30,.9);">
        <button data-tab="conversations" role="tab" aria-selected="true" style="padding:4px 10px;border:0;border-radius:3px;background:#1565c0;color:#fff;cursor:pointer;font:inherit;">Conversations</button>
        <button data-tab="events" role="tab" aria-selected="false" style="padding:4px 10px;border:0;border-radius:3px;background:#333;color:#bbb;cursor:pointer;font:inherit;">Events</button>
      </div>
      <div id="conversation-list" style="padding:8px 12px;max-height:170px;overflow-y:auto;font-size:11px;line-height:1.6;"></div>
      <div id="event-view" style="display:none;">
        <div style="padding:7px 12px 0;"><input id="activity-event-filter" type="text" placeholder="Filter events..." aria-label="Filter events" style="box-sizing:border-box;width:100%;padding:4px 7px;background:#222;border:1px solid #444;color:#fff;border-radius:3px;font:inherit;"></div>
        <div id="activity-event-list" style="padding:8px 12px;max-height:135px;overflow-y:auto;font-size:11px;line-height:1.6;"></div>
      </div>`
    this.conversationList = container.querySelector('#conversation-list')!
    this.eventList = container.querySelector('#activity-event-list')!
    this.eventFilter = container.querySelector('#activity-event-filter')!
    const eventView = container.querySelector<HTMLElement>('#event-view')!
    const tabs = container.querySelector<HTMLElement>('#activity-tabs')!
    tabs.addEventListener('click', (event) => {
      const button = event.target instanceof Element ? event.target.closest<HTMLButtonElement>('[data-tab]') : null
      const tab = button?.dataset.tab
      if (tab !== 'conversations' && tab !== 'events') return
      this.conversationList.style.display = tab === 'conversations' ? 'block' : 'none'
      eventView.style.display = tab === 'events' ? 'block' : 'none'
      tabs.querySelectorAll<HTMLButtonElement>('[data-tab]').forEach((candidate) => {
        const selected = candidate.dataset.tab === tab
        candidate.setAttribute('aria-selected', String(selected))
        candidate.style.background = selected ? (tab === 'events' ? '#8a6d1d' : '#1565c0') : '#333'
        candidate.style.color = selected ? '#fff' : '#bbb'
      })
    })
    this.eventFilter.addEventListener('input', () => this.renderEvents())
    document.body.appendChild(container)
    return container
  }

  public update(agents: Agent[]): void {
    const messages = this.collectMessages(agents)
    const oldTop = this.conversationList.scrollTop
    const nearBottom = this.conversationList.scrollHeight - oldTop - this.conversationList.clientHeight <= 24
    this.conversationList.innerHTML = messages.length
      ? messages.map((message) => `<div style="margin:2px 0;"><span style="color:#666;">${new Date(message.timestamp).toLocaleTimeString()}</span> <span style="color:#4ecdc4;"><strong>${this.escapeHtml(message.speakerName)}</strong></span><span style="color:#888;"> → </span><span style="color:#feca57;"><strong>${this.escapeHtml(message.targetName)}</strong></span><span>: ${this.escapeHtml(message.dialogue)}</span></div>`).join('')
      : '<div style="color:#555;text-align:center;padding:20px 0;">No conversations yet</div>'
    this.conversationList.scrollTop = nearBottom ? this.conversationList.scrollHeight : oldTop
    this.renderEvents()
  }

  private renderEvents(): void {
    const oldTop = this.eventList.scrollTop
    const nearBottom = this.eventList.scrollHeight - oldTop - this.eventList.clientHeight <= 24
    const filter = this.eventFilter.value.trim().toLowerCase()
    const events = this.eventBus.getHistory().filter((event) => !filter || event.type.toLowerCase().includes(filter) || event.description.toLowerCase().includes(filter)).slice(-this.maxEvents)
    this.eventList.innerHTML = events.length
      ? events.map((event) => `<div style="padding:2px 0;border-bottom:1px solid #222;"><span style="color:#666;">${new Date(event.timestamp).toLocaleTimeString()}</span> <span style="color:${this.getEventTypeColor(event.type)};font-weight:bold;">[${this.escapeHtml(event.type)}]</span> <span>${this.escapeHtml(event.description)}</span></div>`).join('')
      : '<div style="color:#555;text-align:center;padding:20px 0;">No matching events</div>'
    this.eventList.scrollTop = nearBottom ? this.eventList.scrollHeight : oldTop
  }

  private collectMessages(agents: Agent[]): ConversationMessage[] {
    const names = new Map(agents.map((agent) => [agent.state.id, agent.state.name]))
    return this.eventBus.getHistory().filter((event) => event.type === 'conversation').flatMap((event) => {
      const match = event.description.match(/: "(.*)"$/)
      return match ? [{ speakerName: names.get(event.agentId) ?? 'Unknown', targetName: event.targetId ? names.get(event.targetId) ?? 'Unknown' : 'Unknown', dialogue: match[1], timestamp: event.timestamp }] : []
    }).slice(-this.maxMessages)
  }

  private getEventTypeColor(type: string): string {
    const colors: Record<string, string> = { attack:'#f44336',death:'#ff0000',grief:'#5c6bc0',theft:'#ff9800',help:'#4caf50',conversation:'#2196f3',encounter:'#03a9f4',weather:'#90caf9',world_event:'#4db6ac',cult_formed:'#f06292',cult_recruitment:'#ec407a',cult_defection:'#ff7043',cult_leadership:'#ffd54f',cult_request:'#ce93d8',rumour:'#ce93d8',thought:'#ab47bc',work:'#9c27b0',move:'#8bc34a',build:'#00bcd4',idle:'#999',story_moment:'#ffca28' }
    return colors[type] ?? '#fff'
  }

  private escapeHtml(value: string): string {
    return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#039;')
  }

  public setVisible(visible: boolean): void { this.visible = visible; this.container.style.display = visible ? 'block' : 'none' }
  public isVisible(): boolean { return this.visible }
}
