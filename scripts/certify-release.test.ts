import { spawn } from 'node:child_process'
import { mkdtemp, readFile } from 'node:fs/promises'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { once } from 'node:events'
import { afterEach, describe, expect, it } from 'vitest'

const SHA = 'a'.repeat(40)
const SECRET = 'r'.repeat(32)
const SLUG = 'nexez-agent-negotiation-lab'
const OFFER = 'services-0'
const SUPPORT_REQUEST_ID = '00000000-0000-4000-8000-000000000001'

let closeServer: (() => Promise<void>) | null = null

afterEach(async () => {
  await closeServer?.()
  closeServer = null
})

describe('release certification runner', () => {
  it('waits for the exact revision, probes every surface, and submits durable evidence', async () => {
    const submitted: { value: Record<string, unknown> | null } = { value: null }
    const server = createServer(async (request, response) => {
      const body = await readBody(request)
      route(request, response, body, (value) => { submitted.value = value })
    })
    server.listen(0, '127.0.0.1')
    await once(server, 'listening')
    closeServer = async () => { server.close(); await once(server, 'close') }

    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('Test server did not bind')
    const base = `http://127.0.0.1:${address.port}`
    const outputDir = await mkdtemp(join(tmpdir(), 'nexez-release-cert-'))
    const reportPath = join(outputDir, 'report.json')

    const result = await runRelease({
      NEXEZ_MARKETING_BASE: base,
      NEXEZ_APP_BASE: base,
      NEXEZ_ADMIN_BASE: base,
      NEXEZ_AGENT_BASE: base,
      NEXEZ_RELEASE_CERT_ENDPOINT: `${base}/api/internal/release-certifications`,
      NEXEZ_RELEASE_CERT_SECRET: SECRET,
      NEXEZ_COMMIT_SHA: SHA,
      NEXEZ_CI_CONCLUSION: 'success',
      NEXEZ_RELEASE_WAIT_MS: '1000',
      NEXEZ_RELEASE_POLL_MS: '20',
      NEXEZ_RELEASE_TIMEOUT_MS: '2000',
      NEXEZ_RELEASE_REPORT_PATH: reportPath,
      STRIPE_SECRET_KEY: '',
      STRIPE_PRICE_LAUNCH: '',
      STRIPE_PRICE_PRO: '',
      STRIPE_PRICE_SCALE: '',
    })

    expect(result.code, result.output).toBe(0)
    expect(result.output).toContain('Release certification: PASSED')
    const report = JSON.parse(await readFile(reportPath, 'utf8'))
    expect(report).toMatchObject({ status: 'passed', promotionEligible: true, commitSha: SHA, record: { recordId: 'release-1' } })
    expect(report.checks.every((check: { status: string }) => check.status === 'pass')).toBe(true)
    expect(submitted.value).toMatchObject({
      schemaVersion: 1,
      commitSha: SHA,
      environment: 'production',
    })
    expect((submitted.value?.checks as Array<{ id: string }>).map((check) => check.id)).toEqual(expect.arrayContaining([
      'settings-agent-lab',
      'admin-host',
      'support-privacy',
      'commerce-gauntlet',
    ]))
  }, 15_000)

  it('fails when requester support APIs permit anonymous access', async () => {
    const server = createServer(async (request, response) => {
      const body = await readBody(request)
      route(request, response, body, () => {}, { supportApiStatus: 200 })
    })
    server.listen(0, '127.0.0.1')
    await once(server, 'listening')
    closeServer = async () => { server.close(); await once(server, 'close') }

    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('Test server did not bind')
    const base = `http://127.0.0.1:${address.port}`
    const outputDir = await mkdtemp(join(tmpdir(), 'nexez-release-cert-'))
    const reportPath = join(outputDir, 'report.json')

    const result = await runRelease({
      NEXEZ_MARKETING_BASE: base,
      NEXEZ_APP_BASE: base,
      NEXEZ_ADMIN_BASE: base,
      NEXEZ_AGENT_BASE: base,
      NEXEZ_RELEASE_CERT_ENDPOINT: `${base}/api/internal/release-certifications`,
      NEXEZ_RELEASE_CERT_SECRET: SECRET,
      NEXEZ_COMMIT_SHA: SHA,
      NEXEZ_CI_CONCLUSION: 'success',
      NEXEZ_RELEASE_WAIT_MS: '1000',
      NEXEZ_RELEASE_POLL_MS: '20',
      NEXEZ_RELEASE_TIMEOUT_MS: '2000',
      NEXEZ_RELEASE_REPORT_PATH: reportPath,
      STRIPE_SECRET_KEY: '',
      STRIPE_PRICE_LAUNCH: '',
      STRIPE_PRICE_PRO: '',
      STRIPE_PRICE_SCALE: '',
    })

    expect(result.code).toBe(1)
    expect(result.output).toContain('FAIL Support requester boundaries')
    const report = JSON.parse(await readFile(reportPath, 'utf8'))
    expect(report).toMatchObject({ status: 'failed', promotionEligible: false })
    expect(report.checks).toContainEqual(expect.objectContaining({ id: 'support-privacy', status: 'fail', required: true }))
  }, 15_000)

  it('reports safe Stripe configuration detail when delivery readiness blocks release', async () => {
    const server = createServer(async (request, response) => {
      const body = await readBody(request)
      route(request, response, body, () => {}, {
        launchHealth: {
          ok: false,
          service: 'nexez-launch-control',
          deployment: {
            revision: SHA,
            deploymentId: 'dpl_test',
            deploymentUrl: 'https://nexez-test.vercel.app',
            environment: 'production',
          },
          summary: { status: 'blocked', score: 95 },
          blockers: [{ id: 'stripe-delivery', status: 'blocked' }],
          stripeWebhookConfiguration: {
            stripeWebhookEndpointsEnabled: true,
            stripeWebhookEndpointRolesCovered: false,
            stripeWebhookRefundEventsCovered: false,
            stripeWebhookEndpointCount: 1,
            stripeWebhookMissingEndpointRoles: ['connected-account'],
            stripeWebhookMissingRefundEvents: ['refund.failed'],
          },
        },
      })
    })
    server.listen(0, '127.0.0.1')
    await once(server, 'listening')
    closeServer = async () => { server.close(); await once(server, 'close') }

    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('Test server did not bind')
    const base = `http://127.0.0.1:${address.port}`
    const outputDir = await mkdtemp(join(tmpdir(), 'nexez-release-cert-'))
    const reportPath = join(outputDir, 'report.json')

    const result = await runRelease({
      NEXEZ_MARKETING_BASE: base,
      NEXEZ_APP_BASE: base,
      NEXEZ_ADMIN_BASE: base,
      NEXEZ_AGENT_BASE: base,
      NEXEZ_RELEASE_CERT_ENDPOINT: `${base}/api/internal/release-certifications`,
      NEXEZ_RELEASE_CERT_SECRET: SECRET,
      NEXEZ_COMMIT_SHA: SHA,
      NEXEZ_CI_CONCLUSION: 'success',
      NEXEZ_RELEASE_WAIT_MS: '1000',
      NEXEZ_RELEASE_POLL_MS: '20',
      NEXEZ_RELEASE_TIMEOUT_MS: '2000',
      NEXEZ_RELEASE_REPORT_PATH: reportPath,
      STRIPE_SECRET_KEY: '',
      STRIPE_PRICE_LAUNCH: '',
      STRIPE_PRICE_PRO: '',
      STRIPE_PRICE_SCALE: '',
    })

    expect(result.code).toBe(1)
    expect(result.output).toContain('missing endpoint roles: connected-account')
    expect(result.output).toContain('missing refund events: refund.failed')
    const report = JSON.parse(await readFile(reportPath, 'utf8'))
    expect(report.checks).toContainEqual(expect.objectContaining({
      id: 'launch-control',
      status: 'fail',
      detail: expect.stringContaining('1 matching Stripe endpoints'),
    }))
  }, 15_000)
})

type RouteOptions = {
  supportApiStatus?: number
  launchHealth?: Record<string, unknown>
}

function route(
  request: IncomingMessage,
  response: ServerResponse,
  body: string,
  captureSubmission: (value: Record<string, unknown>) => void,
  options: RouteOptions = {},
) {
  const requestUrl = new URL(request.url || '/', baseFrom(request))
  const path = requestUrl.pathname
  if (path === '/api/internal/launch-health') {
    expect(request.headers.authorization).toBe(`Bearer ${SECRET}`)
    const launchHealth = options.launchHealth ?? {
      ok: true,
      service: 'nexez-launch-control',
      deployment: {
        revision: SHA,
        deploymentId: 'dpl_test',
        deploymentUrl: 'https://nexez-test.vercel.app',
        environment: 'production',
      },
      summary: { status: 'ready', score: 100 },
      blockers: [],
    }
    return json(response, launchHealth.ok === false ? 503 : 200, launchHealth)
  }
  if (path === '/api/internal/release-certifications' && request.method === 'POST') {
    expect(request.headers.authorization).toBe(`Bearer ${SECRET}`)
    captureSubmission(JSON.parse(body))
    return json(response, 201, { ok: true, status: 'passed', recordId: 'release-1', replayed: false })
  }
  if (path === '/dashboard/settings') {
    response.writeHead(302, { Location: '/login?next=%2Fdashboard%2Fsettings' })
    return response.end()
  }
  if (path === '/admin/support') {
    response.writeHead(302, { Location: '/login?next=%2Fadmin%2Fsupport' })
    return response.end()
  }
  if (path === `/support/requests/${SUPPORT_REQUEST_ID}`) {
    response.writeHead(302, { Location: `/login?next=${encodeURIComponent(`/support/requests/${SUPPORT_REQUEST_ID}`)}` })
    return response.end()
  }
  if (path === '/api/support/tickets' && request.method === 'GET') {
    const supportApiStatus = options.supportApiStatus ?? 401
    return json(response, supportApiStatus, supportApiStatus === 401 ? { error: 'Not authenticated' } : { tickets: [] })
  }
  if (path === `/api/support/tickets/${SUPPORT_REQUEST_ID}/messages` && request.method === 'POST') {
    const supportApiStatus = options.supportApiStatus ?? 401
    return json(response, supportApiStatus, supportApiStatus === 401 ? { error: 'Not authenticated' } : { ok: true })
  }
  if (path === '/api/agent-lab/research-runs') return json(response, 401, { error: 'Sign in to view saved research.' })
  if (path === '/' || path === '/login' || path === '/simulator' || path === '/support' || path === `/${SLUG}`) {
    return html(response, '<html><body>Nexez</body></html>')
  }
  if (path === '/api/v1/health') return json(response, 200, { ok: true, service: 'nexez-api-v1' })
  if (path === `/${SLUG}/agent.json`) {
    return json(response, 200, { page: { slug: SLUG }, offers: [{ key: OFFER }] })
  }
  if (path === `/${SLUG}/llms.txt`) return text(response, `Manifest: /${SLUG}/agent.json`)
  if (path === `/${SLUG}/openapi.json`) return json(response, 200, { openapi: '3.1.0', paths: {} })
  if (path === '/llms.txt') return text(response, `${baseFrom(request)}/agent-pages.json`)
  if (path === '/.well-known/mcp.json') return json(response, 200, { name: 'Nexez MCP' })
  if (path === '/openapi.json') return json(response, 200, { openapi: '3.1.0', paths: {} })
  if (path === '/agent-pages.json') return json(response, 200, { pages: [] })
  if (path === '/api/checkout' && request.method === 'POST') {
    const payload = JSON.parse(body)
    return payload.dryRun
      ? json(response, 200, { ok: true, approvalTokenRequired: true, approvalToken: 'a.b.c' })
      : json(response, 403, { code: 'approval_required' })
  }
  if (path === '/api/negotiations' && request.method === 'POST') {
    const payload = JSON.parse(body)
    return payload.dryRun
      ? json(response, 200, { ok: true, approvalTokenRequired: true, approvalToken: 'a.b.c' })
      : json(response, 403, { code: 'approval_required' })
  }
  return json(response, 404, { error: 'not_found', path })
}

async function runRelease(env: Record<string, string>) {
  const child = spawn(process.execPath, ['scripts/certify-release.mjs'], {
    cwd: process.cwd(),
    env: { ...process.env, ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  let output = ''
  child.stdout.on('data', (chunk) => { output += String(chunk) })
  child.stderr.on('data', (chunk) => { output += String(chunk) })
  const [code] = await once(child, 'close') as [number]
  return { code, output }
}

function readBody(request: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let value = ''
    request.setEncoding('utf8')
    request.on('data', (chunk) => { value += chunk })
    request.on('end', () => resolve(value))
    request.on('error', reject)
  })
}

function baseFrom(request: IncomingMessage) {
  return `http://${request.headers.host}`
}

function json(response: ServerResponse, status: number, value: unknown) {
  response.writeHead(status, { 'Content-Type': 'application/json' })
  response.end(JSON.stringify(value))
}

function html(response: ServerResponse, value: string) {
  response.writeHead(200, { 'Content-Type': 'text/html' })
  response.end(value)
}

function text(response: ServerResponse, value: string) {
  response.writeHead(200, { 'Content-Type': 'text/plain' })
  response.end(value)
}
