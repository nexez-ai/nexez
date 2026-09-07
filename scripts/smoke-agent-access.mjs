#!/usr/bin/env node

import { readFileSync } from 'node:fs'
import { checkCnamePointer } from './check-cname-pointer.mjs'

const MARKETING_BASE = trimBase(process.env.NEXEZ_MARKETING_BASE || 'https://nexez.ai')
const AGENT_BASE = trimBase(process.env.NEXEZ_AGENT_BASE || 'https://nexez.app')
const TEST_SLUG = process.env.NEXEZ_AGENT_SMOKE_SLUG || 'nexez-agent-negotiation-lab'
const TEST_OFFER = process.env.NEXEZ_AGENT_SMOKE_OFFER || 'services-0'
const TIMEOUT_MS = Number(process.env.NEXEZ_AGENT_SMOKE_TIMEOUT_MS || 15_000)
// Default expected SDK versions to what THIS checkout ships (the same sources
// scripts/check-agent-sdk-versions.mjs verifies), not a hardcoded literal.
// The 0.1.0 -> 0.3.0 release silently broke every version assertion in this
// smoke for weeks because the old hardcoded defaults were never bumped. Env
// vars still override for pinning a specific release.
const EXPECTED_TYPESCRIPT_SDK_VERSION =
  process.env.NEXEZ_EXPECTED_TYPESCRIPT_SDK_VERSION || repoTypescriptSdkVersion()
const EXPECTED_PYTHON_SDK_VERSION =
  process.env.NEXEZ_EXPECTED_PYTHON_SDK_VERSION || repoPythonSdkVersion()

function repoTypescriptSdkVersion() {
  return JSON.parse(readFileSync('sdk/typescript/package.json', 'utf8')).version
}

function repoPythonSdkVersion() {
  const source = readFileSync('sdk/python/src/nexez_agent_sdk/__init__.py', 'utf8')
  const version = source.match(/^__version__\s*=\s*["']([^"']+)["']/m)?.[1]
  if (!version) throw new Error('Could not read __version__ from sdk/python/src/nexez_agent_sdk/__init__.py')
  return version
}

const checks = []

await check('marketing /agents advertises installs', async () => {
  const html = await fetchText(`${MARKETING_BASE}/agents`)
  assertIncludes(html, 'openclaw plugins install clawhub:@nexez/openclaw-nexez', 'OpenClaw plugin install')
  assertIncludes(html, 'openclaw skills install nexez-agent-discovery', 'OpenClaw skill install')
  assertIncludes(html, 'npm install @nexez/agent-sdk', 'TypeScript SDK install')
  assertIncludes(html, 'python -m pip install nexez-agent-sdk', 'Python SDK install')
  assertIncludes(html, 'examples/agents', 'agent examples')
})

await check('global llms.txt advertises machine surfaces', async () => {
  const text = await fetchText(`${AGENT_BASE}/llms.txt`)
  assertIncludes(text, `${AGENT_BASE}/agent-pages.json`, 'agent index')
  assertIncludes(text, `${AGENT_BASE}/openapi.json`, 'OpenAPI')
  assertIncludes(text, `${AGENT_BASE}/.well-known/mcp.json`, 'MCP discovery')
  assertIncludes(text, `TypeScript SDK: @nexez/agent-sdk (${EXPECTED_TYPESCRIPT_SDK_VERSION})`, 'TypeScript SDK version')
  assertIncludes(text, 'npm install @nexez/agent-sdk', 'TypeScript SDK install')
  assertIncludes(text, `Python SDK: nexez-agent-sdk (${EXPECTED_PYTHON_SDK_VERSION})`, 'Python SDK version')
  assertIncludes(text, 'python -m pip install nexez-agent-sdk', 'Python SDK install')
})

await check('capabilities manifest exposes SDKs and examples', async () => {
  const json = await fetchJson(`${AGENT_BASE}/.well-known/nexez.json`)
  assertEqual(json.sdks?.typescript?.status, 'published', 'TypeScript SDK status')
  assertEqual(json.sdks?.typescript?.version, EXPECTED_TYPESCRIPT_SDK_VERSION, 'TypeScript SDK version')
  assertEqual(json.sdks?.typescript?.installCommand, 'npm install @nexez/agent-sdk', 'TypeScript SDK install')
  assertEqual(json.sdks?.python?.status, 'published', 'Python SDK status')
  assertEqual(json.sdks?.python?.version, EXPECTED_PYTHON_SDK_VERSION, 'Python SDK version')
  assertEqual(json.sdks?.python?.installCommand, 'python -m pip install nexez-agent-sdk', 'Python SDK install')
  assertEqual(json.examples?.sourcePath, 'examples/agents', 'examples path')
})

await check('MCP discovery catalog exposes SDKs and examples', async () => {
  const json = await fetchJson(`${AGENT_BASE}/.well-known/mcp.json`)
  assertEqual(json.sdks?.typescript?.name, '@nexez/agent-sdk', 'TypeScript SDK name')
  assertEqual(json.sdks?.typescript?.version, EXPECTED_TYPESCRIPT_SDK_VERSION, 'TypeScript SDK version')
  assertEqual(json.sdks?.python?.name, 'nexez-agent-sdk', 'Python SDK name')
  assertEqual(json.sdks?.python?.version, EXPECTED_PYTHON_SDK_VERSION, 'Python SDK version')
  assertEqual(json.examples?.sourcePath, 'examples/agents', 'examples path')
})

await check('OpenAPI advertises agent distribution', async () => {
  const json = await fetchJson(`${AGENT_BASE}/openapi.json`)
  const distribution = json.info?.['x-nexez-agent-distribution']
  assertEqual(distribution?.sdks?.typescript?.version, EXPECTED_TYPESCRIPT_SDK_VERSION, 'TypeScript SDK version')
  assertEqual(distribution?.sdks?.typescript?.installCommand, 'npm install @nexez/agent-sdk', 'TypeScript SDK install')
  assertEqual(distribution?.sdks?.python?.version, EXPECTED_PYTHON_SDK_VERSION, 'Python SDK version')
  assertEqual(distribution?.sdks?.python?.installCommand, 'python -m pip install nexez-agent-sdk', 'Python SDK install')
  assertEqual(distribution?.examples?.sourcePath, 'examples/agents', 'examples path')
})

await check('agent index advertises agent distribution', async () => {
  const json = await fetchJson(`${AGENT_BASE}/agent-pages.json`)
  assertEqual(json.sdks?.typescript?.status, 'published', 'TypeScript SDK status')
  assertEqual(json.sdks?.typescript?.version, EXPECTED_TYPESCRIPT_SDK_VERSION, 'TypeScript SDK version')
  assertEqual(json.sdks?.python?.status, 'published', 'Python SDK status')
  assertEqual(json.sdks?.python?.version, EXPECTED_PYTHON_SDK_VERSION, 'Python SDK version')
  assertEqual(json.examples?.sourcePath, 'examples/agents', 'examples path')
})

await check('npm package is available', async () => {
  const json = await fetchJson('https://registry.npmjs.org/%40nexez%2Fagent-sdk')
  assertEqual(json?.['dist-tags']?.latest, EXPECTED_TYPESCRIPT_SDK_VERSION, 'latest npm version')
  assert(Boolean(json?.versions?.[EXPECTED_TYPESCRIPT_SDK_VERSION]), `npm version ${EXPECTED_TYPESCRIPT_SDK_VERSION} is missing`)
})

await check('PyPI package is available', async () => {
  const json = await fetchJson('https://pypi.org/pypi/nexez-agent-sdk/json')
  assertEqual(json?.info?.version, EXPECTED_PYTHON_SDK_VERSION, 'latest PyPI version')
  assert(Boolean(json?.releases?.[EXPECTED_PYTHON_SDK_VERSION]), `PyPI version ${EXPECTED_PYTHON_SDK_VERSION} is missing`)
})

await check('seeded negotiation page exposes safe public manifest', async () => {
  const json = await fetchJson(`${AGENT_BASE}/${TEST_SLUG}/agent.json`)
  const offer = json.offers?.find((item) => item.key === TEST_OFFER)
  assertEqual(json.page?.slug, TEST_SLUG, 'manifest page slug')
  assert(Boolean(offer), `offer ${TEST_OFFER} is missing`)
  assertEqual(offer.accepts_negotiation, true, 'offer accepts negotiation')
  assert(Boolean(offer.negotiation_action), 'offer negotiation_action is missing')
  assert(!('rules' in offer), 'private offer rules leaked into agent.json')
  assert(!('minPrice' in offer), 'private minPrice leaked into agent.json')
})

await check('agent search serves structured discovery results', async () => {
  // Structural check against real published inventory. The seeded fixture is
  // deliberately NOT findable here: lib/public-page-visibility.ts blocklists
  // internal QA seeds from every discovery surface while keeping their direct
  // URLs (agent.json, negotiation API) fully functional.
  const json = await fetchJson(`${AGENT_BASE}/api/agent-search?q=book%20a%20service&limit=5`)
  assertEqual(json.schema_version, 'nexez.agent-search.v1', 'search schema version')
  assert(Array.isArray(json.results) && json.results.length > 0, 'search returned no results')
  const first = json.results[0]
  assert(Boolean(first?.page?.slug), 'first search result is missing page.slug')
  assert(Boolean(first?.offer?.key), 'first search result is missing offer.key')
})

await check('internal QA fixtures stay hidden from discovery', async () => {
  const json = await fetchJson(`${AGENT_BASE}/api/agent-search?q=agent%20negotiation%20sprint%20remote&limit=50`)
  const leaked = json.results?.find((result) => result.page?.slug === TEST_SLUG)
  assert(!leaked, `internal seed ${TEST_SLUG} leaked into public search results`)
})

await check('merchant CNAME pointer matches the provider target', async () => {
  // Runs here so it inherits this workflow's schedule. The pointer is a
  // hand-maintained record; if the provider reshards the project it goes stale
  // silently and every merchant custom domain breaks at once.
  const result = await checkCnamePointer()
  assert(result.ok, result.message)
})

await check('negotiation dry-run auto-accepts seeded valid proposal', async () => {
  const json = await fetchJson(`${AGENT_BASE}/api/negotiations`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify({
      slug: TEST_SLUG,
      offer: TEST_OFFER,
      buyerAgent: 'Nexez Agent Access Smoke',
      query: 'Smoke test: buyer wants a one-week agent negotiation sprint.',
      budget: 'USD 2100',
      timeline: 'next week',
      requestedTerms: {
        scope: 'Discovery call',
        revisionCount: 1,
        projectWeeks: 1,
      },
      dryRun: true,
    }),
  })
  assertEqual(json.ok, true, 'dry-run ok')
  assertEqual(json.dryRun, true, 'dryRun flag')
  assertEqual(json.rulesEvaluation?.decision, 'auto_accept', 'rules decision')
})

await check('negotiation dry-run requires review when configured terms are missing', async () => {
  const json = await fetchJson(`${AGENT_BASE}/api/negotiations`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify({
      slug: TEST_SLUG,
      offer: TEST_OFFER,
      buyerAgent: 'Nexez Agent Access Smoke',
      query: 'Smoke test: incomplete proposal must remain subject to seller review.',
      budget: 'USD 2100',
      timeline: 'next week',
      dryRun: true,
    }),
  })
  assertEqual(json.ok, true, 'dry-run ok')
  assertEqual(json.dryRun, true, 'dryRun flag')
  assertEqual(json.rulesEvaluation?.decision, 'review', 'incomplete proposal decision')
  for (const reason of ['scope_not_provided', 'revision_count_not_provided', 'project_length_not_provided']) {
    assert(json.rulesEvaluation?.reasons?.includes(reason), `missing review reason: ${reason}`)
  }
})

printSummary()

if (checks.some((item) => item.status === 'fail')) {
  process.exitCode = 1
}

async function check(name, fn) {
  const started = Date.now()
  try {
    await fn()
    checks.push({ name, status: 'pass', ms: Date.now() - started })
    console.log(`PASS ${name}`)
  } catch (error) {
    checks.push({ name, status: 'fail', ms: Date.now() - started, error })
    console.error(`FAIL ${name}: ${error.message}`)
  }
}

async function fetchText(url, init = {}) {
  const response = await fetchWithTimeout(url, init)
  const text = await response.text()
  if (!response.ok) {
    throw new Error(`${url} returned ${response.status}: ${text.slice(0, 240)}`)
  }
  return text
}

async function fetchJson(url, init = {}) {
  const text = await fetchText(url, init)
  try {
    return JSON.parse(text)
  } catch {
    throw new Error(`${url} did not return JSON: ${text.slice(0, 240)}`)
  }
}

async function fetchWithTimeout(url, init = {}) {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS)
  try {
    return await fetch(url, {
      ...init,
      signal: controller.signal,
      headers: {
        'user-agent': 'Nexez-Agent-Access-Smoke/1.0',
        ...(init.headers || {}),
      },
    })
  } finally {
    clearTimeout(timeout)
  }
}

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

function assertEqual(actual, expected, label) {
  if (actual !== expected) {
    throw new Error(`${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`)
  }
}

function assertIncludes(value, expected, label) {
  if (!value.includes(expected)) {
    throw new Error(`${label}: missing ${expected}`)
  }
}

function trimBase(value) {
  return value.replace(/\/+$/, '')
}

function printSummary() {
  const passed = checks.filter((item) => item.status === 'pass').length
  const failed = checks.length - passed
  console.log('')
  console.log(`Agent access smoke: ${passed}/${checks.length} passed${failed ? `, ${failed} failed` : ''}`)
  for (const item of checks) {
    const suffix = item.status === 'fail' ? ` - ${item.error.message}` : ''
    console.log(`${item.status.toUpperCase().padEnd(4)} ${String(item.ms).padStart(5)}ms ${item.name}${suffix}`)
  }
}
