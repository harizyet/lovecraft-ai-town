# AI Town Simulation

## Overview
A 2D simulated town where LLM-powered AI agents live, interact, make decisions, and cause real-world consequences. Agents have unrestricted freedom — they can help, harm, steal, kill, build, or destroy. All actions are logged with full causation chains.

**Status**: All planned features and major extensions fully implemented (~20,750 lines of TypeScript, 32 source files, zero runtime dependencies).

## Tech Stack
- **TypeScript 6.0 + Vite 8** — ES modules, fast dev iteration
- **Canvas API** — 2D rendering, no external graphics library
- **OpenAI-Compatible API** — Remote/Local LLM via HTTP (configured in [main.ts](file:///home/hariz/village/ai-town/src/main.ts))
- **A* pathfinding** — Custom implementation, 4-directional, Manhattan heuristic

---

## Architecture

### Project Structure
```
ai-town/
├── src/
│   ├── types/
│   │   └── [index.ts](file:///home/hariz/village/ai-town/src/types/index.ts)                   # Shared TypeScript interfaces & types (695 lines)
│   ├── world/
│   │   └── [World.ts](file:///home/hariz/village/ai-town/src/world/World.ts)                   # Grid generation, buildings & clearance logic (459 lines)
│   ├── agent/
│   │   ├── [Agent.ts](file:///home/hariz/village/ai-town/src/agent/Agent.ts)                   # Individual agent parameters, needs, traits, memory (754 lines)
│   │   ├── [AgentManager.ts](file:///home/hariz/village/ai-town/src/agent/AgentManager.ts)            # Simulation orchestration, schedules, agendas & LLM parsing (3371 lines)
│   │   └── systems/                   # Extracted modular subsystems (Religion, Cult, Politics, Justice, Rumour, Story)
│   │       ├── [CultSystem.ts](file:///home/hariz/village/ai-town/src/agent/systems/CultSystem.ts)          # Shrines, demonic summoning, cult mechanics (2109 lines)
│   │       ├── [RumourSystem.ts](file:///home/hariz/village/ai-town/src/agent/systems/RumourSystem.ts)        # Propagation, credibility, corroboration (2122 lines)
│   │       ├── [ReligionSystem.ts](file:///home/hariz/village/ai-town/src/agent/systems/ReligionSystem.ts)      # Faith, prophets, revelations, deity chat (1749 lines)
│   │       ├── [JusticeSystem.ts](file:///home/hariz/village/ai-town/src/agent/systems/JusticeSystem.ts)       # Resolution courts, trials, voting, verdicts (936 lines)
│   │       ├── [PoliticalSystem.ts](file:///home/hariz/village/ai-town/src/agent/systems/PoliticalSystem.ts)     # Gentry/Commons camps, town policy voting (879 lines)
│   │       ├── [StorySystem.ts](file:///home/hariz/village/ai-town/src/agent/systems/StorySystem.ts)         # Narrates major story moments & events (201 lines)
│   │       └── [SystemDeps.ts](file:///home/hariz/village/ai-town/src/agent/systems/SystemDeps.ts)          # Extracted interfaces for system decoupling (215 lines)
│   ├── ai/
│   │   ├── [AIProvider.ts](file:///home/hariz/village/ai-town/src/ai/AIProvider.ts)              # OpenAI HTTP client & prompt system (1151 lines)
│   │   └── [PromptBuilder.ts](file:///home/hariz/village/ai-town/src/ai/PromptBuilder.ts)           # Prompt construction from agent state (482 lines)
│   ├── simulation/
│   │   └── [SimulationManager.ts](file:///home/hariz/village/ai-town/src/simulation/SimulationManager.ts)       # Central game loop, tick updates, weather, day/night (879 lines)
│   ├── rendering/
│   │   ├── [Renderer.ts](file:///home/hariz/village/ai-town/src/rendering/Renderer.ts)                # Canvas 2D engine, text tags, overlay filters (502 lines)
│   │   ├── [Camera.ts](file:///home/hariz/village/ai-town/src/rendering/Camera.ts)                  # Target tracking & interpolation (68 lines)
│   │   ├── [DebugOverlay.ts](file:///home/hariz/village/ai-town/src/rendering/DebugOverlay.ts)            # Sidebar debug, whispers & JSON/CSV log export (1902 lines)
│   │   ├── [ConversationPanel.ts](file:///home/hariz/village/ai-town/src/rendering/ConversationPanel.ts)       # Rendering active conversation UI (97 lines)
│   │   ├── [PolicyPanel.ts](file:///home/hariz/village/ai-town/src/rendering/PolicyPanel.ts)             # Rendering town assemblies & policy voting (146 lines)
│   │   ├── [StoryNarrationPanel.ts](file:///home/hariz/village/ai-town/src/rendering/StoryNarrationPanel.ts)     # Rendering major town story moments (151 lines)
│   │   ├── [CourtPanel.ts](file:///home/hariz/village/ai-town/src/rendering/CourtPanel.ts)              # Rendering resolution trials (201 lines)
│   │   └── [DeityChatPanel.ts](file:///home/hariz/village/ai-town/src/rendering/DeityChatPanel.ts)          # Rendering whispers & deity commands (199 lines)
│   ├── interaction/
│   │   ├── [EventBus.ts](file:///home/hariz/village/ai-town/src/interaction/EventBus.ts)                # Wildcard-supported pub/sub dispatcher (94 lines)
│   │   ├── [AgentInteraction.ts](file:///home/hariz/village/ai-town/src/interaction/AgentInteraction.ts)        # Direct agent interactions: attack, steal, help (435 lines)
│   │   ├── [ConversationManager.ts](file:///home/hariz/village/ai-town/src/interaction/ConversationManager.ts)     # Conversation state machine (184 lines)
│   │   └── [WorldInteraction.ts](file:///home/hariz/village/ai-town/src/interaction/WorldInteraction.ts)        # Structural world actions: harvest, work, shrines (322 lines)
│   ├── utils/
│   │   ├── [AStarPathfinder.ts](file:///home/hariz/village/ai-town/src/utils/AStarPathfinder.ts)         # Pathfinding implementation (117 lines)
│   │   ├── [ForbiddenKnowledgeRules.ts](file:///home/hariz/village/ai-town/src/utils/ForbiddenKnowledgeRules.ts) # Rules for forbidden/existential claims (163 lines)
│   │   ├── [JobIcons.ts](file:///home/hariz/village/ai-town/src/utils/JobIcons.ts)                # Vocation icons map (25 lines)
│   │   ├── [RumourRules.ts](file:///home/hariz/village/ai-town/src/utils/RumourRules.ts)             # Static rules for rumor updates (21 lines)
│   │   └── [PolicyRules.ts](file:///home/hariz/village/ai-town/src/utils/PolicyRules.ts)             # Definitions of political policy options (100 lines)
│   └── [main.ts](file:///home/hariz/village/ai-town/src/main.ts)                        # Main launcher and config setup (25 lines)
```

### Dependency Graph
```
main.ts
  └── SimulationManager (game loop, time, input, day/night, weather)
        ├── World (tile grid, buildings, procedural generation)
        ├── Camera (view transform, pan/zoom/follow)
        ├── Renderer (Canvas 2D draw calls, weather effects, lighting overlay)
        ├── DebugOverlay (DOM-based debug panel)
        ├── EventBus (central event pub/sub)
        └── AgentManager (agent orchestration & extracted subsystems)
              ├── Agent[] (individual agent state, movement, memory, faith, sanity)
              ├── AIProvider (LLM HTTP client, prophetic/cult prompt extensions)
              ├── PromptBuilder (prompt construction, context injection)
              ├── AgentInteraction (agent-to-agent interactions)
              ├── WorldInteraction (agent-to-world interactions)
              ├── ConversationManager (conversation lifecycle)
              ├── AStarPathfinder (pathfinding)
              └── Systems (Modular extracted simulation logic)
                    ├── CultSystem (Summoning rites, shrines, demonic targeting, mob tracking)
                    ├── RumourSystem (Rumour spread, credibility updates, corroboration, thoughts)
                    ├── ReligionSystem (Faith levels, Prophet revelations, deity chat commands)
                    ├── JusticeSystem (Resolution Court trials, voter defense speeches, verdicts)
                    ├── PoliticalSystem (Gentry vs. Commons camps, policy town assemblies)
                    └── StorySystem (Chronicles major town events, alerts, and narrations)
```

---

## Implementation Status

### Fully Implemented Features

| # | Feature | File(s) | Details |
|---|---------|---------|---------|
| 1 | **Project scaffold** | `main.ts`, `SimulationManager.ts`, `Renderer.ts` | Vite + TS, Canvas, `requestAnimationFrame` loop at 16ms tick |
| 2 | **World generation** | `World.ts` | 60x40 grid, 32px tiles, water clusters, crossroads + roads, 8 buildings, trees |
| 3 | **Camera system** | `Camera.ts` | WASD/Arrow pan, +/- zoom, 1-9 agent follow, smooth interpolation |
| 4 | **Agent class** | `Agent.ts`, `types/index.ts` | Names, personality traits, needs, health, inventory, vocations, memory buffer |
| 5 | **Pathfinding** | `AStarPathfinder.ts` | A*, 4-directional, Manhattan heuristic, smooth movement |
| 6 | **Agent rendering** | `Renderer.ts` | Hash-colored circles, names, health bars, emotion dots, dead bodies with "RIP" |
| 7 | **LLM client** | `AIProvider.ts` | OpenAI-compatible, markdown fence stripping, action normalization |
| 8 | **Decision loop** | `AgentManager.ts` | Event-driven schedules/decisions; serialized LLM lane with blocking retry |
| 9 | **Memory system** | `Agent.ts`, `AgentManager.ts` | Recent buffer + deterministic day-boundary compaction |
| 10 | **Prompt design** | `PromptBuilder.ts`, `AIProvider.ts` | Full system prompt: personality, action formatting, JSON-only output |
| 11 | **Event bus** | `EventBus.ts` | Pub/sub with wildcard `*`, timestamped event queries |
| 12 | **Agent-to-agent** | `AgentInteraction.ts`, `ConversationManager.ts` | Attack (20-50 dmg), steal, help (15-25 heal), flee, conversation |
| 13 | **Agent-to-world** | `WorldInteraction.ts` | Enter/leave buildings, work effects, destroy buildings, gather, build shrines |
| 14 | **Death system** | `AgentInteraction.ts`, `Agent.ts` | Permanent death, body rendered as world object, witnesses notify others |
| 15 | **Consequence propagation** | `AgentInteraction.ts` | Witness radius 8, memory updates, relationships, gossip propagation |
| 16 | **Debug overlay** | `DebugOverlay.ts` | F1 toggle, 400px panel, event log, agent inspect, CSV/JSON log export |
| 17 | **Simulation controls** | `SimulationManager.ts` | Pause (Space), speed multiplier, day/night cycles |
| 18 | **Log export** | `DebugOverlay.ts` | Export logs as JSON or CSV |
| 19 | **Weather system** | `SimulationManager.ts`, `AgentManager.ts` | Transitions (clear/cloudy/rain/storm); weather-affected behavior |
| 20 | **Rumour propagation** | `RumourSystem.ts` | Rumour seeding, spreading in conversation, thought creation, credibility tracking |
| 21 | **Divine Whispers & Chat** | `DeityChatPanel.ts`, `ReligionSystem.ts` | Allow the user to act as a deity, whisper commands to agents, and chat directly |
| 22 | **Prophets & Revelations** | `ReligionSystem.ts` | Prophet role transitions, daily prophetic tasks (sacrifices, warn, convert) |
| 23 | **Cults & Summoning** | `CultSystem.ts` | Founding cults, naming congregations, gathering sum-charge to summon invulnerable Demons |
| 24 | **Sanity & Corruption** | `ReligionSystem.ts`, `CultSystem.ts` | Permanent insanity behavior from existential shock, Priest corruption into hidden cultist |
| 25 | **Resolution Courts** | `JusticeSystem.ts`, `CourtPanel.ts` | Trial assemblies, LLM voter defenses, voting to Absolve, Exile, or Execute |
| 26 | **Political Camps** | `PoliticalSystem.ts`, `PolicyPanel.ts` | Division of town into Gentry/Commons; town assemblies to vote on economic/exile policies |
| 27 | **Office of the Alderman** | `PoliticalSystem.ts` | Reaching unanimous cult town conversion triggers election, granting decree power |
| 28 | **Outsider Escalation** | `AgentManager.ts` | Spawn Knights (investigating death) and Inquisitors (combating cults) |
| 29 | **Story Narration HUD** | `StorySystem.ts`, `StoryNarrationPanel.ts` | Visual log detailing major town narrative milestones |
| 30 | **Vocation Systems & Idle Watchdog** | `Agent.ts`, `AgentManager.ts` | stuck/idle watchdog triggering `idle_recovery` behavior |

### Partially Implemented / Simplified

| Feature | Current State | Gap |
|---------|--------------|-----|
| **Building interiors** | `Building.interiorTiles` exists but never populated | Buildings render as surface rects with roofs; no interior navigation |
| **Memory summarization** | Deterministic compaction at day boundaries | Summaries are extractive rather than LLM-generated |
| **Rule-based fallback** | Warning logged when LLM unavailable | No explicit rule-based behavior system |

### Not Yet Implemented

| Feature | Notes |
|---------|-------|
| **Tests** | No testing framework or test files |
| **Spatial partitioning** | No quadtree/grid index; brute-force `getNearbyAgents` |
| **Runtime log filtering** | Debug overlay filters display only, not simulation behavior |

---

## Configuration

### Default Settings (`main.ts`)
```
Map:        60 x 40 tiles, 32px per tile
Agents:     10
LLM:        http://10.180.1.54:8000, model "OpenVINO/Qwen2.5-1.5B-Instruct-int4-ov"
Memory:     25-event buffer, compacted at each day boundary
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

---

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
  "action": "move|talk|work|rest|attack|steal|destroy|help|flee|build|gather|eat|sleep|idle|investigate|interrogate|...",
  "target": "agent_name|building|object|null",
  "reasoning": "why the agent chose this",
  "dialogue": "what they say (if applicable)",
  "emotionalState": "happy|neutral|sad|angry|afraid|excited|tired|hungry|panicked|grieving|..."
}
```

### Action Types (30 values)
`move`, `talk`, `work`, `rest`, `attack`, `steal`, `destroy`, `help`, `flee`, `build`, `gather`, `eat`, `sleep`, `idle`, `investigate`, `interrogate`, `call_inquisitor`, `cry`, `pray`, `conjure`, `summon`, `resurrect`, `heal`, `bless`, `curse`, `ritual`, `preach`, `invite_cult`, `build_shrine`, `bribe`

### Emotional States (12 values)
`happy`, `neutral`, `sad`, `angry`, `afraid`, `excited`, `tired`, `hungry`, `panicked`, `grieving`, `ambivalent`, `determined`

### Relationship Types (6 values)
`neutral`, `friend`, `enemy`, `ally`, `romantic`, `fear`

### Tile Types (6 values)
`grass`, `road`, `water`, `building`, `tree`, `path`

### Building Types (16 values)
`home`, `shop`, `town_square`, `park`, `restaurant`, `church`, `workshop`, `smithy`, `carpenter_workshop`, `market`, `guardhouse`, `apothecary`, `manor`, `tavern`, `farm`, `cult_shrine`

### Agent State
```
position, personality (6 traits), needs (hunger/energy/social), health,
inventory, relationships[], fears, grudges, alliances,
reputation, alive, memory (recent buffer + summarized long-term),
job, emotion, path, conversation state, faith, sanity, permanentInsanity
```

### Personality Traits (6)
`aggression`, `friendliness`, `curiosity`, `caution`, `ambition`, `creativity`

### Memory System
- **Recent buffer** — Last 25 events directly in context
- **Summarized long-term** — Older descriptions are compacted locally at each day boundary
- Balances cost/accuracy with rich agent awareness

### World Data
- Tile grid: 60x40, each tile has type + walkability + optional building reference
- Procedurally generated each run: water clusters, crossroads, roads, 8 buildings, scattered trees
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

### Rumour & Belief Subsystem (`RumourSystem.ts`)
- Successful theft, injury, death, and building destruction can form natural rumours.
- Agents pass rumours only when their dialogue actually mentions the claim; friendliness and the listener's authority affect whether a relevant rumour comes up naturally.
- Each unique speaker affects credibility once according to their reputation; conduct and verified or unsubstantiated claims update reputation over time.
- Semantically related rumour pairs corroborate each other once, adding 10 percentage points to both credibility scores up to a 95% cap; relation counts are visible in both rumour panels.
- During conversation, creativity-weighted rolls can invent a new local suspicion when there is nothing to share or mutate a known unverified claim. Mutation attempts occur once per agent/claim, invention has a three-simulated-hour agent cooldown, and both must appear in spoken dialogue before transmission.
- Rumours carry provenance independently from factual status (`event`, `anonymous`, `intuition`, `dream`, `divine`, or `mutation`). The whisper source-hint box infers provenance; divine hints can name a deity.
- `rumourExtremeBeliefProbability` controls the chance that first exposure locks an agent into full belief or denial; other agents remain uncertain until evidence arrives.
- Direct whisper recipients are seed believers: they receive a locked believer stance regardless of the configured probability or later contradictory evidence, except that atheists reject whispers as false with a fixed denier stance.
- Every rumour delivery and investigation result creates a private `thought` memory recording that agent's interpretation.
- A newly informed agent must mention the rumour to their first subsequent conversation partner other than the source who introduced it; the pending marker clears only after the claim is actually spoken.
- `rumourPropagationMultiplier` scales both the chance that an encounter with shareable information becomes a conversation and the organic non-pending rumour mention chance; forced first shares are unaffected.
- The independent left-side Rumour & Belief Tracker summarizes live claim state and renders the newest private `thought` events; it continues updating when the F1 debug overlay is hidden.
- Rumours are explicitly unverified in prompts; relevant jobs launch investigation blocks that resolve claims as verified or unsubstantiated from recorded evidence.
- The Sheriff treats every unresolved rumour as an investigation priority. Sheriff rumour triggers move ahead of routine queued decisions, remain separate when several arrive together, and can proceed even when another profession is already investigating.
- The debug overlay can whisper a rumour to one agent or the entire town.
- Reach, transmissions, credibility, investigation status/findings, and the three most recent reactions are visible in the Rumours & Whispers panel.

### Religion & Whispers Subsystem (`ReligionSystem.ts`)
- Agents track faith plus named deity confidence/revelation counts.
- Divine messages can be adopted based on prior faith, preserved in dialogue and thoughts, spread to others, and strengthened or weakened by later findings; fixed/seeded stances remain evidence-resistant.
- The first agent to accept a direct divine whisper changes their vocation to a **Prophet**. They receive daily LLM-generated prophetic revelations, command executable tasks (e.g., sacrifice, warn, convert), and found cults.
- Faith & Atheism: Agents track faith levels and deity confidence. The town begins with at least one atheist (capped faith) who resists preaching/recruitment, while others can convert, grow in faith, or lose faith.

### Cults & Shrines Subsystem (`CultSystem.ts`)
- Cult leaders recruit members (`form_cult`), who gain specialized tasks (`pray`, `heal`, `bless`, `curse`, `resurrect`).
- Leaders deterministically build physical shrines near them, directing cult sermons and rites to that preferred location.
- **Demonic Summoning** — Cult leaders lead collective summoning rites, gathering fellow members to generate a Demon summon charge. Summoned Demons are invulnerable (666 HP, ignoring ordinary damage) and pursue user-defined attack or travel commands.
- **Permanent Insanity** — Witnessing Demon manifestations or targeted divine actions can drive non-cultist/nonbelieving agents permanently insane, forcing panicked and erratic behaviors that persist through saves and reloads.
- **Corruption Twists** — Direct whispers to a Priest can corrupt them, making them a hidden Prophet/cult leader. They rename their congregation to evoke ancient, inhuman deities while retaining their public Priest facade to avoid suspicion.
- **Defection & Mobs** — Disillusioned members defect, becoming enemies of their former cult and potentially forming anti-cult groups. High-aggression cults can form mobs to hunt down and attack nonbelievers.

### Justice & Trials Subsystem (`JusticeSystem.ts`)
- **Resolution Courts** — When a rumour reaches everyone in town (or an authority override triggers), the village gathers at the town square for a trial.
- The accused delivers an LLM defense, and villagers vote to **Absolve**, **Exile** (inactive/hidden state), or **Execute** (permanent death).

### Political Camps Subsystem (`PoliticalSystem.ts`)
- **Political Camps (Gentry vs. Commons)** — Agents are split into wealth-ranked political camps.
- A Steward or high-reputation villager periodically calls town assemblies to vote on economic policies (boosting specific jobs with wealth) or banishing Knights/Inquisitors.
- **Office of the Alderman** — If a cult leader converts the entire village, they can run for Alderman (requiring a unanimous vote). Seating them grants absolute decree power, overriding court majority votes and assembly policies.

### Story Narration Subsystem (`StorySystem.ts`)
- Chronicles major town events and milestones (cult formation, prophet appointments, demonic summons, trials, etc.).
- Feeds these moments to a custom UI panel (`StoryNarrationPanel`) for visual display and narrative tracking.

### Logging
- Every action logged: timestamp, agent, action type, target, outcome, world-state delta
- Causation chain: each log entry links to triggering events
- Filterable/searchable in debug overlay
- Exportable to JSON/CSV

## LLM Configuration
- **Provider**: OpenAI-Compatible endpoint
- **Current endpoint**: Configurable in `main.ts`
- **Current model**: Configurable in `main.ts`
- **Action aliases**: Normalized
- **Response parsing**: Markdown code fence stripping, JSON parsing with fallback

## Development Commands
```bash
npm run dev      # Start Vite dev server
npm run build    # TypeScript compile + Vite production build
npm run preview  # Serve production build
```
