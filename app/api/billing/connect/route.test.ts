vi.mock('../../../../lib/server/shopify-billing', () => ({ getOwnerShopifyBillingContext: vi.fn(async () => null) }))
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextResponse } from 'next/server'
import { createSupabaseMock, type QueryContext } from '../../../../test/supabase-mock'

const refs = vi.hoisted(() => ({
  retrieve: vi.fn(),
  createClient: vi.fn(),
  createAdminClient: vi.fn(),
  createAccount: vi.fn(),
  createOnboardingLink: vi.fn(),
}))

vi.mock('stripe', () => ({
  default: class {
    accounts = { retrieve: refs.retrieve }
  },
}))
const rateLimitRef = vi.hoisted(() => ({ response: null as NextResponse | null }))
vi.mock('next/headers', () => ({ cookies: vi.fn(async () => ({ get: () => undefined })) }))
vi.mock('../../../../lib/rate-limit', () => ({
  enforceRateLimit: vi.fn(async () => rateLimitRef.response),
}))
vi.mock('../../../../utils/supabase/server', () => ({ createClient: refs.createClient }))
vi.mock('../../../../utils/supabase/admin', () => ({
  hasSupabaseAdminEnv: vi.fn(() => true),
  createAdminClient: refs.createAdminClient,
}))
vi.mock('../../../../lib/stripe-billing', () => ({
  createStripeConnectAccount: refs.createAccount,
  createStripeConnectOnboardingLink: refs.createOnboardingLink,
}))
vi.mock('../../../../lib/billing', () => ({ billingPlans: [] }))

import { POST } from './route'

const allocationRace = {
  code: '40001',
  message: 'NEXEZ_ENTITLEMENT_ALLOCATION_RETRY',
}

const billingWithAccount = {
  owner_id: 'owner-1',
  plan_id: 'free',
  status: 'active',
  stripe_connect_account_id: 'acct_1',
  metadata: {},
}

function sessionClient() {
  return {
    auth: { getUser: vi.fn(async () => ({ data: { user: { id: 'owner-1', email: 'owner@example.test' } } })) },
  }
}

function useAdmin(handler: (query: QueryContext) => { data?: unknown; error?: unknown }) {
  refs.createAdminClient.mockReturnValue(createSupabaseMock(handler))
}

const refreshRequest = () => new Request('https://nexez.test/api/billing/connect?refresh=true', { method: 'POST' })

describe('POST /api/billing/connect', () => {
  beforeEach(() => {
    rateLimitRef.response = null
    vi.clearAllMocks()
    vi.stubEnv('STRIPE_SECRET_KEY', 'sk_test_ready')
    refs.createClient.mockReturnValue(sessionClient())
    refs.createAccount.mockResolvedValue({ id: 'acct_new' })
    refs.retrieve.mockResolvedValue({
      details_submitted: true,
      charges_enabled: true,
      payouts_enabled: true,
    })
  })

  it('maps a status-persistence allocation race to the stable retry contract', async () => {
    useAdmin((query) => {
      if (query.op === 'select') return { data: billingWithAccount, error: null }
      return { data: null, error: allocationRace }
    })

    const response = await POST(refreshRequest())

    expect(response.status).toBe(409)
    expect(response.headers.get('retry-after')).toBe('1')
    await expect(response.json()).resolves.toMatchObject({
      code: 'entitlement_allocation_retry',
      retryable: true,
    })
  })

  it('takes the first entitlement lock before creating a remote account', async () => {
    useAdmin((query) => {
      if (query.op === 'select') return { data: null, error: null }
      if (query.op === 'upsert') return { data: null, error: allocationRace }
      return { data: null, error: null }
    })

    const response = await POST(refreshRequest())

    expect(response.status).toBe(409)
    expect(refs.createAccount).not.toHaveBeenCalled()
    expect(refs.retrieve).not.toHaveBeenCalled()
  })

  it('returns the retry contract if account persistence races after Stripe creation', async () => {
    useAdmin((query) => {
      if (query.op === 'select') return { data: null, error: null }
      if (query.op === 'upsert') return { data: { stripe_connect_account_id: null }, error: null }
      if (query.op === 'update') return { data: null, error: allocationRace }
      return { data: null, error: null }
    })

    const response = await POST(refreshRequest())

    expect(response.status).toBe(409)
    expect(refs.createAccount).toHaveBeenCalledOnce()
    expect(refs.createAccount).toHaveBeenCalledWith('owner-1', 'owner@example.test', undefined)
    expect(refs.retrieve).not.toHaveBeenCalled()
  })

  it('does not create a remote account when authoritative billing state is unreadable', async () => {
    useAdmin((query) => query.op === 'select'
      ? { data: null, error: { code: 'XX000', message: 'read failed' } }
      : { data: null, error: null })

    const response = await POST(refreshRequest())

    expect(response.status).toBe(500)
    expect(refs.createAccount).not.toHaveBeenCalled()
  })

  it('does not report a successful refresh when persistence fails', async () => {
    useAdmin((query) => {
      if (query.op === 'select') return { data: billingWithAccount, error: null }
      return { data: null, error: { code: 'XX000', message: 'write failed' } }
    })

    const response = await POST(refreshRequest())

    expect(response.status).toBe(500)
    await expect(response.json()).resolves.toEqual({
      error: 'Failed to save the latest Connect account status.',
    })
  })

  it('does not report a successful refresh when Stripe retrieval fails', async () => {
    useAdmin((query) => query.op === 'select'
      ? { data: billingWithAccount, error: null }
      : { data: null, error: null })
    refs.retrieve.mockRejectedValue(new Error('Stripe unavailable'))

    const response = await POST(refreshRequest())

    expect(response.status).toBe(502)
    await expect(response.json()).resolves.toEqual({
      error: 'Failed to retrieve the latest Connect account status.',
    })
  })

  it('returns readiness only after Stripe state is persisted', async () => {
    useAdmin((query) => query.op === 'select'
      ? { data: billingWithAccount, error: null }
      : { data: null, error: null })

    const response = await POST(refreshRequest())

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      refreshed: true,
      stripe_connect_status: 'complete',
      stripe_connect_details_submitted: true,
      stripe_connect_charges_enabled: true,
      stripe_connect_payouts_enabled: true,
    })
  })
})
