import { describe, it, expect } from 'vitest'
import { normalizeOrganizationScanOrigin, parseOrganizationScanInput, scanResultSchema, SCAN_CHECK_COPY } from './organization-scans'
import { isRobotPathAllowed } from './crawlability'

describe('organization scanner input boundary', () => {
  it.each(['https://example.com/a/..', 'https://example.com/%2e', 'https://example.com?token=x', 'https://example.com#x',
    'https://user:secret@example.com', 'https://example.com:8080', 'file:///etc/passwd', 'data:text/html,hi',
    'http://127.0.0.1', 'http://2130706433', 'http://0x7f000001', 'http://[::ffff:127.0.0.1]',
    'https://foo.local', 'https://foo.internal', 'https://foo.test', 'https://github.io', 'https://co.uk',
    'https://example.com\\@127.0.0.1', 'https://exam\nple.com', 'https://example.com//', 'https://exa%mple.com'])('rejects %s', (input) => {
    expect(normalizeOrganizationScanOrigin(input)).toBeNull()
  })
  it('canonicalizes origins and deduplicates one-column CSV', () => {
    const parsed = parseOrganizationScanInput('\uFEFFwebsite\r\n"HTTPS://Example.COM:443/"\r\nexample.com.\r\nhttp://example.com:80/\r\n')
    expect(parsed).toEqual({ targets: ['http://example.com', 'https://example.com'], duplicateCount: 1, issues: [] })
    expect(normalizeOrganizationScanOrigin('https://bücher.de')).toBe('https://xn--bcher-kva.de')
  })
  it('rejects multiple columns, HTML, overlong files, too many rows and oversized batches', () => {
    for (const input of ['url,name\nexample.com,Acme', '<script>alert(1)</script>', 'x'.repeat(32769), '\n'.repeat(202), Array.from({ length: 51 }, (_, i) => `site${i}.com`).join('\n')]) {
      expect(parseOrganizationScanInput(input).issues.length).toBeGreaterThan(0)
    }
  })
  it('accepts only the closed rubric and rejects embedded fetched text', () => {
    const result = { version: 2, score: 70, checks: Object.keys(SCAN_CHECK_COPY).map((id) => ({ id, status: 'pass' })) }
    expect(scanResultSchema.safeParse(result).success).toBe(true)
    expect(scanResultSchema.safeParse({ ...result, pageText: 'private input' }).success).toBe(false)
    expect(scanResultSchema.safeParse({ ...result, checks: result.checks.map(() => result.checks[0]) }).success).toBe(false)
    expect(scanResultSchema.safeParse({ ...result, checks: result.checks.map((c) => ({ ...c, detail: '<script>' })) }).success).toBe(false)
  })
})

describe('scanner robots policy', () => {
  it('uses the most specific bot group and longest path, with allow winning ties', () => {
    const robots = 'User-agent: *\nDisallow: /\nUser-agent: NexezBot\nDisallow: /private\nAllow: /private/public\nDisallow: /tie\nAllow: /tie'
    expect(isRobotPathAllowed(robots, 'NexezBot', '/')).toBe(true)
    expect(isRobotPathAllowed(robots, 'NexezBot', '/private/x')).toBe(false)
    expect(isRobotPathAllowed(robots, 'NexezBot', '/private/public/x')).toBe(true)
    expect(isRobotPathAllowed(robots, 'NexezBot', '/tie')).toBe(true)
    expect(isRobotPathAllowed(robots, 'OtherBot', '/')).toBe(false)
  })
  it('matches wildcard and end anchors without exponential regex behavior', () => {
    expect(isRobotPathAllowed('User-agent: *\nDisallow: /*.json$', 'NexezBot', '/agent.json')).toBe(false)
    expect(isRobotPathAllowed('User-agent: *\nDisallow: /*.json$', 'NexezBot', '/agent.json?x=1')).toBe(true)
    expect(isRobotPathAllowed('User-agent: *\nDisallow: /' + 'a*'.repeat(200) + 'z$', 'NexezBot', '/' + 'a'.repeat(2000))).toBe(true)
    expect(isRobotPathAllowed('User-agent: *\nDisallow: /Case', 'NexezBot', '/case')).toBe(true)
  })
})
