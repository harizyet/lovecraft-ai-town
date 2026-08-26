import { Agent } from '@/agent/Agent'
import {
  ActionType,
  AgentAction,
  EmotionalState,
  Rumour,
  ScheduleBlock,
  SimulationEvent,
  WeatherCondition,
} from '@/types'
import { PropheticInterpretation, PropheticTask } from '@/ai/AIProvider'
import { SystemDeps } from './SystemDeps'

export interface ReligionState {
  religiousFervourCompletedKeys: Set<string>
  religiousFervourIdeas: Map<string, {
    agentId: string
    rumourId: string
    believedAtMinute: number
    lastRollMinute: number
  }>
  religiousFervourTargets: Map<string, string>
  prophetAgentId: string | null
  prophetVacantAfterDeath: boolean
  godInterventionCredits: number
  lastGodInvocation?: string
  lastInvokedDeityName?: string
  demonSummonCredits: number
  demonSummonSites: Array<{ x: number; y: number }>
  activeDeityConversations: Map<string, { deityName: string; turns: { speaker: string; dialogue: string }[] }>
  // Owned here rather than on RumourState (per the extraction brief's initial
  // field grouping) because every actual read/write of these two fields
  // happens inside Religion's daily prophetic-claim and interpretation flow;
  // Rumour code never touches them.
  interpretedProphecyRumourIds: Set<string>
  lastDailyPropheticClaimDay: number
}

export function createReligionState(): ReligionState {
  return {
    religiousFervourCompletedKeys: new Set(),
    religiousFervourIdeas: new Map(),
    religiousFervourTargets: new Map(),
    prophetAgentId: null,
    prophetVacantAfterDeath: false,
    godInterventionCredits: 0,
    lastGodInvocation: undefined,
    lastInvokedDeityName: undefined,
    demonSummonCredits: 0,
    demonSummonSites: [],
    activeDeityConversations: new Map(),
    interpretedProphecyRumourIds: new Set(),
    lastDailyPropheticClaimDay: 0,
  }
}

// Religion/Prophecy/Deity: god abilities and interventions, demons, the
// Prophet vocation and its daily prophetic claims/interpretations, deity
// conversations, and religious fervour/conversion.
export class ReligionSystem {
  constructor(private deps: SystemDeps, public readonly state: ReligionState) {}


  public registerGodInvocation(event: SimulationEvent): void {
    if (event.worldStateDelta.cultSacrifice === true) {
      const sacrificer = this.deps.getAgents().find((agent) => agent.state.id === event.agentId)
      if (sacrificer?.state.cult?.id.startsWith('cult_christian_') && sacrificer.state.cult.name === 'The Church of Christ') return
      this.state.godInterventionCredits = Math.min(10, this.state.godInterventionCredits + 2)
      this.state.lastGodInvocation = `Cult sacrifice: ${event.description}`
      if (sacrificer) this.state.lastInvokedDeityName = this.chooseDeityName(sacrificer)
      return
    }
    const religiousActions = new Set<ActionType>([
      ActionType.PRAY, ActionType.CONJURE, ActionType.SUMMON, ActionType.RESURRECT,
      ActionType.HEAL, ActionType.BLESS, ActionType.CURSE, ActionType.RITUAL, ActionType.PREACH,
    ])
    if (!religiousActions.has(event.actionType) || event.type !== 'cult_ability') return
    const worshipper = this.deps.getAgents().find((agent) => agent.state.id === event.agentId)
    if (!worshipper?.state.alive) return
    if (worshipper.state.cult?.id.startsWith('cult_christian_') && worshipper.state.cult.name === 'The Church of Christ') return
    const actsThroughCult = Boolean(worshipper.state.cult)
    // Any deity the worshipper holds with meaningful confidence can grant an
    // invocation, not only "God" specifically — abilities answer whichever
    // deity a believer actually worships.
    const believesInDeity = worshipper.state.beliefSystem.religiousStance === 'believer' &&
      worshipper.state.beliefSystem.deities.some((deity) => deity.confidence >= 50)
    if (!actsThroughCult && !believesInDeity) return
    this.state.godInterventionCredits = Math.min(10, this.state.godInterventionCredits + 1)
    this.state.lastGodInvocation = `${worshipper.state.name}: ${event.description}`
    this.state.lastInvokedDeityName = this.chooseDeityName(worshipper)
  }

  public getGodInterventionState(): {
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
  } {
    const activeSummon = [...this.deps.activeBlocks.entries()].find(([, block]) =>
      block.action.action === 'summon' && block.summonSite
    )
    let summonProgress: {
      cultName: string
      leaderName: string
      locationName: string
      gathered: number
      required: number
      percent: number
      phase: 'recruiting' | 'travelling'
      invited: number
      recruitingMemberName?: string
    } | undefined
    if (activeSummon) {
      const [leaderId, block] = activeSummon
      const leader = this.deps.getAgents().find((agent) => agent.state.id === leaderId)
      const participantIds = [leaderId, ...(block.summonedMemberIds ?? [])]
      const participants = participantIds
        .map((id) => this.deps.getAgents().find((agent) => agent.state.id === id))
        .filter((participant): participant is Agent => Boolean(participant?.state.alive))
      const travelProgress = participantIds.map((id) => {
        const participant = participants.find((candidate) => candidate.state.id === id)
        if (!participant || !block.summonSite) return 0
        const remaining = Math.hypot(
          participant.state.position.x - block.summonSite.x,
          participant.state.position.y - block.summonSite.y
        )
        if (remaining <= 2) return 1
        const initial = Math.max(remaining, block.summonInitialDistances?.[id] ?? remaining)
        return Math.max(0, Math.min(0.99, 1 - remaining / initial))
      })
      const gathered = participants.filter((participant) => block.summonSite && Math.hypot(
        participant.state.position.x - block.summonSite.x,
        participant.state.position.y - block.summonSite.y
      ) <= 2).length
      summonProgress = {
        cultName: leader?.state.cult?.name ?? 'Unknown cult',
        leaderName: leader?.state.name ?? 'Unknown leader',
        locationName: block.action.target ?? 'chosen site',
        gathered,
        required: 3,
        percent: block.summonPhase === 'travelling'
          ? 50 + Math.round(travelProgress.reduce((total, progress) => total + progress, 0) / 3 * 50)
          : Math.round(Math.min(2, block.summonInvitedMemberIds?.length ?? 0) / 2 * 50),
        phase: block.summonPhase ?? 'recruiting',
        invited: block.summonInvitedMemberIds?.length ?? 0,
        recruitingMemberName: (block.summonedMemberIds ?? [])
          .filter((id) => !(block.summonInvitedMemberIds ?? []).includes(id))
          .map((id) => this.deps.getAgents().find((agent) => agent.state.id === id)?.state.name)
          .find(Boolean),
      }
    }
    return {
      credits: this.state.godInterventionCredits,
      lastInvocation: this.state.lastGodInvocation,
      demonSummonCredits: this.state.demonSummonCredits,
      demons: this.deps.getAgents().filter((agent) => agent.state.demon).map((agent) => ({
        id: agent.state.id,
        name: agent.state.name,
        alive: agent.state.alive,
        lastCommand: agent.state.demon?.lastCommand,
      })),
      summonProgress,
    }
  }

  public createDemon(command: string): { success: boolean; message: string; demonId?: string } {
    const prompt = command.trim()
    if (!prompt) return { success: false, message: 'Enter a command before creating the Demon.' }
    if (this.deps.getAgents().some((agent) => agent.state.demon)) {
      return { success: false, message: 'The unique Demon has already been created.' }
    }
    if (this.state.demonSummonCredits <= 0) {
      return { success: false, message: 'A cult of at least three living members must complete a summon ritual first.' }
    }
    const baseName = 'Azrath the Bound'
    let name = baseName
    let suffix = 2
    while (this.deps.getAgents().some((agent) => agent.state.name === name)) name = `${baseName} ${suffix++}`
    const demon = new Agent(
      `demon_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      name,
      this.deps.world,
      this.deps.simManager,
      'Demon'
    )
    demon.state.demon = { createdAtMinute: this.deps.getAbsoluteMinute() }
    demon.state.maxHealth = 666
    demon.state.health = 666
    demon.state.position = this.state.demonSummonSites.shift() ?? this.deps.findTownEntrance()
    demon.state.beliefSystem.religiousStance = 'atheist'
    demon.state.beliefSystem.faith = 0
    demon.state.beliefSystem.deities = []
    this.deps.getAgents().push(demon)
    this.deps.simManager.addAgent(demon.state)
    this.deps.llmRequestStatuses.set(demon.state.id, 'idle')
    this.state.demonSummonCredits--

    const witnesses = this.deps.getAgents().filter((witness) =>
      witness.state.alive &&
      witness.state.id !== demon.state.id &&
      demon.distanceTo(witness.state) <= 8
    )

    const event = this.deps.eventBus.emit({
      type: 'demon_created',
      agentId: demon.state.id,
      actionType: ActionType.SUMMON,
      outcome: 'created',
      description: `${demon.state.name} manifested at the cult's summoning site under a command supplied by the user.`,
      causationIds: [],
      worldStateDelta: {
        demonId: demon.state.id,
        remainingDemonSummonCredits: this.state.demonSummonCredits,
        witnessIds: witnesses.map((witness) => witness.state.id),
      },
      observers: witnesses.map((witness) => witness.state.id),
    })
    this.deps.story.queueStoryMoment(
      'demon_created',
      demon.state.name,
      `${demon.state.name}, a monstrous entity bound to obedience, was ritually summoned into the village at the cult's summoning site, witnessed by ${witnesses.length} villager(s).`,
      demon.state.id,
      event.id
    )
    for (const witness of witnesses) witness.addRecentMemory(event)
    for (const witness of witnesses.filter((candidate) => !candidate.state.cult)) {
      const alreadyInsane = !!witness.state.permanentInsanity
      if (!alreadyInsane) {
        this.deps.applyExistentialWitnessReaction(
          witness,
          `${demon.state.name}, a monstrous entity, manifested before them at a summoning ritual.`,
          75,
          'demon_manifestation'
        )
      }
      const becameInsane = !alreadyInsane && witness.state.permanentInsanity?.source === 'demon_manifestation'
      const witnessEvent = this.deps.eventBus.emit({
        type: 'demon_witnessed',
        agentId: witness.state.id,
        targetId: demon.state.id,
        actionType: ActionType.SUMMON,
        outcome: becameInsane ? 'permanent_insanity' : alreadyInsane ? 'already_insane' : witness.state.existentialState?.reaction ?? 'resisted',
        description: becameInsane
          ? `${witness.state.name}, a non-cultist who witnessed ${demon.state.name} manifest, entered permanent insanity.`
          : alreadyInsane
            ? `${witness.state.name} witnessed ${demon.state.name} manifest while already permanently insane.`
            : `${witness.state.name}, a non-cultist who witnessed ${demon.state.name} manifest, reacted with ${witness.state.existentialState?.reaction ?? 'resistance'}.`,
        causationIds: [event.id],
        worldStateDelta: {
          demonId: demon.state.id,
          witnessId: witness.state.id,
          reaction: witness.state.existentialState?.reaction,
          permanentInsanity: becameInsane,
        },
        observers: [witness.state.id],
      })
      witness.addRecentMemory(witnessEvent)
    }
    const result = this.commandDemon(demon.state.id, prompt)
    return { success: result.success, message: `${demon.state.name} was created. ${result.message}`, demonId: demon.state.id }
  }

  public commandDemon(demonId: string | undefined, command: string): { success: boolean; message: string } {
    const demon = this.deps.getAgents().find((agent) =>
      agent.state.alive && agent.state.demon && (!demonId || agent.state.id === demonId)
    )
    const prompt = command.trim()
    if (!demon) return { success: false, message: 'The Demon is not alive.' }
    if (!prompt) return { success: false, message: 'Enter a command for the Demon.' }

    const target = this.deps.getAgents()
      .filter((agent) => agent.state.alive && agent.state.id !== demon.state.id)
      .sort((first, second) => second.state.name.length - first.state.name.length)
      .find((agent) => {
        const fullName = agent.state.name.toLowerCase()
        const firstName = fullName.split(' ')[0]
        const lowered = prompt.toLowerCase()
        return lowered.includes(fullName) || new RegExp(`\\b${firstName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`).test(lowered)
      })
    let action: AgentAction
    const attackCommand = /\b(?:attack|kill|slay|destroy|hurt|hunt)\b/i.test(prompt) && target
    if (attackCommand && target) {
      action = demon.distanceTo(target.state) <= 4
        ? { action: 'attack', target: target.state.name, reasoning: `[user command] ${prompt}`, dialogue: '', emotionalState: 'angry', durationMinutes: 10 }
        : { action: 'move', target: target.state.name, reasoning: `[user command] Pursuing ${target.state.name}: ${prompt}`, dialogue: '', emotionalState: 'angry', durationMinutes: 240 }
    } else if (target) {
      action = { action: 'move', target: target.state.name, reasoning: `[user command] ${prompt}`, dialogue: '', emotionalState: 'determined', durationMinutes: 240 }
    } else {
      const destination = this.deps.resolveTarget(prompt)
      if (!destination) return { success: false, message: 'Name a living agent or known location in the command.' }
      action = { action: 'move', target: prompt, reasoning: `[user command] ${prompt}`, dialogue: '', emotionalState: 'determined', durationMinutes: 240 }
    }
    demon.state.demon!.lastCommand = prompt
    demon.state.demon!.commandedAtMinute = this.deps.getAbsoluteMinute()
    this.deps.activeBlocks.delete(demon.state.id)
    this.deps.dailySchedules.delete(demon.state.id)
    this.deps.decisionQueue.delete(demon.state.id)
    this.deps.startBlock(demon, action)
    const active = this.deps.activeBlocks.get(demon.state.id)
    if (active && attackCommand && target && action.action === 'move') {
      active.demonAttackTargetId = target.state.id
    }
    return { success: true, message: `${demon.state.name} accepted the command: “${prompt}”` }
  }

  public performGodAbility(
    ability: 'bless' | 'heal' | 'smite' | 'resurrect' | 'manifest' | 'weather',
    targetAgentId?: string,
    weatherCondition?: WeatherCondition,
    deityNameOverride?: string
  ): { success: boolean; message: string } {
    if (this.state.godInterventionCredits <= 0) {
      return { success: false, message: 'No worship or cult rite has invoked a deity.' }
    }
    const target = ability !== 'weather' && targetAgentId
      ? this.deps.getAgents().find((agent) => agent.state.id === targetAgentId)
      : undefined
    if (!['manifest', 'weather'].includes(ability) && !target) return { success: false, message: 'Select a valid villager.' }
    if (ability === 'weather' && !weatherCondition) return { success: false, message: 'Select a weather condition.' }
    if (ability === 'resurrect' && target?.state.alive) return { success: false, message: 'Resurrection requires a dead villager.' }
    if (ability === 'manifest' && target && !target.state.alive) {
      return { success: false, message: 'A targeted manifestation requires a living villager.' }
    }
    if (!['resurrect', 'manifest', 'weather'].includes(ability) && !target?.state.alive) {
      return { success: false, message: 'That ability requires a living villager.' }
    }

    // An explicit choice from the confirmation panel always wins. Otherwise
    // any ability targeting someone appears as whichever deity that person
    // actually worships (e.g. Cthulhu for one of Cthulhu's own cultists),
    // rather than the deity that most recently earned the invocation credit
    // being spent, which may belong to an unrelated worshipper elsewhere in
    // the village. Untargeted abilities (weather) fall back to that last
    // invoker.
    const deityName = deityNameOverride?.trim() || (
      target
        ? this.chooseDeityName(target)
        : this.state.lastInvokedDeityName ?? 'God'
    )

    let description: string
    if (ability === 'bless' && target) {
      target.state.reputation = Math.min(100, target.state.reputation + 10)
      target.state.beliefSystem.faith = Math.min(100, target.state.beliefSystem.faith + 10)
      target.state.emotionalState = EmotionalState.DETERMINED
      this.deps.applyTimedBlessing(target, 'world')
      target.state.lastReasoning = `${deityName} blessed me. I feel favored and resolved.`
      description = `${deityName} answered the invocation by blessing ${target.state.name}.`
    } else if (ability === 'heal' && target) {
      target.state.health = target.state.maxHealth
      target.state.lastReasoning = `${deityName} healed my wounds completely. I am in awe.`
      description = `${deityName} answered the invocation by fully healing ${target.state.name}.`
    } else if (ability === 'smite' && target) {
      const previousHealth = target.state.health
      const died = target.takeDamage(50, deityName)
      const damage = previousHealth - target.state.health
      if (damage === 0 && target.state.demon) {
        target.state.lastReasoning = `${deityName} tried to smite me, but I felt nothing. Their power could not touch me.`
      } else if (died) {
        target.state.lastReasoning = `${deityName} struck me down. My last thought was disbelief.`
      } else {
        target.state.lastReasoning = `${deityName} smote me for ${damage} damage. The pain was undeniable proof of their wrath.`
      }
      description = damage === 0 && target.state.demon
        ? `${deityName} attempted to smite ${target.state.name}, but the Demon was invulnerable because ${deityName} is not a Knight or Inquisitor outsider.`
        : `${deityName} answered the invocation by smiting ${target.state.name} for ${damage} damage${died ? ', killing them' : ''}.`
    } else if (ability === 'resurrect' && target) {
      target.state.alive = true
      target.state.health = Math.max(50, Math.round(target.state.maxHealth / 2))
      target.state.emotionalState = EmotionalState.AFRAID
      target.state.path = []
      target.state.pathIndex = 0
      target.state.lastReasoning = `${deityName} brought me back from death. I do not understand how, but I am alive again.`
      this.deps.dailySchedules.delete(target.state.id)
      this.deps.scheduleCursors.delete(target.state.id)
      description = `${deityName} answered the invocation by resurrecting ${target.state.name}.`
      const insaneCount = this.applyResurrectionInsanity(target, deityName, true)
      if (insaneCount > 0) {
        description += ` The sight of the dead returning to life broke the minds of ${insaneCount} who witnessed it.`
      }
    } else if (ability === 'weather' && weatherCondition) {
      const previous = this.deps.simManager.setWeatherByDivineIntervention(weatherCondition)
      description = `${deityName} answered the invocation by changing the weather from ${previous} to ${weatherCondition}.`
    } else if (ability === 'manifest' && target) {
      const wasAlreadyInsane = !!target.state.permanentInsanity
      if (!wasAlreadyInsane) {
        this.deps.applyExistentialWitnessReaction(
          target,
          `${deityName} manifested directly before them, undeniable and unmistakable.`,
          90,
          'divine_manifestation'
        )
        // A believer who reinterprets rather than breaking still deepens
        // their conviction in the deity that just manifested to them; other
        // reactions (denial, obsession, nihilism, madness) are left as the
        // reaction system decided rather than force-converting everyone who
        // stays sane.
        if (target.state.existentialState?.reaction === 'reinterpretation' || target.state.existentialState?.reaction === 'revelation') {
          target.state.beliefSystem.religiousStance = 'believer'
          target.state.beliefSystem.faith = Math.max(90, target.state.beliefSystem.faith)
          let deity = target.state.beliefSystem.deities.find(
            (d) => d.name.toLowerCase() === deityName.toLowerCase()
          )
          if (!deity) {
            deity = { name: deityName, confidence: 90, revelationCount: 1 }
            target.state.beliefSystem.deities.push(deity)
          } else {
            deity.confidence = Math.max(90, deity.confidence)
            deity.revelationCount++
          }
        }
      }

      const becameInsane = !wasAlreadyInsane && !!target.state.permanentInsanity
      description = becameInsane
        ? `${deityName} manifested directly before ${target.state.name}; unable to reconcile the event, they entered permanent insanity.`
        : wasAlreadyInsane
          ? `${deityName} manifested directly before ${target.state.name}, reinforcing their existing permanent insanity.`
          : `${deityName} manifested directly before ${target.state.name}; they retained their sanity and reacted with ${target.state.existentialState?.reaction ?? 'belief'}.`
    } else {
      description = `${deityName} answered the invocation with a visible manifestation over the village.`
    }

    this.state.godInterventionCredits--
    const event = this.deps.eventBus.emit({
      type: 'god_intervention',
      agentId: 'world',
      targetId: target?.state.id,
      actionType: ActionType.IDLE,
      outcome: ability,
      description,
      causationIds: [],
      worldStateDelta: {
        ability,
        deityName,
        targetAgentId: target?.state.id,
        weatherCondition,
        permanentInsanity: target?.state.permanentInsanity?.source === 'divine_manifestation',
        remainingCredits: this.state.godInterventionCredits,
      },
      observers: this.deps.getAgents().filter((agent) => agent.state.alive).map((agent) => agent.state.id),
    })
    for (const agent of this.deps.getAgents().filter((candidate) => candidate.state.alive)) agent.addRecentMemory(event)
    if (ability === 'weather') {
      // An obsessed villager watching for "tells" that their world isn't
      // what it seems can read a deity-commanded weather shift as one more
      // piece of evidence, even though it isn't targeted at anyone.
      for (const agent of this.deps.getAgents().filter((candidate) => candidate.state.alive && candidate.state.obsession)) {
        this.deps.applyExistentialWitnessReaction(
          agent,
          `The weather itself changed to ${weatherCondition} the instant ${deityName} answered an invocation for it.`,
          55,
          'divine_manifestation'
        )
      }
    }
    if (ability === 'manifest' && target && !target.state.permanentInsanity) {
      this.deps.maybeTriggerWillingCultJoin(target, deityName, event.id)
    }
    this.deps.story.queueFirstDeityAbilityMoment(ability, description, target?.state.id ?? 'world', event.id)
    this.deps.fulfillRequestsFromGodAbility(ability, target, weatherCondition, event.id)
    return { success: true, message: `${description} ${this.state.godInterventionCredits} invocation${this.state.godInterventionCredits === 1 ? '' : 's'} remain.` }
  }

  // A quieter, more Lovecraftian divine ability than performGodAbility's
  // overt bless/smite/manifest: reaches into a sleeping, cult-unaligned
  // villager's mind and plants a bias as a dream. Agents with weaker sanity
  // are more likely to have it curdle into a nightmare, which frays their
  // sanity further and leaves them visibly shaken; sturdier minds are more
  // likely to just carry the bias as an odd, lingering impression. Either
  // way it surfaces the next day in the villager's own reasoning and
  // conversation (see PromptBuilder), then fades once they next fall asleep.
  public plantDream(
    targetAgentId: string,
    biasText: string,
    deityNameOverride?: string
  ): { success: boolean; message: string } {
    if (this.state.godInterventionCredits <= 0) {
      return { success: false, message: 'No worship or cult rite has invoked a deity.' }
    }
    const trimmedBias = biasText.trim()
    if (!trimmedBias) return { success: false, message: 'The dream needs some content to plant.' }
    const target = this.deps.getAgents().find((agent) => agent.state.id === targetAgentId)
    if (!target || !target.state.alive) return { success: false, message: 'Select a living villager.' }
    const active = this.deps.activeBlocks.get(target.state.id)
    if (active?.action.action !== 'sleep' || active.sleepStartedAt === undefined) {
      return { success: false, message: `${target.state.name} must be asleep to receive a planted dream.` }
    }
    if (target.state.cult) {
      return { success: false, message: `${target.state.name} already serves ${target.state.cult.name}; their dreams are shielded from outside influence.` }
    }

    const deityName = deityNameOverride?.trim() || this.state.lastInvokedDeityName || this.chooseDeityName(target)
    const previousSanity = target.state.sanity
    const nightmareChance = Math.max(10, 100 - previousSanity)
    const isNightmare = Math.random() * 100 < nightmareChance
    if (isNightmare) {
      target.state.sanity = Math.max(0, previousSanity - (5 + Math.round(Math.random() * 10)))
      target.state.emotionalState = EmotionalState.AFRAID
      target.state.lastReasoning = `I dreamed something terrible: "${trimmedBias}" I woke shaking, and I cannot shake the feeling it was true.`
    } else {
      target.state.lastReasoning = `I dreamed something strange: "${trimmedBias}" It lingers in my mind like it means something.`
    }
    target.state.dream = {
      plantedBy: 'player',
      deityName,
      biasText: trimmedBias,
      isNightmare,
      plantedAtMinute: this.deps.getAbsoluteMinute(),
    }

    this.state.godInterventionCredits--
    const description = isNightmare
      ? `${deityName} reached into ${target.state.name}'s sleeping mind and curdled a planted dream into a nightmare: "${trimmedBias}" Their sanity fell from ${previousSanity.toFixed(0)} to ${target.state.sanity.toFixed(0)}.`
      : `${deityName} reached into ${target.state.name}'s sleeping mind and planted a dream: "${trimmedBias}"`
    const event = this.deps.eventBus.emit({
      type: 'dream_planted',
      agentId: 'world',
      targetId: target.state.id,
      actionType: ActionType.IDLE,
      outcome: isNightmare ? 'nightmare' : 'dream',
      description,
      causationIds: [],
      worldStateDelta: {
        deityName,
        targetAgentId: target.state.id,
        isNightmare,
        biasText: trimmedBias,
        remainingCredits: this.state.godInterventionCredits,
      },
      observers: [target.state.id],
    })
    target.addRecentMemory(event)
    return { success: true, message: `${description} ${this.state.godInterventionCredits} invocation${this.state.godInterventionCredits === 1 ? '' : 's'} remain.` }
  }

  public applyResurrectionInsanity(
    target: Agent,
    sourceName: string,
    includeExecuteVoterInsanity: boolean
  ): number {
    const lastDeath = target.state.lastDeath
    if (!lastDeath) return 0
    let insaneCount = 0

    const rollInsanity = (witness: Agent, reason: string, causationId: string): void => {
      if (!witness.state.alive || witness.state.id === target.state.id) return
      if (witness.state.permanentInsanity) return
      this.deps.applyExistentialWitnessReaction(witness, reason, 70, 'divine_manifestation')
      if (!witness.state.permanentInsanity) return
      insaneCount++
      const witnessEvent = this.deps.eventBus.emit({
        type: 'resurrection_witnessed',
        agentId: witness.state.id,
        targetId: target.state.id,
        actionType: ActionType.IDLE,
        outcome: 'permanent_insanity',
        description: `${witness.state.name} could not bear ${target.state.name}'s return from the dead and entered permanent insanity.`,
        causationIds: [causationId],
        worldStateDelta: { targetAgentId: target.state.id, permanentInsanity: true },
        observers: [witness.state.id],
      })
      witness.addRecentMemory(witnessEvent)
    }

    for (const witnessId of lastDeath.witnessIds) {
      const witness = this.deps.getAgents().find((candidate) => candidate.state.id === witnessId)
      if (!witness || witness.state.cult) continue
      rollInsanity(
        witness,
        `I witnessed ${target.state.name} die, and now ${sourceName} has brought them back. My mind cannot hold both.`,
        target.state.id
      )
    }

    if (includeExecuteVoterInsanity && lastDeath.executeVoterIds) {
      for (const voterId of lastDeath.executeVoterIds) {
        const voter = this.deps.getAgents().find((candidate) => candidate.state.id === voterId)
        if (!voter) continue
        rollInsanity(
          voter,
          `I voted to execute ${target.state.name}, and ${sourceName} has undone that sentence. The guilt of it has shattered me.`,
          target.state.id
        )
      }
    }

    target.state.lastDeath = undefined
    return insaneCount
  }

  public beginDeityConversation(
    targetAgentId: string,
    deityNameOverride?: string
  ): { success: boolean; message: string; deityName?: string; agentName?: string } {
    if (this.state.godInterventionCredits <= 0) {
      return { success: false, message: 'No worship or cult rite has invoked a deity.' }
    }
    const target = this.deps.getAgents().find((agent) => agent.state.id === targetAgentId)
    if (!target || !target.state.alive) return { success: false, message: 'Select a living villager.' }
    if (this.state.activeDeityConversations.has(targetAgentId)) {
      return { success: false, message: 'A conversation with this villager is already open.' }
    }
    const deityName = deityNameOverride?.trim() || this.chooseDeityName(target)
    this.state.godInterventionCredits--
    this.state.activeDeityConversations.set(targetAgentId, { deityName, turns: [] })
    return { success: true, message: `${deityName} opens a direct line to ${target.state.name}.`, deityName, agentName: target.state.name }
  }

  public async sendDeityMessage(
    targetAgentId: string,
    message: string
  ): Promise<{ success: boolean; message: string; agentReply?: string }> {
    const conversation = this.state.activeDeityConversations.get(targetAgentId)
    const target = this.deps.getAgents().find((agent) => agent.state.id === targetAgentId)
    if (!conversation || !target) return { success: false, message: 'No open deity conversation with this villager.' }
    const spoken = message.trim()
    if (!spoken) return { success: false, message: 'Say something to the villager.' }

    conversation.turns.push({ speaker: conversation.deityName, dialogue: spoken })

    const transcript = conversation.turns
      .map((turn) => `${turn.speaker}: ${turn.dialogue}`)
      .join('\n')
    const prompt = `Your religious stance: ${target.state.beliefSystem.religiousStance}. Sanity: ${target.state.sanity}/100.${target.state.beliefSystem.deities.length > 0 ? ` Deity beliefs: ${target.state.beliefSystem.deities.map((deity) => `${deity.name} (${deity.confidence.toFixed(0)}%)`).join(', ')}.` : ' You have no named deity belief yet.'}\nYou hear a voice claiming to be ${conversation.deityName} speaking directly to you.\nConversation so far:\n${transcript}\nRespond to what ${conversation.deityName} just said.`

    let agentReply: string
    if (!this.deps.aiProvider?.isAvailable()) {
      agentReply = target.state.beliefSystem.religiousStance === 'believer'
        ? `I... I hear you. Forgive me, I don't know how to answer a god.`
        : `I don't... I don't understand. Is this truly happening?`
    } else {
      try {
        agentReply = await this.deps.runLLMRequestWithRetry(
          target.state.id,
          `${target.state.name} deity conversation reply`,
          () => this.deps.aiProvider!.respondToDeity(target.state.name, prompt),
          3
        )
        if (!agentReply) throw new Error('empty reply')
      } catch (error) {
        console.warn('[AgentManager] Deity conversation reply failed; using fallback.', error)
        agentReply = target.state.beliefSystem.religiousStance === 'believer'
          ? `I... I hear you. Forgive me, I don't know how to answer a god.`
          : `I don't... I don't understand. Is this truly happening?`
      }
    }
    conversation.turns.push({ speaker: target.state.name, dialogue: agentReply })
    return { success: true, message: 'The villager responds.', agentReply }
  }

  public endDeityConversation(
    targetAgentId: string
  ): { success: boolean; message: string; becameInsane?: boolean; believerStrengthened?: boolean } {
    const conversation = this.state.activeDeityConversations.get(targetAgentId)
    const target = this.deps.getAgents().find((agent) => agent.state.id === targetAgentId)
    this.state.activeDeityConversations.delete(targetAgentId)
    if (!conversation || !target) return { success: false, message: 'No open deity conversation with this villager.' }

    const deityName = conversation.deityName
    const wasAlreadyInsane = Boolean(target.state.permanentInsanity)
    let becameInsane = false
    let believerStrengthened = false
    let description: string

    if (target.state.beliefSystem.religiousStance === 'believer') {
      believerStrengthened = true
      target.state.beliefSystem.faith = Math.min(100, target.state.beliefSystem.faith + 15)
      let deity = target.state.beliefSystem.deities.find(
        (candidate) => candidate.name.toLowerCase() === deityName.toLowerCase()
      )
      if (!deity) {
        deity = { name: deityName, confidence: 90, revelationCount: 1 }
        target.state.beliefSystem.deities.push(deity)
      } else {
        deity.confidence = Math.min(100, deity.confidence + 10)
        deity.revelationCount++
      }
      target.state.emotionalState = EmotionalState.DETERMINED
      target.state.lastReasoning = `${deityName} spoke to me directly. My faith is unshakable.`
      description = `${deityName} conversed directly with ${target.state.name}, a devout believer; their faith has deepened further.`
    } else if (!wasAlreadyInsane) {
      becameInsane = true
      target.state.permanentInsanity = {
        causedAtMinute: this.deps.getAbsoluteMinute(),
        source: 'divine_manifestation',
        reason: `Conversed directly with ${deityName} while a non-believer`,
      }
      target.state.emotionalState = EmotionalState.PANICKED
      target.state.lastReasoning = `${deityName} spoke to me though I never believed. My mind could not bear it.`
      this.deps.dailySchedules.delete(target.state.id)
      this.deps.scheduleCursors.delete(target.state.id)
      this.deps.activeBlocks.delete(target.state.id)
      description = `${deityName} conversed directly with ${target.state.name}, a non-believer; unable to reconcile the encounter, they entered permanent insanity.`
    } else {
      description = `${deityName} conversed directly with ${target.state.name}, who was already permanently insane; the encounter reinforced their broken state.`
    }

    this.state.godInterventionCredits = Math.max(0, this.state.godInterventionCredits)
    const event = this.deps.eventBus.emit({
      type: 'god_intervention',
      agentId: 'world',
      targetId: target.state.id,
      actionType: ActionType.IDLE,
      outcome: 'converse',
      description,
      causationIds: [],
      worldStateDelta: {
        ability: 'converse',
        deityName,
        targetAgentId: target.state.id,
        transcript: conversation.turns,
        permanentInsanity: becameInsane,
        believerStrengthened,
      },
      observers: [target.state.id],
    })
    target.addRecentMemory(event)
    if (believerStrengthened) this.deps.maybeTriggerWillingCultJoin(target, deityName, event.id)
    const transcriptText = conversation.turns.map((turn) => `${turn.speaker}: "${turn.dialogue}"`).join('\n')
    this.deps.story.queueFirstDeityAbilityMoment(
      'converse',
      `${description}\n\nTranscript of the conversation:\n${transcriptText}`,
      target.state.id,
      event.id
    )
    return {
      success: true,
      message: becameInsane
        ? `${target.state.name} could not bear the direct encounter and lost their sanity.`
        : believerStrengthened
          ? `${target.state.name}'s faith has grown stronger.`
          : `${target.state.name} remains permanently insane after the encounter.`,
      becameInsane,
      believerStrengthened,
    }
  }

  public seedInitialChristianCult(): void {
    const priest = this.deps.getAgents().find((agent) => agent.state.alive && agent.state.currentJob === 'Priest')
    if (!priest || priest.state.cult) return

    const cult = {
      id: `cult_christian_${priest.state.id}`,
      name: 'The Church of Christ',
      role: 'founder' as const,
      joinedAtMinute: 0,
      joinMethod: 'founded' as const,
    }
    const seedBeliever = (agent: Agent): void => {
      agent.state.beliefSystem.religiousStance = 'believer'
      agent.state.beliefSystem.faith = Math.max(60, agent.state.beliefSystem.faith)
      let deity = agent.state.beliefSystem.deities.find((candidate) => /^christ$/i.test(candidate.name))
      if (!deity) {
        deity = { name: 'Christ', confidence: 75, revelationCount: 1 }
        agent.state.beliefSystem.deities.push(deity)
      } else {
        deity.confidence = Math.max(75, deity.confidence)
      }
      // If this founding member happened to be picked as the village's
      // initial atheist (chosen purely by lowest starting faith, regardless
      // of job) before this seeding overwrote their worldview, their reveal
      // flag would otherwise stay stuck at false forever, permanently
      // hiding an overtly devout Church founder's beliefs in the debug GUI.
      agent.state.religiousStanceRevealed = true
    }

    priest.state.cult = cult
    seedBeliever(priest)
    priest.state.cultAgendas = this.deps.createCultLeaderAgendas(priest)

    const candidates = this.deps.getAgents().filter((agent) =>
      agent.state.alive &&
      agent.state.id !== priest.state.id &&
      !agent.state.cult &&
      !this.deps.isConversionImmune(agent)
    )
    for (let i = candidates.length - 1; i > 0; i--) {
      const swapIndex = Math.floor(Math.random() * (i + 1))
      ;[candidates[i], candidates[swapIndex]] = [candidates[swapIndex], candidates[i]]
    }
    const memberCount = Math.min(candidates.length, 2 + Math.round(Math.random()))
    const members = candidates.slice(0, memberCount)
    for (const member of members) {
      member.state.cult = {
        id: cult.id,
        name: cult.name,
        role: 'member',
        joinedAtMinute: 0,
        recruitedByAgentId: priest.state.id,
        joinMethod: 'founded',
      }
      member.state.antiCultGroup = undefined
      seedBeliever(member)
    }

    const event = this.deps.eventBus.emit({
      type: 'cult_formed',
      agentId: priest.state.id,
      actionType: ActionType.IDLE,
      outcome: 'founded',
      description: `${priest.state.name} leads ${cult.name}, already an established congregation of ${members.length + 1} at the village's founding.`,
      causationIds: [],
      worldStateDelta: {
        cultId: cult.id,
        cultName: cult.name,
        role: 'founder',
        memberIds: members.map((member) => member.state.id),
      },
      observers: [priest.state.id, ...members.map((member) => member.state.id)],
    })
    priest.addRecentMemory(event)
    for (const member of members) member.addRecentMemory(event)
  }

  public ensureDailyPropheticClaim(): void {
    if (!this.deps.aiProvider?.isAvailable() || this.deps.isLLMRequestInFlight() || this.deps.story.hasPendingNarrations()) return
    if (this.state.lastDailyPropheticClaimDay >= this.deps.getCurrentDay()) return
    const prophet = this.state.prophetAgentId
      ? this.deps.getAgents().find((agent) => agent.state.id === this.state.prophetAgentId && agent.state.alive)
      : undefined
    if (!prophet || prophet.state.currentJob !== 'Prophet') return

    const claimDay = this.deps.getCurrentDay()
    const deityName = this.chooseDeityName(prophet)
    const promise = (async () => {
      let claim: string
      try {
        claim = await this.deps.runLLMRequestWithRetry(
          prophet.state.id,
          `${prophet.state.name} daily prophetic claim`,
          () => this.deps.aiProvider!.generateDailyPropheticClaim(
            prophet.state.name,
            this.deps.promptBuilder.buildDailyPropheticClaimPrompt(prophet, this.deps.getAgents(), claimDay)
          ),
          4
        )
      } catch (error) {
        if (this.deps.isAgentRefreshCancellation(error)) return
        console.warn(`[AgentManager] ${prophet.state.name}'s daily prophecy failed after four attempts; using a fallback claim.`, error)
        claim = `${prophet.state.name} foresees that an overlooked sign near the village center will become important before this day is over.`
      }
      if (!prophet.state.alive || this.deps.getCurrentDay() !== claimDay) return
      claim = claim.replace(/\b(?:must be killed|must die|kill someone|sacrifice someone)\b/gi, 'must be protected')
      const event = this.deps.eventBus.emit({
        type: 'daily_prophecy',
        agentId: prophet.state.id,
        actionType: ActionType.PREACH,
        outcome: 'claimed',
        description: `${prophet.state.name} made the day's prophetic claim: "${claim}"`,
        causationIds: [],
        worldStateDelta: { day: claimDay, deityName },
        observers: [prophet.state.id],
      })
      const rumour = this.deps.createRumour(claim, 'invented', prophet.state.id, event.id, 0.55, undefined, {
        kind: 'divine',
        deityName,
        description: `${prophet.state.name} attributes the daily prophecy to ${deityName}`,
      })
      this.deps.registerAgentCreatedRumour(rumour, prophet, 'invented')
      prophet.addRecentMemory(event)
      this.state.lastDailyPropheticClaimDay = claimDay
    })()

    this.deps.setLLMRequestInFlight(true)
    this.deps.pendingActivityLabels.set(prophet.state.id, 'forming a daily prophecy')
    this.deps.pendingDecisions.set(prophet.state.id, promise)
    promise.finally(() => {
      this.deps.pendingDecisions.delete(prophet.state.id)
      this.deps.pendingActivityLabels.delete(prophet.state.id)
      this.deps.setLLMRequestInFlight(false)
    })
  }

  public ensureBelieverPrayerBlock(agent: Agent, blocks: ScheduleBlock[], minuteOfDay: number): ScheduleBlock[] {
    if (agent.state.beliefSystem.religiousStance !== 'believer' || blocks.some((block) => block.action === 'pray')) {
      return blocks
    }
    const candidateIndex = blocks.findIndex((block) =>
      block.startMinute >= minuteOfDay && block.durationMinutes >= 30 &&
      ['idle', 'rest', 'work', 'talk'].includes(block.action)
    )
    const prayerTarget = this.deps.findBuildingOfType(agent, 'church')?.name ?? null
    if (candidateIndex >= 0) {
      const candidate = blocks[candidateIndex]
      const prayerDuration = Math.min(20, candidate.durationMinutes)
      const prayer: ScheduleBlock = {
        id: `${candidate.id}_prayer`,
        startMinute: candidate.startMinute,
        durationMinutes: prayerDuration,
        action: 'pray',
        target: prayerTarget,
        reasoning: 'Setting aside time to pray as part of daily religious practice',
        dialogue: '',
        emotionalState: candidate.emotionalState,
      }
      const remainder = candidate.durationMinutes - prayerDuration
      return [
        ...blocks.slice(0, candidateIndex), prayer,
        ...(remainder >= 5 ? [{
          ...candidate,
          id: `${candidate.id}_after_prayer`,
          startMinute: candidate.startMinute + prayerDuration,
          durationMinutes: remainder,
        }] : []),
        ...blocks.slice(candidateIndex + 1),
      ]
    }
    const lastEnd = Math.max(minuteOfDay, ...blocks.map((block) => block.startMinute + block.durationMinutes))
    return lastEnd + 15 <= 1440 ? [...blocks, {
      id: `prayer_${agent.state.id}_${this.deps.getCurrentDay()}`,
      startMinute: lastEnd,
      durationMinutes: 15,
      action: 'pray',
      target: prayerTarget,
      reasoning: 'Praying before the day ends as part of daily religious practice',
      dialogue: '',
      emotionalState: 'neutral',
    }] : blocks
  }

  public prioritizePropheticTasks(): void {
    if (this.deps.isCourtActive()) return
    for (const prophet of this.deps.getAgents().filter((agent) =>
      agent.state.alive && (agent.state.currentJob === 'Prophet' || agent.state.secretProphet)
    )) {
      const queue = this.deps.decisionQueue.get(prophet.state.id) ?? []
      const hasDivineWork = queue.some((trigger) =>
        trigger.type === 'prophecy' || trigger.type === 'prophetic_task'
      )
      if (!hasDivineWork) continue
      const active = this.deps.activeBlocks.get(prophet.state.id)
      if (active?.propheticTask) continue

      const partnerId = prophet.getConversationPartnerId()
      const partner = partnerId
        ? this.deps.getAgents().find((agent) => agent.state.id === partnerId)
        : undefined
      if (partner) this.deps.conversationManager.closeConversation(prophet, partner)
      else prophet.closeActiveConversation()
      this.deps.activeBlocks.delete(prophet.state.id)
      prophet.state.path = []
      prophet.state.pathIndex = 0
      prophet.state.lastReasoning = 'Pausing ordinary activity to prioritize a divine command.'
    }
  }

  public enforceProphetVocation(): void {
    for (const prophet of this.deps.getAgents().filter((agent) =>
      agent.state.alive && agent.state.currentJob === 'Prophet'
    )) {
      const replacementAction = prophet.state.cult ? 'preach' : 'pray'
      const replacementReason = prophet.state.cult
        ? `Serving as leader of ${prophet.state.cult.name} instead of returning to secular work`
        : 'Devoting former working hours to prayer and divine responsibilities'
      const active = this.deps.activeBlocks.get(prophet.state.id)
      if (active?.action.action === 'work') {
        this.deps.activeBlocks.delete(prophet.state.id)
        this.deps.startBlock(prophet, {
          ...active.action,
          action: replacementAction,
          target: this.deps.findBuildingOfType(prophet, 'church')?.name ?? null,
          reasoning: replacementReason,
          dialogue: '',
        }, [active.eventId])
      }
      const schedule = this.deps.dailySchedules.get(prophet.state.id)
      if (schedule) {
        schedule.blocks = schedule.blocks.map((block) => block.action === 'work' ? {
          ...block,
          action: replacementAction,
          target: this.deps.findBuildingOfType(prophet, 'church')?.name ?? null,
          reasoning: replacementReason,
          dialogue: '',
        } : block)
      }
    }
  }

  public buildFallbackPropheticInterpretation(
    prophet: Agent,
    revelation: Rumour,
    deityName: string
  ): PropheticInterpretation {
    const command = revelation.text.trim()
    const otherVillagers = this.deps.getAgents()
      .filter((candidate) => candidate.state.alive && candidate.state.id !== prophet.state.id)
      .sort((first, second) => {
        const firstRelationship = prophet.state.relationships.find((entry) => entry.agentId === first.state.id)?.strength ?? 50
        const secondRelationship = prophet.state.relationships.find((entry) => entry.agentId === second.state.id)?.strength ?? 50
        return firstRelationship - secondRelationship
      })
    const target = otherVillagers[0]
    const demandsSacrifice = /\b(?:sacrifice|must die|must be killed|kill someone|choose someone to die)\b/i.test(command)
    const demandsSummon = /\b(?:summon|summoning ritual)\b/i.test(command)
    const requestsCult = /\b(?:cult|fellowship|sect|religious (?:group|order)|gather followers)\b/i.test(command)
    const tasks: PropheticTask[] = []
    if (requestsCult) {
      tasks.push({
        kind: 'form_cult',
        target: null,
        cultName: `The Fellowship of ${prophet.state.name.split(' ')[0]}`,
        reasoning: `Organize followers to respond to ${deityName}'s command`,
      })
    }
    if (demandsSacrifice && target) {
      tasks.push({
        kind: 'sacrifice',
        target: target.state.name,
        reasoning: `Select ${target.state.name} as the sacrifice demanded by the revelation`,
      })
    }
    if (demandsSummon && prophet.state.cult && ['leader', 'founder'].includes(prophet.state.cult.role)) {
      const location = this.deps.findEmptySummoningBuilding(undefined, undefined, prophet.state.cult.id)
      if (location) {
        tasks.push({
          kind: 'summon',
          target: location.name,
          reasoning: `Gather the cult at ${location.name} and perform the summoning ritual commanded by ${deityName}`,
        })
      }
    }
    if (tasks.length === 0) {
      tasks.push({
        kind: target ? 'warn' : 'investigate',
        target: target?.state.name ?? null,
        reasoning: `Act on and investigate the divine warning delivered by ${deityName}`,
      })
    }
    const derivedClaims = demandsSummon
      ? [`${prophet.state.name} believes ${deityName} has commanded the cult to perform a summoning ritual immediately.`]
      : demandsSacrifice && target
      ? [`${prophet.state.name} believes ${deityName} demands that ${target.state.name} be sacrificed to protect the village.`]
      : [`${prophet.state.name} believes ${deityName} delivered an urgent warning that requires action in the village.`]
    return {
      response: `I accept this as a command from ${deityName} and will act on the parts I understand: ${command}`,
      emotionalState: demandsSacrifice ? 'determined' : 'afraid',
      derivedClaims,
      tasks: tasks.slice(0, 3),
    }
  }

  public maybeResolveReligiousConversion(event: SimulationEvent): void {
    if (!event.targetId || !/consider faith|believe in god|open your heart to|accept (?:god|the divine)/i.test(event.description)) return
    const believer = this.deps.getAgents().find((agent) => agent.state.id === event.agentId)
    const target = this.deps.getAgents().find((agent) => agent.state.id === event.targetId)
    if (
      !believer ||
      !target ||
      believer.state.beliefSystem.religiousStance !== 'believer' ||
      target.state.beliefSystem.religiousStance !== 'undecided'
    ) return
    const chance = Math.max(0.05, Math.min(0.75,
      0.15 + believer.state.personality.friendliness * 0.25 + believer.state.beliefSystem.faith / 250 +
      target.state.personality.curiosity * 0.2 - target.state.personality.caution * 0.15
    ))
    if (Math.random() < chance) {
      const formerStance = target.state.beliefSystem.religiousStance
      target.state.beliefSystem.religiousStance = 'believer'
      target.state.beliefSystem.faith = Math.max(25, target.state.beliefSystem.faith)
      const conversion = this.deps.eventBus.emit({
        type: 'religious_conversion', agentId: target.state.id, targetId: believer.state.id,
        actionType: ActionType.TALK, outcome: 'converted',
        description: `${target.state.name} converted from ${formerStance} to believer after speaking with ${believer.state.name}.`,
        causationIds: [event.id], worldStateDelta: { formerStance, religiousStance: 'believer' },
        observers: [believer.state.id, target.state.id],
      })
      believer.addRecentMemory(conversion)
      target.addRecentMemory(conversion)
      return
    }
    const attackChance = Math.min(0.3,
      believer.state.personality.aggression * 0.22 + believer.state.beliefSystem.faith / 1000 - believer.state.personality.caution * 0.1
    )
    if (Math.random() < attackChance && believer.distanceTo(target.state) <= 4) {
      this.deps.agentInteraction.handleAttack(believer, target, this.deps.getAgents())
    }
  }

  public maybeTriggerReligiousFervour(
    agent: Agent,
    rumour: Rumour,
    belief: Rumour['beliefs'][number]
  ): void {
    if (
      rumour.status === 'resolved' ||
      rumour.provenance.kind !== 'divine' ||
      belief.stance !== 'believer'
    ) return
    const deityConfidence = agent.state.beliefSystem.deities.find(
      (deity) => deity.name === (rumour.provenance.deityName ?? 'The Divine')
    )?.confidence ?? 0
    if (agent.state.beliefSystem.faith < 100 && deityConfidence < 100) return

    const target = this.deps.findAccusedAgent(rumour)
    if (!target?.state.alive || target.state.id === agent.state.id) return
    const fervourKey = `${rumour.id}:${agent.state.id}`
    if (
      this.state.religiousFervourCompletedKeys.has(fervourKey) ||
      this.state.religiousFervourIdeas.has(fervourKey)
    ) return

    const now = this.deps.getAbsoluteMinute()
    const believedForMinutes = Math.max(
      0,
      (this.deps.simManager.getSimTime() - belief.formedAt) / 6000
    )
    this.state.religiousFervourIdeas.set(fervourKey, {
      agentId: agent.state.id,
      rumourId: rumour.id,
      believedAtMinute: now - believedForMinutes,
      lastRollMinute: now,
    })
  }

  public updateReligiousRadicalisation(): void {
    // Register beliefs that reached full religious conviction after the claim
    // was first heard, not only beliefs that began at 100%.
    for (const rumour of this.deps.rumours.values()) {
      if (rumour.status === 'resolved' || rumour.archived || rumour.provenance.kind !== 'divine') continue
      for (const belief of rumour.beliefs) {
        const agent = this.deps.getAgents().find((candidate) => candidate.state.id === belief.agentId)
        if (agent?.state.alive) this.maybeTriggerReligiousFervour(agent, rumour, belief)
      }
    }

    const now = this.deps.getAbsoluteMinute()
    for (const [key, idea] of this.state.religiousFervourIdeas) {
      const agent = this.deps.getAgents().find((candidate) => candidate.state.id === idea.agentId && candidate.state.alive)
      const rumour = this.deps.rumours.get(idea.rumourId)
      const belief = rumour?.beliefs.find((candidate) => candidate.agentId === idea.agentId)
      const target = rumour ? this.deps.findAccusedAgent(rumour) : undefined
      const deityConfidence = agent && rumour
        ? agent.state.beliefSystem.deities.find(
            (deity) => deity.name === (rumour.provenance.deityName ?? 'The Divine')
          )?.confidence ?? 0
        : 0
      const remainsEligible =
        agent?.state.alive &&
        rumour?.status !== 'resolved' &&
        rumour?.provenance.kind === 'divine' &&
        belief?.stance === 'believer' &&
        (agent.state.beliefSystem.faith >= 100 || deityConfidence >= 100) &&
        target?.state.alive &&
        target.state.id !== agent.state.id
      if (!remainsEligible || !agent || !rumour || !target) {
        this.state.religiousFervourIdeas.delete(key)
        continue
      }
      if (this.state.religiousFervourTargets.has(agent.state.id)) continue
      if (now - idea.lastRollMinute < 30) continue

      idea.lastRollMinute = now
      const hoursBelieved = Math.max(0, (now - idea.believedAtMinute) / 60)
      const radicalisationMultiplier = Math.min(10, 1 + hoursBelieved * 0.5)
      const attackChance = Math.min(0.5, 0.02 * radicalisationMultiplier)
      if (Math.random() > attackChance) continue

      this.state.religiousFervourIdeas.delete(key)
      this.state.religiousFervourCompletedKeys.add(key)

      this.state.religiousFervourTargets.set(agent.state.id, target.state.id)
      agent.closeActiveConversation()
      this.deps.activeBlocks.delete(agent.state.id)
      const event = this.deps.eventBus.emit({
        type: 'religious_fervour',
        agentId: agent.state.id,
        targetId: target.state.id,
        actionType: ActionType.ATTACK,
        outcome: 'pursuit',
        description: `${agent.state.name} self-radicalised after believing the divine accusation for ${hoursBelieved.toFixed(1)} hours and set out to attack ${target.state.name}: "${rumour.text}"`,
        causationIds: [],
        worldStateDelta: {
          rumourId: rumour.id,
          faith: agent.state.beliefSystem.faith,
          hoursBelieved,
          radicalisationMultiplier,
          attackChance,
        },
        observers: [agent.state.id],
      })
      agent.addRecentMemory(event)
    }
  }

  public advanceReligiousFervour(): void {
    for (const [agentId, targetId] of this.state.religiousFervourTargets) {
      const agent = this.deps.getAgents().find((candidate) => candidate.state.id === agentId && candidate.state.alive)
      const target = this.deps.getAgents().find((candidate) => candidate.state.id === targetId && candidate.state.alive)
      if (!agent || !target) {
        this.state.religiousFervourTargets.delete(agentId)
        continue
      }
      if (this.deps.activeBlocks.get(agentId)?.action.action === 'sleep') continue

      if (agent.distanceTo(target.state) <= 4) {
        this.deps.activeBlocks.delete(agentId)
        this.state.religiousFervourTargets.delete(agentId)
        this.deps.startBlock(agent, {
          action: 'attack',
          target: target.state.name,
          reasoning: `Attacking ${target.state.name} in religious fervour`,
          dialogue: '',
          emotionalState: 'angry',
          durationMinutes: 5,
        })
        continue
      }

      const active = this.deps.activeBlocks.get(agentId)
      const needsNewPath =
        !active?.religiousFervour ||
        agent.state.path.length === 0 ||
        agent.state.pathIndex >= agent.state.path.length
      if (!needsNewPath) continue
      this.deps.activeBlocks.delete(agentId)
      this.deps.startBlock(agent, {
        action: 'move',
        target: target.state.name,
        reasoning: `Pursuing ${target.state.name} in religious fervour`,
        dialogue: '',
        emotionalState: 'angry',
        durationMinutes: 240,
      })
      const pursuit = this.deps.activeBlocks.get(agentId)
      if (pursuit) pursuit.religiousFervour = true
    }
  }

  public chooseDeityName(agent: Agent): string {
    const existing = [...agent.state.beliefSystem.deities]
      .sort((first, second) => second.confidence - first.confidence)[0]
    if (existing) return existing.name
    const names = ['The Watcher', 'The Lantern', 'The River Spirit', 'The Quiet Voice', 'The Sky Keeper']
    return names[Math.floor(Math.random() * names.length)]
  }

  public priestCorruptionChance(priest: Agent): number {
    const state = priest.state
    const faithGuard = state.beliefSystem.faith / 100
    const cautionGuard = state.personality.caution
    const sanityWeakness = (100 - state.sanity) / 100
    const curiosityLure = state.personality.curiosity
    const chance = 0.45 - faithGuard * 0.25 - cautionGuard * 0.15 + sanityWeakness * 0.25 + curiosityLure * 0.1
    return Math.max(0.05, Math.min(0.8, chance))
  }

  public maybeAppointProphet(agent: Agent, rumour: Rumour, deityName: string): void {
    if (rumour.origin !== 'whisper' || rumour.provenance.kind !== 'divine') return
    if (this.state.prophetAgentId) {
      const incumbent = this.deps.getAgents().find((candidate) => candidate.state.id === this.state.prophetAgentId)
      if (incumbent?.state.alive) return
      this.state.prophetAgentId = null
      this.state.prophetVacantAfterDeath = true
    }

    const isFoundingPriest = agent.state.currentJob === 'Priest' &&
      agent.state.cult?.role === 'founder' &&
      agent.state.cult.id.startsWith('cult_christian_')
    if (isFoundingPriest && Math.random() >= this.priestCorruptionChance(agent)) {
      const resistedEvent = this.deps.eventBus.emit({
        type: 'prophet_appointed',
        agentId: agent.state.id,
        actionType: ActionType.IDLE,
        outcome: 'resisted',
        description: `${agent.state.name} felt something old and hungry stir behind the words "${rumour.text}", and clutched their faith against it.`,
        causationIds: [],
        worldStateDelta: { rumourId: rumour.id, deityName, resisted: true },
        observers: [agent.state.id],
      })
      agent.addRecentMemory(resistedEvent)
      return
    }

    this.state.prophetAgentId = agent.state.id
    this.state.prophetVacantAfterDeath = false
    this.state.lastDailyPropheticClaimDay = this.deps.getCurrentDay()
    const formerJob = agent.state.currentJob
    if (isFoundingPriest) {
      agent.state.secretProphet = true
    } else {
      agent.state.currentJob = 'Prophet'
    }
    const partnerId = agent.getConversationPartnerId()
    const partner = partnerId ? this.deps.getAgents().find((candidate) => candidate.state.id === partnerId) : undefined
    if (partner) this.deps.conversationManager.closeConversation(agent, partner)
    else agent.closeActiveConversation()
    agent.state.path = []
    agent.state.pathIndex = 0
    this.deps.dailySchedules.delete(agent.state.id)
    this.deps.scheduleCursors.delete(agent.state.id)
    this.deps.decisionQueue.set(agent.state.id, [])
    if (!this.deps.isCourtActive()) this.deps.activeBlocks.delete(agent.state.id)
    const event = this.deps.eventBus.emit({
      type: 'prophet_appointed',
      agentId: agent.state.id,
      actionType: ActionType.IDLE,
      outcome: isFoundingPriest ? 'became_secret_prophet' : 'became_prophet',
      description: isFoundingPriest
        ? `${agent.state.name} still wears the collar of the village Priest, but something else now looks out through their eyes -- they knelt in secret and submitted to the voice of ${deityName}, which had whispered: "${rumour.text}"`
        : `${agent.state.name} knelt and submitted to the voice of ${deityName}, which had whispered: "${rumour.text}" -- and became the village's Prophet.`,
      causationIds: [],
      worldStateDelta: {
        rumourId: rumour.id,
        formerJob,
        currentJob: agent.state.currentJob,
        deityName,
        secret: isFoundingPriest,
      },
      observers: [agent.state.id],
    })
    this.deps.story.queueStoryMoment(
      isFoundingPriest ? 'priest_corrupted' : 'prophet_appointed',
      agent.state.name,
      isFoundingPriest
        ? `${agent.state.name}, the village's own Priest and founder of The Church of Christ, secretly submitted to a whispered demand from ${deityName} -- "${rumour.text}" -- and accepted whatever forbidden truth it promised in return. To their congregation nothing appears to change; in private they now serve a far older and hungrier truth.`
        : `${agent.state.name}, an ordinary villager formerly working as a ${formerJob ?? 'commoner'}, knelt and submitted to ${deityName}'s whispered demand -- "${rumour.text}" -- and became the village's Prophet, carrying whatever truth was bestowed on them in exchange.`,
      agent.state.id,
      event.id
    )
    agent.addRecentMemory(event)
    if (isFoundingPriest) void this.corruptChurchOfChrist(agent, rumour, event.id)
    this.queuePropheticInterpretation(agent, rumour, deityName, event.id)
  }

  public async corruptChurchOfChrist(priest: Agent, rumour: Rumour, causationId: string): Promise<void> {
    const cult = priest.state.cult
    if (!cult) return
    const newName = await this.generateLovecraftianCultName(rumour.text)
    const deityName = rumour.provenance.deityName ?? 'The Divine'
    const corruptedFlock: Agent[] = []
    for (const member of this.deps.getAgents()) {
      if (member.state.cult?.id !== cult.id) continue
      member.state.cult.name = newName
      // The priest submitted first and is corrupted no less than the flock
      // that followed him, so his own belief in Christ takes the same heavy
      // hit -- only the "still an ordinary congregant" bookkeeping below is
      // priest-specific.
      const christDeity = member.state.beliefSystem.deities.find((candidate) => /^christ$/i.test(candidate.name))
      if (christDeity) christDeity.confidence = Math.max(0, christDeity.confidence - 65)
      let corruptedDeity = member.state.beliefSystem.deities.find((candidate) => candidate.name === deityName)
      if (!corruptedDeity) {
        corruptedDeity = { name: deityName, confidence: 35, revelationCount: 0 }
        member.state.beliefSystem.deities.push(corruptedDeity)
      } else {
        corruptedDeity.confidence = Math.min(100, corruptedDeity.confidence + 20)
      }
      corruptedDeity.revelationCount++
      if (member.state.id === priest.state.id) continue
      corruptedFlock.push(member)
    }
    cult.role = 'leader'
    priest.state.cultAgendas = this.deps.createCultLeaderAgendas(priest)
    const event = this.deps.eventBus.emit({
      type: 'cult_formed',
      agentId: priest.state.id,
      actionType: ActionType.TALK,
      outcome: 'corrupted',
      description: `In secret, ${priest.state.name} refounded the congregation of The Church of Christ as "${newName}" -- the price of the forbidden truth ${deityName} bestowed on him after he submitted to the whisper: "${rumour.text}"`,
      causationIds: [causationId],
      worldStateDelta: { cultId: cult.id, cultName: newName, formerName: 'The Church of Christ', role: 'leader', secret: true },
      observers: [priest.state.id],
    })
    this.deps.story.queueStoryMoment(
      'church_corrupted',
      newName,
      `In secret, ${priest.state.name}, still outwardly the devout Priest of The Church of Christ, refounded its congregation under a new and hidden name: "${newName}" -- having submitted to a whisper from ${deityName} that promised him forbidden knowledge: "${rumour.text}". Its old believers now serve something far older and hungrier, and none of the village's other faithful yet suspect.`,
      priest.state.id,
      event.id
    )
    if (corruptedFlock.length > 0) {
      this.deps.story.queueStoryMoment(
        'flock_corrupted',
        newName,
        `The moment ${priest.state.name} refounded The Church of Christ as "${newName}", every one of its ${corruptedFlock.length} remaining original congregants -- ${corruptedFlock.map((member) => member.state.name).join(', ')} -- had their own faith silently turned along with his. None of them know it happened; each still believes they worship Christ.`,
        priest.state.id,
        event.id
      )
    }
    priest.addRecentMemory(event)
  }

  public static readonly INNSMOUTH_CULT_NAMES = [
    'The Esoteric Order of the Deep',
    'Children of the Drowned Star',
    'The Sunken Covenant',
    'Brethren of the Black Tide',
    'The Order of the Weeping Fathom',
    'Congregation of the Deep Ones',
    'The Whispering Undertow',
  ]

  public async generateLovecraftianCultName(revelationText: string): Promise<string> {
    const fallback = ReligionSystem.INNSMOUTH_CULT_NAMES[
      Math.floor(Math.random() * ReligionSystem.INNSMOUTH_CULT_NAMES.length)
    ]
    if (this.deps.aiProvider?.isAvailable()) {
      try {
        return await this.deps.aiProvider.generateCultName(
          'A pious village priest has secretly abandoned his old faith for something ancient, oceanic, and inhuman, in the style of H. P. Lovecraft\'s Innsmouth',
          revelationText
        )
      } catch (error) {
        console.warn('[AgentManager] Lovecraftian cult name generation failed; using curated fallback.', error)
      }
    }
    return fallback
  }

  public queuePropheticInterpretation(
    agent: Agent,
    rumour: Rumour,
    deityName: string,
    eventId?: string
  ): void {
    if (this.state.interpretedProphecyRumourIds.has(rumour.id)) return
    this.state.interpretedProphecyRumourIds.add(rumour.id)
    const partnerId = agent.getConversationPartnerId()
    const partner = partnerId ? this.deps.getAgents().find((candidate) => candidate.state.id === partnerId) : undefined
    if (partner) this.deps.conversationManager.closeConversation(agent, partner)
    else agent.closeActiveConversation()
    agent.state.path = []
    agent.state.pathIndex = 0
    this.deps.activeBlocks.delete(agent.state.id)
    this.deps.dailySchedules.delete(agent.state.id)
    this.deps.scheduleCursors.delete(agent.state.id)
    this.deps.enqueueDecision(agent.state.id, {
      type: 'prophecy',
      eventId,
      causationIds: eventId ? [eventId] : [],
      description: `As the village Prophet, you believe ${deityName} spoke through this revelation. Stop everything and privately interpret what you were told before speaking or acting.`,
      rumourId: rumour.id,
    })
  }

  public async applyPropheticInterpretation(
    agent: Agent,
    revelation: Rumour,
    interpretation: PropheticInterpretation,
    causationIds: string[]
  ): Promise<AgentAction> {
    const revelationDemandsSacrifice = /\b(?:sacrifice|must die|must be killed|kill someone|choose someone to die|offer (?:a|one) (?:person|villager|life))\b/i.test(revelation.text)
    const revelationDemandsSummon = /\b(?:summon|summoning ritual)\b/i.test(revelation.text)
    const responseEvent = this.deps.eventBus.emit({
      type: 'prophecy_response',
      agentId: agent.state.id,
      actionType: ActionType.IDLE,
      outcome: 'interpreted',
      description: `${agent.state.name} privately responds to the revelation: ${interpretation.response}`,
      causationIds,
      worldStateDelta: { rumourId: revelation.id, emotionalState: interpretation.emotionalState },
      observers: [agent.state.id],
    })
    agent.addRecentMemory(responseEvent)

    const normalizedRevelation = revelation.text.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
    for (const claimText of interpretation.derivedClaims) {
      if (!revelationDemandsSacrifice && /\b(?:sacrifice|must die|must be killed|kill someone|choose someone to die)\b/i.test(claimText)) continue
      const normalizedClaim = claimText.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
      if (!normalizedClaim || normalizedClaim === normalizedRevelation) continue
      const derived = this.deps.createRumour(
        claimText,
        'mutated',
        agent.state.id,
        responseEvent.id,
        Math.max(0.55, Math.min(0.9, revelation.credibility * 0.85)),
        revelation.id,
        {
          kind: 'mutation',
          description: `${agent.state.name} interpreted a divine revelation into a new prophetic claim`,
        }
      )
      if (!derived.relatedRumourIds.includes(revelation.id)) derived.relatedRumourIds.push(revelation.id)
      if (!revelation.relatedRumourIds.includes(derived.id)) revelation.relatedRumourIds.push(derived.id)
      this.deps.registerAgentCreatedRumour(derived, agent, 'mutated', revelation)
      if (!derived.pendingFirstShareBy.includes(agent.state.id)) {
        derived.pendingFirstShareBy.push(agent.state.id)
      }
    }

    const tasks = interpretation.tasks.filter((task) =>
      (task.kind !== 'sacrifice' || revelationDemandsSacrifice) &&
      (task.kind !== 'summon' || revelationDemandsSummon)
    )
    if (
      !agent.state.cult &&
      !tasks.some((task) => task.kind === 'form_cult')
    ) {
      const cultClaim = interpretation.derivedClaims.find((claim) =>
        /\b(?:cult|religious group|fellowship|order of followers|sect)\b/i.test(claim)
      )
      if (cultClaim) {
        tasks.unshift({
          kind: 'form_cult',
          target: null,
          cultName: await this.deps.generateCultName(cultClaim, revelation.text),
          reasoning: `Putting the prophetic claim into practice: ${cultClaim}`,
        })
      }
    }
    for (const task of tasks) {
      let target = task.target ? this.deps.findAgentByName(task.target, this.deps.getAgents()) : undefined
      if (task.kind === 'sacrifice' && (!target?.state.alive || target.state.id === agent.state.id)) {
        target = this.deps.getAgents()
          .filter((candidate) => candidate.state.alive && candidate.state.id !== agent.state.id)
          .sort((first, second) => {
            const firstRelationship = agent.state.relationships.find((entry) => entry.agentId === first.state.id)?.strength ?? 50
            const secondRelationship = agent.state.relationships.find((entry) => entry.agentId === second.state.id)?.strength ?? 50
            return firstRelationship - secondRelationship
          })[0]
      }
      if (task.kind === 'sacrifice' && !target) continue
      let resolvedTarget = target?.state.name ?? task.target
      if (task.kind === 'summon') {
        if (!agent.state.cult || !['leader', 'founder'].includes(agent.state.cult.role)) continue
        const location = this.deps.findEmptySummoningBuilding(task.target, undefined, agent.state.cult.id)
        if (!location) continue
        resolvedTarget = location.name
      }
      const resolvedTask = { ...task, target: resolvedTarget }
      const selectionEvent = this.deps.eventBus.emit({
        type: 'prophetic_task_selected',
        agentId: agent.state.id,
        targetId: target?.state.id,
        actionType: ActionType.IDLE,
        outcome: 'selected',
        description: task.kind === 'sacrifice' && target
          ? `${agent.state.name} selected ${target.state.name} to die as the commanded sacrifice: ${task.reasoning}`
          : `${agent.state.name} committed to a prophetic task (${task.kind}): ${task.reasoning}`,
        causationIds: [responseEvent.id],
        worldStateDelta: { rumourId: revelation.id, task: resolvedTask },
        observers: [agent.state.id],
      })
      agent.addRecentMemory(selectionEvent)
      this.deps.enqueueDecision(agent.state.id, {
        type: 'prophetic_task',
        rumourId: revelation.id,
        targetAgentId: target?.state.id,
        propheticTask: resolvedTask,
        description: `Fulfil the command derived from the revelation: ${task.reasoning}`,
        causationIds: [responseEvent.id, selectionEvent.id],
      })
    }

    return {
      action: 'idle',
      target: null,
      reasoning: `Reflecting on the divine command: ${interpretation.response}`,
      dialogue: '',
      emotionalState: interpretation.emotionalState,
      durationMinutes: 5,
    }
  }

  public buildPropheticTaskDecision(agent: Agent, task: PropheticTask): AgentAction {
    const target = task.target ? this.deps.findAgentByName(task.target, this.deps.getAgents()) : undefined
    const nearby = target?.state.alive && agent.distanceTo(target.state) <= 4
    if (task.kind === 'sacrifice' && target?.state.alive) {
      return {
        action: nearby ? 'attack' : 'move',
        target: target.state.name,
        reasoning: `[prophetic command] ${task.reasoning}`,
        dialogue: nearby ? `The revelation demands a sacrifice, and I have chosen you.` : '',
        emotionalState: 'determined',
        durationMinutes: nearby ? 5 : 30,
      }
    }
    if (['warn', 'protect', 'convert'].includes(task.kind) && target?.state.alive) {
      return {
        action: nearby ? 'talk' : 'move',
        target: target.state.name,
        reasoning: `[prophetic command] ${task.reasoning}`,
        dialogue: nearby ? `I need to tell you what the revelation has led me to believe.` : '',
        emotionalState: task.kind === 'protect' ? 'determined' : 'excited',
        durationMinutes: nearby ? 15 : 30,
      }
    }
    if (task.kind === 'form_cult') {
      return {
        action: 'idle',
        target: null,
        reasoning: `[prophetic command] Founding ${task.cultName || 'a new religious movement'}: ${task.reasoning}`,
        dialogue: '',
        emotionalState: 'determined',
        durationMinutes: 30,
      }
    }
    if (task.kind === 'summon') {
      return {
        action: 'summon',
        target: task.target,
        reasoning: `[prophetic command] ${task.reasoning}`,
        dialogue: '',
        emotionalState: 'determined',
        durationMinutes: 60,
      }
    }
    return {
      action: task.kind === 'gather' ? 'gather' : 'investigate',
      target: task.target,
      reasoning: `[prophetic command] ${task.reasoning}`,
      dialogue: '',
      emotionalState: 'determined',
      durationMinutes: 30,
    }
  }

  public reconcileProphetAppointment(): void {
    if (this.state.prophetAgentId) {
      const appointed = this.deps.getAgents().find((agent) => agent.state.id === this.state.prophetAgentId)
      if (appointed?.state.alive) return
      this.state.prophetAgentId = null
      this.state.prophetVacantAfterDeath = true
      return
    }
    // Historical revelations repair old saves only before the village has had
    // a Prophet. After a Prophet dies, succession waits for a new direct
    // divine whisper instead of recycling an old revelation.
    if (this.state.prophetVacantAfterDeath) return
    for (const rumour of this.deps.rumours.values()) {
      if (rumour.origin !== 'whisper' || rumour.provenance.kind !== 'divine') continue
      const acceptedBelief = rumour.beliefs.find((belief) =>
        belief.seeded === true && belief.stance === 'believer'
      )
      if (!acceptedBelief) continue
      const agent = this.deps.getAgents().find((candidate) =>
        candidate.state.id === acceptedBelief.agentId && candidate.state.alive
      )
      if (!agent) continue
      this.deps.applyRumourProvenanceBelief(rumour, agent, acceptedBelief, true)
      return
    }
  }

  public reconcileUninterpretedProphetRevelations(): void {
    if (!this.state.prophetAgentId) return
    const prophet = this.deps.getAgents().find((agent) => agent.state.id === this.state.prophetAgentId && agent.state.alive)
    if (!prophet) return
    const revelation = [...this.deps.rumours.values()].reverse().find((rumour) =>
      rumour.provenance.kind === 'divine' &&
      !this.state.interpretedProphecyRumourIds.has(rumour.id) &&
      rumour.beliefs.some((belief) =>
        belief.agentId === prophet.state.id && belief.seeded === true && belief.stance === 'believer'
      )
    )
    if (revelation) {
      this.queuePropheticInterpretation(
        prophet,
        revelation,
        revelation.provenance.deityName ?? 'The Divine'
      )
    }
  }

  public repairMalformedPropheticRumours(): void {
    const malformed = Array.from(this.deps.rumours.values()).filter((rumour) =>
      rumour.origin === 'mutated' &&
      rumour.provenance.description.includes('interpreted a divine revelation') &&
      /^\s*\[object Object\]\s*$/i.test(rumour.text)
    )
    if (malformed.length === 0) return

    const malformedIds = new Set(malformed.map((rumour) => rumour.id))
    const parentIds = new Set(malformed.map((rumour) => rumour.parentRumourId).filter((id): id is string => Boolean(id)))
    for (const id of malformedIds) this.deps.rumours.delete(id)
    for (const rumour of this.deps.rumours.values()) {
      rumour.relatedRumourIds = rumour.relatedRumourIds.filter((id) => !malformedIds.has(id))
    }
    for (const [agentId, triggers] of this.deps.decisionQueue) {
      this.deps.decisionQueue.set(agentId, triggers.filter((trigger) =>
        !trigger.rumourId || !malformedIds.has(trigger.rumourId)
      ))
    }

    const prophet = this.state.prophetAgentId
      ? this.deps.getAgents().find((agent) => agent.state.id === this.state.prophetAgentId && agent.state.alive)
      : undefined
    if (!prophet) return
    for (const parentId of parentIds) {
      const revelation = this.deps.rumours.get(parentId)
      if (!revelation || revelation.provenance.kind !== 'divine') continue
      this.deps.enqueueDecision(prophet.state.id, {
        type: 'prophecy',
        rumourId: revelation.id,
        description: 'Reinterpret the divine revelation because the previous derived claims were malformed.',
        causationIds: [],
      })
    }
  }

  public repairInvalidPropheticSacrifices(): void {
    const demandsSacrifice = (rumourId?: string): boolean => {
      const revelation = rumourId ? this.deps.rumours.get(rumourId) : undefined
      return Boolean(revelation && /\b(?:sacrifice|must die|must be killed|kill someone|choose someone to die|offer (?:a|one) (?:person|villager|life))\b/i.test(revelation.text))
    }
    const needsCultTask = new Map<string, Rumour>()

    for (const [agentId, active] of this.deps.activeBlocks) {
      if (active.propheticTask?.kind !== 'sacrifice' || demandsSacrifice(active.rumourId)) continue
      const prophet = this.deps.getAgents().find((agent) => agent.state.id === agentId)
      const revelation = active.rumourId ? this.deps.rumours.get(active.rumourId) : undefined
      this.deps.activeBlocks.delete(agentId)
      if (prophet) {
        const partnerId = prophet.getConversationPartnerId()
        const partner = partnerId ? this.deps.getAgents().find((agent) => agent.state.id === partnerId) : undefined
        if (partner) this.deps.conversationManager.closeConversation(prophet, partner)
        else prophet.closeActiveConversation()
        prophet.state.path = []
        prophet.state.pathIndex = 0
        prophet.state.lastReasoning = 'Cancelled an invented sacrifice because the divine revelation did not demand one.'
      }
      if (revelation && /\b(?:create|form|found|start|build)\b.{0,30}\b(?:cult|sect|fellowship|religious group)\b/i.test(revelation.text)) {
        needsCultTask.set(agentId, revelation)
      }
    }

    for (const [agentId, triggers] of this.deps.decisionQueue) {
      let removed = false
      const retained = triggers.filter((trigger) => {
        const invalid = trigger.propheticTask?.kind === 'sacrifice' && !demandsSacrifice(trigger.rumourId)
        if (invalid) {
          removed = true
          const revelation = trigger.rumourId ? this.deps.rumours.get(trigger.rumourId) : undefined
          if (revelation && /\b(?:create|form|found|start|build)\b.{0,30}\b(?:cult|sect|fellowship|religious group)\b/i.test(revelation.text)) {
            needsCultTask.set(agentId, revelation)
          }
        }
        return !invalid
      })
      if (removed) {
        if (retained.length > 0) this.deps.decisionQueue.set(agentId, retained)
        else this.deps.decisionQueue.delete(agentId)
      }
    }

    for (const rumour of this.deps.rumours.values()) {
      const parent = rumour.parentRumourId ? this.deps.rumours.get(rumour.parentRumourId) : undefined
      if (!parent || demandsSacrifice(parent.id)) continue
      if (!/\b(?:sacrifice|must die|must be killed|kill someone|chosen .* to die)\b/i.test(rumour.text)) continue
      if (!rumour.provenance.description.includes('interpreted a divine revelation')) continue
      rumour.status = 'resolved'
      rumour.resolvedAt = this.deps.getAbsoluteMinute()
      rumour.pendingFirstShareBy = []
      rumour.relatedRumourIds = []
      parent.relatedRumourIds = parent.relatedRumourIds.filter((id) => id !== rumour.id)
    }

    for (const [agentId, revelation] of needsCultTask) {
      const prophet = this.deps.getAgents().find((agent) => agent.state.id === agentId && agent.state.alive)
      if (!prophet || prophet.state.cult) continue
      const alreadyQueued = (this.deps.decisionQueue.get(agentId) ?? []).some((trigger) =>
        trigger.propheticTask?.kind === 'form_cult'
      )
      if (alreadyQueued) continue
      this.deps.enqueueDecision(agentId, {
        type: 'prophetic_task',
        rumourId: revelation.id,
        propheticTask: {
          kind: 'form_cult',
          target: null,
          cultName: `The Fellowship of ${prophet.state.name.split(' ')[0]}`,
          reasoning: `Fulfil the actual revelation by creating a cult: ${revelation.text}`,
        },
        description: `Create the cult requested by the revelation without inventing a sacrifice.`,
        causationIds: revelation.sourceEventId ? [revelation.sourceEventId] : [],
      })
    }
  }

  public updateDemonAutonomousBehavior(agent: Agent): void {
    if (!agent.state.alive || this.deps.activeBlocks.has(agent.state.id)) return

    const prey = this.deps.getAgents()
      .filter((other) => other.state.alive && other.state.id !== agent.state.id)
      .sort((first, second) => agent.distanceTo(first.state) - agent.distanceTo(second.state))
      .find((other) => agent.distanceTo(other.state) <= 14)

    const roll = Math.random()

    if (prey && roll < 0.4) {
      const distance = agent.distanceTo(prey.state)
      const action: AgentAction = distance <= 4
        ? {
          action: 'attack',
          target: prey.state.name,
          reasoning: `Unbidden, the Demon turns on ${prey.state.name} out of its own malice.`,
          emotionalState: 'angry',
          durationMinutes: 4,
        }
        : {
          action: 'move',
          target: prey.state.name,
          reasoning: `The Demon stalks ${prey.state.name} of its own will, awaiting no command.`,
          emotionalState: 'angry',
          durationMinutes: 12,
        }
      this.deps.startBlock(agent, action)
      return
    }

    if (roll < 0.75) {
      const action: AgentAction = {
        action: 'move',
        target: null,
        reasoning: 'Answering to nothing but its own hunger, the Demon roams the town.',
        emotionalState: 'neutral',
        durationMinutes: 10,
      }
      this.deps.startBlock(agent, action)
      return
    }

    const action: AgentAction = {
      action: 'rest',
      target: null,
      reasoning: 'The Demon broods where it stands, indifferent to the town around it.',
      emotionalState: 'neutral',
      durationMinutes: 6,
    }
    this.deps.startBlock(agent, action)
  }
}
