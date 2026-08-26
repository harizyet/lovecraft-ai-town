import { CameraState, Vector2 } from '@/types'

export class Camera {
  public position: Vector2
  public zoom: number
  public targetId: string | undefined
  public minZoom: number
  public maxZoom: number
  public smoothness: number

  private targetPosition: Vector2
  private targetZoom: number

  constructor(config: Partial<CameraState> = {}) {
    this.position = config.position ?? { x: 0, y: 0 }
    this.zoom = config.zoom ?? 1
    this.targetId = config.targetId
    this.minZoom = config.minZoom ?? 0.3
    this.maxZoom = config.maxZoom ?? 3
    this.smoothness = 0.08
    this.targetPosition = { ...this.position }
    this.targetZoom = this.zoom
  }

  setTarget(agentId: string | undefined): void {
    this.targetId = agentId
  }

  followPosition(position: Vector2, tileSize: number): void {
    this.targetPosition = {
      x: position.x * tileSize + tileSize / 2,
      y: position.y * tileSize + tileSize / 2,
    }
  }

  pan(dx: number, dy: number): void {
    this.targetPosition.x += dx
    this.targetPosition.y += dy
  }

  zoomIn(): void {
    this.targetZoom = Math.min(this.targetZoom * 1.2, this.maxZoom)
  }

  zoomOut(): void {
    this.targetZoom = Math.max(this.targetZoom / 1.2, this.minZoom)
  }

  update(): void {
    this.position.x += (this.targetPosition.x - this.position.x) * this.smoothness
    this.position.y += (this.targetPosition.y - this.position.y) * this.smoothness
    this.zoom += (this.targetZoom - this.zoom) * this.smoothness
  }

  worldToScreen(worldX: number, worldY: number, canvasWidth: number, canvasHeight: number): Vector2 {
    return {
      x: (worldX - this.position.x) * this.zoom + canvasWidth / 2,
      y: (worldY - this.position.y) * this.zoom + canvasHeight / 2,
    }
  }

  screenToWorld(screenX: number, screenY: number, canvasWidth: number, canvasHeight: number): Vector2 {
    return {
      x: (screenX - canvasWidth / 2) / this.zoom + this.position.x,
      y: (screenY - canvasHeight / 2) / this.zoom + this.position.y,
    }
  }
}
