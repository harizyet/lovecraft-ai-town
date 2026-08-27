import { Agent } from '@/agent/Agent'
import { ActionType, StoryMoment, StoryMomentKind } from '@/types'
import { SystemDeps } from './SystemDeps'

export interface StoryState {
  storyMoments: StoryMoment[]
  storyMomentCounter: number
  firstCultRecruitNarratedCultIds: Set<string>
  firstBelieverPoachedNarratedCultIds: Set<string>
  firstDeityAbilityNarratedKinds: Set<string>
  onlyCultistsSurviveNarrated: boolean
  cultLeaderSoleSurvivorNarrated: boolean
  cultsHaveExistedInGame: boolean
  cultsExtinguishedNarrated: boolean
  pendingStoryMomentNarrations: number
  storyMomentNarrationChain: Promise<void>
}

export function createStoryState(): StoryState {
  return {
    storyMoments: [],
    storyMomentCounter: 0,
    firstCultRecruitNarratedCultIds: new Set(),
    firstBelieverPoachedNarratedCultIds: new Set(),
    firstDeityAbilityNarratedKinds: new Set(),
    onlyCultistsSurviveNarrated: false,
    cultLeaderSoleSurvivorNarrated: false,
    cultsHaveExistedInGame: false,
    cultsExtinguishedNarrated: false,
    pendingStoryMomentNarrations: 0,
    storyMomentNarrationChain: Promise.resolve(),
  }
}

// Story/narration: queues an LLM narration for a key story moment (a cult
// forming, a prophet's birth, a demon's first ritual) and tracks which
// "narrate only the first time" beats have already fired.
export class StorySystem {
  constructor(private deps: SystemDeps, public readonly state: StoryState) {}

  public hasPendingNarrations(): boolean {
    return this.state.pendingStoryMomentNarrations > 0
  }

  public getStoryMoments(): StoryMoment[] {
    return this.state.storyMoments
  }

  // Queues an LLM narration for a key story moment (a cult forming, a
  // prophet's birth, a demon's first ritual). Best-effort: if the LLM is
  // busy or unavailable, the moment simply never becomes 'ready' and the
  // narration panel never shows it, without blocking the triggering event.
  public queueStoryMoment(kind: StoryMomentKind, title: string, facts: string, agentId: string, sourceEventId: string): void {
    const moment: StoryMoment = {
      // Includes a timestamp, not just the per-session counter: the counter
      // alone would restart at 1 on every page reload, while the panel's
      // "already acknowledged" set persists in localStorage across reloads
      // -- a fresh moment could otherwise collide with an id acknowledged in
      // an earlier session and get silently suppressed.
      id: `story_${Date.now()}_${++this.state.storyMomentCounter}`,
      kind,
      title,
      narrative: '',
      status: 'pending',
      createdAtMinute: this.deps.getAbsoluteMinute(),
      sourceEventId,
    }
    this.state.storyMoments.push(moment)
    this.logStoryMomentEvent(moment, agentId, 'triggered', `Story moment triggered: ${kind} (${title}).`)
    // Chained rather than fired concurrently: story moments are often queued
    // several at once from a single trigger (e.g. a Priest's corruption also
    // corrupting the church and its whole flock in the same tick). Racing
    // them all against the same shared LLM slot meant later moments could
    // lose the race and time out even when the slot was, overall, free often
    // enough to serve them one at a time. Chaining guarantees each one gets
    // its own full wait window in strict trigger order.
    this.state.storyMomentNarrationChain = this.state.storyMomentNarrationChain.then(
      () => this.generateStoryMomentNarration(moment, facts, agentId)
    )
  }

  // Emits a debug-visible event for every stage of a story moment's life
  // (triggered / ready / failed) so narration issues show up in the Events
  // tab instead of only the browser console.
  private logStoryMomentEvent(moment: StoryMoment, agentId: string, outcome: string, description: string): void {
    console.log(`[StoryMoment:${outcome}] ${description}`)
    this.deps.eventBus.emit({
      type: 'story_moment',
      agentId,
      actionType: ActionType.IDLE,
      outcome,
      description,
      causationIds: [moment.sourceEventId],
      worldStateDelta: { momentId: moment.id, kind: moment.kind, title: moment.title, status: moment.status },
      observers: [],
    })
  }

  // Narrates only the very first villager a cult leader wins over -- later
  // recruits are common enough not to warrant their own popup.
  public queueFirstCultRecruitMoment(leader: Agent, cultId: string, cultName: string, recruit: Agent, sourceEventId: string): void {
    if (this.state.firstCultRecruitNarratedCultIds.has(cultId)) return
    this.state.firstCultRecruitNarratedCultIds.add(cultId)
    this.queueStoryMoment(
      'first_cultist_recruited',
      cultName,
      `${leader.state.name}, leader of "${cultName}", won their first true convert: ${recruit.state.name} pledged themselves to the cult.`,
      leader.state.id,
      sourceEventId
    )
  }

  // Narrates only the first time a given cult successfully poaches a
  // believer away from an existing faith (rather than converting an
  // unaffiliated villager) -- a distinct beat of apostasy and betrayal,
  // not a stranger's first awakening.
  public queueBelieverPoachedMoment(
    recruiter: Agent,
    cultId: string,
    cultName: string,
    convert: Agent,
    formerCultName: string,
    sourceEventId: string
  ): void {
    if (this.state.firstBelieverPoachedNarratedCultIds.has(cultId)) return
    this.state.firstBelieverPoachedNarratedCultIds.add(cultId)
    this.queueStoryMoment(
      'believer_poached',
      cultName,
      `${convert.state.name}, once devoted to "${formerCultName}", renounced that faith and pledged themselves instead to "${cultName}" at ${recruiter.state.name}'s urging.`,
      convert.state.id,
      sourceEventId
    )
  }

  // Narrates only the very first time each distinct deity ability (bless,
  // heal, smite, resurrect, manifest, weather, converse) is ever invoked in
  // the village -- later uses of an already-witnessed power don't repeat it.
  public queueFirstDeityAbilityMoment(ability: string, facts: string, agentId: string, sourceEventId: string): void {
    if (this.state.firstDeityAbilityNarratedKinds.has(ability)) return
    this.state.firstDeityAbilityNarratedKinds.add(ability)
    const label = ability.charAt(0).toUpperCase() + ability.slice(1)
    this.queueStoryMoment('deity_ability_first_used', label, facts, agentId, sourceEventId)
  }

  // Checked every tick rather than off a single death/exile event: an
  // agent can stop being alive through many separate paths (combat,
  // starvation, suicide, execution, exile, sacrifice), and re-deriving the
  // village's current survivor composition here is simpler and more
  // reliable than threading this check through every one of those sites.
  // Each of the two beats below narrates only once per game, same as the
  // other "first time" story moments.
  public checkSurvivorComposition(agents: Agent[]): void {
    if (this.state.onlyCultistsSurviveNarrated && this.state.cultLeaderSoleSurvivorNarrated) return
    const living = agents.filter((agent) => agent.state.alive)
    if (living.length === 0) return
    if (!living.every((agent) => !!agent.state.cult)) return

    if (living.length === 1) {
      const survivor = living[0]
      const role = survivor.state.cult?.role
      if (role === 'leader' || role === 'founder') {
        this.queueCultLeaderSoleSurvivorMoment(survivor)
        return
      }
    }
    this.queueOnlyCultistsSurviveMoment(living)
  }

  // Narrates only once: the moment every remaining villager belongs to a
  // cult, with no unconverted soul left alive to notice.
  private queueOnlyCultistsSurviveMoment(survivors: Agent[]): void {
    if (this.state.onlyCultistsSurviveNarrated) return
    this.state.onlyCultistsSurviveNarrated = true
    const names = survivors.map((agent) => agent.state.name).join(', ')
    this.queueStoryMoment(
      'only_cultists_survive',
      'The Village That Remains',
      `Every villager still alive is now a member of a cult -- the survivors are: ${names}. No unconverted soul remains in the village.`,
      survivors[0].state.id,
      ''
    )
  }

  // Narrates only once: the cult's leader left as the very last living
  // soul in the village.
  private queueCultLeaderSoleSurvivorMoment(survivor: Agent): void {
    if (this.state.cultLeaderSoleSurvivorNarrated) return
    this.state.cultLeaderSoleSurvivorNarrated = true
    const cultName = survivor.state.cult?.name ?? 'their cult'
    this.queueStoryMoment(
      'cult_leader_sole_survivor',
      cultName,
      `${survivor.state.name}, leader of "${cultName}", is now the only living soul left in the village. Every other villager is dead, exiled, or otherwise gone.`,
      survivor.state.id,
      ''
    )
  }

  // Checked every tick, same as checkSurvivorComposition: cult membership
  // (and its clean-up on the last member's death/exile) happens across many
  // scattered sites, so re-deriving "does any cult still exist" here is
  // simpler than threading a call through each of them. Only fires once a
  // cult has actually existed in this game, so a fresh village with no
  // cults yet doesn't immediately narrate its own absence.
  public checkCultExtinction(agents: Agent[]): void {
    if (this.state.cultsExtinguishedNarrated) return
    const anyCultExists = agents.some((agent) => !!agent.state.cult)
    if (anyCultExists) {
      this.state.cultsHaveExistedInGame = true
      return
    }
    if (!this.state.cultsHaveExistedInGame) return
    this.state.cultsExtinguishedNarrated = true
    this.queueStoryMoment(
      'cults_extinguished',
      'The Last Cult Falls',
      'Every cult that ever rose in the village -- and every leader who ever led one -- is now gone. No cult and no cult leader remains anywhere in the village.',
      agents[0]?.state.id ?? 'world',
      ''
    )
  }

  // Waits for the shared LLM request slot to free up rather than giving up
  // immediately: story moments are often queued back-to-back (e.g. a
  // Priest's secret acceptance immediately followed by their church's
  // corruption), and the first would otherwise permanently steal the slot
  // out from under the second. While this is waiting, pendingStoryMomentNarrations
  // stays above zero, so every other soft-yield LLM call site (court
  // statements, policy votes, daily plans, prophetic claims, ordinary
  // decisions) backs off and lets the freed slot go to the narration first --
  // a key story moment takes priority over routine agent activity. This is
  // only a grace period, not a hard cutoff: the caller doesn't give up when
  // it elapses, it proceeds without the slot (see generateStoryMomentNarration).
  private async waitForLLMSlot(maxWaitMs = 20000): Promise<boolean> {
    const start = Date.now()
    while (this.deps.isLLMRequestInFlight()) {
      if (Date.now() - start >= maxWaitMs) return false
      await new Promise((resolve) => setTimeout(resolve, 250))
    }
    return true
  }

  private async generateStoryMomentNarration(moment: StoryMoment, facts: string, agentId: string): Promise<void> {
    if (!this.deps.aiProvider?.isAvailable()) {
      moment.status = 'failed'
      this.logStoryMomentEvent(moment, agentId, 'failed', `Story moment narration skipped: ${moment.kind} (${moment.title}) -- no AI provider available.`)
      return
    }
    this.state.pendingStoryMomentNarrations++
    const gotSlot = await this.waitForLLMSlot()
    this.state.pendingStoryMomentNarrations--
    // A story moment must eventually narrate rather than silently drop: an
    // ordinary request can legitimately run for many minutes against a slow
    // local model (see the 1800000ms provider timeout in SimulationManager),
    // so no bounded wait can be trusted to outlast whatever's already in
    // flight. Rather than give up, fire the narration anyway once the wait
    // is exhausted -- it briefly runs alongside whatever's blocking instead
    // of behind it. gotSlot tracks whether we actually own the mutex, so we
    // only flip llmRequestInFlight when we're the one who set it.
    if (!gotSlot) {
      this.logStoryMomentEvent(moment, agentId, 'delayed', `Story moment narration proceeding without a free LLM slot: ${moment.kind} (${moment.title}) -- an unusually long request is still in flight.`)
    }
    if (gotSlot) this.deps.setLLMRequestInFlight(true)
    try {
      const prompt = this.deps.promptBuilder.buildKeyMomentNarrationPrompt(moment.kind, facts)
      moment.narrative = await this.deps.runLLMRequestWithRetry(
        agentId,
        'story moment narration',
        () => this.deps.aiProvider!.narrateKeyMoment(prompt),
        4
      )
      moment.status = 'ready'
      const preview = moment.narrative.length > 120 ? `${moment.narrative.slice(0, 120)}...` : moment.narrative
      this.logStoryMomentEvent(moment, agentId, 'ready', `Story moment narrated: ${moment.kind} (${moment.title}) -- "${preview}"`)
    } catch (error) {
      if (!this.deps.isAgentRefreshCancellation(error)) {
        console.warn('[AgentManager] Story moment narration failed.', error)
      }
      moment.status = 'failed'
      const reason = error instanceof Error ? error.message : String(error)
      this.logStoryMomentEvent(moment, agentId, 'failed', `Story moment narration failed: ${moment.kind} (${moment.title}) -- ${reason}`)
    } finally {
      if (gotSlot) this.deps.setLLMRequestInFlight(false)
    }
  }
}
