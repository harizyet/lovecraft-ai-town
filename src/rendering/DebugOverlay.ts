import {
  AgentState,
  EmotionalState,
  LLMRequestStatus,
  SIMULATION_SPEEDS,
  Rumour,
  AgentDebugDetails,
  PoliticalCampId,
} from '@/types'
import { EventBus } from '@/interaction/EventBus'
import { getJobIcon } from '@/utils/JobIcons'

export class DebugOverlay {
  private container: HTMLDivElement
  private agentPanel: HTMLDivElement
  private rumourTrackerPanel: HTMLDivElement
  private controlsPanel: HTMLDivElement
  private godAbilityConfirmPanel: HTMLDivElement
  private pendingGodAbility: 'bless' | 'heal' | 'smite' | 'resurrect' | 'manifest' | 'weather' | 'speak' | 'dream' | 'create_relic' | null
  private agentDetailsPanel: HTMLDivElement
  private cultTrackerPanel: HTMLDivElement
  private cultDetailsPanel: HTMLDivElement
  private factionDetailsPanel: HTMLDivElement
  private visible: boolean
  private eventBus: EventBus
  private selectedAgentId: string | undefined
  private speedMultiplier: number
  private expandedRumourClusterIds: Set<string>
  private openAgentDetailsId: string | null
  private openCultDetailsId: string | null
  private openFactionDetailsId: PoliticalCampId | null
  private latestAgents: AgentState[]
  private latestAgentDetails: Record<string, AgentDebugDetails>
  private latestActivityStatuses: Record<string, string>
  private latestLLMStatuses: Record<string, LLMRequestStatus>
  private latestSimulationMinute: number

  constructor(eventBus: EventBus) {
    this.eventBus = eventBus
    this.visible = true
    this.selectedAgentId = undefined
    this.speedMultiplier = 1
    this.expandedRumourClusterIds = new Set()
    this.openAgentDetailsId = null
    this.openCultDetailsId = null
    this.openFactionDetailsId = null
    this.pendingGodAbility = null
    this.latestAgents = []
    this.latestAgentDetails = {}
    this.latestActivityStatuses = {}
    this.latestLLMStatuses = {}
    this.latestSimulationMinute = 0

    this.container = this.createContainer()
    this.rumourTrackerPanel = this.createRumourTrackerPanel()
    this.agentPanel = this.createAgentPanel()
    this.controlsPanel = this.createControlsPanel()
    this.godAbilityConfirmPanel = this.createGodAbilityConfirmPanel()
    this.agentDetailsPanel = this.createAgentDetailsPanel()
    this.cultDetailsPanel = this.createCultDetailsPanel()
    this.factionDetailsPanel = this.createFactionDetailsPanel()
    this.cultTrackerPanel = this.createCultTrackerPanel()

    this.container.appendChild(this.agentPanel)
    document.body.appendChild(this.controlsPanel)
    document.body.appendChild(this.godAbilityConfirmPanel)

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
      transform: translateX(0);
      transition: transform 0.3s ease;
      z-index: 1000;
      border-left: 2px solid #333;
    `
    document.body.appendChild(container)
    return container
  }

  private createRumourTrackerPanel(): HTMLDivElement {
    const panel = document.createElement('div')
    panel.id = 'rumour-belief-tracker'
    panel.style.cssText = `
      position: fixed;
      bottom: 15px;
      left: 15px;
      width: min(360px, calc(100vw - 24px));
      max-height: min(56vh, 620px);
      display: flex;
      flex-direction: column;
      display: flex;
      flex-direction: column;
      background: rgba(12, 10, 22, 0.92);
      color: #fff;
      border: 1px solid #5e4b7d;
      border-radius: 7px;
      box-shadow: 0 6px 24px rgba(0, 0, 0, 0.45);
      font-family: 'Consolas', 'Monaco', monospace;
      font-size: 11px;
      overflow: hidden;
      z-index: 1000;
    `
    panel.innerHTML = `
      <div style="display:flex;align-items:center;justify-content:space-between;padding:9px 10px;background:rgba(65,45,90,.72);border-bottom:1px solid #5e4b7d;">
        <div><span style="color:#e1bee7;font-weight:bold;">Rumour &amp; Belief Tracker</span><div style="color:#a995bd;font-size:10px;margin-top:2px;">Claims, private thoughts, and changing beliefs</div></div>
        <button id="rumour-tracker-toggle" aria-label="Collapse rumour tracker" style="border:0;border-radius:3px;background:#31263f;color:#ddd;cursor:pointer;padding:3px 7px;">−</button>
      </div>
      <div id="rumour-tracker-content" style="min-height:0;overflow-y:auto;padding:8px 10px;">
        <div id="rumour-tracker-tabs" role="tablist" style="display:flex;gap:5px;margin-bottom:8px;position:sticky;top:0;background:#120f18;padding-bottom:6px;z-index:2;">
          <button data-rumour-tab="rumours" aria-selected="true" style="flex:1;padding:4px;border:0;border-radius:3px;background:#6a4b86;color:#fff;cursor:pointer;font:inherit;">Rumours &amp; Beliefs</button>
          <button data-rumour-tab="court" aria-selected="false" style="flex:1;padding:4px;border:0;border-radius:3px;background:#31263f;color:#bbb;cursor:pointer;font:inherit;">Court Readiness</button>
        </div>
        <div id="rumour-tab-content">
        <div style="padding-bottom:8px;margin-bottom:4px;border-bottom:1px solid #4a385d;">
          <div style="color:#ce93d8;font-weight:bold;margin-bottom:6px;">Plant a whisper</div>
          <div style="display:flex;gap:6px;margin-bottom:6px;">
            <select id="debug-whisper-target" style="min-width:0;flex:1;padding:5px;background:#221b2b;color:#fff;border:1px solid #5e4b7d;border-radius:3px;"><option value="all">Entire town</option></select>
            <button id="debug-whisper-send" style="padding:5px 10px;background:#7e57c2;color:#fff;border:0;cursor:pointer;border-radius:3px;">Whisper</button>
          </div>
          <label style="display:flex;align-items:center;gap:6px;margin-bottom:6px;color:#aaa;">Initial credibility <input id="debug-whisper-credibility" type="number" min="0" max="100" step="1" value="50" style="width:58px;padding:4px 5px;background:#221b2b;color:#fff;border:1px solid #5e4b7d;border-radius:3px;">%</label>
          <input id="debug-whisper-source" type="text" maxlength="160" placeholder="Suggested source: God, Dagon, Cthulhu, a dream, a witness..." style="box-sizing:border-box;width:100%;margin-bottom:6px;padding:5px 6px;background:#221b2b;color:#fff;border:1px solid #5e4b7d;border-radius:3px;">
          <textarea id="debug-whisper-text" maxlength="500" placeholder="Plant an unverified rumour..." style="box-sizing:border-box;width:100%;min-height:50px;padding:6px;resize:vertical;background:#221b2b;color:#fff;border:1px solid #5e4b7d;border-radius:3px;"></textarea>
          <div id="debug-whisper-status" style="min-height:16px;color:#777;margin-top:3px;"></div>
          <div id="debug-rumour-list" style="display:none;"></div>
        </div>
        <div id="rumour-tracker-rumours"></div>
        <div style="color:#ce93d8;font-weight:bold;margin:10px 0 5px;border-top:1px solid #332842;padding-top:8px;">Thought timeline</div>
        <div id="rumour-tracker-thoughts" style="display:flex;flex-direction:column;gap:5px;"></div>
        </div>
        <div id="court-readiness-content" style="display:none;"></div>
      </div>
    `
    this.setupWhisperControls(panel)
    panel.addEventListener('change', (event) => {
      const checkbox = event.target instanceof HTMLInputElement
        ? event.target.closest<HTMLInputElement>('[data-whisper-truth]')
        : null
      const rumourId = checkbox?.dataset.whisperTruth
      if (!checkbox || !rumourId) return
      window.dispatchEvent(new CustomEvent('debug-rumour-truth', {
        detail: { rumourId, groundTruth: checkbox.checked },
      }))
    })

    const content = panel.querySelector<HTMLElement>('#rumour-tracker-content')
    const rumourTabContent = panel.querySelector<HTMLElement>('#rumour-tab-content')
    const courtTabContent = panel.querySelector<HTMLElement>('#court-readiness-content')
    const tabs = panel.querySelector<HTMLElement>('#rumour-tracker-tabs')
    tabs?.addEventListener('click', (event) => {
      const button = event.target instanceof Element
        ? event.target.closest<HTMLButtonElement>('[data-rumour-tab]')
        : null
      const tab = button?.dataset.rumourTab
      if ((tab !== 'rumours' && tab !== 'court') || !rumourTabContent || !courtTabContent) return
      rumourTabContent.style.display = tab === 'rumours' ? 'block' : 'none'
      courtTabContent.style.display = tab === 'court' ? 'block' : 'none'
      tabs.querySelectorAll<HTMLButtonElement>('[data-rumour-tab]').forEach((candidate) => {
        const selected = candidate.dataset.rumourTab === tab
        candidate.setAttribute('aria-selected', String(selected))
        candidate.style.background = selected ? (tab === 'court' ? '#8a6338' : '#6a4b86') : '#31263f'
        candidate.style.color = selected ? '#fff' : '#bbb'
      })
      if (content) content.scrollTop = 0
    })
    const toggle = panel.querySelector<HTMLButtonElement>('#rumour-tracker-toggle')
    toggle?.addEventListener('click', () => {
      if (!content || !toggle) return
      const collapsed = content.style.display === 'none'
      content.style.display = collapsed ? 'block' : 'none'
      toggle.textContent = collapsed ? '−' : '+'
      toggle.setAttribute('aria-label', collapsed ? 'Collapse rumour tracker' : 'Expand rumour tracker')
    })
    panel.addEventListener('click', (event) => {
      const agentTarget = event.target instanceof Element
        ? event.target.closest<HTMLElement>('[data-agent-id]')
        : null
      if (!agentTarget?.dataset.agentId) return
      window.dispatchEvent(new CustomEvent('debug-select-agent', {
        detail: { agentId: agentTarget.dataset.agentId },
      }))
    })
    document.body.appendChild(panel)
    return panel
  }

  private createControlsPanel(): HTMLDivElement {
    const panel = document.createElement('div')
    panel.style.cssText = `
      position: fixed;
      top: 12px;
      left: 50%;
      transform: translateX(-50%);
      width: min(1100px, calc(100vw - 24px));
      display: grid;
      grid-template-columns: minmax(250px, 1fr) minmax(260px, auto) minmax(250px, 1fr);
      gap: 10px;
      align-items: start;
      color: #fff;
      font-family: 'Consolas', 'Monaco', monospace;
      font-size: 12px;
      z-index: 1001;
    `

    panel.innerHTML = `
      <section style="padding:10px;border:1px solid #6d5d32;border-radius:6px;background:rgba(35,30,20,.94);">
        <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;color:#ffd54f;">
          <strong>Deity abilities</strong>
          <div style="display:flex;align-items:center;gap:6px;">
            <span id="god-invocation-count">0 invocations</span>
            <button id="god-abilities-toggle" aria-label="Expand deity abilities" aria-expanded="false" style="border:0;border-radius:3px;background:#51482d;color:#ddd;cursor:pointer;padding:3px 7px;">+</button>
          </div>
        </div>
        <div id="god-abilities-content" style="display:none;">
          <div id="god-invocation-source" style="max-width:420px;margin:3px 0 6px;color:#9e8f67;font-size:10px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">Waiting for worship directed toward a deity.</div>
          <div style="display:flex;gap:5px;flex-wrap:wrap;">
            ${['bless', 'heal', 'smite', 'resurrect', 'manifest', 'weather', 'speak', 'dream', 'create_relic'].map((ability) => `<button data-god-ability="${ability}" disabled style="padding:4px 8px;border:0;border-radius:3px;background:#51482d;color:#8d8469;cursor:not-allowed;text-transform:capitalize;">${ability.replace(/_/g, ' ')}</button>`).join('')}
          </div>
          <div id="god-ability-status" style="min-height:14px;margin-top:4px;color:#9e9e9e;font-size:10px;"></div>
        </div>
      </section>
      <section style="padding:10px;border:1px solid #444;border-radius:6px;background:rgba(30,30,30,.94);">
        <h3 style="margin:0 0 10px;color:#4ecdc4;">Simulation Controls</h3>
        <div style="display:flex;gap:8px;flex-wrap:wrap;justify-content:center;">
          <button id="debug-pause" style="padding:4px 12px;background:#4ecdc4;border:none;color:#000;cursor:pointer;border-radius:3px;">Pause</button>
          <button id="debug-speed" style="padding:4px 12px;background:#555;border:none;color:#fff;cursor:pointer;border-radius:3px;">Speed: 1x</button>
          <button id="debug-refresh-agents" style="padding:4px 12px;background:#1565c0;border:none;color:#fff;cursor:pointer;border-radius:3px;">Refresh Agents</button>
          <button id="debug-reset-village" style="padding:4px 12px;background:#b71c1c;border:none;color:#fff;cursor:pointer;border-radius:3px;">Reset Village State</button>
        </div>
        <div id="debug-refresh-agents-status" style="min-height:14px;margin-top:4px;color:#90caf9;font-size:10px;"></div>
      </section>
      <section style="padding:10px;border:1px solid #5b2630;border-radius:6px;background:rgba(38,18,22,.94);">
        <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;color:#ef9a9a;">
          <strong>Demon summon</strong>
          <div style="display:flex;align-items:center;gap:6px;">
            <span id="demon-summon-count">0 charges</span>
            <button id="demon-summon-toggle" aria-label="Expand demon summon" aria-expanded="false" style="border:0;border-radius:3px;background:#4a252a;color:#ddd;cursor:pointer;padding:3px 7px;">+</button>
          </div>
        </div>
        <div id="demon-summon-content" style="display:none;">
          <div id="demon-summon-progress-label" style="margin:4px 0 3px;color:#bcaaa4;font-size:10px;">No summoning ritual active.</div>
          <div role="progressbar" aria-label="Demon summoning progress" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0" style="height:9px;background:#241316;border:1px solid #6d3038;border-radius:5px;overflow:hidden;">
            <div id="demon-summon-progress-fill" style="width:0%;height:100%;background:linear-gradient(90deg,#7f0000,#ff3d00);transition:width 160ms linear;"></div>
          </div>
          <input id="demon-command-prompt" type="text" maxlength="240" placeholder="Command the unique Demon, e.g. attack Marcus River" style="box-sizing:border-box;width:100%;margin:4px 0 5px;padding:5px;background:#2b171a;color:#fff;border:1px solid #7f3540;border-radius:3px;">
          <div style="display:flex;gap:5px;">
            <button data-demon-action="create" disabled style="padding:4px 8px;border:0;border-radius:3px;background:#4a252a;color:#8d6a6d;cursor:not-allowed;">Create Demon</button>
            <button data-demon-action="command" disabled style="padding:4px 8px;border:0;border-radius:3px;background:#4a252a;color:#8d6a6d;cursor:not-allowed;">Issue Command</button>
          </div>
          <div id="demon-command-status" style="min-height:14px;margin-top:4px;color:#9e9e9e;font-size:10px;"></div>
        </div>
      </section>
    `

    const pauseBtn = panel.querySelector<HTMLButtonElement>('#debug-pause')
    const speedBtn = panel.querySelector<HTMLButtonElement>('#debug-speed')
    const resetVillageBtn = panel.querySelector<HTMLButtonElement>('#debug-reset-village')
    const refreshAgentsBtn = panel.querySelector<HTMLButtonElement>('#debug-refresh-agents')
    this.setupMinimisableSection(panel, 'god-abilities-toggle', 'god-abilities-content', 'deity abilities')
    this.setupMinimisableSection(panel, 'demon-summon-toggle', 'demon-summon-content', 'demon summon')
    panel.addEventListener('click', (event) => {
      const demonButton = event.target instanceof Element
        ? event.target.closest<HTMLButtonElement>('[data-demon-action]')
        : null
      if (demonButton && !demonButton.disabled) {
        const prompt = panel.querySelector<HTMLInputElement>('#demon-command-prompt')
        window.dispatchEvent(new CustomEvent('debug-demon-action', {
          detail: {
            action: demonButton.dataset.demonAction,
            prompt: prompt?.value ?? '',
          },
        }))
        return
      }
      const button = event.target instanceof Element
        ? event.target.closest<HTMLButtonElement>('[data-god-ability]')
        : null
      if (!button || button.disabled) return
      const ability = button.dataset.godAbility as typeof this.pendingGodAbility
      if (ability) this.openGodAbilityConfirm(ability)
    })
    window.addEventListener('debug-god-ability-result', (event) => {
      const result = (event as CustomEvent<{ success: boolean; message: string }>).detail
      const status = panel.querySelector<HTMLElement>('#god-ability-status')
      if (status) {
        status.textContent = result.message
        status.style.color = result.success ? '#aed581' : '#ef9a9a'
      }
    })
    window.addEventListener('debug-deity-chat-open-result', (event) => {
      const result = (event as CustomEvent<{ success: boolean; message: string }>).detail
      const status = panel.querySelector<HTMLElement>('#god-ability-status')
      if (status) {
        status.textContent = result.message
        status.style.color = result.success ? '#aed581' : '#ef9a9a'
      }
    })
    window.addEventListener('debug-demon-action-result', (event) => {
      const result = (event as CustomEvent<{ success: boolean; message: string }>).detail
      const status = panel.querySelector<HTMLElement>('#demon-command-status')
      if (status) {
        status.textContent = result.message
        status.style.color = result.success ? '#ef9a9a' : '#ffcc80'
      }
    })

    pauseBtn?.addEventListener('click', () => {
      window.dispatchEvent(new CustomEvent('debug-pause'))
    })
    window.addEventListener('simulation-pause-changed', (event) => {
      if (!pauseBtn) return
      const paused = (event as CustomEvent<{ paused?: boolean }>).detail?.paused === true
      pauseBtn.textContent = paused ? 'Resume' : 'Pause'
      pauseBtn.style.background = paused ? '#ffb74d' : '#4ecdc4'
      pauseBtn.setAttribute('aria-pressed', String(paused))
      pauseBtn.title = paused ? 'Simulation paused — click to resume' : 'Simulation running — click to pause'
    })

    speedBtn?.addEventListener('click', () => {
      const currentIndex = SIMULATION_SPEEDS.findIndex((speed) => speed === this.speedMultiplier)
      this.speedMultiplier = SIMULATION_SPEEDS[(currentIndex + 1) % SIMULATION_SPEEDS.length]
      speedBtn.textContent = `Speed: ${this.speedMultiplier}x`
      window.dispatchEvent(
        new CustomEvent('debug-speed', {
          detail: { multiplier: this.speedMultiplier },
        })
      )
    })

    resetVillageBtn?.addEventListener('click', () => {
      if (!window.confirm('Reset the entire village? This permanently clears the saved world, agents, rumours, and events.')) return
      window.dispatchEvent(new CustomEvent('debug-reset-village'))
    })
    refreshAgentsBtn?.addEventListener('click', () => {
      window.dispatchEvent(new CustomEvent('debug-refresh-agents'))
    })
    window.addEventListener('debug-refresh-agents-result', (event) => {
      const result = (event as CustomEvent<{ success: boolean; message: string }>).detail
      const status = panel.querySelector<HTMLElement>('#debug-refresh-agents-status')
      if (status) {
        status.textContent = result.message
        status.style.color = result.success ? '#90caf9' : '#ef9a9a'
      }
    })

    return panel
  }

  public updateGodControls(
    agents: AgentState[],
    state: {
      credits: number
      lastInvocation?: string
      demonSummonCredits: number
      demons: Array<{ id: string; name: string; alive: boolean; lastCommand?: string }>
      summonProgress?: {
        cultName: string
        leaderName: string
        locationName: string
        gathered: number
        required: number
        percent: number
        phase: 'recruiting' | 'travelling'
        invited: number
        recruitingMemberName?: string
      }
    }
  ): void {
    const count = this.controlsPanel.querySelector<HTMLElement>('#god-invocation-count')
    const source = this.controlsPanel.querySelector<HTMLElement>('#god-invocation-source')
    if (!count || !source) return
    this.latestAgents = agents
    count.textContent = `${state.credits} invocation${state.credits === 1 ? '' : 's'}`
    source.textContent = state.lastInvocation ?? 'Waiting for worship directed toward a deity.'
    for (const button of this.controlsPanel.querySelectorAll<HTMLButtonElement>('[data-god-ability]')) {
      button.disabled = state.credits <= 0
      button.style.cursor = button.disabled ? 'not-allowed' : 'pointer'
      button.style.background = button.disabled ? '#51482d' : '#f9a825'
      button.style.color = button.disabled ? '#8d8469' : '#1b1607'
    }
    const demonCount = this.controlsPanel.querySelector<HTMLElement>('#demon-summon-count')
    if (demonCount) demonCount.textContent = `${state.demonSummonCredits} charge${state.demonSummonCredits === 1 ? '' : 's'}`
    const progressLabel = this.controlsPanel.querySelector<HTMLElement>('#demon-summon-progress-label')
    const progressFill = this.controlsPanel.querySelector<HTMLElement>('#demon-summon-progress-fill')
    const progressBar = progressFill?.parentElement
    const progress = state.summonProgress?.percent ?? (state.demonSummonCredits > 0 ? 100 : 0)
    if (progressFill) progressFill.style.width = `${progress}%`
    progressBar?.setAttribute('aria-valuenow', String(progress))
    if (progressLabel) {
      progressLabel.textContent = state.summonProgress
        ? state.summonProgress.phase === 'recruiting'
          ? `${state.summonProgress.leaderName} recruiting followers: ${state.summonProgress.invited}/2 personally invited${state.summonProgress.recruitingMemberName ? ` · approaching ${state.summonProgress.recruitingMemberName}` : ''} · ${progress}%`
          : `${state.summonProgress.leaderName} leading ${state.summonProgress.cultName}: ${state.summonProgress.gathered}/${state.summonProgress.required} at ${state.summonProgress.locationName} · ${progress}%`
        : state.demons.length > 0
          ? `${state.demons[0].name} has manifested.`
          : state.demonSummonCredits > 0
            ? 'Ritual complete — Demon ready to manifest.'
            : 'No summoning ritual active.'
    }
    for (const button of this.controlsPanel.querySelectorAll<HTMLButtonElement>('[data-demon-action]')) {
      const enabled = button.dataset.demonAction === 'create'
        ? state.demonSummonCredits > 0 && state.demons.length === 0
        : state.demons.some((demon) => demon.alive)
      button.disabled = !enabled
      button.style.cursor = enabled ? 'pointer' : 'not-allowed'
      button.style.background = enabled ? '#b71c1c' : '#4a252a'
      button.style.color = enabled ? '#fff' : '#8d6a6d'
    }
  }

  private createGodAbilityConfirmPanel(): HTMLDivElement {
    const panel = document.createElement('div')
    panel.id = 'god-ability-confirm-panel'
    panel.setAttribute('role', 'dialog')
    panel.setAttribute('aria-label', 'Confirm deity ability')
    panel.style.cssText = `
      position: fixed;
      top: 50%;
      left: 50%;
      transform: translate(-50%, -50%);
      width: min(380px, calc(100vw - 32px));
      display: none;
      flex-direction: column;
      background: rgba(35, 30, 20, 0.97);
      color: #f5efe6;
      border: 2px solid #f9a825;
      border-radius: 8px;
      box-shadow: 0 10px 40px rgba(0, 0, 0, 0.72);
      font-family: 'Consolas', 'Monaco', monospace;
      font-size: 12px;
      overflow: hidden;
      z-index: 1300;
      pointer-events: auto;
    `
    panel.innerHTML = `
      <div style="padding:10px 14px;background:rgba(105,80,20,.55);border-bottom:1px solid #f9a825;">
        <div id="god-ability-confirm-title" style="color:#ffe0b2;font-size:14px;font-weight:bold;">Confirm ability</div>
      </div>
      <div style="padding:12px 14px;">
        <div id="god-ability-confirm-target-row" style="margin-bottom:9px;display:none;">
          <label for="god-ability-confirm-target" style="display:block;color:#e8d5a8;margin-bottom:3px;">Target</label>
          <select id="god-ability-confirm-target" style="box-sizing:border-box;width:100%;padding:5px;background:#282216;color:#fff;border:1px solid #6d5d32;border-radius:3px;"></select>
        </div>
        <div id="god-ability-confirm-deity-row" style="margin-bottom:9px;display:none;">
          <label for="god-ability-confirm-deity" id="god-ability-confirm-deity-label" style="display:block;color:#e8d5a8;margin-bottom:3px;">Manifest as</label>
          <select id="god-ability-confirm-deity" style="box-sizing:border-box;width:100%;margin-bottom:5px;padding:5px;background:#282216;color:#fff;border:1px solid #6d5d32;border-radius:3px;"></select>
          <input id="god-ability-confirm-deity-custom" type="text" maxlength="60" placeholder="Or type a custom deity name..." style="box-sizing:border-box;width:100%;padding:5px;background:#282216;color:#fff;border:1px solid #6d5d32;border-radius:3px;">
        </div>
        <div id="god-ability-confirm-weather-row" style="margin-bottom:9px;display:none;">
          <label for="god-ability-confirm-weather" style="display:block;color:#e8d5a8;margin-bottom:3px;">Weather</label>
          <select id="god-ability-confirm-weather" style="box-sizing:border-box;width:100%;padding:5px;background:#282216;color:#fff;border:1px solid #6d5d32;border-radius:3px;">
            <option value="clear">Clear weather</option>
            <option value="cloudy">Cloudy weather</option>
            <option value="rain">Rain</option>
            <option value="storm">Storm</option>
          </select>
        </div>
        <div id="god-ability-confirm-dream-row" style="margin-bottom:9px;display:none;">
          <label for="god-ability-confirm-dream" style="display:block;color:#e8d5a8;margin-bottom:3px;">Bias to plant (only sleeping, cult-unaligned villagers)</label>
          <textarea id="god-ability-confirm-dream" maxlength="240" rows="3" placeholder="e.g. The well water is poisoned. Trust no one wearing red." style="box-sizing:border-box;width:100%;padding:5px;background:#282216;color:#fff;border:1px solid #6d5d32;border-radius:3px;font:inherit;resize:vertical;"></textarea>
          <div style="color:#9e9e9e;font-size:10px;margin-top:3px;">Lower sanity raises the odds this curdles into a nightmare instead of an ordinary dream.</div>
        </div>
        <div id="god-ability-confirm-error" style="min-height:14px;color:#ef9a9a;margin-bottom:4px;"></div>
        <div style="display:flex;justify-content:flex-end;gap:8px;">
          <button id="god-ability-confirm-cancel" style="padding:6px 12px;border:0;border-radius:4px;background:#555;color:#fff;cursor:pointer;font:inherit;">Cancel</button>
          <button id="god-ability-confirm-submit" style="padding:6px 14px;border:0;border-radius:4px;background:#f9a825;color:#1b1607;cursor:pointer;font:inherit;font-weight:bold;">Confirm</button>
        </div>
      </div>
    `
    panel.querySelector<HTMLButtonElement>('#god-ability-confirm-cancel')?.addEventListener('click', () => {
      this.closeGodAbilityConfirm()
    })
    panel.querySelector<HTMLButtonElement>('#god-ability-confirm-submit')?.addEventListener('click', () => {
      this.submitGodAbilityConfirm()
    })
    return panel
  }

  private closeGodAbilityConfirm(): void {
    this.pendingGodAbility = null
    this.godAbilityConfirmPanel.style.display = 'none'
  }

  private openGodAbilityConfirm(ability: NonNullable<typeof this.pendingGodAbility>): void {
    this.pendingGodAbility = ability
    const panel = this.godAbilityConfirmPanel
    const title = panel.querySelector<HTMLElement>('#god-ability-confirm-title')
    const targetRow = panel.querySelector<HTMLElement>('#god-ability-confirm-target-row')
    const targetSelect = panel.querySelector<HTMLSelectElement>('#god-ability-confirm-target')
    const deityRow = panel.querySelector<HTMLElement>('#god-ability-confirm-deity-row')
    const deitySelect = panel.querySelector<HTMLSelectElement>('#god-ability-confirm-deity')
    const deityCustom = panel.querySelector<HTMLInputElement>('#god-ability-confirm-deity-custom')
    const weatherRow = panel.querySelector<HTMLElement>('#god-ability-confirm-weather-row')
    const dreamRow = panel.querySelector<HTMLElement>('#god-ability-confirm-dream-row')
    const dreamText = panel.querySelector<HTMLTextAreaElement>('#god-ability-confirm-dream')
    const error = panel.querySelector<HTMLElement>('#god-ability-confirm-error')
    if (!title || !targetRow || !targetSelect || !deityRow || !deitySelect || !deityCustom || !weatherRow || !dreamRow || !dreamText || !error) return

    if (title) title.textContent = `Confirm: ${ability.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase())}`
    if (error) error.textContent = ''
    deityCustom.value = ''
    dreamText.value = ''

    const needsTarget = ability !== 'weather' && ability !== 'create_relic'
    targetRow.style.display = needsTarget ? 'block' : 'none'
    if (needsTarget) {
      const eligible = ability === 'resurrect'
        ? this.latestAgents.filter((agent) => !agent.alive)
        : ability === 'dream'
          ? this.latestAgents.filter((agent) => agent.alive && !agent.cult && this.latestActivityStatuses[agent.id] === 'sleeping')
          : this.latestAgents.filter((agent) => agent.alive)
      const options = eligible.map((agent) =>
        `<option value="${this.escapeHtml(agent.id)}">${this.escapeHtml(agent.name)} (${agent.alive ? 'alive' : agent.exiled ? 'exiled' : 'dead'})</option>`
      )
      targetSelect.innerHTML = ability === 'manifest'
        ? [`<option value="">(No target — manifest over the whole village)</option>`, ...options].join('')
        : ability === 'dream' && options.length === 0
          ? [`<option value="">(No sleeping, cult-unaligned villagers right now)</option>`].join('')
          : options.join('')
    }

    deityRow.style.display = ability === 'manifest' || ability === 'speak' || ability === 'create_relic' ? 'block' : 'none'
    if (ability === 'manifest' || ability === 'speak' || ability === 'create_relic') {
      const deityLabel = panel.querySelector<HTMLElement>('#god-ability-confirm-deity-label')
      if (deityLabel) {
        deityLabel.textContent = ability === 'speak' 
          ? 'Speak as' 
          : ability === 'create_relic' 
            ? 'Associate Deity' 
            : 'Manifest as'
      }
      const knownDeities = Array.from(new Set(
        this.latestAgents.flatMap((agent) => agent.beliefSystem.deities.map((deity) => deity.name.trim()))
          .filter((name) => name.length > 0)
      )).sort((first, second) => first.localeCompare(second))
      deitySelect.innerHTML = [
        `<option value="">Auto (the target's own deity, or last invoked)</option>`,
        ...knownDeities.map((name) => `<option value="${this.escapeHtml(name)}">${this.escapeHtml(name)}</option>`),
      ].join('')
    }

    weatherRow.style.display = ability === 'weather' ? 'block' : 'none'
    
    const isDream = ability === 'dream'
    const isRelic = ability === 'create_relic'
    dreamRow.style.display = (isDream || isRelic) ? 'block' : 'none'
    if (isDream || isRelic) {
      const dreamLabel = panel.querySelector<HTMLElement>('#god-ability-confirm-dream-label')
      const dreamHint = panel.querySelector<HTMLElement>('#god-ability-confirm-dream-hint')
      if (dreamLabel) {
        dreamLabel.textContent = isRelic 
          ? 'Relic revelation text (forces existential shock on non-believers)' 
          : 'Bias to plant (only sleeping, cult-unaligned villagers)'
      }
      if (dreamText) {
        dreamText.placeholder = isRelic
          ? 'e.g. The town is a simulation. Antigravity controls the sky.'
          : 'e.g. The well water is poisoned. Trust no one wearing red.'
      }
      const actualHint = panel.querySelector<HTMLElement>('#god-ability-confirm-dream-row div') || dreamHint
      if (actualHint) {
        actualHint.textContent = isRelic
          ? 'Non-believers who stumble upon this relic gain this knowledge but face a high chance of insanity.'
          : 'Lower sanity raises the odds this curdles into a nightmare instead of an ordinary dream.'
      }
    }

    panel.style.display = 'flex'
  }

  private submitGodAbilityConfirm(): void {
    const ability = this.pendingGodAbility
    if (!ability) return
    const panel = this.godAbilityConfirmPanel
    const targetSelect = panel.querySelector<HTMLSelectElement>('#god-ability-confirm-target')
    const deitySelect = panel.querySelector<HTMLSelectElement>('#god-ability-confirm-deity')
    const deityCustom = panel.querySelector<HTMLInputElement>('#god-ability-confirm-deity-custom')
    const weatherSelect = panel.querySelector<HTMLSelectElement>('#god-ability-confirm-weather')
    const dreamText = panel.querySelector<HTMLTextAreaElement>('#god-ability-confirm-dream')
    const error = panel.querySelector<HTMLElement>('#god-ability-confirm-error')

    const targetAgentId = targetSelect?.value || undefined
    if (ability !== 'weather' && ability !== 'manifest' && ability !== 'create_relic' && !targetAgentId) {
      if (error) error.textContent = 'Select a target.'
      return
    }

    const deityName = ability === 'manifest' || ability === 'speak' || ability === 'create_relic'
      ? (deityCustom?.value.trim() || deitySelect?.value || undefined)
      : undefined

    if (ability === 'speak') {
      window.dispatchEvent(new CustomEvent('debug-deity-chat-open', {
        detail: { targetAgentId, deityName },
      }))
      this.closeGodAbilityConfirm()
      return
    }

    if (ability === 'dream') {
      const biasText = dreamText?.value.trim()
      if (!biasText) {
        if (error) error.textContent = 'Write something to dream about.'
        return
      }
      window.dispatchEvent(new CustomEvent('debug-plant-dream', {
        detail: { targetAgentId, biasText },
      }))
      this.closeGodAbilityConfirm()
      return
    }

    if (ability === 'create_relic') {
      const relicText = dreamText?.value.trim()
      if (!relicText) {
        if (error) error.textContent = 'Write a statement for the relic.'
        return
      }
      window.dispatchEvent(new CustomEvent('debug-god-ability', {
        detail: { ability, relicText, deityName },
      }))
      this.closeGodAbilityConfirm()
      return
    }

    window.dispatchEvent(new CustomEvent('debug-god-ability', {
      detail: {
        ability,
        targetAgentId,
        weatherCondition: weatherSelect?.value,
        deityName,
      },
    }))
    this.closeGodAbilityConfirm()
  }

  private createAgentPanel(): HTMLDivElement {
    const panel = document.createElement('div')
    panel.style.cssText = `
      padding: 10px;
      border-bottom: 1px solid #333;
    `

    panel.innerHTML = `
      <h3 style="margin: 0 0 8px 0; color: #ff6b6b;">Agent States <span style="color:#777;font-size:10px;font-weight:normal;">click selected agent to collapse</span></h3>
      <div id="debug-agent-list" style="font-size: 11px; line-height: 1.6;"></div>
    `

    panel.addEventListener('click', (event) => {
      const detailsButton = event.target instanceof Element
        ? event.target.closest<HTMLButtonElement>('[data-agent-details]')
        : null
      if (detailsButton?.dataset.agentDetails) {
        event.stopPropagation()
        this.openAgentDetails(detailsButton.dataset.agentDetails)
        return
      }
      const row = event.target instanceof Element
        ? event.target.closest<HTMLElement>('[data-agent-id]')
        : null
      if (!row?.dataset.agentId) return
      window.dispatchEvent(new CustomEvent('debug-select-agent', {
        detail: {
          agentId: row.dataset.agentId === this.selectedAgentId
            ? undefined
            : row.dataset.agentId,
        },
      }))
    })

    return panel
  }

  private createAgentDetailsPanel(): HTMLDivElement {
    const panel = document.createElement('div')
    panel.id = 'agent-details-popup'
    panel.style.cssText = 'display:none;position:fixed;inset:0;background:rgba(0,0,0,.62);z-index:1300;align-items:center;justify-content:center;padding:24px;box-sizing:border-box;'
    panel.innerHTML = `
      <div data-agent-details-dialog style="width:min(760px,96vw);max-height:90vh;display:flex;flex-direction:column;background:#111820;color:#eee;border:1px solid #4f6b80;border-radius:8px;box-shadow:0 12px 45px rgba(0,0,0,.65);font:12px/1.45 'Consolas','Monaco',monospace;">
        <div style="display:flex;justify-content:space-between;align-items:center;padding:10px 12px;background:#1b2935;border-bottom:1px solid #405564;">
          <strong id="agent-details-title" style="color:#90caf9;font-size:14px;">Agent details</strong>
          <button data-close-agent-details aria-label="Close agent details" style="border:0;border-radius:3px;background:#37474f;color:#fff;cursor:pointer;padding:4px 9px;">Close</button>
        </div>
        <div id="agent-details-body" style="padding:12px;overflow-y:auto;"></div>
      </div>`
    panel.addEventListener('click', (event) => {
      const close = event.target instanceof Element && event.target.closest('[data-close-agent-details]')
      const dialog = event.target instanceof Element && event.target.closest('[data-agent-details-dialog]')
      if (close || !dialog) this.closeAgentDetails()
    })
    document.body.appendChild(panel)
    return panel
  }

  private createCultTrackerPanel(): HTMLDivElement {
    const panel = document.createElement('div')
    panel.id = 'cult-group-tracker'
    panel.style.cssText = `
      position:fixed;right:415px;bottom:15px;width:min(340px,calc(100vw - 430px));
      max-height:42vh;display:flex;flex-direction:column;background:rgba(30,12,25,.94);
      color:#fff;border:1px solid #8e496b;border-radius:7px;box-shadow:0 6px 24px rgba(0,0,0,.5);
      font:11px/1.4 'Consolas','Monaco',monospace;overflow:hidden;z-index:1000;
    `
    panel.innerHTML = `
      <div style="display:flex;align-items:center;justify-content:space-between;padding:8px 9px;background:rgba(105,35,70,.65);border-bottom:1px solid #8e496b;">
        <div><strong style="color:#f8bbd0;">Cults, Groups &amp; Factions</strong><div style="color:#b7869d;font-size:9px;">Founders, members, alliances, and political camps</div></div>
        <button data-cult-tracker-toggle aria-label="Collapse cult tracker" style="border:0;border-radius:3px;background:#55263e;color:#fff;cursor:pointer;padding:3px 7px;">−</button>
      </div>
      <div id="cult-group-content" style="padding:8px;overflow-y:auto;min-height:0;"></div>`
    const content = panel.querySelector<HTMLElement>('#cult-group-content')
    const toggle = panel.querySelector<HTMLButtonElement>('[data-cult-tracker-toggle]')
    toggle?.addEventListener('click', () => {
      if (!content || !toggle) return
      const expanding = content.style.display === 'none'
      content.style.display = expanding ? 'block' : 'none'
      toggle.textContent = expanding ? '−' : '+'
      toggle.setAttribute('aria-label', expanding ? 'Collapse cult tracker' : 'Expand cult tracker')
    })
    panel.addEventListener('click', (event) => {
      const agentTarget = event.target instanceof Element
        ? event.target.closest<HTMLElement>('[data-agent-id]')
        : null
      if (agentTarget?.dataset.agentId) {
        this.openAgentDetails(agentTarget.dataset.agentId)
        return
      }
      const cultTarget = event.target instanceof Element
        ? event.target.closest<HTMLElement>('[data-cult-id]')
        : null
      if (cultTarget?.dataset.cultId) {
        this.openCultDetails(cultTarget.dataset.cultId)
        return
      }
      const factionTarget = event.target instanceof Element
        ? event.target.closest<HTMLElement>('[data-faction-id]')
        : null
      if (factionTarget?.dataset.factionId) {
        this.openFactionDetails(factionTarget.dataset.factionId as PoliticalCampId)
      }
    })
    document.body.appendChild(panel)
    return panel
  }

  public updateCultsAndGroups(
    agents: AgentState[],
    agentDetails?: Record<string, AgentDebugDetails>,
    activityStatuses?: Record<string, string>,
    simulationMinute?: number
  ): void {
    this.latestAgents = agents
    if (agentDetails) this.latestAgentDetails = agentDetails
    if (activityStatuses) this.latestActivityStatuses = activityStatuses
    if (simulationMinute !== undefined) this.latestSimulationMinute = simulationMinute
    const content = this.cultTrackerPanel.querySelector<HTMLElement>('#cult-group-content')
    if (!content) return
    const cults = new Map<string, { name: string; leader?: AgentState; members: AgentState[] }>()
    for (const agent of agents) {
      if (!agent.cult) continue
      const cult = cults.get(agent.cult.id) ?? { name: agent.cult.name, members: [] }
      cult.members.push(agent)
      if (agent.cult.role === 'leader' || agent.cult.role === 'founder') cult.leader = agent
      cults.set(agent.cult.id, cult)
    }
    const allianceGroups = this.collectAllianceGroups(agents)
    const antiCultGroups = new Map<string, AgentState[]>()
    for (const agent of agents.filter((candidate) => candidate.antiCultGroup)) {
      const groupId = agent.antiCultGroup!.id
      const members = antiCultGroups.get(groupId) ?? []
      members.push(agent)
      antiCultGroups.set(groupId, members)
    }
    const factions = new Map<PoliticalCampId, { name: string; members: AgentState[] }>()
    for (const agent of agents) {
      if (!agent.politicalCamp) continue
      const faction = factions.get(agent.politicalCamp.id) ?? { name: agent.politicalCamp.name, members: [] }
      faction.members.push(agent)
      factions.set(agent.politicalCamp.id, faction)
    }
    const cultHtml = cults.size
      ? Array.from(cults.entries()).map(([cultId, cult]) => `<div data-cult-id="${this.escapeHtml(cultId)}" title="Open complete cult details" style="padding:7px;margin-bottom:6px;background:rgba(240,98,146,.07);border-left:3px solid #ec407a;cursor:pointer;">
          <div style="color:#f48fb1;font-weight:bold;">${this.escapeHtml(cult.name)}</div>
          <div style="color:#b0bec5;">Leader: ${cult.leader ? `<button data-agent-id="${this.escapeHtml(cult.leader.id)}" style="border:0;background:transparent;color:#80cbc4;padding:0;cursor:pointer;font:inherit;">${this.escapeHtml(cult.leader.name)}</button>` : 'unknown'}</div>
          <div style="color:#8e7c87;">Members (${cult.members.length}): ${cult.members.map((member) => this.escapeHtml(member.name)).join(', ')}</div>
        </div>`).join('')
      : '<div style="color:#795c6b;margin-bottom:7px;">No cult has formed.</div>'
    const allianceHtml = allianceGroups.length
      ? allianceGroups.map((group, index) => `<div style="padding:6px 0;border-top:1px solid #472b3a;"><span style="color:#ce93d8;">Alliance group ${index + 1}</span><div style="color:#8e7c87;">${group.map((agent) => this.escapeHtml(agent.name)).join(', ')}</div></div>`).join('')
      : ''
    const antiCultHtml = antiCultGroups.size
      ? Array.from(antiCultGroups.values()).map((members) => {
          const group = members[0].antiCultGroup!
          return `<div style="padding:6px;margin-top:6px;border-left:3px solid #ef5350;background:rgba(239,83,80,.08);"><strong style="color:#ef9a9a;">${this.escapeHtml(group.name)}</strong><div style="color:#b0bec5;">Opposes: ${this.escapeHtml(group.opposedCultName)}</div><div style="color:#8e7c87;">Members: ${members.map((member) => this.escapeHtml(member.name)).join(', ')}</div></div>`
        }).join('')
      : ''
    const factionHtml = factions.size
      ? `<div style="color:#8e7c87;font-weight:bold;border-top:1px solid #472b3a;padding-top:6px;margin-top:6px;">Political factions</div>` +
        Array.from(factions.entries()).map(([factionId, faction]) => {
          const living = faction.members.filter((member) => member.alive)
          const avgWealth = living.length
            ? Math.round(living.reduce((sum, member) => sum + member.wealth, 0) / living.length)
            : 0
          return `<div data-faction-id="${this.escapeHtml(factionId)}" title="Open faction details" style="padding:7px;margin-top:6px;background:rgba(91,111,168,.1);border-left:3px solid #5b6fa8;cursor:pointer;">
            <div style="color:#c5cdf8;font-weight:bold;">${this.escapeHtml(faction.name)}</div>
            <div style="color:#b0bec5;">Members (${faction.members.length}, ${living.length} living): ${faction.members.map((member) => this.escapeHtml(member.name)).join(', ')}</div>
            <div style="color:#8e7c87;">Avg wealth: ${avgWealth}</div>
          </div>`
        }).join('')
      : '<div style="color:#795c6b;border-top:1px solid #472b3a;padding-top:6px;margin-top:6px;">No political factions have formed.</div>'
    content.innerHTML = cultHtml + antiCultHtml + allianceHtml + factionHtml
    if (this.openCultDetailsId) this.renderCultDetails(this.openCultDetailsId)
    if (this.openFactionDetailsId) this.renderFactionDetails(this.openFactionDetailsId)
  }

  private createCultDetailsPanel(): HTMLDivElement {
    const panel = document.createElement('div')
    panel.id = 'cult-details-popup'
    panel.style.cssText = 'display:none;position:fixed;inset:0;background:rgba(0,0,0,.66);z-index:1310;align-items:center;justify-content:center;padding:24px;box-sizing:border-box;'
    panel.innerHTML = `
      <div data-cult-details-dialog style="width:min(900px,96vw);max-height:90vh;display:flex;flex-direction:column;background:#1a1018;color:#eee;border:1px solid #a34e79;border-radius:8px;box-shadow:0 12px 45px rgba(0,0,0,.7);font:12px/1.45 'Consolas','Monaco',monospace;">
        <div style="display:flex;justify-content:space-between;align-items:center;padding:10px 12px;background:#3a1830;border-bottom:1px solid #7b355b;">
          <strong id="cult-details-title" style="color:#f8bbd0;font-size:14px;">Cult details</strong>
          <button data-close-cult-details aria-label="Close cult details" style="border:0;border-radius:3px;background:#63304d;color:#fff;cursor:pointer;padding:4px 9px;">Close</button>
        </div>
        <div id="cult-details-body" style="padding:12px;overflow-y:auto;"></div>
      </div>`
    panel.addEventListener('click', (event) => {
      const member = event.target instanceof Element
        ? event.target.closest<HTMLElement>('[data-cult-member-id]')
        : null
      if (member?.dataset.cultMemberId) {
        const agentId = member.dataset.cultMemberId
        this.closeCultDetails()
        this.openAgentDetails(agentId)
        return
      }
      const close = event.target instanceof Element && event.target.closest('[data-close-cult-details]')
      const dialog = event.target instanceof Element && event.target.closest('[data-cult-details-dialog]')
      if (close || !dialog) this.closeCultDetails()
    })
    document.body.appendChild(panel)
    return panel
  }

  private openCultDetails(cultId: string): void {
    this.openCultDetailsId = cultId
    this.cultDetailsPanel.style.display = 'flex'
    this.renderCultDetails(cultId, false)
  }

  private closeCultDetails(): void {
    this.openCultDetailsId = null
    this.cultDetailsPanel.style.display = 'none'
  }

  private renderCultDetails(cultId: string, preserveScroll = true): void {
    const members = this.latestAgents.filter((agent) => agent.cult?.id === cultId)
    const title = this.cultDetailsPanel.querySelector<HTMLElement>('#cult-details-title')
    const body = this.cultDetailsPanel.querySelector<HTMLElement>('#cult-details-body')
    if (!title || !body) return
    if (members.length === 0) {
      this.closeCultDetails()
      return
    }
    const scrollTop = preserveScroll ? body.scrollTop : 0
    const cultName = members[0].cult?.name ?? cultId
    const livingMembers = members.filter((member) => member.alive)
    const leader = members.find((member) => member.cult?.role === 'leader' || member.cult?.role === 'founder')
    const averageAggression = livingMembers.length
      ? livingMembers.reduce((sum, member) => sum + member.personality.aggression, 0) / livingMembers.length
      : 0
    title.textContent = `${cultName} — complete cult details`

    const memberRows = members.map((member) => {
      const details = this.latestAgentDetails[member.id]
      const blessing = this.renderBlessingSummary(member)
      const cultActions = new Set(['pray', 'preach', 'ritual', 'conjure', 'summon', 'resurrect', 'heal', 'bless', 'curse', 'invite_cult', 'build_shrine'])
      const upcoming = details?.schedule?.blocks.filter((block) =>
        cultActions.has(block.action) && block.startMinute + block.durationMinutes >= this.latestSimulationMinute % 1440
      ).slice(0, 3) ?? []
      const requests = [
        ...(member.cultRequests?.filter((request) => request.status === 'pending').map((request) => request.description) ?? []),
        ...(details?.queuedTriggers.filter((trigger) => /cult|relig|faith|god|pray|preach|ritual|convert|recruit|bless|heal|summon/i.test(trigger.description)).map((trigger) => trigger.description) ?? []),
        ...upcoming.map((block) => `${block.action}${block.target ? ` → ${block.target}` : ''}: ${block.reasoning}`),
      ].slice(0, 4)
      const recentCultEvents = member.memory.recent.filter((event) =>
        /cult|relig|faith|god|pray|preach|ritual|convert|recruit|bless|summon/i.test(`${event.type} ${event.description}`)
      ).slice(-3).reverse()
      const recruiter = member.cult?.recruitedByAgentId
        ? this.latestAgents.find((agent) => agent.id === member.cult?.recruitedByAgentId)?.name ?? member.cult.recruitedByAgentId
        : undefined
      const joined = member.cult?.joinedAtMinute === undefined
        ? 'legacy membership'
        : `${this.formatAbsoluteMinute(member.cult.joinedAtMinute)} via ${member.cult.joinMethod ?? 'unknown method'}${recruiter ? ` by ${this.escapeHtml(recruiter)}` : ''}`
      return `<div style="padding:8px;margin-bottom:6px;background:#211822;border:1px solid #4d3041;border-radius:4px;">
        <div style="display:flex;justify-content:space-between;gap:8px;"><button data-cult-member-id="${this.escapeHtml(member.id)}" style="border:0;background:transparent;color:#f48fb1;font:bold inherit;padding:0;cursor:pointer;">${this.escapeHtml(member.name)}</button><span>${this.escapeHtml(member.cult?.role ?? 'member')} · ${member.alive ? 'alive' : member.exiled ? 'exiled' : 'dead'}</span></div>
        <div style="color:#b0bec5;">HP ${Math.round(member.health)}/${Math.round(member.maxHealth)} · Hunger ${Math.round(member.needs.hunger)} · Energy ${Math.round(member.needs.energy)} · Social ${Math.round(member.needs.social)}</div>
        <div style="color:#b0bec5;">${member.religiousStanceRevealed === false ? 'Worldview undisclosed' : `Faith ${Math.round(member.beliefSystem.faith)}% · ${this.escapeHtml(member.beliefSystem.religiousStance)}`} · Reputation ${Math.round(member.reputation)}</div>
        <div style="color:#ce93d8;">Joined: ${joined}</div>
        <div style="color:#ffcc80;">${this.renderPersonality(member)}</div>
        <div style="color:#90a4ae;">Current: ${this.escapeHtml(this.latestActivityStatuses[member.id] ?? 'unknown')}${blessing ? ` · ${blessing}` : ''}</div>
        ${member.cultDesperation ? `<div style="color:#ef9a9a;">Feels forsaken: ${this.escapeHtml(member.cultDesperation.reason)} · considering sacrifice</div>` : ''}
        <div style="margin-top:4px;color:#ffcc80;">Requests / intentions: ${requests.length ? requests.map((request) => this.escapeHtml(request)).join('<br>') : '<span style="color:#6f6570;">none active</span>'}</div>
        <div style="margin-top:4px;color:#b39ddb;">Recent cult activity: ${recentCultEvents.length ? recentCultEvents.map((event) => this.escapeHtml(event.description)).join('<br>') : '<span style="color:#6f6570;">none recorded</span>'}</div>
      </div>`
    }).join('')

    // Progress is wiped from state once a prospect turns immune (nonbeliever
    // / atheist), so the live snapshot below can't show a percentage for them
    // any more. Pull their last recorded value from the log instead of
    // silently dropping to 0%, which used to read as a contradiction between
    // this section and the log underneath.
    const conversionEvents = this.eventBus.getHistory()
      .filter((event) => event.type === 'cult_recruitment' && event.worldStateDelta.cultId === cultId)
      .slice(-40)
      .reverse()
    const lastLoggedProgress = new Map<string, number>()
    for (const event of conversionEvents) {
      if (event.targetId && !lastLoggedProgress.has(event.targetId)) {
        lastLoggedProgress.set(event.targetId, Math.round(Number(event.worldStateDelta.conversionProgress ?? 0)))
      }
    }

    const prospects = this.latestAgents.filter((agent) => agent.alive && agent.cult?.id !== cultId)
    const prospectRows = prospects.map((prospect) => {
      const hidden = prospect.religiousStanceRevealed === false
      const immune = !hidden && ['nonbeliever', 'atheist'].includes(prospect.beliefSystem.religiousStance)
      const liveProgress = Math.round(prospect.cultConversionProgress?.[cultId] ?? 0)
      const peakProgress = lastLoggedProgress.get(prospect.id) ?? 0
      const progress = immune ? 0 : liveProgress
      const status = hidden
        ? 'worldview undisclosed · no progress'
        : immune
          ? `${prospect.beliefSystem.religiousStance} · immune${peakProgress > 0 ? ` (had reached ${peakProgress}% before deciding)` : ''}`
          : `${progress}% converted`
      return `<div style="display:grid;grid-template-columns:minmax(130px,1fr) minmax(150px,2fr);gap:8px;align-items:center;padding:4px 0;border-bottom:1px solid #382735;">
        <span>${this.escapeHtml(prospect.name)}</span>
        <div><span style="color:${immune ? '#ef9a9a' : '#ffcc80'};">${status}</span><div style="height:5px;background:#34252f;border-radius:3px;overflow:hidden;"><div style="width:${progress}%;height:100%;background:#ec407a;"></div></div></div>
      </div>`
    }).join('') || '<div style="color:#795c6b;">No outside prospects.</div>'

    const conversionLog = conversionEvents.length
      ? conversionEvents.map((event) => {
          const listenerName = this.latestAgents.find((agent) => agent.id === event.targetId)?.name ?? event.targetId ?? 'unknown'
          const preacherName = this.latestAgents.find((agent) => agent.id === event.agentId)?.name ?? event.agentId
          const previous = Math.round(Number(event.worldStateDelta.previousProgress ?? 0))
          const current = Math.round(Number(event.worldStateDelta.conversionProgress ?? 0))
          const joined = event.worldStateDelta.joined === true
          const source = event.worldStateDelta.source === 'conversation' ? 'conversation' : 'preaching'
          const poached = typeof event.worldStateDelta.poachedFromCultId === 'string'
          const time = new Date(event.timestamp).toLocaleTimeString([], {
            hour: '2-digit', minute: '2-digit', second: '2-digit',
          })
          return `<div style="padding:4px 0;border-bottom:1px solid #382735;">
            <div style="display:flex;justify-content:space-between;gap:8px;">
              <span style="color:${joined ? '#81c784' : '#ffcc80'};">${this.escapeHtml(listenerName)}: ${previous}% → ${current}% converted${joined ? ' — joined!' : ''}</span>
              <span style="color:#796a75;font-size:9px;">${time}</span>
            </div>
            <div style="color:#b0bec5;">via ${this.escapeHtml(preacherName)}'s ${source}${poached ? ' (poached from another cult)' : ''}</div>
          </div>`
        }).join('')
      : '<div style="color:#795c6b;">No conversion attempts recorded yet.</div>'

    const hostility = averageAggression >= 0.65 ? 'mob-capable' : 'non-aggressive'
    const agendas = leader?.cultAgendas?.length
      ? leader.cultAgendas.map((agenda) => `${this.escapeHtml(agenda.description)} (${agenda.intensity}%)`).join('<br>')
      : '<span style="color:#795c6b;">No explicit leader agenda.</span>'
    const allRequests = members.flatMap((member) => member.cultRequests ?? [])
      .sort((first, second) => second.createdAtMinute - first.createdAtMinute)
      .map((request) => {
        const requester = this.latestAgents.find((agent) => agent.id === request.requesterId)?.name ?? request.requesterId
        return `<div style="padding:4px 0;border-bottom:1px solid #382735;"><span style="color:${request.status === 'pending' ? '#ffcc80' : request.status === 'fulfilled' ? '#81c784' : '#78909c'};">[${request.status}]</span> ${this.escapeHtml(request.description)} <span style="color:#796a75;">— ${this.escapeHtml(requester)}</span></div>`
      }).join('') || '<div style="color:#795c6b;">No prayers or requests recorded.</div>'
    const enemies = this.latestAgents.filter((agent) =>
      agent.cultEnemies?.some((enemy) => enemy.cultId === cultId)
    ).map((enemy) => `${this.escapeHtml(enemy.name)}${enemy.antiCultGroup ? ` — ${this.escapeHtml(enemy.antiCultGroup.name)}` : ''}`).join('<br>') || '<span style="color:#795c6b;">No defectors marked as enemies.</span>'
    body.innerHTML = `
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(210px,1fr));gap:8px;margin-bottom:10px;">
        ${this.detailSection('Identity', `Leader: ${this.escapeHtml(leader?.name ?? 'unknown')}<br>Members: ${members.length} (${livingMembers.length} living)<br>Cult ID: ${this.escapeHtml(cultId)}`)}
        ${this.detailSection('Collective temperament', `Average aggression: ${Math.round(averageAggression * 100)}%<br>Status: ${hostility}<br>Mob threshold: 65% average, 2 aggressive participants`)}
      </div>
      ${this.detailSection('Leader agendas', agendas)}
      ${this.detailSection('Cult prayers and requests', allRequests)}
      ${this.detailSection('Defectors and enemies', enemies)}
      ${this.detailSection(`Members (${members.length})`, memberRows)}
      ${this.detailSection('Current conversion standing', prospectRows)}
      ${this.detailSection('Conversion history log', conversionLog)}
    `
    body.scrollTop = scrollTop
  }

  private createFactionDetailsPanel(): HTMLDivElement {
    const panel = document.createElement('div')
    panel.id = 'faction-details-popup'
    panel.style.cssText = 'display:none;position:fixed;inset:0;background:rgba(0,0,0,.62);z-index:1310;align-items:center;justify-content:center;padding:24px;box-sizing:border-box;'
    panel.innerHTML = `
      <div data-faction-details-dialog style="width:min(640px,96vw);max-height:90vh;display:flex;flex-direction:column;background:#131728;color:#eee;border:1px solid #5b6fa8;border-radius:8px;box-shadow:0 12px 45px rgba(0,0,0,.65);font:12px/1.45 'Consolas','Monaco',monospace;">
        <div style="display:flex;justify-content:space-between;align-items:center;padding:10px 12px;background:#1e2540;border-bottom:1px solid #454e78;">
          <strong id="faction-details-title" style="color:#c5cdf8;font-size:14px;">Faction details</strong>
          <button data-close-faction-details aria-label="Close faction details" style="border:0;border-radius:3px;background:#3c4878;color:#fff;cursor:pointer;padding:4px 9px;">Close</button>
        </div>
        <div id="faction-details-body" style="padding:12px;overflow-y:auto;"></div>
      </div>`
    panel.addEventListener('click', (event) => {
      const member = event.target instanceof Element
        ? event.target.closest<HTMLElement>('[data-faction-member-id]')
        : null
      if (member?.dataset.factionMemberId) {
        const agentId = member.dataset.factionMemberId
        this.closeFactionDetails()
        this.openAgentDetails(agentId)
        return
      }
      const close = event.target instanceof Element && event.target.closest('[data-close-faction-details]')
      const dialog = event.target instanceof Element && event.target.closest('[data-faction-details-dialog]')
      if (close || !dialog) this.closeFactionDetails()
    })
    document.body.appendChild(panel)
    return panel
  }

  private openFactionDetails(factionId: PoliticalCampId): void {
    this.openFactionDetailsId = factionId
    this.factionDetailsPanel.style.display = 'flex'
    this.renderFactionDetails(factionId, false)
  }

  private closeFactionDetails(): void {
    this.openFactionDetailsId = null
    this.factionDetailsPanel.style.display = 'none'
  }

  private renderFactionDetails(factionId: PoliticalCampId, preserveScroll = true): void {
    const members = this.latestAgents.filter((agent) => agent.politicalCamp?.id === factionId)
    const title = this.factionDetailsPanel.querySelector<HTMLElement>('#faction-details-title')
    const body = this.factionDetailsPanel.querySelector<HTMLElement>('#faction-details-body')
    if (!title || !body) return
    if (members.length === 0) {
      this.closeFactionDetails()
      return
    }
    const scrollTop = preserveScroll ? body.scrollTop : 0
    const factionName = members[0].politicalCamp?.name ?? factionId
    const living = members.filter((member) => member.alive)
    const avgWealth = living.length
      ? Math.round(living.reduce((sum, member) => sum + member.wealth, 0) / living.length)
      : 0
    const avgReputation = living.length
      ? Math.round(living.reduce((sum, member) => sum + member.reputation, 0) / living.length)
      : 0
    title.textContent = `${factionName} — faction details`

    const sortedMembers = [...members].sort((first, second) => second.wealth - first.wealth)
    const memberRows = sortedMembers.map((member) => {
      const status = member.alive ? 'alive' : member.exiled ? 'exiled' : 'dead'
      const statusColor = member.alive ? '#81c784' : member.exiled ? '#ffb74d' : '#ef5350'
      return `<div style="padding:8px;margin-bottom:6px;background:#1a2036;border:1px solid #333e63;border-radius:4px;">
        <div style="display:flex;justify-content:space-between;gap:8px;"><button data-faction-member-id="${this.escapeHtml(member.id)}" style="border:0;background:transparent;color:#c5cdf8;font:bold inherit;padding:0;cursor:pointer;">${this.escapeHtml(member.name)}</button><span style="color:${statusColor};">${status}</span></div>
        <div style="color:#a7b0d6;">Job: ${this.escapeHtml(member.currentJob ?? 'none')} · Wealth: ${Math.round(member.wealth)} · Reputation: ${Math.round(member.reputation)}</div>
      </div>`
    }).join('')

    body.innerHTML = `
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:8px;margin-bottom:10px;">
        ${this.detailSection('Overview', `Members: ${members.length} (${living.length} living)<br>Faction ID: ${this.escapeHtml(factionId)}`)}
        ${this.detailSection('Averages (living)', `Wealth: ${avgWealth}<br>Reputation: ${avgReputation}`)}
      </div>
      ${this.detailSection(`Members (${members.length})`, memberRows)}
    `
    body.scrollTop = scrollTop
  }

  private collectAllianceGroups(agents: AgentState[]): AgentState[][] {
    const byId = new Map(agents.map((agent) => [agent.id, agent]))
    const visited = new Set<string>()
    const groups: AgentState[][] = []
    for (const agent of agents) {
      if (visited.has(agent.id) || agent.alliances.length === 0) continue
      const pending = [agent.id]
      const group: AgentState[] = []
      while (pending.length) {
        const id = pending.shift()!
        if (visited.has(id)) continue
        visited.add(id)
        const member = byId.get(id)
        if (!member) continue
        group.push(member)
        pending.push(...member.alliances.filter((allyId) => byId.has(allyId)))
      }
      if (group.length > 1) groups.push(group)
    }
    return groups
  }

  // Wires a header toggle button that shows/hides a content block, starting
  // collapsed. Used by panels (Deity abilities, Demon summon) that should be
  // minimised by default on load rather than expanded like the others.
  private setupMinimisableSection(panel: HTMLElement, toggleId: string, contentId: string, label: string): void {
    const toggle = panel.querySelector<HTMLButtonElement>(`#${toggleId}`)
    const content = panel.querySelector<HTMLElement>(`#${contentId}`)
    if (!toggle || !content) return
    toggle.addEventListener('click', () => {
      const expanding = content.style.display === 'none'
      content.style.display = expanding ? 'block' : 'none'
      toggle.textContent = expanding ? '−' : '+'
      toggle.setAttribute('aria-label', expanding ? `Collapse ${label}` : `Expand ${label}`)
      toggle.setAttribute('aria-expanded', String(expanding))
    })
  }

  private setupWhisperControls(panel: HTMLElement): void {
    const sendButton = panel.querySelector<HTMLButtonElement>('#debug-whisper-send')
    const target = panel.querySelector<HTMLSelectElement>('#debug-whisper-target')
    const input = panel.querySelector<HTMLTextAreaElement>('#debug-whisper-text')
    const credibilityInput = panel.querySelector<HTMLInputElement>('#debug-whisper-credibility')
    const sourceInput = panel.querySelector<HTMLInputElement>('#debug-whisper-source')
    const status = panel.querySelector<HTMLDivElement>('#debug-whisper-status')
    sendButton?.addEventListener('click', () => {
      const text = input?.value.trim() ?? ''
      if (!text) {
        if (status) status.textContent = 'Enter a rumour first.'
        return
      }
      const requestedCredibility = Number(credibilityInput?.value ?? 50)
      const credibilityPercent = Number.isFinite(requestedCredibility)
        ? Math.max(0, Math.min(100, requestedCredibility))
        : 50
      if (credibilityInput) credibilityInput.value = credibilityPercent.toString()
      if (status) status.textContent = 'Whispering...'
      window.dispatchEvent(new CustomEvent('debug-whisper', {
        detail: {
          targetAgentId: target?.value ?? 'all',
          text,
          credibilityPercent,
          sourceHint: sourceInput?.value.trim() ?? '',
        },
      }))
    })
    window.addEventListener('debug-whisper-result', (event) => {
      const result = (event as CustomEvent<{ success: boolean; message: string }>).detail
      if (!status || !result) return
      status.style.color = result.success ? '#81c784' : '#ef5350'
      status.textContent = result.message
      if (result.success && input) input.value = ''
      if (result.success && sourceInput) sourceInput.value = ''
    })
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

  public updateAgentStates(
    agents: AgentState[],
    llmRequestStatuses: Record<string, LLMRequestStatus>,
    activityStatuses: Record<string, string>,
    agentDetails: Record<string, AgentDebugDetails>,
    simulationMinute: number
  ): void {
    this.latestAgents = agents
    this.latestAgentDetails = agentDetails
    this.latestActivityStatuses = activityStatuses
    this.latestLLMStatuses = llmRequestStatuses
    this.latestSimulationMinute = simulationMinute
    const listEl = this.container.querySelector<HTMLDivElement>('#debug-agent-list')
    if (!listEl) return
    const overlayScrollTop = this.container.scrollTop
    const previousMemory = listEl.querySelector<HTMLElement>('[data-memory-scroll]')
    const memoryScrollTop = previousMemory?.scrollTop ?? 0

    const statusRank = (agent: AgentState): number => agent.alive ? 2 : agent.exiled ? 1 : 0
    const orderedAgents = agents.slice().sort((first, second) => statusRank(second) - statusRank(first))
    listEl.innerHTML = orderedAgents
      .map((a) => {
        const statusColor = a.alive ? '#4caf50' : a.exiled ? '#ffb74d' : '#f44336'
        const statusText = a.alive ? 'alive' : a.exiled ? 'EXILED' : 'DEAD'
        const emotionColor = this.getEmotionColor(a.emotionalState)
        const isSelected = a.id === this.selectedAgentId
        const roleBadges = this.renderAgentRoleBadges(a)
        if (!a.alive) {
          return `<div data-agent-id="${this.escapeHtml(a.id)}" title="${a.exiled ? 'Exiled villager' : 'Deceased villager'}" style="padding:5px 0;border-bottom:1px solid #222;display:flex;align-items:center;gap:5px;opacity:.78;">
            ${this.renderJobIconSpan(a.currentJob)}
            <span style="color:${statusColor};font-weight:bold;">${this.escapeHtml(a.name)}</span>
            ${roleBadges}
            <span style="color:${a.exiled ? '#d99a53' : '#a65b5b'};">(${statusText})</span>
            <button data-agent-details="${this.escapeHtml(a.id)}" title="Open full details for ${this.escapeHtml(a.name)}" style="margin-left:auto;padding:2px 6px;border:1px solid ${a.exiled ? '#7a552c' : '#5d3434'};border-radius:3px;background:${a.exiled ? '#392815' : '#321f1f'};color:${a.exiled ? '#ffe0b2' : '#ffcdd2'};cursor:pointer;font:inherit;">Details</button>
          </div>`
        }
        const llmStatus = llmRequestStatuses[a.id] ?? 'idle'
        const currentActivity = activityStatuses[a.id] ?? 'idle'
        const activityColor = currentActivity.includes('think') || currentActivity.includes('planning')
          ? '#ffc107'
          : currentActivity.includes('conversation') || currentActivity === 'talking'
            ? '#64b5f6'
            : currentActivity.includes('working') || currentActivity.includes('building')
              ? '#ce93d8'
              : currentActivity.includes('investigating')
                ? '#4dd0e1'
                : currentActivity.includes('travelling') || currentActivity.includes('fleeing')
                  ? '#81c784'
                  : currentActivity === 'dead'
                    ? '#ef5350'
                    : '#aaa'
        const llmStatusColor: Record<LLMRequestStatus, string> = {
          idle: '#666',
          pending: '#ffc107',
          sent: '#4caf50',
          retrying: '#ff9800',
          failed: '#f44336',
        }
        const memoryDisplay = isSelected
          ? this.renderExpandedMemory(a)
          : a.memory.recent.length > 0
            ? `<div style="color: #555; margin-top: 1px;">Memory: ${a.memory.recent.length} events${a.memory.summary ? ' + summary' : ''}</div>`
            : ''
        const worldviewHidden = a.religiousStanceRevealed === false &&
          (a.beliefSystem.religiousStance === 'atheist' || a.beliefSystem.religiousStance === 'nonbeliever')
        const deitySummary = !worldviewHidden && a.beliefSystem.deities.length > 0
          ? a.beliefSystem.deities
              .slice()
              .sort((first, second) => second.confidence - first.confidence)
              .slice(0, 2)
              .map((deity) => `${this.escapeHtml(deity.name)} ${Math.round(deity.confidence)}%`)
              .join(', ')
          : 'none'
        const personalitySummary = this.renderPersonality(a, false)
        const blessingSummary = this.renderBlessingSummary(a)

        return `<div data-agent-id="${this.escapeHtml(a.id)}" title="${isSelected ? 'Collapse' : 'Select and follow'} ${this.escapeHtml(a.name)}" style="padding: 4px 0; border-bottom: 1px solid #222; cursor: pointer; ${isSelected ? 'background: rgba(255, 215, 0, 0.1); border-left: 3px solid #ffd700; padding-left: 7px;' : ''}">
          <div style="display:flex;align-items:center;gap:5px;">
            ${this.renderJobIconSpan(a.currentJob)}
            <span style="color: ${statusColor}; font-weight: bold;">${this.escapeHtml(a.name)}</span>
            ${roleBadges}
            <span style="color: ${statusColor};">(${statusText})</span>
            <span style="color: ${emotionColor};">${this.getEmotionLabel(a.emotionalState)}</span>
            <button data-agent-details="${this.escapeHtml(a.id)}" title="Open full details for ${this.escapeHtml(a.name)}" style="margin-left:auto;padding:2px 6px;border:1px solid #455a64;border-radius:3px;background:#263238;color:#b3e5fc;cursor:pointer;font:inherit;">Details</button>
          </div>
          <div style="color: #888; margin-top: 2px;">
            HP: ${Math.round(a.health)}/${Math.round(a.maxHealth)} | Hunger: ${Math.round(a.needs.hunger)} | Energy: ${Math.round(a.needs.energy)} | Social: ${Math.round(a.needs.social)}
          </div>
          <div style="color: #666; margin-top: 1px;">
            Pos: (${Math.round(a.position.x)}, ${Math.round(a.position.y)}) | Job: ${a.currentJob ?? 'None'} | Reputation: ${Math.round(a.reputation)}/100
          </div>
          <div style="color:#c5e1a5;margin-top:1px;">Wealth: ${Math.round(a.wealth)} | Camp: ${this.escapeHtml(a.politicalCamp?.name ?? 'unaffiliated')}</div>
          <div style="color:#ffcc80;margin-top:1px;">Personality: ${personalitySummary}</div>
          <div style="color:#9575cd;margin-top:1px;">${a.demon ? 'Worldview: none | Faith: none | Deity beliefs: none' : worldviewHidden ? 'Worldview: undisclosed | Faith and deity beliefs hidden' : `Worldview: ${this.escapeHtml(a.beliefSystem.religiousStance)} | Faith: ${Math.round(a.beliefSystem.faith)}/100 | Deity beliefs: ${deitySummary}`}</div>
          ${a.cult ? `<div style="color:#f48fb1;margin-top:1px;">Cult: ${this.escapeHtml(a.cult.name)} · ${this.escapeHtml(a.cult.role)}</div>` : ''}
          ${blessingSummary ? `<div style="color:#ffd54f;margin-top:1px;">Bonus: ${blessingSummary}</div>` : ''}
          <div style="color:${activityColor};margin-top:2px;font-weight:bold;">Current action: ${this.escapeHtml(currentActivity)}</div>
          <div style="color: ${llmStatusColor[llmStatus]}; margin-top: 1px;">LLM request: ${llmStatus}</div>
          ${memoryDisplay}
        </div>`
      })
      .join('')
    const currentMemory = listEl.querySelector<HTMLElement>('[data-memory-scroll]')
    if (currentMemory) currentMemory.scrollTop = memoryScrollTop
    this.container.scrollTop = overlayScrollTop
    if (this.openAgentDetailsId) this.renderAgentDetails(this.openAgentDetailsId)
  }

  private openAgentDetails(agentId: string): void {
    this.openAgentDetailsId = agentId
    this.agentDetailsPanel.style.display = 'flex'
    this.renderAgentDetails(agentId, false)
  }

  private closeAgentDetails(): void {
    this.openAgentDetailsId = null
    this.agentDetailsPanel.style.display = 'none'
  }

  private renderAgentDetails(agentId: string, preserveScroll = true): void {
    const agent = this.latestAgents.find((candidate) => candidate.id === agentId)
    const details = this.latestAgentDetails[agentId]
    const title = this.agentDetailsPanel.querySelector<HTMLElement>('#agent-details-title')
    const body = this.agentDetailsPanel.querySelector<HTMLElement>('#agent-details-body')
    if (!agent || !body || !title) return
    const bodyScrollTop = preserveScroll ? body.scrollTop : 0
    const previousMemories = body.querySelector<HTMLElement>('[data-agent-recent-memories]')
    const memoryScrollTop = preserveScroll ? previousMemories?.scrollTop ?? 0 : 0
    const roleIcons = this.getAgentRoleMarkers(agent).map((marker) => marker.icon).join(' ')
    title.textContent = `${getJobIcon(agent.currentJob)} ${roleIcons ? `${roleIcons} ` : ''}${agent.name} — complete agent details`
    const names = new Map(this.latestAgents.map((candidate) => [candidate.id, candidate.name]))
    const schedule = details?.schedule
    const scheduleRows = schedule?.blocks.length
      ? schedule.blocks.map((block, index) => {
          const state = index < (details.scheduleCursor ?? 0) ? 'completed' : index === (details.scheduleCursor ?? 0) ? 'next' : 'planned'
          return `<div style="padding:5px 0;border-bottom:1px solid #26333d;color:${state === 'completed' ? '#607d8b' : state === 'next' ? '#81c784' : '#cfd8dc'};">
            <strong>${this.formatMinute(block.startMinute)}</strong> · ${this.escapeHtml(block.action)}${block.target ? ` → ${this.escapeHtml(block.target)}` : ''} · ${block.durationMinutes}m <span style="color:#78909c;">[${state}]</span>
            <div style="color:#90a4ae;">${this.escapeHtml(block.reasoning)}</div>
          </div>`
        }).join('')
      : '<div style="color:#607d8b;">No daily schedule is currently assigned.</div>'
    const queueRows = details?.queuedTriggers.length
      ? details.queuedTriggers.map((trigger) => `<div style="padding:4px 0;border-bottom:1px solid #26333d;"><span style="color:#ffcc80;">[${this.escapeHtml(trigger.type)}]</span> ${this.escapeHtml(trigger.description)}</div>`).join('')
      : '<div style="color:#607d8b;">No queued intentions.</div>'
    const relationships = agent.relationships.length
      ? agent.relationships.map((relationship) => `${this.escapeHtml(names.get(relationship.agentId) ?? relationship.agentId)} — ${this.escapeHtml(relationship.type)} ${Math.round(relationship.strength)}/100`).join('<br>')
      : '<span style="color:#607d8b;">None</span>'
    const memories = agent.memory.recent.length
      ? agent.memory.recent.slice().reverse().map((event) => `<div style="padding:4px 0;border-bottom:1px solid #26333d;"><span style="color:${this.getEventTypeColor(event.type)};">[${this.escapeHtml(event.type)}]</span> ${this.escapeHtml(event.description)}</div>`).join('')
      : '<div style="color:#607d8b;">No recent memories.</div>'
    const inventory = agent.inventory.length
      ? agent.inventory.map((item) => `${this.escapeHtml(item.name)} ×${item.quantity}`).join(', ')
      : 'empty'
    const blessingSummary = this.renderBlessingSummary(agent, true)
    const roleBadges = this.renderAgentRoleBadges(agent, true)
    body.innerHTML = `
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:8px;">
        ${this.detailSection('State', `${roleBadges ? `Role markers: ${roleBadges}<br>` : ''}Status: ${agent.exiled ? 'EXILED' : agent.alive ? 'alive' : 'DEAD'}<br>${agent.exiled ? `Exiled: ${this.formatAbsoluteMinute(agent.exiled.atMinute)}<br>Reason: ${this.escapeHtml(agent.exiled.reason)}<br>` : ''}${agent.demon ? `Demon command: ${this.escapeHtml(agent.demon.lastCommand ?? 'none')}<br>` : ''}${agent.permanentInsanity ? `<span style="color:#ef9a9a;font-weight:bold;">Permanent insanity</span>: ${this.escapeHtml(agent.permanentInsanity.reason)}<br>Onset: ${this.formatAbsoluteMinute(agent.permanentInsanity.causedAtMinute)}<br>` : ''}${agent.dream ? `<span style="color:${agent.dream.isNightmare ? '#ef9a9a' : '#ce93d8'};font-weight:bold;">${agent.dream.isNightmare ? 'Nightmare' : 'Dream'}</span> (${agent.dream.plantedBy}): ${this.escapeHtml(agent.dream.biasText)}<br>` : ''}${agent.existentialState ? `Existential reaction: <span style="font-weight:bold;">${this.escapeHtml(agent.existentialState.reaction)}</span>${agent.existentialState.reinterpretationFrame ? ` (${this.escapeHtml(agent.existentialState.reinterpretationFrame)})` : ''}<br>` : ''}${agent.obsession ? `Obsession evidence: ${agent.obsession.evidenceCount} (${this.escapeHtml(agent.obsession.evidenceLog.slice(-1)[0] ?? 'watching closely')})<br>` : ''}Emotion: ${this.escapeHtml(this.getEmotionLabel(agent.emotionalState))}<br>Activity: ${this.escapeHtml(this.latestActivityStatuses[agentId] ?? 'unknown')}<br>LLM: ${this.escapeHtml(this.latestLLMStatuses[agentId] ?? 'idle')}<br>Last position: (${Math.round(agent.position.x)}, ${Math.round(agent.position.y)})<br>Job: ${this.escapeHtml(agent.currentJob ?? 'None')}<br>Reputation: ${Math.round(agent.reputation)}/100<br>Wealth: ${Math.round(agent.wealth)}/100<br>Political camp: ${this.escapeHtml(agent.politicalCamp?.name ?? 'unaffiliated')}`)}
        ${this.detailSection('Needs and health', `HP: ${Math.round(agent.health)}/${Math.round(agent.maxHealth)}<br>Hunger: ${Math.round(agent.needs.hunger)}/100<br>Energy: ${Math.round(agent.needs.energy)}/100<br>Social: ${Math.round(agent.needs.social)}/100<br>Sanity: <span style="color:${agent.sanity <= 40 ? '#ef9a9a' : agent.sanity <= 70 ? '#ffcc80' : '#a5d6a7'};">${Math.round(agent.sanity)}/100</span><br>Inventory: ${inventory}`)}
        ${this.detailSection('Personality', `${this.renderPersonality(agent)}<br><span style="color:#90a4ae;">Aggression affects confrontation; friendliness cooperation; curiosity investigation; caution safety; ambition leadership; creativity improvisation.</span>`)}
        ${this.detailSection('Beliefs and affiliations', (agent.demon ? 'Worldview: none<br>Faith: none<br>Deities: none<br>Cult: none' : agent.religiousStanceRevealed === false && (agent.beliefSystem.religiousStance === 'atheist' || agent.beliefSystem.religiousStance === 'nonbeliever') ? `Worldview: undisclosed<br>Faith: hidden<br>Deities: hidden<br>Cult: ${agent.cult ? `${this.escapeHtml(agent.cult.name)} (${this.escapeHtml(agent.cult.role)})` : 'none'}` : `Worldview: ${this.escapeHtml(agent.beliefSystem.religiousStance)}<br>Faith: ${Math.round(agent.beliefSystem.faith)}/100<br>Deities: ${agent.beliefSystem.deities.map((deity) => `${this.escapeHtml(deity.name)} ${Math.round(deity.confidence)}%`).join(', ') || 'none'}<br>Cult: ${agent.cult ? `${this.escapeHtml(agent.cult.name)} (${this.escapeHtml(agent.cult.role)})` : 'none'}`) + (agent.alderman ? `<br>Office: <strong style="color:#ffd54f;">Village Alderman</strong> (${this.escapeHtml(agent.alderman.cultName)}) — binding control over court verdicts and assembly votes` : ''))}
        ${this.detailSection('Bonuses and timed effects', blessingSummary || '<span style="color:#607d8b;">No active bonuses.</span>')}
      </div>
      ${agent.forbiddenKnowledge?.length ? this.detailSection('Forbidden knowledge', agent.forbiddenKnowledge.slice().reverse().map((entry) => `<div style="padding:4px 0;border-bottom:1px solid #26333d;"><span style="color:#ce93d8;">[${this.escapeHtml(entry.category)}, -${entry.severity} sanity]</span> "${this.escapeHtml(entry.text)}"<br><span style="color:#607d8b;">${this.formatAbsoluteMinute(entry.revealedAtMinute)}</span></div>`).join('')) : ''}
      ${this.detailSection('Current plan and reasoning', `Reasoning: ${this.escapeHtml(agent.lastReasoning || 'none')}<br>Active block: ${details?.activeAction ? `${this.escapeHtml(details.activeAction.action)}${details.activeAction.target ? ` → ${this.escapeHtml(details.activeAction.target)}` : ''}<br>${this.escapeHtml(details.activeAction.reasoning)}` : 'none'}`)}
      ${this.detailSection('Remaining daily schedule', scheduleRows)}
      ${this.detailSection('Queued intentions and reactions', queueRows)}
      ${this.detailSection('Relationships', relationships)}
      ${this.detailSection('Fears, grudges, and alliances', `Fears: ${agent.fears.map((id) => this.escapeHtml(names.get(id) ?? id)).join(', ') || 'none'}<br>Grudges: ${agent.grudges.map((id) => this.escapeHtml(names.get(id) ?? id)).join(', ') || 'none'}<br>Alliances: ${agent.alliances.map((id) => this.escapeHtml(names.get(id) ?? id)).join(', ') || 'none'}`)}
      ${this.detailSection('Memory summary', this.escapeHtml(agent.memory.summary || 'No compacted summary.'))}
      ${this.detailSection(`Recent memories (${agent.memory.recent.length})`, `<div data-agent-recent-memories style="max-height:260px;overflow-y:auto;">${memories}</div>`)}
    `
    body.scrollTop = bodyScrollTop
    const currentMemories = body.querySelector<HTMLElement>('[data-agent-recent-memories]')
    if (currentMemories) currentMemories.scrollTop = memoryScrollTop
  }

  private getAgentRoleMarkers(agent: AgentState): Array<{
    icon: string
    label: string
    color: string
    background: string
    border: string
  }> {
    const markers: Array<{
      icon: string
      label: string
      color: string
      background: string
      border: string
    }> = []
    if (agent.currentJob === 'Prophet') {
      markers.push({
        icon: '✦',
        label: 'Prophet',
        color: '#e1bee7',
        background: '#3d2448',
        border: '#8e5aa0',
      })
    }
    if (agent.secretProphet) {
      markers.push({
        icon: '🐟',
        label: 'Secret Prophet (corrupted Priest)',
        color: '#b7e1d8',
        background: '#0f2e28',
        border: '#3a8e73',
      })
    }
    if (agent.outsider?.kind === 'knight') {
      markers.push({
        icon: '🛡',
        label: 'Knight outsider',
        color: '#d7e3ea',
        background: '#263842',
        border: '#607d8b',
      })
    }
    if (agent.outsider?.kind === 'inquisitor') {
      markers.push({
        icon: '⚖',
        label: 'Inquisitor outsider',
        color: '#ffe0b2',
        background: '#49351f',
        border: '#a87838',
      })
    }
    if (agent.demon) {
      markers.push({
        icon: '☠',
        label: 'User-commanded Demon',
        color: '#ffcdd2',
        background: '#4a1118',
        border: '#c62828',
      })
    }
    if (agent.alderman) {
      markers.push({
        icon: '👑',
        label: `Village Alderman (${agent.alderman.cultName})`,
        color: '#fff3c4',
        background: '#4a3b12',
        border: '#d4af37',
      })
    }
    return markers
  }

  private renderAgentRoleBadges(agent: AgentState, detailed = false): string {
    return this.getAgentRoleMarkers(agent).map((marker) =>
      `<span title="${this.escapeHtml(marker.label)}" aria-label="${this.escapeHtml(marker.label)}" style="display:inline-flex;align-items:center;gap:3px;padding:${detailed ? '2px 6px' : '1px 4px'};border:1px solid ${marker.border};border-radius:10px;background:${marker.background};color:${marker.color};font-weight:bold;white-space:nowrap;">${marker.icon}${detailed ? ` ${this.escapeHtml(marker.label)}` : ''}</span>`
    ).join(' ')
  }

  private renderJobIconSpan(job: string | undefined): string {
    const label = job ?? 'No job'
    return `<span title="${this.escapeHtml(label)}" aria-label="${this.escapeHtml(label)}" style="flex-shrink:0;">${getJobIcon(job)}</span>`
  }

  private renderBlessingSummary(agent: AgentState, detailed = false): string {
    const blessing = agent.blessing
    if (!blessing) return ''
    const remaining = Math.max(0, Math.ceil(blessing.expiresAtMinute - this.latestSimulationMinute))
    if (remaining <= 0) return ''
    const hours = Math.floor(remaining / 60)
    const minutes = remaining % 60
    const duration = hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`
    const source = this.latestAgents.find((candidate) => candidate.id === blessing.sourceAgentId)?.name
      ?? (blessing.sourceAgentId === 'world' ? 'a deity' : blessing.sourceAgentId)
    const multiplier = `${blessing.abilityMultiplier.toFixed(1)}×`
    return detailed
      ? `<strong style="color:#ffd54f;">Blessing</strong><br>Ability effectiveness: ${multiplier} (+${Math.round((blessing.abilityMultiplier - 1) * 100)}%)<br>Affects preaching conversion progress and direct cult recruitment.<br>Source: ${this.escapeHtml(source)}<br>Expires in: ${duration} (village minute ${Math.round(blessing.expiresAtMinute)})`
      : `Blessing ${multiplier} · expires in ${duration}`
  }

  private detailSection(title: string, content: string): string {
    return `<section style="margin:8px 0;padding:9px;background:#17212a;border:1px solid #2c3e4b;border-radius:5px;"><div style="color:#80cbc4;font-weight:bold;margin-bottom:5px;">${this.escapeHtml(title)}</div>${content}</section>`
  }

  private formatMinute(minute: number): string {
    const normalized = Math.max(0, Math.min(1439, Math.round(minute)))
    return `${Math.floor(normalized / 60).toString().padStart(2, '0')}:${(normalized % 60).toString().padStart(2, '0')}`
  }

  private formatAbsoluteMinute(minute: number): string {
    const normalized = Math.max(0, Math.round(minute))
    const day = Math.floor(normalized / 1440) + 1
    const minuteOfDay = normalized % 1440
    return `day ${day}, ${this.formatMinute(minuteOfDay)}`
  }

  private renderPersonality(agent: AgentState, detailed = true): string {
    const traits = [
      ['Aggressive', 'Agg', agent.personality.aggression],
      ['Friendly', 'Fri', agent.personality.friendliness],
      ['Curious', 'Cur', agent.personality.curiosity],
      ['Cautious', 'Cau', agent.personality.caution],
      ['Ambitious', 'Amb', agent.personality.ambition],
      ['Creative', 'Cre', agent.personality.creativity],
    ] as const
    const dominant = [...traits].sort((first, second) => second[2] - first[2])[0]
    if (!detailed) return `<strong>${dominant[0]}</strong>`
    const scores = traits.map(([, short, value]) => `${short} ${Math.round(value * 100)}`).join(' · ')
    return `<strong>${dominant[0]}</strong> · ${scores}`
  }

  private renderRelationships(agent: AgentState, agents: AgentState[]): string {
    if (agent.relationships.length === 0) return '<span style="color:#666;">none</span>'
    const names = new Map(agents.map((candidate) => [candidate.id, candidate.name]))
    return agent.relationships
      .slice()
      .sort((first, second) => Math.abs(second.strength - 50) - Math.abs(first.strength - 50))
      .map((relationship) => {
        const name = names.get(relationship.agentId) ?? relationship.agentId
        return `${this.escapeHtml(name)} <span style="color:#aaa;">${this.escapeHtml(relationship.type)} ${Math.round(relationship.strength)}/100</span>`
      })
      .join(' · ')
  }

  private renderExpandedMemory(agent: AgentState): string {
    const summary = agent.memory.summary
      ? `<div style="margin-bottom: 6px; color: #aaa;"><span style="color: #4ecdc4;">Summary:</span> ${this.escapeHtml(agent.memory.summary)}</div>`
      : ''
    const recent = agent.memory.recent.length > 0
      ? agent.memory.recent
          .slice(-15)
          .reverse()
          .map((event) => `
            <div style="padding: 3px 0; border-top: 1px solid #2a2a2a;">
              <span style="color: ${this.getEventTypeColor(event.type)};">[${this.escapeHtml(event.type)}]</span>
              <span style="color: #bbb;">${this.escapeHtml(event.description)}</span>
            </div>`)
          .join('')
      : '<div style="color: #666;">No recent memories.</div>'

    return `<div style="margin-top: 6px; padding: 6px; background: rgba(255,255,255,0.04); border-radius: 3px;">
      <div style="color: #feca57; font-weight: bold; margin-bottom: 4px;">Memory</div>
      ${summary}
      <div data-memory-scroll style="max-height: 180px; overflow-y: auto;">${recent}</div>
    </div>`
  }

  private escapeHtml(value: string): string {
    return value
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;')
  }

  public updateRumours(rumours: Rumour[], agents: AgentState[]): void {
    const target = this.rumourTrackerPanel.querySelector<HTMLSelectElement>('#debug-whisper-target')
    const list = this.rumourTrackerPanel.querySelector<HTMLDivElement>('#debug-rumour-list')
    if (!target || !list) return
    const rumourScroll = this.captureScroll(list)
    const overlayScrollTop = this.container.scrollTop

    const selectedTarget = target.value
    const options = ['<option value="all">Entire town</option>']
      .concat(agents.filter((agent) => agent.alive).map((agent) =>
        `<option value="${this.escapeHtml(agent.id)}">${this.escapeHtml(agent.name)}</option>`
      ))
      .join('')
    if (target.innerHTML !== options) {
      target.innerHTML = options
      if (Array.from(target.options).some((option) => option.value === selectedTarget)) {
        target.value = selectedTarget
      }
    }
    const names = new Map(agents.map((agent) => [agent.id, agent.name]))
    if (rumours.length === 0) {
      list.innerHTML = '<div style="color: #666;">No rumours circulating.</div>'
      this.restoreScroll(list, rumourScroll, false)
      this.container.scrollTop = overlayScrollTop
      return
    }
    list.innerHTML = rumours.slice(-15).reverse().map((rumour) => {
      const originColor = this.getRumourOriginColor(rumour.origin)
      const believers = rumour.beliefs.filter((belief) => belief.stance === 'believer').length
      const deniers = rumour.beliefs.filter((belief) => belief.stance === 'denier').length
      const uncertain = rumour.beliefs.filter((belief) => belief.stance === 'uncertain').length
      const responseText = rumour.responses.length > 0
        ? rumour.responses.slice(-3).reverse().map((response) =>
            `<div style="margin-top: 3px; color: #aaa;"><span style="color: #80cbc4;">${this.escapeHtml(names.get(response.agentId) ?? response.agentId)}</span> → ${this.escapeHtml(response.action)} (${this.escapeHtml(response.emotionalState)}): ${this.escapeHtml(response.reasoning)}</div>`
          ).join('')
        : '<div style="margin-top: 3px; color: #666;">Awaiting reactions...</div>'
      const court = rumour.resolutionCourt
      const courtText = court
        ? `<div style="margin-top:5px;padding:5px;border:1px solid #795548;color:#ffcc80;">Resolution court: ${this.escapeHtml(court.status)} · Accused: ${this.escapeHtml(names.get(court.accusedAgentId) ?? court.accusedAgentId)}${court.defenseStatement ? `<div style="color:#d7ccc8;">Defense: “${this.escapeHtml(court.defenseStatement)}”</div>` : ''} · Votes: ${court.votes.map((vote) => `${this.escapeHtml(names.get(vote.agentId) ?? vote.agentId)}=${this.escapeHtml(vote.choice)}`).join(', ') || 'none yet'}${court.resolution ? `<div style="color:#ffe0b2;">${this.escapeHtml(court.resolution)}</div>` : ''}</div>`
        : ''
      return `<div style="padding: 6px 0; border-top: 1px solid #2a2a2a;">
        <div><span style="color: ${originColor};">[${rumour.origin}]</span> ${this.escapeHtml(rumour.text)}</div>
        <div style="color:#b39ddb;">Suggested origin: [${this.escapeHtml(rumour.provenance.kind)}] ${this.escapeHtml(rumour.provenance.description)}${rumour.provenance.deityName ? ` · Deity: ${this.escapeHtml(rumour.provenance.deityName)}` : ''}</div>
        ${rumour.parentRumourId ? `<div style="color:#8d7f99;">Mutation of: ${this.escapeHtml(rumour.parentRumourId)}</div>` : ''}
        <div style="color: #777;">Reach: ${rumour.heardBy.length}/${agents.length} | Shares: ${rumour.transmissions} | Related: ${rumour.relatedRumourIds.length} | Pending first shares: ${rumour.pendingFirstShareBy.length} | Credibility: ${(rumour.credibility * 100).toFixed(0)}% (${rumour.credibilitySourceIds.length} rated sources) | Status: ${this.escapeHtml(rumour.status)}</div>
        <div style="color: #9575cd;">Believers: ${believers} | Deniers: ${deniers} | Uncertain: ${uncertain}</div>
        ${rumour.investigatorIds.length > 0 ? `<div style="color: #90caf9;">Investigated by: ${rumour.investigatorIds.map((id) => this.escapeHtml(names.get(id) ?? id)).join(', ')}</div>` : ''}
        ${rumour.finding ? `<div style="color: #b0bec5;">Finding (${rumour.findingHeardBy.length}/${agents.length} informed): ${this.escapeHtml(rumour.finding)}</div>` : ''}
        ${courtText}
        ${responseText}
      </div>`
    }).join('')
    this.restoreScroll(list, rumourScroll, true)
    this.container.scrollTop = overlayScrollTop
  }

  public updateRumourTracker(rumours: Rumour[], agents: AgentState[]): void {
    const rumourList = this.rumourTrackerPanel.querySelector<HTMLDivElement>('#rumour-tracker-rumours')
    const thoughtList = this.rumourTrackerPanel.querySelector<HTMLDivElement>('#rumour-tracker-thoughts')
    if (!rumourList || !thoughtList) return
    const trackerContent = this.rumourTrackerPanel.querySelector<HTMLElement>('#rumour-tracker-content')
    const trackerScroll = trackerContent ? this.captureScroll(trackerContent) : null

    const names = new Map(agents.map((agent) => [agent.id, agent.name]))
    const statusColors: Record<Rumour['status'], string> = {
      unverified: '#ffb74d',
      investigating: '#64b5f6',
      verified: '#81c784',
      unsubstantiated: '#ef9a9a',
      resolved: '#90a4ae',
    }
    const stanceColors: Record<Rumour['beliefs'][number]['stance'], string> = {
      believer: '#81c784',
      denier: '#ef5350',
      uncertain: '#b0bec5',
    }

    const activeRumours = rumours.filter((rumour) => !rumour.archived)
    const archivedRumours = rumours.filter((rumour) => rumour.archived)

    const investigationBadge = (rumour: Rumour): string => {
      if (rumour.status === 'verified') {
        return '<span style="color:#81c784;border:1px solid #81c784;border-radius:9px;padding:1px 6px;font-size:9px;font-weight:bold;white-space:nowrap;">✓ Verified</span>'
      }
      if (rumour.status === 'unsubstantiated') {
        return '<span style="color:#ef9a9a;border:1px solid #ef9a9a;border-radius:9px;padding:1px 6px;font-size:9px;font-weight:bold;white-space:nowrap;">✗ False</span>'
      }
      return ''
    }

    rumourList.innerHTML = activeRumours.length === 0
      ? '<div style="color:#766a82;padding:5px 0;">No rumours have reached the town yet.</div>'
      : activeRumours.slice(-8).reverse().map((rumour) => {
          const originColor = this.getRumourOriginColor(rumour.origin)
          const courtDemanders = rumour.beliefs.filter((belief) => belief.justiceResponse === 'court').length
          const vigilantes = rumour.beliefs.filter((belief) => belief.justiceResponse === 'vigilante').length
          const beliefBadges = rumour.beliefs.length === 0
            ? '<span style="color:#766a82;">No agent beliefs yet</span>'
            : rumour.beliefs.map((belief) => {
                const name = names.get(belief.agentId) ?? belief.agentId
                const divineLabel = rumour.provenance.kind === 'divine' && belief.stance === 'believer'
                  ? ` in ${rumour.provenance.deityName ?? 'the divine'}`
                  : ''
                const justiceLabel = belief.justiceResponse && belief.justiceResponse !== 'gossip'
                  ? ` · ${belief.justiceResponse}`
                  : ''
                const label = belief.stance === 'believer' ? `believes${divineLabel}${justiceLabel}` : belief.stance === 'denier' ? 'denies' : 'uncertain'
                const sourceTitle = belief.perceivedSource ? `Source belief: ${belief.perceivedSource} — ` : ''
                const confidence = belief.confidence === undefined ? '' : ` ${Math.round(belief.confidence * 100)}%`
                return `<button data-agent-id="${this.escapeHtml(belief.agentId)}" title="${this.escapeHtml(sourceTitle)}${belief.seeded ? 'Whisper seed believer — ' : ''}Select ${this.escapeHtml(name)}" style="border:1px solid ${stanceColors[belief.stance]};background:transparent;color:${stanceColors[belief.stance]};border-radius:9px;padding:1px 5px;font:inherit;cursor:pointer;">${belief.seeded ? '★' : belief.extreme ? '!' : ''}${this.escapeHtml(name.split(' ')[0])}: ${this.escapeHtml(label)}${confidence}</button>`
              }).join(' ')
          const court = rumour.resolutionCourt
          const truthControl = rumour.origin === 'whisper'
            ? `<label title="Controls what authoritative investigations discover" style="display:inline-flex;align-items:center;gap:4px;color:${rumour.groundTruth ? '#81c784' : '#ef9a9a'};white-space:nowrap;"><input type="checkbox" data-whisper-truth="${this.escapeHtml(rumour.id)}" ${rumour.groundTruth ? 'checked' : ''}> Objectively ${rumour.groundTruth ? 'true' : 'false'}</label>`
            : ''
          const courtDetails = court
            ? `<div style="margin-top:5px;padding:5px;background:rgba(121,85,72,.18);border-left:3px solid #ffb74d;color:#ffcc80;">Court ${this.escapeHtml(court.status)} · ${this.escapeHtml(names.get(court.accusedAgentId) ?? court.accusedAgentId)} accused · ${court.votes.length}/${court.participantIds.length} votes${court.defenseStatement ? `<div style="color:#d7ccc8;">Defense: “${this.escapeHtml(court.defenseStatement)}”</div>` : ''}${court.votes.map((vote) => `<div style="color:#c7b7a7;">${this.escapeHtml(names.get(vote.agentId) ?? vote.agentId)}: “${this.escapeHtml(vote.statement)}” → ${this.escapeHtml(vote.choice)}</div>`).join('')}${court.outcomeStatement ? `<div style="color:#e1bee7;">Post-verdict: “${this.escapeHtml(court.outcomeStatement)}”</div>` : ''}${court.resolution ? `<div style="color:#ffe0b2;font-weight:bold;">${this.escapeHtml(court.resolution)}</div>` : ''}</div>`
            : ''
          return `<div data-rumour-card="${this.escapeHtml(rumour.id)}" style="padding:7px 0;border-bottom:1px solid #30263b;">
            <div style="display:flex;justify-content:space-between;gap:8px;align-items:flex-start;">
              <span style="color:#eee;line-height:1.35;"><span style="color:${originColor};">[${this.escapeHtml(rumour.origin)}]</span> ${this.escapeHtml(rumour.text)}</span>
              <span style="display:flex;gap:5px;align-items:center;white-space:nowrap;">${investigationBadge(rumour)}<span style="color:${statusColors[rumour.status]};font-size:10px;">${this.escapeHtml(rumour.status)}</span></span>
            </div>
            <div style="color:#897b98;margin:3px 0;">Credibility ${(rumour.credibility * 100).toFixed(0)}% · Heard ${rumour.heardBy.length}/${agents.length} · Shared ${rumour.transmissions}x · Related ${rumour.relatedRumourIds.length}</div>
            <div style="color:${courtDemanders ? '#ffb74d' : vigilantes ? '#ef5350' : '#80cbc4'};margin:2px 0;">Agent judgments · Court ${courtDemanders} · Vigilante ${vigilantes} · Gossip ${Math.max(0, rumour.beliefs.length - courtDemanders - vigilantes)}</div>
            ${truthControl ? `<div style="margin:4px 0;">${truthControl}</div>` : ''}
            <div style="color:#b39ddb;margin:2px 0;">Origin: ${this.escapeHtml(rumour.provenance.description)}${rumour.provenance.deityName ? ` · ${this.escapeHtml(rumour.provenance.deityName)}` : ''}</div>
            <div style="display:flex;flex-wrap:wrap;gap:3px;">${beliefBadges}</div>
            ${courtDetails}
          </div>`
        }).join('') + this.renderArchivedRumours(archivedRumours)

    this.clusterRumourTimelineCards(rumourList, activeRumours)

    const thoughts = this.eventBus.getHistory()
      .filter((event) => event.type === 'thought')
      .slice(-35)
      .reverse()
    thoughtList.innerHTML = thoughts.length === 0
      ? '<div style="color:#766a82;">Agent thoughts will appear when rumours are encountered.</div>'
      : thoughts.map((event) => {
          const agentName = names.get(event.agentId) ?? event.agentId
          const stance = event.outcome === 'believer' || event.outcome === 'denier' || event.outcome === 'uncertain'
            ? event.outcome
            : 'uncertain'
          const rumourId = typeof event.worldStateDelta.rumourId === 'string'
            ? event.worldStateDelta.rumourId
            : undefined
          const rumour = rumourId ? rumours.find((candidate) => candidate.id === rumourId) : undefined
          const time = new Date(event.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
          return `<div style="padding:6px;background:rgba(255,255,255,.035);border-left:3px solid ${stanceColors[stance]};border-radius:2px;">
            <div style="display:flex;justify-content:space-between;gap:8px;">
              <button data-agent-id="${this.escapeHtml(event.agentId)}" style="border:0;background:transparent;padding:0;color:${stanceColors[stance]};font:inherit;font-weight:bold;cursor:pointer;">${this.escapeHtml(agentName)}</button>
              <span style="color:#6f6479;font-size:9px;">${time}</span>
            </div>
            <div style="color:#cbc2d3;line-height:1.35;margin-top:2px;">${this.escapeHtml(event.description.replace(`${agentName} thinks: `, ''))}</div>
            ${rumour ? `<div style="color:#766a82;font-size:9px;margin-top:2px;">About: ${this.escapeHtml(rumour.text)}</div>` : ''}
          </div>`
        }).join('')
    this.renderCourtReadiness(rumours, agents, names)
    if (trackerContent && trackerScroll) this.restoreScroll(trackerContent, trackerScroll, true)
  }

  // Expired rumours are kept as history rather than deleted, so they get a
  // minimized, greyed-out, collapsed-by-default block instead of a full card.
  private renderArchivedRumours(archivedRumours: Rumour[]): string {
    if (archivedRumours.length === 0) return ''
    const rows = archivedRumours.slice(-30).reverse().map((rumour) => {
      const originColor = this.getRumourOriginColor(rumour.origin)
      return `<div style="padding:4px 0;border-bottom:1px solid #241d2e;color:#6f6479;">
        <div style="line-height:1.3;"><span style="color:${originColor};opacity:.6;">[${this.escapeHtml(rumour.origin)}]</span> ${this.escapeHtml(rumour.text)}</div>
        <div style="font-size:9px;margin-top:1px;">${this.escapeHtml(rumour.timelineSummary ?? `Archived ${rumour.status}`)}</div>
      </div>`
    }).join('')
    return `<details style="margin-top:8px;border-top:1px solid #30263b;padding-top:6px;">
      <summary style="cursor:pointer;color:#897b98;font-size:10px;user-select:none;">Historical rumours (${archivedRumours.length}) — expired from active tracking</summary>
      <div style="margin-top:4px;opacity:.75;">${rows}</div>
    </details>`
  }

  private clusterRumourTimelineCards(container: HTMLDivElement, rumours: Rumour[]): void {
    const cards = new Map(
      Array.from(container.querySelectorAll<HTMLElement>('[data-rumour-card]'))
        .map((card) => [card.dataset.rumourCard!, card] as const)
    )
    if (cards.size < 2) return
    const byId = new Map(rumours.map((rumour) => [rumour.id, rumour]))
    const visibleIds = new Set(cards.keys())
    const visited = new Set<string>()
    const clusters: Rumour[][] = []

    for (const startId of visibleIds) {
      if (visited.has(startId)) continue
      const pending = [startId]
      const cluster: Rumour[] = []
      while (pending.length > 0) {
        const id = pending.shift()!
        if (visited.has(id) || !visibleIds.has(id)) continue
        visited.add(id)
        const rumour = byId.get(id)
        if (!rumour) continue
        cluster.push(rumour)
        for (const relatedId of rumour.relatedRumourIds) pending.push(relatedId)
        for (const candidate of rumours) {
          if (candidate.relatedRumourIds.includes(id)) pending.push(candidate.id)
        }
      }
      if (cluster.length > 1) clusters.push(cluster)
    }

    for (const cluster of clusters) {
      cluster.sort((first, second) => second.createdAt - first.createdAt)
      const clusterId = [...cluster.map((rumour) => rumour.id)].sort()[0]
      const firstCard = cards.get(cluster[0].id)
      if (!firstCard?.parentElement) continue
      const details = document.createElement('details')
      details.dataset.rumourCluster = clusterId
      details.open = this.expandedRumourClusterIds.has(clusterId)
      details.style.cssText = 'margin:5px 0;border:1px solid #4a385d;border-radius:5px;background:rgba(70,48,88,.12);overflow:hidden;'
      const statuses = [...new Set(cluster.map((rumour) => rumour.status))]
      const maxReach = Math.max(...cluster.map((rumour) => rumour.heardBy.length))
      const summary = document.createElement('summary')
      summary.style.cssText = 'cursor:pointer;padding:7px 8px;color:#e1bee7;background:rgba(65,45,90,.38);line-height:1.35;'
      summary.innerHTML = `<strong>Associated timeline · ${cluster.length} claims</strong><div style="color:#9d8bab;font-size:10px;margin-top:2px;">Newest: ${this.escapeHtml(cluster[0].text)} · Reach up to ${maxReach} · ${statuses.map((status) => this.escapeHtml(status)).join(', ')}</div>`
      const body = document.createElement('div')
      body.style.cssText = 'padding:0 8px;'
      for (const rumour of cluster) {
        const card = cards.get(rumour.id)
        if (card) body.appendChild(card)
      }
      details.append(summary, body)
      container.insertBefore(details, container.firstChild)
      details.addEventListener('toggle', () => {
        if (details.open) this.expandedRumourClusterIds.add(clusterId)
        else this.expandedRumourClusterIds.delete(clusterId)
      })
    }
  }

  private renderCourtReadiness(
    rumours: Rumour[],
    agents: AgentState[],
    names: Map<string, string>
  ): void {
    const target = this.rumourTrackerPanel.querySelector<HTMLDivElement>('#court-readiness-content')
    if (!target) return
    const living = agents.filter((agent) => agent.alive)
    const byId = new Map(rumours.map((rumour) => [rumour.id, rumour]))
    const visited = new Set<string>()
    const groups: Array<{
      accused: AgentState
      claims: Rumour[]
      reachedVillagers: Set<string>
      villageSize: number
      courtStatus?: string
    }> = []

    for (const seed of rumours) {
      if (seed.status === 'resolved') continue
      if (visited.has(seed.id)) continue
      const cluster: Rumour[] = []
      const pending = [seed.id]
      while (pending.length) {
        const id = pending.shift()!
        if (visited.has(id)) continue
        visited.add(id)
        const rumour = byId.get(id)
        if (!rumour) continue
        cluster.push(rumour)
        pending.push(...rumour.relatedRumourIds)
      }

      for (const accused of living) {
        const fullName = accused.name.toLowerCase()
        const firstName = fullName.split(' ')[0]
        const escapedFirstName = firstName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
        const claims = cluster.filter((rumour) => {
          const text = rumour.text.toLowerCase()
          return text.includes(fullName) || new RegExp(`\\b${escapedFirstName}\\b`).test(text)
        })
        if (!claims.length) continue
        const livingIds = new Set(living.map((agent) => agent.id))
        // A single claim reaching the whole living village triggers court.
        // Do not combine partial reach from separate related claims.
        const reachedVillagers = claims
          .map((claim) => new Set(claim.heardBy.filter((agentId) => livingIds.has(agentId))))
          .sort((first, second) => second.size - first.size)[0] ?? new Set<string>()
        const court = claims.find((claim) => claim.resolutionCourt)?.resolutionCourt
        groups.push({
          accused,
          claims,
          reachedVillagers,
          villageSize: living.length,
          courtStatus: court?.status,
        })
      }
    }

    groups.sort((first, second) =>
      Number(Boolean(second.courtStatus)) - Number(Boolean(first.courtStatus)) ||
      second.reachedVillagers.size / Math.max(1, second.villageSize) -
        first.reachedVillagers.size / Math.max(1, first.villageSize)
    )
    target.innerHTML = `
      <div style="color:#cdb99f;margin-bottom:8px;">A court convenes as soon as one accusation reaches every living villager. Verification, credibility, belief stance, and personal demand do not affect readiness. Vigilante judgments remain separate.</div>
      ${groups.length ? groups.map((group) => {
        const progress = Math.min(100, group.reachedVillagers.size / Math.max(1, group.villageSize) * 100)
        const remaining = Math.max(0, group.villageSize - group.reachedVillagers.size)
        const readiness = remaining === 0 ? 'Ready for court' : `${remaining} villager${remaining === 1 ? '' : 's'} not reached`
        const stanceDetails = group.claims.map((claim, claimIndex) => {
          const badges = living.map((villager) => {
            const belief = claim.beliefs.find((candidate) => candidate.agentId === villager.id)
            const heard = claim.heardBy.includes(villager.id)
            const stance = belief?.stance ?? (heard ? 'uncertain' : 'not heard')
            const color = stance === 'believer'
              ? '#81c784'
              : stance === 'denier'
                ? '#ef5350'
                : stance === 'uncertain'
                  ? '#b0bec5'
                  : '#76695b'
            const confidence = belief?.confidence === undefined
              ? ''
              : ` ${Math.round(belief.confidence * 100)}%`
            return `<button data-agent-id="${this.escapeHtml(villager.id)}" title="Select ${this.escapeHtml(villager.name)}" style="border:1px solid ${color};background:transparent;color:${color};border-radius:9px;padding:1px 5px;font:inherit;cursor:pointer;">${this.escapeHtml(villager.name.split(' ')[0])}: ${this.escapeHtml(stance)}${confidence}</button>`
          }).join(' ')
          return `<div style="margin-top:6px;padding:5px;background:rgba(255,255,255,.025);border-left:2px solid #6d573e;">
            <div style="color:#c9b69e;margin-bottom:4px;">Claim ${claimIndex + 1}: ${this.escapeHtml(claim.text)}</div>
            <div style="display:flex;flex-wrap:wrap;gap:3px;">${badges}</div>
          </div>`
        }).join('')
        return `<div style="padding:8px 0;border-bottom:1px solid #3c3025;">
          <div style="display:flex;justify-content:space-between;gap:8px;"><strong style="color:#ffcc80;">${this.escapeHtml(group.accused.name)}</strong><span style="color:${group.courtStatus ? '#81d4fa' : progress >= 100 ? '#81c784' : progress >= 75 ? '#ffb74d' : '#aaa'};">${group.courtStatus ? `Court ${this.escapeHtml(group.courtStatus)}` : readiness}</span></div>
          <div style="height:7px;background:#2b2520;border-radius:4px;margin:6px 0;overflow:hidden;"><div style="height:100%;width:${progress}%;background:${progress >= 100 ? '#81c784' : '#a98252'};"></div></div>
          <div style="color:#bca98f;">Reach: ${group.reachedVillagers.size}/${group.villageSize} living villagers · ${group.claims.length} related claim${group.claims.length === 1 ? '' : 's'}</div>
          <div style="color:#827466;margin-top:3px;">Reached: ${[...group.reachedVillagers].map((id) => this.escapeHtml(names.get(id) ?? id)).join(', ') || 'none'}</div>
          <div style="color:#76695b;margin-top:3px;">Statuses: ${group.claims.map((claim) => this.escapeHtml(claim.status)).join(', ')}</div>
          <div style="color:#d7c2a7;font-weight:bold;margin-top:7px;">Villager stances</div>
          ${stanceDetails}
        </div>`
      }).join('') : '<div style="color:#766a82;padding:10px 0;">No accusation currently names a living agent.</div>'}
    `
  }

  private captureScroll(element: HTMLElement): { top: number; nearBottom: boolean } {
    return {
      top: element.scrollTop,
      nearBottom: element.scrollHeight - element.scrollTop - element.clientHeight <= 24,
    }
  }

  private getRumourOriginColor(origin: Rumour['origin']): string {
    const colors: Record<Rumour['origin'], string> = {
      natural: '#ffb74d',
      whisper: '#ce93d8',
      invented: '#f48fb1',
      mutated: '#ffd54f',
    }
    return colors[origin]
  }

  private restoreScroll(
    element: HTMLElement,
    state: { top: number; nearBottom: boolean },
    followNewest: boolean
  ): void {
    element.scrollTop = followNewest && state.nearBottom
      ? element.scrollHeight
      : state.top
  }

  private getEventTypeColor(type: string): string {
    const colors: Record<string, string> = {
      attack: '#f44336',
      death: '#ff0000',
      theft: '#ff9800',
      destroy: '#f44336',
      help: '#4caf50',
      conversation: '#2196f3',
      encounter: '#03a9f4',
      weather: '#90caf9',
      rumour: '#ce93d8',
      rumour_corroboration: '#ba68c8',
      rumour_resolution: '#90a4ae',
      cult_formed: '#f06292',
      cult_recruitment: '#ec407a',
      cult_defection: '#ff7043',
      cult_leadership: '#ffd54f',
      cult_request: '#ce93d8',
      thought: '#ab47bc',
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
      [EmotionalState.PANICKED]: '#e040fb',
      [EmotionalState.GRIEVING]: '#3949ab',
      [EmotionalState.AMBIVALENT]: '#9e9e9e',
      [EmotionalState.DETERMINED]: '#00bfa5',
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
      [EmotionalState.PANICKED]: 'Panicked',
      [EmotionalState.GRIEVING]: 'Grieving',
      [EmotionalState.AMBIVALENT]: 'Ambivalent',
      [EmotionalState.DETERMINED]: 'Determined',
    }
    return labels[emotion] ?? 'Unknown'
  }

}
