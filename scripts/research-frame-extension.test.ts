import { describe, expect, it } from 'vitest'
import { createFrameSelector, sha256, VERTICALS } from './research-frame.mjs'
import { buildNestedExtension, frameText } from './research-frame-extension.mjs'

const config = {
  release: '2026-08-19.0', version: 1, selectedOn: '2026-09-21',
  categories: { restaurants: ['restaurant'], health: ['dentist'], home_trades: ['plumber'], personal_care: ['salon'], retail: ['bookstore'] } as Record<string, string[]>,
}
const records = VERTICALS.flatMap((vertical: string, index: number) => Array.from({ length: 5 }, (_, i) => ({
  source_id: `fixture-${index}-${i}`, region: 'CA', confidence: 0.95,
  websites: [`https://fixture${index}-${i}.com/page`], category: config.categories[vertical][0], hierarchy: [],
})))
function fixture(reverse = false) {
  const selector = createFrameSelector('original-seed', config)
  ;(reverse ? records.toReversed() : records).forEach(row => selector.add(row))
  const parent = selector.finish(2).targets
  const text = frameText(parent)
  const manifest = { cohort: 'original-seed', selected: 10, perVertical: 2, targetsSha256: sha256(text), ...config }
  return { selector, parent, text, manifest, expanded: selector.finish(4).targets }
}

describe('separately frozen nested research extension', () => {
  it('preserves every original row and rank, adds only disjoint domains, and uses the original seed', () => {
    const f = fixture()
    const r = buildNestedExtension(f.manifest, f.text, f.expanded, 'protocol-four-wave-two', '2026-09-23')
    expect(r.targets).toHaveLength(10)
    expect(r.manifest.selectedByVertical).toEqual(Object.fromEntries(VERTICALS.map((v: string) => [v, 2])))
    expect(r.targets.every((t: { domain_key: string }) => !f.parent.some((p: { domain_key: string }) => p.domain_key === t.domain_key))).toBe(true)
    for (const t of r.targets) {
      expect(t.cohort).toBe('protocol-four-wave-two')
      expect(t.sample_rank).toBe(sha256(`original-seed:scan:${t.domain_key}`))
    }
    expect(r.manifest.originalCandidatesRetained).toBe(10)
    expect(r.manifest.originalCandidatesChanged).toBe(0)
    expect(r.manifest.nestedTargetsSha256).toBe(sha256(r.nestedText))
    expect(r.manifest.targetsSha256).toBe(sha256(r.text))
    expect(r.manifest.state).toBe('offline_frozen_not_imported')
    expect(r.nestedText).toBe(frameText(f.expanded))
  })
  it('is reproducible across reversed source input and expansion output', () => {
    const a = fixture(), b = fixture(true)
    expect(buildNestedExtension(a.manifest, a.text, a.expanded, 'wave-two', '2026-09-23'))
      .toEqual(buildNestedExtension(b.manifest, b.text, b.expanded.toReversed(), 'wave-two', '2026-09-23'))
  })
  it('fails closed on a changed original URL or missing candidate', () => {
    const f = fixture()
    const changed = f.expanded.map((r: { domain_key: string }) => r.domain_key === f.parent[0].domain_key ? { ...r, url: 'https://changed.com' } : r)
    expect(() => buildNestedExtension(f.manifest, f.text, changed, 'wave-two', '2026-09-23')).toThrow('Original candidate')
    expect(() => buildNestedExtension(f.manifest, f.text, f.expanded.slice(1), 'wave-two', '2026-09-23')).toThrow('accounting')
  })
  it('rejects an altered rank, duplicate or cohort reseeding', () => {
    const f = fixture()
    for (const altered of [
      f.expanded.map((r: object, i: number) => i ? r : { ...r, sample_rank: 'a'.repeat(64) }),
      f.expanded.map((r: object, i: number) => i ? r : f.expanded[1]),
      f.expanded.map((r: object) => ({ ...r, cohort: 'new-seed' })),
    ]) expect(() => buildNestedExtension(f.manifest, f.text, altered, 'wave-two', '2026-09-23')).toThrow('accounting')
  })
  it('rejects changed parent bytes and changed parent ordering', () => {
    const f = fixture()
    expect(() => buildNestedExtension(f.manifest, f.text + '\n', f.expanded, 'wave-two', '2026-09-23')).toThrow('checksum')
    const reordered = frameText(f.parent.toReversed())
    expect(() => buildNestedExtension({ ...f.manifest, targetsSha256: sha256(reordered) }, reordered, f.expanded, 'wave-two', '2026-09-23')).toThrow('ordering')
  })
  it('rejects a parent that is not the lowest original seeded category prefix', () => {
    const f = fixture()
    const wrongParent = f.selector.finish(5).targets.filter((r: { domain_key: string }) => !f.parent.some((p: { domain_key: string }) => p.domain_key === r.domain_key))
    const text = frameText(wrongParent)
    expect(() => buildNestedExtension({ ...f.manifest, selected: 15, perVertical: 3, targetsSha256: sha256(text) }, text, f.selector.finish(5).targets, 'wave-two', '2026-09-23')).toThrow('prefix')
  })
  it('keeps a bounded maximum and rejects invalid metadata', () => {
    const f = fixture()
    expect(() => f.selector.finish(25001)).toThrow('category cap')
    expect(() => f.selector.finish(25000)).toThrow('Insufficient category frame')
    expect(() => buildNestedExtension(f.manifest, f.text, f.expanded, 'original-seed', '2026-09-23')).toThrow('metadata')
    expect(() => buildNestedExtension(f.manifest, f.text, f.expanded, 'wave-two', 'invalid-date')).toThrow('metadata')
    expect(() => buildNestedExtension(f.manifest, f.text, f.parent, 'wave-two', '2026-09-23')).toThrow('accounting')
  })
})
