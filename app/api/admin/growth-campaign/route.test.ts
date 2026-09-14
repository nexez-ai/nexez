import { beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => {
  class GrowthControlError extends Error {
    constructor(message: string, readonly code: string) {
      super(message)
    }
  }
  return {
    user: { id: 'admin-1' } as null | { id: string },
    admin: true,
    limited: null as Response | null,
    apply: vi.fn(async () => ({
      available: true,
      campaign: { status: 'paused' },
      generatedAt: '2026-07-26T00:00:00.000Z',
    })),
    applyCohort: vi.fn(async () => ({
      snapshot: {
        campaign: { grantDurationDays: 180 },
        cohortMembers: [{
          id: '33333333-3333-4333-8333-333333333333',
          email: 'owner@acme.test',
          label: 'Acme',
          status: 'pending',
          expiresAt: '2026-08-09T00:00:00.000Z',
          acceptedAt: null,
          qualifiedAt: null,
          deliveryCount: 0,
          lastSentAt: null,
          createdAt: '2026-07-26T00:00:00.000Z',
        }],
      },
      member: {
        id: '33333333-3333-4333-8333-333333333333',
        email: 'owner@acme.test',
        label: 'Acme',
        status: 'pending',
        expiresAt: '2026-08-09T00:00:00.000Z',
        acceptedAt: null,
        qualifiedAt: null,
        deliveryCount: 0,
        lastSentAt: null,
        createdAt: '2026-07-26T00:00:00.000Z',
      },
      token: 'secure_cohort_token_secure_cohort_token_123',
      replayed: false,
    })),
    stageCohort: vi.fn(async () => ({
      snapshot: { campaign: { id: 'campaign-1' }, cohortMembers: [] },
      summary: { candidateCount: 2, stagedCount: 2, updatedCount: 0, duplicateCount: 0, waves: [1], replayed: false },
    })),
    releaseWave: vi.fn(async () => ({
      snapshot: { campaign: { id: 'campaign-1' }, cohortMembers: [] },
      summary: { wave: 1, requested: 20, selected: 2, sent: 2, failed: 0, replayed: false },
    })),
    getSnapshot: vi.fn(),
    recordDelivery: vi.fn(),
    GrowthControlError,
  }
})

vi.mock('next/headers', () => ({ cookies: vi.fn(async () => ({})) }))
vi.mock('../../../../utils/supabase/server', () => ({
  createClient: () => ({ auth: { getUser: async () => ({ data: { user: state.user } }) } }),
}))
vi.mock('../../../../lib/server/plan', () => ({ isPlatformAdmin: vi.fn(async () => state.admin) }))
vi.mock('../../../../lib/rate-limit', () => ({
  enforceRateLimit: vi.fn(async () => state.limited),
}))
vi.mock('../../../../lib/server/growth-control', () => ({
  GrowthControlError: state.GrowthControlError,
  applyGrowthCampaignControl: state.apply,
  getGrowthControlSnapshot: state.getSnapshot,
}))
vi.mock('../../../../lib/server/growth-cohort', () => ({
  applyGrowthCohortControl: state.applyCohort,
  recordGrowthCohortDelivery: state.recordDelivery,
  stageGrowthCohortBatch: state.stageCohort,
  releaseGrowthCohortWave: state.releaseWave,
}))
vi.mock('../../../../lib/email', () => ({
  hasEmailEnv: vi.fn(() => false),
  buildSellerGrowthInviteEmail: vi.fn(),
  sendEmail: vi.fn(),
}))

import { PATCH } from './route'

const CAMPAIGN_ID = '11111111-1111-4111-8111-111111111111'
const IDEMPOTENCY_KEY = '22222222-2222-4222-8222-222222222222'
const request = (body: unknown, origin: string | null = 'https://app.nexez.ai') => new Request(
  'https://app.nexez.ai/api/admin/growth-campaign',
  {
    method: 'PATCH',
    headers: {
      'content-type': 'application/json',
      ...(origin ? { origin } : {}),
    },
    body: JSON.stringify(body),
  },
)

describe('PATCH /api/admin/growth-campaign', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    state.user = { id: 'admin-1' }
    state.admin = true
    state.limited = null
    state.getSnapshot.mockResolvedValue(null)
  })

  it('requires a same-origin browser request', async () => {
    expect((await PATCH(request({}, null))).status).toBe(403)
    expect((await PATCH(request({}, 'https://nexez.ai'))).status).toBe(403)
    expect(state.apply).not.toHaveBeenCalled()
  })

  it('fails closed when the administrative rate limit is unavailable', async () => {
    state.limited = new Response(JSON.stringify({ error: 'Rate limit unavailable' }), { status: 503 })
    expect((await PATCH(request({}))).status).toBe(503)
    expect(state.apply).not.toHaveBeenCalled()
  })

  it('requires an authenticated platform administrator', async () => {
    state.user = null
    expect((await PATCH(request({}))).status).toBe(401)

    state.user = { id: 'member-1' }
    state.admin = false
    expect((await PATCH(request({}))).status).toBe(403)
    expect(state.apply).not.toHaveBeenCalled()
  })

  it('rejects malformed, unexplained, or over-broad mutations', async () => {
    const base = {
      campaignId: CAMPAIGN_ID,
      idempotencyKey: IDEMPOTENCY_KEY,
      reason: 'Capacity review',
    }
    expect((await PATCH(request({ ...base, action: 'delete' }))).status).toBe(400)
    expect((await PATCH(request({ ...base, action: 'pause', maxGrants: 5 }))).status).toBe(400)
    expect((await PATCH(request({ ...base, action: 'pause', reason: 'x' }))).status).toBe(400)
    expect(state.apply).not.toHaveBeenCalled()
  })

  it('applies a bounded, idempotent control as the authenticated actor', async () => {
    const response = await PATCH(request({
      campaignId: CAMPAIGN_ID,
      action: 'set_capacity',
      reason: 'Increase after quality review',
      idempotencyKey: IDEMPOTENCY_KEY,
      maxGrants: 1250,
    }))

    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(state.apply).toHaveBeenCalledWith({
      campaignId: CAMPAIGN_ID,
      action: 'set_capacity',
      reason: 'Increase after quality review',
      idempotencyKey: IDEMPOTENCY_KEY,
      maxGrants: 1250,
      signupClosesAt: null,
      enrollmentMode: null,
      actorId: 'admin-1',
    })
  })

  it('creates an email-bound private cohort seat as the authenticated actor', async () => {
    const response = await PATCH(request({
      campaignId: CAMPAIGN_ID,
      action: 'cohort_add',
      reason: 'Opening cohort candidate',
      idempotencyKey: IDEMPOTENCY_KEY,
      email: 'OWNER@ACME.TEST',
      label: 'Acme',
    }))

    expect(response.status).toBe(200)
    expect(state.applyCohort).toHaveBeenCalledWith({
      campaignId: CAMPAIGN_ID,
      action: 'cohort_add',
      reason: 'Opening cohort candidate',
      idempotencyKey: IDEMPOTENCY_KEY,
      email: 'OWNER@ACME.TEST',
      label: 'Acme',
      memberId: null,
      actorId: 'admin-1',
    })
    expect(await response.json()).toMatchObject({
      ok: true,
      emailed: false,
      claimUrl: 'https://app.nexez.ai/invite/secure_cohort_token_secure_cohort_token_123',
      member: { email: 'owner@acme.test', status: 'pending' },
    })
    expect(state.releaseWave).not.toHaveBeenCalled()
  })

  it('stages a verified batch without invoking a release', async () => {
    const candidates = [{
      email: 'owner@acme.test',
      label: 'Acme',
      wave: 1,
      verificationStatus: 'valid',
      verificationProvider: 'millionverifier',
    }]
    const response = await PATCH(request({
      campaignId: CAMPAIGN_ID,
      action: 'cohort_stage_batch',
      reason: 'Reviewed founding candidates',
      idempotencyKey: IDEMPOTENCY_KEY,
      candidates,
    }))

    expect(response.status).toBe(200)
    expect(state.stageCohort).toHaveBeenCalledWith({
      campaignId: CAMPAIGN_ID,
      action: 'cohort_stage_batch',
      reason: 'Reviewed founding candidates',
      idempotencyKey: IDEMPOTENCY_KEY,
      candidates,
      actorId: 'admin-1',
    })
    expect(state.releaseWave).not.toHaveBeenCalled()
  })

  it('requires a bounded, explicit wave release', async () => {
    const base = {
      campaignId: CAMPAIGN_ID,
      action: 'cohort_release_wave',
      reason: 'Release after verification review',
      idempotencyKey: IDEMPOTENCY_KEY,
      wave: 1,
    }
    expect((await PATCH(request({ ...base, limit: 26, confirmation: 'RELEASE WAVE 1' }))).status).toBe(400)

    const response = await PATCH(request({ ...base, limit: 20, confirmation: 'RELEASE WAVE 1' }))
    expect(response.status).toBe(200)
    expect(state.releaseWave).toHaveBeenCalledWith({
      ...base,
      limit: 20,
      confirmation: 'RELEASE WAVE 1',
      actorId: 'admin-1',
    })
  })

  it('maps campaign conflicts without flattening them into server errors', async () => {
    state.apply.mockRejectedValueOnce(
      new state.GrowthControlError('Only an active campaign can be paused.', 'conflict'),
    )
    const response = await PATCH(request({
      campaignId: CAMPAIGN_ID,
      action: 'pause',
      reason: 'Pause for quality review',
      idempotencyKey: IDEMPOTENCY_KEY,
    }))

    expect(response.status).toBe(409)
    expect(await response.json()).toMatchObject({ code: 'conflict' })
  })
})
