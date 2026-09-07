import 'server-only'

import { billingPlans, getPlanPriceId, isStripePriceId } from '../billing'
import { LIVE_SUBSCRIPTION_STATUSES } from '../stripe-billing'
import {
  buildCertificationChecks,
  buildConfigurationChecks,
  deriveDirectOrderLifecycleEvidence,
  deriveProtocolCredentialEvidence,
  deriveAdvancedCommerceEvidence,
  buildMarketplaceCurationCheck,
  buildOperationalChecks,
  isSettledProtocolOrder,
  isStripeCatalogSyncEvent,
  summarizeLaunchChecks,
  type LaunchConfigurationInput,
  type LaunchControlSnapshot,
  type LaunchIncident,
  type LaunchMetrics,
  type LaunchSourceAvailability,
} from '../launch-control'
import { APP_HOST, AGENT_RUNTIME_HOST, MARKETING_HOST } from '../site'
import { getStripeBillingReadiness } from './billing-readiness'
import { getMarketplaceCurationQueue } from './marketplace-curation'
import { hasSecretCryptoKey } from './secret-crypto'
import { hasReleaseCertificationSecret } from './release-certification-auth'
import { createAdminClient, hasSupabaseAdminEnv } from '../../utils/supabase/admin'
import { getOwnerPlanIds } from './plan'
import {
  isSupportIncident,
  projectSupportQueue,
  routeSupportQueue,
  type RoutedSupportTicket,
} from '../support-routing'
import {
  evaluateStripeWebhookEndpointReadiness,
  listStripeWebhookEndpoints,
  type StripeWebhookEndpointReadiness,
} from '../stripe-webhook-readiness'

type Source<T> = { available: true; rows: T[] } | { available: false; rows: T[] }

type StripeWebhookRow = { event_id: string; type: string | null; account: string | null; received_at: string }
type CheckoutEventRow = {
  id: string
  event_type: string
  slug: string
  offer_name: string
  created_at: string
  metadata: Record<string, unknown> | null
}
type OrderRow = {
  id: string
  status: string
  channel: string | null
  amount_cents: number
  refunded_cents: number | null
  offer_name: string | null
  slug: string | null
  created_at: string
  updated_at: string | null
  stripe_livemode: boolean | null
  resource_hold_id: string | null
  staged_settlement_agreement_id: string | null
  staged_settlement_obligation_id: string | null
}
type OrderEventRow = {
  order_id: string
  event_type: string
  metadata: Record<string, unknown>
}
type OrderFulfillmentRow = { order_id: string; status: string }
type OrderRequestRow = { id: string; order_id: string; kind: string; status: string }
type NegotiationRow = {
  id: string
  status: string
  decision_pending: boolean | null
  decision_requested_at: string | null
  stripe_payment_intent_id: string | null
  refunded_cents: number | null
  offer_name: string
  slug: string
  created_at: string
  updated_at: string | null
  stripe_livemode: boolean | null
}
type BillingRow = {
  owner_id: string
  status: string
  stripe_subscription_id: string | null
  stripe_connect_charges_enabled: boolean | null
  stripe_connect_payouts_enabled: boolean | null
  updated_at: string | null
}
type ShopifyRow = {
  shop_domain: string
  uninstalled_at: string | null
  catalog_sync_pending_at: string | null
  catalog_sync_attempted_at: string | null
  catalog_sync_attempts: number | null
  catalog_sync_error: string | null
  updated_at: string | null
}
type OutboundWebhookRow = {
  id: string
  url: string
  active: boolean
  last_delivery_at: string | null
  last_status: string | null
}
type SupportRow = {
  id: string
  owner_id: string
  subject: string
  priority: string
  status: string
  created_at: string
}
type RoutedSupportRow = RoutedSupportTicket<SupportRow>
type CheckoutSessionRow = {
  id: string
  channel: string
  status: string
  slug: string
  expires_at: string
  updated_at: string
}
type ResourcePoolRow = { id: string; status: string }
type ResourceHoldRow = { id: string; status: string }
type ResourceReservationRow = {
  id: string
  hold_id: string
  status: string
  checkout_order_id: string | null
}
type StagedSettlementAgreementRow = { id: string; status: string }
type StagedSettlementObligationRow = {
  id: string
  agreement_id: string
  status: string
  stripe_livemode: boolean | null
}

// Counts how many billing rows are a customer's current subscription, for the ops
// snapshot. Not an entitlement check: see subscriptionConfers() in ./plan for that.
const ACTIVE_SUBSCRIPTION_STATUSES = new Set<string>(LIVE_SUBSCRIPTION_STATUSES)
const TERMINAL_NEGOTIATION_STATUSES = new Set(['complete', 'refunded'])

export async function getLaunchControlSnapshot(): Promise<LaunchControlSnapshot> {
  const generatedAt = new Date().toISOString()
  const [configurationInput, marketplaceCuration, stripeWebhookReadiness] = await Promise.all([
    getConfigurationInput(),
    getMarketplaceCurationQueue(),
    verifyStripeWebhookEndpoints(),
  ])
  const configuration = buildConfigurationChecks(configurationInput)

  const sources = hasSupabaseAdminEnv()
    ? await loadOperationalSources(generatedAt)
    : emptySources()
  const availability = sourceAvailability(sources)
  const metrics = buildMetrics(sources, generatedAt, stripeWebhookReadiness)
  const operations = [
    ...buildOperationalChecks(metrics, availability, generatedAt),
    buildMarketplaceCurationCheck(marketplaceCuration),
  ]
  const certification = buildCertificationChecks(metrics, availability, configuration)
  const summary = summarizeLaunchChecks([...configuration, ...operations, ...certification])

  return {
    generatedAt,
    environment: {
      stripeMode: configurationInput.stripeMode,
      marketingHost: MARKETING_HOST,
      appHost: APP_HOST,
      agentHost: AGENT_RUNTIME_HOST,
    },
    configuration,
    operations,
    certification,
    summary,
    metrics,
    sources: availability,
    supportQueue: projectSupportQueue(sources.support.rows),
    incidents: buildIncidents(sources, generatedAt),
  }
}

async function getConfigurationInput(): Promise<LaunchConfigurationInput> {
  const readiness = getStripeBillingReadiness()
  const key = process.env.STRIPE_SECRET_KEY || ''
  const stripeMode: LaunchConfigurationInput['stripeMode'] = key.startsWith('sk_live_')
    ? 'live'
    : key.startsWith('sk_test_')
      ? 'test'
      : 'unknown'
  const plans = billingPlans.filter((plan) => plan.envVar && plan.id !== 'enterprise')
  const planPrices = plans.map((plan) => ({ plan, priceId: getPlanPriceId(plan) }))
  const priceIds = planPrices.map(({ priceId }) => priceId)
  const stripeCatalog = await verifyStripeCatalog(key, stripeMode, planPrices)

  return {
    supabasePublic: Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY),
    supabaseAdmin: readiness.serviceRoleConfigured,
    stripeMode,
    stripeWebhooks: readiness.webhookSecretConfigured,
    stripeConnectWebhook: Boolean(process.env.STRIPE_WEBHOOK_SECRET_CONNECT),
    priceIdsConfigured: priceIds.filter(Boolean).length,
    priceIdsExpected: plans.length,
    priceIdsInvalid: priceIds.filter((priceId) => priceId && !isStripePriceId(priceId)).length,
    stripeCatalogVerified: stripeCatalog.verified,
    stripeCatalogDetail: stripeCatalog.detail,
    actionApprovalSecret: Boolean(process.env.NEXEZ_ACTION_APPROVAL_SECRET && process.env.NEXEZ_ACTION_APPROVAL_SECRET.length >= 32),
    actionApprovalRequired: process.env.NEXEZ_REQUIRE_ACTION_APPROVAL_TOKEN === 'true',
    releaseCertificationSecret: hasReleaseCertificationSecret(),
    cronSecret: Boolean(process.env.CRON_SECRET),
    email: Boolean(process.env.RESEND_API_KEY && process.env.EMAIL_FROM),
    observability: Boolean(process.env.OBSERVABILITY_WEBHOOK_URL),
    integrationEncryption: hasSecretCryptoKey(),
    llm: Boolean(process.env.LLM_API_KEY),
    hostsAligned: MARKETING_HOST === 'nexez.ai' && APP_HOST === 'app.nexez.ai' && AGENT_RUNTIME_HOST === 'nexez.app',
  }
}

async function verifyStripeCatalog(
  secretKey: string,
  mode: LaunchConfigurationInput['stripeMode'],
  planPrices: Array<{
    plan: (typeof billingPlans)[number]
    priceId: string
  }>,
): Promise<{ verified: boolean | null; detail: string }> {
  if (!secretKey || mode === 'unknown') {
    return { verified: null, detail: 'Stripe key is unavailable, so catalog mode could not be verified.' }
  }
  if (planPrices.some(({ priceId }) => !isStripePriceId(priceId))) {
    return { verified: false, detail: 'One or more self-serve plans are missing a valid price_ identifier.' }
  }
  if (new Set(planPrices.map(({ priceId }) => priceId)).size !== planPrices.length) {
    return { verified: false, detail: 'Launch, Pro, and Scale must each use a distinct Stripe Price.' }
  }

  try {
    const expectedLive = mode === 'live'
    const results = await Promise.all(planPrices.map(async ({ plan, priceId }) => {
      const response = await fetch(`https://api.stripe.com/v1/prices/${encodeURIComponent(priceId)}`, {
        headers: { Authorization: `Bearer ${secretKey}` },
        cache: 'no-store',
        signal: AbortSignal.timeout(5_000),
      })
      if (!response.ok) return { ok: false }
      const body = await response.json() as {
        livemode?: boolean
        active?: boolean
        type?: string
        currency?: string
        unit_amount?: number | null
        recurring?: { interval?: string; interval_count?: number } | null
      }
      return {
        ok: body.livemode === expectedLive
          && body.active === true
          && body.type === 'recurring'
          && body.currency?.toLowerCase() === 'usd'
          && body.unit_amount === plan.monthlyPriceCents
          && body.recurring?.interval === 'month'
          && body.recurring?.interval_count === 1,
      }
    }))
    const verified = results.every((result) => result.ok)
    return {
      verified,
      detail: verified
        ? `${planPrices.length} distinct monthly USD Prices match the approved plan amounts and ${mode} Stripe key.`
        : 'At least one Price has the wrong mode, amount, currency, cadence, activity state, or identifier.',
    }
  } catch {
    return {
      verified: null,
      detail: 'Price IDs have valid format, but Stripe could not be reached for mode verification.',
    }
  }
}

/** The path every Nexez Stripe endpoint targets (platform + Connect destinations). */
const STRIPE_WEBHOOK_PATH = '/api/webhooks/stripe'

/**
 * Traffic-independent Stripe delivery health: ask Stripe directly whether the
 * app's webhook endpoints are enabled. Powers the idle-aware stripe-delivery
 * check - a quiet account with verified-enabled endpoints stays 'ready', and an
 * endpoint Stripe reports DISABLED blocks certification even with zero traffic.
 * Missing endpoints remain unverifiable because Stripe v2 event destinations
 * may not appear in the classic list. Any classic destination found for the
 * canonical hosts is evaluated for role, enabled state, and refund events.
 */
async function verifyStripeWebhookEndpoints(
  secretKey = process.env.STRIPE_SECRET_KEY || '',
): Promise<StripeWebhookEndpointReadiness | null> {
  if (!secretKey) return null
  try {
    const endpoints = await listStripeWebhookEndpoints(secretKey)
    if (!endpoints) return null
    return evaluateStripeWebhookEndpointReadiness(endpoints, {
      allowedHosts: [APP_HOST, AGENT_RUNTIME_HOST],
      expectedRoles: {
        account: Boolean(process.env.STRIPE_WEBHOOK_SECRET),
        connectedAccount: Boolean(process.env.STRIPE_WEBHOOK_SECRET_CONNECT),
      },
      webhookPath: STRIPE_WEBHOOK_PATH,
    })
  } catch {
    return null
  }
}

async function loadOperationalSources(nowIso: string) {
  const admin = createAdminClient()
  const since24h = new Date(Date.parse(nowIso) - 24 * 60 * 60_000).toISOString()

  const [
    stripeWebhooks,
    checkoutEvents,
    orders,
    orderEvents,
    orderFulfillments,
    orderRequests,
    negotiations,
    billing,
    shopify,
    outboundWebhooks,
    rawSupport,
    checkoutSessions,
    resourcePools,
    resourceHolds,
    resourceReservations,
    stagedSettlementAgreements,
    stagedSettlementObligations,
  ] = await Promise.all([
    safeSource<StripeWebhookRow>('stripe webhook ledger', async () => admin
      .from('stripe_webhook_events')
      .select('event_id,type,account,received_at')
      .order('received_at', { ascending: false })
      .limit(500)
      .returns<StripeWebhookRow[]>()),
    safeSource<CheckoutEventRow>('checkout telemetry', async () => admin
      .from('checkout_events')
      .select('id,event_type,slug,offer_name,created_at,metadata')
      .gte('created_at', since24h)
      .order('created_at', { ascending: false })
      .limit(500)
      .returns<CheckoutEventRow[]>()),
    safeSource<OrderRow>('order ledger', async () => admin
      .from('checkout_orders')
      .select('id,status,channel,amount_cents,refunded_cents,offer_name,slug,created_at,updated_at,stripe_livemode,resource_hold_id,staged_settlement_agreement_id,staged_settlement_obligation_id')
      .order('created_at', { ascending: false })
      .limit(1_000)
      .returns<OrderRow[]>()),
    safeSource<OrderEventRow>('order activity ledger', async () => admin
      .from('checkout_order_events')
      .select('order_id,event_type,metadata')
      .order('created_at', { ascending: false })
      .limit(5_000)
      .returns<OrderEventRow[]>()),
    safeSource<OrderFulfillmentRow>('order fulfillment ledger', async () => admin
      .from('checkout_order_fulfillments')
      .select('order_id,status')
      .order('updated_at', { ascending: false })
      .limit(2_000)
      .returns<OrderFulfillmentRow[]>()),
    safeSource<OrderRequestRow>('order request ledger', async () => admin
      .from('order_requests')
      .select('id,order_id,kind,status')
      .eq('order_kind', 'checkout')
      .order('created_at', { ascending: false })
      .limit(2_000)
      .returns<OrderRequestRow[]>()),
    safeSource<NegotiationRow>('negotiation ledger', async () => admin
      .from('agent_negotiations')
      .select('id,status,decision_pending,decision_requested_at,stripe_payment_intent_id,refunded_cents,offer_name,slug,created_at,updated_at,stripe_livemode')
      .order('created_at', { ascending: false })
      .limit(2_000)
      .returns<NegotiationRow[]>()),
    safeSource<BillingRow>('billing state', async () => admin
      .from('billing_subscriptions')
      .select('owner_id,status,stripe_subscription_id,stripe_connect_charges_enabled,stripe_connect_payouts_enabled,updated_at')
      .order('updated_at', { ascending: false })
      .limit(2_000)
      .returns<BillingRow[]>()),
    safeSource<ShopifyRow>('Shopify queue', async () => admin
      .from('shopify_installs')
      .select('shop_domain,uninstalled_at,catalog_sync_pending_at,catalog_sync_attempted_at,catalog_sync_attempts,catalog_sync_error,updated_at')
      .order('updated_at', { ascending: false })
      .limit(1_000)
      .returns<ShopifyRow[]>()),
    safeSource<OutboundWebhookRow>('seller webhooks', async () => admin
      .from('outbound_webhooks')
      .select('id,url,active,last_delivery_at,last_status')
      .order('created_at', { ascending: false })
      .limit(1_000)
      .returns<OutboundWebhookRow[]>()),
    safeSource<SupportRow>('support queue', async () => admin
      .from('support_tickets')
      .select('id,owner_id,subject,priority,status,created_at')
      .in('status', ['open', 'waiting_on_user', 'in_review'])
      .order('created_at', { ascending: false })
      .limit(500)
      .returns<SupportRow[]>()),
    safeSource<CheckoutSessionRow>('agent checkout sessions', async () => admin
      .from('checkout_sessions')
      .select('id,channel,status,slug,expires_at,updated_at')
      .in('status', ['pending', 'ready'])
      .order('expires_at', { ascending: true })
      .limit(1_000)
      .returns<CheckoutSessionRow[]>()),
    safeSource<ResourcePoolRow>('resource pool ledger', async () => admin
      .from('resource_pools')
      .select('id,status')
      .order('created_at', { ascending: false })
      .limit(2_000)
      .returns<ResourcePoolRow[]>()),
    safeSource<ResourceHoldRow>('resource hold ledger', async () => admin
      .from('resource_holds')
      .select('id,status')
      .order('created_at', { ascending: false })
      .limit(2_000)
      .returns<ResourceHoldRow[]>()),
    safeSource<ResourceReservationRow>('resource reservation ledger', async () => admin
      .from('resource_reservations')
      .select('id,hold_id,status,checkout_order_id')
      .order('created_at', { ascending: false })
      .limit(2_000)
      .returns<ResourceReservationRow[]>()),
    safeSource<StagedSettlementAgreementRow>('staged settlement agreement ledger', async () => admin
      .from('staged_settlement_agreements')
      .select('id,status')
      .order('created_at', { ascending: false })
      .limit(2_000)
      .returns<StagedSettlementAgreementRow[]>()),
    safeSource<StagedSettlementObligationRow>('staged settlement obligation ledger', async () => admin
      .from('staged_settlement_obligations')
      .select('id,agreement_id,status,stripe_livemode')
      .order('created_at', { ascending: false })
      .limit(5_000)
      .returns<StagedSettlementObligationRow[]>()),
  ])

  // Paid support routing is a live entitlement, never a client-controlled
  // ticket attribute. Batch-resolve every ticket owner now so a downgrade takes
  // effect immediately and direct metadata writes cannot jump the queue.
  const support = await routeCurrentSupportQueue(admin, rawSupport)

  return {
    stripeWebhooks,
    checkoutEvents,
    orders,
    orderEvents,
    orderFulfillments,
    orderRequests,
    negotiations,
    billing,
    shopify,
    outboundWebhooks,
    support,
    checkoutSessions,
    resourcePools,
    resourceHolds,
    resourceReservations,
    stagedSettlementAgreements,
    stagedSettlementObligations,
  }
}

async function routeCurrentSupportQueue(
  admin: ReturnType<typeof createAdminClient>,
  source: Source<SupportRow>,
): Promise<Source<RoutedSupportRow>> {
  if (!source.available) return { available: false, rows: [] }

  let plansByOwner: Record<string, string> = {}
  try {
    plansByOwner = await getOwnerPlanIds(admin, source.rows.map((ticket) => ticket.owner_id))
  } catch {
    // Fail closed: routeSupportQueue treats every missing owner as Free/standard.
  }

  return { available: true, rows: routeSupportQueue(source.rows, plansByOwner) }
}

async function safeSource<T>(
  label: string,
  query: () => PromiseLike<{ data: T[] | null; error: { message?: string } | null }>,
): Promise<Source<T>> {
  try {
    const { data, error } = await query()
    if (error) {
      console.warn(`[launch-control] ${label} unavailable:`, error.message || 'query failed')
      return { available: false, rows: [] }
    }
    return { available: true, rows: data ?? [] }
  } catch (error) {
    console.warn(`[launch-control] ${label} unavailable:`, error instanceof Error ? error.message : String(error))
    return { available: false, rows: [] }
  }
}

function emptySources() {
  const unavailable = <T>(): Source<T> => ({ available: false, rows: [] })
  return {
    stripeWebhooks: unavailable<StripeWebhookRow>(),
    checkoutEvents: unavailable<CheckoutEventRow>(),
    orders: unavailable<OrderRow>(),
    orderEvents: unavailable<OrderEventRow>(),
    orderFulfillments: unavailable<OrderFulfillmentRow>(),
    orderRequests: unavailable<OrderRequestRow>(),
    negotiations: unavailable<NegotiationRow>(),
    billing: unavailable<BillingRow>(),
    shopify: unavailable<ShopifyRow>(),
    outboundWebhooks: unavailable<OutboundWebhookRow>(),
    support: unavailable<RoutedSupportRow>(),
    checkoutSessions: unavailable<CheckoutSessionRow>(),
    resourcePools: unavailable<ResourcePoolRow>(),
    resourceHolds: unavailable<ResourceHoldRow>(),
    resourceReservations: unavailable<ResourceReservationRow>(),
    stagedSettlementAgreements: unavailable<StagedSettlementAgreementRow>(),
    stagedSettlementObligations: unavailable<StagedSettlementObligationRow>(),
  }
}

type OperationalSources = ReturnType<typeof emptySources>

function sourceAvailability(sources: OperationalSources): LaunchSourceAvailability {
  return {
    stripeWebhooks: sources.stripeWebhooks.available,
    checkoutEvents: sources.checkoutEvents.available,
    orders: sources.orders.available,
    orderEvents: sources.orderEvents.available,
    orderFulfillments: sources.orderFulfillments.available,
    orderRequests: sources.orderRequests.available,
    negotiations: sources.negotiations.available,
    billing: sources.billing.available,
    shopify: sources.shopify.available,
    outboundWebhooks: sources.outboundWebhooks.available,
    support: sources.support.available,
    checkoutSessions: sources.checkoutSessions.available,
    resourcePools: sources.resourcePools.available,
    resourceHolds: sources.resourceHolds.available,
    resourceReservations: sources.resourceReservations.available,
    stagedSettlementAgreements: sources.stagedSettlementAgreements.available,
    stagedSettlementObligations: sources.stagedSettlementObligations.available,
  }
}

function buildMetrics(
  sources: OperationalSources,
  nowIso: string,
  stripeWebhookReadiness: StripeWebhookEndpointReadiness | null,
): LaunchMetrics {
  const now = Date.parse(nowIso)
  const staleNegotiationBefore = now - 10 * 60_000
  const staleShopifyBefore = now - 15 * 60_000
  const stripeWebhooks = sources.stripeWebhooks.rows
  const checkoutEvents = sources.checkoutEvents.rows
  const orders = sources.orders.rows
  const liveOrders = orders.filter((row) => row.stripe_livemode === true)
  const provenProtocolOrders = orders.filter(isSettledProtocolOrder)
  const protocolCredentialEvidence = deriveProtocolCredentialEvidence({
    orders,
    events: sources.orderEvents.rows,
  })
  const negotiations = sources.negotiations.rows
  const liveNegotiations = negotiations.filter((row) => row.stripe_livemode === true)
  const billing = sources.billing.rows
  const shopify = sources.shopify.rows.filter((row) => !row.uninstalled_at)
  const outbound = sources.outboundWebhooks.rows.filter((row) => row.active)
  const advancedCommerce = deriveAdvancedCommerceEvidence({
    orders,
    resourcePools: sources.resourcePools.rows,
    resourceHolds: sources.resourceHolds.rows,
    resourceReservations: sources.resourceReservations.rows,
    stagedSettlementAgreements: sources.stagedSettlementAgreements.rows,
    stagedSettlementObligations: sources.stagedSettlementObligations.rows,
  })
  const directOrderLifecycles = deriveDirectOrderLifecycleEvidence({
    orders,
    events: sources.orderEvents.rows,
    fulfillments: sources.orderFulfillments.rows,
    requests: sources.orderRequests.rows,
  })

  return {
    stripeWebhookEvents: stripeWebhooks.length,
    latestStripeWebhookAt: stripeWebhooks[0]?.received_at ?? null,
    stripeWebhookEndpointsEnabled: stripeWebhookReadiness?.endpointsEnabled ?? null,
    stripeWebhookEndpointRolesCovered: stripeWebhookReadiness?.endpointRolesCovered ?? null,
    stripeWebhookRefundEventsCovered: stripeWebhookReadiness?.refundEventsCovered ?? null,
    stripeWebhookEndpointCount: stripeWebhookReadiness?.matchingEndpointCount ?? null,
    stripeWebhookMissingEndpointRoles: stripeWebhookReadiness?.missingEndpointRoles ?? [],
    stripeWebhookMissingRefundEvents: stripeWebhookReadiness?.missingRefundEvents ?? [],
    stripePriceWebhookEvents: stripeWebhooks.filter((row) => isStripeCatalogSyncEvent(row.type)).length,
    stripePriceSyncEvents: checkoutEvents.filter((row) => row.event_type === 'stripe_price_sync').length,
    checkoutStripeErrors24h: checkoutEvents.filter((row) => row.event_type === 'stripe_error').length,
    checkoutOrders: liveOrders.length,
    directOrders: liveOrders.filter((row) => row.channel == null || row.channel === 'agent_checkout').length,
    paidOrders: liveOrders.filter((row) => row.status === 'paid').length,
    refundedOrders: liveOrders.filter((row) => row.status === 'refunded' || Number(row.refunded_cents) > 0).length,
    disputedOrders: liveOrders.filter((row) => row.status === 'disputed').length,
    ...directOrderLifecycles,
    protocolOrders: provenProtocolOrders.filter((row) => row.stripe_livemode === true).length,
    sandboxProtocolOrders: provenProtocolOrders.filter((row) => row.stripe_livemode === false).length,
    acpLiveProtocolOrders: provenProtocolOrders.filter((row) => row.channel === 'acp' && row.stripe_livemode === true).length,
    ucpLiveProtocolOrders: provenProtocolOrders.filter((row) => row.channel === 'ucp' && row.stripe_livemode === true).length,
    acpSandboxProtocolOrders: provenProtocolOrders.filter((row) => row.channel === 'acp' && row.stripe_livemode === false).length,
    ucpSandboxProtocolOrders: provenProtocolOrders.filter((row) => row.channel === 'ucp' && row.stripe_livemode === false).length,
    ...protocolCredentialEvidence,
    negotiations: negotiations.length,
    pendingNegotiationDecisions: negotiations.filter((row) => row.decision_pending).length,
    staleNegotiationDecisions: negotiations.filter((row) => row.decision_pending && timestamp(row.decision_requested_at || row.updated_at || row.created_at) < staleNegotiationBefore).length,
    completedNegotiations: liveNegotiations.filter((row) => TERMINAL_NEGOTIATION_STATUSES.has(row.status)).length,
    heldNegotiations: liveNegotiations.filter((row) => row.status === 'held').length,
    paymentBackedNegotiations: liveNegotiations.filter((row) => Boolean(row.stripe_payment_intent_id) && ['held', 'complete', 'refunded', 'disputed'].includes(row.status)).length,
    refundedNegotiations: liveNegotiations.filter((row) => row.status === 'refunded' || Number(row.refunded_cents) > 0).length,
    activeSubscriptions: billing.filter((row) => ACTIVE_SUBSCRIPTION_STATUSES.has(row.status)).length,
    subscriptionRecords: billing.filter((row) => Boolean(row.stripe_subscription_id)).length,
    connectChargeReady: billing.filter((row) => row.stripe_connect_charges_enabled === true).length,
    connectPayoutReady: billing.filter((row) => row.stripe_connect_payouts_enabled === true).length,
    shopifyInstalls: shopify.length,
    shopifyPending: shopify.filter((row) => row.catalog_sync_pending_at).length,
    shopifyStale: shopify.filter((row) => row.catalog_sync_pending_at && timestamp(row.catalog_sync_pending_at) < staleShopifyBefore).length,
    shopifyErrors: shopify.filter((row) => row.catalog_sync_error).length,
    activeOutboundWebhooks: outbound.length,
    failedOutboundWebhooks: outbound.filter((row) => isFailedDelivery(row.last_status)).length,
    urgentSupportTickets: sources.support.rows.filter((row) => row.priority === 'urgent').length,
    expiredCheckoutSessions: sources.checkoutSessions.rows.filter((row) => timestamp(row.expires_at) < now).length,
    ...advancedCommerce,
  }
}

function buildIncidents(sources: OperationalSources, nowIso: string): LaunchIncident[] {
  const staleNegotiationBefore = Date.parse(nowIso) - 10 * 60_000
  const staleShopifyBefore = Date.parse(nowIso) - 15 * 60_000
  const incidents: LaunchIncident[] = []

  for (const row of sources.checkoutEvents.rows.filter((event) => event.event_type === 'stripe_error').slice(0, 6)) {
    incidents.push({
      id: `checkout-${row.id}`,
      title: 'Stripe checkout error',
      detail: `${row.offer_name || 'Offer'} on /${row.slug}${messageFromMetadata(row.metadata)}`,
      occurredAt: row.created_at,
      status: 'blocked',
      href: '/dashboard/finance',
    })
  }
  for (const row of sources.negotiations.rows.filter((item) => item.decision_pending && timestamp(item.decision_requested_at || item.updated_at || item.created_at) < staleNegotiationBefore).slice(0, 6)) {
    incidents.push({
      id: `negotiation-${row.id}`,
      title: 'Negotiation decision is stale',
      detail: `${row.offer_name} on /${row.slug} has exceeded the worker backstop window.`,
      occurredAt: row.decision_requested_at || row.updated_at || row.created_at,
      status: 'blocked',
      href: '/dashboard/negotiations',
    })
  }
  for (const row of sources.shopify.rows.filter((item) => item.catalog_sync_error).slice(0, 6)) {
    incidents.push({
      id: `shopify-${row.shop_domain}`,
      title: 'Shopify catalog sync failed',
      detail: `${row.shop_domain}: ${cleanText(row.catalog_sync_error || 'Reconnect Shopify to resume sync.')}`,
      occurredAt: row.updated_at,
      status: 'blocked',
      href: '/dashboard/shopify',
    })
  }
  for (const row of sources.shopify.rows.filter((item) => (
    !item.catalog_sync_error
    && item.catalog_sync_pending_at
    && timestamp(item.catalog_sync_pending_at) < staleShopifyBefore
  )).slice(0, 6)) {
    incidents.push({
      id: `shopify-stale-${row.shop_domain}`,
      title: 'Shopify catalog sync is stale',
      detail: `${row.shop_domain} has exceeded the catalog worker backstop window.`,
      occurredAt: row.catalog_sync_pending_at,
      status: 'attention',
      href: '/dashboard/shopify',
    })
  }
  for (const row of sources.outboundWebhooks.rows.filter((item) => item.active && isFailedDelivery(item.last_status)).slice(0, 4)) {
    incidents.push({
      id: `outbound-${row.id}`,
      title: 'Seller webhook rejected delivery',
      detail: `${safeHost(row.url)} last reported ${cleanText(row.last_status || 'a failed status')}.`,
      occurredAt: row.last_delivery_at,
      status: 'attention',
      href: '/dashboard/tools',
    })
  }
  for (const row of sources.support.rows.filter(isSupportIncident).slice(0, 4)) {
    const paidPriority = row.supportService.priorityRouting
    incidents.push({
      id: `support-${row.id}`,
      title: paidPriority ? 'Priority support ticket' : 'Urgent support ticket',
      detail: `${paidPriority ? 'Priority service' : 'Standard service'} · ${cleanText(row.subject)}`,
      occurredAt: row.created_at,
      status: 'attention',
      href: `/admin/support/${row.id}`,
    })
  }

  return incidents
    .sort((a, b) => timestamp(b.occurredAt) - timestamp(a.occurredAt))
    .slice(0, 12)
}

function messageFromMetadata(metadata: Record<string, unknown> | null) {
  const message = typeof metadata?.message === 'string' ? cleanText(metadata.message) : ''
  return message ? `: ${message}` : '.'
}

function cleanText(value: string) {
  return value.replace(/\s+/g, ' ').trim().slice(0, 220)
}

function safeHost(value: string) {
  try {
    return new URL(value).host
  } catch {
    return 'Configured endpoint'
  }
}

function isFailedDelivery(status: string | null) {
  if (!status) return false
  const code = Number(status.match(/\d{3}/)?.[0])
  if (Number.isFinite(code)) return code < 200 || code >= 300
  return /fail|error|reject|timeout/i.test(status)
}

function timestamp(value: string | null) {
  const parsed = value ? Date.parse(value) : Number.NaN
  return Number.isFinite(parsed) ? parsed : 0
}
