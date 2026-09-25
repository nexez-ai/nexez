import { describe, expect, it } from 'vitest'
import { canonical, initializeForwardSql, validateForwardImport } from './research-forward-import.mjs'
import { sha256 } from './research-frame.mjs'

const seed = 'original-seed'
const base = (domain: string, cohort: string) => ({ cohort, domain_key: domain, url: 'https://' + domain,
  vertical: 'health', region: 'CA', source_ref: domain, sample_rank: sha256(seed + ':scan:' + domain) })
const format = (data: object[]) => data.map(row => JSON.stringify(row)).join('\n') + '\n'
const targets = [base('new.example', 'forward-new'), base('fresh.example', 'forward-new')].sort((a, b) => a.sample_rank.localeCompare(b.sample_rank))
const derived = format(targets.map(row => ({ ...row, cohort: 'offline-only' })))
const excluded = format([base('old.example', 'prior-old')])
const text = format(targets)
const manifest = { cohort: 'forward-new', recoversFrom: 'prior-old', researchProtocolVersion: 7, scannerVersion: 2,
  mode: 'forward_only_excluding_prior_initial_domains', selected: 2, selectionSeedCohort: seed,
  targetsSha256: sha256(text), derivedFromTargetsSha256: sha256(derived), recoveryTargetsSha256: sha256(excluded),
  importCanonicalSha256: sha256(canonical(targets)) }
const counts = { selected: 2, excluded: 1 }
describe('finite forward-only importer', () => {
  it('checks exact unchanged metadata, original rank order and excluded domains', () => {
    expect(validateForwardImport(manifest, text, derived, excluded, counts)).toEqual(targets)
    expect(() => validateForwardImport(manifest, text, derived, excluded)).toThrow('accounting')
  })
  it.each(['targetsSha256', 'derivedFromTargetsSha256', 'recoveryTargetsSha256', 'importCanonicalSha256'])('fails closed on %s mismatch', key => {
    expect(() => validateForwardImport({ ...manifest, [key]: 'wrong' }, text, derived, excluded, counts)).toThrow(/checksum/i)
  })
  it('rejects changed source fields even with a new output checksum', () => {
    const changed = format(targets.map(row => ({ ...row, region: 'NY' })))
    expect(() => validateForwardImport({ ...manifest, targetsSha256: sha256(changed) }, changed, derived, excluded, counts)).toThrow('metadata')
  })
  it('rejects an excluded initial domain', () => {
    const overlapping = format([{ ...targets[0], cohort: 'prior-old' }])
    expect(() => validateForwardImport({ ...manifest, recoveryTargetsSha256: sha256(overlapping) }, text, derived, overlapping, counts)).toThrow('overlap')
  })
  it('rejects changed seed, order, protocol and unbounded frames', () => {
    expect(() => validateForwardImport({ ...manifest, selectionSeedCohort: 'changed' }, text, derived, excluded, counts)).toThrow('rank')
    const reverse = format([...targets].reverse())
    expect(() => validateForwardImport({ ...manifest, targetsSha256: sha256(reverse), derivedFromTargetsSha256: sha256(reverse) }, reverse, reverse, excluded, counts)).toThrow('ordering')
    expect(() => validateForwardImport({ ...manifest, researchProtocolVersion: 6 }, text, derived, excluded, counts)).toThrow('lineage')
    expect(() => validateForwardImport(manifest, text, derived, excluded, { selected: 120001, excluded: 1 })).toThrow('bound')
  })
  it('carries actual historical ledger and remaining limits without activating or copying observations', () => {
    const sql = initializeForwardSql(manifest)
    expect(sql).toContain('(dispatch_reserved_microusd+9999)/10000')
    expect(sql).toContain('family_max_attempts-attempts_reserved')
    expect(sql).toContain('family_max_dispatches-dispatches')
    expect(sql).toContain('hash_identity_fingerprint')
    expect(sql).toContain('100000,5000')
    expect(sql).not.toMatch(/state='running'|cron\.|insert into public.study_run_results|revalidates_cohort/)
  })
})
