import { beforeEach, describe, expect, it, vi } from 'vitest'
const refs = vi.hoisted(() => ({ pending: vi.fn(), record: vi.fn(), configured: vi.fn(), send: vi.fn() }))
vi.mock('../client', () => ({ inngest: { createFunction: (_config: unknown, handler: unknown) => ({ handler }) } }))
vi.mock('@/lib/server/organization-scan-worker', () => ({
  hasOrganizationScanRunner: refs.configured, pendingOrganizationScans: refs.pending,
  organizationScanEventSchema: { safeParse: vi.fn() }, processNextOrganizationScan: vi.fn(),
}))
vi.mock('@/lib/server/organization-scan-operations', () => ({ recordOrganizationScanRecovery: refs.record }))
import { recoverOrganizationScans } from './organization-scans'

const step = { run: async (_id: string, fn: () => unknown) => fn(), sendEvent: refs.send }
const recover = (recoverOrganizationScans as unknown as { handler: (context: { step: typeof step }) => Promise<unknown> }).handler
beforeEach(() => {
  vi.clearAllMocks()
  refs.configured.mockReturnValue(true)
  refs.pending.mockResolvedValue([])
  refs.record.mockResolvedValue(true)
  refs.send.mockResolvedValue({ ids: ['event-id'] })
})

describe('durable recovery completion evidence', () => {
  it('records a real completed recovery even when the pilot is idle', async () => {
    expect(await recover({ step })).toEqual({ dispatched: 0 })
    expect(refs.pending).toHaveBeenCalledOnce()
    expect(refs.record).toHaveBeenCalledOnce()
    expect(refs.send).not.toHaveBeenCalled()
  })
  it('records success only after identifier-only events have been accepted', async () => {
    const data = { orgId: 'c2000000-0000-4000-8000-000000000001', batchId: 'c3000000-0000-4000-8000-000000000001' }
    refs.pending.mockResolvedValue([data])
    refs.send.mockImplementation(async () => {
      expect(refs.record).not.toHaveBeenCalled()
      return { ids: ['event-id'] }
    })
    expect(await recover({ step })).toEqual({ dispatched: 1 })
    expect(refs.send).toHaveBeenCalledWith('wake-batches', [{ name: 'nexez/organization-scan.batch', data }])
    expect(refs.record).toHaveBeenCalledOnce()
  })
  it('does not record success when cleanup or dispatch enumeration fails', async () => {
    refs.pending.mockRejectedValue(new Error('database unavailable'))
    await expect(recover({ step })).rejects.toThrow('database unavailable')
    expect(refs.record).not.toHaveBeenCalled()
    expect(refs.send).not.toHaveBeenCalled()
  })
  it('does not record success when an event could not be sent', async () => {
    refs.pending.mockResolvedValue([{ orgId: 'org', batchId: 'batch' }])
    refs.send.mockRejectedValue(new Error('event unavailable'))
    await expect(recover({ step })).rejects.toThrow('event unavailable')
    expect(refs.record).not.toHaveBeenCalled()
  })
  it('keeps a marker failure retryable', async () => {
    refs.record.mockRejectedValue(new Error('marker unavailable'))
    await expect(recover({ step })).rejects.toThrow('marker unavailable')
  })
  it('cannot manufacture success from a missing runner configuration', async () => {
    refs.configured.mockReturnValue(false)
    expect(await recover({ step })).toEqual({ skipped: 'runner_unavailable' })
    expect(refs.pending).not.toHaveBeenCalled()
    expect(refs.record).not.toHaveBeenCalled()
  })
})
