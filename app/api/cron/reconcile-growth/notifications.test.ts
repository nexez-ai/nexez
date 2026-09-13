import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createSupabaseMock, type QueryContext } from '../../../../test/supabase-mock'

const refs = vi.hoisted(() => ({
  createAdminClient: vi.fn(),
  getOwnerPlanId: vi.fn(),
  sendOnceSystemEmail: vi.fn(),
  resolveOwnerNotifyEmail: vi.fn(),
}))

vi.mock('../../../../utils/supabase/admin', () => ({
  hasSupabaseAdminEnv: vi.fn(() => true),
  createAdminClient: refs.createAdminClient,
}))
vi.mock('../../../../lib/server/plan', () => ({ getOwnerPlanId: refs.getOwnerPlanId }))
vi.mock('../../../../lib/email', () => ({
  hasEmailEnv: vi.fn(() => true),
  buildPromotionExpiryEmail: vi.fn(async () => ({ subject: 's', html: 'h', text: 't' })),
  buildLaunchAccessStartedEmail: vi.fn(async () => ({ subject: 's', html: 'h', text: 't' })),
  buildPublishNudgeEmail: vi.fn(async () => ({ subject: 's', html: 'h', text: 't' })),
  sendEmail: vi.fn(async () => ({ ok: true })),
}))
vi.mock('../../../../lib/server/owner-email', () => ({
  resolveOwnerNotifyEmail: refs.resolveOwnerNotifyEmail,
}))
vi.mock('../../../../lib/server/system-email', () => ({
  sendOnceSystemEmail: refs.sendOnceSystemEmail,
}))

import { describeGrantDuration } from '../../../../lib/growth-duration'
import { GET } from './route'

const HOUR = 3_600_000
const cronRequest = () => new Request(
  'https://nexez.app/api/cron/reconcile-growth',
  { headers: { authorization: 'Bearer cron-secret' } },
)

const liveGrant = {
  id: 'grant-1',
  campaign_id: 'campaign-1',
  owner_id: 'owner-1',
  ends_at: new Date(Date.now() + 90 * 24 * HOUR).toISOString(),
  entitlement_activated_at: new Date().toISOString(),
}

const campaign = { id: 'campaign-1', grant_duration_days: 180, signup_closes_at: null }

const publishedPage = {
  id: 'page-1', owner_id: 'owner-1', name: 'Emergency Plumbing', slug: 'emergency',
  is_published: true, created_at: '2026-08-01T00:00:00Z',
}
const draftPage = { ...publishedPage, id: 'page-2', is_published: false }

/**
 * The route issues several reads against the same tables with different filters,
 * so the fixture keys off the filters rather than the table alone. `alreadyTold`
 * and `stalledInvites` are what each test varies.
 */
function mockDb(opts: {
  startedGrants?: unknown[]
  alreadyTold?: Array<{ owner_id: string; kind: string }>
  stalledInvites?: unknown[]
  pages?: unknown[]
  onQuery?: (ctx: QueryContext) => void
}) {
  return createSupabaseMock((ctx) => {
    opts.onQuery?.(ctx)
    const has = (method: string, arg?: string) =>
      ctx.calls.some(([m, a]) => m === method && (arg === undefined || a === arg))

    if (ctx.table === 'seller_growth_invites') {
      if (ctx.eqs.status === 'claimed') return { data: opts.stalledInvites ?? [], error: null }
      return { data: [], error: null }
    }
    if (ctx.table === 'promotional_plan_grants' && ctx.op === 'select') {
      // The start-notice read is the only one filtering on entitlement_activated_at.
      if (has('not', 'entitlement_activated_at')) return { data: opts.startedGrants ?? [], error: null }
      return { data: [], error: null }
    }
    if (ctx.table === 'sent_system_emails') return { data: opts.alreadyTold ?? [], error: null }
    if (ctx.table === 'pages') return { data: opts.pages ?? [], error: null }
    if (ctx.table === 'seller_growth_campaigns') return { data: [campaign], error: null }
    return { data: [], error: null }
  })
}

describe('reconcile-growth notifications', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubEnv('CRON_SECRET', 'cron-secret')
    refs.getOwnerPlanId.mockResolvedValue('free')
    refs.resolveOwnerNotifyEmail.mockResolvedValue('owner@example.com')
    refs.sendOnceSystemEmail.mockResolvedValue({ sent: true })
  })
  afterEach(() => vi.unstubAllEnvs())

  it('tells an owner their Launch access started, keyed per campaign', async () => {
    refs.createAdminClient.mockReturnValue(mockDb({
      startedGrants: [liveGrant],
      pages: [publishedPage],
    }))

    const body = await (await GET(cronRequest())).json()

    expect(body.startNoticesSent).toBe(1)
    expect(refs.sendOnceSystemEmail).toHaveBeenCalledWith(expect.objectContaining({
      ownerId: 'owner-1',
      kind: 'growth_grant_started:campaign-1',
      to: 'owner@example.com',
    }))
  })

  it('does not re-claim a grant it has already told the owner about', async () => {
    // Without the pre-filter this route would attempt one insert per live grant per
    // hour for the life of every grant, eating a unique violation each time.
    refs.createAdminClient.mockReturnValue(mockDb({
      startedGrants: [liveGrant],
      alreadyTold: [{ owner_id: 'owner-1', kind: 'growth_grant_started:campaign-1' }],
      pages: [publishedPage],
    }))

    const body = await (await GET(cronRequest())).json()

    expect(body.startNoticesSent).toBe(0)
    expect(refs.sendOnceSystemEmail).not.toHaveBeenCalled()
  })

  it('nudges a claimed spot that has never published', async () => {
    refs.createAdminClient.mockReturnValue(mockDb({
      stalledInvites: [{
        id: 'invite-1',
        campaign_id: 'campaign-1',
        accepted_by_owner_id: 'owner-1',
        accepted_at: new Date(Date.now() - 100 * HOUR).toISOString(),
      }],
      pages: [draftPage],
    }))

    const body = await (await GET(cronRequest())).json()

    expect(body.publishNudgesSent).toBe(1)
    expect(refs.sendOnceSystemEmail).toHaveBeenCalledWith(expect.objectContaining({
      kind: 'growth_publish_nudge:campaign-1',
    }))
  })

  it('stays quiet when the owner has published but holds no grant', async () => {
    // Their blocker is business verification or a full campaign, and "finish your
    // listing" would be a confusing instruction for someone who already did.
    refs.createAdminClient.mockReturnValue(mockDb({
      stalledInvites: [{
        id: 'invite-1',
        campaign_id: 'campaign-1',
        accepted_by_owner_id: 'owner-1',
        accepted_at: new Date(Date.now() - 100 * HOUR).toISOString(),
      }],
      pages: [publishedPage],
    }))

    const body = await (await GET(cronRequest())).json()

    expect(body.publishNudgesSent).toBe(0)
    expect(refs.sendOnceSystemEmail).not.toHaveBeenCalled()
  })

  it('only considers spots claimed longer ago than the grace window', async () => {
    const seen: Array<[string, ...any[]]> = []
    refs.createAdminClient.mockReturnValue(mockDb({
      onQuery: (ctx) => {
        if (ctx.table === 'seller_growth_invites' && ctx.eqs.status === 'claimed') {
          seen.push(...ctx.calls.filter(([m, k]) => m === 'lte' && k === 'accepted_at'))
        }
      },
    }))

    await GET(cronRequest())

    expect(seen).toHaveLength(1)
    const cutoffMs = Date.parse(seen[0]![2])
    const hoursBack = (Date.now() - cutoffMs) / HOUR
    expect(hoursBack).toBeGreaterThan(71)
    expect(hoursBack).toBeLessThan(73)
  })

  it('reports a send failure instead of counting it', async () => {
    refs.sendOnceSystemEmail.mockResolvedValue({ sent: false, reason: 'resend 500' })
    refs.createAdminClient.mockReturnValue(mockDb({
      startedGrants: [liveGrant],
      pages: [publishedPage],
    }))

    const body = await (await GET(cronRequest())).json()

    expect(body.startNoticesSent).toBe(0)
    expect(body.ok).toBe(false)
    expect(body.errors).toContain('grant_start_notice:grant-1')
  })

  it('treats an already-sent skip as success, not an error', async () => {
    refs.sendOnceSystemEmail.mockResolvedValue({ sent: false, skipped: true, reason: 'already_sent' })
    refs.createAdminClient.mockReturnValue(mockDb({
      startedGrants: [liveGrant],
      pages: [publishedPage],
    }))

    const body = await (await GET(cronRequest())).json()

    expect(body.ok).toBe(true)
    expect(body.errors).toBeUndefined()
  })
})

describe('describeGrantDuration', () => {
  it('says what the merchant was sold', () => {
    expect(describeGrantDuration(180)).toBe('180 days')
    expect(describeGrantDuration(30)).toBe('30 days')
    expect(describeGrantDuration(365)).toBe('365 days')
    expect(describeGrantDuration(730)).toBe('730 days')
  })

  it('falls back to days when the window is not a round period', () => {
    expect(describeGrantDuration(45)).toBe('45 days')
    expect(describeGrantDuration(1)).toBe('one day')
  })

  it('never renders a nonsense period', () => {
    expect(describeGrantDuration(0)).toBe('your complimentary period')
    expect(describeGrantDuration(Number.NaN)).toBe('your complimentary period')
    expect(describeGrantDuration(-5)).toBe('your complimentary period')
    expect(describeGrantDuration(1.5)).toBe('your complimentary period')
    expect(describeGrantDuration(Infinity)).toBe('your complimentary period')
  })
})
