import { createHmac } from 'node:crypto'
import { NextRequest } from 'next/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const key = 'a'.repeat(64)
const endpoint = 'https://app.nexez.ai/api/inngest'
const body = JSON.stringify({ url: 'https://deployment.example/api/inngest' })

function request(signatureKey = key, ageSeconds = 0, requestBody = body) {
  const timestamp = String(Math.floor(Date.now() / 1000) - ageSeconds)
  const signature = createHmac('sha256', signatureKey).update(body).update(timestamp).digest('hex')
  return new NextRequest(endpoint, {
    method: 'PUT', body: requestBody,
    headers: {
      'content-type': 'application/json',
      'x-inngest-sync-kind': 'in_band',
      'x-inngest-signature': `t=${timestamp}&s=${signature}`,
    },
  })
}

beforeEach(() => {
  vi.resetModules()
  vi.stubEnv('INNGEST_DEV', '0')
  vi.stubEnv('INNGEST_SIGNING_KEY', `signkey-test-${key}`)
  vi.stubEnv('INNGEST_SERVE_ORIGIN', 'https://app.nexez.ai')
  vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('App sync must not execute background work') }))
})
afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

describe('signed production app registration', () => {
  it('registers every function within the deployed account limit on the app host', async () => {
    const { PUT } = await import('./route')
    const response = await PUT(request(), { params: Promise.resolve({}) })
    expect(response.status).toBe(200)
    expect(response.headers.get('x-inngest-sync-kind')).toBe('in_band')
    const payload = await response.json()
    expect(payload.app_id).toBe('nexez')
    expect(payload.functions.map((fn: { id: string }) => fn.id).sort()).toEqual([
      'nexez-feed-regenerate', 'nexez-freshness-nudge', 'nexez-organization-scan-batch',
      'nexez-organization-scan-recovery', 'nexez-outbound-webhooks-dispatch',
    ])
    for (const fn of payload.functions) {
      // The linked production account rejects the entire app if any cap exceeds five.
      const limits = Array.isArray(fn.concurrency) ? fn.concurrency : [fn.concurrency]
      for (const rule of limits.filter(Boolean)) {
        const limit = typeof rule === 'number' ? rule : rule.limit
        expect(limit).toBeGreaterThan(0)
        expect(limit).toBeLessThanOrEqual(5)
      }
      for (const step of Object.values(fn.steps) as { runtime: { url: string } }[]) {
        const url = new URL(step.runtime.url)
        expect(url.origin + url.pathname).toBe(endpoint)
      }
    }
    const batch = payload.functions.find((fn: { id: string }) => fn.id === 'nexez-organization-scan-batch')
    expect(batch.concurrency).toContainEqual(expect.objectContaining({ key: 'event.data.orgId', limit: 3 }))
    const recovery = payload.functions.find((fn: { id: string }) => fn.id === 'nexez-organization-scan-recovery')
    expect(recovery.triggers).toEqual([{ cron: '* * * * *' }])
    expect(fetch).not.toHaveBeenCalled()
  })

  it.each(['missing', 'wrong key', 'expired', 'tampered body'] as const)('rejects a %s signature', async (attack) => {
    const { PUT } = await import('./route')
    const req = attack === 'wrong key' ? request('b'.repeat(64))
      : attack === 'expired' ? request(key, 3600)
        : attack === 'tampered body' ? request(key, 0, JSON.stringify({ url: 'https://other.example/api/inngest' }))
          : request()
    if (attack === 'missing') req.headers.delete('x-inngest-signature')
    const response = await PUT(req, { params: Promise.resolve({}) })
    expect(response.status).toBe(401)
    expect(await response.json()).not.toHaveProperty('functions')
    expect(fetch).not.toHaveBeenCalled()
  })
})
