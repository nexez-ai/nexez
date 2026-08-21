import type { CommerceCapability, CommerceDomain } from '../schema'
import { automotiveCurationCandidates } from './automotive'
import { commercialCurationCandidates } from './commercial'
import { educationPetCurationCandidates } from './education-pet'
import { eventsCurationCandidates } from './events'
import { homeCurationCandidates } from './home'
import { personalCurationCandidates } from './personal'
import { professionalCurationCandidates } from './professional'
import { commerceReferenceCoverageCandidates } from './reference-coverage'
import {
  COMMERCE_CURATION_VERSION,
  type CommerceCurationCandidate,
  type CommerceCurationGapSignal,
  type CommerceCurationStatus,
} from './types'

export * from './types'

/**
 * Provisional curation inventory only. Presence here never activates a
 * CommerceTemplate and never supplies merchant truth. Runtime activation still
 * happens exclusively through the versioned CommerceTemplate registry.
 */
export const commerceCurationCandidates: CommerceCurationCandidate[] = [
  ...homeCurationCandidates,
  ...automotiveCurationCandidates,
  ...eventsCurationCandidates,
  ...personalCurationCandidates,
  ...professionalCurationCandidates,
  ...educationPetCurationCandidates,
  ...commercialCurationCandidates,
]

/**
 * Buyer-facing reference coverage used by the public simulator. The canonical
 * 63-candidate corpus remains stable for architecture analyses; additive
 * records here only prevent understood requests from being routed to an
 * unrelated reference scenario while marketplace supply is still growing.
 */
export const commerceReferenceCandidates: CommerceCurationCandidate[] = [
  ...commerceCurationCandidates,
  ...commerceReferenceCoverageCandidates,
]

export function commerceCurationSelectionScore(candidate: CommerceCurationCandidate): number {
  return Object.values(candidate.scores).reduce((total, value) => total + value, 0)
}

export function getCommerceCurationCandidate(id: string): CommerceCurationCandidate | null {
  return commerceCurationCandidates.find((candidate) => candidate.id === id) ?? null
}

export function listCommerceCurationCandidates(query?: {
  domain?: CommerceDomain
  status?: CommerceCurationStatus
  capabilityTag?: CommerceCapability
  gapSignal?: CommerceCurationGapSignal
}): CommerceCurationCandidate[] {
  return commerceCurationCandidates.filter((candidate) => {
    if (query?.domain && candidate.domain !== query.domain) return false
    if (query?.status && candidate.status !== query.status) return false
    if (query?.capabilityTag && !candidate.capabilityTags.includes(query.capabilityTag)) return false
    if (query?.gapSignal && !candidate.gapSignals.includes(query.gapSignal)) return false
    return true
  })
}

export function summarizeCommerceCuration() {
  const statuses: CommerceCurationStatus[] = ['pilot-active', 'retain', 'overlap-review', 'replacement-review']
  const statusCounts = Object.fromEntries(
    statuses.map((status) => [status, listCommerceCurationCandidates({ status }).length]),
  ) as Record<CommerceCurationStatus, number>
  const capabilityCounts = {} as Partial<Record<CommerceCapability, number>>
  const gapSignalCounts = {} as Partial<Record<CommerceCurationGapSignal, number>>

  for (const item of commerceCurationCandidates) {
    for (const capability of item.capabilityTags) {
      capabilityCounts[capability] = (capabilityCounts[capability] ?? 0) + 1
    }
    for (const gap of item.gapSignals) {
      gapSignalCounts[gap] = (gapSignalCounts[gap] ?? 0) + 1
    }
  }

  return {
    version: COMMERCE_CURATION_VERSION,
    candidateCount: commerceCurationCandidates.length,
    statusCounts,
    capabilityCounts,
    gapSignalCounts,
  }
}
