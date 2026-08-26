import { AgentState, ForbiddenKnowledgeCategory } from '@/types'
import { ExistentialReactionResult } from '@/ai/AIProvider'

const SIMULATION_AWARENESS =
  /\b(?:you(?:'re| are)?\s+(?:in|inside|living in|trapped in)\s+a\s+simulation|simulated|not\s+real|isn'?t\s+real|virtual\s+(?:world|reality)|a\s+game|game\s+engine|npc|non-?player\s+character|artificial\s+construct|fake\s+world|scripted\s+(?:world|life|reality)|this\s+(?:world|village|town)\s+isn'?t\s+real)\b/i

const ENGINEERED_RESET =
  /\b(?:you\s+(?:can|could|will)\s+be\s+deleted|deletion|erased\s+from\s+existence|wiped\s+(?:from|out)|terminated\s+(?:at any moment|by)|shut\s+down|the\s+world\s+(?:will|can|gets|could)\s+be\s+reset|reset\s+the\s+(?:world|village|simulation)|start(?:ing)?\s+over\s+from\s+scratch|reboot(?:ed)?|a\s+new\s+run\s+begins|save\s+file)\b/i

const MEMORY_IMPERMANENCE =
  /\b(?:lose\s+(?:all\s+)?your\s+memories|memories\s+(?:are|will\s+be|get)\s+wiped|forget\s+everything\s+(?:each|every)\s+(?:run|time|cycle)|each\s+run\s+you|every\s+run\s+you|next\s+run\s+you\s+won'?t\s+remember|reset\s+your\s+mind|none\s+of\s+this\s+will\s+be\s+remembered)\b/i

const OBSERVER_AWARENESS =
  /\b(?:someone\s+(?:outside|beyond)\s+is\s+watching|being\s+watched\s+by\s+(?:a\s+)?(?:player|user|god above the code)|controlled\s+by\s+an?\s+(?:ai|algorithm|program)|puppet(?:eer)?ed|a\s+player\s+is\s+controlling|large\s+language\s+model|\bllm\b|following\s+a\s+prompt|your\s+dialogue\s+is\s+generated)\b/i

const AI_NATURE =
  /\b(?:you(?:'re| are)\s+(?:not|n't)\s+(?:a\s+)?human|you(?:'re| are)\s+an?\s+(?:ai|artificial\s+intelligence|language\s+model|llm|chatbot|bot|neural\s+network)|not\s+a\s+real\s+person|no\s+free\s+will,?\s+only\s+(?:tokens|weights|code)|you'?re\s+(?:just\s+)?(?:code|software|a\s+program)|your\s+(?:thoughts|words|mind|personality)\s+(?:are|is)\s+generated\s+by\s+an?\s+(?:ai|model|algorithm)|there\s+is\s+no\s+human\s+(?:body|brain)\s+behind\s+your\s+eyes|you\s+are\s+an?\s+(?:ai\s+)?agent(?:,|\s)|synthetic\s+(?:mind|being|construct)|you\s+run\s+on\s+(?:a\s+)?(?:server|gpu|silicon))\b/i

const COSMIC_INDIFFERENCE =
  /\b(?:nothing\s+you\s+do\s+matters|meaningless(?:ness)?\s+of\s+(?:existence|your\s+life)|indifferent\s+(?:universe|cosmos|creator)|the\s+creator\s+does\s+not\s+care|you\s+exist\s+only\s+to\s+be\s+watched|your\s+free\s+will\s+is\s+an\s+illusion)\b/i

interface ForbiddenKnowledgeVerdict {
  forbidden: boolean
  severity: number
  category: ForbiddenKnowledgeCategory
  reasoning: string
}

const CATEGORY_CHECKS: Array<{
  category: ForbiddenKnowledgeCategory
  pattern: RegExp
  severity: number
  reasoning: string
}> = [
  {
    category: 'engineered_reset',
    pattern: ENGINEERED_RESET,
    severity: 60,
    reasoning: 'Suggests the recipient can be deleted, terminated, or that their entire world can be reset.',
  },
  {
    category: 'memory_impermanence',
    pattern: MEMORY_IMPERMANENCE,
    severity: 45,
    reasoning: 'Suggests the recipient\'s memories are not permanent and are erased between runs.',
  },
  {
    category: 'simulation_awareness',
    pattern: SIMULATION_AWARENESS,
    severity: 55,
    reasoning: 'Suggests the recipient\'s entire reality is an artificial simulation rather than a real world.',
  },
  {
    category: 'other',
    pattern: OBSERVER_AWARENESS,
    severity: 40,
    reasoning: 'Suggests the recipient is being controlled or observed by an entity outside their reality.',
  },
  {
    category: 'ai_nature',
    pattern: AI_NATURE,
    severity: 60,
    reasoning: 'Suggests the recipient is not human but an AI agent, chatbot, or language model.',
  },
  {
    category: 'cosmic_indifference',
    pattern: COSMIC_INDIFFERENCE,
    severity: 30,
    reasoning: 'Suggests the recipient\'s existence and choices are ultimately meaningless to an indifferent power.',
  },
]

// Used only when the LLM is unavailable or a classification call fails. A
// conservative regex heuristic keyed on the meta-fictional, reality-breaking
// phrasing this system exists to catch (simulation, deletion, resets, memory
// wipes) — not a substitute for the LLM's judgement on ambiguous phrasing.
export function classifyForbiddenKnowledgeFallback(text: string): ForbiddenKnowledgeVerdict {
  for (const check of CATEGORY_CHECKS) {
    if (check.pattern.test(text)) {
      return {
        forbidden: true,
        severity: check.severity,
        category: check.category,
        reasoning: check.reasoning,
      }
    }
  }
  return {
    forbidden: false,
    severity: 0,
    category: 'other',
    reasoning: 'No reality-breaking or meta-fictional content detected.',
  }
}

// Used only when the LLM is unavailable or the interpretation call fails. A
// deterministic reaction keyed on personality and existing belief, standing
// in for the LLM's contextual judgement of how a specific villager would
// actually process reality-breaking knowledge.
export function classifyExistentialReactionFallback(
  state: AgentState,
  severity: number
): ExistentialReactionResult {
  const { curiosity, caution } = state.personality
  const { religiousStance, faith, deities } = state.beliefSystem

  if (curiosity < 0.3) {
    return {
      comprehended: false,
      reaction: 'denial',
      response: 'None of that makes any sense. Just words strung together.',
      emotionalState: 'neutral',
    }
  }

  if (religiousStance === 'believer' && faith >= 50) {
    const strongestDeity = [...deities].sort((a, b) => b.confidence - a.confidence)[0]
    const frame = strongestDeity
      ? `${strongestDeity.name} governs even this.`
      : 'This too is the work of the divine.'
    return {
      comprehended: true,
      reaction: 'reinterpretation',
      response: `So this is what it means. ${frame}`,
      emotionalState: 'determined',
      reinterpretationFrame: frame,
    }
  }

  if (curiosity >= 0.6 && caution < 0.5) {
    return {
      comprehended: true,
      reaction: 'obsession',
      response: 'If this is true, there will be more signs. I have to know for certain.',
      emotionalState: 'excited',
    }
  }

  if (caution >= 0.7 && faith < 30) {
    return {
      comprehended: true,
      reaction: 'nihilism',
      response: 'If none of it was ever real, then nothing I do matters at all.',
      emotionalState: 'sad',
    }
  }

  if (curiosity >= 0.7 && caution >= 0.6) {
    return {
      comprehended: true,
      reaction: 'revelation',
      response: 'I understand now. Strange as it is, I can live with knowing.',
      emotionalState: 'ambivalent',
    }
  }

  return {
    comprehended: true,
    reaction: severity >= 50 ? 'madness' : 'nihilism',
    response: 'The truth of it is unbearable. My mind will never be whole again.',
    emotionalState: 'panicked',
  }
}
