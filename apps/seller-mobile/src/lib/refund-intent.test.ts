import { beforeEach, describe, expect, it, vi } from 'vitest'
import { withRefundIntent } from './refund-intent'

const storage = vi.hoisted(() => new Map<string, string>())
vi.mock('@react-native-async-storage/async-storage', () => ({ default: {
  getItem: async (key: string) => storage.get(key) ?? null,
  setItem: async (key: string, value: string) => { storage.set(key, value) },
  removeItem: async (key: string) => { storage.delete(key) },
} }))

describe('mobile refund confirmation persistence', () => {
  beforeEach(() => storage.clear())
  it('reuses the operation after a failed response and a module restart', async () => {
    let first: any
    await expect(withRefundIntent('order:one', { amount: 20 }, async (body) => {
      first = body; throw new Error('Network lost')
    })).rejects.toThrow('Network lost')
    vi.resetModules()
    const restarted = await import('./refund-intent')
    await restarted.withRefundIntent('order:one', { amount: 20 }, async (body: any) => {
      expect(body.operationId).toBe(first.operationId)
      expect(body.operationId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
      return { ok: true, operationId: body.operationId }
    })
    expect(storage.size).toBe(0)
  })
  it('shares identical concurrent taps and rejects a changed amount', async () => {
    let release!: () => void
    const wait = new Promise<void>((resolve) => { release = resolve })
    const send = vi.fn(async (body: any) => { await wait; return { ok: true, operationId: body.operationId } })
    const first = withRefundIntent('order:one', { amount: 20 }, send)
    const second = withRefundIntent('order:one', { amount: 20 }, send)
    await expect(withRefundIntent('order:one', { amount: 30 }, send)).rejects.toThrow('different refund')
    release()
    await Promise.all([first, second])
    expect(send).toHaveBeenCalledTimes(1)
  })
})
