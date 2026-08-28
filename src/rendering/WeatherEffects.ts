import { WeatherCondition } from '@/types'

interface Cloud {
  x: number
  y: number
  width: number
  height: number
  speed: number
  opacity: number
  puffs: { dx: number; dy: number; r: number }[]
}

interface Raindrop {
  x: number
  y: number
  length: number
  speed: number
  opacity: number
}

const CLOUD_COLOR_LIGHT = '235, 235, 240'
const CLOUD_COLOR_STORM = '40, 42, 50'
// Margin (world px) clouds drift past the map edge before wrapping back
// around, so they don't visibly pop in/out at the boundary.
const CLOUD_WRAP_MARGIN = 200

// Clouds are anchored to the map (world-space, drawn inside the camera
// transform) so they pan and zoom with the town like any other world layer.
// Rain and lightning stay screen-space (drawn after the camera pass and the
// day-night tint, below the HUD) since they read as atmosphere over the
// viewport rather than a fixed feature of the map. Timed with wall-clock
// deltas rather than sim time so drift speed and rainfall look natural
// regardless of simulation speedMultiplier.
export class WeatherEffects {
  private canvas: HTMLCanvasElement
  private worldWidthPx: number
  private worldHeightPx: number
  private clouds: Cloud[] = []
  private raindrops: Raindrop[] = []
  private lastFrameTime = performance.now()
  private currentCondition: WeatherCondition | null = null

  private lightningFlashAlpha = 0
  private lightningBolt: { x: number; y: number }[] | null = null
  private lightningBoltLife = 0
  private timeUntilNextLightning = this.randomLightningInterval()

  constructor(canvas: HTMLCanvasElement, worldWidthPx: number, worldHeightPx: number) {
    this.canvas = canvas
    this.worldWidthPx = worldWidthPx
    this.worldHeightPx = worldHeightPx
  }

  update(condition: WeatherCondition): void {
    const now = performance.now()
    const dt = Math.min(now - this.lastFrameTime, 100)
    this.lastFrameTime = now

    if (condition !== this.currentCondition) {
      this.currentCondition = condition
      this.initClouds(condition)
      this.raindrops = []
      this.lightningFlashAlpha = 0
      this.lightningBolt = null
    }

    this.updateClouds(dt)

    if (condition === 'rain' || condition === 'storm') {
      this.updateRain(dt, condition)
    } else if (this.raindrops.length > 0) {
      this.raindrops = []
    }

    if (condition === 'storm') {
      this.updateLightning(dt)
    } else if (this.lightningFlashAlpha > 0 || this.lightningBolt) {
      this.lightningFlashAlpha = 0
      this.lightningBolt = null
    }
  }

  // World-space: call inside the camera transform so clouds pan/zoom with the map.
  renderClouds(ctx: CanvasRenderingContext2D): void {
    for (const cloud of this.clouds) {
      const color = this.currentCondition === 'rain' || this.currentCondition === 'storm'
        ? CLOUD_COLOR_STORM
        : CLOUD_COLOR_LIGHT
      ctx.fillStyle = `rgba(${color}, ${cloud.opacity})`
      ctx.beginPath()
      for (const puff of cloud.puffs) {
        ctx.moveTo(cloud.x + puff.dx + puff.r, cloud.y + puff.dy)
        ctx.arc(cloud.x + puff.dx, cloud.y + puff.dy, puff.r, 0, Math.PI * 2)
      }
      ctx.fill()
    }
  }

  // Screen-space: call outside the camera transform, after the day-night overlay.
  renderPrecipitation(ctx: CanvasRenderingContext2D, condition: WeatherCondition): void {
    if (condition === 'rain' || condition === 'storm') this.renderRain(ctx)
    if (condition === 'storm') this.renderLightning(ctx)
  }

  private initClouds(condition: WeatherCondition): void {
    const counts: Record<WeatherCondition, number> = {
      clear: 4,
      cloudy: 9,
      rain: 11,
      storm: 13,
    }
    const count = counts[condition]
    // Lay clouds out in evenly spaced slots across the map's width (with a
    // little jitter so it doesn't look like a grid) rather than placing each
    // independently at random, which tends to bunch several into the same
    // stretch of sky and leave others empty.
    const span = this.worldWidthPx + CLOUD_WRAP_MARGIN * 2
    const slot = span / count
    this.clouds = Array.from({ length: count }, (_, i) => {
      const cloud = this.makeCloud(condition)
      cloud.x = -CLOUD_WRAP_MARGIN + slot * i + (Math.random() - 0.5) * slot * 0.7
      return cloud
    })
  }

  private makeCloud(condition: WeatherCondition): Cloud {
    const dark = condition === 'rain' || condition === 'storm'
    const height = 40 + Math.random() * 50
    const cloudWidth = 120 + Math.random() * 160
    const puffCount = 4 + Math.floor(Math.random() * 3)
    const puffs = Array.from({ length: puffCount }, (_, i) => ({
      dx: (i / (puffCount - 1) - 0.5) * cloudWidth * 0.8,
      dy: (Math.random() - 0.5) * height * 0.4,
      r: height * (0.35 + Math.random() * 0.35),
    }))

    return {
      x: 0,
      y: 20 + Math.random() * (this.worldHeightPx * 0.35),
      width: cloudWidth,
      height,
      speed: (dark ? 18 : 8) + Math.random() * (dark ? 16 : 10),
      opacity: dark
        ? 0.55 + Math.random() * 0.3
        : condition === 'cloudy'
          ? 0.35 + Math.random() * 0.25
          : 0.2 + Math.random() * 0.2,
      puffs,
    }
  }

  private updateClouds(dtMs: number): void {
    if (!this.currentCondition) return
    const dtSec = dtMs / 1000
    const span = this.worldWidthPx + CLOUD_WRAP_MARGIN * 2
    for (const cloud of this.clouds) {
      cloud.x += cloud.speed * dtSec
      // Wrap in place (rather than respawning at a single fixed point) so
      // clouds stay spread across the map instead of funneling back through
      // the same spot on the left edge.
      if (cloud.x - cloud.width / 2 > this.worldWidthPx + CLOUD_WRAP_MARGIN) {
        cloud.x -= span
      }
    }
  }

  private updateRain(dtMs: number, condition: WeatherCondition): void {
    const targetCount = condition === 'storm' ? 220 : 110
    while (this.raindrops.length < targetCount) {
      this.raindrops.push(this.makeRaindrop(condition))
    }
    if (this.raindrops.length > targetCount) {
      this.raindrops.length = targetCount
    }

    const dtSec = dtMs / 1000
    for (const drop of this.raindrops) {
      drop.y += drop.speed * dtSec
      drop.x += drop.speed * 0.15 * dtSec
      if (drop.y > this.canvas.height) {
        const fresh = this.makeRaindrop(condition)
        drop.x = fresh.x
        drop.y = -drop.length
        drop.speed = fresh.speed
        drop.length = fresh.length
        drop.opacity = fresh.opacity
      }
    }
  }

  private makeRaindrop(condition: WeatherCondition): Raindrop {
    const storm = condition === 'storm'
    return {
      x: Math.random() * (this.canvas.width + 200) - 100,
      y: Math.random() * this.canvas.height,
      length: storm ? 18 + Math.random() * 12 : 10 + Math.random() * 8,
      speed: storm ? 900 + Math.random() * 400 : 500 + Math.random() * 250,
      opacity: storm ? 0.4 + Math.random() * 0.3 : 0.25 + Math.random() * 0.25,
    }
  }

  private renderRain(ctx: CanvasRenderingContext2D): void {
    ctx.lineCap = 'round'
    for (const drop of this.raindrops) {
      ctx.strokeStyle = `rgba(180, 200, 230, ${drop.opacity})`
      ctx.lineWidth = 1.5
      ctx.beginPath()
      ctx.moveTo(drop.x, drop.y)
      ctx.lineTo(drop.x + drop.length * 0.15, drop.y + drop.length)
      ctx.stroke()
    }
  }

  private randomLightningInterval(): number {
    return 3000 + Math.random() * 7000
  }

  private updateLightning(dtMs: number): void {
    if (this.lightningFlashAlpha > 0) {
      this.lightningFlashAlpha = Math.max(0, this.lightningFlashAlpha - dtMs * 0.004)
    }
    if (this.lightningBolt) {
      this.lightningBoltLife -= dtMs
      if (this.lightningBoltLife <= 0) this.lightningBolt = null
    }

    this.timeUntilNextLightning -= dtMs
    if (this.timeUntilNextLightning <= 0) {
      this.timeUntilNextLightning = this.randomLightningInterval()
      this.strikeLightning()
    }
  }

  private strikeLightning(): void {
    this.lightningFlashAlpha = 0.55 + Math.random() * 0.25
    this.lightningBoltLife = 120 + Math.random() * 80

    const startX = Math.random() * this.canvas.width
    const endY = this.canvas.height * (0.4 + Math.random() * 0.3)
    const segments = 7
    const points: { x: number; y: number }[] = [{ x: startX, y: 0 }]
    for (let i = 1; i <= segments; i++) {
      const y = (endY / segments) * i
      const x = startX + (Math.random() - 0.5) * 60
      points.push({ x, y })
    }
    this.lightningBolt = points
  }

  private renderLightning(ctx: CanvasRenderingContext2D): void {
    if (this.lightningFlashAlpha > 0) {
      ctx.fillStyle = `rgba(220, 230, 255, ${this.lightningFlashAlpha})`
      ctx.fillRect(0, 0, this.canvas.width, this.canvas.height)
    }

    if (this.lightningBolt) {
      ctx.save()
      ctx.strokeStyle = 'rgba(230, 240, 255, 0.95)'
      ctx.lineWidth = 3
      ctx.shadowColor = 'rgba(180, 200, 255, 0.9)'
      ctx.shadowBlur = 12
      ctx.beginPath()
      ctx.moveTo(this.lightningBolt[0].x, this.lightningBolt[0].y)
      for (const point of this.lightningBolt.slice(1)) {
        ctx.lineTo(point.x, point.y)
      }
      ctx.stroke()
      ctx.restore()
    }
  }
}
