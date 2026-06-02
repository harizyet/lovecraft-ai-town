import { SimulationConfig } from '@/types'
import { SimulationManager } from '@/simulation/SimulationManager'

const config: SimulationConfig = {
  tickRate: 16,
  decisionInterval: 1000,
  mapWidth: 60,
  mapHeight: 40,
  tileSize: 32,
  agentCount: 8,
  llmEndpoint: 'http://localhost:1234',
  llmModel: 'llama3',
  memoryBufferSize: 25,
  summaryInterval: 100,
}

const simulation = new SimulationManager(config)
simulation.start()

console.log('AI Town Simulation started')
console.log(`Map: ${config.mapWidth}x${config.mapHeight} tiles`)
console.log(`Agents: ${config.agentCount}`)
console.log('Controls: WASD/Arrows=move, +/-=zoom, 1-9=select agent, Space=pause, Click=select agent')
