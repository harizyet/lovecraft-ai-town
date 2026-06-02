import { SimulationEvent, ActionType, AgentState } from '@/types'

type EventCallback = (event: SimulationEvent) => void

export class EventBus {
  private events: SimulationEvent[]
  private listeners: Map<string, EventCallback[]>
  private eventCounter: number

  constructor() {
    this.events = []
    this.listeners = new Map()
    this.eventCounter = 0
  }

  public emit(event: Omit<SimulationEvent, 'id' | 'timestamp'>): SimulationEvent {
    const fullEvent: SimulationEvent = {
      ...event,
      id: `evt_${this.eventCounter++}`,
      timestamp: Date.now(),
    }

    this.events.push(fullEvent)

    const typeListeners = this.listeners.get(event.actionType) ?? []
    const allListeners = this.listeners.get('*') ?? []

    for (const cb of [...typeListeners, ...allListeners]) {
      try {
        cb(fullEvent)
      } catch (err) {
        console.error(`[EventBus] Listener error:`, err)
      }
    }

    return fullEvent
  }

  public on(actionType: ActionType | '*', callback: EventCallback): void {
    const key = actionType.toString()
    const list = this.listeners.get(key) ?? []
    list.push(callback)
    this.listeners.set(key, list)
  }

  public off(actionType: ActionType | '*', callback: EventCallback): void {
    const key = actionType.toString()
    const list = this.listeners.get(key) ?? []
    const idx = list.indexOf(callback)
    if (idx !== -1) {
      list.splice(idx, 1)
    }
  }

  public getHistory(): SimulationEvent[] {
    return [...this.events]
  }

  public getEventsByAgent(agentId: string): SimulationEvent[] {
    return this.events.filter(
      (e) => e.agentId === agentId || e.targetId === agentId
    )
  }

  public getEventsByType(actionType: ActionType): SimulationEvent[] {
    return this.events.filter((e) => e.actionType === actionType)
  }

  public getRecentEvents(count: number): SimulationEvent[] {
    return this.events.slice(-count)
  }

  public getEventsInTimeRange(start: number, end: number): SimulationEvent[] {
    return this.events.filter((e) => e.timestamp >= start && e.timestamp <= end)
  }

  public clear(): void {
    this.events = []
    this.listeners.clear()
    this.eventCounter = 0
  }

  public toJSON(): SimulationEvent[] {
    return this.events
  }
}
