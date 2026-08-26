import { Rumour } from '@/types'

const COURT_WORTHY_ALLEGATION = /\b(?:attack(?:ed|ing)?|assault(?:ed|ing)?|beat(?:en|ing)?|kill(?:ed|ing)?|murder(?:ed|ing)?|execut(?:e|ed|ing)|die|death|steal(?:ing)?|stole|stolen|theft|rob(?:bed|bing|bery)?|destroy(?:ed|ing)?|arson|burn(?:ed|ing)?|crime|criminal|betray(?:ed|al|ing)?|abuse(?:d|ing)?|harm(?:ed|ing)?|poison(?:ed|ing)?|kidnap(?:ped|ping)?|sabotage(?:d|ing)?|guilty|accus(?:e|ed|ation)|threat(?:en|ened|ening)?|fraud|corrupt(?:ion|ed)?|must\s+die|needs?\s+to\s+die)\b/i

const CULT_ALLEGATION = /\b(?:cult|cultist|secret\s+sect|forbidden\s+rite|hidden\s+shrine|heretic(?:al)?|hooded\s+figures?)\b/i

export function isCourtEligibleRumour(
  rumour: Pick<Rumour, 'text' | 'courtEligible'>
): boolean {
  return rumour.courtEligible === true ||
    COURT_WORTHY_ALLEGATION.test(rumour.text) ||
    CULT_ALLEGATION.test(rumour.text)
}

export function classifyCourtEligibility(text: string): boolean {
  return COURT_WORTHY_ALLEGATION.test(text) || CULT_ALLEGATION.test(text)
}

export function isCultRelatedRumour(text: string): boolean {
  return CULT_ALLEGATION.test(text)
}
