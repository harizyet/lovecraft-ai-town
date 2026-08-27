import { Agent } from '@/agent/Agent'
import { ActionType, Building, CultScheme, ForbiddenRelic, Rumour, ForbiddenKnowledgeEntry } from '@/types'
import { SystemDeps } from './SystemDeps'
import { ExistentialReactionResult } from '@/ai/AIProvider'

export interface RelicSystemState {
  relicCounter: number
  lastTickMinute: number
}

export function createRelicState(): RelicSystemState {
  return {
    relicCounter: 0,
    lastTickMinute: -1,
  }
}

const RELIC_CREATION_CHANCE = 0.16
const FORBIDDEN_CONTENT_CHANCE_BASE = 0.35
// How close an agent must wander to a relic's tile to notice and read it.
const DISCOVERY_RADIUS = 2.5

// Forbidden Relics: an investigation may, once it concludes, leave behind a
// physical object -- the investigator's own written findings -- rather than
// just a resolved rumour. If what they uncovered brushed against forbidden
// knowledge, writing it down can shake the author's own sanity (see
// applyExistentialWitnessReaction below), and the relic itself becomes a
// standing, map-visible hazard: any later agent who is not aligned with (or
// is actively opposed to) the author's cult, and who wanders close enough to
// read it, risks the same fate the author risked -- either sliding toward
// insanity, or toward belief in whatever deity the relic's findings speak of.
export class RelicSystem {
  constructor(private deps: SystemDeps, public readonly state: RelicSystemState) {}

  public maybeCreateRelicFromInvestigation(agent: Agent, rumour: Rumour, causationId: string): void {
    if (!agent.state.alive) return
    if (Math.random() >= RELIC_CREATION_CHANCE) return

    const priorForbiddenKnowledge = (agent.state.forbiddenKnowledge?.length ?? 0) > 0
    const cultRelated = /cult|cultist|sect|ritual|forbidden rite|hidden shrine|hooded|heretic|demon|god|deity/i.test(rumour.text)
    const forbiddenChance = FORBIDDEN_CONTENT_CHANCE_BASE +
      (priorForbiddenKnowledge ? 0.3 : 0) +
      (cultRelated ? 0.15 : 0)
    const containsForbiddenKnowledge = Math.random() < Math.min(0.85, forbiddenChance)
    const severity = containsForbiddenKnowledge
      ? Math.round(30 + Math.random() * 50 + (priorForbiddenKnowledge ? 10 : 0))
      : 0

    const cult = agent.state.cult
    const deityName = cult ? this.deps.chooseDeityName(agent) : undefined
    const truncatedRumourText = rumour.text.length > 40 ? `${rumour.text.slice(0, 40)}…` : rumour.text

    this.state.relicCounter++
    const relic: ForbiddenRelic = {
      id: `relic_${Math.floor(this.deps.getAbsoluteMinute())}_${this.state.relicCounter}`,
      position: { x: Math.round(agent.state.position.x), y: Math.round(agent.state.position.y) },
      title: `${agent.state.name}'s Findings on "${truncatedRumourText}"`,
      text: rumour.finding ?? `${agent.state.name}'s written account of their investigation.`,
      authorAgentId: agent.state.id,
      authorName: agent.state.name,
      cultId: cult?.id,
      cultName: cult?.name,
      deityName,
      containsForbiddenKnowledge,
      severity,
      createdAtMinute: this.deps.getAbsoluteMinute(),
      discoveredByAgentIds: [],
    }
    this.deps.world.relics.set(relic.id, relic)

    const description = containsForbiddenKnowledge
      ? `${agent.state.name} penned their investigation findings into a relic -- and in doing so, set down knowledge that should have stayed buried.`
      : `${agent.state.name} penned their investigation findings into a relic and left it behind.`

    const event = this.deps.eventBus.emit({
      type: 'relic_created',
      agentId: agent.state.id,
      actionType: ActionType.INVESTIGATE,
      outcome: containsForbiddenKnowledge ? 'forbidden_relic_created' : 'relic_created',
      description,
      causationIds: [causationId],
      worldStateDelta: {
        relicId: relic.id,
        x: relic.position.x,
        y: relic.position.y,
        containsForbiddenKnowledge,
      },
      observers: [agent.state.id],
    })
    agent.addRecentMemory(event)

    if (containsForbiddenKnowledge) {
      this.deps.applyExistentialWitnessReaction(agent, relic.text, severity, 'forbidden_relic')
    }

    this.deps.story.queueStoryMoment('forbidden_relic_created', relic.title, description, agent.state.id, event.id)
  }

  // Called once per simulated minute from AgentManager.update, alongside
  // EnvironmentSystem.advanceCorruption -- cheap no-op the rest of the time
  // since there are normally only a handful of relics in the world.
  public advanceRelics(): void {
    const nowMinute = Math.floor(this.deps.getAbsoluteMinute())
    if (nowMinute === this.state.lastTickMinute) return
    this.state.lastTickMinute = nowMinute
    if (this.deps.world.relics.size === 0) return

    for (const relic of this.deps.world.relics.values()) {
      for (const agent of this.deps.getAgents()) {
        if (!agent.state.alive) continue
        if (agent.state.id === relic.authorAgentId) continue
        if (relic.discoveredByAgentIds.includes(agent.state.id)) continue
        const dist = Math.hypot(
          agent.state.position.x - relic.position.x,
          agent.state.position.y - relic.position.y
        )
        if (dist > DISCOVERY_RADIUS) continue
        this.handleDiscovery(agent, relic)
      }
    }
  }

  // A relic tied to a specific cult only affects agents outside that cult:
  // members already know what it says, and this mechanic exists to spread or
  // punish belief among the uninitiated, not to re-convert the converted.
  private isTargetable(agent: Agent, relic: ForbiddenRelic): boolean {
    if (!relic.cultId) return true
    const isMember = agent.state.cult?.id === relic.cultId
    const isOpposed = agent.state.antiCultGroup?.opposedCultId === relic.cultId
    return !isMember || isOpposed
  }

  private handleDiscovery(agent: Agent, relic: ForbiddenRelic): void {
    relic.discoveredByAgentIds.push(agent.state.id)

    const event = this.deps.eventBus.emit({
      type: 'relic_discovered',
      agentId: agent.state.id,
      actionType: ActionType.INVESTIGATE,
      outcome: 'discovered',
      description: `${agent.state.name} came upon "${relic.title}" and read what was written inside.`,
      causationIds: [],
      worldStateDelta: { relicId: relic.id, authorAgentId: relic.authorAgentId },
      observers: [agent.state.id],
    })
    agent.addRecentMemory(event)

    // Handle deity relic logic
    if (relic.authorAgentId === 'deity') {
      if (relic.deityName) {
        const believesInDeity = agent.state.beliefSystem.deities.some(
          (d) => d.name.toLowerCase() === relic.deityName!.toLowerCase() && d.confidence >= 50
        )
        if (believesInDeity) {
          // If they already believe, they are unaffected.
          return
        }

        // Otherwise, they gain the knowledge
        const entry: ForbiddenKnowledgeEntry = {
          text: relic.text,
          category: 'other',
          severity: relic.severity,
          revealedAtMinute: this.deps.getAbsoluteMinute(),
        }
        agent.state.forbiddenKnowledge = [...(agent.state.forbiddenKnowledge ?? []), entry]

        // A cultist's conviction protects them from being shattered by a
        // revelation, even one belonging to a rival deity -- consistent with
        // the same exemption applied to forbidden-knowledge rumours.
        const isCultist = agent.state.secretProphet || agent.state.cult != null

        // High chance (80%) of going insane, unless shielded by cult conviction
        if (!isCultist && Math.random() < 0.8) {
          const reaction: ExistentialReactionResult = {
            comprehended: true,
            reaction: 'madness',
            response: `The revelation inscribed on the relic of ${relic.deityName} shattered my mind.`,
            emotionalState: 'panicked'
          }
          this.deps.resolveExistentialReaction(agent, reaction, relic.severity, relic.text, 'forbidden_relic')
          return
        }
      }
    }

    if (!this.isTargetable(agent, relic)) return

    if (relic.containsForbiddenKnowledge) {
      this.deps.applyExistentialWitnessReaction(agent, relic.text, relic.severity, 'forbidden_relic')
    }

    if (!relic.cultId || !relic.deityName) return
    if (!agent.state.alive || agent.state.permanentInsanity) return
    if (this.deps.isConversionImmune(agent)) return

    const believeChance = (relic.containsForbiddenKnowledge ? 0.35 : 0.2) +
      agent.state.personality.curiosity * 0.25 -
      agent.state.personality.caution * 0.2
    if (Math.random() < Math.max(0.05, believeChance)) {
      this.deps.maybeTriggerWillingCultJoin(agent, relic.deityName, event.id)
    }
  }

  public createDeityForbiddenRelic(
    tileX: number,
    tileY: number,
    text: string,
    deityName: string
  ): void {
    this.state.relicCounter++
    const relic: ForbiddenRelic = {
      id: `relic_${Math.floor(this.deps.getAbsoluteMinute())}_${this.state.relicCounter}`,
      position: { x: tileX, y: tileY },
      title: `Forbidden Relic of ${deityName}`,
      text: text,
      authorAgentId: 'deity',
      authorName: 'Divine Manifestation',
      deityName,
      containsForbiddenKnowledge: true,
      severity: 90,
      createdAtMinute: this.deps.getAbsoluteMinute(),
      discoveredByAgentIds: [],
    }
    this.deps.world.relics.set(relic.id, relic)

    const description = `The deity ${deityName} manifested a forbidden relic upon the earth, bearing a terrible revelation: "${text}".`

    const event = this.deps.eventBus.emit({
      type: 'relic_created',
      agentId: 'world',
      actionType: ActionType.IDLE,
      outcome: 'forbidden_relic_created',
      description,
      causationIds: [],
      worldStateDelta: {
        relicId: relic.id,
        x: relic.position.x,
        y: relic.position.y,
        containsForbiddenKnowledge: true,
      },
      observers: this.deps.getAgents().filter((a) => a.state.alive).map((a) => a.state.id),
    })

    for (const agent of this.deps.getAgents().filter((a) => a.state.alive)) {
      agent.addRecentMemory(event)
    }

    this.deps.story.queueStoryMoment('deity_relic_created', relic.title, description, 'world', event.id)
  }

  // Cult Scheme (relic_exposure primitive): the leader plants a relic near
  // their own job-appropriate building. Unlike the two creation methods
  // above, this one is deterministic given its inputs -- severity and
  // containsForbiddenKnowledge are already resolved by the caller
  // (CultSystem.executeCultScheme, from the leader's own state), not rolled
  // here. Discovery, sanity reactions, and conversion rolls all still flow
  // through the same handleDiscovery()/advanceRelics() pipeline once this
  // relic is in world.relics -- no changes needed there.
  public createSchemeRelic(
    leader: Agent,
    scheme: CultScheme,
    building: Building,
    severity: number,
    containsForbiddenKnowledge: boolean
  ): ForbiddenRelic {
    this.state.relicCounter++
    const cult = leader.state.cult
    const deityName = cult ? this.deps.chooseDeityName(leader) : undefined
    const relic: ForbiddenRelic = {
      id: `relic_${Math.floor(this.deps.getAbsoluteMinute())}_${this.state.relicCounter}`,
      position: {
        x: Math.round(building.position.x + building.size.x / 2),
        y: Math.round(building.position.y + building.size.y / 2),
      },
      title: `A hidden token near ${building.name}`,
      // What a discovering agent actually reads -- the validator caps this
      // to 200 chars precisely because it ends up here.
      text: scheme.narrative.method,
      authorAgentId: leader.state.id,
      authorName: leader.state.name,
      cultId: scheme.cultId,
      cultName: cult?.name,
      deityName,
      containsForbiddenKnowledge,
      severity,
      createdAtMinute: this.deps.getAbsoluteMinute(),
      discoveredByAgentIds: [],
    }
    this.deps.world.relics.set(relic.id, relic)

    const description = `${leader.state.name} left something behind near ${building.name}, under cover of ${scheme.narrative.coverStory}`
    const event = this.deps.eventBus.emit({
      type: 'relic_created',
      agentId: leader.state.id,
      actionType: ActionType.CORRUPT,
      outcome: containsForbiddenKnowledge ? 'forbidden_relic_created' : 'relic_created',
      description,
      causationIds: [],
      worldStateDelta: {
        relicId: relic.id,
        schemeId: scheme.id,
        x: relic.position.x,
        y: relic.position.y,
        containsForbiddenKnowledge,
      },
      observers: [leader.state.id],
    })
    leader.addRecentMemory(event)

    // Deliberately no applyExistentialWitnessReaction call here (unlike
    // maybeCreateRelicFromInvestigation, which applies it to a non-cultist
    // investigator) -- handleDiscovery's own isCultist shield already
    // exempts cult leaders from this exact reaction when they discover a
    // relic, so applying it to the leader at creation time would be
    // inconsistent. No queueStoryMoment call either -- executeCultScheme
    // owns that, since it needs to combine this relic with the scheme's own
    // narrative, which this method has no visibility into.
    return relic
  }
}
