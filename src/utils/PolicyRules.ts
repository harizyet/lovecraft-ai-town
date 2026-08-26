import { PolicyProposal } from '@/types'

export const POLICY_PROPOSALS: PolicyProposal[] = [
  {
    id: 'grow_more_crops',
    question: 'Should the village invest in growing more crops?',
    description: 'Clear more fields and dedicate more labor to farming, expanding the harvest.',
    targetJob: 'Farmer',
    wealthDelta: 15,
  },
  {
    id: 'expand_trade',
    question: 'Should the village expand trade with neighboring settlements?',
    description: 'Open new trade routes and stock the market with a wider range of goods.',
    targetJob: 'Merchant',
    wealthDelta: 15,
  },
  {
    id: 'strengthen_guard',
    question: 'Should the village strengthen its guard?',
    description: 'Fund more arms, armor, and patrols to keep the town and its roads safe.',
    targetJob: 'Town Guard',
    wealthDelta: 15,
  },
  {
    id: 'fund_apothecary',
    question: 'Should the village fund the apothecary?',
    description: 'Stock the apothecary with rarer remedies and pay for its upkeep.',
    targetJob: 'Healer',
    wealthDelta: 15,
  },
  {
    id: 'commission_construction',
    question: 'Should the village commission new construction?',
    description: 'Commission new buildings and repairs, keeping carpenters steadily employed.',
    targetJob: 'Carpenter',
    wealthDelta: 15,
  },
]

export function pickNextPolicyProposal(recentlyUsedIds: string[]): PolicyProposal {
  const unused = POLICY_PROPOSALS.filter((proposal) => !recentlyUsedIds.includes(proposal.id))
  const pool = unused.length > 0 ? unused : POLICY_PROPOSALS
  const proposal = pool[Math.floor(Math.random() * pool.length)]
  return { ...proposal, effect: 'wealth' }
}

export function buildOutlawCultProposal(cultId: string, cultName: string): PolicyProposal {
  return {
    id: `outlaw_cult_${cultId}`,
    question: `Should the village outlaw ${cultName}?`,
    description: `An investigation has confirmed that ${cultName} truly exists within the village. The assembly may formally ban it.`,
    targetJob: '',
    wealthDelta: 0,
    effect: 'outlaw_cult',
    effectSummary: `If passed, ${cultName} is banned and every living member is stripped of membership.`,
    targetCultId: cultId,
    targetCultName: cultName,
  }
}

export function buildProposeAldermanProposal(
  leaderId: string,
  leaderName: string,
  cultId: string,
  cultName: string
): PolicyProposal {
  return {
    id: `propose_alderman_${leaderId}`,
    question: `Should the village name ${leaderName} as Village Alderman?`,
    description: `${leaderName} asks the assembly to grant them the office of Alderman, with binding authority over the village's resolution court and its votes. This office is not tenured — it must be granted unanimously by every living villager to take effect.`,
    targetJob: '',
    wealthDelta: 0,
    effect: 'propose_alderman',
    effectSummary: `If passed, ${leaderName} becomes Village Alderman: resolution court verdicts and assembly votes will thereafter follow ${leaderName}'s decision directly.`,
    targetCultId: cultId,
    targetCultName: cultName,
    targetLeaderAgentId: leaderId,
    targetLeaderName: leaderName,
  }
}

export function buildOutlawOutsiderProposal(
  kind: 'knight' | 'inquisitor',
  agentId: string,
  agentName: string
): PolicyProposal {
  const role = kind === 'knight' ? 'Knight' : 'Inquisitor'
  return {
    id: `outlaw_${kind}_${agentId}`,
    question: `Should the village outlaw the ${role}, ${agentName}?`,
    description: `Some who sit in this assembly are themselves bound to a hidden cult, and fear what ${agentName} may uncover about them. The assembly may vote to banish ${agentName} from the village.`,
    targetJob: '',
    wealthDelta: 0,
    effect: kind === 'knight' ? 'outlaw_knight' : 'outlaw_inquisitor',
    effectSummary: `If passed, ${agentName} the ${role} is banished from the village.`,
    targetOutsiderAgentId: agentId,
    targetOutsiderName: agentName,
  }
}
