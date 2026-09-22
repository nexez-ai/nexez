vi.mock('../../utils/supabase/admin', () => ({ hasSupabaseAdminEnv: () => true, createAdminClient: () => ({}) }))
vi.mock('../../lib/server/shopify-billing', () => ({ getOwnerShopifyBillingContext: vi.fn(async () => null) }))
import { getOwnerShopifyBillingContext } from '../../lib/server/shopify-billing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const refs = vi.hoisted(() => ({
  user: null as any,
  authError: null as any,
  plan: 'free' as any,
}))
const trial = vi.hoisted(() => ({
  ensure: vi.fn(),
  hasBilling: vi.fn(),
  isSelectable: vi.fn((value: unknown) => ['free', 'launch', 'pro', 'scale'].includes(String(value))),
}))
const redirect = vi.hoisted(() => vi.fn((location: string) => {
  throw new Error(`NEXT_REDIRECT:${location}`)
}))

vi.mock('next/headers', () => ({ cookies: vi.fn(async () => ({ get: () => undefined })) }))
vi.mock('next/navigation', () => ({ redirect }))
vi.mock('../../utils/supabase/server', () => ({
  createClient: () => ({ auth: { getUser: async () => ({ data: { user: refs.user }, error: refs.authError }) } }),
}))
vi.mock('../../lib/server/plan', () => ({
  getOwnerEntitlements: vi.fn(async () => ({
    planId: refs.plan,
    commercialPlanId: refs.plan,
    source: refs.plan === 'free' ? 'free' : 'subscription',
    adminOverride: false,
    promotion: null,
    features: {},
    limits: {},
  })),
}))
vi.mock('../../lib/server/trial', () => ({
  ensureBillingSeeded: trial.ensure,
  hasBillingAccount: trial.hasBilling,
  isSelectablePlan: trial.isSelectable,
}))
vi.mock('../../components/billing/PlanProvider', () => ({ PlanProvider: ({ children }: any) => children }))

import DashboardLayout from './layout'

describe('DashboardLayout plan gate', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(getOwnerShopifyBillingContext).mockResolvedValue(null)
    refs.user = { id: 'user-1', user_metadata: {} }
    refs.authError = null
    refs.plan = 'free'
    trial.hasBilling.mockResolvedValue(false)
    trial.ensure.mockResolvedValue(false)
  })

  it('redirects a plan-less account to onboarding instead of silently assigning Pro', async () => {
    await expect(DashboardLayout({ children: null })).rejects.toThrow('NEXT_REDIRECT:/onboard?next=/dashboard')
    expect(trial.ensure).not.toHaveBeenCalled()
  })

  it('seeds an explicit trialable selection and continues', async () => {
    refs.user.user_metadata = { plan: 'pro' }
    trial.ensure.mockResolvedValue(true)

    await expect(DashboardLayout({ children: null })).resolves.toBeTruthy()
    expect(trial.ensure).toHaveBeenCalledWith('user-1', 'pro')
    expect(redirect).not.toHaveBeenCalled()
  })

  it('seeds an explicit Free selection and continues', async () => {
    refs.user.user_metadata = { plan: 'free' }
    trial.ensure.mockResolvedValue(true)

    await expect(DashboardLayout({ children: null })).resolves.toBeTruthy()
    expect(trial.ensure).toHaveBeenCalledWith('user-1', 'free')
    expect(redirect).not.toHaveBeenCalled()
  })

  it('preserves existing billing state, including non-conferring legacy or paused rows', async () => {
    trial.hasBilling.mockResolvedValue(true)

    await expect(DashboardLayout({ children: null })).resolves.toBeTruthy()
    expect(trial.ensure).not.toHaveBeenCalled()
    expect(redirect).not.toHaveBeenCalled()
  })

  it('keeps a Shopify merchant in the linking flow without starting an ordinary trial', async () => {
    refs.user.user_metadata = { plan: 'pro' }
    vi.mocked(getOwnerShopifyBillingContext).mockResolvedValue({
      provider: 'shopify', shop: 'review.myshopify.com', pricingUrl: '/dashboard/shopify',
      planHandle: null, status: 'connection_required', verifiedAt: null,
    })
    await expect(DashboardLayout({ children: null })).resolves.toBeTruthy()
    expect(trial.ensure).not.toHaveBeenCalled()
    expect(redirect).not.toHaveBeenCalled()
  })

  it('applies the platform design contract to every dashboard descendant', async () => {
    trial.hasBilling.mockResolvedValue(true)

    const layout = await DashboardLayout({ children: 'dashboard content' })
    const surface = (layout as any).props.children

    expect(surface.props.className).toContain('nx-platform-surface')
    expect(surface.props.children).toBe('dashboard content')
  })
})
