import type { CommerceCurationCandidate } from './types'

const QUERY_STOPWORDS = new Set([
  'a', 'an', 'and', 'are', 'at', 'be', 'can', 'could', 'do', 'does', 'for', 'from', 'get', 'handle',
  'here', 'i', 'in', 'is', 'it', 'me', 'my', 'near', 'next', 'of', 'on', 'or', 'please', 'service', 'services',
  'that', 'the', 'their', 'this', 'to', 'us', 'want', 'we', 'what', 'when', 'where', 'will', 'with', 'would',
  'you', 'your',
])

// These words describe fulfillment, audience, or the subject of a service;
// none is specific enough to establish the service category by itself. They
// may still help rank candidates after a service-identity term has matched.
const NON_IDENTITY_TITLE_TERMS = new Set([
  'ai', 'auto', 'automotive', 'bridal', 'business', 'car', 'college', 'commercial',
  'corporate', 'dog', 'emergency', 'event', 'fleet', 'home', 'interior', 'language',
  'lawn', 'managed', 'mobile', 'monthly', 'music', 'party', 'personal', 'pet',
  'private', 'property', 'recurring', 'test', 'vehicle', 'video', 'web', 'wedding',
])

const MINIMUM_AMBIGUITY_MARGIN = 4

function normalize(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function tokens(value: string): string[] {
  return normalize(value)
    .split(' ')
    .filter((token) => token.length > 1 && !QUERY_STOPWORDS.has(token))
}

/**
 * Collapses a small set of common service-language variants without turning
 * this deterministic matcher into a fuzzy or model-based classifier.
 */
export function commerceIdentityTokenFamily(token: string): string {
  if (token.endsWith('ography') && token.length > 8) return token.slice(0, -1)
  if (token.endsWith('ing') && token.length > 6) return token.slice(0, -3)
  if (token.endsWith('ers') && token.length > 6) return token.slice(0, -3)
  if (token.endsWith('er') && token.length > 5) return token.slice(0, -2)
  if (token.endsWith('ed') && token.length > 5) return token.slice(0, -2)
  if (token.endsWith('s') && !token.endsWith('ss') && token.length > 4) return token.slice(0, -1)
  return token
}

function tokenFamilies(value: string): string[] {
  return [...new Set(tokens(value).map(commerceIdentityTokenFamily))]
}

const NON_IDENTITY_TITLE_TOKEN_FAMILIES = new Set(
  [...NON_IDENTITY_TITLE_TERMS].map(commerceIdentityTokenFamily),
)

function identityTitleTokens(value: string): Set<string> {
  return new Set(tokenFamilies(value).filter((token) => !NON_IDENTITY_TITLE_TOKEN_FAMILIES.has(token)))
}

function candidateIdentityTokens(candidate: CommerceCurationCandidate): Set<string> {
  return new Set([
    ...identityTitleTokens(candidate.title),
    ...candidate.simulationHints?.identityTerms.flatMap(tokenFamilies) ?? [],
  ])
}

export type CommerceSimulationMatch = {
  candidate: CommerceCurationCandidate
  score: number
  matchedTerms: string[]
  matchedIdentityTerms: string[]
}

/**
 * Finds the closest Commerce Library scenario for an explicitly labelled
 * no-supply simulation. This is NOT marketplace ranking and never turns a
 * curation candidate into merchant inventory or merchant truth.
 */
export function findCommerceSimulationMatch(
  query: string,
  candidates: CommerceCurationCandidate[],
): CommerceSimulationMatch | null {
  const queryText = normalize(query)
  const queryTokens = tokenFamilies(query)
  if (!queryTokens.length) return null

  const ranked = candidates
    .map((candidate) => {
      const titleText = normalize(candidate.title)
      const serviceTokens = new Set([
        ...tokenFamilies(candidate.title),
        ...candidate.simulationHints?.identityTerms.flatMap(tokenFamilies) ?? [],
      ])
      const identityTokens = candidateIdentityTokens(candidate)
      const teachesTokens = new Set(tokenFamilies(candidate.teaches))
      const metadataTokens = new Set(tokenFamilies([
        candidate.domain,
        candidate.primaryArchetype,
        ...candidate.capabilityTags,
        ...candidate.gapSignals,
      ].join(' ')))

      const matchedIdentityTerms = queryTokens.filter((token) => identityTokens.has(token))
      if (!matchedIdentityTerms.length) return null

      let score = titleText && queryText.includes(titleText) ? 16 : 0
      const matchedTerms: string[] = []

      for (const token of queryTokens) {
        if (serviceTokens.has(token)) {
          score += 6
          matchedTerms.push(token)
        } else if (teachesTokens.has(token)) {
          score += 2
          matchedTerms.push(token)
        } else if (metadataTokens.has(token)) {
          score += 1
          matchedTerms.push(token)
        }
      }

      return {
        candidate,
        score,
        matchedTerms: [...new Set(matchedTerms)],
        matchedIdentityTerms: [...new Set(matchedIdentityTerms)],
        exactTitleMatch: Boolean(titleText && queryText.includes(titleText)),
        identityMatchCount: matchedIdentityTerms.length,
      }
    })
    .filter((match): match is NonNullable<typeof match> => Boolean(match && match.score > 0))
    .sort((a, b) =>
      b.score - a.score ||
      b.identityMatchCount - a.identityMatchCount ||
      a.candidate.ordinal - b.candidate.ordinal,
    )

  const strongest = ranked[0]
  if (!strongest) return null

  const runnerUp = ranked[1]
  if (
    !strongest.exactTitleMatch &&
    runnerUp &&
    strongest.identityMatchCount === runnerUp.identityMatchCount &&
    strongest.score - runnerUp.score < MINIMUM_AMBIGUITY_MARGIN
  ) {
    return null
  }

  return {
    candidate: strongest.candidate,
    score: strongest.score,
    matchedTerms: strongest.matchedTerms,
    matchedIdentityTerms: strongest.matchedIdentityTerms,
  }
}
