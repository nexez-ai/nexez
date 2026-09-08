// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { OrganizationScanWorkspace } from './OrganizationScanWorkspace'
import { SCAN_CHECK_COPY } from '@/lib/organization-scans'
const { push, replace } = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn() }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ push, replace }) }))
const orgId = 'c2000000-0000-4000-8000-000000000001', batchId = 'c3000000-0000-4000-8000-000000000001'
const targetId = 'c4000000-0000-4000-8000-000000000001'
const props = { orgId, orgSlug: 'agency', batchLimit: 50, dailyLimit: 250 }
const empty = { batches: [], used_today: 0, can_submit: true }
const batch = { id: batchId, org_id: orgId, created_at: '2026-09-08T00:00:00Z', expires_at: '2026-12-07T00:00:00Z',
  total: 1, queued: 0, running: 0, succeeded: 1, failed: 0, cancelled_targets: 0, cancelled: false,
  targets: [{ id: targetId, origin: 'https://example.com', state: 'succeeded', attempts: 1, failure_code: null, elapsed_ms: 1200,
    follow_up: false, finished_at: '2026-09-08T00:00:02Z', result: { version: 2, score: 70, checks: Object.keys(SCAN_CHECK_COPY).map((id) => ({ id, status: 'warn' })) } }],
}
const fetcher = vi.fn()
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
beforeEach(() => { vi.clearAllMocks(); vi.stubGlobal('fetch', fetcher); fetcher.mockResolvedValue(json(empty)) })
afterEach(() => { cleanup(); vi.unstubAllGlobals() })

describe('scan workspace interactions', () => {
  it('requires valid targets and attestation, preserves the request key on a failed submission', async () => {
    fetcher.mockImplementation(async (_url, init) => init?.method === 'POST' ? json({ error: 'Please retry.' }, 503) : json(empty))
    render(<OrganizationScanWorkspace {...props} />)
    const input = await screen.findByLabelText('Website origins, one per line')
    fireEvent.change(input, { target: { value: 'example.com' } })
    expect(screen.getByRole('button', { name: 'Scan 1 websites' })).toBeDisabled()
    fireEvent.click(screen.getByRole('checkbox'))
    fireEvent.click(screen.getByRole('button', { name: 'Scan 1 websites' }))
    await screen.findByText('Please retry.')
    await waitFor(() => expect(screen.getByRole('button', { name: 'Scan 1 websites' })).toBeEnabled())
    fireEvent.click(screen.getByRole('button', { name: 'Scan 1 websites' }))
    await waitFor(() => expect(fetcher.mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(2))
    const posts = fetcher.mock.calls.filter(([, init]) => init?.method === 'POST').map(([, init]) => JSON.parse(init.body))
    expect(posts[0].idempotencyKey).toBe(posts[1].idempotencyKey)
    expect(push).not.toHaveBeenCalled()
  })
  it('shows safe findings and persists a selected follow-up', async () => {
    fetcher.mockImplementation(async (_url, init) => init?.method ? json({ ok: true }) : json({ ...empty, batches: [batch] }))
    render(<OrganizationScanWorkspace {...props} batchId={batchId} />)
    expect(await screen.findByText('70/100')).toBeVisible()
    fireEvent.click(screen.getByRole('checkbox'))
    await waitFor(() => expect(fetcher.mock.calls.some(([, init]) => init?.method === 'PATCH')).toBe(true))
    expect(JSON.parse(fetcher.mock.calls.find(([, init]) => init?.method === 'PATCH')![1].body)).toEqual({ action: 'follow_up', targetId, selected: true })
    expect(screen.getByRole('link', { name: 'https://example.com' })).toHaveAttribute('rel', 'noopener noreferrer')
  })
  it('clears visible targets on revoked access and ignores an older successful response', async () => {
    let older: (value: Response) => void = () => undefined
    let reads = 0
    fetcher.mockImplementation(() => {
      reads += 1
      if (reads === 1) return Promise.resolve(json({ ...empty, batches: [batch] }))
      if (reads === 2) return new Promise<Response>((resolve) => { older = resolve })
      return Promise.resolve(json({ error: 'denied' }, 404))
    })
    render(<OrganizationScanWorkspace {...props} batchId={batchId} />)
    await screen.findByText('70/100')
    act(() => document.dispatchEvent(new Event('visibilitychange')))
    act(() => document.dispatchEvent(new Event('visibilitychange')))
    await screen.findByText('This workspace or batch is no longer available.')
    await act(async () => older(json({ ...empty, batches: [batch] })))
    expect(screen.queryByText('70/100')).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'https://example.com' })).not.toBeInTheDocument()
  })
  it('requires confirmation before deletion and clears results after success', async () => {
    fetcher.mockImplementation(async (_url, init) => init?.method ? json({ ok: true }) : json({ ...empty, batches: [batch] }))
    render(<OrganizationScanWorkspace {...props} batchId={batchId} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Delete batch' }))
    expect(fetcher.mock.calls.some(([, init]) => init?.method === 'DELETE')).toBe(false)
    fireEvent.click(screen.getByRole('button', { name: 'Confirm deletion' }))
    await waitFor(() => expect(replace).toHaveBeenCalledWith('/console/agency/scans'))
    expect(screen.queryByText('70/100')).not.toBeInTheDocument()
  })
})
