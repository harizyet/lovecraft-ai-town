# AI Town Simulation

![AITown](ai-town.png)

> ## ⚠️ WARNING: DO NOT USE WITH PAID LLM SERVICES ⚠️
>
> This project makes an LLM API call **every ~1 second per agent**. With 8 agents (the default), that's **~690,000 API calls per day**. Pointing this at any paid LLM service (OpenAI, Anthropic, Google, etc.) will rack up a significant bill very quickly. **Only use with a local, free LLM** such as LM Studio or Ollama.

A 2D simulated town where LLM-powered AI agents live, interact, make decisions, and cause real-world consequences. Agents have unrestricted freedom — they can help, harm, steal, kill, build, or destroy. All actions are logged with full causation chains.

## Features

- **Procedural world generation** — 60x40 tile map with roads, water clusters, trees, and 8 buildings
- **LLM-driven agents** — Each agent has personality, needs, memory, relationships, and autonomy
- **Full interaction system** — Attack, steal, help, flee, converse, build, destroy, gather, work
- **Death & consequences** — Agents die, bodies remain, witnesses react, gossip spreads, reputations shift
- **Day/night cycle** — Smooth transitions with visual overlay
- **Debug overlay** — F1 to toggle event log, agent states, world stats
- **Log export** — Download full event history as JSON or CSV
- **Zero runtime dependencies** — Pure TypeScript, Canvas API, custom A* pathfinding

## Quick Start

### Prerequisites

1. **Local LLM server** running on `localhost:1234` (LM Studio recommended, OpenAI-compatible API)
2. **Node.js 18+**

### Setup

```bash
npm install
npm run dev
```

Open the local Vite URL in your browser. The simulation starts immediately with 8 agents in a procedurally generated town.

### Configuration

Edit `src/main.ts` to change settings:

| Setting | Default | Description |
|---------|---------|-------------|
| `llmEndpoint` | `http://localhost:1234` | LLM server URL |
| `llmModel` | `llama3` | Model name |
| `agentCount` | `8` | Number of agents |
| `mapWidth` / `mapHeight` | `60` / `40` | Tile grid size |
| `tickRate` | `16` | ms per frame (~60 FPS) |
| `decisionInterval` | `1000` | ms between LLM decision calls |
| `memoryBufferSize` | `25` | Events kept in recent memory |

## Controls

| Key | Action |
|-----|--------|
| WASD / Arrows | Pan camera |
| + / - | Zoom in / out |
| 1-9 | Follow agent by index |
| Space | Pause / resume |
| F1 | Toggle debug overlay |
| Click | Select agent |

## Architecture

```
SimulationManager (game loop)
  ├── World (tile grid, buildings, procedural generation)
  ├── AgentManager (agent orchestration + LLM decisions)
  │     ├── Agent (state, movement, memory, personality)
  │     ├── AIProvider (LLM HTTP client)
  │     ├── AgentInteraction (attack, steal, help, conversation)
  │     ├── WorldInteraction (build, destroy, work, gather)
  │     └── AStarPathfinder (navigation)
  ├── Renderer (Canvas 2D)
  ├── Camera (pan/zoom/follow)
  ├── DebugOverlay (F1 panel)
  └── EventBus (event pub/sub)
```

See [AGENTS.md](./AGENTS.md) for detailed technical documentation.

## Tech Stack

- TypeScript 6.0 + Vite 8
- Canvas API (no graphics library)
- LM Studio / OpenAI-compatible API
- Custom A* pathfinding
