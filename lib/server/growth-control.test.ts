import { describe, expect, it, vi } from 'vitest'
import { createSupabaseMock, type QueryContext } from '../../test/supabase-mock'
import { getGrowthControlSnapshot } from './growth-control'

const campaign = {
  id: '11111111-1111-4111-8111-111111111111',
  campaign_key: 'launch-six-month-2026',
  name: 'Six months of Launch',
  status: 'active',
  grant_plan_id: 'launch',
  grant_duration_days: 180,
  invite_slots: 2,
  invite_expires_days: 14,
  max_grants: 1000,
  starts_at: '2026-07-25T00:00:00.000Z',
  signup_closes_at: null,
  enrollment_mode: 'open',
  updated_at: '2026-07-25T01:00:00.000Z',
}

function client(
  handler: (ctx: QueryContext) => { data?: any; error?: any },
  rpcResult: { data?: any; error?: any },
) {
  return {
    ...createSupabaseMock(handler),
    rpc: vi.fn(async () => rpcResult),
  } as any
}

describe('getGrowthControlSnapshot', () => {
  it('scopes the default operator dashboard to public Launch campaigns', async () => {
    const db = client((ctx) => {
      if (ctx.table === 'seller_growth_campaigns') {
        expect(ctx.eqs.is_public_launch).toBe(true)
        expect(ctx.calls).toContainEqual(['order', 'id', { ascending: true }])
        // Operators must still see a paused public campaign to diagnose it.
        expect(ctx.eqs.status).toBeUndefined()
        return { data: { ...campaign, status: 'paused' }, error: null }
      }
      return { data: [], error: null }
    }, { data: {}, error: null })
    const snapshot = await getGrowthControlSnapshot(db)
    expect(snapshot.campaign).toMatchObject({ id: campaign.id, status: 'paused' })
    expect(db.rpc).toHaveBeenCalledWith('seller_growth_control_snapshot', { p_campaign_id: campaign.id })
  })

  it('loads aggregate telemetry while redacting recipient and owner data', async () => {
    const db = client((ctx) => {
      if (ctx.table === 'seller_growth_campaigns') return { data: campaign, error: null }
      if (ctx.table === 'seller_growth_events') {
        return {
          data: [{
            id: 9,
            event_type: 'invite_created',
            metadata: {
              emailed: true,
              invitee_email: 'private@example.com',
              owner_id: 'private-owner',
            },
            created_at: '2026-07-25T02:00:00.000Z',
          }],
          error: null,
        }
      }
      if (ctx.table === 'seller_growth_campaign_admin_events') {
        return {
          data: [{
            id: 2,
            action: 'pause',
            reason: 'Investigating referral quality',
            before_state: { status: 'active' },
            after_state: { status: 'paused' },
            created_at: '2026-07-25T03:00:00.000Z',
          }],
          error: null,
        }
      }
      if (ctx.table === 'seller_growth_invites') return { data: [], error: null }
      return { data: null, error: null }
    }, {
      data: {
        grants_total: '20',
        grants_active: 18,
        welcome_grants: 12,
        referral_grants: 8,
        paid_conversions: 4,
        invites_total: 10,
        invites_claimed: 3,
        invites_qualified: 2,
        invites_delivered: 9,
      },
      error: null,
    })

    const snapshot = await getGrowthControlSnapshot(db)

    expect(snapshot.available).toBe(true)
    expect(snapshot.campaign).toMatchObject({ key: campaign.campaign_key, maxGrants: 1000 })
    expect(snapshot.metrics).toMatchObject({
      grantsTotal: 20,
      grantsActive: 18,
      paidConversions: 4,
    })
    expect(snapshot.summary).toMatchObject({
      capacityRemaining: 980,
      paidConversionRate: 20,
      inviteClaimRate: 50,
    })
    expect(snapshot.recentEvents[0]).toMatchObject({
      label: 'Pass created',
      detail: 'Invitation email delivered',
    })
    expect(snapshot.adminEvents[0]).toMatchObject({
      action: 'pause',
      beforeStatus: 'active',
      afterStatus: 'paused',
    })
    expect(JSON.stringify(snapshot)).not.toContain('private@example.com')
    expect(JSON.stringify(snapshot)).not.toContain('private-owner')
  })

  it('returns the campaign with explicit warnings when telemetry sources fail', async () => {
    const db = client((ctx) => {
      if (ctx.table === 'seller_growth_campaigns') return { data: campaign, error: null }
      return { data: null, error: { message: 'unavailable' } }
    }, { data: null, error: { message: 'rpc unavailable' } })

    const snapshot = await getGrowthControlSnapshot(db)

    expect(snapshot.available).toBe(false)
    expect(snapshot.campaign?.id).toBe(campaign.id)
    expect(snapshot.metrics.grantsTotal).toBe(0)
    expect(snapshot.warnings).toEqual([
      'Campaign totals are unavailable.',
      'Cohort rollout totals are unavailable.',
      'Recent campaign activity is unavailable.',
      'Operator audit history is unavailable.',
      'The private cohort roster is unavailable.',
      'Scan funnel totals are unavailable.',
      'Recent scan leads are unavailable.',
    ])
  })
})
