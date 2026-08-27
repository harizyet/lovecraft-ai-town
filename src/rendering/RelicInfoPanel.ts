import { ForbiddenRelic } from '@/types'

export class RelicInfoPanel {
  private container: HTMLDivElement

  constructor() {
    this.container = document.createElement('div')
    this.container.id = 'relic-info-panel'
    this.container.setAttribute('role', 'dialog')
    this.container.setAttribute('aria-label', 'Relic details')
    this.container.style.cssText = `
      position: fixed;
      top: 50%;
      left: 50%;
      transform: translate(-50%, -50%);
      width: min(420px, calc(100vw - 32px));
      max-height: min(72vh, 560px);
      display: none;
      flex-direction: column;
      background: rgba(10, 8, 22, 0.97);
      color: #f1eaff;
      border: 2px solid #8a6d3b;
      border-radius: 8px;
      box-shadow: 0 10px 48px rgba(0, 0, 0, 0.8);
      font-family: 'Consolas', 'Monaco', monospace;
      font-size: 12px;
      overflow: hidden;
      z-index: 1220;
      pointer-events: auto;
    `
    this.container.innerHTML = `
      <div style="padding:10px 14px;background:rgba(90,60,20,.5);border-bottom:1px solid #8a6d3b;">
        <div id="relic-info-title" style="color:#f0d9a8;font-size:15px;font-weight:bold;"></div>
        <div id="relic-info-subtitle" style="color:#c9b28a;font-size:10px;margin-top:2px;"></div>
      </div>
      <div id="relic-info-body" style="padding:12px 14px;overflow-y:auto;min-height:80px;flex:1;"></div>
      <div style="padding:0 14px 12px;display:flex;justify-content:flex-end;">
        <button id="relic-info-close" style="padding:6px 14px;border:0;border-radius:4px;background:#555;color:#fff;cursor:pointer;font:inherit;font-weight:bold;">Close</button>
      </div>
    `
    this.container.querySelector<HTMLButtonElement>('#relic-info-close')!
      .addEventListener('click', () => this.close())

    document.body.appendChild(this.container)
  }

  public open(relic: ForbiddenRelic): void {
    const title = this.container.querySelector<HTMLElement>('#relic-info-title')!
    const subtitle = this.container.querySelector<HTMLElement>('#relic-info-subtitle')!
    const body = this.container.querySelector<HTMLElement>('#relic-info-body')!

    title.textContent = relic.title || 'Untitled Relic'
    subtitle.textContent = `Left behind by ${relic.authorName}`

    const rows: string[] = []
    if (relic.deityName) {
      rows.push(this.row('Deity', relic.deityName))
    }
    if (relic.cultName) {
      rows.push(this.row('Cult', relic.cultName))
    }
    rows.push(this.row(
      'Nature',
      relic.containsForbiddenKnowledge
        ? `Forbidden knowledge (severity ${relic.severity})`
        : 'Mundane writings'
    ))
    rows.push(this.row(
      'Discovered by',
      relic.discoveredByAgentIds.length > 0
        ? `${relic.discoveredByAgentIds.length} villager(s)`
        : 'No one yet'
    ))

    body.innerHTML = `
      ${rows.join('')}
      <div style="margin-top:10px;padding:9px;background:rgba(138,109,59,.12);border-left:3px solid #8a6d3b;color:#f1eaff;white-space:pre-wrap;">${this.escapeHtml(relic.text)}</div>
    `

    this.container.style.display = 'flex'
  }

  public close(): void {
    this.container.style.display = 'none'
  }

  public isOpen(): boolean {
    return this.container.style.display !== 'none'
  }

  private row(label: string, value: string): string {
    return `<div style="padding:2px 0;"><span style="color:#c9b28a;">${this.escapeHtml(label)}:</span> ${this.escapeHtml(value)}</div>`
  }

  private escapeHtml(value: string): string {
    return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#039;')
  }
}
