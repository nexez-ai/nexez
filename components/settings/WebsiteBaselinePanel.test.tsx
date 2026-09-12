// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import '@testing-library/jest-dom/vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { WebsiteBaselinePanel } from './WebsiteBaselinePanel'

const ownerId = 'ad000000-0000-4000-8000-000000000001'
const listingId = 'bd000000-0000-4000-8000-000000000001'
const associationId = 'cd000000-0000-4000-8000-000000000001'
const view = { ownerId, listingId, collectionEnabled: true, suggestedOrigin: 'https://example.com', association: null, latest: null, attempt: null }
const association = { id: associationId, origin: 'https://example.com', method: 'merchant_approved', confirmedAt: '2026-09-12T00:00:00Z', expiresAt: '2026-09-25T00:00:00Z' }
const fetchMock = vi.fn()
const response = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
beforeEach(() => { vi.clearAllMocks(); vi.stubGlobal('fetch', fetchMock); fetchMock.mockImplementation(async () => response(view)) })
afterEach(() => { cleanup(); vi.unstubAllGlobals() })

describe('merchant website owner controls', () => {
  it('hides an inactive empty pilot without presenting an unusable action', async () => {
    fetchMock.mockResolvedValue(response({ ...view, collectionEnabled: false }))
    const { container } = render(<WebsiteBaselinePanel listingId={listingId} />)
    await waitFor(() => expect(fetchMock).toHaveBeenCalledOnce())
    await act(async () => {})
    expect(container.textContent).toBe('')
  })
  it('requires explicit approval of the displayed origin before enabling the command', async () => {
    render(<WebsiteBaselinePanel listingId={listingId} />)
    const approve = await screen.findByRole('button', { name: 'Approve website' })
    expect(approve).toBeDisabled()
    expect(screen.getByText(/does not verify domain ownership/)).toBeVisible()
    fireEvent.click(screen.getByRole('checkbox'))
    expect(approve).toBeEnabled()
    fetchMock.mockImplementation(async (_url, init) => response(init ? { ...view, association } : view))
    fireEvent.click(approve)
    await screen.findByRole('button', { name: 'Collect baseline' })
    const payload = JSON.parse(fetchMock.mock.calls.find(([, init]) => init?.method === 'POST')![1].body)
    expect(payload).toMatchObject({ action: 'approve', listingId, origin: 'https://example.com', attested: true, approvalVersion: 'merchant-website-v1' })
    expect(payload.ownerId).toBeUndefined()
    expect(fetchMock.mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(1)
  })
  it('does not carry approval over to a different suggested origin', async () => {
    render(<WebsiteBaselinePanel listingId={listingId} />)
    const approve = await screen.findByRole('button', { name: 'Approve website' })
    fireEvent.click(screen.getByRole('checkbox'))
    expect(approve).toBeEnabled()
    fetchMock.mockResolvedValue(response({ ...view, suggestedOrigin: 'https://www.example.com' }))
    fireEvent.click(screen.getByRole('button', { name: 'Refresh status' }))
    await screen.findByText('https://www.example.com')
    expect(screen.getByRole('checkbox')).not.toBeChecked()
    expect(approve).toBeDisabled()
  })
  it('reuses the same idempotency key after an uncertain network result', async () => {
    render(<WebsiteBaselinePanel listingId={listingId} />)
    const approve = await screen.findByRole('button', { name: 'Approve website' })
    fireEvent.click(screen.getByRole('checkbox'))
    fetchMock.mockRejectedValueOnce(new Error('Connection interrupted'))
    fireEvent.click(approve)
    await screen.findByText('Connection interrupted')
    fetchMock.mockResolvedValue(response({ ...view, association }))
    fireEvent.click(approve)
    await screen.findByRole('button', { name: 'Collect baseline' })
    const writes = fetchMock.mock.calls.filter(([, init]) => init?.method === 'POST').map(([, init]) => JSON.parse(init.body))
    expect(writes).toHaveLength(2)
    expect(writes[1].idempotencyKey).toBe(writes[0].idempotencyKey)
  })
  it('shows a failed observation as unavailable with no score', async () => {
    fetchMock.mockResolvedValue(response({ ...view, association, latest: {
      id: 'dd000000-0000-4000-8000-000000000001', associationId, origin: association.origin, associationMethod: 'merchant_approved',
      scannerVersion: 'site-scan-2.1', rubricId: 'nexez.website-agent-readiness', provenance: 'merchant_website_snapshot',
      evaluatedAt: '2026-09-12T01:00:00Z', createdAt: '2026-09-12T01:00:00Z', sourceVersion: `sha256:${'a'.repeat(64)}`, result: null, failure: 'robots_denied',
    } }))
    render(<WebsiteBaselinePanel listingId={listingId} />)
    expect(await screen.findByText(/A failed collection is not a score of zero/)).toBeVisible()
    expect(screen.queryByText(/Website agent readiness:/)).toBeNull()
  })
  it('keeps revocation available when new collection is disabled', async () => {
    fetchMock.mockResolvedValue(response({ ...view, association, collectionEnabled: false }))
    render(<WebsiteBaselinePanel listingId={listingId} />)
    expect(await screen.findByRole('button', { name: 'Collect baseline' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Revoke website approval' })).toBeEnabled()
  })
  it('does not label a replayed in-progress request as finished', async () => {
    fetchMock.mockResolvedValue(response({ ...view, association }))
    render(<WebsiteBaselinePanel listingId={listingId} />)
    const collect = await screen.findByRole('button', { name: 'Collect baseline' })
    fetchMock.mockResolvedValue(response({ ...view, association, attempt: { id: associationId, state: 'running' } }))
    fireEvent.click(collect)
    expect(await screen.findByText('Collection is still in progress. Refresh shortly.')).toBeVisible()
    expect(screen.queryByText(/Collection finished/)).toBeNull()
  })
})
