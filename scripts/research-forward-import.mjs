/** Finite forward-only import. No source freeze, cron or activation occurs here. */
import { execFileSync } from 'node:child_process'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { batchSql, importGuard, sqlText } from './research-import.mjs'
import { sha256 } from './research-frame.mjs'

const FIELDS = ['cohort', 'domain_key', 'url', 'vertical', 'region', 'source_ref', 'sample_rank']
const METADATA = FIELDS.slice(1)
const rows = text => text.trimEnd().split('\n').map(JSON.parse)
export const canonical = targets => targets.map(row => FIELDS.map(key => row[key]).join('\t')).join('\n') + '\n'
const insist = (value, message) => { if (!value) throw new Error(message) }

/** Miniature counts are test-only. The executable always requires 120k/5k. */
export function validateForwardImport(manifest, text, derivedText, excludedText, counts = { selected: 120000, excluded: 5000 }) {
  insist(counts.selected <= 120000 && counts.selected > 0 && counts.excluded > 0, 'Invalid finite bound')
  insist(manifest.researchProtocolVersion === 7 && manifest.scannerVersion === 2
    && manifest.mode === 'forward_only_excluding_prior_initial_domains'
    && /^[a-z0-9-]{3,80}$/.test(manifest.cohort) && /^[a-z0-9-]{3,80}$/.test(manifest.recoversFrom)
    && manifest.cohort !== manifest.recoversFrom, 'Invalid forward lineage')
  insist(manifest.targetsSha256 === sha256(text) && manifest.derivedFromTargetsSha256 === sha256(derivedText)
    && manifest.recoveryTargetsSha256 === sha256(excludedText), 'Frame checksum mismatch')
  const targets = rows(text), derived = rows(derivedText), excluded = rows(excludedText)
  insist(targets.length === counts.selected && targets.length === manifest.selected
    && derived.length === targets.length && excluded.length === counts.excluded, 'Invalid frame accounting')
  const skip = new Set(excluded.map(row => row.domain_key))
  insist(skip.size === excluded.length && excluded.every(row => row.cohort === manifest.recoversFrom), 'Invalid exclusion frame')
  const domains = new Set()
  let lastRank = ''
  for (let i = 0; i < targets.length; i++) {
    const row = targets[i]
    insist(Object.keys(row).length === FIELDS.length && FIELDS.every(key => typeof row[key] === 'string'
      && row[key].length > 0 && !/[\t\r\n]/.test(row[key])), 'Invalid source row')
    insist(row.cohort === manifest.cohort && !skip.has(row.domain_key) && !domains.has(row.domain_key), 'Initial domain overlap')
    insist(METADATA.every(key => row[key] === derived[i][key]), 'Source metadata changed')
    insist(row.sample_rank === sha256(manifest.selectionSeedCohort + ':scan:' + row.domain_key)
      && row.sample_rank > lastRank, 'Original rank or ordering changed')
    domains.add(row.domain_key)
    lastRank = row.sample_rank
  }
  insist(sha256(canonical(targets)) === manifest.importCanonicalSha256, 'Canonical checksum mismatch')
  insist(Buffer.byteLength(JSON.stringify(manifest)) <= 16384, 'Oversized manifest')
  return targets
}

export function initializeForwardSql(manifest) {
  return `begin;
set local lock_timeout='5s';
set local standard_conforming_strings=on;
insert into public.study_runs(cohort,recovers_from,research_protocol_version,hash_identity_fingerprint,
  family_max_attempts,family_max_dispatches,max_attempts,max_dispatches,other_cost_reserve_cents,
  dispatch_cost_microusd,budget_cents,deadline_at,source_manifest,target_successes,success_limit)
select ${sqlText(manifest.cohort)},cohort,7,hash_identity_fingerprint,
  family_max_attempts-attempts_reserved,family_max_dispatches-dispatches,
  least(15000,family_max_attempts-attempts_reserved),least(3000,family_max_dispatches-dispatches),
  other_cost_reserve_cents+(dispatch_reserved_microusd+9999)/10000,2700,budget_cents,deadline_at,
  ${sqlText(JSON.stringify(manifest))}::jsonb,100000,5000
from public.study_runs where cohort=${sqlText(manifest.recoversFrom)}
on conflict(cohort) do nothing;
${importGuard(manifest)}
do $guard$ begin
  if not exists(select 1 from public.study_runs where cohort=${sqlText(manifest.cohort)}
    and recovers_from=${sqlText(manifest.recoversFrom)} and research_protocol_version=7
    and source_manifest=${sqlText(JSON.stringify(manifest))}::jsonb
    and attempts_reserved=0 and dispatches=0) then raise exception 'Forward initialization mismatch'; end if;
end $guard$;
commit;`
}

async function main() {
  const [directory, project, mode = '--generate-only'] = process.argv.slice(2)
  insist(directory && /^[a-z]{20}$/.test(project ?? '') && ['--generate-only', '--apply'].includes(mode),
    'Usage: research-forward-import.mjs frame-directory project-ref [--apply]')
  const manifest = JSON.parse(await readFile(resolve(directory, 'manifest.json'), 'utf8'))
  // Fixed sibling artifacts, never paths supplied by web content or a database.
  const targets = validateForwardImport(manifest,
    await readFile(resolve(directory, 'targets.jsonl'), 'utf8'),
    await readFile(resolve(directory, '../continuation-protocol6-120k/targets.jsonl'), 'utf8'),
    await readFile(resolve(directory, '../revalidation-protocol6-5k/targets.jsonl'), 'utf8'))
  const batches = [initializeForwardSql(manifest)]
  for (let i = 0; i < targets.length; i += 1000) batches.push(batchSql(manifest, targets.slice(i, i + 1000)))
  const sqlDirectory = resolve(directory, 'import-sql')
  await mkdir(sqlDirectory, { recursive: true, mode: 0o700 })
  for (let index = 0; index < batches.length; index++) {
    const path = resolve(sqlDirectory, String(index).padStart(3, '0') + '.sql')
    try { await writeFile(path, batches[index], { flag: 'wx', mode: 0o600 }) }
    catch (error) { if (error.code !== 'EEXIST' || await readFile(path, 'utf8') !== batches[index]) throw new Error('Existing SQL batch differs') }
    if (mode === '--apply') {
      try {
        execFileSync('supabase', ['db', 'query', '--linked', '--project-ref', project, '--file', path, '--output', 'json'],
          { encoding: 'utf8', timeout: 60000, maxBuffer: 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] })
      } catch { throw new Error('Import stopped at batch ' + index + '; earlier batches are resumable; scanning stays disabled') }
    }
    if (index % 10 === 0 || index === batches.length - 1) console.log(JSON.stringify({ batch: index, totalBatches: batches.length, mode }))
  }
  console.log(JSON.stringify({ selected: targets.length, scanningEnabled: false }))
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) main().catch(error => {
  console.error(error.message)
  process.exitCode = 1
})
