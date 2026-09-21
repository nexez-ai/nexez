/** Import an audited frame in resumable batches. Never enables scanning.
 * Uses the existing Supabase CLI login, never reads or prints cloud credentials.
 */
import { execFileSync } from 'node:child_process'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { sha256 } from './research-frame.mjs'

export const sqlText = value => `'${String(value).replace(/'/g, "''")}'`
export function validateImport(manifest, text) {
  if (!/^[a-z0-9-]{3,80}$/.test(manifest.cohort) || manifest.targetsSha256 !== sha256(text)) throw new Error('Frame checksum mismatch')
  const targets = text.trim().split('\n').map(line => JSON.parse(line))
  if (targets.length !== manifest.selected || targets.length > 75000 || !targets.length
    || new Set(targets.map(row => row.domain_key)).size !== targets.length
    || targets.some(row => row.cohort !== manifest.cohort)) throw new Error('Invalid frame accounting')
  if (Buffer.byteLength(JSON.stringify(manifest)) > 16384) throw new Error('Oversized source manifest')
  return targets
}

export function importGuard(manifest) {
  return `do $guard$ begin
    if not exists(select 1 from public.study_runs where cohort=${sqlText(manifest.cohort)}
      and state='preparing' and source_frozen_at is null
      and source_manifest->>'targetsSha256'=${sqlText(manifest.targetsSha256)}) then
      raise exception 'Cohort is frozen or has a different frame';
    end if;
  end $guard$;`
}

export function batchSql(manifest, targets) {
  const rows = sqlText(JSON.stringify(targets))
  const columns = 'cohort text,domain_key text,url text,vertical text,region text,source_ref text,sample_rank text'
  return `begin;
set local statement_timeout='30s';
set local standard_conforming_strings=on;
${importGuard(manifest)}
create temporary table readiness_import_batch on commit drop as
  select * from jsonb_to_recordset(${rows}::jsonb) x(${columns});
do $batch$ begin
  if exists(select 1 from pg_temp.readiness_import_batch x
    join public.study_run_targets t on t.cohort=x.cohort and t.domain_key=x.domain_key
    where (t.url,t.vertical,t.region,t.source_ref,t.sample_rank)
      is distinct from (x.url,x.vertical,x.region,x.source_ref,x.sample_rank)) then
    raise exception 'Existing frame row differs from audited source';
  end if;
end $batch$;
insert into public.study_run_targets(cohort,domain_key,url,vertical,region,source_ref,sample_rank)
  select cohort,domain_key,url,vertical,region,source_ref,sample_rank
  from pg_temp.readiness_import_batch
  on conflict(cohort,domain_key) do nothing;
commit;
select count(*) as imported from public.study_run_targets where cohort=${sqlText(manifest.cohort)};
`
}

async function main() {
  const [frameDirectory, projectRef, mode = '--generate-only'] = process.argv.slice(2)
  if (!frameDirectory || !/^[a-z]{20}$/.test(projectRef ?? '') || !['--generate-only', '--apply'].includes(mode)) throw new Error('Usage: node scripts/research-import.mjs frame-directory project-ref [--apply]')
  const manifest = JSON.parse(await readFile(resolve(frameDirectory, 'manifest.json'), 'utf8'))
  const targets = validateImport(manifest, await readFile(resolve(frameDirectory, 'targets.jsonl'), 'utf8'))
  const sqlDirectory = resolve(frameDirectory, 'import-sql')
  await mkdir(sqlDirectory, { mode: 0o700, recursive: true })
  const initialization = `begin;
set local standard_conforming_strings=on;
insert into public.study_runs(cohort,source_manifest) values(${sqlText(manifest.cohort)},${sqlText(JSON.stringify(manifest))}::jsonb)
  on conflict(cohort) do nothing;
${importGuard(manifest)}
commit;
select state from public.study_runs where cohort=${sqlText(manifest.cohort)};
`
  const batches = [initialization]
  for (let start = 0; start < targets.length; start += 1000) batches.push(batchSql(manifest, targets.slice(start, start + 1000)))
  for (let index = 0; index < batches.length; index += 1) {
    const path = resolve(sqlDirectory, `${String(index).padStart(3, '0')}.sql`)
    // On a retry an existing generated batch must be byte-for-byte identical.
    try { await writeFile(path, batches[index], { flag: 'wx', mode: 0o600 }) }
    catch (error) { if (error.code !== 'EEXIST' || await readFile(path, 'utf8') !== batches[index]) throw new Error('Existing SQL batch differs') }
    if (mode === '--apply') {
      try {
        execFileSync('supabase', ['db', 'query', '--linked', '--project-ref', projectRef, '--file', path, '--output', 'json'],
          { encoding: 'utf8', timeout: 60000, maxBuffer: 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] })
      } catch { throw new Error(`Import stopped at batch ${index}; earlier batches remain resumable. No scanning was enabled.`) }
    }
    console.log(JSON.stringify({ batch: index, totalBatches: batches.length, action: mode === '--apply' ? 'imported' : 'generated' }))
  }
  console.log(JSON.stringify({ cohort: manifest.cohort, targets: targets.length, state: 'preparing', scanningEnabled: false }))
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) main().catch(error => {
  console.error(error.message)
  process.exitCode = 1
})
