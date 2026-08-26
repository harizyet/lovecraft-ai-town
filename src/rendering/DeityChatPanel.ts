interface DeityChatTurn {
  speaker: string
  dialogue: string
  kind: 'deity' | 'agent' | 'system'
}

export class DeityChatPanel {
  private container: HTMLDivElement
  private transcript: HTMLDivElement
  private input: HTMLInputElement
  private sendButton: HTMLButtonElement
  private endButton: HTMLButtonElement
  private closeButton: HTMLButtonElement
  private statusEl: HTMLElement
  private turns: DeityChatTurn[] = []
  private targetAgentId: string | null = null
  private deityName: string = ''
  private agentName: string = ''
  private waiting: boolean = false
  private ended: boolean = false

  constructor() {
    this.container = document.createElement('div')
    this.container.id = 'deity-chat-panel'
    this.container.setAttribute('role', 'dialog')
    this.container.setAttribute('aria-label', 'Direct conversation with a deity')
    this.container.style.cssText = `
      position: fixed;
      top: 50%;
      left: 50%;
      transform: translate(-50%, -50%);
      width: min(480px, calc(100vw - 32px));
      max-height: min(72vh, 640px);
      display: none;
      flex-direction: column;
      background: rgba(10, 8, 22, 0.97);
      color: #f1eaff;
      border: 2px solid #b388ff;
      border-radius: 8px;
      box-shadow: 0 10px 48px rgba(0, 0, 0, 0.8);
      font-family: 'Consolas', 'Monaco', monospace;
      font-size: 12px;
      overflow: hidden;
      z-index: 1220;
      pointer-events: auto;
    `
    this.container.innerHTML = `
      <div style="padding:10px 14px;background:rgba(70,40,140,.6);border-bottom:1px solid #b388ff;">
        <div id="deity-chat-title" style="color:#e5d3ff;font-size:15px;font-weight:bold;">Divine Conversation</div>
        <div id="deity-chat-subtitle" style="color:#c1a8e8;font-size:10px;margin-top:2px;"></div>
      </div>
      <div id="deity-chat-transcript" aria-live="polite" style="padding:12px 14px;overflow-y:auto;min-height:120px;flex:1;"></div>
      <div id="deity-chat-status" style="min-height:14px;padding:0 14px;color:#c1a8e8;font-size:10px;"></div>
      <div style="padding:10px 14px;border-top:1px solid #4a2d7a;display:flex;gap:7px;">
        <input id="deity-chat-input" type="text" maxlength="400" placeholder="Speak as the deity..." style="flex:1;box-sizing:border-box;padding:7px 8px;background:#1a1230;color:#fff;border:1px solid #6d47b8;border-radius:4px;font:inherit;">
        <button id="deity-chat-send" style="padding:7px 12px;border:0;border-radius:4px;background:#b388ff;color:#1b0f33;cursor:pointer;font:inherit;font-weight:bold;">Send</button>
      </div>
      <div style="padding:0 14px 12px;display:flex;justify-content:space-between;gap:8px;">
        <button id="deity-chat-end" style="padding:6px 12px;border:0;border-radius:4px;background:#7c4dff;color:#fff;cursor:pointer;font:inherit;">End Conversation</button>
        <button id="deity-chat-close" style="display:none;padding:6px 14px;border:0;border-radius:4px;background:#555;color:#fff;cursor:pointer;font:inherit;font-weight:bold;">Close</button>
      </div>
    `
    this.transcript = this.container.querySelector<HTMLDivElement>('#deity-chat-transcript')!
    this.input = this.container.querySelector<HTMLInputElement>('#deity-chat-input')!
    this.sendButton = this.container.querySelector<HTMLButtonElement>('#deity-chat-send')!
    this.endButton = this.container.querySelector<HTMLButtonElement>('#deity-chat-end')!
    this.closeButton = this.container.querySelector<HTMLButtonElement>('#deity-chat-close')!
    this.statusEl = this.container.querySelector<HTMLElement>('#deity-chat-status')!

    this.sendButton.addEventListener('click', () => this.send())
    this.input.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') this.send()
    })
    this.endButton.addEventListener('click', () => {
      if (!this.targetAgentId || this.waiting || this.ended) return
      this.waiting = true
      this.setControlsEnabled(false)
      this.statusEl.textContent = 'Ending the conversation...'
      window.dispatchEvent(new CustomEvent('debug-deity-chat-end', {
        detail: { targetAgentId: this.targetAgentId },
      }))
    })
    this.closeButton.addEventListener('click', () => this.close())

    document.body.appendChild(this.container)
  }

  public open(targetAgentId: string, agentName: string, deityName: string): void {
    this.targetAgentId = targetAgentId
    this.agentName = agentName
    this.deityName = deityName
    this.turns = []
    this.waiting = false
    this.ended = false
    this.statusEl.textContent = ''
    this.input.value = ''
    this.closeButton.style.display = 'none'
    this.endButton.style.display = 'inline-block'
    this.setControlsEnabled(true)

    const title = this.container.querySelector<HTMLElement>('#deity-chat-title')
    const subtitle = this.container.querySelector<HTMLElement>('#deity-chat-subtitle')
    if (title) title.textContent = `Speaking as ${deityName}`
    if (subtitle) subtitle.textContent = `A direct line to ${agentName}. The world holds still.`

    this.renderTranscript()
    this.container.style.display = 'flex'
    this.input.focus()
  }

  public isOpen(): boolean {
    return this.container.style.display !== 'none'
  }

  public getTargetAgentId(): string | null {
    return this.targetAgentId
  }

  public handleSendResult(success: boolean, message: string, agentReply?: string): void {
    this.waiting = false
    if (!success) {
      this.statusEl.textContent = message
      this.setControlsEnabled(true)
      this.input.focus()
      return
    }
    this.statusEl.textContent = ''
    if (agentReply) this.turns.push({ speaker: this.agentName, dialogue: agentReply, kind: 'agent' })
    this.renderTranscript()
    this.setControlsEnabled(true)
    this.input.focus()
  }

  public handleEndResult(success: boolean, message: string, becameInsane?: boolean, believerStrengthened?: boolean): void {
    this.waiting = false
    this.ended = true
    if (!success) {
      this.statusEl.textContent = message
      this.setControlsEnabled(true)
      return
    }
    this.turns.push({ speaker: 'system', dialogue: message, kind: 'system' })
    this.renderTranscript()
    this.statusEl.textContent = becameInsane
      ? `${this.agentName} has gone permanently insane.`
      : believerStrengthened
        ? `${this.agentName}'s belief has strengthened.`
        : ''
    this.setControlsEnabled(false)
    this.endButton.style.display = 'none'
    this.closeButton.style.display = 'inline-block'
  }

  public close(): void {
    this.container.style.display = 'none'
    this.targetAgentId = null
    this.turns = []
  }

  private send(): void {
    if (!this.targetAgentId || this.waiting || this.ended) return
    const message = this.input.value.trim()
    if (!message) return
    this.turns.push({ speaker: this.deityName, dialogue: message, kind: 'deity' })
    this.renderTranscript()
    this.input.value = ''
    this.waiting = true
    this.setControlsEnabled(false)
    this.statusEl.textContent = `${this.agentName} is responding...`
    window.dispatchEvent(new CustomEvent('debug-deity-chat-send', {
      detail: { targetAgentId: this.targetAgentId, message },
    }))
  }

  private setControlsEnabled(enabled: boolean): void {
    this.input.disabled = !enabled
    this.sendButton.disabled = !enabled
    this.endButton.disabled = !enabled
  }

  private renderTranscript(): void {
    const wasNearBottom = this.transcript.scrollHeight - this.transcript.scrollTop - this.transcript.clientHeight <= 24
    this.transcript.innerHTML = this.turns.length
      ? this.turns.map((turn) => {
          if (turn.kind === 'system') {
            return `<div style="margin:8px 0;padding:7px;background:rgba(179,136,255,.1);border-left:3px solid #b388ff;color:#e5d3ff;">${this.escapeHtml(turn.dialogue)}</div>`
          }
          const color = turn.kind === 'deity' ? '#ce93d8' : '#90caf9'
          return `<div style="padding:6px 0;"><span style="color:${color};font-weight:bold;">${this.escapeHtml(turn.speaker)}:</span> “${this.escapeHtml(turn.dialogue)}”</div>`
        }).join('')
      : '<div style="color:#7c6a99;">Speak, and the villager will hear your voice.</div>'
    this.transcript.scrollTop = wasNearBottom ? this.transcript.scrollHeight : this.transcript.scrollTop
  }

  private escapeHtml(value: string): string {
    return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#039;')
  }
}
