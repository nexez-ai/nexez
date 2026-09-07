#!/usr/bin/env node

import { spawnSync } from 'node:child_process'
import { writeFile } from 'node:fs/promises'
import nextEnv from '@next/env'

const { loadEnvConfig } = nextEnv
loadEnvConfig(process.cwd())

const MARKETING_BASE = trimBase(process.env.NEXEZ_MARKETING_BASE || 'https://nexez.ai')
const APP_BASE = trimBase(process.env.NEXEZ_APP_BASE || 'https://app.nexez.ai')
const ADMIN_BASE = trimBase(process.env.NEXEZ_ADMIN_BASE || 'https://admin.nexez.ai')
const AGENT_BASE = trimBase(process.env.NEXEZ_AGENT_BASE || 'https://nexez.app')
const SLUG = process.env.NEXEZ_RELEASE_CERT_SLUG || 'nexez-agent-negotiation-lab'
const OFFER = process.env.NEXEZ_RELEASE_CERT_OFFER || 'services-0'
const SECRET = process.env.NEXEZ_RELEASE_CERT_SECRET || ''
const COMMIT_SHA = normalizeSha(process.env.NEXEZ_COMMIT_SHA || process.env.GITHUB_SHA)
const TIMEOUT_MS = positiveNumber(process.env.NEXEZ_RELEASE_TIMEOUT_MS, 15_000)
const WAIT_MS = positiveNumber(process.env.NEXEZ_RELEASE_WAIT_MS, process.env.GITHUB_ACTIONS ? 600_000 : 1)
const POLL_MS = positiveNumber(process.env.NEXEZ_RELEASE_POLL_MS, 10_000)
const REPORT_PATH = process.env.NEXEZ_RELEASE_REPORT_PATH || 'release-certification.json'
const HEALTH_URL = `${APP_BASE}/api/internal/launch-health`
const RECORD_URL = process.env.NEXEZ_RELEASE_CERT_ENDPOINT || `${APP_BASE}/api/internal/release-certifications`
const SUPPORT_REQUEST_ID = '00000000-0000-4000-8000-000000000001'
const SUPPORT_REPLY_ID = '00000000-0000-4000-8000-000000000002'
const startedAt = new Date().toISOString()
const checks = []

if (!COMMIT_SHA) {
  console.error('Release certification requires NEXEZ_COMMIT_SHA or GITHUB_SHA.')
  process.exit(1)
}
if (SECRET.length < 32) {
  console.error('Release certification requires a 32-byte NEXEZ_RELEASE_CERT_SECRET.')
  process.exit(1)
}

await check('source-ci', 'Source verification gates', true, async () => {
  assert(process.env.NEXEZ_CI_CONCLUSION === 'success', 'The source CI/build result is not proven successful')
  return 'Lint, palette, type, tests, and build completed before certification.'
})

let machineHealth = null
await check('deployed-revision', 'Exact deployment revision', true, async () => {
  machineHealth = await waitForDeploymentRevision()
  return `Production serves ${COMMIT_SHA.slice(0, 12)}.`
})

await check('launch-control', 'Launch Control readiness', true, async () => {
  assert(machineHealth, 'Machine health could not be loaded')
  const blockers = Array.isArray(machineHealth.blockers)
    ? machineHealth.blockers.map((item) => item.id).filter(Boolean)
    : []
  const stripeConfiguration = blockers.includes('stripe-delivery')
    ? describeStripeWebhookConfiguration(machineHealth.stripeWebhookConfiguration)
    : ''
  assert(machineHealth.ok === true, blockers.length
    ? `Required checks are not ready: ${blockers.join(', ')}${stripeConfiguration ? `. ${stripeConfiguration}` : ''}`
    : 'Launch Control did not report ready')
  return `${machineHealth.summary?.score ?? 0}% readiness with no required blockers.`
})

await check('marketing-host', 'Marketing host', true, async () => {
  const response = await fetchRetry(`${MARKETING_BASE}/`)
  const html = await response.text()
  assert(response.ok, `Homepage returned HTTP ${response.status}`)
  assert(new URL(response.url).hostname === new URL(MARKETING_BASE).hostname, 'Homepage resolved to the wrong canonical host')
  assert(/<html[\s>]/i.test(html), 'Homepage did not return HTML')
  return `${MARKETING_BASE} returned ${response.status}.`
})

await check('app-host', 'Authenticated app host', true, async () => {
  const response = await fetchRetry(`${APP_BASE}/login`)
  const html = await response.text()
  assert(response.ok, `Login returned HTTP ${response.status}`)
  assert(new URL(response.url).hostname === new URL(APP_BASE).hostname, 'Login resolved to the wrong canonical host')
  assert(/<html[\s>]/i.test(html), 'Login did not return HTML')
  return `${APP_BASE}/login returned ${response.status}.`
})

await check('admin-host', 'Platform admin host', true, async () => {
  const [login, protectedDesk] = await Promise.all([
    fetchRetry(`${ADMIN_BASE}/login`),
    fetchRetry(`${ADMIN_BASE}/admin/support`),
  ])
  const html = await login.text()
  assert(login.ok, `Admin login returned HTTP ${login.status}`)
  assert(new URL(login.url).hostname === new URL(ADMIN_BASE).hostname, 'Admin login resolved to the wrong canonical host')
  assert(/<html[\s>]/i.test(html), 'Admin login did not return HTML')
  const protectedUrl = new URL(protectedDesk.url)
  assert(protectedDesk.ok && protectedUrl.pathname === '/login', 'Signed-out support desk did not fail closed to admin login')
  assert(protectedUrl.searchParams.get('next') === '/admin/support', 'Admin login lost the support-desk return destination')
  return `${ADMIN_BASE} served an isolated login and protected support desk.`
})

await check('support-privacy', 'Support requester boundaries', true, async () => {
  const requestPath = `/support/requests/${SUPPORT_REQUEST_ID}`
  const [supportHub, protectedRequest, privateTickets, privateReply] = await Promise.all([
    fetchRetry(`${APP_BASE}/support`),
    fetchRetry(`${APP_BASE}${requestPath}`),
    fetchRetry(`${APP_BASE}/api/support/tickets`, {
      headers: { Accept: 'application/json' },
    }),
    fetchRetry(`${APP_BASE}/api/support/tickets/${SUPPORT_REQUEST_ID}/messages`, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        body: 'Release certification privacy probe.',
        clientMessageId: SUPPORT_REPLY_ID,
      }),
    }),
  ])

  const supportHtml = await supportHub.text()
  assert(supportHub.ok && /<html[\s>]/i.test(supportHtml), `Support hub returned HTTP ${supportHub.status}`)
  assert(new URL(supportHub.url).hostname === new URL(MARKETING_BASE).hostname, 'Support hub resolved to the wrong canonical host')

  const protectedUrl = new URL(protectedRequest.url)
  assert(protectedRequest.ok && protectedUrl.pathname === '/login', 'Signed-out support request did not fail closed to login')
  assert(protectedUrl.searchParams.get('next') === requestPath, 'Support login lost the request return destination')
  assert(privateTickets.status === 401, `Private support history returned HTTP ${privateTickets.status} instead of 401`)
  assert(privateReply.status === 401, `Private support reply returned HTTP ${privateReply.status} instead of 401`)

  return 'Public support canonicalizes to marketing while requester history, request detail, and replies reject anonymous access.'
})

await check('settings-agent-lab', 'Settings and Agent Lab boundaries', true, async () => {
  const [agentLab, settings, privateResearch] = await Promise.all([
    fetchRetry(`${MARKETING_BASE}/simulator?mode=url`),
    fetchRetry(`${APP_BASE}/dashboard/settings`),
    fetchRetry(`${APP_BASE}/api/agent-lab/research-runs?limit=1`),
  ])
  const agentLabHtml = await agentLab.text()
  assert(agentLab.ok && /<html[\s>]/i.test(agentLabHtml), `Agent Lab returned HTTP ${agentLab.status}`)
  assert(new URL(agentLab.url).hostname === new URL(MARKETING_BASE).hostname, 'Agent Lab resolved to the wrong canonical host')

  const settingsUrl = new URL(settings.url)
  assert(settings.ok && settingsUrl.pathname === '/login', 'Signed-out Settings did not fail closed to login')
  assert(settingsUrl.searchParams.get('next') === '/dashboard/settings', 'Settings login lost its return destination')

  assert(privateResearch.status === 401, `Private Agent Lab history returned HTTP ${privateResearch.status} instead of 401`)
  return 'Agent Lab renders, Settings preserves its sign-in return path, and private research rejects anonymous access.'
})

await check('agent-runtime', 'Agent runtime health', true, async () => {
  const body = await fetchJsonRetry(`${AGENT_BASE}/api/v1/health`)
  assert(body.ok === true && body.service === 'nexez-api-v1', 'Agent API health contract failed')
  return `${AGENT_BASE}/api/v1/health reported ready.`
})

await check('public-storefront', 'Certification storefront', true, async () => {
  const response = await fetchRetry(`${AGENT_BASE}/${SLUG}`)
  const html = await response.text()
  assert(response.ok, `Storefront returned HTTP ${response.status}`)
  assert(/<html[\s>]/i.test(html), 'Storefront did not return HTML')
  return `/${SLUG} is publicly renderable.`
})

await check('storefront-artifacts', 'Storefront agent artifacts', true, async () => {
  const [manifest, instructions, openapi] = await Promise.all([
    fetchJsonRetry(`${AGENT_BASE}/${SLUG}/agent.json`),
    fetchTextRetry(`${AGENT_BASE}/${SLUG}/llms.txt`),
    fetchJsonRetry(`${AGENT_BASE}/${SLUG}/openapi.json`),
  ])
  assert(manifest.page?.slug === SLUG, 'agent.json identifies the wrong storefront')
  assert(manifest.offers?.some((item) => item.key === OFFER), `agent.json is missing ${OFFER}`)
  assert(instructions.includes(`/${SLUG}/agent.json`), 'llms.txt does not link its agent manifest')
  assert(typeof openapi.openapi === 'string' && openapi.paths, 'Storefront OpenAPI is malformed')
  return 'agent.json, llms.txt, and OpenAPI agree on the certification storefront.'
})

await check('global-artifacts', 'Global agent discovery artifacts', true, async () => {
  const [instructions, mcp, openapi, index] = await Promise.all([
    fetchTextRetry(`${AGENT_BASE}/llms.txt`),
    fetchJsonRetry(`${AGENT_BASE}/.well-known/mcp.json`),
    fetchJsonRetry(`${AGENT_BASE}/openapi.json`),
    fetchJsonRetry(`${AGENT_BASE}/agent-pages.json`),
  ])
  assert(instructions.includes(`${AGENT_BASE}/agent-pages.json`), 'Global llms.txt is missing the listing index')
  assert(mcp && typeof mcp === 'object', 'Global MCP discovery is malformed')
  assert(typeof openapi.openapi === 'string', 'Global OpenAPI is malformed')
  assert(Array.isArray(index.pages), 'Agent listing index is malformed')
  return 'Global llms.txt, MCP, OpenAPI, and listing index are readable.'
})

await check('commerce-gauntlet', 'Non-money-moving commerce gauntlet', true, async () => {
  const child = spawnSync(process.execPath, ['scripts/certify-commerce.mjs'], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      NEXEZ_COMMERCE_CERT_BASE: AGENT_BASE,
      NEXEZ_COMMERCE_CERT_SLUG: SLUG,
      NEXEZ_COMMERCE_CERT_OFFER: OFFER,
      NEXEZ_COMMERCE_CERT_TIMEOUT_MS: String(TIMEOUT_MS),
    },
    encoding: 'utf8',
    maxBuffer: 1024 * 1024,
    timeout: 180_000,
  })
  const output = `${child.stdout || ''}\n${child.stderr || ''}`.trim()
  if (output) process.stdout.write(`${output}\n`)
  assert(!child.error, child.error?.message || 'Commerce gauntlet could not start')
  assert(child.status === 0, failureLines(output) || `Commerce gauntlet exited ${child.status}`)
  const summary = output.match(/Commerce certification: ([^\n]+)/)?.[1]
  return summary || 'Approval and tokenless-denial checks passed.'
})

const completedAt = new Date().toISOString()
const submission = {
  schemaVersion: 1,
  idempotencyKey: releaseIdempotencyKey(),
  source: releaseSource(),
  environment: 'production',
  commitSha: COMMIT_SHA,
  deploymentUrl: machineHealth?.deployment?.deploymentUrl || APP_BASE,
  workflowUrl: process.env.NEXEZ_WORKFLOW_URL || undefined,
  repository: process.env.GITHUB_REPOSITORY || undefined,
  triggeredBy: process.env.NEXEZ_TRIGGERED_BY || process.env.GITHUB_ACTOR || undefined,
  startedAt,
  completedAt,
  checks,
}

let persisted = null
try {
  persisted = await postEvidence(submission)
  console.log(`RECORD ${persisted.recordId} ${persisted.status}${persisted.replayed ? ' (replay)' : ''}`)
} catch (error) {
  console.error(`RECORD FAILED: ${error instanceof Error ? error.message : String(error)}`)
}

const localPassed = checks.filter((item) => item.required).every((item) => item.status === 'pass')
const passed = localPassed && persisted?.status === 'passed'
const report = {
  schemaVersion: 1,
  status: passed ? 'passed' : 'failed',
  promotionEligible: passed,
  commitSha: COMMIT_SHA,
  startedAt,
  completedAt,
  checks,
  record: persisted,
}
await writeFile(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`, 'utf8')
printSummary(passed)
if (!passed) process.exitCode = 1

async function check(id, label, required, fn) {
  const started = Date.now()
  try {
    const detail = cleanDetail(await fn())
    checks.push({ id, label, status: 'pass', required, durationMs: Date.now() - started, ...(detail ? { detail } : {}) })
    console.log(`PASS ${label}`)
  } catch (error) {
    const detail = cleanDetail(error instanceof Error ? error.message : String(error))
    checks.push({ id, label, status: 'fail', required, durationMs: Date.now() - started, detail })
    console.error(`FAIL ${label}: ${detail}`)
  }
}

async function waitForDeploymentRevision() {
  const deadline = Date.now() + WAIT_MS
  let lastError = 'deployment health did not respond'
  do {
    try {
      const response = await fetchWithTimeout(HEALTH_URL, {
        headers: { Authorization: `Bearer ${SECRET}`, Accept: 'application/json' },
      })
      const text = await response.text()
      let body = null
      try { body = text ? JSON.parse(text) : null } catch {}
      if (response.status === 401) throw new FatalProbeError('Release-certification bearer token was rejected')
      const revision = normalizeSha(body?.deployment?.revision)
      if (revision === COMMIT_SHA) return body
      lastError = revision
        ? `production still serves ${revision.slice(0, 12)}`
        : `machine health returned HTTP ${response.status} without a deployment revision`
    } catch (error) {
      if (error instanceof FatalProbeError) throw error
      lastError = error instanceof Error ? error.message : String(error)
    }
    if (Date.now() < deadline) await sleep(Math.min(POLL_MS, Math.max(1, deadline - Date.now())))
  } while (Date.now() < deadline)
  throw new Error(`Timed out waiting for ${COMMIT_SHA.slice(0, 12)}: ${lastError}`)
}

async function postEvidence(body) {
  let lastError = 'release record endpoint did not respond'
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const response = await fetchWithTimeout(RECORD_URL, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${SECRET}`,
          Accept: 'application/json',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      })
      const text = await response.text()
      let parsed = null
      try { parsed = text ? JSON.parse(text) : null } catch {}
      if (response.status >= 400 && response.status < 500) {
        throw new FatalProbeError(`Evidence was rejected (${response.status}): ${cleanDetail(text)}`)
      }
      if (!response.ok || !parsed?.recordId) throw new Error(`Evidence returned HTTP ${response.status}`)
      return parsed
    } catch (error) {
      if (error instanceof FatalProbeError) throw error
      lastError = error instanceof Error ? error.message : String(error)
      if (attempt < 3) await sleep(attempt * 1500)
    }
  }
  throw new Error(lastError)
}

async function fetchTextRetry(url) {
  const response = await fetchRetry(url)
  const text = await response.text()
  if (!response.ok) throw new Error(`${url} returned HTTP ${response.status}`)
  return text
}

async function fetchJsonRetry(url) {
  const text = await fetchTextRetry(url)
  try {
    return JSON.parse(text)
  } catch {
    throw new Error(`${url} did not return JSON`)
  }
}

async function fetchRetry(url, init = {}) {
  let lastError = 'request failed'
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const response = await fetchWithTimeout(url, init)
      if (response.status >= 500 && attempt < 3) throw new Error(`HTTP ${response.status}`)
      return response
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error)
      if (attempt < 3) await sleep(attempt * 1000)
    }
  }
  throw new Error(`${url}: ${lastError}`)
}

function fetchWithTimeout(url, init = {}) {
  return fetch(url, {
    ...init,
    redirect: 'follow',
    signal: AbortSignal.timeout(TIMEOUT_MS),
    headers: {
      'user-agent': 'Nexez-Release-Certification/1.0',
      ...(init.headers || {}),
    },
  })
}

function releaseIdempotencyKey() {
  if (process.env.NEXEZ_RELEASE_IDEMPOTENCY_KEY) return process.env.NEXEZ_RELEASE_IDEMPOTENCY_KEY
  if (process.env.GITHUB_RUN_ID) return `github-${process.env.GITHUB_RUN_ID}-${process.env.GITHUB_RUN_ATTEMPT || '1'}`
  return `local-${COMMIT_SHA.slice(0, 12)}-${Date.now()}`
}

function releaseSource() {
  const source = process.env.NEXEZ_RELEASE_SOURCE
  if (source === 'github' || source === 'manual' || source === 'local') return source
  return process.env.GITHUB_ACTIONS ? 'github' : 'local'
}

function normalizeSha(value) {
  const normalized = String(value || '').trim().toLowerCase()
  return /^[0-9a-f]{7,64}$/.test(normalized) ? normalized : null
}

function cleanDetail(value) {
  return String(value || '').replace(/\s+/g, ' ').trim().slice(0, 300)
}

function describeStripeWebhookConfiguration(value) {
  if (!value || typeof value !== 'object') return ''
  const details = []
  if (Number.isInteger(value.stripeWebhookEndpointCount)) {
    details.push(`${value.stripeWebhookEndpointCount} matching Stripe endpoints`)
  }
  if (value.stripeWebhookEndpointsEnabled === false) details.push('at least one endpoint is disabled')
  if (Array.isArray(value.stripeWebhookMissingEndpointRoles) && value.stripeWebhookMissingEndpointRoles.length) {
    details.push(`missing endpoint roles: ${value.stripeWebhookMissingEndpointRoles.join(', ')}`)
  }
  if (Array.isArray(value.stripeWebhookMissingRefundEvents) && value.stripeWebhookMissingRefundEvents.length) {
    details.push(`missing refund events: ${value.stripeWebhookMissingRefundEvents.join(', ')}`)
  }
  if (!details.length && [
    value.stripeWebhookEndpointsEnabled,
    value.stripeWebhookEndpointRolesCovered,
    value.stripeWebhookRefundEventsCovered,
  ].some((item) => item == null)) {
    details.push('Stripe endpoint configuration is unverifiable')
  }
  return details.join('; ')
}

function failureLines(output) {
  return cleanDetail(output.split('\n').filter((line) => /^(FAIL|Error|ERROR)/.test(line.trim())).slice(-3).join(' | '))
}

function trimBase(value) {
  return value.replace(/\/+$/, '')
}

function positiveNumber(value, fallback) {
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
}

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function printSummary(passed) {
  const count = (status) => checks.filter((item) => item.status === status).length
  console.log('')
  console.log(`Release certification: ${passed ? 'PASSED' : 'FAILED'} · ${count('pass')} passed · ${count('fail')} failed`)
  console.log(`Evidence: ${REPORT_PATH}`)
}

class FatalProbeError extends Error {}
