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
| 8 | **Decision loop** | `AgentManager.ts` | Event-driven daily schedules and decisions; globally serialized LLM lane with immediate blocking retry on failure |
| 9 | **Memory system** | `Agent.ts`, `AgentManager.ts` | 30-event recent buffer + deterministic day-boundary compaction |
| 10 | **Prompt design** | `PromptBuilder.ts`, `AIProvider.ts` | Full system prompt: personality, unrestricted actions, conversation rules, JSON-only output |
| 11 | **Event bus** | `EventBus.ts` | Pub/sub with wildcard `*`, timestamped events, history queries by agent/type/time/recency |
| 12 | **Agent-to-agent** | `AgentInteraction.ts`, `ConversationManager.ts` | Attack (20-50 dmg), steal, help (15-25 heal), flee, conversation, relationship tracking |
| 13 | **Agent-to-world** | `WorldInteraction.ts` | Enter/leave buildings, work (building-specific effects), destroy, gather herbs, build new buildings |
| 14 | **Death system** | `AgentInteraction.ts`, `Agent.ts` | Kill → removed from pool, body rendered as world object, witness notification, gossip |
| 15 | **Consequence propagation** | `AgentInteraction.ts` | Witness radius 8, memory updates, relationship changes, gossip spread, reputation degradation |
| 16 | **Debug overlay** | `DebugOverlay.ts` | F1 toggle, 400px slide-in panel, event log (color-coded, filterable), agent states, world state |
| 17 | **Simulation controls** | `SimulationManager.ts`, `Renderer.ts` | Space=pause, speed multiplier, day/night cycle with smooth dawn/dusk (brightness 0.3-1.0) |
| 18 | **Log export** | `DebugOverlay.ts` | JSON and CSV download buttons |
| 19 | **Weather system** | `SimulationManager.ts`, `AgentManager.ts` | Clear/cloudy/rain/storm transitions; outdoor workers seek nearest indoor shelter in hazardous weather |
| 20 | **Rumour system** | `AgentManager.ts`, `DebugOverlay.ts` | Events seed rumours, conversations spread them, whispers inject them, and agent reactions are tracked in the UI |

### Partially Implemented / Simplified

| Feature | Current State | Gap |
|---------|--------------|-----|
| **Building interiors** | `Building.interiorTiles` exists but never populated | Buildings render as surface rects with roofs; no interior navigation |
| **Rumour mutation** | Rumours spread between agents with credibility decay | Wording remains stable during transmission |
| **Memory summarization** | Deterministic compaction at day boundaries | Summaries are extractive rather than LLM-generated |
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
Memory:     30-event buffer, compacted at each day boundary
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

### Agent Decision Cycle (event-driven)
```
Day start → LLM daily schedule → execute task block
Task completion / interaction / notable event → LLM → next task block
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
- **Summarized long-term** — Older descriptions are compacted locally at each day boundary
- Balances cost/accuracy with rich agent awareness

### World Data
- Tile grid: 60x40, each tile has type + walkability + optional building reference
- Procedurally generated each run: water clusters, crossroads, 8 buildings, scattered trees
- Buildings placed near roads with collision checking

### Event Propagation
```
Action → Event emitted → World state updated →
Nearby agents observe (radius 8) → Their memory updated →
The event queues an LLM reaction for affected agents
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
- Conversations are exclusive pairs: an agent already speaking with someone cannot be placed into a second conversation, and turns/events are recorded only after the pair operation succeeds
- Proximity encounters fire once per entry. A pair must separate beyond the encounter radius before it can trigger another greeting; genuine later re-encounters rotate contextual openers
- Conversation inactivity closure is suspended while either participant has a queued or pending decision, preventing the serialized LLM lane from timing out a partner response
- Proximity check + 45s cooldown between conversations
- Known agents always exchange a brief greeting on encounter; unfamiliar agents may greet or ignore based on a configurable multiplier (35% base chance)
- Auto-close on max turns, 5 simulated minutes of inactivity, or partner moving too far
- Context passed to LLM for ongoing dialogue continuity

### Rumour System
- Successful theft, injury, death, and building destruction can form natural rumours
- Agents pass rumours only when their dialogue actually mentions the claim; friendliness and the listener's authority affect whether a relevant rumour comes up naturally
- Each unique speaker affects credibility once according to their reputation; conduct and verified or unsubstantiated claims update reputation over time
- Semantically related rumour pairs corroborate each other once, adding 10 percentage points to both credibility scores up to a 95% cap; relation counts are visible in both rumour panels
- During conversation, creativity-weighted rolls can invent a new local suspicion when there is nothing to share or mutate a known unverified claim. Mutation attempts occur once per agent/claim, invention has a three-simulated-hour agent cooldown, and both must appear in spoken dialogue before transmission
- Rumours carry provenance independently from factual status (`event`, `anonymous`, `intuition`, `dream`, `divine`, or `mutation`). The whisper source-hint box infers provenance; divine hints can name a deity
- Agents track faith plus named deity confidence/revelation counts. Divine messages can be adopted based on prior faith, preserved in dialogue and thoughts, spread to others, and strengthened or weakened by later findings; fixed/seeded stances remain evidence-resistant
- `rumourExtremeBeliefProbability` controls the chance that first exposure locks an agent into full belief or denial; other agents remain uncertain until evidence arrives
- Direct whisper recipients are seed believers: they receive a locked believer stance regardless of the configured probability or later contradictory evidence, except that atheists reject whispers as false with a fixed denier stance
- Every rumour delivery and investigation result creates a private `thought` memory recording that agent's interpretation
- A newly informed agent must mention the rumour to their first subsequent conversation partner other than the source who introduced it; the pending marker clears only after the claim is actually spoken
- `rumourPropagationMultiplier` scales both the chance that an encounter with shareable information becomes a conversation and the organic non-pending rumour mention chance; forced first shares are unaffected
- The independent left-side Rumour & Belief Tracker summarizes live claim state and renders the newest private `thought` events; it continues updating when the F1 debug overlay is hidden
- Rumours are explicitly unverified in prompts; relevant jobs launch investigation blocks that resolve claims as verified or unsubstantiated from recorded evidence
- The Sheriff treats every unresolved rumour as an investigation priority. Sheriff rumour triggers move ahead of routine queued decisions, remain separate when several arrive together, and can proceed even when another profession is already investigating
- The debug overlay can whisper a rumour to one agent or the entire town
- Reach, transmissions, credibility, investigation status/findings, and the three most recent reactions are visible in the Rumours & Whispers panel

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
