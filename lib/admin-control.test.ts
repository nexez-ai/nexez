import { describe, expect, it } from 'vitest'
import { GROWTH_COHORT_ACTIONS, GROWTH_CONTROL_ACTIONS } from './growth-control'
import {
  growthAdminActionLabel,
  marketplaceAuditLabel,
  marketplaceAuditTone,
  sortAdminAuditEvents,
  type AdminAuditEvent,
} from './admin-control'

describe('admin control presentation helpers', () => {
  it('maps every mutating control action to operator-facing copy', () => {
    expect(growthAdminActionLabel('pause')).toBe('Growth campaign paused')
    expect(growthAdminActionLabel('resume')).toBe('Growth campaign resumed')
    expect(growthAdminActionLabel('end')).toBe('Growth campaign ended')
    expect(growthAdminActionLabel('set_capacity')).toBe('Growth capacity updated')
    expect(growthAdminActionLabel('set_signup_close')).toBe('Growth signup window updated')
    expect(growthAdminActionLabel('set_enrollment_mode')).toBe('Growth enrollment mode updated')
  })

  it('labels every cohort action in the shared governance audit feed', () => {
    expect(growthAdminActionLabel('cohort_add')).toBe('Cohort member invited')
    expect(growthAdminActionLabel('cohort_resend')).toBe('Cohort invite resent')
    expect(growthAdminActionLabel('cohort_revoke')).toBe('Cohort invite revoked')
    expect(growthAdminActionLabel('cohort_stage_batch')).toBe('Cohort batch staged')
    expect(growthAdminActionLabel('cohort_release_wave')).toBe('Cohort wave released')
    for (const action of [...GROWTH_CONTROL_ACTIONS, ...GROWTH_COHORT_ACTIONS]) {
      expect(growthAdminActionLabel(action)).toBeTruthy()
    }
  })

  it('labels and classifies marketplace decisions', () => {
    expect(marketplaceAuditLabel('certified')).toBe('Marketplace listing certified')
    expect(marketplaceAuditTone('certified')).toBe('ready')
    expect(marketplaceAuditTone('candidate')).toBe('attention')
    expect(marketplaceAuditTone('excluded')).toBe('blocked')
    expect(marketplaceAuditTone('unreviewed')).toBe('neutral')
  })

  it('sorts cross-domain audit evidence newest first and enforces its limit', () => {
    const events: AdminAuditEvent[] = [
      event('old', '2026-08-12T00:00:00.000Z'),
      event('new', '2026-08-14T00:00:00.000Z'),
      event('middle', '2026-08-13T00:00:00.000Z'),
    ]

    expect(sortAdminAuditEvents(events, 2).map((item) => item.id)).toEqual(['new', 'middle'])
    expect(events.map((item) => item.id)).toEqual(['old', 'new', 'middle'])
  })
})

function event(id: string, createdAt: string): AdminAuditEvent {
  return {
    id,
    source: 'release',
    title: id,
    detail: id,
    actorId: null,
    actorEmail: null,
    createdAt,
    tone: 'neutral',
    href: '/admin/launch',
  }
}
