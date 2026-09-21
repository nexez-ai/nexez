import 'server-only'
import { getDomain } from 'tldts'
import { evaluateCrawlability } from '@/lib/crawlability'
import { captureEvent } from '@/lib/observability'
import { createAdminClient } from '@/utils/supabase/admin'
import { buildScanResultRow, hashScanDomain } from './log-scan-result'
import { createScanNetworkContext, ScanNetworkError } from './scan-network'
import { scanRpc } from './organization-scans'
import { gatherSiteSignals, type SiteSignalsResult } from './site-scan'
import { RESEARCH_PROTOCOL_VERSION, type ResearchContentFailure } from './research-quality'

type ResearchTarget = {
  id: string
  cohort: string
  url: string
  domain_key: string
  vertical: string
  lease_token: string
}

/** Final registrable-domain deduplication also handles redirects and www aliases.
 * Private suffixes retain separate businesses on supported hosting platforms.
 */
export function researchDomain(hostname: string): string | null {
  return getDomain(hostname.toLowerCase(), { allowPrivateDomains: true })
}

export function buildResearchObservation(result: SiteSignalsResult, cohort: string, vertical: string) {
  if (result.signals.status < 200 || result.signals.status >= 300) return null
  if (result.researchQuality?.protocolVersion !== RESEARCH_PROTOCOL_VERSION || result.researchQuality.failure !== null) return null
  const domain = researchDomain(new URL(result.origin).hostname)
  if (!domain) return null
  const row = buildScanResultRow({
    origin: result.origin, elapsedMs: result.elapsedMs, signals: result.signals,
    report: evaluateCrawlability(result.signals), source: 'study', studyCohort: cohort, vertical,
  })
  if (!row) return null
  // Never persist fetched text or put raw domains into the aggregate table.
  const metrics = Object.fromEntries(Object.entries(row).filter(([key]) => key !== 'domain' && key !== 'domain_hash'))
  metrics.research_protocol_version = RESEARCH_PROTOCOL_VERSION
  return { metrics, domainHash: hashScanDomain(domain) }
}

async function scanResearchTarget(target: ResearchTarget) {
  const started = Date.now()
  const admin = createAdminClient()
  let network: ReturnType<typeof createScanNetworkContext> | undefined
  let observation: ReturnType<typeof buildResearchObservation> = null
  let failure: ScanNetworkError['code'] | ResearchContentFailure | null = null
  try {
    network = createScanNetworkContext(target.lease_token, null, admin, 'research')
    const result = await gatherSiteSignals(target.url, { ...network.options, researchProtocolVersion: RESEARCH_PROTOCOL_VERSION })
    network.assertFinished()
    if ('error' in result) failure = 'target_unavailable'
    else {
      observation = buildResearchObservation(result, target.cohort, target.vertical)
      if (!observation) failure = result.signals.status === 429 || result.signals.status >= 500 ? 'network_error'
        : result.signals.status >= 200 && result.signals.status < 300
          ? result.researchQuality?.failure ?? 'target_unavailable' : 'target_unavailable'
    }
  } catch (error) {
    failure = error instanceof ScanNetworkError ? error.code : 'network_error'
  } finally {
    await network?.close()
  }
  const accepted = await scanRpc(admin, 'finish_study_run_target', {
    p_cohort: target.cohort, p_target: target.id, p_lease: target.lease_token,
    p_metrics: observation?.metrics ?? null, p_domain_hash: observation?.domainHash ?? null,
    p_failure: observation ? null : failure ?? 'network_error',
    p_ms: Math.min(60_000, Date.now() - started),
    p_bytes: network?.metrics.bytesRead ?? 0, p_probes: network?.metrics.probeCount ?? 0,
  })
  return accepted === true
}

/** One charged, single-use dispatch. A killed invocation is recovered by leases.
 * Failures stay closed codes, never arbitrary website text or URLs in telemetry.
 */
export async function runResearchBatch(cohort: string, dispatchId: string) {
  const admin = createAdminClient()
  const status = await readResearchStatus(cohort) as { researchProtocolVersion?: number } | null
  if (status?.researchProtocolVersion !== RESEARCH_PROTOCOL_VERSION) throw new Error('Incompatible research protocol')
  const data = await scanRpc(admin, 'claim_study_run_batch', { p_cohort: cohort, p_dispatch: dispatchId })
  const targets = data as ResearchTarget[] | null
  if (!Array.isArray(targets) || targets.length > 6) throw new Error('Invalid research claim')
  // Replays and unknown dispatch IDs also return no targets. Never let such a
  // request mark another invocation's still-running dispatch as finished.
  if (targets.length === 0) return { ok: true, claimed: 0, persisted: 0, failures: 0 }
  let persisted = 0
  let failures = 0
  const queue = [...targets]
  await Promise.all(Array.from({ length: Math.min(3, queue.length) }, async () => {
    for (let target = queue.shift(); target; target = queue.shift()) {
      try { if (await scanResearchTarget(target)) persisted += 1 }
      catch { failures += 1 }
    }
  }))
  const { error } = await admin.from('study_run_dispatches')
    .update({ finished_at: new Date().toISOString(), outcome: failures ? 'persist_error' : 'finished' })
    .eq('id', dispatchId).eq('cohort', cohort).not('claimed_at', 'is', null)
    .abortSignal(AbortSignal.timeout(5_000))
  if (error) throw new Error('Could not finish research dispatch')
  captureEvent('study.research_batch', { cohort, claimed: targets.length, persisted, failures })
  return { ok: failures === 0, claimed: targets.length, persisted, failures }
}

export async function readResearchStatus(cohort: string) {
  return scanRpc(createAdminClient(), 'study_run_status', { p_cohort: cohort })
}
