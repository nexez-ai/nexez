import { describe, expect, it } from 'vitest'
import { createFrameSelector, normalizeResearchWebsite, sha256, verticalFor, VERTICALS } from './research-frame.mjs'

const config: { release: string; version: number; selectedOn: string; categories: Record<string, string[]> } = {
  release: '2026-08-19.0', version: 1, selectedOn: '2026-09-21',
  categories: { restaurants: ['restaurant'], health: ['dentist'], home_trades: ['plumber'], personal_care: ['salon'], retail: ['bookstore'] },
}
const rows = VERTICALS.flatMap((vertical, index) => Array.from({ length: 3 }, (_, i) => ({
  source_id: `fixture-${index}-${i}`, region: 'CA', confidence: 0.95,
  websites: [`https://site${index}-${i}.com/about`], category: config.categories[vertical][0], hierarchy: [],
})))

describe('offline research source frame', () => {
  it.each(['https://facebook.com/store', 'https://sub.facebook.com', 'mailto:hello@example.com', 'http://127.0.0.1', 'https://[::1]', 'https://localhost', 'https://foo.internal', 'https://example.com:444', 'https://user:pass@example.com', 'https://foo\\@example.com', 'javascript:alert(1)', 'https://bad_label.com'])('excludes unsafe or platform website %s', raw => {
    expect(normalizeResearchWebsite(raw)).toBeNull()
  })
  it('normalizes origins and registrable domains with private suffixes', () => {
    expect(normalizeResearchWebsite('WWW.Example.co.uk/about?q=x')).toEqual({ domain_key: 'example.co.uk', url: 'https://www.example.co.uk' })
    expect(normalizeResearchWebsite('https://one.myshopify.com/item')?.domain_key).toBe('one.myshopify.com')
    expect(normalizeResearchWebsite('https://two.myshopify.com/item')?.domain_key).toBe('two.myshopify.com')
  })
  it('uses exact taxonomy membership, excluding ambiguous matches', () => {
    expect(verticalFor({ category: 'italian_restaurant', hierarchy: ['food', 'restaurant'] }, config.categories)).toBe('restaurants')
    expect(verticalFor({ category: 'not_a_restaurant' }, config.categories)).toBeNull()
    expect(verticalFor({ category: 'dentist', hierarchy: ['restaurant'] }, config.categories)).toBeNull()
  })
  it('selects identical balanced frames regardless of input order', () => {
    const a = createFrameSelector('test-cohort', config)
    const b = createFrameSelector('test-cohort', config)
    rows.forEach(row => a.add(row))
    rows.toReversed().forEach(row => b.add(row))
    expect(a.finish(2)).toEqual(b.finish(2))
    expect(a.finish(2).targets).toHaveLength(10)
    expect(Object.values(a.finish(2).audit.selectedByVertical)).toEqual([2, 2, 2, 2, 2])
  })
  it('deduplicates domains across locations and strips contact fields', () => {
    const selector = createFrameSelector('test-cohort', config)
    rows.forEach(row => selector.add({ ...row, email: 'private@example.com' }))
    selector.add({ ...rows[0], source_id: 'duplicate', region: 'NY', websites: ['https://www.site0-0.com/path'] })
    const frame = selector.finish(1)
    expect(frame.audit.duplicateInputDomains).toBe(1)
    expect(frame.audit.uniqueEligibleDomains).toBe(15)
    expect(JSON.stringify(frame.targets)).not.toContain('email')
    expect(frame.targets[0].sample_rank).toBe(sha256(`test-cohort:scan:${frame.targets[0].domain_key}`))
    expect(frame.targets.map(row => row.sample_rank)).toEqual(frame.targets.map(row => row.sample_rank).toSorted())
  })
  it('requires every category to meet its frozen input cap', () => {
    const selector = createFrameSelector('test-cohort', config)
    selector.add(rows[0])
    expect(() => selector.finish(1)).toThrow('Insufficient category frame')
  })
  it('does not select invalid regions, low confidence or platform-only records', () => {
    const selector = createFrameSelector('test-cohort', config)
    rows.forEach(row => selector.add(row))
    selector.add({ ...rows[0], region: 'PR' })
    selector.add({ ...rows[0], confidence: 0.5 })
    selector.add({ ...rows[0], websites: ['https://yelp.com/biz/example'] })
    const { audit } = selector.finish(1)
    expect(audit.invalidMetadata).toBe(2)
    expect(audit.noEligibleWebsite).toBe(1)
  })
})
