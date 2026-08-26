import { AgentState, PolicySession } from '@/types'

export class PolicyPanel {
  public static readonly ACK_STORAGE_KEY = 'ai-town:acknowledged-policy-votes:v1'
  private container: HTMLDivElement
  private content: HTMLDivElement
  private acknowledgedSessionIds: Set<string>
  private displayedSessionId: string | null = null

  constructor() {
    this.acknowledgedSessionIds = this.loadAcknowledgements()
    this.container = document.createElement('div')
    this.container.id = 'policy-vote-panel'
    this.container.setAttribute('role', 'dialog')
    this.container.setAttribute('aria-label', 'Village assembly in session')
    this.container.style.cssText = `
      position: fixed;
      top: 50%;
      left: 50%;
      transform: translate(-50%, -50%);
      width: min(480px, calc(100vw - 32px));
      max-height: min(68vh, 640px);
      display: none;
      flex-direction: column;
      background: rgba(12, 18, 22, 0.96);
      color: #eef4f0;
      border: 2px solid #5a8f6e;
      border-radius: 8px;
      box-shadow: 0 10px 40px rgba(0, 0, 0, 0.72);
      font-family: 'Consolas', 'Monaco', monospace;
      font-size: 12px;
      overflow: hidden;
      z-index: 1190;
      pointer-events: auto;
    `
    this.container.innerHTML = `
      <div style="padding:10px 14px;background:rgba(45,80,60,.72);border-bottom:1px solid #5a8f6e;">
        <div id="policy-panel-title" style="color:#c8f5d8;font-size:15px;font-weight:bold;">Village Assembly</div>
        <div id="policy-panel-subtitle" style="color:#a9c9b6;font-size:10px;margin-top:2px;">Live policy vote</div>
      </div>`
    this.content = document.createElement('div')
    this.content.setAttribute('aria-live', 'polite')
    this.content.style.cssText = 'padding:12px 14px;overflow-y:auto;min-height:0;'
    this.container.appendChild(this.content)
    this.content.addEventListener('click', (event) => {
      const acknowledge = event.target instanceof Element
        ? event.target.closest<HTMLButtonElement>('[data-acknowledge-policy]')
        : null
      if (!acknowledge || !this.displayedSessionId) return
      this.acknowledgedSessionIds.add(this.displayedSessionId)
      this.saveAcknowledgements()
      this.displayedSessionId = null
      this.container.style.display = 'none'
    })
    document.body.appendChild(this.container)
  }

  public update(sessions: PolicySession[], agents: AgentState[]): void {
    const session = sessions.find((candidate) => candidate.status !== 'resolved') ??
      [...sessions].reverse().find((candidate) =>
        candidate.status === 'resolved' && !this.acknowledgedSessionIds.has(candidate.id)
      )
    if (!session) {
      this.container.style.display = 'none'
      return
    }
    this.displayedSessionId = session.id

    const oldTop = this.content.scrollTop
    const wasNearBottom = this.content.scrollHeight - oldTop - this.content.clientHeight <= 24
    const names = new Map(agents.map((agent) => [agent.id, agent.name]))
    const statusLabel = session.status === 'gathering'
      ? 'Gathering villagers'
      : session.status === 'voting'
        ? 'Statements and voting'
        : `Resolved: ${session.outcome ?? 'complete'}`
    const statusColor = session.status === 'gathering'
      ? '#ffcc80'
      : session.status === 'voting'
        ? '#81d4fa'
        : session.outcome === 'passed' ? '#81c784' : '#ef5350'
    const votedIds = new Set(session.votes.map((vote) => vote.agentId))
    const waitingNames = session.participantIds
      .filter((id) => !votedIds.has(id))
      .map((id) => names.get(id) ?? id)
    const convenerName = session.convenerName ?? names.get(session.convenerAgentId) ?? session.convenerAgentId
    const supportCount = session.votes.filter((vote) => vote.choice === 'support').length
    const opposeCount = session.votes.length - supportCount

    const title = this.container.querySelector<HTMLElement>('#policy-panel-title')
    const subtitle = this.container.querySelector<HTMLElement>('#policy-panel-subtitle')
    if (title) title.textContent = session.status === 'resolved' ? 'Village Assembly Result' : 'Village Assembly'
    if (subtitle) subtitle.textContent = session.status === 'resolved'
      ? 'The village has resumed. Review and acknowledge this outcome.'
      : `Convened by ${convenerName}`

    this.content.innerHTML = `
      <div style="display:flex;justify-content:space-between;gap:12px;align-items:center;margin-bottom:9px;">
        <div style="color:#dceee2;font-weight:bold;">${this.escapeHtml(session.question)}</div>
        <span style="color:${statusColor};border:1px solid ${statusColor};border-radius:10px;padding:2px 7px;white-space:nowrap;">${statusLabel}</span>
      </div>
      <div style="padding:8px;background:rgba(255,255,255,.04);border-left:3px solid #5a8f6e;margin-bottom:9px;">
        ${this.escapeHtml(session.description)}
        <div style="margin-top:4px;color:#8fbfa1;">${session.effect && session.effect !== 'wealth' && session.effectSummary
          ? this.escapeHtml(session.effectSummary)
          : `If passed, every living <strong>${this.escapeHtml(session.targetJob)}</strong> gains ${session.wealthDelta} wealth.`}</div>
      </div>
      <div style="color:#a9c9b6;margin-bottom:7px;">Votes: <span style="color:#81c784;">${supportCount} support</span> · <span style="color:#ef5350;">${opposeCount} oppose</span> · <span style="color:#fff;">${session.votes.length}/${session.participantIds.length}</span>${session.status !== 'resolved' && waitingNames.length ? ` · Waiting: ${waitingNames.map((name) => this.escapeHtml(name)).join(', ')}` : ''}</div>
      <div style="color:#d0e6d8;font-weight:bold;border-top:1px solid #2a3d33;padding-top:7px;margin-bottom:4px;">Assembly activity</div>
      ${session.votes.length
        ? session.votes.map((vote) => `<div style="padding:6px 0;border-bottom:1px solid #21302a;"><span style="color:#90caf9;font-weight:bold;">${this.escapeHtml(names.get(vote.agentId) ?? vote.agentId)}</span>: “${this.escapeHtml(vote.statement)}” <span style="color:${vote.choice === 'support' ? '#81c784' : '#ef5350'};font-weight:bold;">→ ${this.escapeHtml(vote.choice)}</span><div style="color:#9fb0a6;margin-top:2px;">Reason: ${this.escapeHtml(vote.reasoning)}</div></div>`).join('')
        : '<div style="color:#6b7d72;">No votes have been cast yet.</div>'}
      ${session.status === 'resolved' ? `
        <div style="margin-top:10px;padding:9px;background:rgba(${session.outcome === 'passed' ? '129,199,132' : '239,83,80'},.08);border:1px solid ${session.outcome === 'passed' ? '#557a57' : '#7a5555'};color:#e3ede6;"><strong>Outcome:</strong> ${this.escapeHtml(session.resolution ?? 'The assembly has concluded.')}</div>
        <div style="display:flex;justify-content:flex-end;margin-top:10px;"><button data-acknowledge-policy style="padding:6px 14px;border:0;border-radius:4px;background:#5a8f6e;color:#fff;cursor:pointer;font:inherit;font-weight:bold;">Acknowledge</button></div>
      ` : ''}
    `
    this.container.style.display = 'flex'
    this.content.scrollTop = wasNearBottom ? this.content.scrollHeight : oldTop
  }

  private loadAcknowledgements(): Set<string> {
    try {
      const saved = JSON.parse(localStorage.getItem(PolicyPanel.ACK_STORAGE_KEY) ?? '[]')
      return new Set(Array.isArray(saved) ? saved : [])
    } catch {
      return new Set()
    }
  }

  private saveAcknowledgements(): void {
    try {
      localStorage.setItem(
        PolicyPanel.ACK_STORAGE_KEY,
        JSON.stringify(Array.from(this.acknowledgedSessionIds))
      )
    } catch (error) {
      console.warn('[PolicyPanel] Could not save policy vote acknowledgement:', error)
    }
  }

  private escapeHtml(value: string): string {
    return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#039;')
  }
}
