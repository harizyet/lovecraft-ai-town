import { Agent } from '@/agent/Agent'
import { ActionType, AgentAction, BuildingType } from '@/types'
import { SystemDeps } from './SystemDeps'

export interface OutsiderState {
  knightOutsiderSpawned: boolean
  inquisitorOutsiderSpawned: boolean
}

export function createOutsiderState(): OutsiderState {
  return {
    knightOutsiderSpawned: false,
    inquisitorOutsiderSpawned: false,
  }
}

export class OutsiderSystem {
  constructor(private deps: SystemDeps, public readonly state: OutsiderState) {}

  maybeCreateKnightOutsider(): void {
    if (this.state.knightOutsiderSpawned) return
    const deathIds = new Set(
      this.deps.eventBus.getHistory()
        .filter((event) => event.type === 'death' || event.outcome === 'death')
        .map((event) => event.type === 'death' ? event.agentId : event.targetId)
        .filter((agentId): agentId is string => Boolean(agentId))
    )
    for (const agent of this.deps.getAgents()) {
      if (!agent.state.alive && !agent.state.exiled) deathIds.add(agent.state.id)
    }
    if (this.deps.getAgents().length === 0 || deathIds.size < this.deps.getAgents().length * 0.5) return
    this.createOutsider('knight')
  }

  canPriestCallInquisitor(priest: Agent): boolean {
    if (this.state.inquisitorOutsiderSpawned || priest.state.currentJob !== 'Priest' || !priest.state.alive) return false
    const confirmedCultists = new Set(
      (priest.state.secretAffiliationKnowledge ?? [])
        .filter((entry) => entry.affiliation === 'cult')
        .map((entry) => entry.agentId)
    )
    return confirmedCultists.size >= 2
  }

  createOutsider(kind: 'knight' | 'inquisitor', caller?: Agent): Agent | undefined {
    if (kind === 'knight' ? this.state.knightOutsiderSpawned : this.state.inquisitorOutsiderSpawned) return undefined
    const baseName = kind === 'knight' ? 'Sir Aldric Vale' : 'Inquisitor Severin Grey'
    let name = baseName
    let suffix = 2
    while (this.deps.getAgents().some((agent) => agent.state.name === name)) name = `${baseName} ${suffix++}`
    const id = `outsider_${kind}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
    const outsider = new Agent(
      id,
      name,
      this.deps.world,
      this.deps.simManager,
      kind === 'knight' ? 'Knight' : 'Inquisitor'
    )
    outsider.state.outsider = {
      kind,
      enteredAtMinute: this.deps.getAbsoluteMinute(),
      calledByAgentId: caller?.state.id,
    }
    if (kind === 'inquisitor') {
      outsider.state.beliefSystem.religiousStance = 'believer'
      outsider.state.beliefSystem.faith = Math.max(80, outsider.state.beliefSystem.faith)
      outsider.state.beliefSystem.deities = [{ name: 'God', confidence: 90, revelationCount: 0 }]
      outsider.state.knownCultGroups = (caller?.state.knownCultGroups ?? []).map((cult) => ({ ...cult }))
      outsider.state.secretAffiliationKnowledge = (caller?.state.secretAffiliationKnowledge ?? [])
        .filter((entry) => entry.affiliation === 'cult')
        .map((entry) => ({ ...entry }))
    }
    outsider.state.position = this.deps.findTownEntrance()
    this.deps.getAgents().push(outsider)
    this.deps.simManager.addAgent(outsider.state)
    this.deps.llmRequestStatuses.set(outsider.state.id, 'pending')
    if (kind === 'knight') this.state.knightOutsiderSpawned = true
    else this.state.inquisitorOutsiderSpawned = true

    const destination = Array.from(this.deps.world.buildings.values()).find((building) =>
      building.type === (kind === 'knight' ? BuildingType.GUARDHOUSE : BuildingType.CHURCH)
    ) ?? Array.from(this.deps.world.buildings.values()).find((building) => building.type === BuildingType.TOWN_SQUARE)
    if (destination) {
      outsider.moveTo(
        Math.round(destination.position.x + destination.size.x / 2),
        Math.round(destination.position.y + destination.size.y / 2)
      )
    }

    const witnesses = this.deps.getAgents().filter((agent) => agent.state.alive)
    const event = this.deps.eventBus.emit({
      type: 'outsider_arrival',
      agentId: outsider.state.id,
      targetId: caller?.state.id,
      actionType: ActionType.MOVE,
      outcome: `${kind}_arrived`,
      description: kind === 'knight'
        ? `${outsider.state.name}, a Knight from beyond the village, entered town to investigate the cause of the recent deaths after word spread.`
        : `${outsider.state.name}, an Inquisitor, entered town to investigate suspected cult activity after ${caller?.state.name ?? 'a Priest'} confirmed multiple cultists and called for aid.`,
      causationIds: [],
      worldStateDelta: {
        outsiderKind: kind,
        outsiderId: outsider.state.id,
        calledByAgentId: caller?.state.id,
      },
      observers: witnesses.map((agent) => agent.state.id),
    })
    for (const witness of witnesses) witness.addRecentMemory(event)
    this.deps.story.queueStoryMoment(
      kind === 'knight' ? 'knight_called' : 'inquisitor_called',
      outsider.state.name,
      event.description,
      outsider.state.id,
      event.id
    )
    return outsider
  }

  updateKnightPatrolAndCombat(agent: Agent): void {
    if (!agent.state.alive) return

    // 1. Check for visible demons (distance <= 8)
    const demon = this.deps.getAgents().find(
      (a) => a.state.alive && a.state.demon && agent.distanceTo(a.state) <= 8
    )

    if (demon) {
      // If we see a demon, engage in combat!
      const active = this.deps.activeBlocks.get(agent.state.id)
      const distance = agent.distanceTo(demon.state)

      if (distance <= 4) {
        // Attack range!
        if (active?.action.action !== 'attack' || active.action.target !== demon.state.name) {
          // Cancel any active path/conversation
          agent.state.path = []
          agent.state.pathIndex = 0
          const partnerId = agent.getConversationPartnerId()
          if (partnerId) {
            const partner = this.deps.getAgents().find((a) => a.state.id === partnerId)
            if (partner) this.deps.conversationManager.closeConversation(agent, partner)
          }

          // Start attack block
          const action: AgentAction = {
            action: 'attack',
            target: demon.state.name,
            reasoning: `Entity sighted! Confronting the Entity ${demon.state.name}, though no mortal weapon can end it.`,
            emotionalState: 'determined',
            durationMinutes: 1,
          }
          this.deps.startBlock(agent, action, [], undefined, false)

          // Perform actual attack
          this.deps.agentInteraction.handleAttack(agent, demon, this.deps.getAgents())
        } else {
          // If the attack block is active, check if it's due to hit again
          const now = this.deps.getAbsoluteMinute()
          if (now >= active.endsAt) {
            // Hit again!
            this.deps.agentInteraction.handleAttack(agent, demon, this.deps.getAgents())
            // Reset block duration
            active.endsAt = now + 1
          }
        }
      } else {
        // Move towards demon
        if (active?.action.action !== 'move' || active.action.target !== demon.state.name) {
          // Close conversation if any
          const partnerId = agent.getConversationPartnerId()
          if (partnerId) {
            const partner = this.deps.getAgents().find((a) => a.state.id === partnerId)
            if (partner) this.deps.conversationManager.closeConversation(agent, partner)
          }
          agent.moveTo(Math.round(demon.state.position.x), Math.round(demon.state.position.y))
          const action: AgentAction = {
            action: 'move',
            target: demon.state.name,
            reasoning: `Approaching the Entity ${demon.state.name} to engage in combat.`,
            emotionalState: 'determined',
            durationMinutes: 5,
          }
          this.deps.startBlock(agent, action, [], undefined, false)
        }
      }
      return
    }

    // 2. If no demon, pursue any open lead on the cause of death that
    // brought the Knight to town in the first place. Only fall back to
    // aimless building patrol once there is nothing left to investigate.
    const activeInvestigation = this.deps.activeBlocks.get(agent.state.id)
    if (activeInvestigation?.action.action === 'investigate' && activeInvestigation.rumourId) {
      return
    }

    const lead = [...this.deps.rumours.values()]
      .reverse()
      .find((rumour) =>
        this.deps.isRumourUnresolved(rumour.id) &&
        this.deps.isAgentUndecidedAboutRumour(agent.state.id, rumour.id) &&
        this.deps.getInvestigationAuthority(agent, rumour) !== null
      )

    if (lead) {
      const partnerId = agent.getConversationPartnerId()
      if (partnerId) {
        const partner = this.deps.getAgents().find((a) => a.state.id === partnerId)
        if (partner) this.deps.conversationManager.closeConversation(agent, partner)
      }

      const action: AgentAction = {
        action: 'investigate',
        target: null,
        reasoning: `Investigating the cause of death behind: ${lead.text}`,
        emotionalState: 'determined',
        durationMinutes: 30,
      }
      const authority = this.deps.getInvestigationAuthority(agent, lead) ?? 'criminal investigation into the cause of death'
      this.deps.prepareInvestigationDecision(agent, action, lead, authority)
      this.deps.startBlock(agent, action, [], lead.id, false)
      return
    }

    // 3. No demon, no open lead -- patrol town buildings for anything new
    // Initialize patrol state if not present
    if (!agent.state.knightPatrol) {
      agent.state.knightPatrol = {
        visitedBuildingIds: [],
      }
    }

    const patrol = agent.state.knightPatrol
    const buildings = Array.from(this.deps.world.buildings.values()).sort((a, b) => a.id.localeCompare(b.id))
    if (buildings.length === 0) return

    // If all buildings visited, reset the patrol cycle
    if (patrol.visitedBuildingIds.length >= buildings.length) {
      patrol.visitedBuildingIds = []
    }

    // Find the next building to patrol
    let nextBuilding = buildings.find((b) => !patrol.visitedBuildingIds.includes(b.id))
    if (!nextBuilding) {
      // Fallback
      nextBuilding = buildings[0]
    }

    patrol.currentBuildingId = nextBuilding.id

    const active = this.deps.activeBlocks.get(agent.state.id)
    const targetX = Math.round(nextBuilding.position.x + nextBuilding.size.x / 2)
    const targetY = Math.round(nextBuilding.position.y + nextBuilding.size.y / 2)

    // Calculate distance to the building center
    const dx = agent.state.position.x - targetX
    const dy = agent.state.position.y - targetY
    const distToBuilding = Math.sqrt(dx * dx + dy * dy)

    if (distToBuilding <= 1.5) {
      // Arrived! Start investigation if we are not already investigating it
      if (active?.action.action !== 'investigate' || active.action.target !== nextBuilding.name) {
        // Stop movement
        agent.state.path = []
        agent.state.pathIndex = 0

        const action: AgentAction = {
          action: 'investigate',
          target: nextBuilding.name,
          reasoning: `Canvassing ${nextBuilding.name} for leads on the cause of death.`,
          emotionalState: 'determined',
          durationMinutes: 10,
        }
        this.deps.startBlock(agent, action, [], undefined, false)
      } else {
        // If investigation block is finished (or when it completes in completeFinishedBlocks),
        // we add this building to visitedBuildingIds.
        const now = this.deps.getAbsoluteMinute()
        if (now >= active.endsAt) {
          if (!patrol.visitedBuildingIds.includes(nextBuilding.id)) {
            patrol.visitedBuildingIds.push(nextBuilding.id)
          }
          this.deps.activeBlocks.delete(agent.state.id)
        }
      }
    } else {
      // Move to building
      if (active?.action.action !== 'move' || active.action.target !== nextBuilding.name) {
        agent.moveTo(targetX, targetY)
        const action: AgentAction = {
          action: 'move',
          target: nextBuilding.name,
          reasoning: `Patrolling towards ${nextBuilding.name}.`,
          emotionalState: 'neutral',
          durationMinutes: 10,
        }
        this.deps.startBlock(agent, action, [], undefined, false)
      } else {
        // If they get stuck or path is empty but they haven't arrived, recalculate path
        if (agent.state.path.length === 0 || agent.state.pathIndex >= agent.state.path.length) {
          agent.moveTo(targetX, targetY)
        }
      }
    }
  }
}
