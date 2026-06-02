import { Vector2 } from '@/types'
import { World } from '@/world/World'

interface Node {
  x: number
  y: number
  g: number
  h: number
  f: number
  parent: Node | null
}

export class AStarPathfinder {
  private world: World

  constructor(world: World) {
    this.world = world
  }

  findPath(start: Vector2, end: Vector2): Vector2[] {
    const startNode = this.createNode(start.x, start.y, null)
    const endNode = this.createNode(end.x, end.y, null)

    const openSet = [startNode]
    const closedSet = new Set<string>()

    while (openSet.length > 0) {
      openSet.sort((a, b) => a.f - b.f)
      const current = openSet.shift()!

      if (current.x === endNode.x && current.y === endNode.y) {
        return this.reconstructPath(current)
      }

      closedSet.add(`${current.x},${current.y}`)

      const neighbors = this.getNeighbors(current)
      for (const neighbor of neighbors) {
        if (closedSet.has(`${neighbor.x},${neighbor.y}`)) {
          continue
        }

        const tentativeG = current.g + this.getDistance(current, neighbor)

        const existing = openSet.find(
          (n) => n.x === neighbor.x && n.y === neighbor.y
        )

        if (!existing) {
          neighbor.g = tentativeG
          neighbor.h = this.heuristic(neighbor, endNode)
          neighbor.f = neighbor.g + neighbor.h
          neighbor.parent = current
          openSet.push(neighbor)
        } else if (tentativeG < existing.g) {
          existing.g = tentativeG
          existing.f = existing.g + existing.h
          existing.parent = current
        }
      }
    }

    return []
  }

  private createNode(x: number, y: number, parent: Node | null): Node {
    return {
      x,
      y,
      g: 0,
      h: 0,
      f: 0,
      parent,
    }
  }

  private getNeighbors(node: Node): Node[] {
    const directions = [
      { x: 0, y: -1 },
      { x: 1, y: 0 },
      { x: 0, y: 1 },
      { x: -1, y: 0 },
    ]

    const neighbors: Node[] = []
    for (const dir of directions) {
      const nx = node.x + dir.x
      const ny = node.y + dir.y

      if (this.world.isWalkable(nx, ny)) {
        neighbors.push(this.createNode(nx, ny, null))
      }
    }

    return neighbors
  }

  private getDistance(a: Node, b: Node): number {
    return Math.abs(a.x - b.x) + Math.abs(a.y - b.y)
  }

  private heuristic(a: Node, b: Node): number {
    return Math.abs(a.x - b.x) + Math.abs(a.y - b.y)
  }

  private reconstructPath(node: Node): Vector2[] {
    const path: Vector2[] = []
    let current: Node | null = node

    while (current) {
      path.unshift({ x: current.x, y: current.y })
      current = current.parent
    }

    return path
  }
}
