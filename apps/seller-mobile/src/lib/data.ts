import { supabase } from './supabase'
import { commissionPercentForPlan } from './billing'
import {
  BASIC_OWNER_PAGE_SELECT,
  OWNER_PAGE_SELECT,
  getOfferCount,
  getReadinessScore,
  pageDraftPayload,
} from './agent-page'
import type {
  ActivityItem,
  AgentNegotiation,
  AgentPage,
  AgentVisit,
  AnalyticsRollup,
  BillingSubscription,
  BuyerRequest,
  CheckoutEvent,
  CheckoutOrder,
  FinanceRollup,
  OrderReview,
  SellerOverview,
} from '@/src/types/nexez'

const OPEN_NEGOTIATION_STATUSES = ['negotiation', 'agreement_proposed', 'paused', 'held']

function negotiationNeedsActionCount(value: unknown): number | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const counts = (value as { counts?: unknown }).counts
  if (!counts || typeof counts !== 'object' || Array.isArray(counts)) return null
  const count = Number((counts as { needsAction?: unknown }).needsAction)
  return Number.isFinite(count) && count >= 0 ? Math.round(count) : null
}

function missingRelation(error: { code?: string | null; message?: string | null } | null | undefined) {
  if (!error) return false
  const code = error.code || ''
  const message = (error.message || '').toLowerCase()
  return code === '42P01' || code === 'PGRST205' || message.includes('does not exist') || message.includes('schema cache')
}

function eventLabel(event: CheckoutEvent) {
  switch (event.event_type) {
    case 'stripe_session_created':
      return 'Conversion started'
    case 'checkout_attempt':
      return 'Checkout intent'
    case 'directory_click':
      return 'Discovery click'
    case 'agent_page_view':
      return 'Listing visit'
    case 'stripe_error':
      return 'Payment issue'
    default:
      return event.event_type.replace(/_/g, ' ')
  }
}

export async function getCurrentUser() {
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser()
  if (error) throw error
  return user
}

export async function getSellerPages(userId: string): Promise<AgentPage[]> {
  const full = await supabase
    .from('pages')
    .select(OWNER_PAGE_SELECT)
    .eq('owner_id', userId)
    .order('created_at', { ascending: false })
    .returns<AgentPage[]>()

  if (!full.error) return full.data ?? []

  const basic = await supabase
    .from('pages')
    .select(BASIC_OWNER_PAGE_SELECT)
    .eq('owner_id', userId)
    .order('created_at', { ascending: false })
    .returns<AgentPage[]>()

  if (basic.error) throw basic.error
  return basic.data ?? []
}

export async function getSellerPage(id: string): Promise<AgentPage | null> {
  const full = await supabase.from('pages').select(OWNER_PAGE_SELECT).eq('id', id).maybeSingle<AgentPage>()
  if (!full.error) return full.data ?? null

  const basic = await supabase.from('pages').select(BASIC_OWNER_PAGE_SELECT).eq('id', id).maybeSingle<AgentPage>()
  if (basic.error) throw basic.error
  return basic.data ?? null
}

export async function getAgentVisits(userId: string, limit = 1000): Promise<AgentVisit[]> {
  const { data, error } = await supabase
    .from('agent_visits')
    .select('*')
    .eq('owner_id', userId)
    .order('created_at', { ascending: false })
    .limit(limit)
    .returns<AgentVisit[]>()
  if (error) {
    if (missingRelation(error)) return []
    throw error
  }
  return data ?? []
}

export async function getCheckoutEvents(userId: string, limit = 250): Promise<CheckoutEvent[]> {
  const { data, error } = await supabase
    .from('checkout_events')
    .select('*')
    .eq('owner_id', userId)
    .order('created_at', { ascending: false })
    .limit(limit)
    .returns<CheckoutEvent[]>()
  if (error) {
    if (missingRelation(error)) return []
    throw error
  }
  return data ?? []
}

export async function getAnalyticsRollup(from: Date): Promise<AnalyticsRollup> {
  const { data, error } = await supabase.rpc('nz_owner_analytics_rollup', {
    p_from: from.toISOString(),
    p_to: null,
    p_page_id: null,
    p_query: null,
    p_event_type: null,
    p_traffic: 'all',
  })
  if (error) throw error
  if (!data || typeof data !== 'object' || Number((data as { schemaVersion?: unknown }).schemaVersion) !== 1) {
    throw new Error('Analytics totals are not available yet.')
  }
  return data as AnalyticsRollup
}

export async function getFinanceRollup(from?: Date | null, fallbackCommissionBps = 0): Promise<FinanceRollup> {
  const { data, error } = await supabase.rpc('nz_owner_finance_rollup', {
    p_from: from?.toISOString() ?? null,
    p_to: null,
    p_fallback_commission_bps: Math.max(0, Math.min(1000, Math.round(fallbackCommissionBps))),
  })
  if (error) throw error
  if (!data || typeof data !== 'object' || Number((data as { schemaVersion?: unknown }).schemaVersion) !== 1) {
    throw new Error('Finance totals are not available yet.')
  }
  return data as FinanceRollup
}

export async function getNegotiations(userId: string, limit = 100): Promise<AgentNegotiation[]> {
  const { data, error } = await supabase
    .from('agent_negotiations')
    // Keep the encrypted continuation credential and payment-session internals
    // on the server. The seller UI only receives fields it renders or acts on.
    .select('id, page_id, owner_id, slug, offer_key, offer_name, offer_kind, buyer_agent, buyer_query, requested_terms, budget_text, timeline_text, contact, buyer_email, status, amount_cents, currency, metadata, decision_pending, settlement_state, escrow_mode, stripe_payment_intent_id, refunded_cents, created_at, updated_at')
    .eq('owner_id', userId)
    .order('created_at', { ascending: false })
    .limit(limit)
    .returns<AgentNegotiation[]>()
  if (error) {
    if (missingRelation(error)) return []
    throw error
  }
  return data ?? []
}

export type NegotiationMessage = {
  id: string
  negotiation_id: string
  role: 'buyer' | 'seller_llm' | 'seller_owner'
  content: Record<string, unknown> | null
  created_at: string
}

// Owner-readable negotiation thread (RLS: owners can read their negotiation messages).
export async function getNegotiationMessages(negotiationId: string): Promise<NegotiationMessage[]> {
  const { data, error } = await supabase
    .from('negotiation_messages')
    .select('id, negotiation_id, role, content, created_at')
    .eq('negotiation_id', negotiationId)
    .order('created_at', { ascending: true })
    .returns<NegotiationMessage[]>()
  if (error) {
    if (missingRelation(error)) return []
    throw error
  }
  return data ?? []
}

export async function getOrders(userId: string, limit = 100): Promise<CheckoutOrder[]> {
  const { data, error } = await supabase
    .from('checkout_orders')
    .select('id, owner_id, page_id, slug, offer_name, offer_key, amount_cents, currency, status, channel, stripe_livemode, refunded_cents, buyer_email, buyer_name, buyer_reference, created_at')
    .eq('owner_id', userId)
    .order('created_at', { ascending: false })
    .limit(limit)
    .returns<CheckoutOrder[]>()
  if (error) {
    if (missingRelation(error)) return []
    throw error
  }
  return data ?? []
}

export async function getReviews(userId: string, limit = 100): Promise<OrderReview[]> {
  const { data, error } = await supabase
    .from('order_reviews')
    .select('id, order_kind, order_id, owner_id, page_id, slug, offer_name, rating, title, body, tags, status, created_at')
    .eq('owner_id', userId)
    .order('created_at', { ascending: false })
    .limit(limit)
    .returns<OrderReview[]>()
  if (error) {
    if (missingRelation(error)) return []
    throw error
  }
  return data ?? []
}

export async function getBuyerRequests(userId: string, limit = 100): Promise<BuyerRequest[]> {
  const { data, error } = await supabase
    .from('order_requests')
    .select('id, order_kind, order_id, kind, status, message, buyer_email, slug, created_at')
    .eq('owner_id', userId)
    .order('created_at', { ascending: false })
    .limit(limit)
    .returns<BuyerRequest[]>()
  if (error) {
    if (missingRelation(error)) return []
    throw error
  }
  return data ?? []
}

// Owner resolves a buyer order request (RLS: owners can update their own requests).
export async function resolveOrderRequest(requestId: string, status: 'resolved' | 'declined') {
  const { error } = await supabase.from('order_requests').update({ status }).eq('id', requestId)
  if (error) throw error
}

export async function getBillingSubscription(userId: string): Promise<BillingSubscription | null> {
  const { data, error } = await supabase
    .from('billing_subscriptions')
    .select('*')
    .eq('owner_id', userId)
    .maybeSingle<BillingSubscription>()
  if (error) {
    if (missingRelation(error)) return null
    throw error
  }
  return data ?? null
}

export async function getOverviewMetrics(userId: string): Promise<SellerOverview> {
  const financeFrom = new Date(Date.now() - 30 * 86400000)
  const [pages, visits, events, negotiations, orders, reviews, negotiationReport, financeReport] = await Promise.all([
    getSellerPages(userId),
    getAgentVisits(userId, 1000),
    getCheckoutEvents(userId, 150),
    getNegotiations(userId, 100),
    getOrders(userId, 20),
    getReviews(userId, 20),
    supabase.rpc('nz_owner_negotiation_rollup', {
      p_from: null,
      p_to: null,
      p_page_id: null,
      p_query: null,
    }),
    getBillingSubscription(userId).then((billing) => supabase.rpc('nz_owner_finance_rollup', {
      p_from: financeFrom.toISOString(),
      p_to: null,
      p_fallback_commission_bps: Math.round(commissionPercentForPlan(billing?.plan_id) * 100),
    })),
  ])

  const agentVisits = visits.filter((visit) => visit.is_ai_agent).length
  const humanVisits = Math.max(0, visits.length - agentVisits)
  const conversions = events.filter((event) => event.event_type === 'stripe_session_created' && event.metadata?.dry_run !== true).length
  const checkoutAttempts = events.filter((event) => event.event_type === 'checkout_attempt' && event.metadata?.dry_run !== true).length
  const openNegotiations = negotiationNeedsActionCount(negotiationReport.data)
    ?? negotiations.filter((item) => OPEN_NEGOTIATION_STATUSES.includes(item.status)).length
  const averageReadiness = pages.length
    ? Math.round(pages.reduce((sum, page) => sum + getReadinessScore(page), 0) / pages.length)
    : 0

  const eventActivity: ActivityItem[] = events.slice(0, 6).map((event) => ({
    id: `event-${event.id}`,
    title: eventLabel(event),
    detail: `${event.offer_name || event.slug} on /${event.slug}`,
    tone: event.event_type === 'stripe_error' ? 'warn' : event.event_type === 'stripe_session_created' ? 'success' : 'info',
    createdAt: event.created_at,
  }))
  const orderActivity: ActivityItem[] = orders.slice(0, 4).map((order) => ({
    id: `order-${order.id}`,
    title: `Order ${order.status.replace(/_/g, ' ')}`,
    detail: order.offer_name || order.slug || 'Direct checkout',
    tone: order.status === 'paid' ? 'success' : order.status === 'disputed' ? 'warn' : 'muted',
    createdAt: order.created_at ?? '',
  }))
  const reviewActivity: ActivityItem[] = reviews.slice(0, 4).map((review) => ({
    id: `review-${review.id}`,
    title: `${review.rating} star review`,
    detail: review.title || review.offer_name || review.slug || 'Verified buyer review',
    tone: review.rating >= 4 ? 'success' : review.rating <= 2 ? 'warn' : 'info',
    createdAt: review.created_at,
  }))

  // Money hero: exact, settled 30-day finance in one currency. Fall back to the
  // dominant live order currency during additive migration rollout.
  const finance = financeReport.data && typeof financeReport.data === 'object'
    && Number((financeReport.data as { schemaVersion?: unknown }).schemaVersion) === 1
    ? financeReport.data as FinanceRollup
    : null
  const exactCurrency = finance?.currencies[0]
  const fallbackByCurrency = new Map<string, { gross: number; net: number }>()
  for (const order of orders) {
    if (order.stripe_livemode !== true || !['paid', 'refunded', 'disputed', 'dispute_won'].includes(order.status)) continue
    const code = (order.currency || 'usd').toLowerCase()
    const current = fallbackByCurrency.get(code) ?? { gross: 0, net: 0 }
    const refunded = order.status === 'disputed'
      ? order.amount_cents
      : order.status === 'refunded' && !order.refunded_cents
        ? order.amount_cents
        : Math.min(order.amount_cents, Math.max(0, order.refunded_cents || 0))
    current.gross += order.amount_cents
    current.net += Math.max(0, order.amount_cents - refunded)
    fallbackByCurrency.set(code, current)
  }
  const fallbackCurrency = [...fallbackByCurrency.entries()].sort((a, b) => b[1].gross - a[1].gross)[0]
  const financeCurrency = exactCurrency?.currency ?? fallbackCurrency?.[0] ?? 'usd'
  const pipelineCents = exactCurrency?.grossCents ?? fallbackCurrency?.[1].gross ?? 0
  const payoutsCents = exactCurrency?.netCents ?? fallbackCurrency?.[1].net ?? 0
  const DAY = 86400000
  const nowMs = Date.now()
  const spark = Array.from({ length: 10 }, (_, i) => {
    const start = new Date(nowMs - (9 - i) * DAY)
    start.setHours(0, 0, 0, 0)
    const s0 = start.getTime()
    return visits.filter((v) => v.is_ai_agent && new Date(v.created_at).getTime() >= s0 && new Date(v.created_at).getTime() < s0 + DAY).length
  })

  return {
    pages,
    publishedCount: pages.filter((page) => page.is_published).length,
    totalPages: pages.length,
    agentVisits,
    humanVisits,
    conversions,
    checkoutAttempts,
    openNegotiations,
    averageReadiness,
    readinessAlerts: pages.filter((page) => getReadinessScore(page) < 80).slice(0, 4),
    recentActivity: [...eventActivity, ...orderActivity, ...reviewActivity]
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, 8),
    pipelineCents,
    payoutsCents,
    financeCurrency,
    spark,
  }
}

export async function createPage(userId: string, input: Partial<AgentPage>): Promise<AgentPage> {
  const payload = {
    ...pageDraftPayload(input),
    owner_id: userId,
  }
  const { data, error } = await supabase.from('pages').insert(payload).select(OWNER_PAGE_SELECT).single<AgentPage>()
  if (error) throw error
  return data
}

export async function updatePage(id: string, input: Partial<AgentPage>): Promise<AgentPage> {
  const payload = pageDraftPayload(input)
  const { data, error } = await supabase.from('pages').update(payload).eq('id', id).select(OWNER_PAGE_SELECT).single<AgentPage>()
  if (error) throw error
  return data
}

export async function publishPage(id: string, isPublished: boolean) {
  const { error } = await supabase.from('pages').update({ is_published: isPublished }).eq('id', id)
  if (error) throw error
}

export function pageSignals(page: AgentPage, visits: AgentVisit[], events: CheckoutEvent[]) {
  const pageVisits = visits.filter((visit) => visit.page_id === page.id)
  const pageEvents = events.filter((event) => event.page_id === page.id)
  return {
    agentVisits: pageVisits.filter((visit) => visit.is_ai_agent).length,
    humanVisits: pageVisits.filter((visit) => !visit.is_ai_agent).length,
    offers: getOfferCount(page),
    conversions: pageEvents.filter((event) => event.event_type === 'stripe_session_created').length,
  }
}
