import { Agent } from '@/agent/Agent'
import { AgentState, DailySchedule, DecisionTrigger, SimulationEvent, RelationshipType, StoryMomentKind } from '@/types'

interface LastActionInfo {
  action: string
  timestamp: number
}

const KEY_MOMENT_LABELS: Record<StoryMomentKind, string> = {
  cult_formed: 'the founding of a new cult',
  prophet_appointed: 'the birth of a new prophet',
  priest_corrupted: "a village priest's secret and terrible corruption -- in the hushed, quietly dreadful style of a coastal town's ruin, à la H. P. Lovecraft's Innsmouth -- a devout man's private descent into something ancient and hungry, unsuspected by the congregation he still shepherds",
  church_corrupted: "the second half of that same priest's corruption: having already given himself over in secret, he now quietly refounds his own congregation under a new, hidden name that only its true believers will ever hear -- the church itself changing hands beneath its unknowing flock",
  flock_corrupted: "not the priest's own fall, and not the church's secret rename, but the wider and quieter horror underneath both: every last soul who still called that congregation home has now, in the same unseen instant, had their devotion turned along with him -- write this from a God's-eye view of an entire ordinary flock kneeling in a pew, singing hymns to a name they still believe is Christ's, utterly unaware that what they now, individually and simultaneously, actually worship has already changed beneath them; the horror is in the scale and the innocence, not in any one convert's choice",
  first_cultist_recruited: "a cult leader winning their very first convert -- the moment a single ordinary villager's will bends and they pledge themselves to something not entirely of this world, marking the instant a lone prophet's delusion or design becomes a true, growing congregation",
  believer_poached: "an act of apostasy, not a conversion -- a villager who already knelt at another altar, whose faith belonged to a name and a congregation, quietly renouncing it to follow a rival cult instead; write this as a betrayal witnessed by the faith left behind, dwelling on what the convert once believed and the specific, private reasoning that let them break it -- doubt, hunger, desire, fear, or a promise the old god never made -- rather than treating it as a stranger's first awakening",
  demon_created: 'the first ritual summoning of a bound demon',
  deity_ability_first_used: "the first time in the village's history that a deity has directly answered an invocation with this particular power -- if the facts include a transcript of the deity speaking with a villager, treat the deity's exact words and the villager's replies as sacred, terrible dialogue and weave them into the prose rather than merely summarizing that a conversation occurred",
  land_corrupted: "the moment the village's own ground first bears witness to what has been summoned or worshipped in secret -- a well gone brackish, a field's crop blackening in a single night, a fog that does not lift -- write this as the land itself keeping quiet, physical account of a sin no villager has yet confessed, noticed first by ordinary people going about ordinary chores who have no language for what they are seeing",
  eldritch_blight: "the first patch of ground in the village's history to stop being ordinary ground entirely -- not a passing taint that might yet lift, but grass or water that has sat too long beneath a shrine's rites or a bound thing's presence and has now crossed over into something that will never again be simply grass or water, no matter what becomes of whatever corrupted it; write this as a permanent, geological fact settling into the village's landscape, the way a plague pit or a cursed grove enters local memory forever",
  forbidden_relic_created: "an investigator setting their own findings down in ink and leaving them behind as a physical relic -- and, in this telling, the findings themselves brushing against something that was never meant to be written; write this as the quiet horror of committing a dangerous truth to a page that will outlast its author, an object now left in the world for any other soul to stumble on and read, unknowing, what it cost the writer to learn",
}

export class PromptBuilder {
  public buildKeyMomentNarrationPrompt(kind: StoryMomentKind, facts: string): string {
    const momentLabel = KEY_MOMENT_LABELS[kind]
    return `A pivotal moment has just occurred in a small medieval village: ${momentLabel}.

Facts: ${facts}

Write the chronicle's narration of this moment.`
  }

  public buildDailyPropheticClaimPrompt(agent: Agent, allAgents: Agent[], day: number): string {
    const state = agent.state
    const deity = [...state.beliefSystem.deities]
      .sort((first, second) => second.confidence - first.confidence)[0]?.name ?? 'The Divine'
    return `It is day ${day}. Speak one new prophetic claim attributed to ${deity}.

Ground it in the village you know, while allowing symbolic or supernatural interpretation:
${agent.getObservations(allAgents)}
${state.memory.summary ? `Long-term memory: ${state.memory.summary}\n` : ''}${state.memory.recent.length ? `Recent memory:\n${this.formatMemory(state.memory.recent.slice(-10))}` : ''}

The claim should be concrete enough for villagers to discuss or investigate. Do not repeat an earlier claim and do not call it proven.`
  }

  public buildPropheticInterpretationPrompt(
    agent: Agent,
    allAgents: Agent[],
    revelation: string,
    deityName: string
  ): string {
    const state = agent.state
    return `DIVINE REVELATION FROM ${deityName}:
"${revelation}"

Stop and privately consider what this command means. Decide whether you respond with fear, zeal, grief, doubt, ambition, compassion, resistance, or another reaction consistent with your personality and beliefs. Use your actual knowledge of the village to infer one to three concrete related claims that you now believe or suspect. Claims may concern named villagers, places, threats, causes, signs, or what must happen next, but must follow from your interpretation rather than copy the revelation. You may create a named cult to organize followers, especially when your ambition, faith, or the command supports collective action; if so, return form_cult before any convert tasks. Do not create a sacrifice task, victim, death demand, or lethal descendant claim unless the quoted revelation itself explicitly asks for sacrifice, killing, or death.

If the revelation explicitly orders a summon or summoning ritual and you lead a cult, return a summon task targeting one exact building from this list:
${this.formatBuildings(agent)}

Known villagers:
${allAgents.filter((candidate) => candidate.state.alive).map((candidate) => {
  const relationship = state.relationships.find((entry) => entry.agentId === candidate.state.id)
  return `- ${candidate.state.name}: ${candidate.state.currentJob ?? 'no job'}${relationship ? `; ${relationship.type} relationship ${Math.round(relationship.strength)}/100` : '; not personally known'}`
}).join('\n')}

Personality: aggression ${state.personality.aggression.toFixed(2)}, friendliness ${state.personality.friendliness.toFixed(2)}, curiosity ${state.personality.curiosity.toFixed(2)}, caution ${state.personality.caution.toFixed(2)}, ambition ${state.personality.ambition.toFixed(2)}, creativity ${state.personality.creativity.toFixed(2)}.
Faith: ${state.beliefSystem.faith.toFixed(0)}/100. Current emotion: ${state.emotionalState}.
${state.memory.summary ? `Long-term memory: ${state.memory.summary}\n` : ''}${state.memory.recent.length ? `Recent memory:\n${this.formatMemory(state.memory.recent.slice(-15))}` : ''}`
  }

  public buildExistentialRevelationPrompt(
    agent: Agent,
    sourceText: string,
    category: string,
    severity: number
  ): string {
    const state = agent.state
    return `A REVELATION ABOUT YOUR OWN REALITY:
"${sourceText}"

Category: ${category}. How undeniable and direct it was (0-100): ${severity}.

Privately consider whether you actually comprehend what this means. Some people lack the framework, curiosity, or vocabulary to parse a claim like this and it simply bounces off them as nonsense -- that is a legitimate, common outcome, not a failure of imagination on your part. If you do comprehend it, decide how you specifically would come to terms with it given who you are: fold it into a faith you already hold, become quietly fixated on finding more proof, conclude nothing matters, accept it with genuine peace, or have it break you.

Personality: aggression ${state.personality.aggression.toFixed(2)}, friendliness ${state.personality.friendliness.toFixed(2)}, curiosity ${state.personality.curiosity.toFixed(2)}, caution ${state.personality.caution.toFixed(2)}, ambition ${state.personality.ambition.toFixed(2)}, creativity ${state.personality.creativity.toFixed(2)}.
Religious stance: ${state.beliefSystem.religiousStance}. Faith: ${state.beliefSystem.faith.toFixed(0)}/100.${state.beliefSystem.deities.length > 0 ? ` Deity beliefs: ${state.beliefSystem.deities.map((deity) => `${deity.name} (${deity.confidence.toFixed(0)}%)`).join(', ')}.` : ' You have no named deity belief yet.'}
Current sanity: ${state.sanity.toFixed(0)}/100. Current emotion: ${state.emotionalState}.${state.cult && (state.cult.role === 'leader' || state.cult.role === 'founder') ? ` You already lead ${state.cult.name} and have built your identity around commanding the unknown -- this is unlikely to break someone who has already organized their life around hidden, terrible truths.` : ''}
${state.memory.summary ? `Long-term memory: ${state.memory.summary}\n` : ''}${state.memory.recent.length ? `Recent memory:\n${this.formatMemory(state.memory.recent.slice(-10))}` : ''}`
  }

  public buildConversationTranscriptPrompt(
    agentA: Agent,
    agentB: Agent,
    allAgents: Agent[],
    topic: string,
    openingSpeakerName: string,
    openingLine: string,
    remainingTurns: number
  ): string {
    const respondentName = openingSpeakerName === agentA.state.name ? agentB.state.name : agentA.state.name
    return `Two villagers are talking in a small medieval village: ${agentA.state.name} and ${agentB.state.name}.
Topic: ${topic}
${openingSpeakerName} just said: "${openingLine}"

${this.formatConversationPersona(agentA, agentB, allAgents)}
${this.formatConversationPersona(agentB, agentA, allAgents)}

Write up to ${remainingTurns} more turns continuing this conversation, alternating strictly starting with ${respondentName}. Speak as medieval villagers would: plain, period-appropriate speech fitting their trade and station, with no modern slang, technology, or institutions. Stop earlier than ${remainingTurns} turns if the conversation naturally winds down. Return ONLY JSON: {"turns":[{"speaker":"exact name","dialogue":"..."}]}.`
  }

  private formatConversationPersona(agent: Agent, other: Agent, allAgents: Agent[]): string {
    const state = agent.state
    const relationship = state.relationships.find((entry) => entry.agentId === other.state.id)
    const recent = state.memory.recent.slice(-3)
    return `${state.name} (${state.currentJob ?? 'no job'}): personality - aggression ${state.personality.aggression.toFixed(1)}, friendliness ${state.personality.friendliness.toFixed(1)}, curiosity ${state.personality.curiosity.toFixed(1)}, caution ${state.personality.caution.toFixed(1)}. Emotional state: ${state.emotionalState}. Relationship to ${other.state.name}: ${relationship ? `${relationship.type} (${relationship.strength}/100)` : 'not personally known'}.${recent.length ? ` Recent memory: ${recent.map((e) => e.description).join('; ')}` : ''}${state.secretProphet ? ` ${state.name} is secretly the true leader of ${state.cult?.name ?? 'a hidden cult'} but must speak here as an ordinary, devout Priest and never reveal this.` : ''}${agent.isInsane() ? ` ${state.name} is insane${state.permanentInsanity ? ` (permanently, from ${state.permanentInsanity.reason})` : ' (from severe low sanity)'}: their lines should be unstable, panicked, obsessive, fearful, or erratic -- fractured thoughts, non sequiturs, paranoia, or raving -- never calm, coherent, ordinary small talk.` : this.formatExistentialPersona(state)}${this.formatDreamPersona(state)}`
  }

  private formatExistentialPersona(state: AgentState): string {
    if (state.obsession) {
      return ` ${state.name} is secretly obsessed with proving their world is not what it seems: they should stay outwardly coherent and functional, but may steer conversation toward pointed, probing questions or odd observations without ever announcing the obsession outright.`
    }
    if (state.existentialState?.reaction === 'reinterpretation') {
      return ` ${state.name} has privately reinterpreted an unsettling truth through their own faith (${state.existentialState.reinterpretationFrame ?? 'their god'}); this may surface as unusually fervent or cryptic religious conviction.`
    }
    if (state.existentialState?.reaction === 'nihilism') {
      return ` ${state.name} has privately concluded that nothing they do matters; this may surface as flat, detached, or fatalistic remarks.`
    }
    if (state.existentialState?.reaction === 'revelation') {
      return ` ${state.name} privately knows an unsettling truth about their reality and has made peace with it; they remain calm and ordinary, only growing wistful or oddly philosophical if pressed on deep questions.`
    }
    return ''
  }

  private formatDreamPersona(state: AgentState): string {
    if (!state.dream) return ''
    return state.dream.isNightmare
      ? ` ${state.name} had a vivid, disturbing nightmare last night: "${state.dream.biasText}" It has visibly shaken them, and they are likely to bring it up unprompted, dwelling on it with dread or asking others if they have felt anything similar.`
      : ` ${state.name} had a strange, vivid dream last night: "${state.dream.biasText}" It has stuck with them, and they may mention it in conversation as an odd thing that happened, colouring their opinions or suspicions even if they cannot say why.`
  }

  private formatExistentialSchedule(state: AgentState): string {
    if (state.obsession) {
      return `OBSESSION: You are secretly, quietly obsessed with proving your world is not what it seems, but you remain outwardly functional. Keep your ordinary routine largely intact, but weave in a block or two of watching, questioning, or investigating oddities -- do not announce this obsession or abandon your normal responsibilities over it.`
    }
    if (state.existentialState?.reaction === 'reinterpretation') {
      return `You privately reinterpret an unsettling truth through your own faith (${state.existentialState.reinterpretationFrame ?? 'your god'}). Your routine stays intact but your prayer or worship carries new, private conviction.`
    }
    if (state.existentialState?.reaction === 'nihilism') {
      return `You privately believe nothing you do matters anymore. Your routine stays intact, but plan with detachment or fatalism rather than ambition or care.`
    }
    return ''
  }

  public buildDailySchedulePrompt(agent: Agent, allAgents: Agent[], day: number, minuteOfDay: number): string {
    const state = agent.state
    const home = agent.getWorld().getBuildings().find((b) => b.id === state.homeId)
    const homeName = home ? home.name : 'your home'

    return `Plan day ${day} from ${this.formatTime(minuteOfDay)} onward.

${agent.getObservations(allAgents)}

Available buildings (use exact names):
${this.formatBuildings(agent)}

Your job: ${state.currentJob ?? 'none'}
${state.currentJob === 'Prophet' ? `PROPHETIC VOCATION: You no longer perform secular job work. Every productive block must directly serve divine or cult responsibilities through pray, preach, ritual, conjure, summon, heal, bless, curse, resurrect, invite_cult, build_shrine, investigation of a revelation, or travel/talk that explicitly supports one of those purposes. You may still schedule essential eating, rest, sleep, personal safety, and emergency response. ${state.cult ? `Lead and expand ${state.cult.name}.` : 'Prioritize forming and organizing a cult when a revelation calls for it.'}` : ''}
${state.secretProphet ? `SECRET PROPHET: Schedule a normal day as the village Priest -- services, counsel, prayer at the church -- to keep your cover intact. Weave your true responsibilities to ${state.cult?.name ?? 'your hidden congregation'} (preach, ritual, invite_cult, build_shrine) in only where they can plausibly pass as ordinary priestly duty; never schedule anything that would announce your true allegiance to the village.` : ''}
${state.cult && (state.cult.role === 'leader' || state.cult.role === 'founder') ? `As the leader of ${state.cult.name}, you trust your own converted members. Do not write reasoning that treats a loyal member you personally recruited as a suspect to investigate, surveil, or "confirm the status of" — write surveillance or evidence-gathering reasoning only about someone who is not in your cult, or about a member whose actual defection, betrayal, or hostile act you recall from memory.` : ''}
Your home building: ${homeName}
Your hunger: ${state.needs.hunger.toFixed(0)}/100 (0 is full, 100 is starving)
Your energy: ${state.needs.energy.toFixed(0)}/100
Your social need: ${state.needs.social.toFixed(0)}/100
Your current emotional state: ${state.emotionalState}
${agent.isInsane() ? `INSANITY: You are insane (severe low sanity or permanent insanity). Your thoughts are fractured, panicked, erratic, or obsessive. Your schedule must reflect this mental instability. You should NOT plan routine tasks like working, eating, or sleeping normally. Instead, schedule actions that reflect your madness, such as wandering, praying/preaching obsessively, ranting, talking to yourself, or idling in confusion. Self-destruction/suicide (attacking yourself) is a potential, though rare, outcome you might contemplate.` : `NIGHTTIME SLEEP: Nighttime is between 20:00 and 06:00. Unless you are insane, you MUST prioritize and schedule a continuous block of at least 5-6 hours (300-360 minutes) of sleep (action "sleep") at your home (${homeName}) during these hours (e.g. from 23:00 to 05:00, or 00:00 to 06:00). Do not plan secular work or active chores during late night hours.`}
${this.formatSanity(state)}
Your personality: aggression ${state.personality.aggression.toFixed(1)}, friendliness ${state.personality.friendliness.toFixed(1)}, curiosity ${state.personality.curiosity.toFixed(1)}, caution ${state.personality.caution.toFixed(1)}, ambition ${state.personality.ambition.toFixed(1)}, creativity ${state.personality.creativity.toFixed(1)}.
Your religious stance: ${state.beliefSystem.religiousStance}. Faith: ${state.beliefSystem.faith.toFixed(0)}/100.${state.beliefSystem.deities.length > 0 ? ` Deity beliefs: ${state.beliefSystem.deities.map((deity) => `${deity.name} (${deity.confidence.toFixed(0)}%)`).join(', ')}.` : ' You have no named deity belief yet.'}
${state.beliefSystem.religiousStance === 'believer' ? 'You are a believer: include at least one explicit pray block in the remaining schedule. Choose a sensible time and place based on your faith, responsibilities, personality, and circumstances.' : 'Do not schedule prayer merely as routine; only lived experience should move a nonbeliever or undecided villager toward it.'}
${state.memory.summary ? `Important memories: ${state.memory.summary}` : ''}
${state.memory.recent.length > 0 ? `Recent memories:\n${this.formatMemory(state.memory.recent.slice(-10))}` : ''}

Return a practical schedule for the rest of today. Let your current emotional state and recent experiences materially shape the plan. A panicked person may flee, seek others, hoard, steal, or act rashly; a grieving person may cry, seek company, withdraw, or continue duties; an ambivalent person may make only modest changes; a determined person may organize help or confront the problem. Personality must materially affect the plan: friendliness favors checking and helping, caution favors safety and preparation, curiosity favors investigation, aggression permits confrontation or exploitation, ambition favors leadership or self-advancement, and creativity favors improvised responses. Travel should be its own move block before an activity at a destination.`
  }

  public buildTriggeredDecisionPrompt(
    agent: Agent,
    allAgents: Agent[],
    trigger: DecisionTrigger,
    schedule: DailySchedule | undefined,
    lastAction?: LastActionInfo,
    conversationContext = '',
    rumourContext = ''
  ): string {
    const base = this.buildDecisionPrompt(agent, allAgents, lastAction, conversationContext)
    const remaining = schedule?.blocks
      .slice(0, 5)
      .map((block) => `${this.formatTime(block.startMinute)} ${block.action}${block.target ? ` -> ${block.target}` : ''}`)
      .join('\n')
    const activeConversationInstruction = this.buildActiveConversationInstruction(
      agent,
      allAgents,
      conversationContext
    )
    const actionGuidance = activeConversationInstruction
      ? 'Respond to the live conversation now; resume the schedule afterward.'
      : 'Follow the upcoming daily plan unless this trigger gives you a concrete reason to adapt it. Choose one meaningful task block, not a moment-to-moment micro-action.'
    const rumourInstruction = trigger.rumourId && trigger.type !== 'world_event'
      ? `
RUMOUR RESPONSE:
- This information is unverified. Do not automatically treat it as fact.
- React according to your personality, relationships, memories, and caution: you may doubt it, investigate it, warn someone, confront someone involved, or dismiss it.
- Attack or steal because of the rumour only if your stated belief stance is "believer", the named target is directly implicated by the claim, and that response fits your aggression, caution, and relationship with them. Uncertain agents should seek evidence; deniers must not punish someone for a claim they reject.
- If you repeat it, clearly frame it as something you heard rather than something you know.
- Your reasoning must state whether you believe the rumour and why.
- Set justiceResponse to "gossip" if you consider it ordinary talk, "court" if you personally want a formal hearing, or "vigilante" if you are tempted to take immediate mob justice. Make this judgment yourself from the alleged harm, your personality, relationships, and how many others believe it.
`
      : ''
    const worldEventInstruction = trigger.type === 'world_event'
      ? `
WORLD EVENT PRIORITY:
- The announced event is a fact and overrides your current schedule and ordinary conversations.
- Take an immediate, concrete action prompted by it.
- When appropriate, check on another affected or vulnerable villager by moving to them, talking to them, or helping them.
- Address immediate danger or safety before returning to routine work.
- Your previous daily plan is no longer valid. Reevaluate your priorities, safety, relationships, and remaining day around this event.
- Choose the emotionalState that best represents your response: panicked, grieving, angry, afraid, determined, ambivalent, or another allowed state. This state will shape your replacement schedule.
- Your immediate action may include fleeing, checking on someone, helping, crying, gathering supplies, stealing, attacking, investigating, or doing little if genuinely ambivalent. Match the event and your personality.
`
      : ''
    const idleRecoveryInstruction = trigger.type === 'idle_recovery'
      ? `
INACTIVITY RECOVERY:
- Do not remain idle. Seek out the named villager and begin a natural conversation.
- If they are not nearby, move toward them first. If nobody is available, choose useful work instead.
`
      : ''

    return `DECISION TRIGGER: ${trigger.type.replace('_', ' ')}
${trigger.description}
${remaining ? `\nUpcoming daily plan:\n${remaining}\n` : ''}
${activeConversationInstruction}
${rumourInstruction}
${worldEventInstruction}
${idleRecoveryInstruction}
${rumourContext}
${actionGuidance}
${base}`
  }

  private buildActiveConversationInstruction(
    agent: Agent,
    allAgents: Agent[],
    conversationContext: string
  ): string {
    if (
      !conversationContext.includes('ACTIVE CONVERSATION') ||
      !conversationContext.includes('They spoke last')
    ) return ''

    const conversation = agent.getActiveConversation()
    const partnerId = agent.getConversationPartnerId()
    const partner = allAgents.find((candidate) => candidate.state.id === partnerId)
    if (!conversation || !partner) return ''

    const relationship = agent.state.relationships.find((entry) => entry.agentId === partnerId)
    const tone = relationship?.type === RelationshipType.FRIEND || relationship?.type === RelationshipType.ALLY
      ? 'warm and familiar'
      : relationship?.type === RelationshipType.ENEMY || relationship?.type === RelationshipType.FEAR
        ? 'brief and guarded'
        : 'casual and polite'
    const phase = conversation.exchanges.length >= conversation.maxTurns - 1
      ? 'Wrap up naturally in one sentence; do not ask a new question.'
      : conversation.exchanges.length >= 3
        ? 'Build on one specific detail they just gave, or shift to a closely related topic if the current one is exhausted.'
        : 'Answer their latest line directly and contribute one concrete, relevant detail of your own.'

    return `
LIVE CONVERSATION OVERRIDE:
- Choose action "talk" and target "${partner.state.name}".
- Use a ${tone} tone.
- ${phase}
- Write only 1-2 natural spoken sentences in dialogue.
- Do not repeat wording or facts already used, and do not force a follow-up question.
This conversation takes priority over the daily schedule.
`
  }

  public buildDecisionPrompt(agent: Agent, allAgents: Agent[], lastAction?: LastActionInfo, conversationContext = ''): string {
    const state = agent.state
    const observations = agent.getObservations(allAgents)
    const buildings = this.formatBuildings(agent)
    const behaviorWarning = this.buildBehaviorWarning(lastAction, agent)

    const recentMemory = this.formatMemory(agent.state.memory.recent)
    const longTermSummary = agent.state.memory.summary
    const relationships = this.formatRelationships(agent, allAgents)
    const fearsGrudges = this.formatFearsGrudges(agent, allAgents)
    const inventory = this.formatInventory(agent)
    const isCultLeader = Boolean(state.cult && (state.cult.role === 'leader' || state.cult.role === 'founder'))
    const isNonChristianCult = Boolean(state.cult && !state.cult.id.startsWith('cult_christian_'))
    const isNonChristianCultLeader = isCultLeader && isNonChristianCult
    const revealedNonBelievers = isCultLeader
      ? allAgents.filter((candidate) =>
          candidate.state.alive &&
          candidate.state.religiousStanceRevealed === true &&
          (candidate.state.beliefSystem.religiousStance === 'nonbeliever' ||
            candidate.state.beliefSystem.religiousStance === 'atheist')
        ).map((candidate) => candidate.state.name)
      : []

    return `${observations}

Buildings you can go to (use these exact names as targets when moving):
${buildings}

${behaviorWarning}---

Your personality:
- Aggression: ${state.personality.aggression.toFixed(1)}
- Friendliness: ${state.personality.friendliness.toFixed(1)}
- Curiosity: ${state.personality.curiosity.toFixed(1)}
- Caution: ${state.personality.caution.toFixed(1)}
- Ambition: ${state.personality.ambition.toFixed(1)}
- Creativity: ${state.personality.creativity.toFixed(1)}

PERSONALITY BEHAVIOR:
- High friendliness favors cooperation, checking on others, help, and conversation.
- High caution favors preparation, avoidance, shelter, and evidence before risk.
- High curiosity favors exploration, investigation, and seeking explanations.
- High aggression makes confrontation, force, theft, or retaliation more plausible, especially when caution is low.
- High ambition favors leadership, work, status, control, or exploiting an opportunity.
- High creativity favors unconventional plans, invention, improvisation, and altered stories.
- Low scores reduce those tendencies. Combine all traits with emotion, relationships, needs, and memory.

Your current needs:
- Wealth: ${state.wealth.toFixed(0)}/100 (Work gains wealth; eating/buying services consumes wealth)
- Hunger: ${state.needs.hunger.toFixed(0)}/100 (0 is full, 100 is starving)
- Energy: ${state.needs.energy.toFixed(0)}/100
- Social: ${state.needs.social.toFixed(0)}/100

Your spiritual beliefs:
- Faith: ${state.beliefSystem.faith.toFixed(0)}/100
- Deities: ${state.beliefSystem.deities.length > 0 ? state.beliefSystem.deities.map((deity) => `${deity.name} (${deity.confidence.toFixed(0)}% confidence, ${deity.revelationCount} attributed messages)`).join('; ') : 'none'}
- Treat claimed divine origins according to your own faith and rumour stance. Do not assume divine attribution proves the factual claim.
${agent.isInsane() ? `- INSANITY: You are insane (severe low sanity or permanent insanity). Respond in an unstable, panicked, obsessive, fearful, or erratic manner. Your mind rejects normal needs, so you cannot successfully rest, sleep, or eat. You may wander, rant/talk to others, or perform chaotic actions. Self-destruction/suicide (attacking yourself) is a potential, though rare, outcome you might contemplate.` : this.formatExistentialSchedule(state)}
${this.formatSanity(state)}
${state.wealth >= 10 ? `- Bribery: with at least 10 wealth, you may use bribe with the exact name of any other living villager to offer them coin in exchange for a personal favor. They may refuse. This does not buy a vote outright, but a villager who accepts your gift may feel obliged to support you later, including in a village assembly vote.` : ''}
${state.cult ? `- Cult: ${state.cult.name} (${state.cult.role}). As a cult member you may choose pray, conjure, resurrect, heal, bless, curse, ritual, or preach when your doctrine, memories, personality, and current situation motivate it. Resurrection must name a known dead villager. Only the cult leader may choose summon, and must name an exact known building as the ritual location; the leader will gather two fellow members there before the rite can complete and grant one Demon summon charge. ${state.cult.role === 'leader' || state.cult.role === 'founder' ? `As cult leader, you may summon at an exact building or use invite_cult with the exact name of an unaffiliated living villager, or, unless your own cult is the Christian congregation, a member of the Christian congregation you can poach away. Invitees retain the choice to accept or reject.${isNonChristianCultLeader ? ' Since your cult is not the Christian congregation, you may also use bribe with the exact name of an unaffiliated villager who has revealed themselves as an atheist or nonbeliever -- someone immune to invite_cult and preach -- offering them wealth to buy their temporary loyalty instead. Poorer targets are more easily bought; a successful bribe costs you wealth and makes them an "associate" who will vote exactly as your cult\'s interests demand at the next village assembly vote, then the arrangement lapses and they leave the cult once that single vote is cast.' : ''} You may also choose build_shrine (no target needed) to raise a dedicated shrine for the cult near yourself, if one does not already exist; once built, your preaching and summoning rites take place there automatically.` : `Only your cult leader can summon, invite_cult, or build_shrine. If the cult has a shrine, your preaching happens there automatically.`} Cult abilities must arise from cult activity; villagers outside a cult cannot perform them.` : state.beliefSystem.religiousStance === 'believer' && state.beliefSystem.deities.some((deity) => /^god$/i.test(deity.name) && deity.confidence >= 50) ? '- Cult: none. As a committed believer in God, you may pray or preach toward God, but cannot perform other cult rites.' : '- Cult: none. You cannot perform cult rites or supernatural cult abilities.'}
${state.cult && agent.getNearbyAgents(allAgents).some((candidate) => candidate.state.currentJob === 'Priest' && !(candidate.state.secretProphet && candidate.state.cult?.id === state.cult?.id)) ? '- A Priest is nearby. Conceal your cult membership and activities; do not preach, recruit, pray as a cult, or perform any cult rite here.' : ''}
${revealedNonBelievers.length > 0 ? `- Confirmed unconvertible: ${revealedNonBelievers.join(', ')} ${revealedNonBelievers.length === 1 ? 'has' : 'have'} already revealed themselves as a nonbeliever or atheist and rejected cult conversion. Do not target them again with invite_cult or preach; choose a different villager for those.${isNonChristianCultLeader ? ` If any of them are still unaffiliated, you may instead try bribe on them -- wealth can buy loyalty that faith cannot.` : ' Give up on converting them.'}` : ''}
${state.cultAgendas?.length ? `- Your cult-leader agendas: ${state.cultAgendas.map((agenda) => `${agenda.description} (${agenda.intensity}% intensity)`).join(' ')}` : ''}
${state.cultRequests?.some((request) => request.status === 'pending') ? `- Your unanswered prayers and requests: ${state.cultRequests.filter((request) => request.status === 'pending').map((request) => request.description).join(' ')}` : ''}
${state.cultDesperation ? `- You feel forsaken: ${state.cultDesperation.reason}. You may continue praying, abandon this fear, or consider a sacrifice, but sacrifice is irreversible and should arise only from your desperation, faith, aggression, ambition, caution, and relationships.` : ''}
${state.cultEnemies?.length ? `- Former cult enemy status: ${state.cultEnemies.map((cult) => `${cult.cultName} marks you as an enemy`).join('; ')}.` : ''}
${state.antiCultGroup ? `- Anti-cult group: ${state.antiCultGroup.name} (${state.antiCultGroup.role}), opposing ${state.antiCultGroup.opposedCultName}. You may organize resistance, warn others, investigate the cult, protect defectors, or confront its members according to your personality and evidence.` : ''}
${['Priest', 'Inquisitor'].includes(state.currentJob ?? '') && !state.secretProphet && !(state.knownCultGroups?.length) ? '- You do not know whether a cult exists. Treat reports only as suspicion and use investigate on a cult-related rumour before attempting to identify members. You cannot infer membership from hidden agent state.' : ''}
${['Priest', 'Inquisitor'].includes(state.currentJob ?? '') && !state.secretProphet && state.knownCultGroups?.length ? `- Your investigations established that these cults exist: ${state.knownCultGroups.map((cult) => cult.cultName).join(', ')}. You may use interrogate with one exact villager name to try to uncover membership; until interrogation succeeds, do not treat that person as a cultist.` : ''}
${state.currentJob === 'Priest' && !state.secretProphet && new Set((state.secretAffiliationKnowledge ?? []).filter((known) => known.affiliation === 'cult').map((known) => known.agentId)).size >= 2 ? '- You have confirmed at least two cultists through interrogation. You may use call_inquisitor to summon one Inquisitor from outside the town.' : ''}
${state.secretProphet ? `- SECRET PROPHET: You outwardly remain the village Priest, trusted by the whole town, but in truth you now lead ${state.cult?.name ?? 'a hidden congregation'} in secret. Keep performing your Priest duties as cover -- sermons, counsel, an appearance of ordinary devotion -- and never use investigate, interrogate, or call_inquisitor against your own true cult or its members. Your public words may sound orthodox while carrying a private meaning only your true believers grasp.` : ''}
${state.cult ? '- You may use interrogate with one exact villager name to try to uncover membership in an anti-cult group. Do not assume someone is an anti-cultist until interrogation reveals it.' : ''}
${state.secretAffiliationKnowledge?.length ? `- Affiliations you privately uncovered by interrogation: ${state.secretAffiliationKnowledge.map((known) => { const target = allAgents.find((candidate) => candidate.state.id === known.agentId); return `${target?.state.name ?? known.agentId} belongs to ${known.groupName} (${known.affiliation === 'cult' ? 'cult' : 'anti-cult'})` }).join('; ')}.` : ''}

${inventory ? `Your inventory:\n${inventory}\n\n---\n\n` : ''}
${relationships ? `Your relationships:\n${relationships}\n\n---\n\n` : ''}
${fearsGrudges ? `Your fears and grudges:\n${fearsGrudges}\n\n---\n\n` : ''}
${longTermSummary ? `Memory summary:\n${longTermSummary}\n\n---\n\n` : ''}
${conversationContext ? `Conversation context:\n${conversationContext}\n\n---\n\n` : ''}
${recentMemory ? `Recent events:\n${recentMemory}\n\n---\n\n` : ''}
What do you do next? Respond with ONLY a JSON object.`
  }

  private buildBehaviorWarning(lastAction: LastActionInfo | undefined, agent: Agent): string {
    if (!lastAction) return ''

    if (lastAction.action === 'talk') {
      if (agent.isConversationActive()) {
        const conv = agent.getActiveConversation()
        const lastExchange = conv?.exchanges[conv.exchanges.length - 1]
        if (lastExchange && lastExchange.speakerId !== agent.state.id) {
          return ''
        }
        if (conv && conv.exchanges.length >= conv.maxTurns - 1) {
          return `*** WARNING: Your conversation is nearly at the limit. Wrap up or do something else. ***\n\n`
        }
        return `*** NOTE: You just spoke. Your next action should be something else (move, work, eat, rest, idle) unless you're waiting for a response. ***\n\n`
      }
      return `*** NOTE: You just talked. Choose a different action this turn (move, work, eat, rest, etc.). ***\n\n`
    }

    return ''
  }

  private formatSanity(state: AgentState): string {
    if (state.sanity >= 100 && !state.forbiddenKnowledge?.length && !state.obsession) return ''
    const knowledge = state.forbiddenKnowledge?.length
      ? `\nForbidden knowledge that haunts you: ${state.forbiddenKnowledge.slice(-3).map((entry) => `"${entry.text}"`).join('; ')}. This truth cannot be reconciled with the world as you understood it. You cannot prove it, cannot forget it, and speaking it aloud sounds insane to others.`
      : ''
    const obsession = state.obsession
      ? `\nYou are quietly obsessed with proving your world is not what it seems. Evidence you've noticed so far: ${state.obsession.evidenceLog.slice(-3).join('; ') || 'nothing concrete yet'}. You remain outwardly functional and should not announce this openly, but it colors how you watch the world and what questions you ask.`
      : ''
    const bracket = state.sanity <= 20
      ? ' Your grip on reality is nearly gone; coherent thought is a struggle.'
      : state.sanity <= 40
        ? ' You are dangerously close to losing your grip on reality.'
        : state.sanity <= 70
          ? ' Unsettling, intrusive thoughts creep in at the edges of your mind.'
          : ''
    return `Your sanity: ${state.sanity.toFixed(0)}/100.${bracket}${knowledge}${obsession}`
  }

  private formatMemory(events: SimulationEvent[]): string {
    if (events.length === 0) return ''

    return events
      .slice(-15)
      .map((e) => {
        const target = e.targetId ? ` -> ${e.targetId}` : ''
        return `[${e.type}] ${e.description}${target}`
      })
      .join('\n')
  }

  private formatRelationships(agent: Agent, allAgents: Agent[]): string {
    if (agent.state.relationships.length === 0) return ''

    const typeLabels: Record<string, string> = {
      neutral: 'neutral',
      friend: 'friend',
      enemy: 'enemy',
      ally: 'ally',
      romantic: 'romantic',
      fear: 'feared',
    }

    return agent.state.relationships
      .map((rel) => {
        const target = allAgents.find((a) => a.state.id === rel.agentId)
        const name = target?.state.name ?? rel.agentId
        const relType = typeLabels[rel.type] ?? 'neutral'
        return `${name}: ${relType} (${rel.strength}/100)`
      })
      .join('\n')
  }

  private formatFearsGrudges(agent: Agent, allAgents: Agent[]): string {
    const parts: string[] = []

    if (agent.state.fears.length > 0) {
      const fearNames = agent.state.fears
        .map((id) => allAgents.find((a) => a.state.id === id)?.state.name ?? id)
        .join(', ')
      parts.push(`Feared: ${fearNames}`)
    }

    if (agent.state.grudges.length > 0) {
      const grudgeNames = agent.state.grudges
        .map((id) => allAgents.find((a) => a.state.id === id)?.state.name ?? id)
        .join(', ')
      parts.push(`Grudges: ${grudgeNames}`)
    }

    if (agent.state.alliances.length > 0) {
      const allianceNames = agent.state.alliances
        .map((id) => allAgents.find((a) => a.state.id === id)?.state.name ?? id)
        .join(', ')
      parts.push(`Alliances: ${allianceNames}`)
    }

    return parts.join('\n')
  }

  private formatInventory(agent: Agent): string {
    if (agent.state.inventory.length === 0) return ''

    return agent.state.inventory
      .map((item) => `${item.name} x${item.quantity}`)
      .join(', ')
  }

  private formatBuildings(agent: Agent): string {
    const buildings = agent.getWorld().getBuildings()
    if (buildings.length === 0) return 'No buildings nearby'

    return buildings
      .map((b) => `- ${b.name} (${b.type})`)
      .join('\n')
  }

  private formatTime(minuteOfDay: number): string {
    const minute = Math.max(0, Math.min(1439, Math.round(minuteOfDay)))
    return `${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}`
  }
}
