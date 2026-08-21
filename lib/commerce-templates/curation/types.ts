import type { CommerceArchetype, CommerceCapability, CommerceDomain } from '../schema'

export const COMMERCE_CURATION_VERSION = 1 as const

export type CommerceCurationStatus = 'pilot-active' | 'retain' | 'overlap-review' | 'replacement-review'

export type CommerceCurationGapSignal =
  | 'capacity-constraints' | 'conditional-fulfillment' | 'contract-terms' | 'customer-requirements'
  | 'deposit-schedule' | 'distance-travel-fee' | 'document-requirements' | 'inspection-first'
  | 'inventory-resource' | 'milestones' | 'minimum-charge' | 'multi-provider-orchestration'
  | 'multi-unit-booking' | 'qualification-fit' | 'quantity-pricing' | 'recurrence-terms'
  | 'regulated-qualification' | 'route-optimization' | 'structured-modifiers' | 'usage-pricing' | 'usage-rights'

export type CommerceCurationScores = {
  customerFamiliarity: number
  agenticAdvantage: number
  merchantClonability: number
  commerceUniqueness: number
  transactionLikelihood: number
  intentDiversity: number
  schemaStress: number
  primitiveDiscovery: number
  crossServiceAdjacency: number
  operationalDistinctiveness: number
}

export type CommerceSimulationHints = {
  /** Explicit service nouns or aliases that may establish category identity. */
  identityTerms: string[]
  /** Buyer inputs a reference simulation should ask a real merchant to confirm. */
  buyerDetails: string[]
}

export type CommerceCurationCandidate = {
  ordinal: number
  id: string
  title: string
  domain: CommerceDomain
  primaryArchetype: CommerceArchetype
  status: CommerceCurationStatus
  teaches: string
  capabilityTags: CommerceCapability[]
  gapSignals: CommerceCurationGapSignal[]
  scores: CommerceCurationScores
  simulationHints?: CommerceSimulationHints
}

export function score(
  customerFamiliarity: number, agenticAdvantage: number, merchantClonability: number, commerceUniqueness: number,
  transactionLikelihood: number, intentDiversity: number, schemaStress: number, primitiveDiscovery: number,
  crossServiceAdjacency: number, operationalDistinctiveness: number,
): CommerceCurationScores {
  return { customerFamiliarity, agenticAdvantage, merchantClonability, commerceUniqueness, transactionLikelihood,
    intentDiversity, schemaStress, primitiveDiscovery, crossServiceAdjacency, operationalDistinctiveness }
}

export function candidate(
  ordinal: number, id: string, title: string, domain: CommerceDomain, primaryArchetype: CommerceArchetype,
  status: CommerceCurationStatus, teaches: string, capabilityTags: CommerceCapability[],
  gapSignals: CommerceCurationGapSignal[], scores: CommerceCurationScores,
  simulationHints?: CommerceSimulationHints,
): CommerceCurationCandidate {
  return {
    ordinal,
    id,
    title,
    domain,
    primaryArchetype,
    status,
    teaches,
    capabilityTags,
    gapSignals,
    scores,
    ...(simulationHints ? { simulationHints } : {}),
  }
}
