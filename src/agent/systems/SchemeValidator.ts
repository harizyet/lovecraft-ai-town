import { Job, CultScheme, CultSchemePrimitive, CultSchemeRisk, CULT_SCHEME_PRIMITIVES, CULT_SCHEME_RISKS } from '@/types'
import { JOB_AFFORDANCES } from '@/agent/Agent'

export interface RawSchemeProposal {
  primitive: string
  risk: string
  narrative: { coverStory: string; method: string; steps: string[] }
}

export interface SchemeValidationResult {
  ok: boolean
  scheme?: { primitive: CultSchemePrimitive; risk: CultSchemeRisk; narrative: CultScheme['narrative'] }
  reason?: string
}

// Validates untrusted LLM output against what the leader's job actually
// affords. `job` arrives already narrowed to `Job` by the caller (via
// isJob()) -- this function only validates the proposal against it.
// Deliberately does not touch potency: the LLM never proposes a numeric
// strength, only a primitive and a risk posture (see CultScheme/CultSystem
// for why -- the engine alone derives actual intensity from simulation
// state).
export function validateSchemeProposal(raw: RawSchemeProposal, job: Job): SchemeValidationResult {
  const affordance = JOB_AFFORDANCES[job]

  if (!CULT_SCHEME_PRIMITIVES.includes(raw.primitive as CultSchemePrimitive)) {
    return { ok: false, reason: 'unrecognized primitive' }
  }
  const primitive = raw.primitive as CultSchemePrimitive

  if (!affordance.allowedPrimitives.includes(primitive)) {
    return { ok: false, reason: 'primitive not affordable for job' }
  }

  if (primitive === 'relic_exposure' && affordance.maxRelicSeverity <= 0) {
    return { ok: false, reason: 'relic_exposure unavailable for job' }
  }

  if (!CULT_SCHEME_RISKS.includes(raw.risk as CultSchemeRisk)) {
    return { ok: false, reason: 'invalid risk' }
  }
  const risk = raw.risk as CultSchemeRisk

  const narrativeRaw = raw.narrative ?? { coverStory: '', method: '', steps: [] }
  const coverStory = String(narrativeRaw.coverStory ?? '').trim().slice(0, 200)
  const method = String(narrativeRaw.method ?? '').trim().slice(0, 200)
  const steps = (Array.isArray(narrativeRaw.steps) ? narrativeRaw.steps : [])
    .map((s) => String(s).trim().slice(0, 150))
    .filter((s) => s.length > 0)
    .slice(0, 3)

  return {
    ok: true,
    scheme: {
      primitive,
      risk,
      narrative: { coverStory, method, steps },
    },
  }
}
