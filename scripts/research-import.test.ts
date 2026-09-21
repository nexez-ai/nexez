import { describe, expect, it } from 'vitest'
import { batchSql, importGuard, sqlText, validateImport } from './research-import.mjs'
import { sha256 } from './research-frame.mjs'

const text = JSON.stringify({ cohort: 'test-frame', domain_key: 'example.com' }) + '\n'
const manifest = { cohort: 'test-frame', selected: 1, targetsSha256: sha256(text) }
describe('research frame importer', () => {
  it('accepts only the checksummed frame', () => {
    expect(validateImport(manifest, text)).toHaveLength(1)
    expect(() => validateImport(manifest, text + ' ')).toThrow('checksum')
  })
  it('rejects duplicate domains and mismatched cohort counts', () => {
    expect(() => validateImport({ ...manifest, selected: 2 }, text)).toThrow('accounting')
    expect(() => validateImport({ ...manifest, cohort: 'different' }, text)).toThrow('accounting')
    expect(() => validateImport({ ...manifest, selected: 2, targetsSha256: sha256(text + text) }, text + text)).toThrow('accounting')
  })
  it('escapes data literals and enforces preparing-only imports', () => {
    expect(sqlText("a'b")).toBe("'a''b'")
    expect(importGuard(manifest)).toContain("state='preparing'")
    expect(importGuard(manifest)).toContain('source_frozen_at is null')
    const sql = batchSql(manifest, [{ cohort: 'test-frame', source_ref: "a'b" }])
    expect(sql).toContain("a''b")
    expect(sql).toContain('Existing frame row differs')
    expect(sql).not.toContain("state='pilot'")
    expect(sql).not.toContain('dispatch_readiness_study')
  })
})
