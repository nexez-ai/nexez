/** Deterministic, offline selection from the pinned minimal Overture extract.
 * No website requests or database writes. Raw outputs are private artifacts.
 */
import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { isIP } from 'node:net'
import { resolve } from 'node:path'
import { createInterface } from 'node:readline'
import { pathToFileURL } from 'node:url'
import { parse } from 'tldts'

export const VERTICALS = ['restaurants', 'health', 'home_trades', 'personal_care', 'retail']
// An explicit ceiling for a separately audited nested extension. The original
// default stays 15,000 per category and existing manifests remain immutable.
export const MAX_FRAME_PER_VERTICAL = 25000
const REGIONS = new Set('AL AK AZ AR CA CO CT DE DC FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY'.split(' '))
export const EXCLUDED_HOSTS = [
  'facebook.com', 'instagram.com', 'linktr.ee', 'yelp.com', 'google.com', 'goo.gl',
  'doordash.com', 'ubereats.com', 'grubhub.com', 'opentable.com', 'toasttab.com',
  'squareup.com', 'order.online', 'wa.me', 'twitter.com', 'x.com', 'tiktok.com',
  'youtube.com', 'linkedin.com', 'etsy.com', 'ebay.com', 'amazon.com',
  'wixsite.com', 'business.site', 'mapquest.com', 'yellowpages.com', 'tripadvisor.com',
]
export const sha256 = (value) => createHash('sha256').update(value).digest('hex')
const compare = (a, b) => a < b ? -1 : a > b ? 1 : 0

export function normalizeResearchWebsite(raw) {
  if (typeof raw !== 'string') return null
  const value = raw.trim()
  if (!value || value.length > 2048 || /[\s\\]/.test(value)) return null
  if (/^[a-z][a-z0-9+.-]*:/i.test(value) && !/^https?:\/\//i.test(value)) return null
  let url
  try { url = new URL(/^https?:\/\//i.test(value) ? value : `https://${value}`) }
  catch { return null }
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || url.port) return null
  const host = url.hostname.toLowerCase().replace(/\.$/, '')
  if (isIP(host) || host.length > 253 || !/^[a-z0-9.-]+$/.test(host)
    || host.split('.').some(label => !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label))) return null
  const parsed = parse(host, { allowPrivateDomains: true })
  if (!parsed.domain || (!parsed.isIcann && !parsed.isPrivate)) return null
  if (EXCLUDED_HOSTS.some(base => host === base || host.endsWith(`.${base}`))) return null
  // Shared host roots are not tenant websites. Private-suffix tenants remain
  // distinct, for example two independent myshopify.com storefronts.
  return { domain_key: parsed.domain, url: `${url.protocol}//${host}` }
}

export function verticalFor(record, mapping) {
  const tokens = new Set([record.category, record.basic_category,
    ...(Array.isArray(record.hierarchy) ? record.hierarchy : [])].filter(value => typeof value === 'string'))
  const matched = VERTICALS.filter(vertical => mapping[vertical].some(token => tokens.has(token)))
  return matched.length === 1 ? matched[0] : null
}

export function validateMapping(config) {
  if (config.release !== '2026-08-19.0' || config.version !== 1 || !/^\d{4}-\d{2}-\d{2}$/.test(config.selectedOn)) throw new Error('Invalid source mapping metadata')
  for (const vertical of VERTICALS) {
    if (!Array.isArray(config.categories?.[vertical]) || !config.categories[vertical].length
      || config.categories[vertical].some(value => typeof value !== 'string' || !/^[a-z0-9_]+$/.test(value))) throw new Error('Invalid category mapping')
  }
}

export function createFrameSelector(cohort, config) {
  if (!/^[a-z0-9-]{3,80}$/.test(cohort)) throw new Error('Invalid cohort')
  validateMapping(config)
  const domains = new Map()
  const counts = { inputRecords: 0, outsideCategories: 0, invalidMetadata: 0, noEligibleWebsite: 0, eligibleRecords: 0, duplicateInputDomains: 0 }
  return {
    add(record) {
      counts.inputRecords += 1
      const vertical = verticalFor(record, config.categories)
      if (!vertical) { counts.outsideCategories += 1; return }
      if (!REGIONS.has(record.region) || typeof record.source_id !== 'string'
        || !/^[a-zA-Z0-9-]{1,100}$/.test(record.source_id) || !(record.confidence >= 0.9)) {
        counts.invalidMetadata += 1; return
      }
      const websites = (Array.isArray(record.websites) ? record.websites : [])
        .map(normalizeResearchWebsite).filter(Boolean)
        .sort((a, b) => compare(sha256(`${cohort}:website:${a.domain_key}`), sha256(`${cohort}:website:${b.domain_key}`))
          || compare(b.url.startsWith('https:'), a.url.startsWith('https:')) || compare(a.url, b.url))
      if (!websites.length) { counts.noEligibleWebsite += 1; return }
      counts.eligibleRecords += 1
      const target = {
        cohort, ...websites[0], vertical, region: record.region,
        source_ref: `overture:${config.release}:${record.source_id}`,
        sample_rank: sha256(`${cohort}:scan:${websites[0].domain_key}`),
      }
      // Domain collisions across places, states or categories are resolved
      // independently of readiness and without relying on input file order.
      const tie = sha256(`${cohort}:record:${record.source_id}`)
      const previous = domains.get(target.domain_key)
      if (previous) counts.duplicateInputDomains += 1
      if (!previous || compare(tie, previous.tie) < 0
        || (tie === previous.tie && compare(JSON.stringify(target), JSON.stringify(previous.target)) < 0)) domains.set(target.domain_key, {
          target, tie, selectionRank: sha256(`${cohort}:${target.domain_key}`),
        })
    },
    finish(perVertical = 15000) {
      if (!Number.isInteger(perVertical) || perVertical < 1 || perVertical > MAX_FRAME_PER_VERTICAL) throw new Error('Invalid category cap')
      const eligibleByVertical = Object.fromEntries(VERTICALS.map(vertical => [vertical, 0]))
      const selectedByVertical = Object.fromEntries(VERTICALS.map(vertical => [vertical, 0]))
      const selectedByRegion = {}
      const targets = []
      const ordered = [...domains.values()]
        .sort((a, b) => compare(a.selectionRank, b.selectionRank) || compare(a.target.domain_key, b.target.domain_key))
        .map(row => row.target)
      for (const target of ordered) {
        eligibleByVertical[target.vertical] += 1
        if (selectedByVertical[target.vertical] >= perVertical) continue
        targets.push(target)
        selectedByVertical[target.vertical] += 1
        selectedByRegion[target.region] = (selectedByRegion[target.region] ?? 0) + 1
      }
      if (VERTICALS.some(vertical => selectedByVertical[vertical] < perVertical)) throw new Error(`Insufficient category frame: ${JSON.stringify(eligibleByVertical)}`)
      // A second, independent seed orders cloud scanning. Reusing the selection
      // rank would overrepresent large source categories in the early pilot.
      targets.sort((a, b) => compare(a.sample_rank, b.sample_rank) || compare(a.domain_key, b.domain_key))
      return { targets, audit: { ...counts, uniqueEligibleDomains: domains.size, eligibleByVertical, selectedByVertical, selectedByRegion, selected: targets.length } }
    },
  }
}

async function fileHash(path) {
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(path)) hash.update(chunk)
  return hash.digest('hex')
}

async function main() {
  const [input, mappingPath, output, cohort, parquet, cap = '15000'] = process.argv.slice(2)
  if (!parquet) throw new Error('Usage: node scripts/research-frame.mjs source.jsonl mapping.json NEW-output-directory cohort source.parquet [per-vertical]')
  const config = JSON.parse(await readFile(mappingPath, 'utf8'))
  const selector = createFrameSelector(cohort, config)
  for await (const line of createInterface({ input: createReadStream(input), crlfDelay: Infinity })) {
    if (!line.trim()) continue
    if (line.length > 32768) throw new Error('Oversized source record')
    selector.add(JSON.parse(line))
  }
  const { targets, audit } = selector.finish(Number(cap))
  const targetText = targets.map(target => JSON.stringify(target)).join('\n') + '\n'
  const manifest = {
    cohort, source: 'Overture Maps Places', release: config.release, selectedOn: config.selectedOn,
    mappingVersion: config.version, categories: config.categories, excludedHosts: EXCLUDED_HOSTS,
    sourceParquetSha256: await fileHash(parquet), sourceJsonlSha256: await fileHash(input),
    mappingSha256: await fileHash(mappingPath), selectorSha256: await fileHash(new URL(import.meta.url)),
    targetsSha256: sha256(targetText), perVertical: Number(cap), ...audit,
    method: 'One eligible own-site origin per place by seeded domain hash, HTTPS tie preference; dedupe registrable domains by seeded source-record hash; select lowest SHA256(cohort:domain) within each category. Independently order scans by SHA256(cohort:scan:domain) to avoid biasing pilot composition toward larger source categories. Final redirect domains deduped separately.',
    limitations: 'Open, confidence >= 0.9, no brand metadata, US states plus DC. No-brand does not prove independent ownership. Coverage and category-balanced selection are not nationally representative. New baseline, not a trend from the August OSM study.',
    attribution: 'Overture Maps Foundation, Places release 2026-08-19.0. See https://docs.overturemaps.org/attribution/ for contributor notices and licenses. Raw source provenance is retained in the private frozen extract.',
  }
  await mkdir(output, { mode: 0o700 })
  await writeFile(resolve(output, 'targets.jsonl'), targetText, { flag: 'wx', mode: 0o600 })
  await writeFile(resolve(output, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n', { flag: 'wx', mode: 0o600 })
  console.log(JSON.stringify(manifest, null, 2))
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) main().catch(error => {
  console.error(error.message)
  process.exitCode = 1
})
