import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createSupabaseMock, type QueryContext } from '../../../../test/supabase-mock'

const refs = vi.hoisted(() => ({
  createAdminClient: vi.fn(),
  getOwnerPlanId: vi.fn(),
}))

vi.mock('../../../../utils/supabase/admin', () => ({
  hasSupabaseAdminEnv: vi.fn(() => true),
  createAdminClient: refs.createAdminClient,
}))
vi.mock('../../../../lib/server/plan', () => ({
  getOwnerPlanId: refs.getOwnerPlanId,
}))
vi.mock('../../../../lib/email', () => ({
  hasEmailEnv: vi.fn(() => false),
  buildPromotionExpiryEmail: vi.fn(),
  sendEmail: vi.fn(),
}))
vi.mock('../../../../lib/server/owner-email', () => ({
  resolveOwnerNotifyEmail: vi.fn(),
}))

import { GET } from './route'

const cronRequest = (authorization?: string) => new Request(
  'https://nexez.app/api/cron/reconcile-growth',
  { headers: authorization ? { authorization } : {} },
)

describe('GET /api/cron/reconcile-growth', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubEnv('CRON_SECRET', 'cron-secret')
    refs.getOwnerPlanId.mockResolvedValue('free')
  })
  afterEach(() => vi.unstubAllEnvs())

  it('rejects a scheduled call without the cron bearer', async () => {
    expect((await GET(cronRequest())).status).toBe(401)
  })

  it.each(['free', 'pro'])('expires a grant without charging or replacing the underlying %s plan', async (underlyingPlan) => {
    refs.getOwnerPlanId.mockResolvedValue(underlyingPlan)
    const grant = {
      id: 'grant-1',
      campaign_id: 'campaign-1',
      owner_id: 'owner-1',
      plan_id: 'launch',
      ends_at: '2026-01-01T00:00:00.000Z',
      fallback_page_id: 'page-2',
    }
    const pages = [
      { id: 'page-1', owner_id: 'owner-1', name: 'First', slug: 'first', is_published: true, created_at: '2026-01-01T00:00:00Z' },
      { id: 'page-2', owner_id: 'owner-1', name: 'Primary', slug: 'primary', is_published: true, created_at: '2026-01-02T00:00:00Z' },
      { id: 'draft-1', owner_id: 'owner-1', name: 'Saved draft', slug: 'draft', is_published: false, created_at: '2026-01-03T00:00:00Z' },
    ]
    const writes: Array<{ table: string; op: string; payload: any; calls: QueryContext['calls'] }> = []
    refs.createAdminClient.mockReturnValue(createSupabaseMock((ctx) => {
      if (ctx.op !== 'select') {
        writes.push({ table: ctx.table, op: ctx.op, payload: ctx.payload, calls: [...ctx.calls] })
      }
      if (ctx.table === 'seller_growth_invites') return { data: [], error: null }
      if (ctx.table === 'promotional_plan_grants' && ctx.op === 'select') {
        const isNoticeQuery = ctx.calls.some((call) => call[0] === 'gt' && call[1] === 'ends_at')
        return { data: isNoticeQuery ? [] : [grant], error: null }
      }
      if (ctx.table === 'promotional_plan_grants' && ctx.op === 'update') {
        return { data: { id: grant.id }, error: null }
      }
      if (ctx.table === 'pages' && ctx.op === 'select') return { data: pages, error: null }
      return { data: null, error: null }
    }) as any)

    const response = await GET(cronRequest('Bearer cron-secret'))
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body).toMatchObject({
      ok: true,
      grantsExpired: 1,
      fallbackListingsApplied: underlyingPlan === 'free' ? 1 : 0,
    })
    // The cron no longer applies the retired grandfather baseline or races page
    // updates itself. Expiring the grant invokes the canonical DB reconciler,
    // which preserves page-2 and drafts page-1 under the same transaction lock.
    expect(writes.some((write) => write.table === 'pages' && write.op === 'update')).toBe(false)
    expect(writes.some((write) => write.table === 'pages' && write.op === 'delete')).toBe(false)
    expect(writes.some((write) => write.table === 'billing_subscriptions')).toBe(false)
    const grantWrite = writes.find((write) => write.table === 'promotional_plan_grants' && write.op === 'update')
    expect(grantWrite?.payload).toEqual(underlyingPlan === 'free'
      ? { status: 'expired', fallback_page_id: 'page-2' }
      : { status: 'expired' })
    expect(grantWrite?.calls).toEqual(expect.arrayContaining([
      ['eq', 'status', 'active'],
      ['lte', 'ends_at', expect.any(String)],
    ]))
  })
})
