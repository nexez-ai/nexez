import { describe, expect, it } from 'vitest'
import {
  commerceCurationCandidates,
  commerceCurationSelectionScore,
  commerceReferenceCandidates,
  listCommerceCurationCandidates,
  summarizeCommerceCuration,
} from './curation'
import { getLatestCommerceTemplate, listCommerceTemplates } from './registry'

const PILOT_IDS = new Set([
  'home.recurring-home-cleaning',
  'automotive.mobile-auto-detailing',
  'events.private-chef',
  'events.event-photography',
  'professional.business-strategy-session',
  'education.private-tutoring',
  'professional.web-design-project',
])

const OVERLAP_REVIEW_IDS = new Set([
  'home.deep-cleaning',
  'personal.hair-styling',
  'commercial.commercial-cleaning',
  'commercial.property-turnover-service',
  'commercial.commercial-landscaping',
])

const REPLACEMENT_REVIEW_IDS = new Set([
  'automotive.interior-detail',
  'personal.mobile-nail-service',
])

function ids(values: Array<{ id: string }>): Set<string> {
  return new Set(values.map((value) => value.id))
}

describe('commerce 63-candidate curation inventory', () => {
  it('contains exactly the 63 ordered candidates with unique ids', () => {
    expect(commerceCurationCandidates).toHaveLength(63)
    expect(commerceCurationCandidates.map((candidate) => candidate.ordinal)).toEqual(
      Array.from({ length: 63 }, (_, index) => index + 1),
    )
    expect(ids(commerceCurationCandidates).size).toBe(63)
  })

  it('adds launch coverage without changing the canonical 63-candidate corpus', () => {
    expect(commerceReferenceCandidates).toHaveLength(64)
    expect(ids(commerceReferenceCandidates).size).toBe(64)
    expect(commerceReferenceCandidates.slice(0, 63)).toEqual(commerceCurationCandidates)
    expect(commerceReferenceCandidates.at(-1)).toMatchObject({
      ordinal: 64,
      id: 'events.custom-celebration-cake',
      title: 'Custom Celebration Cake',
      status: 'retain',
    })
    expect(getLatestCommerceTemplate('events.custom-celebration-cake')).toBeNull()
  })

  it('scores every candidate on exactly ten integer dimensions from 1 through 5', () => {
    for (const candidate of commerceCurationCandidates) {
      const values = Object.values(candidate.scores)
      expect(values).toHaveLength(10)
      expect(values.every((value) => Number.isInteger(value) && value >= 1 && value <= 5)).toBe(true)
      expect(commerceCurationSelectionScore(candidate)).toBeGreaterThanOrEqual(10)
      expect(commerceCurationSelectionScore(candidate)).toBeLessThanOrEqual(50)
    }
  })

  it('keeps curation pilot status exactly aligned with the seven active runtime templates', () => {
    const activeTemplates = listCommerceTemplates({ status: 'active' })
    const activeCuration = listCommerceCurationCandidates({ status: 'pilot-active' })

    expect(activeTemplates).toHaveLength(7)
    expect(ids(activeTemplates)).toEqual(PILOT_IDS)
    expect(ids(activeCuration)).toEqual(PILOT_IDS)

    for (const candidate of commerceCurationCandidates.filter((item) => item.status !== 'pilot-active')) {
      expect(getLatestCommerceTemplate(candidate.id)).toBeNull()
    }
  })

  it('records the first-pass review queue explicitly', () => {
    expect(ids(listCommerceCurationCandidates({ status: 'overlap-review' }))).toEqual(OVERLAP_REVIEW_IDS)
    expect(ids(listCommerceCurationCandidates({ status: 'replacement-review' }))).toEqual(REPLACEMENT_REVIEW_IDS)
  })

  it('summarizes measured selection, capability, and gap-signal coverage', () => {
    const summary = summarizeCommerceCuration()

    expect(summary.version).toBe(1)
    expect(summary.candidateCount).toBe(63)
    expect(summary.statusCounts).toEqual({
      'pilot-active': 7,
      retain: 49,
      'overlap-review': 5,
      'replacement-review': 2,
    })
    expect(summary.capabilityCounts.CUSTOM_INTAKE).toBe(52)
    expect(summary.capabilityCounts.RECURRING).toBe(19)
    expect(summary.gapSignalCounts['customer-requirements']).toBe(31)
    expect(summary.gapSignalCounts['route-optimization']).toBe(1)
  })

  it('supports deterministic roadmap queries without touching the runtime registry', () => {
    expect(listCommerceCurationCandidates({ capabilityTag: 'RECURRING' })).toHaveLength(19)
    expect(listCommerceCurationCandidates({ gapSignal: 'route-optimization' }).map((candidate) => candidate.id)).toEqual([
      'commercial.laundry-pickup-delivery',
    ])
    expect(listCommerceCurationCandidates({ domain: 'events-hospitality' })).toHaveLength(9)
    expect(listCommerceTemplates({ status: 'active' })).toHaveLength(7)
  })

  it('is deterministic and JSON-safe', () => {
    const payload = { candidates: commerceCurationCandidates, summary: summarizeCommerceCuration() }
    expect(JSON.parse(JSON.stringify(payload))).toEqual(payload)
  })
})
