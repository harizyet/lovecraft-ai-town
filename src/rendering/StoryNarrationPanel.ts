import { StoryMoment } from '@/types'

export class StoryNarrationPanel {
  public static readonly ACK_STORAGE_KEY = 'ai-town:acknowledged-story-moments:v1'
  private container: HTMLDivElement
  private content: HTMLDivElement
  private acknowledgedIds: Set<string>
  private displayedId: string | null = null

  constructor() {
    this.acknowledgedIds = this.loadAcknowledgements()
    this.container = document.createElement('div')
    this.container.id = 'story-narration-panel'
    this.container.setAttribute('role', 'dialog')
    this.container.setAttribute('aria-label', 'Village chronicle')
    this.container.style.cssText = `
      position: fixed;
      top: 50%;
      left: 50%;
      transform: translate(-50%, -50%);
      width: min(560px, calc(100vw - 32px));
      max-height: min(68vh, 640px);
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
      z-index: 1230;
      pointer-events: auto;
    `
    this.container.innerHTML = `
      <div style="padding:12px 16px;background:rgba(40,48,32,.7);border-bottom:1px solid #5a6b4f;">
        <div id="story-panel-title" style="color:#c9c19a;font-size:16px;font-weight:bold;letter-spacing:.5px;font-style:italic;">From the Village Chronicle</div>
        <div id="story-panel-subtitle" style="color:#8b9178;font-size:10px;margin-top:3px;font-family:'Consolas','Monaco',monospace;"></div>
      </div>
      <div id="story-panel-content" style="padding:16px 18px;overflow-y:auto;min-height:0;flex:1;line-height:1.6;"></div>
      <div style="padding:0 16px 14px;display:flex;justify-content:flex-end;">
        <button id="story-panel-ack" style="padding:6px 16px;border:0;border-radius:4px;background:#5a6b4f;color:#e8e4d0;cursor:pointer;font:inherit;font-weight:bold;">Acknowledge</button>
      </div>
    `
    this.content = this.container.querySelector<HTMLDivElement>('#story-panel-content')!
    const closeButton = this.container.querySelector<HTMLButtonElement>('#story-panel-ack')!
    closeButton.addEventListener('click', () => {
      if (this.displayedId) {
        this.acknowledgedIds.add(this.displayedId)
        this.saveAcknowledgements()
      }
      this.container.style.display = 'none'
      this.displayedId = null
    })
    document.body.appendChild(this.container)
  }

  public update(moments: StoryMoment[]): void {
    // Forward order, not reversed: moments are pushed in the order they were
    // triggered (e.g. priest_corrupted, then church_corrupted, then
    // flock_corrupted, all from the same event), and popups should surface
    // in that same order. Whichever moment happens to finish its LLM
    // narration first can otherwise jump the queue and bump an older,
    // still-unacknowledged popup off screen.
    const moment = moments.find((candidate) =>
      candidate.status === 'ready' && !this.acknowledgedIds.has(candidate.id)
    )
    if (!moment) return
    if (this.displayedId === moment.id) return
    this.displayedId = moment.id

    const title = this.container.querySelector<HTMLElement>('#story-panel-title')
    const subtitle = this.container.querySelector<HTMLElement>('#story-panel-subtitle')
    // headline is the LLM-generated, Lovecraft-inspired title for this
    // specific moment; title is the short code-supplied context label (e.g.
    // a cult or relic name) -- kept as the subtitle so a moment's origin
    // stays traceable for debugging even though the display title is prose.
    if (title) title.textContent = moment.headline || 'From the Village Chronicle'
    if (subtitle) subtitle.textContent = moment.title
    this.content.innerHTML = this.renderParagraphs(moment.narrative)
    this.container.style.display = 'flex'
  }

  private renderParagraphs(narrative: string): string {
    return narrative
      .split(/\n{2,}/)
      .map((paragraph) => paragraph.trim())
      .filter(Boolean)
      .map((paragraph) => `<div style="text-indent:1.4em;margin-top:8px;">${this.escapeHtml(paragraph)}</div>`)
      .join('')
  }

  private loadAcknowledgements(): Set<string> {
    try {
      const saved = JSON.parse(localStorage.getItem(StoryNarrationPanel.ACK_STORAGE_KEY) ?? '[]')
      return new Set(Array.isArray(saved) ? saved : [])
    } catch {
      return new Set()
    }
  }

  private saveAcknowledgements(): void {
    try {
      localStorage.setItem(
        StoryNarrationPanel.ACK_STORAGE_KEY,
        JSON.stringify(Array.from(this.acknowledgedIds))
      )
    } catch (error) {
      console.warn('[StoryNarrationPanel] Could not save acknowledgements:', error)
    }
  }

  private escapeHtml(value: string): string {
    return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#039;')
  }
}
