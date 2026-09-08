import { z } from 'zod'
import type { LaunchCheck } from './launch-control'

const timestamp = z.iso.datetime({ offset: true })
const operationsSchema = z.object({
  checked_at: timestamp,
  scan_submission_enabled: z.boolean(),
  cleanup_completed_at: timestamp.nullable(),
  recovery_completed_at: timestamp.nullable(),
  recovery_commit_sha: z.string().length(40).regex(/^[a-f0-9]{40}$/).nullable(),
  expired_batches_overdue: z.boolean(),
}).strict()

type RunnerConfiguration = { runnerConfigured: boolean; commitSha: string | null }

/** Timestamps come from one database snapshot, so app clock drift cannot hide a stale run. */
export function buildOrganizationScanOperationChecks(raw: unknown, configuration: RunnerConfiguration): LaunchCheck[] {
  const cleanup: LaunchCheck = {
    id: 'scanner-cleanup', label: 'Scanner cleanup', required: true, status: 'unknown',
    detail: 'Cleanup must complete within 15 minutes, including while the pilot is disabled.',
    evidence: 'Scanner operations could not be read.',
    action: 'Verify the operations migration and the five-minute scanner maintenance cron.',
  }
  const recovery: LaunchCheck = {
    id: 'organization-scan-recovery', label: 'Organization scan recovery', required: true, status: 'unknown',
    detail: 'Recovery must complete on this deployment within five minutes before pilot submissions are enabled.',
    evidence: 'Scanner controls and recovery evidence could not be read.',
    action: 'Verify the Inngest app sync and organization-scan-recovery runs on the app host.',
  }
  const parsed = operationsSchema.safeParse(raw)
  if (!parsed.success) return [cleanup, recovery]
  const state = parsed.data
  const now = Date.parse(state.checked_at)
  const fresh = (value: string | null, minutes: number) => {
    if (!value) return false
    const age = now - Date.parse(value)
    return age >= 0 && age <= minutes * 60_000
  }

  cleanup.status = fresh(state.cleanup_completed_at, 15) && !state.expired_batches_overdue ? 'ready' : 'blocked'
  cleanup.evidence = state.expired_batches_overdue
    ? 'At least one expired batch is more than 15 minutes overdue for deletion.'
    : state.cleanup_completed_at
      ? `Last completed cleanup: ${state.cleanup_completed_at}. Database time: ${state.checked_at}.`
      : 'No successful cleanup has been recorded.'

  recovery.required = state.scan_submission_enabled
  const currentCommit = configuration.commitSha?.length === 40 && /^[a-f0-9]{40}$/.test(configuration.commitSha)
    && configuration.commitSha === state.recovery_commit_sha
  const recovered = configuration.runnerConfigured && currentCommit && fresh(state.recovery_completed_at, 5)
  recovery.status = recovered ? 'ready' : recovery.required ? 'blocked' : 'attention'
  const evidence = !configuration.runnerConfigured ? 'The event, signing or database configuration is unavailable.'
    : !currentCommit ? 'No successful recovery from this deployment has been recorded.'
      : `Last completed recovery: ${state.recovery_completed_at ?? 'never'}. Database time: ${state.checked_at}.`
  recovery.evidence = `${evidence} Pilot submissions are ${state.scan_submission_enabled ? 'enabled' : 'disabled'}.`
  return [cleanup, recovery]
}
