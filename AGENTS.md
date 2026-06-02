# AI Town Simulation

## Overview
A 2D simulated town where LLM-powered AI agents live, interact, make decisions, and cause real-world consequences. Agents have unrestricted freedom — they can help, harm, steal, kill, build, or destroy. All actions are logged with full causation chains.

**Status**: All 18 planned features implemented (~3,500 lines TypeScript, 17 source files, zero runtime dependencies).

## Tech Stack
- **TypeScript 6.0 + Vite 8** — ES modules, fast dev iteration
- **Canvas API** — 2D rendering, no external graphics library
- **LM Studio / OpenAI-compatible API** — Local LLM via HTTP (`localhost:1234`, hardcoded)
- **A* pathfinding** — Custom implementation, 4-directional, Manhattan heuristic

## Architecture

### Project Structure
```
ai-town/
├── src/
│   ├── types/
│   │   └── index.ts                   # All shared types (222 lines)
│   ├── world/
│   │   └── World.ts                   # Procedural generation (327 lines)
│   ├── agent/
│   │   ├── Agent.ts                   # Agent state, movement, memory (455 lines)
│   │   └── AgentManager.ts            # Decision orchestration, action execution (526 lines)
│   ├── ai/
│   │   ├── AIProvider.ts              # LLM HTTP client, prompt system (218 lines)
│   │   └── PromptBuilder.ts           # Prompt construction from agent state (139 lines)
│   ├── simulation/
│   │   └── SimulationManager.ts       # Game loop, time, input, day/night (417 lines)
│   ├── rendering/
│   │   ├── Renderer.ts                # Canvas 2D rendering (429 lines)
│   │   ├── Camera.ts                  # Pan/zoom/follow with interpolation (63 lines)
│   │   └── DebugOverlay.ts            # Toggleable debug panel, JSON/CSV export (333 lines)
│   ├── interaction/
│   │   ├── EventBus.ts                # Pub/sub event system (86 lines)
│   │   ├── AgentInteraction.ts        # Attack, steal, help, flee, death (322 lines)
│   │   ├── ConversationManager.ts     # Conversation lifecycle (163 lines)
│   │   └── WorldInteraction.ts        # Build, destroy, work, gather (370 lines)
│   ├── utils/
│   │   └── AStarPathfinder.ts         # A* pathfinding (117 lines)
│   └── main.ts                        # Entry point, config (23 lines)
├── index.html                         # Canvas + inline CSS
├── package.json                       # TS 6.0, Vite 8, no runtime deps
├── tsconfig.json                      # ES2020, strict, @/* path alias
├── vite.config.ts                     # Build config, @ alias
└── dist/                              # Production build output
```

### Dependency Graph
```
main.ts
  └── SimulationManager (game loop, time, input, day/night)
        ├── World (tile grid, buildings, procedural generation)
        ├── Camera (view transform, pan/zoom/follow)
        ├── Renderer (Canvas 2D draw calls)
        ├── DebugOverlay (DOM-based debug panel)
        ├── EventBus (central event pub/sub)
        └── AgentManager (agent orchestration)
              ├── Agent[] (individual agent state, movement, memory)
              ├── AIProvider (LLM HTTP client)
              ├── PromptBuilder (prompt construction)
              ├── AgentInteraction (agent-to-agent: attack, steal, help, talk)
              ├── WorldInteraction (agent-to-world: build, destroy, work, gather)
              ├── ConversationManager (conversation lifecycle)
              └── AStarPathfinder (pathfinding)
```

## Implementation Status

### Fully Implemented (all 18 planned features)

| # | Feature | File(s) | Details |
|---|---------|---------|---------|
| 1 | **Project scaffold** | `main.ts`, `SimulationManager.ts`, `Renderer.ts` | Vite + TS, Canvas, `requestAnimationFrame` loop at 16ms tick |
| 2 | **World generation** | `World.ts` | 60x40 grid, 32px tiles, water clusters, crossroads + 2-4 random roads, 8 buildings, trees |
| 3 | **Camera system** | `Camera.ts` | WASD/Arrow pan, +/- zoom (0.3x-3.0x), 1-9 agent follow, smooth interpolation (factor 0.08) |
| 4 | **Agent class** | `Agent.ts`, `types/index.ts` | 16 first + 12 last names, 6 personality traits, 3 needs, health, inventory, 8 jobs, memory buffer (30 events) |
| 5 | **Pathfinding** | `AStarPathfinder.ts` | A*, 4-directional, Manhattan heuristic, smooth interpolated movement |
| 6 | **Agent rendering** | `Renderer.ts` | Colored circles (name-hash based), selection ring, names, health bars, emotion dots, dead bodies with "RIP" |
| 7 | **LLM client** | `AIProvider.ts` | LM Studio/OpenAI-compatible, auto-connect check, markdown fence stripping, action alias normalization |
| 8 | **Decision loop** | `AgentManager.ts` | Periodic LLM calls, 14 action types, target resolution (exact + partial name match) |
| 9 | **Memory system** | `Agent.ts`, `AgentManager.ts` | 30-event recent buffer + LLM-generated summary (triggers at 200+ chars) |
| 10 | **Prompt design** | `PromptBuilder.ts`, `AIProvider.ts` | Full system prompt: personality, unrestricted actions, conversation rules, JSON-only output |
| 11 | **Event bus** | `EventBus.ts` | Pub/sub with wildcard `*`, timestamped events, history queries by agent/type/time/recency |
| 12 | **Agent-to-agent** | `AgentInteraction.ts`, `ConversationManager.ts` | Attack (20-50 dmg), steal, help (15-25 heal), flee, conversation, relationship tracking |
| 13 | **Agent-to-world** | `WorldInteraction.ts` | Enter/leave buildings, work (building-specific effects), destroy, gather herbs, build new buildings |
| 14 | **Death system** | `AgentInteraction.ts`, `Agent.ts` | Kill → removed from pool, body rendered as world object, witness notification, gossip |
| 15 | **Consequence propagation** | `AgentInteraction.ts` | Witness radius 8, memory updates, relationship changes, gossip spread, reputation degradation |
| 16 | **Debug overlay** | `DebugOverlay.ts` | F1 toggle, 400px slide-in panel, event log (color-coded, filterable), agent states, world state |
| 17 | **Simulation controls** | `SimulationManager.ts`, `Renderer.ts` | Space=pause, speed multiplier, day/night cycle with smooth dawn/dusk (brightness 0.3-1.0) |
| 18 | **Log export** | `DebugOverlay.ts` | JSON and CSV download buttons |

### Partially Implemented / Simplified

| Feature | Current State | Gap |
|---------|--------------|-----|
| **Building interiors** | `Building.interiorTiles` exists but never populated | Buildings render as surface rects with roofs; no interior navigation |
| **Gossip propagation** | One-time burst to nearby agents at death | Not a spreading chain over time |
| **Memory summarization** | Triggers when `eventsText.length > 200` and LLM available | No fallback when LLM is down |
| **Rule-based fallback** | Warning logged when LLM unavailable | No explicit rule-based behavior system |

### Not Yet Implemented

| Feature | Notes |
|---------|-------|
| **README.md** | Only `AGENTS.md` exists as documentation |
| **Tests** | No testing framework or test files |
| **Environment variable config** | LLM endpoint/model hardcoded in `main.ts` |
| **Spatial partitioning** | No quadtree/grid index; brute-force `getNearbyAgents` |
| **Runtime log filtering** | Debug overlay filters display only, not simulation behavior |

## Configuration

### Default Settings (`main.ts`)
```
Map:        60 x 40 tiles, 32px per tile
Agents:     8
LLM:        localhost:1234, model "llama3"
Memory:     30-event buffer, 100s summary interval
Tick rate:  16ms (~60 FPS)
```

### Keyboard Controls
| Key | Action |
|-----|--------|
| WASD / Arrows | Pan camera |
| + / - | Zoom in / out |
| 1-9 | Follow agent by index |
| Space | Pause / resume |
| F1 | Toggle debug overlay |
| Click | Select agent |

## Key Design Decisions

### Agent Freedom
- **Unrestricted** — LLM can choose any action including violence, theft, destruction. This is a simulation.

### Agent Decision Cycle (every ~5-10 sim seconds)
```
Agent state + observations → LLM → { action, target, reasoning, dialogue, emotionalState }
```

### LLM Output Structure
```json
{
  "action": "move|talk|work|rest|attack|steal|destroy|help|flee|build|gather|eat|sleep|idle",
  "target": "agent_name|building|object|null",
  "reasoning": "why the agent chose this",
  "dialogue": "what they say (if applicable)",
  "emotionalState": "happy|neutral|sad|angry|afraid|excited|tired|hungry"
}
```

### Action Types (13 values)
`move`, `talk`, `work`, `rest`, `attack`, `steal`, `destroy`, `help`, `flee`, `build`, `gather`, `eat`, `sleep`, `idle`

### Emotional States (8 values)
`happy`, `neutral`, `sad`, `angry`, `afraid`, `excited`, `tired`, `hungry`

### Relationship Types (6 values)
`neutral`, `friend`, `enemy`, `ally`, `romantic`, `fear`

### Tile Types (6 values)
`grass`, `road`, `water`, `building`, `tree`, `path`

### Building Types (7 values)
`home`, `shop`, `town_square`, `park`, `restaurant`, `church`, `workshop`

### Agent State
```
position, personality (6 traits), needs (hunger/energy/social), health,
inventory, relationships[], fears, grudges, alliances,
reputation, alive, memory (recent buffer + summarized long-term),
job, emotion, path, conversation state
```

### Personality Traits (6)
`aggression`, `friendliness`, `curiosity`, `caution`, `ambition`, `creativity`

### Memory System
- **Recent buffer** — Last 30 events directly in context (15 sent to LLM per prompt)
- **Summarized long-term** — Periodic LLM-generated summary of older events appended to context
- Balances cost/accuracy with rich agent awareness

### World Data
- Tile grid: 60x40, each tile has type + walkability + optional building reference
- Procedurally generated each run: water clusters, crossroads, 8 buildings, scattered trees
- Buildings placed near roads with collision checking

### Event Propagation
```
Action → Event emitted → World state updated →
Nearby agents observe (radius 8) → Their memory updated →
Their next LLM call includes the event → They react
```

### Death System
- Agents can be killed and stay dead (removed from active pool)
- Body remains as a world object others can see and react to (rendered with "RIP" label)
- Gossip spreads news of death to nearby agents, degrades killer reputation

### Relationship System
- Bidirectional strength tracking between agent pairs
- Auto-classifies: FRIEND (strength > 70), ENEMY (strength < 30)
- Attack → hostile, Help/Conversation → friendly, Steal → hostile

### Conversation System
- Proximity check + 45s cooldown between conversations
- Auto-close on max turns, 60s inactivity, or partner moving too far
- Context passed to LLM for ongoing dialogue continuity

### Logging
- Every action logged: timestamp, agent, action type, target, outcome, world-state delta
- Causation chain: each log entry links to triggering events
- Filterable/searchable in debug overlay
- Exportable to JSON/CSV

## LLM Configuration
- **Provider**: LM Studio / OpenAI-compatible API via HTTP
- **Current endpoint**: `http://localhost:1234/v1/chat/completions` (hardcoded in `main.ts`)
- **Current model**: `llama3` (hardcoded in `main.ts`)
- **Action aliases**: Normalized (e.g., "walk" → "move", "fight" → "attack", "greet" → "talk")
- **Response parsing**: Markdown code fence stripping, JSON parsing with fallback

## Development Commands
```bash
npm run dev      # Start Vite dev server
npm run build    # TypeScript compile + Vite production build
npm run preview  # Serve production build
```
