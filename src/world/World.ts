import { Tile, TileType, Building, BuildingType, Vector2 } from '@/types'

export class World {
  public tiles: Tile[][]
  public buildings: Map<string, Building>
  public objects: Map<string, Record<string, unknown>>
  public width: number
  public height: number

  constructor(width: number, height: number) {
    this.width = width
    this.height = height
    this.tiles = []
    this.buildings = new Map()
    this.objects = new Map()
  }

  generate(): void {
    this.initializeTiles()
    this.generateTerrain()
    this.generateRoads()
    this.placeBuildings()
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

  private placeBuildings(): void {
    const buildingTypes: BuildingType[] = [
      BuildingType.HOME,
      BuildingType.HOME,
      BuildingType.HOME,
      BuildingType.SHOP,
      BuildingType.TOWN_SQUARE,
      BuildingType.RESTAURANT,
      BuildingType.WORKSHOP,
      BuildingType.CHURCH,
    ]

    const roadPositions = this.findRoadPositions()
    const placedBuildings: Vector2[] = []

    for (const buildingType of buildingTypes) {
      if (roadPositions.length === 0) break

      const attempts = 50
      for (let i = 0; i < attempts; i++) {
        const roadPos =
          roadPositions[Math.floor(Math.random() * roadPositions.length)]
        const side = Math.random() > 0.5 ? 1 : -1
        const offsetAxis = Math.random() > 0.5

        let bx = offsetAxis ? roadPos.x + side * 2 : roadPos.x
        let by = offsetAxis ? roadPos.y : roadPos.y + side * 2

        const size =
          buildingType === BuildingType.TOWN_SQUARE
            ? { w: 7, h: 7 }
            : { w: 4 + Math.floor(Math.random() * 3), h: 4 + Math.floor(Math.random() * 3) }

        if (this.canPlaceBuilding(bx, by, size.w, size.h, placedBuildings)) {
          const building = this.createBuilding(buildingType, bx, by, size.w, size.h)
          this.buildings.set(building.id, building)
          this.markBuildingTiles(bx, by, size.w, size.h, building.id)
          placedBuildings.push({ x: bx, y: by })
          break
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
    h: number,
    placed: Vector2[]
  ): boolean {
    if (x < 1 || y < 1 || x + w > this.width - 1 || y + h > this.height - 1) {
      return false
    }

    for (const px of placed) {
      if (
        Math.abs(x - px.x) < w + 2 &&
        Math.abs(y - px.y) < h + 2
      ) {
        return false
      }
    }

    for (let dy = 0; dy < h; dy++) {
      for (let dx = 0; dx < w; dx++) {
        const tile = this.tiles[y + dy][x + dx]
        if (tile.type === TileType.WATER) {
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
    h: number
  ): Building {
    const names: Record<BuildingType, string[]> = {
      [BuildingType.HOME]: [
        'Maple Street House',
        'Oak Avenue Home',
        'Pine Ridge House',
        'Elm Street Apartment',
        'Cedar Lane House',
        'Willow Drive Home',
        'Birch Court House',
      ],
      [BuildingType.SHOP]: ['Corner Store', 'Downtown Market', 'Plaza Shop', 'Main Street Store'],
      [BuildingType.TOWN_SQUARE]: ['Town Square'],
      [BuildingType.RESTAURANT]: ['The Local Diner', 'Main Street Grill', 'Corner Cafe'],
      [BuildingType.WORKSHOP]: ['Auto Repair Shop', 'Tool & Equipment'],
      [BuildingType.CHURCH]: ['Community Center', 'City Hall'],
      [BuildingType.PARK]: ['Central Park'],
    }

    const descriptions: Record<BuildingType, string> = {
      [BuildingType.HOME]: 'A comfortable home for resting and sleeping.',
      [BuildingType.SHOP]: 'A shop where goods are sold.',
      [BuildingType.TOWN_SQUARE]: 'The central gathering place of the town.',
      [BuildingType.RESTAURANT]: 'A place to eat and socialize.',
      [BuildingType.WORKSHOP]: 'A workshop for repairs and crafting.',
      [BuildingType.CHURCH]: 'A community building and office.',
      [BuildingType.PARK]: 'A peaceful area with trees and open space.',
    }

    const nameList = names[type]
    const name = nameList[Math.floor(Math.random() * nameList.length)]

    return {
      id: `building_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      type,
      position: { x, y },
      size: { x: w, y: h },
      name,
      description: descriptions[type],
    }
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
}
