import 'server-only'

import type { GrowthAdminAction } from '../growth-control'
import type { MarketplaceCurationStatus } from '../marketplace-curation'
import {
  emptyAdminGovernanceSnapshot,
  growthAdminActionLabel,
  marketplaceAuditLabel,
  marketplaceAuditTone,
  sortAdminAuditEvents,
  type AdminAuditEvent,
  type AdminGovernanceSnapshot,
} from '../admin-control'
import { createAdminClient, hasSupabaseAdminEnv } from '../../utils/supabase/admin'

type PlatformAdminRow = {
  user_id: string
  note: string | null
  created_at: string
}

type PlatformAdminGrantRow = {
  id: string
  actor_id: string | null
  target_user_id: string | null
  target_email: string
  note: string | null
  created_at: string
}

type GrowthAdminRow = {
  id: number | string
  action: GrowthAdminAction
  reason: string
  actor_id: string | null
  created_at: string
}

type MarketplaceAdminRow = {
  id: number | string
  page_id: string
  from_status: MarketplaceCurationStatus | null
  to_status: MarketplaceCurationStatus
  reason: string | null
  actor_id: string | null
  created_at: string
}

type PageNameRow = {
  id: string
  name: string
}

type ReleaseRow = {
  id: string
  status: 'passed' | 'failed'
  commit_sha: string
  launch_score: number
  required_failed_count: number
  triggered_by: string | null
  completed_at: string
}

type LaunchDecisionRow = {
  id: number | string
  decision: 'go' | 'hold'
  reason: string
  operator_id: string | null
  operator_email: string
  production_revision: string | null
  launch_score: number
  required_blocker_count: number
  created_at: string
}

const MAX_EVENTS_PER_SOURCE = 50
const MAX_ACTOR_LOOKUPS = 40

export async function getAdminGovernanceSnapshot(
  client?: ReturnType<typeof createAdminClient>,
): Promise<AdminGovernanceSnapshot> {
  const empty = emptyAdminGovernanceSnapshot(false)
  if (!client && !hasSupabaseAdminEnv()) {
    return {
      ...empty,
      warnings: ['Server credentials are unavailable, so admin access and audit evidence could not be loaded.'],
    }
  }

  const admin = client ?? createAdminClient()
  const [operatorsResult, accessResult, growthResult, marketplaceResult, releasesResult, decisionsResult] = await Promise.all([
    admin
      .from('platform_admins')
      .select('user_id, note, created_at')
      .order('created_at', { ascending: true })
      .returns<PlatformAdminRow[]>(),
    admin
      .from('platform_admin_grant_events')
      .select('id, actor_id, target_user_id, target_email, note, created_at')
      .order('created_at', { ascending: false })
      .limit(MAX_EVENTS_PER_SOURCE)
      .returns<PlatformAdminGrantRow[]>(),
    admin
      .from('seller_growth_campaign_admin_events')
      .select('id, action, reason, actor_id, created_at')
      .order('created_at', { ascending: false })
      .limit(MAX_EVENTS_PER_SOURCE)
      .returns<GrowthAdminRow[]>(),
    admin
      .from('marketplace_curation_events')
      .select('id, page_id, from_status, to_status, reason, actor_id, created_at')
      .order('created_at', { ascending: false })
      .limit(MAX_EVENTS_PER_SOURCE)
      .returns<MarketplaceAdminRow[]>(),
    admin
      .from('release_certifications')
      .select('id, status, commit_sha, launch_score, required_failed_count, triggered_by, completed_at')
      .order('completed_at', { ascending: false })
      .limit(25)
      .returns<ReleaseRow[]>(),
    admin
      .from('launch_decisions')
      .select('id, decision, reason, operator_id, operator_email, production_revision, launch_score, required_blocker_count, created_at')
      .order('created_at', { ascending: false })
      .limit(25)
      .returns<LaunchDecisionRow[]>(),
  ])

  const warnings: string[] = []
  if (operatorsResult.error) warnings.push('Platform-admin membership is unavailable.')
  if (accessResult.error) warnings.push('Platform-admin grant history is unavailable.')
  if (growthResult.error) warnings.push('Growth operator history is unavailable.')
  if (marketplaceResult.error) warnings.push('Marketplace operator history is unavailable.')
  if (releasesResult.error) warnings.push('Release certification history is unavailable.')
  if (decisionsResult.error) warnings.push('Launch decision history is unavailable.')

  const operatorRows = operatorsResult.data ?? []
  const accessRows = accessResult.data ?? []
  const growthRows = growthResult.data ?? []
  const marketplaceRows = marketplaceResult.data ?? []
  const releaseRows = releasesResult.data ?? []
  const decisionRows = decisionsResult.data ?? []
  const pageIds = [...new Set(marketplaceRows.map((row) => row.page_id))]
  const pageResult = pageIds.length
    ? await admin.from('pages_public').select('id, name').in('id', pageIds).returns<PageNameRow[]>()
    : { data: [] as PageNameRow[], error: null }
  if (pageResult.error) warnings.push('Marketplace listing names are unavailable in the audit trail.')
  const pageNames = new Map((pageResult.data ?? []).map((row) => [row.id, row.name]))

  const actorIds = [...new Set([
    ...operatorRows.map((row) => row.user_id),
    ...accessRows.flatMap((row) => [row.actor_id, row.target_user_id]),
    ...growthRows.map((row) => row.actor_id),
    ...marketplaceRows.map((row) => row.actor_id),
    ...decisionRows.map((row) => row.operator_id),
  ].filter((value): value is string => Boolean(value)))].slice(0, MAX_ACTOR_LOOKUPS)

  const actorEntries = await Promise.all(actorIds.map(async (userId) => {
    const { data, error } = await admin.auth.admin.getUserById(userId)
    return [userId, error ? null : data.user?.email ?? null] as const
  }))
  const actorEmails = new Map(actorEntries)

  const events: AdminAuditEvent[] = [
    ...accessRows.map((row): AdminAuditEvent => ({
      id: `access:${row.id}`,
      source: 'access',
      title: 'Platform-admin access granted',
      detail: `Access granted to ${row.target_email}${row.note ? ` · ${row.note}` : ''}`,
      actorId: row.actor_id,
      actorEmail: row.actor_id ? actorEmails.get(row.actor_id) ?? null : null,
      createdAt: row.created_at,
      tone: 'ready',
      href: '/admin/audit',
    })),
    ...growthRows.map((row): AdminAuditEvent => ({
      id: `growth:${row.id}`,
      source: 'growth',
      title: growthAdminActionLabel(row.action),
      detail: row.reason,
      actorId: row.actor_id,
      actorEmail: row.actor_id ? actorEmails.get(row.actor_id) ?? null : null,
      createdAt: row.created_at,
      tone: row.action === 'end' ? 'blocked' : row.action === 'pause' ? 'attention' : 'neutral',
      href: '/admin/growth',
    })),
    ...marketplaceRows.map((row): AdminAuditEvent => {
      const listing = pageNames.get(row.page_id) ?? `Listing ${row.page_id.slice(0, 8)}`
      const transition = row.from_status ? `${row.from_status} → ${row.to_status}` : row.to_status
      return {
        id: `marketplace:${row.id}`,
        source: 'marketplace',
        title: marketplaceAuditLabel(row.to_status),
        detail: `${listing} · ${transition}${row.reason ? ` · ${row.reason}` : ''}`,
        actorId: row.actor_id,
        actorEmail: row.actor_id ? actorEmails.get(row.actor_id) ?? null : null,
        createdAt: row.created_at,
        tone: marketplaceAuditTone(row.to_status),
        href: '/admin/launch#marketplace-curation',
      }
    }),
    ...releaseRows.map((row): AdminAuditEvent => ({
      id: `release:${row.id}`,
      source: 'release',
      title: row.status === 'passed' ? 'Release certified' : 'Release certification failed',
      detail: `${row.commit_sha.slice(0, 12)} · Launch Control ${Number(row.launch_score)}% · ${Number(row.required_failed_count)} required failures`,
      actorId: null,
      actorEmail: row.triggered_by,
      createdAt: row.completed_at,
      tone: row.status === 'passed' ? 'ready' : 'blocked',
      href: '/admin/launch#release-certificates-heading',
    })),
    ...decisionRows.map((row): AdminAuditEvent => ({
      id: `launch:${row.id}`,
      source: 'launch',
      title: row.decision === 'go' ? 'Launch go recorded' : 'Launch hold recorded',
      detail: `${row.production_revision?.slice(0, 12) ?? 'Revision unavailable'} · Launch Control ${Number(row.launch_score)}% · ${Number(row.required_blocker_count)} required blockers · ${row.reason}`,
      actorId: row.operator_id,
      actorEmail: row.operator_email,
      createdAt: row.created_at,
      tone: row.decision === 'go' ? 'ready' : 'attention',
      href: '/admin/launch#launch-decision-heading',
    })),
  ]

  return {
    available: !operatorsResult.error,
    generatedAt: new Date().toISOString(),
    operators: operatorRows.map((row) => ({
      userId: row.user_id,
      email: actorEmails.get(row.user_id) ?? null,
      note: row.note,
      createdAt: row.created_at,
    })),
    events: sortAdminAuditEvents(events),
    warnings,
  }
}

export async function grantPlatformAdminAccess(input: {
  actorId: string
  email: string
  note: string | null
}, client?: ReturnType<typeof createAdminClient>): Promise<string> {
  const admin = client ?? createAdminClient()
  const { data, error } = await admin.rpc('grant_platform_admin_by_email', {
    p_actor_id: input.actorId,
    p_email: input.email,
    p_note: input.note,
  })

  if (error) {
    if (error.code === 'P0002') throw new Error('No Nexez account was found for that email.')
    if (error.code === '22023' && /already has/i.test(error.message)) {
      throw new Error('That account already has platform-admin access.')
    }
    throw new Error(`Could not grant platform-admin access: ${error.message}`)
  }
  if (typeof data !== 'string' || !data) {
    throw new Error('The access grant completed without returning an account ID.')
  }
  return data
}
