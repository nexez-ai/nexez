import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { PlanId } from '../billing'
import { SHOPIFY_API_VERSION, readPendingShop } from './shopify'
import { appUrl } from '../site'
import type { ShopifyInstallCredentials } from './shopify-install'

const SHOPIFY_PARTNER_TIMEOUT_MS = 10_000
const SHOPIFY_APP_HANDLE_FALLBACK = 'nexez-agent-ready'
const SELF_SERVE_PLAN_IDS = new Set<PlanId>(['free', 'launch', 'pro', 'scale'])
const TERMINAL_STRIPE_SUBSCRIPTION_STATUSES = new Set(['canceled', 'incomplete_expired'])

type ShopifyBillingInstall = {
  shop_domain: string
  owner_id: string | null
  shop_gid?: string | null
  shopify_plan_handle?: string | null
  shopify_billing_status?: string | null
  shopify_billing_verified_at?: string | null
  uninstalled_at?: string | null
}

type ActiveSubscription = {
  billingPeriod: 'EVERY_30_DAYS' | 'ANNUAL'
  cancelAtEndOfCycle: boolean
  trialEndsAt: string | null
  currentBillingCycle: { startTime: string; endTime: string } | null
  items: Array<{ handle: string; description: string | null }>
}

export type ShopifyBillingContext = {
  provider: 'shopify'
  shop: string | null
  pricingUrl: string
  planHandle: string | null
  status: string | null
  verifiedAt: string | null
}

export type ShopifyBillingVerification = Omit<ShopifyBillingContext, 'status' | 'verifiedAt'> & {
  status: 'active' | 'free'
  verifiedAt: string
  activeSubscription: ActiveSubscription | null
  planId: PlanId
  shopGid: string
}

function appHandle(): string {
  return (process.env.SHOPIFY_APP_HANDLE || SHOPIFY_APP_HANDLE_FALLBACK).trim()
}

export function shopifyPricingUrl(shop: string): string {
  const storeHandle = shop.replace(/\.myshopify\.com$/i, '')
  return `https://admin.shopify.com/store/${encodeURIComponent(storeHandle)}/charges/${encodeURIComponent(appHandle())}/pricing_plans`
}

export function shopifyPartnerBillingConfigured(): boolean {
  return Boolean(
    process.env.SHOPIFY_PARTNER_ORG_ID
    && process.env.SHOPIFY_PARTNER_API_ACCESS_TOKEN
    && process.env.SHOPIFY_APP_GID,
  )
}

function planIdForHandle(handle: string | null | undefined): PlanId {
  if (!handle) return 'free'
  const normalized = handle.trim().toLowerCase()
  const configured = [
    ['launch', process.env.SHOPIFY_PLAN_HANDLE_LAUNCH],
    ['pro', process.env.SHOPIFY_PLAN_HANDLE_PRO],
    ['scale', process.env.SHOPIFY_PLAN_HANDLE_SCALE],
    ['free', process.env.SHOPIFY_PLAN_HANDLE_FREE],
  ] as const
  for (const [planId, configuredHandle] of configured) {
    if (configuredHandle?.trim().toLowerCase() === normalized) return planId
  }
  return SELF_SERVE_PLAN_IDS.has(normalized as PlanId) ? normalized as PlanId : 'free'
}

async function graphqlRequest<T>(
  url: string,
  accessToken: string,
  query: string,
  variables: Record<string, unknown>,
): Promise<T> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), SHOPIFY_PARTNER_TIMEOUT_MS)
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json',
        'x-shopify-access-token': accessToken,
      },
      body: JSON.stringify({ query, variables }),
      redirect: 'error',
      signal: controller.signal,
    })
    if (!response.ok) throw new Error(`GraphQL request failed with ${response.status}.`)
    const payload = await response.json() as { data?: T; errors?: Array<{ message?: string }> }
    if (!payload.data || payload.errors?.length) throw new Error(payload.errors?.[0]?.message || 'GraphQL response was incomplete.')
    return payload.data
  } finally {
    clearTimeout(timer)
  }
}

async function resolveShopGid(credentials: ShopifyInstallCredentials): Promise<string> {
  const data = await graphqlRequest<{ shop: { id: string } }>(
    `https://${credentials.shop}/admin/api/${SHOPIFY_API_VERSION}/graphql.json`,
    credentials.accessToken,
    'query NexezShopIdentity { shop { id } }',
    {},
  )
  if (!data.shop?.id) throw new Error('Shopify did not return a shop ID.')
  return data.shop.id
}

async function activeSubscription(shopGid: string): Promise<ActiveSubscription | null> {
  const organizationId = process.env.SHOPIFY_PARTNER_ORG_ID
  const accessToken = process.env.SHOPIFY_PARTNER_API_ACCESS_TOKEN
  const appId = process.env.SHOPIFY_APP_GID
  if (!organizationId || !accessToken || !appId) {
    throw new Error('Shopify Partner billing credentials are not configured.')
  }
  const data = await graphqlRequest<{ activeSubscription: ActiveSubscription | null }>(
    `https://partners.shopify.com/${encodeURIComponent(organizationId)}/api/${SHOPIFY_API_VERSION}/graphql.json`,
    accessToken,
    `query NexezActiveSubscription($appId: ID!, $shopId: ID!) {
      activeSubscription(appId: $appId, shopId: $shopId) {
        billingPeriod
        cancelAtEndOfCycle
        trialEndsAt
        currentBillingCycle { startTime endTime }
        items { handle description }
      }
    }`,
    { appId, shopId: shopGid },
  )
  return data.activeSubscription
}

async function writeOwnerPlan(
  admin: Pick<SupabaseClient, 'from'>,
  ownerId: string,
  planId: PlanId,
  verification: ActiveSubscription | null,
  planHandle: string | null,
): Promise<void> {
  const { data: existing, error: readError } = await admin
    .from('billing_subscriptions')
    .select('owner_id, stripe_subscription_id, status, account_origin')
    .eq('owner_id', ownerId)
    .maybeSingle<{
      owner_id: string
      stripe_subscription_id: string | null
      status: string | null
      account_origin: string | null
    }>()
  if (readError) throw new Error('Could not inspect the Nexez billing record.')
  if (
    existing?.stripe_subscription_id
    && !TERMINAL_STRIPE_SUBSCRIPTION_STATUSES.has(existing.status || '')
  ) {
    throw new Error('This Nexez account still has direct subscription billing and must be migrated before Shopify can manage its plan.')
  }

  const row = {
    owner_id: ownerId,
    plan_id: planId,
    status: 'active',
    trial_ends_at: verification?.trialEndsAt ?? null,
    account_origin: 'shopify',
    metadata: {
      source: 'shopify_app_pricing',
      shopify_plan_handle: planHandle,
      billing_period: verification?.billingPeriod ?? null,
      cancel_at_end_of_cycle: verification?.cancelAtEndOfCycle ?? false,
    },
  }
  const { error } = await admin.from('billing_subscriptions').upsert(row, { onConflict: 'owner_id' })
  if (error) throw new Error('Could not save the Shopify-managed Nexez plan.')
}

export async function verifyShopifyBilling(
  admin: Pick<SupabaseClient, 'from'>,
  install: ShopifyBillingInstall,
  credentials: ShopifyInstallCredentials,
  returnedPlanHandle?: string | null,
): Promise<ShopifyBillingVerification> {
  const shopGid = install.shop_gid || await resolveShopGid(credentials)
  const subscription = await activeSubscription(shopGid)
  const planHandle = subscription
    ? returnedPlanHandle?.trim() || install.shopify_plan_handle || subscription.items[0]?.handle || null
    : 'free'
  const planId = subscription ? planIdForHandle(planHandle) : 'free'
  const verifiedAt = new Date().toISOString()

  const { error } = await admin
    .from('shopify_installs')
    .update({
      shop_gid: shopGid,
      shopify_plan_handle: planHandle,
      shopify_billing_status: subscription ? 'active' : 'free',
      shopify_billing_verified_at: verifiedAt,
      updated_at: verifiedAt,
    })
    .eq('shop_domain', install.shop_domain)
    .is('uninstalled_at', null)
  if (error) throw new Error('Could not save Shopify billing verification.')

  if (install.owner_id) {
    await writeOwnerPlan(admin, install.owner_id, planId, subscription, planHandle)
  }

  return {
    provider: 'shopify',
    shop: install.shop_domain,
    pricingUrl: shopifyPricingUrl(install.shop_domain),
    planHandle,
    status: subscription ? 'active' : 'free',
    verifiedAt,
    activeSubscription: subscription,
    planId,
    shopGid,
  }
}

export async function getOwnerShopifyBillingContext(
  admin: Pick<SupabaseClient, 'from'>,
  ownerId: string,
  pendingShopCookie?: string,
): Promise<ShopifyBillingContext | null> {
  // Billing origin is durable. Uninstalling, relinking, or losing the handoff
  // cookie must not turn a Shopify account into a direct Stripe customer.
  const { data: billing, error: billingError } = await admin
    .from('billing_subscriptions')
    .select('account_origin')
    .eq('owner_id', ownerId)
    .maybeSingle<{ account_origin: string | null }>()
  if (billingError) throw new Error('Could not inspect account billing origin.')

  const { data, error } = await admin
    .from('shopify_installs')
    .select('shop_domain, shopify_plan_handle, shopify_billing_status, shopify_billing_verified_at')
    .eq('owner_id', ownerId)
    .is('uninstalled_at', null)
    .order('linked_at', { ascending: false })
    .limit(1)
    .maybeSingle<{
      shop_domain: string
      shopify_plan_handle: string | null
      shopify_billing_status: string | null
      shopify_billing_verified_at: string | null
    }>()
  if (error) throw new Error('Could not inspect Shopify billing ownership.')

  // The verified handoff precedes account and listing creation. It is already
  // proof of a Shopify entry, even while the install has no owner_id/page_id.
  const pendingShop = readPendingShop(pendingShopCookie)
  let pending = false
  if (!data && pendingShop) {
    const { data: install, error: pendingError } = await admin
      .from('shopify_installs')
      .select('shop_domain')
      .eq('shop_domain', pendingShop)
      .is('uninstalled_at', null)
      .maybeSingle<{ shop_domain: string }>()
    if (pendingError) throw new Error('Could not inspect the pending Shopify installation.')
    pending = Boolean(install)
  }
  if (!data && !pending && billing?.account_origin !== 'shopify') return null

  if (billing?.account_origin !== 'shopify') {
    await rememberShopifyBillingOwner(admin, ownerId)
  }

  if (!data) {
    return {
      provider: 'shopify',
      shop: pending ? pendingShop : null,
      // Finish linking before opening plans. Without a current install, the
      // connection page explains how to reopen/reinstall the Shopify app.
      pricingUrl: appUrl('/dashboard/shopify'),
      planHandle: null,
      status: 'connection_required',
      verifiedAt: null,
    }
  }
  return {
    provider: 'shopify',
    shop: data.shop_domain,
    pricingUrl: shopifyPricingUrl(data.shop_domain),
    planHandle: data.shopify_plan_handle,
    status: data.shopify_billing_status,
    verifiedAt: data.shopify_billing_verified_at,
  }
}

/** Call only after authenticated Shopify proof or server-side Shopify signup.
 * Preserve existing plans, Stripe identifiers, and subscription state. This
 * marker restricts future billing; it does not migrate or cancel subscriptions.
 */
export async function rememberShopifyBillingOwner(
  admin: Pick<SupabaseClient, 'from'>,
  ownerId: string,
): Promise<void> {
  const { error } = await admin.from('billing_subscriptions').upsert({
    owner_id: ownerId,
    account_origin: 'shopify',
  }, { onConflict: 'owner_id' })
  if (error) throw new Error('Could not retain Shopify billing ownership.')
}
