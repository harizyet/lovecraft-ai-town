import { StoryMoment } from '@/types'

export class StoryLogPanel {
  private container: HTMLDivElement
  private list: HTMLDivElement
  private visible = false
  private lastMoments: StoryMoment[] = []

  constructor() {
    this.container = document.createElement('div')
    this.container.id = 'story-log-panel'
    this.container.setAttribute('role', 'dialog')
    this.container.setAttribute('aria-label', 'Village chronicle archive')
    this.container.style.cssText = `
      position: fixed;
      top: 50%;
      left: 50%;
      transform: translate(-50%, -50%);
      width: min(680px, calc(100vw - 32px));
      max-height: min(78vh, 720px);
      display: none;
      flex-direction: column;
      background: rgba(8, 10, 8, 0.97);
      color: #d8d2c0;
      border: 2px solid #5a6b4f;
      border-radius: 4px;
      box-shadow: 0 10px 48px rgba(0, 0, 0, 0.85);
      font-family: Georgia, 'Times New Roman', serif;
      font-size: 13px;
      overflow: hidden;
      z-index: 1240;
      pointer-events: auto;
    `
    this.container.innerHTML = `
      <div style="padding:12px 16px;background:rgba(40,48,32,.7);border-bottom:1px solid #5a6b4f;display:flex;justify-content:space-between;align-items:center;gap:12px;">
        <div>
          <div style="color:#c9c19a;font-size:16px;font-weight:bold;letter-spacing:.5px;font-style:italic;">The Village Chronicle</div>
          <div id="story-log-count" style="color:#8b9178;font-size:10px;margin-top:3px;font-family:'Consolas','Monaco',monospace;"></div>
        </div>
        <button id="story-log-close" aria-label="Close chronicle" style="border:0;border-radius:4px;background:#31392a;color:#d8d2c0;cursor:pointer;padding:6px 10px;font:inherit;">Close</button>
      </div>
      <div id="story-log-list" style="padding:16px 18px;overflow-y:auto;min-height:0;flex:1;line-height:1.6;"></div>
    `
    this.list = this.container.querySelector<HTMLDivElement>('#story-log-list')!
    this.container.querySelector<HTMLButtonElement>('#story-log-close')!.addEventListener('click', () => this.hide())
    window.addEventListener('debug-toggle-story-log', () => this.toggle())
    document.body.appendChild(this.container)
  }

  public update(moments: StoryMoment[]): void {
    this.lastMoments = moments
    if (this.visible) this.render(moments)
  }

  private toggle(): void {
    if (this.visible) this.hide()
    else this.show()
  }

  private show(): void {
    this.visible = true
    this.container.style.display = 'flex'
    this.render(this.lastMoments)
  }

  private hide(): void {
    this.visible = false
    this.container.style.display = 'none'
  }

  private render(moments: StoryMoment[]): void {
    const readyMoments = moments.filter((moment) => moment.status === 'ready')
    const count = this.container.querySelector<HTMLElement>('#story-log-count')
    if (count) count.textContent = `${readyMoments.length} ${readyMoments.length === 1 ? 'entry' : 'entries'} recorded`

    this.list.innerHTML = readyMoments.length
      ? readyMoments.map((moment) => `
        <div style="padding:10px 0;border-bottom:1px solid #2a3222;">
          <div style="display:flex;justify-content:space-between;align-items:baseline;gap:10px;margin-bottom:1px;">
            <span style="color:#c9c19a;font-weight:bold;font-style:italic;">${this.escapeHtml(moment.headline || moment.title)}</span>
            <span style="color:#6f7a5f;font-size:10px;font-family:'Consolas','Monaco',monospace;white-space:nowrap;">minute ${moment.createdAtMinute}</span>
          </div>
          <div style="color:#6f7a5f;font-size:10px;font-family:'Consolas','Monaco',monospace;margin-bottom:5px;">${this.escapeHtml(moment.kind)} -- ${this.escapeHtml(moment.title)}</div>
          ${this.renderParagraphs(moment.narrative)}
        </div>
      `).join('')
      : '<div style="color:#555;text-align:center;padding:30px 0;">No stories have been chronicled yet.</div>'
  }

  private renderParagraphs(narrative: string): string {
    return narrative
      .split(/\n{2,}/)
      .map((paragraph) => paragraph.trim())
      .filter(Boolean)
      .map((paragraph) => `<div style="text-indent:1.4em;margin-top:8px;">${this.escapeHtml(paragraph)}</div>`)
      .join('')
  }

  private escapeHtml(value: string): string {
    return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#039;')
  }
}
