import { describe, expect, it } from 'vitest'
import { buildOrganizationScanOperationChecks } from './organization-scan-operations'
import { summarizeLaunchChecks } from './launch-control'

const commit = 'a'.repeat(40)
const configuration = { runnerConfigured: true, commitSha: commit }
const state = {
  checked_at: '2026-09-08T12:00:00+00:00', scan_submission_enabled: false,
  cleanup_completed_at: '2026-09-08T11:59:00+00:00',
  recovery_completed_at: '2026-09-08T11:59:00+00:00', recovery_commit_sha: commit,
  expired_batches_overdue: false,
}

describe('scanner operations evidence', () => {
  it('uses database time and a completed run from the current deployment', () => {
    const checks = buildOrganizationScanOperationChecks(state, configuration)
    expect(checks.map(({ status }) => status)).toEqual(['ready', 'ready'])
    expect(checks.map(({ required }) => required)).toEqual([true, false])
    expect(summarizeLaunchChecks(checks).status).toBe('ready')
  })

  it.each([null, {}, [], { ...state, checked_at: 'invalid' }, { ...state, scan_submission_enabled: 'false' },
    { ...state, recovery_commit_sha: `${commit}\n` }, { ...state, prospect: 'secret.example' },
  ])('fails closed on an unavailable or malformed projection: %j', (raw) => {
    const checks = buildOrganizationScanOperationChecks(raw, configuration)
    expect(checks.every((check) => check.status === 'unknown' && check.required)).toBe(true)
    expect(JSON.stringify(checks)).not.toContain('secret.example')
    expect(summarizeLaunchChecks(checks).status).not.toBe('ready')
  })

  it.each([null, '2026-09-08T11:44:59Z', '2026-09-08T12:00:01Z'])('rejects missing, stale or future cleanup: %s', (time) => {
    const [cleanup] = buildOrganizationScanOperationChecks({ ...state, cleanup_completed_at: time }, configuration)
    expect(cleanup).toMatchObject({ required: true, status: 'blocked' })
  })

  it('does not hide a backlog behind a fresh cleanup marker', () => {
    const [cleanup] = buildOrganizationScanOperationChecks({ ...state, expired_batches_overdue: true }, configuration)
    expect(cleanup.status).toBe('blocked')
    expect(cleanup.evidence).toContain('overdue')
  })

  it.each([null, '2026-09-08T11:54:59Z', '2026-09-08T12:00:01Z'])('requires recent recovery while submissions are enabled: %s', (time) => {
    const [, recovery] = buildOrganizationScanOperationChecks({ ...state, scan_submission_enabled: true, recovery_completed_at: time }, configuration)
    expect(recovery).toMatchObject({ required: true, status: 'blocked' })
  })

  it.each([
    { ...configuration, runnerConfigured: false },
    { ...configuration, commitSha: null },
    { ...configuration, commitSha: 'b'.repeat(40) },
    { ...configuration, commitSha: `${commit}\n` },
  ])('never treats keys, an unknown revision or another deployment as recovery proof', (config) => {
    const [, recovery] = buildOrganizationScanOperationChecks({ ...state, scan_submission_enabled: true }, config)
    expect(recovery).toMatchObject({ required: true, status: 'blocked' })
  })

  it('surfaces unverified recovery while the pilot is off without blocking a scanner-disabled release', () => {
    const checks = buildOrganizationScanOperationChecks({ ...state, recovery_completed_at: null }, configuration)
    expect(checks[1]).toMatchObject({ required: false, status: 'attention' })
    expect(checks[1].evidence).toContain('disabled')
    expect(summarizeLaunchChecks(checks).status).toBe('ready')
  })

  it('accepts the freshness boundaries and explicit timezone offsets', () => {
    const checks = buildOrganizationScanOperationChecks({ ...state,
      cleanup_completed_at: '2026-09-08T06:45:00-05:00', recovery_completed_at: '2026-09-08T06:55:00-05:00',
    }, configuration)
    expect(checks.every((check) => check.status === 'ready')).toBe(true)
  })
})
