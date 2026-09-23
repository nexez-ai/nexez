/** Freeze a nested, offline-only frame extension. Never imports or scans sites.
 * Rebuilds the parent from the original seed and byte-checks it before adding
 * candidates. Raw domains stay in mode-0600 artifacts, never console output.
 */
import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { createInterface } from 'node:readline'
import { Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { pathToFileURL } from 'node:url'
import { createGunzip } from 'node:zlib'
import { createFrameSelector, MAX_FRAME_PER_VERTICAL, sha256, VERTICALS } from './research-frame.mjs'
import { validateImport } from './research-import.mjs'

export const frameText = targets => targets.map(row => JSON.stringify(row)).join('\n') + '\n'
const compare = (a, b) => a < b ? -1 : a > b ? 1 : 0
const sameRow = (a, b) => ['cohort', 'domain_key', 'url', 'vertical', 'region', 'source_ref', 'sample_rank']
  .every(key => a[key] === b[key])

/** The parent is always the original selection manifest, not a later cohort's
 * relabelled scan manifest. Scan ranks remain tied to the original seed.
 */
export function buildNestedExtension(parentManifest, parentText, expanded, cohort, selectedOn) {
  const parent = validateImport(parentManifest, parentText)
  const perVertical = parentManifest.perVertical
  if (!Number.isInteger(perVertical) || perVertical < 1 || perVertical > 15000
    || parent.length !== perVertical * VERTICALS.length) throw new Error('Invalid parent category cap')
  if (!/^[a-z0-9-]{3,80}$/.test(cohort) || cohort === parentManifest.cohort
    || !/^\d{4}-\d{2}-\d{2}$/.test(selectedOn)) throw new Error('Invalid extension metadata')
  const expandedCap = expanded.length / VERTICALS.length
  if (!Number.isInteger(expandedCap) || expandedCap <= perVertical || expandedCap > MAX_FRAME_PER_VERTICAL
    || new Set(expanded.map(row => row.domain_key)).size !== expanded.length
    || expanded.some(row => row.cohort !== parentManifest.cohort || !VERTICALS.includes(row.vertical)
      || row.sample_rank !== sha256(`${parentManifest.cohort}:scan:${row.domain_key}`))) throw new Error('Invalid nested frame accounting')

  const expandedMap = new Map(expanded.map(row => [row.domain_key, row]))
  if (parent.some(row => !expandedMap.has(row.domain_key) || !sameRow(row, expandedMap.get(row.domain_key)))) {
    throw new Error('Original candidate changed or missing')
  }
  const parentDomains = new Set(parent.map(row => row.domain_key))
  const additions = expanded.filter(row => !parentDomains.has(row.domain_key))
  const byVertical = Object.fromEntries(VERTICALS.map(vertical => [vertical, additions.filter(row => row.vertical === vertical).length]))
  // Verifies both balanced parent accounting and a truly nested hash prefix.
  for (const vertical of VERTICALS) {
    const parentRows = parent.filter(row => row.vertical === vertical)
    const rows = expanded.filter(row => row.vertical === vertical)
      .toSorted((a, b) => compare(sha256(`${parentManifest.cohort}:${a.domain_key}`), sha256(`${parentManifest.cohort}:${b.domain_key}`))
        || compare(a.domain_key, b.domain_key))
    if (parentRows.length !== perVertical || rows.length !== expandedCap
      || byVertical[vertical] !== expandedCap - perVertical
      || rows.slice(0, perVertical).some(row => !parentDomains.has(row.domain_key))) throw new Error('Parent is not the original category prefix')
  }
  const ordered = expanded.toSorted((a, b) => compare(a.sample_rank, b.sample_rank) || compare(a.domain_key, b.domain_key))
  const retained = ordered.filter(row => parentDomains.has(row.domain_key))
  if (retained.some((row, index) => !sameRow(row, parent[index]))) throw new Error('Original scan ordering changed')
  const targets = ordered.filter(row => !parentDomains.has(row.domain_key)).map(row => ({ ...row, cohort }))
  const text = frameText(targets)
  const manifest = {
    cohort, source: parentManifest.source, release: parentManifest.release, selectedOn,
    mappingVersion: parentManifest.mappingVersion, categories: parentManifest.categories,
    excludedHosts: parentManifest.excludedHosts,
    selectionSeedCohort: parentManifest.cohort,
    sourceParquetSha256: parentManifest.sourceParquetSha256,
    sourceJsonlSha256: parentManifest.sourceJsonlSha256,
    mappingSha256: parentManifest.mappingSha256,
    originalManifestSha256: sha256(JSON.stringify(parentManifest)),
    originalTargetsSha256: parentManifest.targetsSha256,
    originalSelectorSha256: parentManifest.selectorSha256,
    originalPerVertical: perVertical, originalSelected: parent.length,
    nestedPerVertical: expandedCap, nestedSelected: expanded.length,
    nestedTargetsSha256: sha256(frameText(ordered)),
    selected: targets.length, perVertical: expandedCap - perVertical,
    selectedByVertical: byVertical, targetsSha256: sha256(text),
    originalCandidatesRetained: parent.length, originalCandidatesChanged: 0,
    overlappingInitialDomains: 0,
    state: 'offline_frozen_not_imported',
    method: 'Same extract, mapping and original selection seed. Preserve the original category prefixes, rows and scan ranks. Add only the next seeded selection ranks per category. Original frame scans first; extension scans second in original-seed scan-rank order. A partial two-wave sample is not a single random prefix of the nested frame.',
    activationRequirements: 'Stopped checkpoint quality/cost review, bounded attempts and dispatches, carried cumulative budget, one active wave, unchanged protocol/scorer and verified final-domain hash salt continuity. Deduplicate final redirected domains across all compatible protocol-4 waves before reporting. No superseded pilot or smoke observations.',
    limitations: parentManifest.limitations,
    attribution: parentManifest.attribution,
  }
  validateImport(manifest, text)
  return { targets, text, nestedText: frameText(ordered), manifest }
}

async function fileHash(path) {
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(path)) hash.update(chunk)
  return hash.digest('hex')
}

async function main() {
  const [input, mappingPath, parentDirectory, output, cohort, parquet, selectedOn] = process.argv.slice(2)
  if (!selectedOn) throw new Error('Usage: node scripts/research-frame-extension.mjs source.jsonl[.gz] mapping.json original-frame NEW-output-directory extension-cohort source.parquet YYYY-MM-DD')
  const parentManifest = JSON.parse(await readFile(resolve(parentDirectory, 'manifest.json'), 'utf8'))
  const parentText = await readFile(resolve(parentDirectory, 'targets.jsonl'), 'utf8')
  validateImport(parentManifest, parentText)
  if (parentManifest.perVertical !== 15000 || parentManifest.selected !== 75000) throw new Error('Expected the original 75,000-candidate frame')
  const config = JSON.parse(await readFile(mappingPath, 'utf8'))
  if (await fileHash(mappingPath) !== parentManifest.mappingSha256
    || await fileHash(parquet) !== parentManifest.sourceParquetSha256) throw new Error('Frozen source checksum mismatch')
  const selector = createFrameSelector(parentManifest.cohort, config)
  const hash = createHash('sha256')
  const hashStream = new Transform({ transform(chunk, _encoding, done) { hash.update(chunk); done(null, chunk) } })
  const lines = createInterface({ input: hashStream, crlfDelay: Infinity })
  const inputStream = createReadStream(input)
  const pumping = pipeline(inputStream, ...(input.endsWith('.gz') ? [createGunzip()] : []), hashStream)
  // Attach a rejection handler immediately; the iterator below also fails when
  // pipeline destroys the hash stream. Await pumping before trusting the hash.
  pumping.catch(() => lines.close())
  try {
    for await (const line of lines) {
      if (!line.trim()) continue
      if (line.length > 32768) throw new Error('Oversized source record')
      selector.add(JSON.parse(line))
    }
    await pumping
  } finally {
    lines.close()
    inputStream.destroy()
    hashStream.destroy()
  }
  if (hash.digest('hex') !== parentManifest.sourceJsonlSha256) throw new Error('Frozen extract checksum mismatch')
  if (sha256(frameText(selector.finish(15000).targets)) !== parentManifest.targetsSha256) throw new Error('Rebuilt parent is not byte-identical')
  const expanded = selector.finish(MAX_FRAME_PER_VERTICAL)
  const result = buildNestedExtension(parentManifest, parentText, expanded.targets, cohort, selectedOn)
  Object.assign(result.manifest, {
    selectorSha256: await fileHash(new URL('./research-frame.mjs', import.meta.url)),
    extensionBuilderSha256: await fileHash(new URL(import.meta.url)),
    parentManifestFileSha256: await fileHash(resolve(parentDirectory, 'manifest.json')),
    sourceExtractFileSha256: await fileHash(input),
    inputRecords: expanded.audit.inputRecords,
    uniqueEligibleDomains: expanded.audit.uniqueEligibleDomains,
    eligibleByVertical: expanded.audit.eligibleByVertical,
  })
  validateImport(result.manifest, result.text)
  await mkdir(output, { mode: 0o700 })
  for (const [name, contents] of Object.entries({
    'targets.jsonl': result.text,
    'nested-targets.jsonl': result.nestedText,
    'manifest.json': JSON.stringify(result.manifest, null, 2) + '\n',
  })) await writeFile(resolve(output, name), contents, { flag: 'wx', mode: 0o600 })
  console.log(JSON.stringify(result.manifest, null, 2))
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) main().catch(() => {
  // JSON parse errors can contain raw source text, so keep CLI errors closed.
  console.error('Extension preparation failed. Nothing was imported or enabled. Check inputs and validation tests.')
  process.exitCode = 1
})
