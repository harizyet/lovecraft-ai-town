import { Agent } from '@/agent/Agent'
import { EventBus } from '@/interaction/EventBus'

interface ConversationMessage {
  speakerName: string
  targetName: string
  dialogue: string
  timestamp: number
}

export class ConversationPanel {
  private container: HTMLDivElement
  private listElement!: HTMLDivElement
  private visible: boolean
  private eventBus: EventBus
  private maxMessages: number

  constructor(eventBus: EventBus) {
    this.visible = true
    this.eventBus = eventBus
    this.maxMessages = 30
    this.container = this.createContainer()
  }

  private createContainer(): HTMLDivElement {
    const container = document.createElement('div')
    container.id = 'conversation-panel'
    container.style.cssText = `
      position: fixed;
      bottom: 20px;
      left: 50%;
      transform: translateX(-50%);
      width: 500px;
      max-height: 200px;
      background: rgba(0, 0, 0, 0.85);
      color: #fff;
      font-family: 'Consolas', 'Monaco', monospace;
      font-size: 12px;
      overflow-y: auto;
      z-index: 1000;
      border: 1px solid #333;
      border-radius: 6px;
      display: block;
    `

    const header = document.createElement('div')
    header.style.cssText = `
      padding: 8px 12px;
      border-bottom: 1px solid #333;
      background: rgba(30, 30, 30, 0.9);
      border-radius: 6px 6px 0 0;
      position: sticky;
      top: 0;
    `
    header.innerHTML = `<h3 style="margin: 0; color: #2196f3; font-size: 13px;">Conversations</h3>`

    this.listElement = document.createElement('div')
    this.listElement.id = 'conversation-list'
    this.listElement.style.cssText = `
      padding: 8px 12px;
      max-height: 170px;
      overflow-y: auto;
      font-size: 11px;
      line-height: 1.6;
    `

    container.appendChild(header)
    container.appendChild(this.listElement)
    document.body.appendChild(container)

    return container
  }

  public update(agents: Agent[]): void {
    const messages = this.collectMessages(agents)

    if (messages.length === 0) {
      this.listElement.innerHTML = `<div style="color: #555; text-align: center; padding: 20px 0;">No conversations yet</div>`
      return
    }

    this.listElement.innerHTML = messages
      .map((msg) => {
        const time = new Date(msg.timestamp).toLocaleTimeString()
        return `<div style="margin: 2px 0;">
          <span style="color: #666;">${time}</span>
          <span style="color: #4ecdc4;"><strong>${msg.speakerName}</strong></span>
          <span style="color: #888;"> → </span>
          <span style="color: #feca57;"><strong>${msg.targetName}</strong></span>
          <span>: ${msg.dialogue}</span>
        </div>`
      })
      .join('')

    requestAnimationFrame(() => {
      this.listElement.scrollTop = this.listElement.scrollHeight
    })
  }

  private collectMessages(agents: Agent[]): ConversationMessage[] {
    const agentMap = new Map<string, string>()
    for (const agent of agents) {
      agentMap.set(agent.state.id, agent.state.name)
    }

    const convEvents = this.eventBus.getHistory().filter((e) => e.type === 'conversation')
    const messages: ConversationMessage[] = []

    for (const event of convEvents) {
      const dialogueMatch = event.description.match(/: "(.*)"$/)
      if (!dialogueMatch) continue

      const speakerName = agentMap.get(event.agentId) ?? 'Unknown'
      const targetName = event.targetId ? agentMap.get(event.targetId) ?? 'Unknown' : 'Unknown'

      messages.push({
        speakerName,
        targetName,
        dialogue: dialogueMatch[1],
        timestamp: event.timestamp,
      })
    }

    return messages.slice(-this.maxMessages)
  }

  public setVisible(visible: boolean): void {
    this.visible = visible
    this.container.style.display = visible ? 'block' : 'none'
  }

  public isVisible(): boolean {
    return this.visible
  }
}
