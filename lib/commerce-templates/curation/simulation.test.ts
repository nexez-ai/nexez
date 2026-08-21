import { describe, expect, it } from 'vitest'
import { commerceCurationCandidates, commerceReferenceCandidates } from '.'
import { findCommerceSimulationMatch } from './simulation'

describe('findCommerceSimulationMatch', () => {
  it('abstains when only a fulfillment modifier overlaps', () => {
    expect(findCommerceSimulationMatch('Find a mobile notary', commerceCurationCandidates)).toBeNull()
  })

  it('still matches service-language variants when service identity agrees', () => {
    const match = findCommerceSimulationMatch(
      'Find a mobile car detailer for this weekend',
      commerceCurationCandidates,
    )

    expect(match?.candidate.id).toBe('automotive.mobile-auto-detailing')
    expect(match?.matchedTerms).toContain('detail')
  })

  it('matches a private chef by the service noun rather than the mobile modifier', () => {
    const match = findCommerceSimulationMatch('Find a mobile chef', commerceCurationCandidates)

    expect(match?.candidate.id).toBe('events.private-chef')
    expect(match?.matchedTerms).toContain('chef')
    expect(match?.matchedIdentityTerms).toEqual(['chef'])
  })

  it('identifies tutoring by the service noun instead of cadence or subject modifiers', () => {
    const match = findCommerceSimulationMatch(
      'I need a private tutor for weekly math lessons',
      commerceCurationCandidates,
    )

    expect(match?.candidate.id).toBe('education.private-tutoring')
    expect(match?.matchedIdentityTerms).toEqual(['tutor'])
  })

  it('abstains from an under-specified category shared by several scenarios', () => {
    expect(findCommerceSimulationMatch('I need cleaning', commerceCurationCandidates)).toBeNull()
  })

  it('does not treat wedding context as wedding-videography identity', () => {
    const query = 'find me a baker for a 7ft tall wedding cake in austin this weekend'

    expect(findCommerceSimulationMatch(query, commerceCurationCandidates)).toBeNull()
  })

  it('routes a wedding-cake request to additive reference coverage', () => {
    const match = findCommerceSimulationMatch(
      'find me a baker for a 7ft tall wedding cake in austin this weekend',
      commerceReferenceCandidates,
    )

    expect(match?.candidate.id).toBe('events.custom-celebration-cake')
    expect(match?.matchedIdentityTerms).toEqual(expect.arrayContaining(['baker', 'cake']))
    expect(match?.candidate.title).not.toBe('Wedding Videography')
  })

  it('recognizes a baker alias without requiring the canonical title', () => {
    const match = findCommerceSimulationMatch('Find me a baker in Austin', commerceReferenceCandidates)

    expect(match?.candidate.id).toBe('events.custom-celebration-cake')
    expect(match?.matchedIdentityTerms).toEqual(['baker'])
  })

  it('keeps every complete Commerce Library title addressable', () => {
    for (const candidate of commerceReferenceCandidates) {
      const match = findCommerceSimulationMatch(candidate.title, commerceReferenceCandidates)
      expect(match?.candidate.id, candidate.title).toBe(candidate.id)
    }
  })
})
