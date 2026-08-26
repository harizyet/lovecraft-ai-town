# Lovecraft AI Town Simulation
Framework forked from [AI Town](https://github.com/M1rceaDogaru/ai-town)

![AITown](ai-town.png)

> ## LLM Usage & Decisions
> Agent decisions are event-driven. Each agent requests a daily schedule once at the start of a simulated day, then requests a new decision only when a task block completes, another person comes into close proximity or interacts with them, or they witness a notable world event. LLM requests are serialized; a failed request retries immediately and blocks later requests so queued events remain ordered. Rendering and movement ticks do not call the LLM. Usage still depends on agent count, event frequency, and retries, so monitor costs when using a paid service.

A 2D simulated town where LLM-powered AI agents live, interact, make decisions, and cause real-world consequences. Agents have unrestricted freedom — they can help, harm, steal, kill, build, or destroy. All actions are logged with full causation chains.

Inspired by the research paper [Generative Agents: Interactive Simulacra of Human Behavior](https://arxiv.org/pdf/2304.03442).

---

## 🌟 Features

### 🏰 World & Vocation System
* **Procedural World Generation** — A 60x40 tile grid map with roads, water clusters, trees, and 8+ buildings featuring a two-tile clearance footprint and road-side collision alignment.
* **Medieval Jobs & Workplaces** — Agents are assigned to realistic medieval vocations (e.g., Blacksmith at the smithy, Carpenter at the carpenter's workshop, Merchant at the market, Town Guard at the guardhouse, Healer at the apothecary, Steward at the manor, Innkeeper at the tavern, Farmer at the farm, Priest at the church).
* **Inactivity Watchdog** — Tracks and resolves agent inactivity; if an agent is stuck or idle for 15 simulated minutes, it triggers an `idle_recovery` pathfinding action to find nearby agents for conversation or fall back to useful work.

### 🗣️ Rumours, Whispers & Belief Dynamics
* **Organic Rumour Propagation** — Significant events (theft, injuries, deaths, property damage) seed natural rumours. Agents share unverified claims during dialogue.
* **Corroboration & Credibility** — Multi-source tracking adjusts credibility based on speaker reputation. Semantically related claims naming the same agent, building, or event corroborate each other, reinforcing personal belief stances.
* **Extreme Belief Bias** — Controlled by `rumourExtremeBeliefProbability`, exposing agents to immediate full belief or denial of claims. Direct whispers seed locked believer stances, except for atheists who reject whispers.
* **Prophets & Divine Revelations** — The first agent to accept a direct divine whisper changes their vocation to a **Prophet**. They receive daily LLM-generated prophetic revelations, command executable tasks (e.g., sacrifice, warn, convert), and found cults.
* **Faith & Atheism** — Agents track faith levels and deity confidence. The town begins with at least one atheist (capped faith) who resists preaching/recruitment, while others can convert, grow in faith, or lose faith.

### 👿 Cults, Rituals & Demonic Forces
* **Cult Mechanics & Shrines** — Cult leaders recruit members (`form_cult`), who gain specialized tasks (`pray`, `heal`, `bless`, `curse`, `resurrect`). Leaders deterministicly build physical shrines near them, directing cult sermons and rites to that preferred location.
* **Demonic Summoning** — Cult leaders lead collective summoning rites, gathering fellow members to generate a Demon summon charge. Summoned Demons are invulnerable (666 HP, ignoring ordinary damage) and pursue user-defined attack or travel commands.
* **Permanent Insanity** — Witnessing Demon manifestations or targeted divine actions can drive non-cultist/nonbelieving agents permanently insane, forcing panicked and erratic behaviors that persist through saves and reloads.
* **Corruption Twists** — Direct whispers to a Priest can corrupt them, making them a hidden Prophet/cult leader. They rename their congregation to evoke ancient, inhuman deities while retaining their public Priest facade to avoid suspicion.
* **Defection & Mobs** — Disillusioned members defect, becoming enemies of their former cult and potentially forming anti-cult groups. High-aggression cults can form mobs to hunt down and attack nonbelievers.

### ⚖️ Justice & Politics
* **Resolution Courts** — When a rumour reaches everyone in town (or an authority override triggers), the village gathers at the town square for a trial. The accused delivers an LLM defense, and villagers vote to **Absolve**, **Exile** (inactive/hidden state), or **Execute** (permanent death).
* **Political Camps (Gentry vs. Commons)** — Agents are split into wealth-ranked political camps. A Steward or high-reputation villager periodically calls town assemblies to vote on economic policies (boosting specific jobs with wealth) or banishing Knights/Inquisitors.
* **Office of the Alderman** — If a cult leader converts the entire village, they can run for Alderman (requiring a unanimous vote). Seating them grants absolute decree power, overriding court majority votes and assembly policies.
* **Escalating Outsider Forces** — External threats trigger arrival events: **Knights** (`🛡`) arrive at the border to investigate after two non-exile deaths; **Inquisitors** (`⚖`) arrive to combat cults if a Priest confirms multiple cultist identities.

### 🖥️ Interface & Debugging
* **Rumour & Belief Tracker** — A collapsible left-side HUD displaying active/archived claims, reach, source credibility, individual agent stances, and a live timeline of private thoughts.
* **Visual Role Badges** — Agent overlays and lists display unique icons for Prophets (`✦`), Knights (`🛡`), Inquisitors (`⚖`), and Demons (`☠`).
* **Detailed Agent Inspect Tool** — Full state inspector showcasing needs, personality, memory summaries, active behaviors, and relationship charts.
* **Simulation controls** — Speed adjustment, pause/resume (Space), day/night lighting filter overlay, and F1 Debug console.
* **Log export** — Expose and download all simulated events with causation chains as JSON/CSV.

---

## 🛠️ Tech Stack

* **TypeScript 6.0 + Vite 8** — Fast compilation and development iteration.
* **Canvas API** — Lightweight 2D engine without heavy third-party graphics libraries.
* **OpenAI-Compatible API Interface** — Built to interact with local LLMs (e.g., LM Studio, Ollama).
* **Custom A\* Pathfinding** — 4-directional Manhattan pathfinder with smooth interpolation.
* **Zero Runtime Dependencies** — Clean, performant implementation.

---

## 🚀 Quick Start

### Prerequisites
1. **Local LLM server** running (LM Studio or OpenAI-compatible endpoint).
2. **Node.js 18+**

### Installation
```bash
npm install
npm run dev
```

Open the local Vite URL (e.g., `http://localhost:5173`) in your browser to start the simulation.

---

## ⚙️ Configuration

Modify config parameters in [src/main.ts](file:///home/hariz/village/ai-town/src/main.ts):

| Setting | Default / Value | Description |
|---------|-----------------|-------------|
| `llmEndpoint` | `'http://10.180.1.54:8000'` | LLM Server completions endpoint |
| `llmModel` | `'OpenVINO/Qwen2.5-1.5B-Instruct-int4-ov'` | LLM model identifier |
| `agentCount` | `10` | Number of living agents initialized |
| `mapWidth` / `mapHeight` | `60` / `40` | Grid tile dimensions |
| `tileSize` | `32` | Grid size in pixels |
| `conversationChanceMultiplier` | `2` | Multiplier for greeting unfamiliar agents |
| `rumourPropagationMultiplier` | `2` | Scales rumor-driven encounter probability & mutations |
| `inventedRumourProbability` | `0.01` | Probability of conversation creating a new rumor |
| `rumourExtremeBeliefProbability` | `0.2` | Chance of locking into full belief/denial on first exposure |
| `memoryBufferSize` | `25` | Number of events preserved in recent memory |

---

## 🎮 Controls

| Key | Action |
|-----|--------|
| **WASD / Arrows** | Pan camera |
| **+ / -** | Zoom in / out |
| **1-9** | Follow agent by index |
| **Space** | Pause / resume simulation |
| **F1** | Toggle debug overlay |
| **Click** | Select agent to inspect |

---

## 📐 Architecture & Structure

```
ai-town/
├── src/
│   ├── types/
│   │   └── index.ts                   # Shared TypeScript interfaces & types
│   ├── world/
│   │   └── World.ts                   # Grid generation, buildings & clearance logic
│   ├── agent/
│   │   ├── Agent.ts                   # Individual agent parameters, needs, traits, memory
│   │   ├── AgentManager.ts            # Thin orchestrator: wiring, main loop, snapshot save/restore
│   │   └── systems/                   # Extracted subsystems (see below)
│   │       ├── RumourSystem.ts        # Rumour creation, propagation, belief, investigation
│   │       ├── CultSystem.ts          # Cult formation, leadership, conversion, shrines, mobs
│   │       ├── ReligionSystem.ts      # Faith, prophets, revelations, deity chat & abilities
│   │       ├── JusticeSystem.ts       # Resolution courts: defense, votes, verdicts
│   │       ├── PoliticalSystem.ts     # Gentry/Commons camps, policy votes, Alderman, bribery
│   │       ├── ScheduleSystem.ts      # Daily plans, activity blocks, idle/weather/exhaustion handling
│   │       ├── DecisionEngine.ts      # LLM decision queue & the action dispatcher
│   │       ├── SocialSystem.ts        # Encounters, conversation batching & context
│   │       ├── OutsiderSystem.ts      # Knight/Inquisitor spawning & combat
│   │       ├── StorySystem.ts         # Narrates major story moments
│   │       └── SystemDeps.ts          # Shared dependency-injection interface between systems
│   ├── ai/
│   │   ├── AIProvider.ts              # OpenAI HTTP client & markdown stripping
│   │   └── PromptBuilder.ts           # Prompt engineering and instruction building
│   ├── simulation/
│   │   └── SimulationManager.ts       # Central game loop, tick updates & weather
│   ├── rendering/
│   │   ├── Renderer.ts                # Canvas 2D engine, text tags & overlay filters
│   │   ├── Camera.ts                  # Target tracking & interpolation
│   │   ├── DebugOverlay.ts            # Sidebar debug, whispers & JSON/CSV log export
│   │   ├── ConversationPanel.ts       # Active conversation UI
│   │   ├── CourtPanel.ts              # Resolution court trial UI
│   │   ├── PolicyPanel.ts             # Town assembly / policy vote UI
│   │   ├── StoryNarrationPanel.ts     # Story moment narration UI
│   │   └── DeityChatPanel.ts          # Whisper & deity command UI
│   ├── interaction/
│   │   ├── EventBus.ts                # Wildcard-supported pub/sub dispatcher
│   │   ├── AgentInteraction.ts        # Direct interactions (help, attack, steal, etc.)
│   │   ├── ConversationManager.ts     # Conversation state machine
│   │   └── WorldInteraction.ts        # Structural world actions (harvest, work, build shrine)
│   ├── utils/
│   │   ├── AStarPathfinder.ts         # Pathfinding implementation
│   │   ├── RumourRules.ts             # Static rules for rumour eligibility/classification
│   │   ├── ForbiddenKnowledgeRules.ts # Rules for forbidden/existential claim classification
│   │   ├── PolicyRules.ts             # Policy proposal catalog
│   │   └── JobIcons.ts                # Vocation icon map
│   └── main.ts                        # Main launcher and config setup
```

`AgentManager.ts` used to be a single ~11,000-line class holding every subsystem as inline
private methods; it's now ~1,200 lines of pure orchestration, with each subsystem broken out
into its own file under `src/agent/systems/`, communicating through the shared `SystemDeps`
interface rather than reaching into each other directly. `SimulationManager.ts` and every
rendering panel only ever called `AgentManager`'s public API, so the split required zero
changes outside `agent/`.

Refer to [SOCIAL.md](./SOCIAL.md) and [AGENTS.md](./AGENTS.md) for deeper implementation and feature documentation.
