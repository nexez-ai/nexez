import 'server-only'
import { z } from 'zod'
import { createAdminClient } from '@/utils/supabase/admin'
import { hashScanDomain } from './log-scan-result'
import { readResearchStatus, researchDomain } from './large-readiness-study'

const sampleSchema = z.array(z.object({
  final_domain_hash: z.string().regex(/^[a-f0-9]{64}$/),
  created_at: z.iso.datetime({ offset: true }),
  target: z.object({ domain_key: z.string().regex(/^[a-z0-9.-]{3,253}$/) }),
})).max(32)

/** Read-only, stopped-run evidence. No site requests, raw identity output or writes.
 * A non-match can be a redirect, so it is inconclusive rather than a salt failure.
 * Compare this sample with deployed configuration history before sealing identity.
 */
export async function readResearchIdentityAudit(cohort: string) {
  const status = await readResearchStatus(cohort)
  if (!status) return null
  if (![4, 5].includes(Number(status.researchProtocolVersion)) || !['pilot_review', 'paused', 'exhausted', 'completed'].includes(String(status.state))) {
    throw new Error('Identity review requires a stopped protocol-4 or protocol-5 run')
  }
  const admin = createAdminClient()
  const windows = await Promise.all([true, false].map(async ascending => {
    const { data, error } = await admin.from('study_run_results')
      // Revalidation adds a second relationship; audit the original result target.
      .select('final_domain_hash,created_at,target:study_run_targets!study_run_results_cohort_target_id_fkey!inner(domain_key)')
      .eq('cohort', cohort).order('created_at', { ascending }).order('target_id', { ascending })
      .limit(32).abortSignal(AbortSignal.timeout(5_000))
    if (error) throw new Error('Identity review unavailable')
    const rows = sampleSchema.parse(data)
    const matches = rows.filter(row => {
      const initialDomain = researchDomain(row.target.domain_key)
      return initialDomain !== null && hashScanDomain(initialDomain) === row.final_domain_hash
    }).length
    const times = rows.map(row => row.created_at).sort()
    return {
      edge: ascending ? 'earliest' : 'latest', sampled: rows.length,
      matchedInitialDomains: matches, inconclusive: rows.length - matches,
      from: times[0] ?? null, to: times.at(-1) ?? null,
    }
  }))
  return { cohort, protocol: status.researchProtocolVersion, runtimeHashIdentityFingerprint: status.runtimeHashIdentityFingerprint, windows }
}
