// Shared, deterministic agent-readiness scoring. Signal collection lives in
// lib/server/site-scan.ts so public and owner-facing scans cannot drift.

/** Current crawler/control tokens that materially affect agent discovery. */
export const AGENT_BOTS = [
  'GPTBot',
  'OAI-SearchBot',
  'ChatGPT-User',
  'ClaudeBot',
  'Claude-SearchBot',
  'Claude-User',
  'PerplexityBot',
  'Google-Extended',
] as const

export type AgentBot = (typeof AGENT_BOTS)[number]

type RobotsRule = { allow: boolean; pattern: string }
type RobotsGroup = { agents: string[]; rules: RobotsRule[] }

function patternMatchLength(pattern: string, path: string): number {
  if (!pattern) return -1
  const anchored = pattern.endsWith('$')
  const source = anchored ? pattern.slice(0, -1) : `${pattern}*`
  // Glob matching avoids an attacker-controlled backtracking regular expression.
  let i = 0; let j = 0; let star = -1; let retry = 0
  while (i < path.length) {
    if (j < source.length && source[j] === path[i]) { i += 1; j += 1 }
    else if (source[j] === '*') { star = j; j += 1; retry = i }
    else if (star >= 0) { j = star + 1; retry += 1; i = retry }
    else return -1
  }
  while (source[j] === '*') j += 1
  return j === source.length ? pattern.replace(/[*$]/g, '').length : -1
}

/** Group-aware robots evaluation with Allow overrides and longest-rule wins. */
function robotsAccess(robotsTxt: string | null, bots: readonly string[], path: string): Record<string, boolean> {
  const result: Record<string, boolean> = {}
  if (!robotsTxt || !robotsTxt.trim()) {
    for (const bot of bots) result[bot] = true
    return result
  }

  const groups: RobotsGroup[] = []
  let group: RobotsGroup | null = null
  let sawRule = false

  for (const rawLine of robotsTxt.split(/\r?\n/)) {
    const line = rawLine.split('#')[0]!.trim()
    if (!line) continue
    const separator = line.indexOf(':')
    if (separator === -1) continue
    const key = line.slice(0, separator).trim().toLowerCase()
    const value = line.slice(separator + 1).trim()

    if (key === 'user-agent') {
      if (!group || sawRule) {
        group = { agents: [], rules: [] }
        groups.push(group)
        sawRule = false
      }
      if (value) group.agents.push(value.toLowerCase())
      continue
    }

    if ((key === 'allow' || key === 'disallow') && group?.agents.length) {
      sawRule = true
      if (value) group.rules.push({ allow: key === 'allow', pattern: value })
    }
  }

  for (const bot of bots) {
    const token = bot.toLowerCase()
    const matching = groups
      .map((candidate) => ({
        candidate,
        specificity: Math.max(
          ...candidate.agents.map((agent) =>
            agent === '*' ? 0 : token === agent || token.startsWith(agent) ? agent.length : -1,
          ),
        ),
      }))
      .filter((entry) => entry.specificity >= 0)
    const mostSpecific = matching.length ? Math.max(...matching.map((entry) => entry.specificity)) : -1
    const rules = matching
      .filter((entry) => entry.specificity === mostSpecific)
      .flatMap((entry) => entry.candidate.rules)

    let winner: { allow: boolean; length: number } | null = null
    for (const rule of rules) {
      const length = patternMatchLength(rule.pattern, path)
      if (length < 0) continue
      if (!winner || length > winner.length || (length === winner.length && rule.allow)) {
        winner = { allow: rule.allow, length }
      }
    }
    result[bot] = winner?.allow ?? true
  }

  return result
}

export function parseRobotsForAgentBots(robotsTxt: string | null): Record<AgentBot, boolean> {
  return robotsAccess(robotsTxt, AGENT_BOTS, '/') as Record<AgentBot, boolean>
}

export function isRobotPathAllowed(robotsTxt: string | null, agent: string, path: string): boolean {
  return robotsAccess(robotsTxt, [agent], path)[agent] ?? true
}

export type CrawlDimension = 'discovery' | 'understanding' | 'transactability' | 'trust'

export type CrawlabilitySignals = {
  status: number
  responseMs: number
  https: boolean
  hasJsonLd: boolean
  validJsonLd: boolean
  schemaTypes: string[]
  hasTitle: boolean
  hasMetaDescription: boolean
  hasH1: boolean
  hasBusinessIdentity: boolean
  hasOfferSchema: boolean
  hasStructuredPrice: boolean
  hasVisiblePrice: boolean
  hasActionPath: boolean
  hasStructuredAction: boolean
  hasStructuredAvailability: boolean
  hasVisibleAvailability: boolean
  hasOfferDetails: boolean
  hasContact: boolean
  hasPolicies: boolean
  hasFreshnessSignal: boolean
  agentJsonOk: boolean
  wellKnownAgentJsonOk: boolean
  wellKnownAgentCardOk: boolean
  mcpJsonOk: boolean
  openApiJsonOk: boolean
  llmsTxtOk: boolean
  robots: Record<AgentBot, boolean>
}

export type CrawlCheck = {
  id: string
  dimension: CrawlDimension
  label: string
  status: 'pass' | 'warn' | 'fail'
  detail: string
}

export type CrawlDimensionScore = { label: string; score: number }

export type CrawlabilityReport = {
  version: 2
  score: number
  dimensions: Record<CrawlDimension, CrawlDimensionScore>
  checks: CrawlCheck[]
}

export const DIMENSION_WEIGHTS: Record<CrawlDimension, number> = {
  discovery: 25,
  understanding: 25,
  transactability: 35,
  trust: 15,
}

const DIMENSION_LABELS: Record<CrawlDimension, string> = {
  discovery: 'Discovery',
  understanding: 'Understanding',
  transactability: 'Ways to buy',
  trust: 'Trust',
}

/** Per-check weights sum to 100 and roll up to the four dimensions. */
export const CHECK_WEIGHTS: Record<string, number> = {
  reachable: 8,
  speed: 3,
  robots: 5,
  agent_docs: 6,
  llms_txt: 3,
  semantics: 4,
  jsonld: 6,
  business_identity: 5,
  offer_schema: 10,
  pricing: 10,
  action_path: 10,
  availability: 5,
  offer_details: 5,
  structured_action: 5,
  https: 4,
  contact: 4,
  policies: 4,
  freshness: 3,
}

function contribution(check: CrawlCheck): number {
  const weight = CHECK_WEIGHTS[check.id] ?? 0
  return check.status === 'pass' ? weight : check.status === 'warn' ? weight * 0.5 : 0
}

export function scoreFromChecks(checks: CrawlCheck[]): number {
  return Math.round(checks.reduce((sum, check) => sum + contribution(check), 0))
}

export function dimensionsFromChecks(checks: CrawlCheck[]): Record<CrawlDimension, CrawlDimensionScore> {
  return (Object.keys(DIMENSION_WEIGHTS) as CrawlDimension[]).reduce(
    (result, dimension) => {
      const earned = checks
        .filter((check) => check.dimension === dimension)
        .reduce((sum, check) => sum + contribution(check), 0)
      result[dimension] = {
        label: DIMENSION_LABELS[dimension],
        score: Math.round((earned / DIMENSION_WEIGHTS[dimension]) * 100),
      }
      return result
    },
    {} as Record<CrawlDimension, CrawlDimensionScore>,
  )
}

/** Deterministic V2 score based on evidence, not keyword or file presence alone. */
export function evaluateCrawlability(signals: CrawlabilitySignals): CrawlabilityReport {
  const checks: CrawlCheck[] = []
  const add = (check: CrawlCheck) => checks.push(check)
  const reachable = signals.status >= 200 && signals.status < 400

  add({ id: 'reachable', dimension: 'discovery', label: 'Your page loads', status: reachable ? 'pass' : 'fail', detail: `Server responded ${signals.status || 0}` })
  add({
    id: 'speed', dimension: 'discovery', label: 'Your page loads quickly',
    status: signals.responseMs > 0 && signals.responseMs <= 800 ? 'pass' : signals.responseMs <= 2000 ? 'warn' : 'fail',
    detail: signals.responseMs ? `${signals.responseMs}ms` : 'The page did not respond',
  })

  const blocked = AGENT_BOTS.filter((bot) => !signals.robots[bot])
  add({
    id: 'robots', dimension: 'discovery', label: 'AI assistants are allowed in',
    status: blocked.length === 0 ? 'pass' : blocked.length >= AGENT_BOTS.length ? 'fail' : 'warn',
    detail: blocked.length === 0 ? 'Every assistant we check can reach your pages' : `Let these in: ${blocked.join(', ')}`,
  })

  const docs = [
    signals.agentJsonOk && 'agent.json',
    signals.wellKnownAgentJsonOk && 'well-known agent.json',
    signals.wellKnownAgentCardOk && 'A2A agent card',
    signals.mcpJsonOk && 'MCP server card',
    signals.openApiJsonOk && 'OpenAPI',
  ].filter(Boolean) as string[]
  add({
    id: 'agent_docs', dimension: 'discovery', label: 'A guide for AI assistants',
    status: docs.length >= 2 ? 'pass' : docs.length === 1 ? 'warn' : 'fail',
    detail: docs.length ? `Assistants can read: ${docs.join(', ')}` : 'Add a guide that lists your offers and how to buy them',
  })
  add({
    id: 'llms_txt', dimension: 'discovery', label: 'A plain summary for AI',
    status: signals.llmsTxtOk ? 'pass' : 'warn',
    detail: signals.llmsTxtOk ? 'Your /llms.txt gives assistants a readable summary' : 'Add an /llms.txt summary of your business and offers',
  })

  const semanticCount = [signals.hasTitle, signals.hasMetaDescription, signals.hasH1].filter(Boolean).length
  add({
    id: 'semantics', dimension: 'understanding', label: 'Page basics',
    status: semanticCount === 3 ? 'pass' : semanticCount >= 1 ? 'warn' : 'fail',
    detail: `${signals.hasTitle ? 'page title' : 'no page title'}, ${signals.hasMetaDescription ? 'summary' : 'no summary'}, ${signals.hasH1 ? 'headline' : 'no headline'}`,
  })
  add({
    id: 'jsonld', dimension: 'understanding', label: 'Details AI can read',
    status: signals.validJsonLd ? 'pass' : signals.hasJsonLd ? 'warn' : 'fail',
    detail: signals.validJsonLd
      ? `Assistants can read your page details${signals.schemaTypes.length ? `: ${signals.schemaTypes.slice(0, 5).join(', ')}` : ''}`
      : signals.hasJsonLd ? 'Your page details are there but cannot be read' : 'Add details assistants can read, like your name, offers, and prices',
  })
  add({
    id: 'business_identity', dimension: 'understanding', label: 'Your business details',
    status: signals.hasBusinessIdentity ? 'pass' : 'fail',
    detail: signals.hasBusinessIdentity ? 'Your business name and details are readable' : 'Add your business name, location, and contact details',
  })
  add({
    id: 'offer_schema', dimension: 'understanding', label: 'Your offers',
    status: signals.hasOfferSchema ? 'pass' : 'fail',
    detail: signals.hasOfferSchema ? 'Your products or services are listed in a readable form' : 'List your products or services with names and prices',
  })

  add({
    id: 'pricing', dimension: 'transactability', label: 'Your prices',
    status: signals.hasStructuredPrice ? 'pass' : signals.hasVisiblePrice ? 'warn' : 'fail',
    detail: signals.hasStructuredPrice ? 'Your prices are readable' : signals.hasVisiblePrice ? 'Your prices show on the page but assistants cannot read them reliably' : 'Add a price to each offer',
  })
  add({
    id: 'action_path', dimension: 'transactability', label: 'A way to buy or book',
    status: signals.hasActionPath ? 'pass' : 'fail',
    detail: signals.hasActionPath ? 'Buyers can buy, book, subscribe, or ask for a quote' : 'Add a way to buy, book, or request a quote',
  })
  add({
    id: 'availability', dimension: 'transactability', label: 'Availability',
    status: signals.hasStructuredAvailability ? 'pass' : signals.hasVisibleAvailability ? 'warn' : 'fail',
    detail: signals.hasStructuredAvailability ? 'Your availability is readable' : signals.hasVisibleAvailability ? 'Your availability shows on the page but assistants cannot read it reliably' : 'Say when you are available or how long delivery takes',
  })
  add({
    id: 'offer_details', dimension: 'transactability', label: 'What each offer includes',
    status: signals.hasOfferDetails ? 'pass' : signals.hasOfferSchema ? 'warn' : 'fail',
    detail: signals.hasOfferDetails ? 'Each offer says what it includes' : 'Say what each offer includes',
  })
  add({
    id: 'structured_action', dimension: 'transactability', label: 'A link to the next step',
    status: signals.hasStructuredAction ? 'pass' : signals.hasActionPath ? 'warn' : 'fail',
    detail: signals.hasStructuredAction ? 'Your buy or book link is readable' : signals.hasActionPath ? 'Your buy link works for people but assistants cannot read it reliably' : 'Add a link that takes buyers straight to the next step',
  })

  add({ id: 'https', dimension: 'trust', label: 'Secure connection', status: signals.https ? 'pass' : 'fail', detail: signals.https ? 'Your site uses a secure connection' : 'Switch your site to a secure connection' })
  add({
    id: 'contact', dimension: 'trust', label: 'A way to contact you',
    status: signals.hasContact ? 'pass' : 'fail',
    detail: signals.hasContact ? 'Buyers can find how to reach you' : 'Add a way for buyers to reach you',
  })
  add({
    id: 'policies', dimension: 'trust', label: 'Buyer policies',
    status: signals.hasPolicies ? 'pass' : 'warn',
    detail: signals.hasPolicies ? 'Your terms, privacy, or refund policy is easy to find' : 'Add your terms, privacy, or refund policy',
  })
  add({
    id: 'freshness', dimension: 'trust', label: 'Recently updated',
    status: signals.hasFreshnessSignal ? 'pass' : 'warn',
    detail: signals.hasFreshnessSignal ? 'Your pages show a recent date' : 'Show when your pages were last updated',
  })

  return { version: 2, score: scoreFromChecks(checks), dimensions: dimensionsFromChecks(checks), checks }
}
