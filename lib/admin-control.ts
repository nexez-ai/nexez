import type { GrowthAdminAction } from './growth-control'
import type { MarketplaceCurationStatus } from './marketplace-curation'

export type AdminAuditSource = 'access' | 'growth' | 'marketplace' | 'release' | 'launch'
export type AdminAuditTone = 'ready' | 'attention' | 'blocked' | 'neutral'

export type AdminOperator = {
  userId: string
  email: string | null
  note: string | null
  createdAt: string
}

export type AdminAuditEvent = {
  id: string
  source: AdminAuditSource
  title: string
  detail: string
  actorId: string | null
  actorEmail: string | null
  createdAt: string
  tone: AdminAuditTone
  href: string
}

export type AdminGovernanceSnapshot = {
  available: boolean
  generatedAt: string
  operators: AdminOperator[]
  events: AdminAuditEvent[]
  warnings: string[]
}

// Cohort events share the governance audit feed with campaign controls.
const GROWTH_ACTION_LABELS: Record<GrowthAdminAction, string> = {
  pause: 'Growth campaign paused',
  resume: 'Growth campaign resumed',
  end: 'Growth campaign ended',
  set_capacity: 'Growth capacity updated',
  set_signup_close: 'Growth signup window updated',
  set_enrollment_mode: 'Growth enrollment mode updated',
  cohort_add: 'Cohort member invited',
  cohort_resend: 'Cohort invite resent',
  cohort_revoke: 'Cohort invite revoked',
  cohort_stage_batch: 'Cohort batch staged',
  cohort_release_wave: 'Cohort wave released',
}

const MARKETPLACE_STATUS_LABELS: Record<MarketplaceCurationStatus, string> = {
  unreviewed: 'Marketplace review cleared',
  candidate: 'Marketplace candidate recorded',
  certified: 'Marketplace listing certified',
  excluded: 'Marketplace listing excluded',
}

export function growthAdminActionLabel(action: GrowthAdminAction): string {
  return GROWTH_ACTION_LABELS[action]
}

export function marketplaceAuditLabel(status: MarketplaceCurationStatus): string {
  return MARKETPLACE_STATUS_LABELS[status]
}

export function marketplaceAuditTone(status: MarketplaceCurationStatus): AdminAuditTone {
  if (status === 'certified') return 'ready'
  if (status === 'excluded') return 'blocked'
  if (status === 'candidate') return 'attention'
  return 'neutral'
}

export function sortAdminAuditEvents(events: AdminAuditEvent[], limit = 100): AdminAuditEvent[] {
  return [...events]
    .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))
    .slice(0, Math.max(0, limit))
}

export function emptyAdminGovernanceSnapshot(available = false): AdminGovernanceSnapshot {
  return {
    available,
    generatedAt: new Date().toISOString(),
    operators: [],
    events: [],
    warnings: [],
  }
}
