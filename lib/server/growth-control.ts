import 'server-only'
import { isEntitlementAllocationRetry } from '../entitlement-allocation-error'

import type { SupabaseClient } from '@supabase/supabase-js'
import {
  EMPTY_GROWTH_METRICS,
  EMPTY_SCAN_FUNNEL_METRICS,
  emptyGrowthControlSnapshot,
  summarizeGrowthControl,
  type GrowthCampaignStatus,
  type GrowthAdminAction,
  type GrowthCohortMember,
  type GrowthCohortRolloutState,
  type GrowthCohortStatus,
  type GrowthCohortVerificationStatus,
  type GrowthControlAction,
  type GrowthControlAdminEvent,
  type GrowthControlCampaign,
  type GrowthControlEvent,
  type GrowthControlMetrics,
  type GrowthControlSnapshot,
  type GrowthScanFunnelMetrics,
  type GrowthScanLead,
} from '../growth-control'
import { createAdminClient, hasSupabaseAdminEnv } from '../../utils/supabase/admin'

type AdminClient = Pick<SupabaseClient, 'from' | 'rpc'>

type CampaignRow = {
  id: string
  campaign_key: string
  name: string
  status: GrowthCampaignStatus
  grant_plan_id: string
  grant_duration_days: number
  invite_slots: number
  invite_expires_days: number
  max_grants: number
  starts_at: string
  signup_closes_at: string | null
  enrollment_mode: GrowthControlCampaign['enrollmentMode']
  updated_at: string
}

type GrowthEventRow = {
  id: number | string
  event_type: string
  metadata: Record<string, unknown> | null
  created_at: string
}

type AdminEventRow = {
  id: number | string
  action: GrowthAdminAction
  reason: string
  before_state: Record<string, unknown>
  after_state: Record<string, unknown>
  created_at: string
}

type CohortRow = {
  id: string
  invitee_email: string
  cohort_label: string | null
  status: GrowthCohortStatus
  expires_at: string
  accepted_at: string | null
  qualified_at: string | null
  delivery_count: number
  last_sent_at: string | null
  cohort_wave: number | null
  email_verification_status: GrowthCohortVerificationStatus
  email_verification_provider: string | null
  email_verified_at: string | null
  rollout_state: GrowthCohortRolloutState
  rollout_attempts: number
  rollout_last_error: string | null
  rollout_released_at: string | null
  created_at: string
}

type MetricsRpc = Record<string, unknown>

type ScanLeadRow = {
  id: string
  email: string
  domain: string
  score: number | null
  delivery_attempts: number
  delivered_at: string | null
  onboarding_opened_at: string | null
  converted_at: string | null
  published_at: string | null
  grant_activated_at: string | null
  last_error: string | null
  created_at: string
}

export type ApplyGrowthControlInput = {
  campaignId: string
  actorId: string
  action: GrowthControlAction
  reason: string
  idempotencyKey: string
  maxGrants?: number | null
  signupClosesAt?: string | null
  enrollmentMode?: GrowthControlCampaign['enrollmentMode'] | null
}

export class GrowthControlError extends Error {
  constructor(
    message: string,
    public code: 'not_configured' | 'not_found' | 'invalid' | 'conflict' | 'database',
  ) {
    super(message)
    this.name = 'GrowthControlError'
  }
}

function campaignView(row: CampaignRow): GrowthControlCampaign {
  return {
    id: row.id,
    key: row.campaign_key,
    name: row.name,
    status: row.status,
    grantPlanId: row.grant_plan_id,
    grantDurationDays: row.grant_duration_days,
    inviteSlots: row.invite_slots,
    inviteExpiresDays: row.invite_expires_days,
    maxGrants: row.max_grants,
    startsAt: row.starts_at,
    signupClosesAt: row.signup_closes_at,
    enrollmentMode: row.enrollment_mode,
    updatedAt: row.updated_at,
  }
}

function count(value: unknown): number {
  const parsed = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(parsed) ? Math.max(0, Math.trunc(parsed)) : 0
}

function stringOrNull(value: unknown): string | null {
  return typeof value === 'string' && value ? value : null
}

function normalizeMetrics(
  value: MetricsRpc | null | undefined,
  rolloutValue?: MetricsRpc | null,
): GrowthControlMetrics {
  const row = value ?? {}
  const rollout = rolloutValue ?? {}
  return {
    grantsTotal: count(row.grants_total),
    grantsActive: count(row.grants_active),
    grantsExpired: count(row.grants_expired),
    grantsRevoked: count(row.grants_revoked),
    grantsSuperseded: count(row.grants_superseded),
    welcomeGrants: count(row.welcome_grants),
    referralGrants: count(row.referral_grants),
    grantsWithFallback: count(row.grants_with_fallback),
    grantsIssued30d: count(row.grants_issued_30d),
    paidConversions: count(row.paid_conversions),
    invitesTotal: count(row.invites_total),
    invitesPending: count(row.invites_pending),
    invitesClaimed: count(row.invites_claimed),
    invitesQualified: count(row.invites_qualified),
    invitesExpired: count(row.invites_expired),
    invitesRevoked: count(row.invites_revoked),
    invitesDelivered: count(row.invites_delivered),
    invitesUndelivered: count(row.invites_undelivered),
    invitesCreated30d: count(row.invites_created_30d),
    cohortTotal: count(row.cohort_total),
    cohortPending: count(row.cohort_pending),
    cohortClaimed: count(row.cohort_claimed),
    cohortQualified: count(row.cohort_qualified),
    cohortExpired: count(row.cohort_expired),
    cohortRevoked: count(row.cohort_revoked),
    cohortDelivered: count(row.cohort_delivered),
    cohortUndelivered: count(row.cohort_undelivered),
    cohortStaged: count(rollout.staged),
    cohortReady: count(rollout.ready),
    cohortReleasing: count(rollout.releasing),
    cohortDeliveryFailed: count(rollout.delivery_failed),
    cohortSuppressed: count(rollout.suppressed),
    cohortVerifiedValid: count(rollout.verified_valid),
    cohortVerifiedRisky: count(rollout.verified_risky),
    cohortVerifiedInvalid: count(rollout.verified_invalid),
    cohortVerifiedUnknown: count(rollout.verified_unknown),
    fallbackApplied: count(row.fallback_applied),
    grantExpiredEvents: count(row.grant_expired_events),
    noticesSent: count(row.notices_sent),
    latestEventAt: stringOrNull(row.latest_event_at),
  }
}

function normalizeScanMetrics(value: MetricsRpc | null | undefined): GrowthScanFunnelMetrics {
  const row = value ?? {}
  return {
    captured: count(row.captured),
    delivered: count(row.delivered),
    onboardingOpened: count(row.onboarding_opened),
    accountsCreated: count(row.accounts_created),
    published: count(row.published),
    launchActivated: count(row.launch_activated),
    pendingDelivery: count(row.pending_delivery),
    stalePending: count(row.stale_pending),
    staleClaims: count(row.stale_claims),
    abandoned: count(row.abandoned),
    abandoned24h: count(row.abandoned_24h),
    suppressed: count(row.suppressed),
  }
}

function mapScanLead(row: ScanLeadRow): GrowthScanLead {
  const stage: GrowthScanLead['stage'] = row.grant_activated_at
    ? 'launch'
    : row.published_at
      ? 'published'
      : row.converted_at
        ? 'account'
        : row.onboarding_opened_at
          ? 'onboarding'
          : row.delivered_at
            ? 'delivered'
            : 'captured'
  return {
    id: row.id,
    email: row.email,
    domain: row.domain,
    score: row.score,
    stage,
    deliveryAttempts: count(row.delivery_attempts),
    lastError: row.last_error,
    createdAt: row.created_at,
  }
}

function mapCohortMember(row: CohortRow): GrowthCohortMember {
  return {
    id: row.id,
    email: row.invitee_email,
    label: row.cohort_label,
    status: row.status,
    expiresAt: row.expires_at,
    acceptedAt: row.accepted_at,
    qualifiedAt: row.qualified_at,
    deliveryCount: count(row.delivery_count),
    lastSentAt: row.last_sent_at,
    wave: row.cohort_wave,
    verificationStatus: row.email_verification_status,
    verificationProvider: row.email_verification_provider,
    verifiedAt: row.email_verified_at,
    rolloutState: row.rollout_state,
    rolloutAttempts: count(row.rollout_attempts),
    rolloutLastError: row.rollout_last_error,
    releasedAt: row.rollout_released_at,
    createdAt: row.created_at,
  }
}

function eventDetail(row: GrowthEventRow): string {
  const metadata = row.metadata ?? {}
  switch (row.event_type) {
    case 'grant_issued': {
      const source = metadata.source === 'referral' ? 'Referral activation' : 'Direct activation'
      const days = count(metadata.duration_days)
      return days ? `${source}, ${days} days` : source
    }
    case 'invite_created':
      return metadata.emailed === true ? 'Invitation email delivered' : 'Secure claim link created'
    case 'invite_resent':
      return metadata.emailed === true ? 'Fresh invitation email delivered' : 'Secure claim link renewed'
    case 'invite_claimed':
      return 'Recipient authenticated with the invited email'
    case 'invite_qualified':
      return 'Invited business completed activation checks'
    case 'invite_revoked':
      return 'Sender revoked the unused pass'
    case 'invite_expired':
      return 'Invitation expired before activation'
    case 'grant_expired':
      return 'Complimentary access reached its fixed end date'
    case 'grant_revoked':
      return 'Complimentary access was revoked'
    case 'fallback_applied':
      return 'Account returned to Free with one published listing'
    default:
      return 'Campaign lifecycle event'
  }
}

function eventLabel(type: string): string {
  const labels: Record<string, string> = {
    grant_issued: 'Launch activated',
    invite_created: 'Pass created',
    invite_resent: 'Pass renewed',
    invite_claimed: 'Pass claimed',
    invite_qualified: 'Referral activated',
    invite_revoked: 'Pass revoked',
    invite_expired: 'Pass expired',
    grant_expired: 'Launch access ended',
    grant_revoked: 'Launch access revoked',
    fallback_applied: 'Free fallback applied',
  }
  return labels[type] ?? 'Campaign event'
}

function mapEvent(row: GrowthEventRow): GrowthControlEvent {
  return {
    id: String(row.id),
    type: row.event_type,
    label: eventLabel(row.event_type),
    detail: eventDetail(row),
    createdAt: row.created_at,
  }
}

function statusFromState(value: unknown): GrowthCampaignStatus | null {
  if (value === 'draft' || value === 'active' || value === 'paused' || value === 'ended') {
    return value
  }
  return null
}

function mapAdminEvent(row: AdminEventRow): GrowthControlAdminEvent {
  return {
    id: String(row.id),
    action: row.action,
    reason: row.reason,
    beforeStatus: statusFromState(row.before_state?.status),
    afterStatus: statusFromState(row.after_state?.status),
    createdAt: row.created_at,
  }
}

export async function getGrowthControlSnapshot(
  client?: AdminClient,
): Promise<GrowthControlSnapshot> {
  const empty = emptyGrowthControlSnapshot(false)
  if (!client && !hasSupabaseAdminEnv()) {
    return {
      ...empty,
      warnings: ['Server credentials are unavailable, so campaign telemetry could not be loaded.'],
    }
  }

  const admin = client ?? createAdminClient()
  const { data: campaignRow, error: campaignError } = await admin
    .from('seller_growth_campaigns')
    .select('id, campaign_key, name, status, grant_plan_id, grant_duration_days, invite_slots, invite_expires_days, max_grants, starts_at, signup_closes_at, enrollment_mode, updated_at')
    .eq('is_public_launch', true)
    .order('starts_at', { ascending: false })
    .order('id', { ascending: true })
    .limit(1)
    .maybeSingle<CampaignRow>()

  if (campaignError) {
    return {
      ...empty,
      warnings: ['The campaign ledger could not be read. Confirm the Growth Control migration.'],
    }
  }
  if (!campaignRow) return { ...emptyGrowthControlSnapshot(true), generatedAt: new Date().toISOString() }

  const [metricsResult, rolloutMetricsResult, eventsResult, adminEventsResult, cohortResult, scanMetricsResult, scanLeadsResult] = await Promise.all([
    admin.rpc('seller_growth_control_snapshot', { p_campaign_id: campaignRow.id }),
    admin.rpc('seller_growth_cohort_rollout_snapshot', { p_campaign_id: campaignRow.id }),
    admin
      .from('seller_growth_events')
      .select('id, event_type, metadata, created_at')
      .eq('campaign_id', campaignRow.id)
      .order('created_at', { ascending: false })
      .limit(24)
      .returns<GrowthEventRow[]>(),
    admin
      .from('seller_growth_campaign_admin_events')
      .select('id, action, reason, before_state, after_state, created_at')
      .eq('campaign_id', campaignRow.id)
      .order('created_at', { ascending: false })
      .limit(12)
      .returns<AdminEventRow[]>(),
    admin
      .from('seller_growth_invites')
      .select('id, invitee_email, cohort_label, status, expires_at, accepted_at, qualified_at, delivery_count, last_sent_at, cohort_wave, email_verification_status, email_verification_provider, email_verified_at, rollout_state, rollout_attempts, rollout_last_error, rollout_released_at, created_at')
      .eq('campaign_id', campaignRow.id)
      .eq('invite_kind', 'cohort')
      .order('created_at', { ascending: false })
      .limit(100)
      .returns<CohortRow[]>(),
    admin.rpc('scan_growth_funnel_snapshot', {}),
    admin
      .from('scan_leads')
      .select('id, email, domain, score, delivery_attempts, delivered_at, onboarding_opened_at, converted_at, published_at, grant_activated_at, last_error, created_at')
      .order('created_at', { ascending: false })
      .limit(100)
      .returns<ScanLeadRow[]>(),
  ])

  const warnings: string[] = []
  if (metricsResult.error) warnings.push('Campaign totals are unavailable.')
  if (rolloutMetricsResult.error) warnings.push('Cohort rollout totals are unavailable.')
  if (eventsResult.error) warnings.push('Recent campaign activity is unavailable.')
  if (adminEventsResult.error) warnings.push('Operator audit history is unavailable.')
  if (cohortResult.error) warnings.push('The private cohort roster is unavailable.')
  if (scanMetricsResult.error) warnings.push('Scan funnel totals are unavailable.')
  if (scanLeadsResult.error) warnings.push('Recent scan leads are unavailable.')

  const campaign = campaignView(campaignRow)
  const metrics = metricsResult.error
    ? { ...EMPTY_GROWTH_METRICS }
    : normalizeMetrics(
      metricsResult.data as MetricsRpc | null,
      rolloutMetricsResult.error ? null : rolloutMetricsResult.data as MetricsRpc | null,
    )
  const scanMetrics = scanMetricsResult.error
    ? { ...EMPTY_SCAN_FUNNEL_METRICS }
    : normalizeScanMetrics(scanMetricsResult.data as MetricsRpc | null)
  if (scanMetrics.stalePending > 0) {
    warnings.push(`${scanMetrics.stalePending} scan result email${scanMetrics.stalePending === 1 ? ' is' : 's are'} pending for more than two hours.`)
  }
  if (scanMetrics.staleClaims > 0) {
    warnings.push(`${scanMetrics.staleClaims} scan delivery claim${scanMetrics.staleClaims === 1 ? ' is' : 's are'} stale and should be reclaimed by the next cron run.`)
  }
  if (scanMetrics.abandoned24h > 0) {
    warnings.push(`${scanMetrics.abandoned24h} scan result deliver${scanMetrics.abandoned24h === 1 ? 'y was' : 'ies were'} abandoned in the last 24 hours.`)
  }

  return {
    available: !metricsResult.error,
    generatedAt: new Date().toISOString(),
    campaign,
    metrics,
    summary: summarizeGrowthControl(campaign, metrics),
    recentEvents: (eventsResult.data ?? []).map(mapEvent),
    adminEvents: (adminEventsResult.data ?? []).map(mapAdminEvent),
    cohortMembers: (cohortResult.data ?? []).map(mapCohortMember),
    scanFunnel: {
      metrics: scanMetrics,
      recentLeads: (scanLeadsResult.data ?? []).map(mapScanLead),
    },
    warnings,
  }
}

export async function applyGrowthCampaignControl(
  input: ApplyGrowthControlInput,
): Promise<GrowthControlSnapshot> {
  if (!hasSupabaseAdminEnv()) {
    throw new GrowthControlError('Growth Control is unavailable on this deployment.', 'not_configured')
  }

  const admin = createAdminClient()
  const { error } = await admin.rpc('apply_seller_growth_campaign_control', {
    p_campaign_id: input.campaignId,
    p_actor_id: input.actorId,
    p_action: input.action,
    p_reason: input.reason,
    p_idempotency_key: input.idempotencyKey,
    p_max_grants: input.maxGrants ?? null,
    p_signup_closes_at: input.signupClosesAt ?? null,
    p_enrollment_mode: input.enrollmentMode ?? null,
  })

  if (error) {
    const message = error.message || 'The campaign control could not be applied.'
    const code = error.code === 'P0002'
      ? 'not_found'
      : isEntitlementAllocationRetry(error) || error.code === '23514' || error.code === '23505'
        ? 'conflict'
        : error.code === '22023'
          ? 'invalid'
          : 'database'
    throw new GrowthControlError(message, code)
  }

  return getGrowthControlSnapshot(admin)
}
