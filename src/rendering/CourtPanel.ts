import { AgentState, ResolutionCourtSession, Rumour } from '@/types'

export class CourtPanel {
  public static readonly ACK_STORAGE_KEY = 'ai-town:acknowledged-courts:v1'
  private container: HTMLDivElement
  private content: HTMLDivElement
  private acknowledgedCourtIds: Set<string>
  private displayedCourtId: string | null = null
  private displayedCourt: ResolutionCourtSession | null = null
  private postVerdictContainer: HTMLDivElement

  constructor() {
    this.acknowledgedCourtIds = this.loadAcknowledgements()
    this.container = document.createElement('div')
    this.container.id = 'court-session-panel'
    this.container.setAttribute('role', 'dialog')
    this.container.setAttribute('aria-label', 'Resolution court in session')
    this.container.style.cssText = `
      position: fixed;
      top: 50%;
      left: 50%;
      transform: translate(-50%, -50%);
      width: min(560px, calc(100vw - 32px));
      max-height: min(68vh, 680px);
      display: none;
      flex-direction: column;
      background: rgba(20, 15, 12, 0.96);
      color: #f5efe6;
      border: 2px solid #a98252;
      border-radius: 8px;
      box-shadow: 0 10px 40px rgba(0, 0, 0, 0.72);
      font-family: 'Consolas', 'Monaco', monospace;
      font-size: 12px;
      overflow: hidden;
      z-index: 1200;
      pointer-events: auto;
    `
    this.container.innerHTML = `
      <div style="padding:10px 14px;background:rgba(105,75,45,.72);border-bottom:1px solid #a98252;">
        <div id="court-panel-title" style="color:#ffe0b2;font-size:15px;font-weight:bold;">Resolution Court in Session</div>
        <div id="court-panel-subtitle" style="color:#cdb99f;font-size:10px;margin-top:2px;">Live village proceeding</div>
      </div>`
    this.content = document.createElement('div')
    this.postVerdictContainer = this.createPostVerdictContainer()
    this.content.setAttribute('aria-live', 'polite')
    this.content.style.cssText = 'padding:12px 14px;overflow-y:auto;min-height:0;'
    this.container.appendChild(this.content)
    this.content.addEventListener('click', (event) => {
      const acknowledge = event.target instanceof Element
        ? event.target.closest<HTMLButtonElement>('[data-acknowledge-court]')
        : null
      if (!acknowledge || !this.displayedCourtId) return
      this.acknowledgedCourtIds.add(this.displayedCourtId)
      this.saveAcknowledgements()
      if (this.displayedCourt) this.showPostVerdictPopup(this.displayedCourt)
      this.displayedCourtId = null
      this.displayedCourt = null
      this.container.style.display = 'none'
    })
    document.body.appendChild(this.container)
    document.body.appendChild(this.postVerdictContainer)
  }

  public update(rumours: Rumour[], agents: AgentState[]): void {
    const activeRumour = rumours.find((rumour) =>
      rumour.resolutionCourt && rumour.resolutionCourt.status !== 'resolved'
    ) ?? [...rumours].reverse().find((rumour) =>
      rumour.resolutionCourt?.status === 'resolved' &&
      !this.acknowledgedCourtIds.has(rumour.resolutionCourt.id)
    )
    const court = activeRumour?.resolutionCourt
    if (!activeRumour || !court) {
      this.container.style.display = 'none'
      return
    }
    this.displayedCourtId = court.id
    this.displayedCourt = court

    const oldTop = this.content.scrollTop
    const wasNearBottom = this.content.scrollHeight - oldTop - this.content.clientHeight <= 24
    const names = new Map(agents.map((agent) => [agent.id, agent.name]))
    const claims = (court.rumourIds ?? [activeRumour.id])
      .map((id) => rumours.find((rumour) => rumour.id === id))
      .filter((rumour): rumour is Rumour => Boolean(rumour))
    const statusLabel = court.status === 'gathering'
      ? 'Gathering villagers'
      : court.status === 'voting'
        ? 'Statements and voting'
        : court.status === 'commenting'
          ? `Verdict: ${court.outcome ?? 'decided'} · awaiting response`
        : `Resolved: ${court.outcome ?? 'complete'}`
    const statusColor = court.status === 'gathering' ? '#ffcc80' : court.status === 'voting' ? '#81d4fa' : court.status === 'commenting' ? '#ce93d8' : '#81c784'
    const accusedName = court.accusedName ?? names.get(court.accusedAgentId) ?? court.accusedAgentId
    const votedIds = new Set(court.votes.map((vote) => vote.agentId))
    const waitingNames = court.participantIds
      .filter((id) => !votedIds.has(id))
      .map((id) => names.get(id) ?? id)
    const title = this.container.querySelector<HTMLElement>('#court-panel-title')
    const subtitle = this.container.querySelector<HTMLElement>('#court-panel-subtitle')
    if (title) title.textContent = court.status === 'resolved' ? 'Resolution Court Verdict' : 'Resolution Court in Session'
    if (subtitle) subtitle.textContent = court.status === 'resolved'
      ? 'The village has resumed. Review and acknowledge this verdict.'
      : 'Live village proceeding'

    this.content.innerHTML = `
      <div style="display:flex;justify-content:space-between;gap:12px;align-items:center;margin-bottom:9px;">
        <div><span style="color:#bca98f;">Accused:</span> <strong style="color:#ffcc80;">${this.escapeHtml(accusedName)}</strong></div>
        <span style="color:${statusColor};border:1px solid ${statusColor};border-radius:10px;padding:2px 7px;white-space:nowrap;">${statusLabel}</span>
      </div>
      <div style="padding:8px;background:rgba(255,255,255,.04);border-left:3px solid #a98252;margin-bottom:9px;">
        <div style="color:#d7c2a7;font-weight:bold;margin-bottom:4px;">Related accusations (${claims.length})</div>
        ${claims.map((rumour, index) => `<div style="margin-top:3px;"><span style="color:#8d7963;">${index + 1}.</span> ${this.escapeHtml(rumour.text)} <span style="color:#8d7963;">(${Math.round(rumour.credibility * 100)}%)</span></div>`).join('')}
      </div>
      <div style="color:#bca98f;margin-bottom:7px;">Vote progress: <span style="color:#fff;">${court.votes.length}/${court.participantIds.length}</span>${court.status !== 'resolved' && waitingNames.length ? ` · Waiting: ${waitingNames.map((name) => this.escapeHtml(name)).join(', ')}` : ''}</div>
      ${court.defenseStatement
        ? `<div style="padding:7px;margin-bottom:7px;background:rgba(255,224,178,.06);"><strong style="color:#ffcc80;">${this.escapeHtml(accusedName)}:</strong> “${this.escapeHtml(court.defenseStatement)}”</div>`
        : `<div style="color:#8d7963;margin-bottom:7px;">${court.status === 'gathering' ? 'Waiting for everyone to arrive at the town square…' : 'Waiting for the accused’s defense…'}</div>`}
      <div style="color:#d7c2a7;font-weight:bold;border-top:1px solid #4b3a2b;padding-top:7px;margin-bottom:4px;">Court activity</div>
      ${court.votes.length
        ? court.votes.map((vote) => `<div style="padding:6px 0;border-bottom:1px solid #352a21;"><span style="color:#90caf9;font-weight:bold;">${this.escapeHtml(names.get(vote.agentId) ?? vote.agentId)}</span>: “${this.escapeHtml(vote.statement)}” <span style="color:${this.voteColor(vote.choice)};font-weight:bold;">→ ${this.escapeHtml(vote.choice)}</span><div style="color:#9f9386;margin-top:2px;">Reason: ${this.escapeHtml(vote.reasoning)}</div></div>`).join('')
        : '<div style="color:#76695b;">No votes have been cast yet.</div>'}
      ${court.status === 'commenting' && !court.outcomeStatement ? `<div style="margin-top:9px;color:#ce93d8;">Waiting for ${this.escapeHtml(accusedName)} to respond to the verdict…</div>` : ''}
      ${court.outcomeStatement ? `<div style="margin-top:9px;padding:8px;background:rgba(206,147,216,.08);border-left:3px solid #ce93d8;"><strong style="color:#e1bee7;">${this.escapeHtml(accusedName)} after the verdict:</strong> “${this.escapeHtml(court.outcomeStatement)}”</div>` : ''}
      ${court.status === 'resolved' ? `
        <div style="margin-top:10px;padding:9px;background:rgba(129,199,132,.08);border:1px solid #557a57;color:#c8e6c9;"><strong>Verdict:</strong> ${this.escapeHtml(court.resolution ?? 'The proceeding has concluded.')}</div>
        <div style="display:flex;justify-content:flex-end;margin-top:10px;"><button data-acknowledge-court style="padding:6px 14px;border:0;border-radius:4px;background:#a98252;color:#fff;cursor:pointer;font:inherit;font-weight:bold;">Acknowledge</button></div>
      ` : ''}
    `
    this.container.style.display = 'flex'
    this.content.scrollTop = wasNearBottom ? this.content.scrollHeight : oldTop
  }

  private createPostVerdictContainer(): HTMLDivElement {
    const container = document.createElement('div')
    container.id = 'post-verdict-statements-panel'
    container.setAttribute('role', 'dialog')
    container.setAttribute('aria-label', 'Village post-verdict statements')
    container.style.cssText = `
      position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);
      width:min(580px,calc(100vw - 32px));max-height:min(70vh,700px);
      display:none;flex-direction:column;background:rgba(15,18,24,.97);color:#eef2f7;
      border:2px solid #607d8b;border-radius:8px;box-shadow:0 10px 40px rgba(0,0,0,.72);
      font-family:'Consolas','Monaco',monospace;font-size:12px;overflow:hidden;
      z-index:1201;pointer-events:auto;
    `
    container.addEventListener('click', (event) => {
      const close = event.target instanceof Element
        ? event.target.closest<HTMLButtonElement>('[data-close-post-verdict]')
        : null
      if (close) container.style.display = 'none'
    })
    return container
  }

  private showPostVerdictPopup(court: ResolutionCourtSession): void {
    const statements = court.postVerdictStatements ?? []
    this.postVerdictContainer.innerHTML = `
      <div style="padding:11px 14px;background:rgba(55,71,79,.82);border-bottom:1px solid #607d8b;">
        <div style="color:#eceff1;font-size:15px;font-weight:bold;">Village Post-Verdict Statements</div>
        <div style="color:#b0bec5;font-size:10px;margin-top:2px;">${this.escapeHtml(court.accusedName ?? court.accusedAgentId)} · ${this.escapeHtml(court.outcome ?? 'resolved')}</div>
      </div>
      <div style="padding:12px 14px;overflow-y:auto;min-height:0;">
        <div style="color:#cfd8dc;margin-bottom:9px;">${this.escapeHtml(court.resolution ?? 'The court has concluded.')}</div>
        ${statements.length
          ? statements.map((statement) => `<div style="padding:8px 0;border-bottom:1px solid #263238;"><strong style="color:${statement.agentId === court.accusedAgentId ? '#ce93d8' : '#90caf9'};">${this.escapeHtml(statement.agentName)}</strong>: “${this.escapeHtml(statement.statement)}”</div>`).join('')
          : '<div style="color:#78909c;">No post-verdict statements were recorded.</div>'}
        <div style="display:flex;justify-content:flex-end;margin-top:12px;"><button data-close-post-verdict style="padding:6px 14px;border:0;border-radius:4px;background:#607d8b;color:#fff;cursor:pointer;font:inherit;font-weight:bold;">Close</button></div>
      </div>
    `
    this.postVerdictContainer.style.display = 'flex'
  }

  private voteColor(choice: 'absolve' | 'exile' | 'execute'): string {
    return choice === 'absolve' ? '#81c784' : choice === 'exile' ? '#ffb74d' : '#ef5350'
  }

  private loadAcknowledgements(): Set<string> {
    try {
      const saved = JSON.parse(localStorage.getItem(CourtPanel.ACK_STORAGE_KEY) ?? '[]')
      return new Set(Array.isArray(saved) ? saved : [])
    } catch {
      return new Set()
    }
  }

  private saveAcknowledgements(): void {
    try {
      localStorage.setItem(
        CourtPanel.ACK_STORAGE_KEY,
        JSON.stringify(Array.from(this.acknowledgedCourtIds))
      )
    } catch (error) {
      console.warn('[CourtPanel] Could not save court acknowledgement:', error)
    }
  }

  private escapeHtml(value: string): string {
    return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#039;')
  }
}
