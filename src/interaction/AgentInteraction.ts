import { Agent } from '@/agent/Agent'
import { ActionType, RelationshipType, SimulationEvent } from '@/types'
import { EventBus } from '@/interaction/EventBus'

export class AgentInteraction {
  private static readonly INSTANT_KILL_CHANCE = 0.1
  private eventBus: EventBus
  private witnessRadius: number

  constructor(eventBus: EventBus) {
    this.eventBus = eventBus
    this.witnessRadius = 8
  }

  public handleAttack(
    attacker: Agent,
    target: Agent,
    allAgents: Agent[]
  ): { damage: number; died: boolean; instantKill: boolean; eventId: string } {
    const demonProtected = Boolean(target.state.demon) &&
      !['knight', 'inquisitor'].includes(attacker.state.outsider?.kind ?? '')
    const instantKill = !demonProtected && target.state.alive && Math.random() < AgentInteraction.INSTANT_KILL_CHANCE
    const damage = instantKill
      ? target.state.health
      : demonProtected ? 0 : 20 + Math.floor(Math.random() * 30)
    const died = target.takeDamage(damage, attacker.state.id)
    const reaction = died || demonProtected
      ? { developedFear: false, developedGrudge: false }
      : this.maybeDevelopAttackResentment(target, attacker, damage)

    const event = this.eventBus.emit({
      type: 'attack',
      agentId: attacker.state.id,
      actionType: ActionType.ATTACK,
      targetId: target.state.id,
      outcome: died ? 'death' : demonProtected ? 'invulnerable' : 'injury',
      description: demonProtected
        ? `${attacker.state.name} attacked ${target.state.name}, but the Demon was invulnerable to the non-outsider attack.`
        : `${attacker.state.name} attacked ${target.state.name} for ${damage} damage${instantKill ? ' - LETHAL STRIKE' : died ? ' - KILLED' : ''}`,
      causationIds: this.findCausation(attacker.state.id, 'aggression'),
      worldStateDelta: {
        eventClassification: 'violent_incident',
        eventOccurred: true,
        instantKill,
        demonProtected,
        developedFear: reaction.developedFear,
        developedGrudge: reaction.developedGrudge,
        targetHealth: target.state.health,
        targetAlive: target.state.alive,
      },
      observers: [],
    })

    attacker.addRecentMemory(event)
    this.updateRelationships(attacker, target, 'hostile')
    this.notifyWitnesses(attacker.state.position, event.id, allAgents, 'attack')

    if (died) {
      this.handleDeath(target, attacker, allAgents)
    }

    return { damage, died, instantKill, eventId: event.id }
  }

  public handleConversation(
    speaker: Agent,
    listener: Agent,
    dialogue: string,
    causationIds: string[] = [],
    worldStateDelta: Record<string, unknown> = {}
  ): string {
    speaker.socialize()
    listener.socialize()

    const event = this.eventBus.emit({
      type: 'conversation',
      agentId: speaker.state.id,
      actionType: ActionType.TALK,
      targetId: listener.state.id,
      outcome: 'completed',
      description: `${speaker.state.name} said to ${listener.state.name}: "${dialogue}"`,
      causationIds,
      worldStateDelta,
      observers: [],
    })

    speaker.addRecentMemory(event)
    listener.addRecentMemory(event)
    this.updateRelationships(speaker, listener, 'friendly')

    return event.id
  }

  public handleCultSacrifice(
    sacrificer: Agent,
    victim: Agent,
    allAgents: Agent[]
  ): { eventId: string; died: boolean } {
    if (!sacrificer.state.alive || !victim.state.alive) return { eventId: '', died: false }
    const selfSacrifice = sacrificer.state.id === victim.state.id
    const damage = victim.state.health
    const died = victim.takeDamage(damage, sacrificer.state.id)
    const cultName = sacrificer.state.cult?.name ?? 'their cult'
    const event = this.eventBus.emit({
      type: 'attack',
      agentId: sacrificer.state.id,
      targetId: victim.state.id,
      actionType: ActionType.ATTACK,
      outcome: 'death',
      description: selfSacrifice
        ? `${sacrificer.state.name} sacrificed themselves for ${cultName} to regain God's attention.`
        : `${sacrificer.state.name} sacrificed fellow cult member ${victim.state.name} for ${cultName} to regain God's attention.`,
      causationIds: [],
      worldStateDelta: {
        eventClassification: 'violent_incident',
        eventOccurred: true,
        cultSacrifice: true,
        selfSacrifice,
        cultId: sacrificer.state.cult?.id,
        targetHealth: 0,
        targetAlive: false,
      },
      observers: [],
    })
    sacrificer.addRecentMemory(event)
    if (!selfSacrifice) {
      victim.addRecentMemory(event)
      this.updateRelationships(sacrificer, victim, 'hostile')
    }
    this.notifyWitnesses(sacrificer.state.position, event.id, allAgents, 'cult sacrifice')
    if (died) this.handleDeath(victim, sacrificer, allAgents)
    return { eventId: event.id, died }
  }

  public handleHelp(
    helper: Agent,
    target: Agent
  ): string {
    target.heal(15 + Math.floor(Math.random() * 10))

    const event = this.eventBus.emit({
      type: 'help',
      agentId: helper.state.id,
      actionType: ActionType.HELP,
      targetId: target.state.id,
      outcome: 'healed',
      description: `${helper.state.name} helped ${target.state.name} recover`,
      causationIds: [],
      worldStateDelta: { targetHealth: target.state.health },
      observers: [],
    })

    helper.addRecentMemory(event)
    target.addRecentMemory(event)
    this.updateRelationships(helper, target, 'friendly')

    return event.id
  }

  public handleSteal(
    thief: Agent,
    target: Agent,
    allAgents: Agent[]
  ): string {
    const stolen = this.stealItem(target)

    const event = this.eventBus.emit({
      type: 'theft',
      agentId: thief.state.id,
      actionType: ActionType.STEAL,
      targetId: target.state.id,
      outcome: stolen ? 'success' : 'empty',
      description: `${thief.state.name} stole from ${target.state.name}${stolen ? ` (${stolen.name})` : ' - nothing to take'}`,
      causationIds: [],
      worldStateDelta: {},
      observers: [],
    })

    thief.addRecentMemory(event)
    target.addRecentMemory(event)
    this.updateRelationships(thief, target, 'hostile')
    this.notifyWitnesses(thief.state.position, event.id, allAgents, 'theft')

    return event.id
  }

  public handleFlee(
    agent: Agent,
    threatId: string,
    allAgents: Agent[]
  ): void {
    const threat = allAgents.find((a) => a.state.id === threatId)
    if (!threat) return

    const dx = agent.state.position.x - threat.state.position.x
    const dy = agent.state.position.y - threat.state.position.y
    const dist = Math.sqrt(dx * dx + dy * dy) || 1

    const fleeX = Math.round(agent.state.position.x + (dx / dist) * 5)
    const fleeY = Math.round(agent.state.position.y + (dy / dist) * 5)

    agent.moveTo(
      Math.max(1, Math.min(fleeX, 60)),
      Math.max(1, Math.min(fleeY, 40))
    )

    const event = this.eventBus.emit({
      type: 'flee',
      agentId: agent.state.id,
      actionType: ActionType.FLEE,
      targetId: threatId,
      outcome: 'fleeing',
      description: `${agent.state.name} is fleeing from ${threat.state.name}`,
      causationIds: [],
      worldStateDelta: {},
      observers: [],
    })

    agent.addRecentMemory(event)
    if (!agent.state.fears.includes(threatId)) agent.state.fears.push(threatId)
  }

  private maybeDevelopAttackResentment(
    victim: Agent,
    attacker: Agent,
    damage: number
  ): { developedFear: boolean; developedGrudge: boolean } {
    const severity = Math.min(1, damage / victim.state.maxHealth)
    const fearChance = Math.max(0.1, Math.min(0.8,
      0.15 + victim.state.personality.caution * 0.35 + severity * 0.3 -
      victim.state.personality.aggression * 0.1
    ))
    const grudgeChance = Math.max(0.1, Math.min(0.8,
      0.15 + victim.state.personality.aggression * 0.4 + severity * 0.3 -
      victim.state.personality.friendliness * 0.15
    ))
    const developedFear = !victim.state.fears.includes(attacker.state.id) && Math.random() < fearChance
    const developedGrudge = !victim.state.grudges.includes(attacker.state.id) && Math.random() < grudgeChance
    if (developedFear) victim.state.fears.push(attacker.state.id)
    if (developedGrudge) victim.state.grudges.push(attacker.state.id)
    return { developedFear, developedGrudge }
  }

  public handleSuicide(
    agent: Agent,
    allAgents: Agent[]
  ): string {
    agent.state.health = 0
    agent.state.alive = false
    agent.state.path = []
    agent.state.pathIndex = 0

    const event = this.eventBus.emit({
      type: 'death',
      agentId: agent.state.id,
      actionType: ActionType.ATTACK,
      targetId: agent.state.id,
      outcome: 'death',
      description: `${agent.state.name} has committed suicide due to severe insanity.`,
      causationIds: [],
      worldStateDelta: { agentHealth: 0, agentAlive: false, suicide: true },
      observers: [],
    })

    agent.addRecentMemory(event)
    const witnessIds = this.notifyWitnesses(agent.state.position, event.id, allAgents, 'suicide')
    agent.state.lastDeath = { witnessIds: witnessIds.filter((id) => id !== agent.state.id) }
    return event.id
  }

  private handleDeath(
    deceased: Agent,
    killer: Agent,
    allAgents: Agent[]
  ): void {
    const event = this.eventBus.emit({
      type: 'death',
      agentId: deceased.state.id,
      actionType: ActionType.ATTACK,
      targetId: killer.state.id,
      outcome: 'death',
      description: `${deceased.state.name} has died, killed by ${killer.state.name}`,
      causationIds: [],
      worldStateDelta: { agentAlive: false },
      observers: [],
    })

    deceased.addRecentMemory(event)
    const witnessIds = this.notifyWitnesses(deceased.state.position, event.id, allAgents, 'death')
    deceased.state.lastDeath = { witnessIds: witnessIds.filter((id) => id !== deceased.state.id) }
    this.spreadGossip(deceased.state.id, killer.state.id, allAgents, deceased.state.position)
  }

  private updateRelationships(
    agent: Agent,
    target: Agent,
    interactionType: 'friendly' | 'hostile'
  ): void {
    let rel = agent.state.relationships.find((r) => r.agentId === target.state.id)
    if (!rel) {
      rel = {
        agentId: target.state.id,
        type: RelationshipType.NEUTRAL,
        strength: 50,
        lastInteraction: 0,
      }
      agent.state.relationships.push(rel)
    }

    let tRel = target.state.relationships.find((r) => r.agentId === agent.state.id)
    if (!tRel) {
      tRel = {
        agentId: agent.state.id,
        type: RelationshipType.NEUTRAL,
        strength: 50,
        lastInteraction: 0,
      }
      target.state.relationships.push(tRel)
    }

    rel.lastInteraction = Date.now()
    tRel.lastInteraction = Date.now()

    if (interactionType === 'friendly') {
      rel.strength = Math.min(100, rel.strength + 10)
      tRel.strength = Math.min(100, tRel.strength + 10)

      if (rel.strength > 70) rel.type = RelationshipType.FRIEND
      if (tRel.strength > 70) tRel.type = RelationshipType.FRIEND
    } else {
      rel.strength = Math.max(0, rel.strength - 20)
      tRel.strength = Math.max(0, tRel.strength - 20)

      if (rel.strength < 30) rel.type = RelationshipType.ENEMY
      if (tRel.strength < 30) tRel.type = RelationshipType.ENEMY
    }
  }

  private stealItem(target: Agent): { id: string; name: string } | null {
    if (target.state.inventory.length === 0) return null
    const idx = Math.floor(Math.random() * target.state.inventory.length)
    const item = target.state.inventory.splice(idx, 1)[0]
    return { id: item.id, name: item.name }
  }

  private notifyWitnesses(
    position: { x: number; y: number },
    eventId: string,
    allAgents: Agent[],
    eventType: string
  ): string[] {
    const witnessIds: string[] = []
    for (const agent of allAgents) {
      if (!agent.state.alive) continue
      const dx = agent.state.position.x - position.x
      const dy = agent.state.position.y - position.y
      const dist = Math.sqrt(dx * dx + dy * dy)

      if (dist <= this.witnessRadius) {
        witnessIds.push(agent.state.id)
        const event: SimulationEvent = {
          id: `witness_${eventId}_${agent.state.id}`,
          timestamp: Date.now(),
          type: `witnessed_${eventType}`,
          agentId: agent.state.id,
          actionType: ActionType.IDLE,
          outcome: 'observed',
          description: `${agent.state.name} witnessed a ${eventType}`,
          causationIds: [eventId],
          worldStateDelta: {},
          observers: [],
        }
        agent.addRecentMemory(event)
      }
    }
    return witnessIds
  }

  private spreadGossip(
    deceasedId: string,
    killerId: string,
    allAgents: Agent[],
    origin: { x: number; y: number }
  ): void {
    const deceased = allAgents.find((a) => a.state.id === deceasedId)
    const killer = allAgents.find((a) => a.state.id === killerId)
    if (!deceased || !killer) return

    const queue: Agent[] = allAgents
      .filter((a) => a.state.alive && a.state.id !== killerId)
      .filter((a) => {
        const dx = a.state.position.x - origin.x
        const dy = a.state.position.y - origin.y
        return Math.sqrt(dx * dx + dy * dy) <= this.witnessRadius
      })

    const informed = new Set<string>(queue.map((a) => a.state.id))

    for (const agent of queue) {
      const gossipEvent: SimulationEvent = {
        id: `gossip_${agent.state.id}_${deceasedId}`,
        timestamp: Date.now(),
        type: 'gossip_death',
        agentId: agent.state.id,
        actionType: ActionType.IDLE,
        outcome: 'informed',
        description: `${agent.state.name} heard that ${killer.state.name} killed ${deceased.state.name}`,
        causationIds: [],
        worldStateDelta: {},
        observers: [],
      }
      agent.addRecentMemory(gossipEvent)

      let rel = agent.state.relationships.find((r) => r.agentId === killerId)
      if (!rel) {
        rel = {
          agentId: killerId,
          type: RelationshipType.NEUTRAL,
          strength: 50,
          lastInteraction: 0,
        }
        agent.state.relationships.push(rel)
      }
      rel.strength = Math.max(0, rel.strength - 15)
      if (rel.strength < 30) rel.type = RelationshipType.ENEMY
    }
  }

  private findCausation(agentId: string, reason: string): string[] {
    const recent = this.eventBus.getRecentEvents(5)
    return recent
      .filter((e) => e.agentId === agentId)
      .map((e) => e.id)
  }
}
