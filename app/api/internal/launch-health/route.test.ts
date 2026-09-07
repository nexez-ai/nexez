import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { LaunchControlSnapshot } from '../../../../lib/launch-control'

const refs = vi.hoisted(() => ({ status: 'ready' as 'ready' | 'attention' }))
const captureError = vi.hoisted(() => vi.fn())

vi.mock('../../../../lib/observability', () => ({ captureError }))
vi.mock('../../../../lib/server/launch-control', () => ({
  getLaunchControlSnapshot: vi.fn(async () => launchSnapshot(refs.status)),
}))
vi.mock('../../../../lib/server/release-certification', () => ({
  getReleaseDeploymentIdentity: vi.fn(() => ({
    revision: 'a'.repeat(40),
    deploymentId: 'dpl_test',
    deploymentUrl: 'https://nexez-test.vercel.app',
    environment: 'production',
  })),
}))

import { GET } from './route'

const SECRET = 'r'.repeat(32)

describe('GET /api/internal/launch-health', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubEnv('NEXEZ_RELEASE_CERT_SECRET', SECRET)
    refs.status = 'ready'
  })

  it('fails closed without the release-certification bearer token', async () => {
    const response = await GET(new Request('https://app.nexez.ai/api/internal/launch-health'))
    expect(response.status).toBe(401)
  })

  it('returns redacted machine health to the authenticated release runner', async () => {
    const response = await GET(requestWithSecret())
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body).toMatchObject({
      ok: true,
      service: 'nexez-launch-control',
      deployment: { revision: 'a'.repeat(40), environment: 'production' },
    })
    expect(JSON.stringify(body)).not.toContain('evidence that stays private')
  })

  it('uses HTTP 503 when a required launch check needs attention', async () => {
    refs.status = 'attention'
    const response = await GET(requestWithSecret())
    expect(response.status).toBe(503)
    const body = await response.json()
    expect(body.ok).toBe(false)
    expect(body.blockers).toEqual([
      expect.objectContaining({ id: 'commerce', status: 'attention' }),
    ])
  })
})

function requestWithSecret() {
  return new Request('https://app.nexez.ai/api/internal/launch-health', {
    headers: { Authorization: `Bearer ${SECRET}` },
  })
}

function launchSnapshot(status: 'ready' | 'attention'): LaunchControlSnapshot {
  const commerce = {
    id: 'commerce',
    label: 'Commerce',
    detail: 'detail',
    evidence: 'evidence that stays private',
    status,
    required: true,
  } as const
  return {
    generatedAt: '2026-07-18T12:00:00.000Z',
    environment: {
      stripeMode: 'live',
      marketingHost: 'nexez.ai',
      appHost: 'app.nexez.ai',
      agentHost: 'nexez.app',
    },
    configuration: [],
    operations: [],
    certification: [commerce],
    summary: {
      status,
      score: status === 'ready' ? 100 : 55,
      ready: status === 'ready' ? 1 : 0,
      attention: status === 'attention' ? 1 : 0,
      blocked: 0,
      unknown: 0,
    },
    metrics: {
      stripeWebhookEndpointsEnabled: true,
      stripeWebhookEndpointRolesCovered: true,
      stripeWebhookRefundEventsCovered: true,
      stripeWebhookEndpointCount: 2,
      stripeWebhookMissingEndpointRoles: [],
      stripeWebhookMissingRefundEvents: [],
    },
    incidents: [],
  } as unknown as LaunchControlSnapshot
}
