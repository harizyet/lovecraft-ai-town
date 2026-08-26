import { SimulationConfig } from '@/types'
import { SimulationManager } from '@/simulation/SimulationManager'

const config: SimulationConfig = {
  tickRate: 16,
  mapWidth: 60,
  mapHeight: 40,
  tileSize: 32,
  agentCount: 10,
  llmEndpoint: 'http://10.180.1.54:8000',
  llmModel: 'OpenVINO/Qwen2.5-1.5B-Instruct-int4-ov',
  conversationChanceMultiplier: 2,
  rumourPropagationMultiplier: 2,
  inventedRumourProbability: 0.01,
  rumourExtremeBeliefProbability: 0.2,
  memoryBufferSize: 25,
}

const simulation = new SimulationManager(config)
simulation.start()

console.log('AI Town Simulation started')
console.log(`Map: ${config.mapWidth}x${config.mapHeight} tiles`)
console.log(`Agents: ${config.agentCount}`)
console.log('Controls: WASD/Arrows=move, +/-=zoom, 1-9=select agent, Space=pause, Click=select agent')
