import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'

const refs = vi.hoisted(() => ({
  user: { id: '92000000-0000-4000-8000-000000000001' } as { id: string } | null,
  rows: [] as Array<Record<string, unknown>>,
  error: null as null | { message: string },
  getUser: vi.fn(), rpc: vi.fn(), from: vi.fn(),
}))
vi.mock('next/headers', () => ({ cookies: vi.fn(async () => ({})) }))
vi.mock('next/navigation', () => ({
  notFound: () => { throw new Error('NOT_FOUND') },
  redirect: (path: string) => { throw new Error(`REDIRECT:${path}`) },
}))
vi.mock('@/utils/supabase/server', () => ({
  createClient: () => ({ auth: { getUser: refs.getUser }, rpc: refs.rpc, from: refs.from }),
}))

import ReportExamplesPage, { dynamic, metadata } from './page'

const row = {
  org_id: '93000000-0000-4000-8000-000000000001', org_slug: 'internal-review', org_name: 'Internal review',
  membership_id: '94000000-0000-4000-8000-000000000001', member_role: 'owner',
  scan_access: 'paused', scan_starts_at: null, scan_expires_at: null,
  max_targets_per_batch: null, max_targets_per_day: null, max_concurrent_targets: null,
}
const page = (example?: string | string[], orgSlug = 'internal-review') => ReportExamplesPage({
  params: Promise.resolve({ orgSlug }), searchParams: Promise.resolve({ example }),
})
const renderedPage = async (example?: string) => renderToStaticMarkup(await page(example))

beforeEach(() => {
  vi.clearAllMocks()
  refs.user = { id: '92000000-0000-4000-8000-000000000001' }
  refs.rows = [{ ...row }]
  refs.error = null
  refs.getUser.mockImplementation(async () => ({ data: { user: refs.user } }))
  refs.rpc.mockImplementation(() => ({ abortSignal: async () => ({ data: refs.rows, error: refs.error }) }))
  refs.from.mockImplementation(() => { throw new Error('Merchant sources must not be read') })
})

describe('organization report example access', () => {
  it('requires sign-in before a workspace read and preserves the selected example', async () => {
    refs.user = null
    await expect(page('zero')).rejects.toThrow('REDIRECT:/login?next=%2Fconsole%2Finternal-review%2Freport-examples%3Fexample%3Dzero')
    expect(refs.rpc).not.toHaveBeenCalled()
    expect(refs.from).not.toHaveBeenCalled()
  })

  it.each(['../../merchant', 'AGENCY', 'a', 'internal-review?owner=other'])('rejects unsafe workspace context %s', async slug => {
    await expect(page(undefined, slug)).rejects.toThrow('NOT_FOUND')
    expect(refs.getUser).not.toHaveBeenCalled()
    expect(refs.rpc).not.toHaveBeenCalled()
  })

  it.each(['__proto__', 'merchant_sources', 'https://example.com', ['activity', 'zero']])('rejects an unsupported or ambiguous selector %j', async example => {
    await expect(page(example)).rejects.toThrow('NOT_FOUND')
    expect(refs.rpc).not.toHaveBeenCalled()
  })

  it('denies missing or foreign membership without rendering a report', async () => {
    refs.rows = []
    await expect(page()).rejects.toThrow('NOT_FOUND')
    expect(refs.rpc).toHaveBeenCalledWith('get_organization_context', { p_org_id: null, p_org_slug: 'internal-review' })
    expect(refs.from).not.toHaveBeenCalled()
  })

  it('uses current workspace authority, including when scanning is paused', async () => {
    const html = await renderedPage()
    expect(html).toContain('Report examples</h1>')
    expect(html).toContain('Illustrative example')
    expect(html).toContain('href="/console/internal-review/scans"')
    expect(html.match(/aria-current="page"/g)).toHaveLength(2)
    expect(refs.rpc).toHaveBeenCalledTimes(1)
    expect(refs.from).not.toHaveBeenCalled()
    expect(dynamic).toBe('force-dynamic')
    expect(metadata.robots).toEqual({ index: false, follow: false })
  })

  it.each([
    ['missing', 'Collection not started'], ['zero', 'Total visits'],
  ])('selects only the fixed %s example', async (example, text) => {
    const html = await renderedPage(example)
    const traffic = html.match(/<section[^>]*aria-label="Recorded traffic"[^>]*>(.*?)<\/section>/s)?.[1]
    expect(traffic).toContain(text)
    if (example === 'zero') expect(traffic?.match(/<dd>0<\/dd>/g)).toHaveLength(2)
    else expect(traffic).not.toContain('<dd>')
    expect(refs.from).not.toHaveBeenCalled()
  })

  it('fails closed without displaying fixture results or database errors on lookup failure', async () => {
    refs.error = { message: 'private-database-marker' }
    const html = await renderedPage()
    expect(html).toContain('role="alert"')
    expect(html).toContain('temporarily unavailable')
    expect(html).not.toContain('Illustrative example')
    expect(html).not.toContain('private-database-marker')
  })

  it('checks membership again after access is revoked', async () => {
    await page()
    refs.rows = []
    await expect(page('zero')).rejects.toThrow('NOT_FOUND')
    expect(refs.rpc).toHaveBeenCalledTimes(2)
  })
})
