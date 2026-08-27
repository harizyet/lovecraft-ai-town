import { ActionType, BuildingType, TileType } from '@/types'
import { SystemDeps } from './SystemDeps'

type CorruptionSourceKind = 'shrine' | 'demon' | 'ritual'

interface CorruptionSource {
  kind: CorruptionSourceKind
  x: number
  y: number
  radius: number
  intensity: number
  sourceId: string
  sourceName: string
}

export interface EnvironmentState {
  // Sparse: only tiles that have ever exceeded the "touched" threshold get an
  // entry, keyed by "x,y". Mirrored onto World.tiles[y][x].corruption for
  // rendering and for free persistence via the existing world tile save/load.
  corruption: Map<string, number>
  lastTickMinute: number
  // Tiles that have already crossed the "visibly corrupted" threshold and
  // had a narrative event fired, so the same brackish well or blighted field
  // doesn't re-announce itself every tick while it stays corrupted.
  announcedTileKeys: Set<string>
  landCorruptedEverNarrated: boolean
  // Consecutive simulated minutes each tile has spent at or above
  // BLIGHT_THRESHOLD, tracked only while it's still eligible to convert
  // (GRASS/WATER, not yet blighted). Resets the instant a tile's corruption
  // dips back below the threshold -- Eldritch Blight requires *sustained*
  // exposure, not merely having once peaked high.
  sustainedHighMinutes: Map<string, number>
  // Tiles permanently converted to BLIGHTED/BRACKISH_WATER. Kept alongside
  // the type change itself (which is what actually persists, for free, via
  // World.tiles) purely so advanceCorruption can skip already-blighted tiles
  // without re-checking their tile type every minute.
  blightedTileKeys: Set<string>
  eldritchBlightEverNarrated: boolean
}

export function createEnvironmentState(): EnvironmentState {
  return {
    corruption: new Map(),
    lastTickMinute: -1,
    announcedTileKeys: new Set(),
    landCorruptedEverNarrated: false,
    sustainedHighMinutes: new Map(),
    blightedTileKeys: new Set(),
    eldritchBlightEverNarrated: false,
  }
}

const GROWTH_RATE = 0.03
const DECAY_RATE = 0.015
const REMOVE_THRESHOLD = 0.01
const VISIBLE_THRESHOLD = 0.5
const SHRINE_BASE_RADIUS = 6
const SHRINE_BASE_INTENSITY = 0.15
const SHRINE_PER_MEMBER_INTENSITY = 0.05
const SHRINE_MAX_INTENSITY = 0.65
const DEMON_RADIUS = 11
const DEMON_INTENSITY = 1
const RITUAL_RADIUS = 8
const RITUAL_INTENSITY = 0.5
const WITNESS_RADIUS = 12
// A tile must sit at or above this corruption level, continuously, for
// BLIGHT_SUSTAIN_MINUTES simulated minutes before it permanently converts.
// Set below SHRINE_MAX_INTENSITY so a large, well-established shrine can
// eventually blight its own doorstep on its own; a lone one-member shrine
// (intensity ~0.20) never can, only a demon or an active ritual reliably
// crosses it quickly.
const BLIGHT_THRESHOLD = 0.4
const BLIGHT_SUSTAIN_MINUTES = 60

function tileKey(x: number, y: number): string {
  return `${x},${y}`
}

function parseTileKey(key: string): { x: number; y: number } {
  const [x, y] = key.split(',').map(Number)
  return { x, y }
}

// Environmental Decay & Weather Corruption: cult shrines, bound demons, and
// active summoning rituals bleed a spreading, decaying corruption field into
// the world's tiles -- water turns brackish, crops blight, and a persistent
// fog settles -- giving the otherwise-static terrain a visible, localized
// consequence of the social world's own corruption. Distinct from
// SimulationManager's global weather (clear/rain/storm), which is ambient
// and untied to any in-world cause.
export class EnvironmentSystem {
  constructor(private deps: SystemDeps, public readonly state: EnvironmentState) {}

  private collectSources(): CorruptionSource[] {
    const sources: CorruptionSource[] = []

    const cultIds = new Set(
      this.deps.getAgents()
        .filter((agent) => agent.state.alive && agent.state.cult)
        .map((agent) => agent.state.cult!.id)
    )
    for (const cultId of cultIds) {
      const memberCount = this.deps.getAgents().filter(
        (agent) => agent.state.alive && agent.state.cult?.id === cultId
      ).length
      if (memberCount === 0) continue
      // A corrupted Priest's congregation never builds a separate shrine --
      // it quietly rededicates the church it already occupies (see
      // CultSystem.completeCultShrineConstruction's cult_christian_ + CHURCH
      // early-out). That building is its functional shrine, so it must
      // anchor corruption the same way a genuine CULT_SHRINE building does,
      // or a corrupted congregation would leave the world untouched.
      const anchor = this.deps.findCultShrine(cultId) ??
        (cultId.startsWith('cult_christian_')
          ? Array.from(this.deps.world.buildings.values()).find((b) => b.type === BuildingType.CHURCH)
          : undefined)
      if (!anchor) continue
      const intensity = Math.min(
        SHRINE_MAX_INTENSITY,
        SHRINE_BASE_INTENSITY + memberCount * SHRINE_PER_MEMBER_INTENSITY
      )
      sources.push({
        kind: 'shrine',
        x: anchor.position.x + anchor.size.x / 2,
        y: anchor.position.y + anchor.size.y / 2,
        radius: SHRINE_BASE_RADIUS,
        intensity,
        sourceId: anchor.id,
        sourceName: anchor.name,
      })
    }

    for (const agent of this.deps.getAgents()) {
      if (!agent.state.alive || !agent.state.demon) continue
      sources.push({
        kind: 'demon',
        x: agent.state.position.x,
        y: agent.state.position.y,
        radius: DEMON_RADIUS,
        intensity: DEMON_INTENSITY,
        sourceId: agent.state.id,
        sourceName: agent.state.name,
      })
    }

    for (const active of this.deps.activeBlocks.values()) {
      if (!active.summonSite) continue
      const leader = active.summonLeaderId
        ? this.deps.getAgents().find((agent) => agent.state.id === active.summonLeaderId)
        : undefined
      sources.push({
        kind: 'ritual',
        x: active.summonSite.x,
        y: active.summonSite.y,
        radius: RITUAL_RADIUS,
        intensity: RITUAL_INTENSITY,
        sourceId: leader?.state.id ?? 'ritual',
        sourceName: leader?.state.name ?? 'the summoning circle',
      })
    }

    return sources
  }

  // A bound Demon's manifestation is instantaneous and total: rather than
  // letting corruption crawl outward from the summoning site at the usual
  // GROWTH_RATE, this slams every tile on the map to full corruption (1.0)
  // the moment the Demon is created. Tiles outside the Demon's own
  // DEMON_RADIUS will still decay back down over time via the normal
  // advanceCorruption loop once they're no longer touched by any source --
  // this only guarantees the map-wide shock of the manifestation itself.
  public saturateWholeMap(): void {
    const world = this.deps.world
    for (let y = 0; y < world.height; y++) {
      for (let x = 0; x < world.width; x++) {
        const key = tileKey(x, y)
        this.state.corruption.set(key, 1)
        const tile = world.getTile(x, y)
        if (tile) tile.corruption = 1
      }
    }
  }

  // Advances the corruption field by one simulated minute. Cheap to call
  // every frame: it no-ops until the absolute minute actually changes, then
  // only walks the bounding boxes of active sources plus the sparse set of
  // already-corrupted tiles (never a full map scan). getAbsoluteMinute()
  // returns a continuously-advancing float (SimulationManager.updateDayNight
  // adds a fraction of a minute every frame), not an integer minute count --
  // floor it before comparing, or this guard almost never holds and every
  // GROWTH_RATE/DECAY_RATE/BLIGHT_SUSTAIN_MINUTES constant below (all tuned
  // for "once per simulated minute") instead fires on nearly every frame.
  public advanceCorruption(): void {
    const nowMinute = Math.floor(this.deps.getAbsoluteMinute())
    if (nowMinute === this.state.lastTickMinute) return
    this.state.lastTickMinute = nowMinute

    const sources = this.collectSources()
    const touched = new Set<string>()
    const world = this.deps.world

    for (const source of sources) {
      const minX = Math.max(0, Math.floor(source.x - source.radius))
      const maxX = Math.min(world.width - 1, Math.ceil(source.x + source.radius))
      const minY = Math.max(0, Math.floor(source.y - source.radius))
      const maxY = Math.min(world.height - 1, Math.ceil(source.y + source.radius))

      for (let y = minY; y <= maxY; y++) {
        for (let x = minX; x <= maxX; x++) {
          const dist = Math.hypot(x - source.x, y - source.y)
          if (dist > source.radius) continue
          const key = tileKey(x, y)
          touched.add(key)
          const target = source.intensity * (1 - dist / source.radius)
          const current = this.state.corruption.get(key) ?? 0
          if (target > current) {
            this.state.corruption.set(key, Math.min(target, current + GROWTH_RATE))
          }
        }
      }
    }

    for (const [key, value] of this.state.corruption) {
      if (touched.has(key)) continue
      const next = value - DECAY_RATE
      if (next <= REMOVE_THRESHOLD) {
        this.state.corruption.delete(key)
        this.state.announcedTileKeys.delete(key)
        this.state.sustainedHighMinutes.delete(key)
        const { x, y } = parseTileKey(key)
        const tile = world.getTile(x, y)
        // Only the transient tint/fog clears -- a tile already in
        // blightedTileKeys keeps its permanently converted type regardless.
        if (tile) delete tile.corruption
      } else {
        this.state.corruption.set(key, next)
      }
    }

    for (const [key, value] of this.state.corruption) {
      const { x, y } = parseTileKey(key)
      const tile = world.getTile(x, y)
      if (!tile) continue
      tile.corruption = value
      this.maybeAnnounce(key, x, y, value, sources)
      this.maybeBlightTerrain(key, x, y, value, tile, sources)
    }
  }

  // Eldritch Blight: a tile that has sat at or above BLIGHT_THRESHOLD for
  // BLIGHT_SUSTAIN_MINUTES straight simulated minutes permanently converts
  // -- grass into anomalous BLIGHTED ground, water into BRACKISH_WATER --
  // rather than merely carrying a transient corruption tint. Distinct from
  // maybeAnnounce's one-time "you notice something's wrong" flavor event:
  // this is the deeper, irreversible consequence of long-standing shrine or
  // demon proximity, not a first impression.
  private maybeBlightTerrain(
    key: string,
    x: number,
    y: number,
    value: number,
    tile: NonNullable<ReturnType<typeof this.deps.world.getTile>>,
    sources: CorruptionSource[]
  ): void {
    if (this.state.blightedTileKeys.has(key)) return
    if (tile.type !== TileType.GRASS && tile.type !== TileType.WATER) return

    if (value < BLIGHT_THRESHOLD) {
      this.state.sustainedHighMinutes.delete(key)
      return
    }

    const sustained = (this.state.sustainedHighMinutes.get(key) ?? 0) + 1
    if (sustained < BLIGHT_SUSTAIN_MINUTES) {
      this.state.sustainedHighMinutes.set(key, sustained)
      return
    }

    this.state.sustainedHighMinutes.delete(key)
    this.state.blightedTileKeys.add(key)
    const wasWater = tile.type === TileType.WATER
    tile.type = wasWater ? TileType.BRACKISH_WATER : TileType.BLIGHTED
    if (!wasWater) tile.walkable = true

    let nearest: CorruptionSource | undefined
    let nearestDist = Infinity
    for (const source of sources) {
      const dist = Math.hypot(source.x - x, source.y - y)
      if (dist < nearestDist) {
        nearestDist = dist
        nearest = source
      }
    }

    const description = wasWater
      ? `The water here has festered past any hope of running clear again -- permanently brackish, seeped through by whatever ${nearest?.sourceName ?? 'unholy presence'} has lingered nearby.`
      : `The ground here has stopped being ordinary grass -- it has taken on an anomalous, blighted character that will outlast whatever ${nearest?.sourceName ?? 'unholy presence'} caused it.`

    const witnesses = this.deps.getAgents().filter(
      (agent) => agent.state.alive && Math.hypot(agent.state.position.x - x, agent.state.position.y - y) <= WITNESS_RADIUS
    )

    const event = this.deps.eventBus.emit({
      type: 'eldritch_blight',
      agentId: nearest?.sourceId ?? 'world',
      actionType: ActionType.CORRUPT,
      outcome: wasWater ? 'terrain_brackish' : 'terrain_blighted',
      description,
      causationIds: [],
      worldStateDelta: { x, y, sourceKind: nearest?.kind, sourceId: nearest?.sourceId },
      observers: witnesses.map((witness) => witness.state.id),
    })
    for (const witness of witnesses) witness.addRecentMemory(event)

    if (!this.state.eldritchBlightEverNarrated) {
      this.state.eldritchBlightEverNarrated = true
      this.deps.story.queueStoryMoment('eldritch_blight', 'Eldritch Blight', description, nearest?.sourceId ?? 'world', event.id)
    }
  }

  private maybeAnnounce(key: string, x: number, y: number, value: number, sources: CorruptionSource[]): void {
    if (value < VISIBLE_THRESHOLD || this.state.announcedTileKeys.has(key)) return
    const tile = this.deps.world.getTile(x, y)
    if (!tile) return

    const building = tile.buildingId ? this.deps.world.buildings.get(tile.buildingId) : null
    let flavor: string | null = null
    if (tile.type === TileType.WATER) {
      flavor = 'has turned brackish and foul-smelling'
    } else if (building?.type === BuildingType.FARM) {
      flavor = "'s fields are blackening, the crop failing where it stands"
    }
    // Grass/road/tree/other tiles still carry the corruption value for the
    // renderer's fog overlay, but only water and farmland get a called-out
    // narrative beat -- everything else reads as ambient, spreading dread
    // rather than a discrete event.
    if (!flavor) {
      this.state.announcedTileKeys.add(key)
      return
    }

    this.state.announcedTileKeys.add(key)

    let nearest: CorruptionSource | undefined
    let nearestDist = Infinity
    for (const source of sources) {
      const dist = Math.hypot(source.x - x, source.y - y)
      if (dist < nearestDist) {
        nearestDist = dist
        nearest = source
      }
    }

    const subject = building ? building.name : 'The water'
    const description = `${subject}${flavor}, corruption seeping outward from ${nearest?.sourceName ?? 'somewhere unholy'}.`

    const witnesses = this.deps.getAgents().filter(
      (agent) => agent.state.alive && Math.hypot(agent.state.position.x - x, agent.state.position.y - y) <= WITNESS_RADIUS
    )

    const event = this.deps.eventBus.emit({
      type: 'land_corrupted',
      agentId: nearest?.sourceId ?? 'world',
      actionType: ActionType.CORRUPT,
      outcome: tile.type === TileType.WATER ? 'water_brackish' : 'crop_failed',
      description,
      causationIds: [],
      worldStateDelta: { x, y, intensity: value, sourceKind: nearest?.kind, sourceId: nearest?.sourceId },
      observers: witnesses.map((witness) => witness.state.id),
    })
    for (const witness of witnesses) witness.addRecentMemory(event)

    if (!this.state.landCorruptedEverNarrated) {
      this.state.landCorruptedEverNarrated = true
      this.deps.story.queueStoryMoment(
        'land_corrupted',
        subject,
        description,
        nearest?.sourceId ?? 'world',
        event.id
      )
    }
  }
}
