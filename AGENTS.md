# AI Town Simulation

## Overview
A 2D simulated town where LLM-powered AI agents live, interact, make decisions, and cause real-world consequences. Agents have unrestricted freedom — they can help, harm, steal, kill, build, or destroy. All actions are logged with full causation chains.

**Status**: All planned features and major extensions fully implemented (~22,800 lines of TypeScript, 39 source files, zero runtime dependencies).

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
│   │   └── [index.ts](file:///home/hariz/village/ai-town/src/types/index.ts)                   # Shared TypeScript interfaces & types (755 lines)
│   ├── world/
│   │   └── [World.ts](file:///home/hariz/village/ai-town/src/world/World.ts)                   # Grid generation, buildings & clearance logic (459 lines)
│   ├── agent/
│   │   ├── [Agent.ts](file:///home/hariz/village/ai-town/src/agent/Agent.ts)                   # Individual agent parameters, needs, traits, memory (754 lines)
│   │   ├── [AgentManager.ts](file:///home/hariz/village/ai-town/src/agent/AgentManager.ts)            # Thin orchestrator: wiring, main loop, snapshot save/restore (1319 lines)
│   │   └── systems/                   # Extracted modular subsystems (12 systems + shared DI interface)
│   │       ├── [RumourSystem.ts](file:///home/hariz/village/ai-town/src/agent/systems/RumourSystem.ts)        # Propagation, credibility, corroboration, investigation (2124 lines)
│   │       ├── [CultSystem.ts](file:///home/hariz/village/ai-town/src/agent/systems/CultSystem.ts)          # Shrines, demonic summoning, cult mechanics, targeted preaching (2145 lines)
│   │       ├── [ReligionSystem.ts](file:///home/hariz/village/ai-town/src/agent/systems/ReligionSystem.ts)      # Faith, prophets, revelations, deity chat (1834 lines)
│   │       ├── [JusticeSystem.ts](file:///home/hariz/village/ai-town/src/agent/systems/JusticeSystem.ts)       # Resolution courts, trials, voting, belief-consistent verdicts (975 lines)
│   │       ├── [PoliticalSystem.ts](file:///home/hariz/village/ai-town/src/agent/systems/PoliticalSystem.ts)     # Gentry/Commons camps, town policy voting, Alderman, bribery (899 lines)
│   │       ├── [DecisionEngine.ts](file:///home/hariz/village/ai-town/src/agent/systems/DecisionEngine.ts)      # LLM decision queue & the action dispatcher (887 lines)
│   │       ├── [ScheduleSystem.ts](file:///home/hariz/village/ai-town/src/agent/systems/ScheduleSystem.ts)      # Daily plans, activity blocks, idle/weather/exhaustion/health-recovery handling (917 lines)
│   │       ├── [SocialSystem.ts](file:///home/hariz/village/ai-town/src/agent/systems/SocialSystem.ts)        # Encounters, conversation batching & context (430 lines)
│   │       ├── [OutsiderSystem.ts](file:///home/hariz/village/ai-town/src/agent/systems/OutsiderSystem.ts)      # Knight/Inquisitor spawning & combat (270 lines)
│   │       ├── [StorySystem.ts](file:///home/hariz/village/ai-town/src/agent/systems/StorySystem.ts)         # Narrates major story moments & events, incl. survivor/extinction beats (287 lines)
│   │       ├── [EnvironmentSystem.ts](file:///home/hariz/village/ai-town/src/agent/systems/EnvironmentSystem.ts)   # Localized tile corruption from cult shrines, demons & rituals; map-wide demon saturation
│   │       ├── [RelicSystem.ts](file:///home/hariz/village/ai-town/src/agent/systems/RelicSystem.ts)         # Forbidden relic creation, discovery & deity relic placement
│   │       ├── [SchemeValidator.ts](file:///home/hariz/village/ai-town/src/agent/systems/SchemeValidator.ts)    # Validates LLM-proposed Cult Scheme output against job affordances
│   │       └── [SystemDeps.ts](file:///home/hariz/village/ai-town/src/agent/systems/SystemDeps.ts)          # Shared dependency-injection interface between systems (280 lines)
│   ├── ai/
│   │   ├── [AIProvider.ts](file:///home/hariz/village/ai-town/src/ai/AIProvider.ts)              # OpenAI HTTP client & prompt system (1151 lines)
│   │   └── [PromptBuilder.ts](file:///home/hariz/village/ai-town/src/ai/PromptBuilder.ts)           # Prompt construction from agent state (505 lines)
│   ├── simulation/
│   │   └── [SimulationManager.ts](file:///home/hariz/village/ai-town/src/simulation/SimulationManager.ts)       # Central game loop, tick updates, weather, day/night (879 lines)
│   ├── rendering/
│   │   ├── [Renderer.ts](file:///home/hariz/village/ai-town/src/rendering/Renderer.ts)                # Canvas 2D engine, text tags, overlay filters (502 lines)
│   │   ├── [Camera.ts](file:///home/hariz/village/ai-town/src/rendering/Camera.ts)                  # Target tracking & interpolation (68 lines)
│   │   ├── [DebugOverlay.ts](file:///home/hariz/village/ai-town/src/rendering/DebugOverlay.ts)            # Sidebar debug, whispers & JSON/CSV log export (1971 lines)
│   │   ├── [ConversationPanel.ts](file:///home/hariz/village/ai-town/src/rendering/ConversationPanel.ts)       # Rendering active conversation UI (97 lines)
│   │   ├── [PolicyPanel.ts](file:///home/hariz/village/ai-town/src/rendering/PolicyPanel.ts)             # Rendering town assemblies & policy voting (146 lines)
│   │   ├── [StoryNarrationPanel.ts](file:///home/hariz/village/ai-town/src/rendering/StoryNarrationPanel.ts)     # Rendering major town story moments (169 lines)
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
        └── AgentManager (thin orchestrator: constructs Systems, wires SystemDeps, runs update loop)
              ├── Agent[] (individual agent state, movement, memory, faith, sanity)
              ├── AIProvider (LLM HTTP client, prophetic/cult prompt extensions)
              ├── PromptBuilder (prompt construction, context injection)
              ├── AgentInteraction (agent-to-agent interactions)
              ├── WorldInteraction (agent-to-world interactions)
              ├── ConversationManager (conversation lifecycle)
              ├── AStarPathfinder (pathfinding)
              └── Systems (agent/systems/*.ts — talk to each other only through SystemDeps)
                    ├── RumourSystem (Rumour spread, credibility, corroboration, investigation)
                    ├── CultSystem (Summoning rites, shrines, demonic targeting, mob tracking)
                    ├── ReligionSystem (Faith levels, Prophet revelations, deity chat commands)
                    ├── JusticeSystem (Resolution Court trials, voter defense speeches, verdicts)
                    ├── PoliticalSystem (Gentry vs. Commons camps, policy town assemblies)
                    ├── DecisionEngine (LLM decision queue, executeLLMDecision dispatcher)
                    ├── ScheduleSystem (Daily plans, activity blocks, weather/idle handling)
                    ├── SocialSystem (Encounters, conversation batching)
                    ├── OutsiderSystem (Knight/Inquisitor spawning & combat)
                    ├── StorySystem (Chronicles major town events, alerts, and narrations)
                    ├── EnvironmentSystem (Localized tile corruption from cult/demon/ritual activity)
                    └── RelicSystem (Forbidden relic creation, discovery & deity relic placement)
```

Each system is constructed once by `AgentManager` and receives a `SystemDeps` object (built
from `AgentManager`'s own fields/bound methods) rather than a back-reference to `AgentManager`
itself or to sibling systems — this is what keeps the split from just becoming a dozen files
that all still secretly depend on each other's internals. `DecisionEngine`, as the one dispatcher
that legitimately needs to reach every subsystem, is the sole exception and holds direct typed
references to the other eleven systems.

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
| 8 | **Decision loop** | `DecisionEngine.ts`, `ScheduleSystem.ts` | Event-driven schedules/decisions; serialized LLM lane with blocking retry |
| 9 | **Memory system** | `Agent.ts`, `ScheduleSystem.ts` | Recent buffer + deterministic day-boundary compaction |
| 10 | **Prompt design** | `PromptBuilder.ts`, `AIProvider.ts` | Full system prompt: personality, action formatting, JSON-only output |
| 11 | **Event bus** | `EventBus.ts` | Pub/sub with wildcard `*`, timestamped event queries |
| 12 | **Agent-to-agent** | `AgentInteraction.ts`, `ConversationManager.ts` | Attack (20-50 dmg), steal, help (15-25 heal), flee, conversation |
| 13 | **Agent-to-world** | `WorldInteraction.ts` | Enter/leave buildings, work effects, destroy buildings, gather, build shrines |
| 14 | **Death system** | `AgentInteraction.ts`, `Agent.ts` | Permanent death, body rendered as world object, witnesses notify others |
| 15 | **Consequence propagation** | `AgentInteraction.ts` | Witness radius 8, memory updates, relationships, gossip propagation |
| 16 | **Debug overlay** | `DebugOverlay.ts` | F1 toggle, 400px panel, event log, agent inspect, CSV/JSON log export |
| 17 | **Simulation controls** | `SimulationManager.ts` | Pause (Space), speed multiplier, day/night cycles |
| 18 | **Log export** | `DebugOverlay.ts` | Export logs as JSON or CSV |
| 19 | **Weather system** | `SimulationManager.ts`, `ScheduleSystem.ts` | Transitions (clear/cloudy/rain/storm); weather-affected behavior |
| 20 | **Rumour propagation** | `RumourSystem.ts` | Rumour seeding, spreading in conversation, thought creation, credibility tracking |
| 21 | **Divine Whispers & Chat** | `DeityChatPanel.ts`, `ReligionSystem.ts` | Allow the user to act as a deity, whisper commands to agents, and chat directly |
| 22 | **Prophets & Revelations** | `ReligionSystem.ts` | Prophet role transitions, daily prophetic tasks (sacrifices, warn, convert) |
| 23 | **Cults & Summoning** | `CultSystem.ts` | Founding cults, naming congregations, gathering sum-charge to summon invulnerable Demons |
| 24 | **Sanity & Corruption** | `ReligionSystem.ts`, `CultSystem.ts` | Permanent insanity behavior from existential shock, Priest corruption into hidden cultist |
| 25 | **Resolution Courts** | `JusticeSystem.ts`, `CourtPanel.ts` | Trial assemblies, LLM voter defenses, voting to Absolve, Exile, or Execute |
| 26 | **Political Camps** | `PoliticalSystem.ts`, `PolicyPanel.ts` | Division of town into Gentry/Commons; town assemblies to vote on economic/exile policies |
| 27 | **Office of the Alderman** | `PoliticalSystem.ts` | Reaching unanimous cult town conversion triggers election, granting decree power |
| 28 | **Outsider Escalation** | `OutsiderSystem.ts` | Spawn Knights (investigating death) and Inquisitors (combating cults) |
| 29 | **Story Narration HUD** | `StorySystem.ts`, `StoryNarrationPanel.ts` | Visual log detailing major town narrative milestones |
| 30 | **Vocation Systems & Idle Watchdog** | `Agent.ts`, `ScheduleSystem.ts` | stuck/idle watchdog triggering `idle_recovery` behavior |
| 31 | **Environmental Decay & Weather Corruption** | `EnvironmentSystem.ts`, `Renderer.ts` | Cult shrines/demons/rituals spread localized, reversible tile corruption: brackish water, blighted crops, persistent fog |
| 32 | **Eldritch Blight** | `EnvironmentSystem.ts`, `types/index.ts` | Sustained high corruption permanently converts a GRASS/WATER tile's actual `TileType` into `BLIGHTED`/`BRACKISH_WATER` -- a lasting scar that outlives the corrupting source, unlike the reversible tint above |
| 33 | **Dreamscape (planted & spontaneous nightmares)** | `ReligionSystem.ts`, `ScheduleSystem.ts`, `PromptBuilder.ts` | Deity ability plants a bias/nightmare into a sleeping, cult-unaligned villager's mind; the same villagers can also spontaneously nightmare on their own, odds scaled by town corruption and low sanity. Surfaces in reasoning and conversation, fades on next sleep |
| 34 | **Create Forbidden Relic deity ability** | `RelicSystem.ts`, `SimulationManager.ts`, `Renderer.ts`, `DebugOverlay.ts` | Deity ability to write and place a custom forbidden relic directly on the map. Unbelievers of the relic's associated deity gain the knowledge but face an 80% chance of immediate permanent insanity, unless shielded by cult conviction. |
| 35 | **Targeted Preaching** | `CultSystem.ts`, `DecisionEngine.ts`, `ScheduleSystem.ts` | A preaching cult member seeks out and travels to the nearest convertible villager instead of only sermonizing from the shrine |
| 36 | **Belief-Consistent Court Sentencing** | `JusticeSystem.ts` | Non-cultist voters cannot vote to punish an accusation they don't believe, and execution requires firm, high-confidence belief in a genuinely grave claim, otherwise the vote is downgraded to exile |
| 37 | **Low-Health Recovery** | `ScheduleSystem.ts` | Below 50 HP, an agent is compelled toward the apothecary once sleep/hunger needs are met, latching into recovery mode until fully healed; the exhaustion-sleep safety net no longer excludes insane agents |
| 38 | **Extended Cult Conviction Immunity** | `RelicSystem.ts`, `RumourSystem.ts` | Sanity-shielding from forbidden-knowledge revelations (rumours and relics alike) now covers every cultist — secret prophets, leaders, and rank-and-file members — not just leadership |
| 39 | **Alderman Political Fixes & Outsider/Relic Narration** | `PoliticalSystem.ts`, `OutsiderSystem.ts`, `AgentManager.ts`, `RelicSystem.ts`, `EnvironmentSystem.ts`, `StorySystem.ts` | Gentry voters lean against any village-funded policy spend by default; a deity-placed relic now fires its own `deity_relic_created` moment distinct from an organically-written one; Knight/Inquisitor arrivals and deaths, and an Alderman's naming, are chronicled; a successful Demon summon now instantly saturates the whole map's corruption to maximum |
| 40 | **Survivor Composition & Cult Extinction Story Beats** | `StorySystem.ts`, `AgentManager.ts` | Ticked every update: narrates once when every living villager belongs to a cult, once if a cult leader ends up the sole living survivor, and once when every cult that ever existed in the game has died out |
| 41 | **Cult Schemes** | `CultSystem.ts`, `SchemeValidator.ts`, `RelicSystem.ts`, `Agent.ts`, `PromptBuilder.ts`, `AIProvider.ts` | An LLM proposes a job-flavored covert scheme (which mechanical primitive, `relic_exposure` or `conversion_influence`, and a `subtle`/`moderate`/`bold` risk posture) for each cult leader once per simulated day; a validator rejects anything the leader's vocation doesn't afford (`JOB_AFFORDANCES`); the engine alone computes actual potency from the leader's ambition/faith/cult size/reputation, capped by the chosen risk; execution reuses the existing relic-creation and conversion-progress mutators, so discovery/counterplay is free via the existing Forbidden Relic pipeline |

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

### Action Types (31 values)
`move`, `talk`, `work`, `rest`, `attack`, `steal`, `destroy`, `help`, `flee`, `build`, `gather`, `eat`, `sleep`, `idle`, `investigate`, `interrogate`, `call_inquisitor`, `cry`, `pray`, `conjure`, `summon`, `resurrect`, `heal`, `bless`, `curse`, `ritual`, `preach`, `invite_cult`, `build_shrine`, `bribe`, `corrupt`

`corrupt` is not an LLM-chosen action — it is emitted by `EnvironmentSystem` when a tile crosses the visible corruption threshold (see below), not by any agent decision.

### Emotional States (12 values)
`happy`, `neutral`, `sad`, `angry`, `afraid`, `excited`, `tired`, `hungry`, `panicked`, `grieving`, `ambivalent`, `determined`

### Relationship Types (6 values)
`neutral`, `friend`, `enemy`, `ally`, `romantic`, `fear`

### Tile Types (8 values)
`grass`, `road`, `water`, `building`, `tree`, `path`, `blighted`, `brackish_water`

`blighted` and `brackish_water` are never placed by world generation -- they only ever appear as a runtime, permanent conversion of a `grass`/`water` tile by `EnvironmentSystem`'s Eldritch Blight mechanic.

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
- Tile grid: 60x40, each tile has type + walkability + optional building reference + optional `corruption` intensity (0..1, absent on untouched tiles)
- Procedurally generated each run: water clusters, crossroads, roads, 8 buildings, scattered trees
- Buildings placed near roads with collision checking
- Corruption is layered on top at runtime by `EnvironmentSystem`, not part of generation

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
- **Belief-Consistent Sentencing** — `enforceBeliefConsistentCourtVote` runs after every non-cultist voter's LLM/fallback vote (cult members follow their bloc's directed vote instead, per `applyCultCourtInfluence`, and are unaffected by this check). A voter who does not actually hold a believer stance on any of the claims is forced to `absolve` regardless of what the LLM chose. A voter who chose `execute` is downgraded to `exile` unless they believe a genuinely court-eligible ("grave") claim with at least 85% confidence — an execute vote otherwise reads as inconsistent with how firmly that voter actually believes the accusation.

### Political Camps Subsystem (`PoliticalSystem.ts`)
- **Political Camps (Gentry vs. Commons)** — Agents are split into wealth-ranked political camps.
- A Steward or high-reputation villager periodically calls town assemblies to vote on economic policies (boosting specific jobs with wealth) or banishing Knights/Inquisitors.
- **Office of the Alderman** — If a cult leader converts the entire village, they can run for Alderman (requiring a unanimous vote). Seating them grants absolute decree power, overriding court majority votes and assembly policies. A successful, unanimous election now also fires an `alderman_named` Story Narration moment.
- Gentry voters no longer lean toward supporting a wealth policy just because it favors Merchant/Steward trades — every wealth policy spends the village's funds, and the Gentry campLean is now a flat -0.4 against it regardless of beneficiary, with direct self-interest (the voter's own job matching the target job) as the remaining route to Gentry support.

### Story Narration Subsystem (`StorySystem.ts`)
- Chronicles major town events and milestones (cult formation, prophet appointments, demonic summons, trials, Alderman elections, outsider arrivals/deaths, deity relic manifestations, etc.).
- Feeds these moments to a custom UI panel (`StoryNarrationPanel`) for visual display and narrative tracking.
- `checkSurvivorComposition` and `checkCultExtinction` run every tick off `AgentManager`'s living-agent list rather than off any single death/exile event, since an agent can stop being alive through many separate paths (combat, starvation, suicide, execution, exile, sacrifice). Each narrates once per game: every living villager belonging to a cult (`only_cultists_survive`), a cult leader left as the sole living survivor (`cult_leader_sole_survivor`), and every cult that ever existed in the game having gone extinct (`cults_extinguished`, gated on a cult having actually existed at some point so a fresh village doesn't narrate its own absence).

### Scheduling Subsystem (`ScheduleSystem.ts`)
- Generates and validates each agent's daily plan, starts/completes timed activity blocks, and runs the fallback/idle-recovery, exhaustion-sleep, night-sleep, low-health-recovery, and storm-shelter-seeking checks every tick.
- Owns `activeBlocks`/`dailySchedules` and every other system reaches it only through the shared `SystemDeps.startBlock`/`getAbsoluteMinute` callbacks — nothing else on the timeline manipulates blocks directly.
- **Low-Health Recovery** (`enforceLowHealthRecovery`) — A sane, living, non-demon agent whose health drops below 50 is added to `recoveringHealthAgentIds` and stays there (even after ticking back above 50) until health reaches `maxHealth`, avoiding a stall right at the threshold. Once sleep (energy >= 90) and hunger (<= 40) needs are settled, and the agent isn't mid-sleep/flee/attack, it is redirected to `work` at the nearest apothecary for 30 minutes. Permanently insane agents are excluded, matching `enforceNightSleep`'s exclusion of the insane from routine, non-erratic behavior.
- `enforceExhaustionSleep` — the last-resort collapse safety net for an agent at zero energy — no longer excludes permanently insane agents. They're still excluded from the *normal* nightly schedule so their behavior reads as erratic, but excluding them from this net too made insanity a guaranteed, irreversible death sentence via unrecoverable exhaustion.

### Decision Engine (`DecisionEngine.ts`)
- Owns the per-agent LLM decision queue and `executeLLMDecision`, the dispatcher that turns a parsed LLM response into a concrete action (move/talk/attack/pray/preach/bribe/etc.) and routes it into whichever subsystem owns that action.
- The one place in the codebase that legitimately needs direct references to all eleven other systems, since a single decision can touch rumours, cult, religion, justice, or politics in the same turn.
- **Targeted Preaching** — a `preach` decision for a cult member now first calls `CultSystem.findNearestConvertTarget` to find the closest living, convertible, non-immune villager. If one exists and is farther than `PREACH_LISTEN_RADIUS - 3`, the agent moves toward them instead of the shrine; once in range, preaching proceeds targeting that villager. With no convert target, preaching falls back to the previous shrine-travel behavior. `ScheduleSystem`'s in-progress `preach` block tracks `stillTraveling` against the live convert target's distance (falling back to shrine-distance) so the travel phase resolves correctly either way.

### Social Subsystem (`SocialSystem.ts`)
- Detects agent-to-agent encounters, batches/pre-generates conversation turns, and builds the contextual dialogue (including rumour mentions) fed to the LLM for a conversation turn.

### Outsider Subsystem (`OutsiderSystem.ts`)
- Spawns and drives Knights (arrive after repeated deaths) and Inquisitors (arrive when a Priest confirms multiple cultists), including their patrol/pursuit/combat behavior once in the world.
- Each arrival fires its own `knight_called`/`inquisitor_called` Story Narration moment. `AgentManager.handleOutsiderKilled` listens on the same `attack`-death event `handleCultLeaderKilled` already watches and fires `knight_killed`/`inquisitor_killed` when the victim is a living outsider, rather than threading a story-moment call through every kill path (combat, sacrifice) that could end an outsider's life.

### Environment Subsystem (`EnvironmentSystem.ts`)
- Ticks once per simulated minute, collecting active corruption sources — cult shrines (scaled by living membership; a corrupted Priest's congregation anchors on its rededicated church instead, since that cult never builds a separate `CULT_SHRINE`), living Demons (strongest, moves with them), and in-progress summoning rituals — and spreads a decaying 0..1 corruption value into a sparse map of nearby tiles with distance falloff.
- Mirrors the current value directly onto `World.tiles[y][x].corruption` (rendered by `Renderer.ts` as a tint plus, past a heavier threshold, a persistent localized fog), so it persists for free through the existing tile save/load path; a small amount of bookkeeping state (which tiles have already been narrated) is snapshotted separately by `AgentManager`.
- Fires a one-time `land_corrupted` event and Story Narration moment the first time a water tile turns brackish or a farm's crop fails; other corrupted tiles remain visually affected without their own discrete event.
- Corruption only grows near an active source and decays back to zero once nothing sustains it, so the transient tint is a reversible, visible consequence of cult/demon activity rather than permanent world damage.
- **Eldritch Blight**: a GRASS/WATER tile that stays at or above `BLIGHT_THRESHOLD` for `BLIGHT_SUSTAIN_MINUTES` straight simulated minutes permanently converts its actual `TileType` to `BLIGHTED`/`BRACKISH_WATER` -- this survives the transient corruption value later decaying to zero, and the first such conversion ever fires its own `eldritch_blight` Story Narration moment distinct from `land_corrupted`.
- `advanceCorruption()` gates on `Math.floor(getAbsoluteMinute())`, not the raw value -- `SimulationManager.updateDayNight` advances simulated time as a continuously-changing float every frame, so comparing the unfloored value would make the "once per simulated minute" throttle (and therefore every rate constant tuned against it) fire on nearly every frame instead.
- **Map-Wide Demon Saturation** (`saturateWholeMap`) — the moment a bound Demon manifests (`ReligionSystem.summonDemon`, via `SystemDeps.saturateMapCorruption`), every tile on the map is slammed to full (1.0) corruption instantly, rather than letting corruption crawl outward from the summoning site at the usual `GROWTH_RATE`. Tiles outside the Demon's own `DEMON_RADIUS` still decay back down over time via the normal `advanceCorruption` loop once nothing else touches them — this only guarantees the map-wide shock of the manifestation itself.

### Relic Subsystem (`RelicSystem.ts`)
- When `RumourSystem.completeRumourInvestigation` finishes (any investigation, verified or not), there is a flat 16% chance (`RELIC_CREATION_CHANCE`) the investigator pens their findings into a `ForbiddenRelic` (`World.relics`, keyed by id, rendered on the map as a diamond marker and persisted for free through the existing world save/load path) instead of the finding simply living on the rumour. A relic created this way fires a `forbidden_relic_created` Story Narration moment.
- A separate roll (base 35% chance, raised by 30% if the author already carries `forbiddenKnowledge` entries, and by 15% if the rumour text is cult/ritual-flavored, up to an 85% cap) decides whether the relic's text actually contains forbidden knowledge. If it does, the author immediately risks their own sanity via `applyExistentialWitnessReaction(..., 'forbidden_relic')` -- the same denial/reinterpretation/obsession/nihilism/revelation/madness branching used elsewhere for reality-breaking reveals, up to and including permanent insanity.
- If the author belonged to a cult when they wrote it, the relic is tagged with that cult's id/name and deity (`chooseDeityName`); a relic with no cult tag has no conversion effect, only the forbidden-knowledge risk.
- `advanceRelics()` ticks once per simulated minute: any living agent who is not the author, not already a member of the relic's cult (or is a member of a group actively opposed to it), and wanders within `DISCOVERY_RADIUS` (2.5 tiles) of it triggers a one-time discovery -- applying the same existential-witness roll if the relic is forbidden, and, for a cult-tagged relic, a personality-weighted chance of `maybeTriggerWillingCultJoin` toward that deity. Each agent only ever triggers a given relic's discovery once (`ForbiddenRelic.discoveredByAgentIds`).
- A relic never decays or is consumed by discovery -- it stays on the map (and in the HUD's relic count) as a standing, re-discoverable hazard for every agent who passes near it afterward, unlike a rumour or a planted dream.
- **Deity Forbidden Relic Placement**: The player can invoke a Deity ability to construct and place a custom forbidden relic directly on a map grid tile, firing a `deity_relic_created` Story Narration moment distinct from an organically-written relic's. The relic is tagged with an associated deity and has a fixed severity of 90. If an agent wanders within the discovery radius:
  - If the agent already believes in the relic's associated deity (confidence >= 50%), they are unaffected and ignore the relic.
  - If they do not already believe in that deity, they gain the written text as forbidden knowledge (appended to `forbiddenKnowledge`), and face an immediate 80% chance of permanent insanity (triggering the `'madness'` reaction via `resolveExistentialReaction`) — **unless they are a cultist** (`agent.state.secretProphet || agent.state.cult != null`), whose conviction shields them from this roll entirely, the same exemption applied to forbidden-knowledge rumours. Otherwise, they resolve the knowledge via normal existential-witness reactions.

### Cult Scheme Subsystem (`CultSystem.ts`, `SchemeValidator.ts`)
- Every living cult leader/founder is offered one covert **scheme** per simulated day (`CultSystem.maybeProposeCultScheme`, gated like `ReligionSystem.ensureDailyPropheticClaim` but keyed per-leader rather than a single Prophet scalar): a job-flavored tactic that uses their public vocation as cover to advance the cult, built from `JOB_AFFORDANCES[job]` (per-job `buildingTypes`, `allowedPrimitives`, `baseJobPower`, `maxRelicSeverity`, `allowsForbiddenKnowledge` in `Agent.ts`) so every job's schemes are plausible for that vocation without any bespoke per-job code path.
- **LLM chooses strategy, engine decides efficacy.** `PromptBuilder.buildCultSchemePrompt`/`AIProvider.generateCultScheme` ask the LLM for exactly two mechanically-relevant choices — a `primitive` (`relic_exposure` or `conversion_influence`) and a `risk` posture (`subtle`/`moderate`/`bold`) — plus purely cosmetic narrative (cover story, method, steps). The LLM never outputs a numeric strength. `CultSystem.computeSchemeIntensity` derives the actual potency deterministically from the leader's own `personality.ambition`, `beliefSystem.faith`, `reputation`, and living cult size, then clamps it to a ceiling set by the chosen risk (subtle ≤30, moderate ≤65, bold ≤100) — a low-standing leader choosing "bold" gets no more power than their circumstances actually support.
- `SchemeValidator.validateSchemeProposal` rejects any LLM output whose primitive isn't in the job's `allowedPrimitives`, or whose risk isn't one of the three valid values, before it ever reaches execution; a rejection is logged as a dev-only `cult_scheme_validation_failed` event (leader, job, primitive, reason, attempt) and triggers one retry with the rejection reason folded into the follow-up prompt. Two failures fall back to a small hardcoded scheme per job (`CultSystem.FALLBACK_SCHEMES`) rather than blocking that leader's cycle. Every scheme records its `proposalSource` (`llm` / `llm_retry` / `fallback`) so it's possible to tell, while tuning, whether the local model is actually producing valid job-specific output.
- **Execution reuses existing mutators, adding no new mechanics.** A `relic_exposure` scheme calls `RelicSystem.createSchemeRelic`, planting a `ForbiddenRelic` near a building of the job's own type, with `severity`/`containsForbiddenKnowledge` derived from the computed intensity and the job's own ceiling (a low-intensity scheme from a job with `allowsForbiddenKnowledge` never crosses the forbidden-knowledge floor, so e.g. a middling carpenter's idol carries conversion risk without an immediate sanity threat). A `conversion_influence` scheme calls the existing `advanceCultConversionProgress` against listeners near the leader's own workplace. Once a scheme-planted relic is in `world.relics`, it goes through the exact same `RelicSystem.advanceRelics()`/`handleDiscovery()` proximity pipeline as any other relic — sanity risk, cult-join rolls, and eventual investigator discovery are all "free," no new counterplay code required.
- Every job affords `conversion_influence`; `relic_exposure` is available to Farmer, Carpenter, Merchant, Blacksmith, Healer, Steward, Innkeeper, and Priest (severity ceiling and forbidden-knowledge eligibility tuned per job's real-world plausibility — a merchant's trinket never carries true lore, a priest's consecrated object can). Town Guard is `conversion_influence`-only (no natural covert object to plant) but carries an elevated `baseJobPower`, reflecting a guard's coercive social leverage.
- Resolution narrates through the existing `StorySystem.queueStoryMoment` pipeline under two new kinds, `cult_scheme_relic_planted` and `cult_scheme_influence_spread`, styled to foreground the banality of the leader's ordinary labor concealing what was actually planted or spread.

### Dreamscape Subsystem (`ReligionSystem.ts` / `ScheduleSystem.ts`)
- `ReligionSystem.plantDream` is an invocation-gated Deity ability that plants free-text bias into a currently-sleeping, cult-unaligned villager's mind (`AgentState.dream`); cult members are immune, mirroring the existing Church-of-Christ shielding pattern.
- Whether it lands as an ordinary dream or a nightmare is rolled against the target's current sanity -- lower sanity raises the odds of a nightmare, which also drains extra sanity and sets fear.
- `ScheduleSystem.rollSpontaneousNightmare` runs the instant any cult-unaligned villager starts a fresh sleep block, independent of the player: odds are driven by `AgentManager.getTownCorruptionLevel()` (a 0..1 blend of `EnvironmentSystem`'s ambient tile corruption and the cult-affiliated share of the living population) plus the same sanity weighting, capped at 15%.
- Either source writes the same `AgentState.dream` shape; `PromptBuilder.formatDreamPersona` surfaces it explicitly in conversation prompts so the villager is nudged to bring it up unprompted, and it also reaches decision/schedule prompts naturally via the private memory event pushed alongside it. It clears automatically the next time that villager falls asleep.

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
