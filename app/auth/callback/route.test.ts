import { beforeEach, describe, expect, it, vi } from 'vitest'

const refs = vi.hoisted(() => ({
  user: null as any,
  exchangeError: null as any,
}))

const trial = vi.hoisted(() => ({
  ensure: vi.fn(),
  hasBilling: vi.fn(),
  isSelectable: vi.fn((value: unknown) => ['free', 'launch', 'pro', 'scale'].includes(String(value))),
}))

vi.mock('next/server', async (importOriginal) => {
  const actual = await importOriginal<typeof import('next/server')>()
  return { ...actual, after: vi.fn() }
})
vi.mock('next/headers', () => ({ cookies: vi.fn(async () => ({})) }))
vi.mock('../../../utils/supabase/server', () => ({
  createClient: () => ({
    auth: {
      exchangeCodeForSession: async () => ({ error: refs.exchangeError }),
      getUser: async () => ({ data: { user: refs.user } }),
    },
  }),
}))
vi.mock('../../../lib/server/trial', () => ({
  ensureBillingSeeded: trial.ensure,
  hasBillingAccount: trial.hasBilling,
  isSelectablePlan: trial.isSelectable,
}))
vi.mock('../../../lib/server/system-email', () => ({ sendOnceSystemEmail: vi.fn() }))
vi.mock('../../../lib/email', () => ({ buildWelcomeEmail: vi.fn() }))

import { GET } from './route'

const callback = (next = '/dashboard') => new Request(`https://app.nexez.test/auth/callback?code=ok&next=${encodeURIComponent(next)}`)

describe('GET /auth/callback plan routing', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    refs.exchangeError = null
    refs.user = {
      id: 'user-1',
      email: 'owner@example.com',
      created_at: new Date(Date.now() - 72 * 60 * 60 * 1000).toISOString(),
      user_metadata: {},
    }
    trial.hasBilling.mockResolvedValue(false)
    trial.ensure.mockResolvedValue(true)
  })

  it('routes a plan-less returning OAuth user through onboarding even after the welcome window', async () => {
    const response = await GET(callback('/dashboard/analytics'))

    expect(response.headers.get('location')).toBe('https://app.nexez.test/onboard?next=%2Fdashboard%2Fanalytics')
    expect(trial.ensure).not.toHaveBeenCalled()
  })

  it('lets an existing billed account continue without forcing onboarding', async () => {
    trial.hasBilling.mockResolvedValue(true)

    const response = await GET(callback())

    expect(response.headers.get('location')).toBe('https://app.nexez.test/dashboard')
  })

  it('keeps a plan-less Shopify install out of paid-plan onboarding', async () => {
    const response = await GET(callback('/shopify/link'))

    expect(response.headers.get('location')).toBe('https://app.nexez.test/shopify/link')
    expect(trial.hasBilling).not.toHaveBeenCalled()
    expect(trial.ensure).not.toHaveBeenCalled()
  })

  it('treats invalid and Enterprise metadata as no self-serve plan choice', async () => {
    for (const plan of ['made-up', 'enterprise']) {
      refs.user.user_metadata = { plan }
      const response = await GET(callback())
      expect(response.headers.get('location')).toBe('https://app.nexez.test/onboard?next=%2Fdashboard')
    }
  })

  it('seeds a recent explicit Free choice before continuing', async () => {
    refs.user.created_at = new Date().toISOString()
    refs.user.user_metadata = { plan: 'free' }

    const response = await GET(callback())

    expect(trial.ensure).toHaveBeenCalledWith('user-1', 'free')
    expect(response.headers.get('location')).toBe('https://app.nexez.test/dashboard')
  })

  it('seeds a recent explicit paid-plan choice before continuing', async () => {
    refs.user.created_at = new Date().toISOString()
    refs.user.user_metadata = { plan: 'launch' }

    const response = await GET(callback())

    expect(trial.ensure).toHaveBeenCalledWith('user-1', 'launch')
    expect(response.headers.get('location')).toBe('https://app.nexez.test/dashboard')
  })
})
