import { Agent } from '@/agent/Agent'
import { World } from '@/world/World'
import { ActionType, BuildingType, SimulationEvent, TileType } from '@/types'
import { EventBus } from '@/interaction/EventBus'

export class WorldInteraction {
  private world: World
  private eventBus: EventBus

  constructor(world: World, eventBus: EventBus) {
    this.world = world
    this.eventBus = eventBus
  }

  public handleEnterBuilding(
    agent: Agent,
    buildingId: string
  ): boolean {
    const building = this.world.buildings.get(buildingId)
    if (!building) return false

    const bx = Math.round(agent.state.position.x)
    const by = Math.round(agent.state.position.y)
    const tile = this.world.getTile(bx, by)

    if (tile?.buildingId !== buildingId) {
      agent.moveTo(
        building.position.x + Math.floor(building.size.x / 2),
        building.position.y + Math.floor(building.size.y / 2)
      )
    }

    agent.state.currentBuilding = buildingId

    this.eventBus.emit({
      type: 'enter_building',
      agentId: agent.state.id,
      actionType: ActionType.MOVE,
      outcome: 'entered',
      description: `${agent.state.name} entered ${building.name}`,
      causationIds: [],
      worldStateDelta: { currentBuilding: buildingId },
      observers: [],
    })

    return true
  }

  public handleLeaveBuilding(agent: Agent): void {
    if (!agent.state.currentBuilding) return

    const building = this.world.buildings.get(agent.state.currentBuilding)
    const oldBuilding = agent.state.currentBuilding

    this.eventBus.emit({
      type: 'leave_building',
      agentId: agent.state.id,
      actionType: ActionType.MOVE,
      outcome: 'left',
      description: `${agent.state.name} left ${building?.name ?? 'a building'}`,
      causationIds: [],
      worldStateDelta: { currentBuilding: null },
      observers: [],
    })

    agent.state.currentBuilding = undefined
  }

  public handleWork(
    agent: Agent,
    allAgents: Agent[]
  ): void {
    const building = this.getCurrentBuilding(agent)
    if (!building) {
      this.moveToJobBuilding(agent)
      return
    }

    const workEffects = this.getWorkEffects(building, agent)
    workEffects(agent)

    this.eventBus.emit({
      type: 'work',
      agentId: agent.state.id,
      actionType: ActionType.WORK,
      outcome: 'worked',
      description: `${agent.state.name} is working at ${building.name}`,
      causationIds: [],
      worldStateDelta: {},
      observers: [],
    })
  }

  public handleDestroy(
    agent: Agent,
    targetId: string | null,
    allAgents: Agent[]
  ): void {
    if (targetId) {
      const building = this.world.buildings.get(targetId)
      if (building) {
        this.destroyBuilding(agent, building)
        return
      }
    }

    const currentBuilding = this.getCurrentBuilding(agent)
    if (currentBuilding) {
      this.destroyBuilding(agent, currentBuilding)
    }
  }

  public handleGather(
    agent: Agent
  ): boolean {
    const bx = Math.round(agent.state.position.x)
    const by = Math.round(agent.state.position.y)
    const tile = this.world.getTile(bx, by)

    if (tile?.type === TileType.GRASS) {
      const item = {
        id: `gathered_${Date.now()}`,
        name: 'Herbs',
        type: 'resource',
        quantity: 1 + Math.floor(Math.random() * 3),
        data: { gatheredBy: agent.state.id },
      }
      agent.state.inventory.push(item)

      this.eventBus.emit({
        type: 'gather',
        agentId: agent.state.id,
        actionType: ActionType.GATHER,
        outcome: 'gathered',
        description: `${agent.state.name} gathered herbs`,
        causationIds: [],
        worldStateDelta: { inventory: [...agent.state.inventory] },
        observers: [],
      })

      return true
    }

    return false
  }

  public handleBuild(
    agent: Agent,
    buildingType: BuildingType
  ): boolean {
    const bx = Math.round(agent.state.position.x)
    const by = Math.round(agent.state.position.y)

    if (!this.world.isWalkable(bx, by)) {
      return false
    }

    const names: Record<BuildingType, string[]> = {
      [BuildingType.HOME]: ['New Home', 'House', 'Apartment'],
      [BuildingType.SHOP]: ['New Shop', 'Store'],
      [BuildingType.TOWN_SQUARE]: ['Meeting Ground'],
      [BuildingType.RESTAURANT]: ['New Restaurant', 'Cafe'],
      [BuildingType.WORKSHOP]: ['Workshop', 'Repair Shop'],
      [BuildingType.CHURCH]: ['Community Hall', 'Office'],
      [BuildingType.PARK]: ['Garden', 'Plaza'],
    }

    const nameList = names[buildingType] ?? ['Structure']
    const name = nameList[Math.floor(Math.random() * nameList.length)]
    const size = { x: 3 + Math.floor(Math.random() * 3), y: 3 + Math.floor(Math.random() * 3) }

    const building = {
      id: `built_${Date.now()}_${agent.state.id}`,
      type: buildingType,
      position: { x: bx - Math.floor(size.x / 2), y: by - Math.floor(size.y / 2) },
      size,
      name,
      description: `Built by ${agent.state.name}`,
    }

    this.world.buildings.set(building.id, building)

    for (let dy = 0; dy < size.y; dy++) {
      for (let dx = 0; dx < size.x; dx++) {
        const tx = building.position.x + dx
        const ty = building.position.y + dy
        const tile = this.world.getTile(tx, ty)
        if (tile) {
          tile.type = TileType.BUILDING
          tile.buildingId = building.id
        }
      }
    }

    this.eventBus.emit({
      type: 'build',
      agentId: agent.state.id,
      actionType: ActionType.BUILD,
      outcome: 'built',
      description: `${agent.state.name} built ${name}`,
      causationIds: [],
      worldStateDelta: { newBuilding: building.id },
      observers: [],
    })

    return true
  }

  public getBuildingsNearAgent(
    agent: Agent,
    radius: number = 5
  ): string[] {
    const bx = Math.round(agent.state.position.x)
    const by = Math.round(agent.state.position.y)
    const nearby: string[] = []

    for (const [id, building] of this.world.buildings) {
      const dx = building.position.x - bx
      const dy = building.position.y - by
      const dist = Math.sqrt(dx * dx + dy * dy)
      if (dist <= radius) {
        nearby.push(id)
      }
    }

    return nearby
  }

  private getCurrentBuilding(
    agent: Agent
  ): import('@/types').Building | null {
    if (agent.state.currentBuilding) {
      return this.world.buildings.get(agent.state.currentBuilding) ?? null
    }

    const bx = Math.round(agent.state.position.x)
    const by = Math.round(agent.state.position.y)
    return this.world.getBuildingAt(bx, by)
  }

  private moveToJobBuilding(agent: Agent): void {
    const job = agent.state.currentJob
    if (!job) return

    const buildingTypes: Record<string, string> = {
      Teacher: 'home',
      Mechanic: 'workshop',
      'Retail Worker': 'shop',
      'Police Officer': 'town_square',
      Nurse: 'church',
      Accountant: 'church',
      Chef: 'restaurant',
      Paramedic: 'park',
    }

    const type = buildingTypes[job]
    if (!type) return

    for (const building of this.world.buildings.values()) {
      if (building.type === type) {
        agent.moveTo(
          building.position.x + Math.floor(building.size.x / 2),
          building.position.y + Math.floor(building.size.y / 2)
        )
        this.eventBus.emit({
          type: 'move_to_work',
          agentId: agent.state.id,
          actionType: ActionType.MOVE,
          outcome: 'moving',
          description: `${agent.state.name} heading to ${building.name} to work`,
          causationIds: [],
          worldStateDelta: {},
          observers: [],
        })
        return
      }
    }
  }

  private getWorkEffects(
    building: import('@/types').Building,
    agent: Agent
  ): (agent: Agent) => void {
    switch (building.type) {
      case BuildingType.HOME:
        return () => {
          agent.state.needs.energy = Math.min(100, agent.state.needs.energy + 20)
          agent.state.health = Math.min(
            agent.state.maxHealth,
            agent.state.health + 5
          )
        }

      case BuildingType.RESTAURANT:
        return () => {
          agent.state.needs.hunger = Math.min(100, agent.state.needs.hunger + 25)
          agent.state.needs.social = Math.min(100, agent.state.needs.social + 15)
        }

      case BuildingType.CHURCH:
        return () => {
          agent.state.health = Math.min(
            agent.state.maxHealth,
            agent.state.health + 10
          )
          agent.state.needs.energy = Math.min(100, agent.state.needs.energy + 10)
        }

      case BuildingType.WORKSHOP:
        return () => {
          const tool = {
            id: `tool_${Date.now()}`,
            name: 'Tool',
            type: 'tool',
            quantity: 1,
            data: { utility: 10 + Math.floor(Math.random() * 10) },
          }
          if (Math.random() > 0.5) {
            agent.state.inventory.push(tool)
          }
        }

      case BuildingType.SHOP:
        return () => {
          agent.state.needs.hunger = Math.min(100, agent.state.needs.hunger + 15)
        }

      default:
        return () => {
          agent.state.needs.energy = Math.max(
            0,
            agent.state.needs.energy - 5
          )
        }
    }
  }

  private destroyBuilding(
    agent: Agent,
    building: import('@/types').Building
  ): void {
    const buildingName = building.name

    for (let dy = 0; dy < building.size.y; dy++) {
      for (let dx = 0; dx < building.size.x; dx++) {
        const tx = building.position.x + dx
        const ty = building.position.y + dy
        const tile = this.world.getTile(tx, ty)
        if (tile) {
          tile.type = TileType.GRASS
          tile.walkable = true
          tile.buildingId = undefined
        }
      }
    }

    this.world.buildings.delete(building.id)

    this.eventBus.emit({
      type: 'destroy_building',
      agentId: agent.state.id,
      actionType: ActionType.DESTROY,
      outcome: 'destroyed',
      description: `${agent.state.name} destroyed ${buildingName}`,
      causationIds: [],
      worldStateDelta: { destroyedBuilding: building.id },
      observers: [],
    })
  }
}
