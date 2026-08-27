import { Tile, TileType, Building, BuildingType, Vector2, ForbiddenRelic } from '@/types'

export class World {
  public tiles: Tile[][]
  public buildings: Map<string, Building>
  public objects: Map<string, Record<string, unknown>>
  public relics: Map<string, ForbiddenRelic>
  public width: number
  public height: number

  constructor(width: number, height: number) {
    this.width = width
    this.height = height
    this.tiles = []
    this.buildings = new Map()
    this.objects = new Map()
    this.relics = new Map()
  }

  generate(maxBuildings?: number): void {
    this.buildings.clear()
    this.initializeTiles()
    this.generateTerrain()
    this.generateRoads()
    this.placeBuildings(maxBuildings)
    this.generateTrees()
  }

  private initializeTiles(): void {
    this.tiles = []
    for (let y = 0; y < this.height; y++) {
      const row: Tile[] = []
      for (let x = 0; x < this.width; x++) {
        row.push({
          type: TileType.GRASS,
          walkable: true,
        })
      }
      this.tiles.push(row)
    }
  }

  private generateTerrain(): void {
    const waterChance = 0.03
    for (let y = 0; y < this.height; y++) {
      for (let x = 0; x < this.width; x++) {
        if (Math.random() < waterChance) {
          this.tiles[y][x] = {
            type: TileType.WATER,
            walkable: false,
          }
        }
      }
    }
    this.floodWater()
  }

  private floodWater(): void {
    const visited = new Set<string>()
    const queue: Vector2[] = []

    for (let y = 0; y < this.height; y++) {
      for (let x = 0; x < this.width; x++) {
        if (this.tiles[y][x].type === TileType.WATER) {
          queue.push({ x, y })
          visited.add(`${x},${y}`)
        }
      }
    }

    while (queue.length > 0) {
      const current = queue.shift()!
      const neighbors = [
        { x: current.x + 1, y: current.y },
        { x: current.x - 1, y: current.y },
        { x: current.x, y: current.y + 1 },
        { x: current.x, y: current.y - 1 },
      ]

      for (const neighbor of neighbors) {
        if (
          neighbor.x >= 0 &&
          neighbor.x < this.width &&
          neighbor.y >= 0 &&
          neighbor.y < this.height &&
          !visited.has(`${neighbor.x},${neighbor.y}`)
        ) {
          if (Math.random() < 0.3) {
            this.tiles[neighbor.y][neighbor.x] = {
              type: TileType.WATER,
              walkable: false,
            }
            visited.add(`${neighbor.x},${neighbor.y}`)
            queue.push(neighbor)
          }
        }
      }
    }
  }

  private generateRoads(): void {
    const centerX = Math.floor(this.width / 2)
    const centerY = Math.floor(this.height / 2)

    this.createRoad(centerX, 0, centerX, this.height - 1)
    this.createRoad(0, centerY, this.width - 1, centerY)

    const extraRoads = 2 + Math.floor(Math.random() * 2)
    for (let i = 0; i < extraRoads; i++) {
      const horizontal = Math.random() > 0.5
      if (horizontal) {
        const y = Math.floor(Math.random() * this.height)
        this.createRoad(0, y, this.width - 1, y)
      } else {
        const x = Math.floor(Math.random() * this.width)
        this.createRoad(x, 0, x, this.height - 1)
      }
    }
  }

  private createRoad(x1: number, y1: number, x2: number, y2: number): void {
    let x = x1
    let y = y1

    while (x !== x2 || y !== y2) {
      if (x >= 0 && x < this.width && y >= 0 && y < this.height) {
        this.tiles[y][x] = {
          type: TileType.ROAD,
          walkable: true,
        }
      }

      if (x < x2) x++
      else if (x > x2) x--
      else if (y < y2) y++
      else if (y > y2) y--
    }
  }

  private placeBuildings(maxBuildings?: number): void {
    const buildingTypes: BuildingType[] = [
      BuildingType.TOWN_SQUARE,
      BuildingType.CHURCH,
      BuildingType.GUARDHOUSE,
      BuildingType.APOTHECARY,
      BuildingType.FARM,
      BuildingType.HOME,
      BuildingType.TAVERN,
      BuildingType.SMITHY,
      BuildingType.MARKET,
      BuildingType.CARPENTER_WORKSHOP,
      BuildingType.MANOR,
      BuildingType.HOME,
      BuildingType.HOME,
      BuildingType.HOME,
    ]

    const roadPositions = this.findRoadPositions()

    for (const buildingType of buildingTypes) {
      if (maxBuildings !== undefined && this.buildings.size >= maxBuildings) break
      if (roadPositions.length === 0) break

      const size =
        buildingType === BuildingType.TOWN_SQUARE
          ? { w: 7, h: 7 }
          : { w: 4 + Math.floor(Math.random() * 3), h: 4 + Math.floor(Math.random() * 3) }
      const attempts = 250
      let placed = false
      for (let i = 0; i < attempts; i++) {
        const roadPos =
          roadPositions[Math.floor(Math.random() * roadPositions.length)]
        const side = Math.random() > 0.5 ? 1 : -1
        const offsetAxis = Math.random() > 0.5

        const bx = offsetAxis
          ? side > 0 ? roadPos.x + 2 : roadPos.x - size.w - 1
          : roadPos.x - Math.floor(size.w / 2)
        const by = offsetAxis
          ? roadPos.y - Math.floor(size.h / 2)
          : side > 0 ? roadPos.y + 2 : roadPos.y - size.h - 1

        if (this.canPlaceBuilding(bx, by, size.w, size.h)) {
          const building = this.createBuilding(buildingType, bx, by, size.w, size.h)
          this.buildings.set(building.id, building)
          this.markBuildingTiles(bx, by, size.w, size.h, building.id)
          placed = true
          break
        }
      }
      if (!placed) {
        const fallback = this.findNonOverlappingBuildingPosition(size.w, size.h)
        if (fallback) {
          const building = this.createBuilding(
            buildingType,
            fallback.x,
            fallback.y,
            size.w,
            size.h
          )
          this.buildings.set(building.id, building)
          this.markBuildingTiles(fallback.x, fallback.y, size.w, size.h, building.id)
        }
      }
    }
  }

  private findRoadPositions(): Vector2[] {
    const positions: Vector2[] = []
    for (let y = 0; y < this.height; y++) {
      for (let x = 0; x < this.width; x++) {
        if (this.tiles[y][x].type === TileType.ROAD) {
          positions.push({ x, y })
        }
      }
    }
    return positions
  }

  private canPlaceBuilding(
    x: number,
    y: number,
    w: number,
    h: number
  ): boolean {
    if (x < 1 || y < 1 || x + w > this.width - 1 || y + h > this.height - 1) {
      return false
    }

    const gap = 2
    for (const building of this.buildings.values()) {
      const existingX = building.position.x
      const existingY = building.position.y
      const existingW = building.size.x
      const existingH = building.size.y
      if (
        x < existingX + existingW + gap &&
        x + w + gap > existingX &&
        y < existingY + existingH + gap &&
        y + h + gap > existingY
      ) {
        return false
      }
    }

    for (let dy = 0; dy < h; dy++) {
      for (let dx = 0; dx < w; dx++) {
        const tile = this.tiles[y + dy][x + dx]
        if (
          tile.type === TileType.WATER ||
          tile.type === TileType.BRACKISH_WATER ||
          tile.type === TileType.ROAD ||
          tile.type === TileType.BUILDING ||
          tile.buildingId
        ) {
          return false
        }
      }
    }

    return true
  }

  private createBuilding(
    type: BuildingType,
    x: number,
    y: number,
    w: number,
    h: number,
    customName?: string
  ): Building {
    const names: Record<BuildingType, string[]> = {
      [BuildingType.HOME]: [
        'Timber Cottage',
        'Wattle and Daub House',
        'Stone Hearth Cottage',
        'Thatchroof Dwelling',
      ],
      [BuildingType.SHOP]: ['Village Chandler', 'General Goods Stall'],
      [BuildingType.TOWN_SQUARE]: ['Market Square'],
      [BuildingType.RESTAURANT]: ['Cookhouse', 'Alehouse Kitchen'],
      [BuildingType.WORKSHOP]: ['Artisan Workshop', 'Craft Hall'],
      [BuildingType.CHURCH]: ['Parish Church', 'Stone Chapel'],
      [BuildingType.PARK]: ['Village Green'],
      [BuildingType.SMITHY]: ['The Village Smithy', 'Ironfire Forge'],
      [BuildingType.CARPENTER_WORKSHOP]: ['Carpenter’s Workshop', 'Woodwright’s Yard'],
      [BuildingType.MARKET]: ['Covered Market', 'Merchants’ Market'],
      [BuildingType.GUARDHOUSE]: ['Town Guardhouse', 'Watch House'],
      [BuildingType.APOTHECARY]: ['Herbalist’s Apothecary', 'House of Physic'],
      [BuildingType.MANOR]: ['Steward’s Manor', 'Manor Hall'],
      [BuildingType.TAVERN]: ['The Crown and Boar', 'The Pilgrim’s Rest'],
      [BuildingType.FARM]: ['Village Farmstead', 'Common Fields Farm'],
      [BuildingType.CULT_SHRINE]: ['Hidden Shrine', 'Sacred Grove', 'Forgotten Altar'],
    }

    const descriptions: Record<BuildingType, string> = {
      [BuildingType.HOME]: 'A comfortable home for resting and sleeping.',
      [BuildingType.SHOP]: 'A shop where goods are sold.',
      [BuildingType.TOWN_SQUARE]: 'The central gathering place of the town.',
      [BuildingType.RESTAURANT]: 'A place to eat and socialize.',
      [BuildingType.WORKSHOP]: 'A workshop for repairs and crafting.',
      [BuildingType.CHURCH]: 'A community building and office.',
      [BuildingType.PARK]: 'A peaceful area with trees and open space.',
      [BuildingType.SMITHY]: 'A hot stone forge where the blacksmith shapes iron and repairs tools.',
      [BuildingType.CARPENTER_WORKSHOP]: 'A timber yard and workshop for carpentry and joinery.',
      [BuildingType.MARKET]: 'A covered market where merchants trade food, cloth, tools, and household goods.',
      [BuildingType.GUARDHOUSE]: 'The fortified post of the town guard beside the village approaches.',
      [BuildingType.APOTHECARY]: 'A healer’s shop filled with herbs, salves, and medicinal preparations.',
      [BuildingType.MANOR]: 'The manor hall where the steward administers village affairs.',
      [BuildingType.TAVERN]: 'A busy tavern offering ale, meals, lodging, and conversation.',
      [BuildingType.FARM]: 'A working farmstead with fields, livestock, and stored produce.',
      [BuildingType.CULT_SHRINE]: 'A shrine raised by a cult for its own private rites and gatherings.',
    }

    const nameList = names[type]
    const name = customName?.trim() || this.pickUnusedBuildingName(nameList)

    return {
      id: `building_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      type,
      position: { x, y },
      size: { x: w, y: h },
      name,
      description: descriptions[type],
    }
  }

  private pickUnusedBuildingName(nameList: string[]): string {
    const usedNames = new Set(Array.from(this.buildings.values()).map((b) => b.name))
    const available = nameList.filter((n) => !usedNames.has(n))
    if (available.length > 0) {
      return available[Math.floor(Math.random() * available.length)]
    }
    const base = nameList[Math.floor(Math.random() * nameList.length)]
    let suffix = 2
    let name = `${base} ${suffix}`
    while (usedNames.has(name)) {
      suffix++
      name = `${base} ${suffix}`
    }
    return name
  }

  private markBuildingTiles(
    x: number,
    y: number,
    w: number,
    h: number,
    buildingId: string
  ): void {
    for (let dy = 0; dy < h; dy++) {
      for (let dx = 0; dx < w; dx++) {
        this.tiles[y + dy][x + dx] = {
          type: TileType.BUILDING,
          walkable: true,
          buildingId,
        }
      }
    }
  }

  private generateTrees(): void {
    const treeChance = 0.02
    for (let y = 0; y < this.height; y++) {
      for (let x = 0; x < this.width; x++) {
        const tile = this.tiles[y][x]
        if (tile.type === TileType.GRASS && Math.random() < treeChance) {
          tile.type = TileType.TREE
          tile.walkable = false
        }
      }
    }
  }

  public repairBuildingOverlaps(): number {
    const savedBuildings = Array.from(this.buildings.values())
    for (const row of this.tiles) {
      for (const tile of row) {
        if (tile.type !== TileType.BUILDING && !tile.buildingId) continue
        tile.type = TileType.GRASS
        tile.walkable = true
        delete tile.buildingId
      }
    }

    this.buildings = new Map()
    let moved = 0
    for (const building of savedBuildings) {
      let x = Math.round(building.position.x)
      let y = Math.round(building.position.y)
      const w = Math.max(1, Math.round(building.size.x))
      const h = Math.max(1, Math.round(building.size.y))
      if (!this.canPlaceBuilding(x, y, w, h)) {
        const replacement = this.findNonOverlappingBuildingPosition(w, h)
        if (!replacement) continue
        x = replacement.x
        y = replacement.y
        moved++
      }
      building.position = { x, y }
      building.size = { x: w, y: h }
      this.buildings.set(building.id, building)
      this.markBuildingTiles(x, y, w, h, building.id)
    }
    return moved
  }

  private findNonOverlappingBuildingPosition(w: number, h: number): Vector2 | null {
    for (let y = 1; y <= this.height - h - 1; y++) {
      for (let x = 1; x <= this.width - w - 1; x++) {
        if (this.canPlaceBuilding(x, y, w, h)) return { x, y }
      }
    }
    return null
  }

  getTile(x: number, y: number): Tile | null {
    if (x < 0 || x >= this.width || y < 0 || y >= this.height) {
      return null
    }
    return this.tiles[y][x]
  }

  isWalkable(x: number, y: number): boolean {
    const tile = this.getTile(x, y)
    return tile?.walkable ?? false
  }

  getBuildingAt(x: number, y: number): Building | null {
    const tile = this.getTile(x, y)
    if (tile?.buildingId) {
      return this.buildings.get(tile.buildingId) ?? null
    }
    return null
  }

  public getBuildings(): Building[] {
    return Array.from(this.buildings.values())
  }

  // Places a genuinely new building at runtime (used for cult shrines),
  // searching outward from a preferred spot before falling back to any free
  // location in the world, the same placement rules world generation uses
  // (clearance, no road/water tiles).
  public tryPlaceBuilding(
    type: BuildingType,
    near: Vector2,
    w: number,
    h: number,
    options: { cultId?: string; name?: string } = {}
  ): Building | null {
    const maxRadius = 24
    let position: Vector2 | null = null
    const originX = Math.round(near.x)
    const originY = Math.round(near.y)
    search:
    for (let radius = 0; radius <= maxRadius; radius++) {
      for (let dy = -radius; dy <= radius; dy++) {
        for (let dx = -radius; dx <= radius; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== radius) continue
          const x = originX + dx
          const y = originY + dy
          if (this.canPlaceBuilding(x, y, w, h)) {
            position = { x, y }
            break search
          }
        }
      }
    }
    if (!position) position = this.findNonOverlappingBuildingPosition(w, h)
    if (!position) return null

    const building = this.createBuilding(type, position.x, position.y, w, h, options.name)
    if (options.cultId) building.cultId = options.cultId
    this.buildings.set(building.id, building)
    this.markBuildingTiles(position.x, position.y, w, h, building.id)
    return building
  }
}
