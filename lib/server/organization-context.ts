import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import { z } from 'zod'

export const organizationSlugSchema = z.string().min(3).max(63).regex(/^[a-z0-9]+(-[a-z0-9]+)*$/)

const organizationRowSchema = z.object({
  org_id: z.uuid(),
  org_slug: organizationSlugSchema,
  org_name: z.string().min(1).max(120),
  membership_id: z.uuid(),
  member_role: z.enum(['owner', 'operator']),
})

const contextRowSchema = organizationRowSchema.extend({
  scan_access: z.enum(['paused', 'unconfigured', 'scheduled', 'expired', 'available']),
  scan_starts_at: z.iso.datetime({ offset: true }).nullable(),
  scan_expires_at: z.iso.datetime({ offset: true }).nullable(),
  max_targets_per_batch: z.number().int().min(1).max(50).nullable(),
  max_targets_per_day: z.number().int().min(1).max(250).nullable(),
  max_concurrent_targets: z.number().int().min(1).max(3).nullable(),
})

function organizationDto(row: z.infer<typeof organizationRowSchema>) {
  return {
    id: row.org_id,
    slug: row.org_slug,
    name: row.org_name,
    membershipId: row.membership_id,
    role: row.member_role,
  }
}

export class OrganizationWorkspaceUnavailable extends Error {
  constructor() {
    super('Workspaces are temporarily unavailable. Please try again.')
    this.name = 'OrganizationWorkspaceUnavailable'
  }
}

/** Only use the caller's session client. SQL derives the actor and rechecks
 * current membership in the same statement as the returned projection. No
 * service-role fallback, user metadata, merchant ownership, or shared cache.
 */
export async function listOrganizationWorkspaces(supabase: SupabaseClient, afterSlug: string | null = null) {
  if (afterSlug !== null && !organizationSlugSchema.safeParse(afterSlug).success) {
    throw new OrganizationWorkspaceUnavailable()
  }
  try {
    const { data, error } = await supabase.rpc('list_my_organizations', { p_after_slug: afterSlug })
      .abortSignal(AbortSignal.timeout(5_000))
    const rows = z.array(organizationRowSchema).max(51).safeParse(data)
    if (error || !rows.success) throw new OrganizationWorkspaceUnavailable()
    const page = rows.data.slice(0, 50)
    return {
      organizations: page.map(organizationDto),
      nextCursor: rows.data.length > 50 ? page[49].org_slug : null,
    }
  } catch {
    throw new OrganizationWorkspaceUnavailable()
  }
}

/** This context is for display only. Future scan commands must reauthorize and
 * reserve quota atomically inside the command, even after this read succeeds.
 */
export async function getOrganizationWorkspace(
  supabase: SupabaseClient,
  key: { id: string; slug?: never } | { slug: string; id?: never },
) {
  if (key.id !== undefined ? !z.uuid().safeParse(key.id).success : !organizationSlugSchema.safeParse(key.slug).success) {
    return null
  }
  const orgId = key.id?.toLowerCase() ?? null
  try {
    const { data, error } = await supabase.rpc('get_organization_context', {
      p_org_id: orgId,
      p_org_slug: key.slug ?? null,
    }).abortSignal(AbortSignal.timeout(5_000))
    const rows = z.array(contextRowSchema).max(1).safeParse(data)
    if (error || !rows.success) throw new OrganizationWorkspaceUnavailable()
    const row = rows.data[0]
    if (!row) return null
    if ((orgId && row.org_id !== orgId) || (key.slug && row.org_slug !== key.slug)) {
      throw new OrganizationWorkspaceUnavailable()
    }
    return {
      ...organizationDto(row),
      scanAccess: {
        state: row.scan_access,
        startsAt: row.scan_starts_at,
        expiresAt: row.scan_expires_at,
        maxTargetsPerBatch: row.max_targets_per_batch,
        maxTargetsPerDay: row.max_targets_per_day,
        maxConcurrentTargets: row.max_concurrent_targets,
      },
    }
  } catch {
    throw new OrganizationWorkspaceUnavailable()
  }
}
