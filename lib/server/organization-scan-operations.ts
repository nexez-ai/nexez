import 'server-only'
import { z } from 'zod'
import { createAdminClient, hasSupabaseAdminEnv } from '@/utils/supabase/admin'
import { buildOrganizationScanOperationChecks } from '@/lib/organization-scan-operations'
import { hasOrganizationScanRunner } from './organization-scan-worker'
import { scanRpc } from './organization-scans'

function commitSha(): string | null {
  const value = process.env.VERCEL_GIT_COMMIT_SHA ?? ''
  return value.length === 40 && /^[a-f0-9]{40}$/.test(value) ? value : null
}

export async function runOrganizationScanMaintenance(): Promise<number> {
  const data = await scanRpc(createAdminClient(), 'cleanup_organization_scans')
  const count = z.number().int().min(0).max(100).safeParse(data)
  if (!count.success) throw new Error('Invalid scan cleanup response')
  return count.data
}

/** Only a completion marker leaves the durable step, never scan input or raw errors. */
export async function recordOrganizationScanRecovery(): Promise<boolean> {
  const data = await scanRpc(createAdminClient(), 'record_organization_scan_recovery', { p_commit_sha: commitSha() })
  if (data !== true) throw new Error('Scan recovery completion was not recorded')
  return true
}

export async function getOrganizationScanOperationChecks() {
  let data: unknown = null
  if (hasSupabaseAdminEnv()) {
    try { data = await scanRpc(createAdminClient(), 'get_organization_scan_operations') }
    catch { /* Missing schema or database access must never produce a ready check. */ }
  }
  return buildOrganizationScanOperationChecks(data, { runnerConfigured: hasOrganizationScanRunner(), commitSha: commitSha() })
}
