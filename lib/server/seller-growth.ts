import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { PlanId } from '../billing'

export type SellerGrowthInviteStatus =
  | 'pending'
  | 'claimed'
  | 'qualified'
  | 'expired'
  | 'revoked'

export type SellerGrowthInviteView = {
  id: string
  email: string
  status: SellerGrowthInviteStatus
  expiresAt: string
  acceptedAt: string | null
  qualifiedAt: string | null
  deliveryCount: number
  lastSentAt: string | null
}

export type SellerGrowthCampaignView = {
  id: string
  key: string
  name: string
  status: 'draft' | 'active' | 'paused' | 'ended'
  grantPlanId: PlanId
  grantDurationDays: number
  inviteSlots: number
  inviteExpiresDays: number
  signupClosesAt: string | null
  enrollmentMode: 'open' | 'invite_only'
}

export type SellerGrowthGrantView = {
  id: string
  planId: PlanId
  source: 'welcome' | 'referral' | 'admin'
  startsAt: string
  endsAt: string
  fallbackPageId: string | null
}

export type SellerGrowthQualification = {
  campaignOpen: boolean
  emailVerified: boolean
  publishedListing: boolean
  identityVerified: boolean
  identityMethods: Array<'website' | 'custom_domain' | 'shopify' | 'stripe'>
  campaignAccess: boolean
  accessSource: 'new_business' | 'cohort' | 'invitation' | 'none'
  missingGates: Array<'campaign_access' | 'email' | 'published_listing' | 'identity'>
  completedGates: number
  totalGates: 4
  eligible: boolean
}

export type SellerGrowthPageOption = {
  id: string
  name: string
  slug: string
  isPublished: boolean
  websiteUrl: string | null
  websiteVerified: boolean
  customDomainVerified: boolean
}

export type SellerGrowthState = {
  asOf: string
  available: boolean
  campaign: SellerGrowthCampaignView | null
  grant: SellerGrowthGrantView | null
  qualification: SellerGrowthQualification
  invites: SellerGrowthInviteView[]
  slotsUsed: number
  slotsAvailable: number
  pages: SellerGrowthPageOption[]
  businessName: string
}

type AuthFacts = {
  createdAt?: string | null
  emailConfirmedAt?: string | null
}

type CampaignRow = {
  id: string
  campaign_key: string
  name: string
  status: SellerGrowthCampaignView['status']
  grant_plan_id: PlanId
  grant_duration_days: number
  invite_slots: number
  invite_expires_days: number
  starts_at: string
  signup_closes_at: string | null
  enrollment_mode: SellerGrowthCampaignView['enrollmentMode']
}

type GrantRow = {
  id: string
  campaign_id: string
  plan_id: PlanId
  source: SellerGrowthGrantView['source']
  starts_at: string
  ends_at: string
  fallback_page_id: string | null
}

type InviteRow = {
  id: string
  campaign_id: string
  invitee_email: string
  status: SellerGrowthInviteStatus
  expires_at: string
  accepted_at: string | null
  qualified_at: string | null
  delivery_count: number
  last_sent_at: string | null
  invite_kind: 'referral' | 'cohort'
}

type PageRow = {
  id: string
  name: string | null
  slug: string | null
  is_published: boolean | null
  website_verified_at: string | null
  custom_domain_verified: string | null
  website_url: string | null
}

const emptyQualification = (): SellerGrowthQualification => ({
  campaignOpen: false,
  emailVerified: false,
  publishedListing: false,
  identityVerified: false,
  identityMethods: [],
  campaignAccess: false,
  accessSource: 'none',
  missingGates: ['campaign_access', 'email', 'published_listing', 'identity'],
  completedGates: 0,
  totalGates: 4,
  eligible: false,
})

export function emptySellerGrowthState(): SellerGrowthState {
  return {
    asOf: new Date().toISOString(),
    available: false,
    campaign: null,
    grant: null,
    qualification: emptyQualification(),
    invites: [],
    slotsUsed: 0,
    slotsAvailable: 0,
    pages: [],
    businessName: 'Your business',
  }
}

function isLiveGrant(row: GrantRow | null | undefined, nowMs: number): row is GrantRow {
  // The query already scopes status=active; keep the temporal guard here as a
  // second check before a grant is exposed as an entitlement.
  return Boolean(
    row
      && Date.parse(row.starts_at) <= nowMs
      && Date.parse(row.ends_at) > nowMs,
  )
}

function campaignView(row: CampaignRow): SellerGrowthCampaignView {
  return {
    id: row.id,
    key: row.campaign_key,
    name: row.name,
    status: row.status,
    grantPlanId: row.grant_plan_id,
    grantDurationDays: row.grant_duration_days,
    inviteSlots: row.invite_slots,
    inviteExpiresDays: row.invite_expires_days,
    signupClosesAt: row.signup_closes_at,
    enrollmentMode: row.enrollment_mode,
  }
}

function grantView(row: GrantRow): SellerGrowthGrantView {
  return {
    id: row.id,
    planId: row.plan_id,
    source: row.source,
    startsAt: row.starts_at,
    endsAt: row.ends_at,
    fallbackPageId: row.fallback_page_id,
  }
}

function inviteView(row: InviteRow): SellerGrowthInviteView {
  return {
    id: row.id,
    email: row.invitee_email,
    status: row.status,
    expiresAt: row.expires_at,
    acceptedAt: row.accepted_at,
    qualifiedAt: row.qualified_at,
    deliveryCount: row.delivery_count,
    lastSentAt: row.last_sent_at,
  }
}

/**
 * Build the owner-safe growth-campaign DTO used by dashboard and billing UI.
 * Token hashes, audit metadata, identity keys, and other owners never leave the
 * service-role boundary.
 */
export async function getSellerGrowthState(
  admin: Pick<SupabaseClient, 'from' | 'rpc'>,
  ownerId: string,
  authFacts: AuthFacts = {},
): Promise<SellerGrowthState> {
  const empty = emptySellerGrowthState()
  if (!ownerId) return empty

  // Best effort: catches an owner whose email was confirmed after their listing
  // and business verification were already complete. Missing migrations degrade
  // to the ordinary Free experience instead of breaking the dashboard.
  try {
    await admin.rpc('refresh_seller_growth_grant', { p_owner: ownerId })
  } catch {
    // Continue with an unavailable campaign DTO below.
  }

  const now = new Date()
  const nowIso = now.toISOString()
  const [activeCampaignRes, grantRes, pagesRes, billingRes, shopifyRes] = await Promise.all([
    admin
      .from('seller_growth_campaigns')
      .select('id, campaign_key, name, status, grant_plan_id, grant_duration_days, invite_slots, invite_expires_days, starts_at, signup_closes_at, enrollment_mode')
      .eq('is_public_launch', true)
      .eq('status', 'active')
      .lte('starts_at', nowIso)
      .or(`signup_closes_at.is.null,signup_closes_at.gte.${nowIso}`)
      .order('starts_at', { ascending: false })
      .order('id', { ascending: true })
      .limit(1)
      .maybeSingle<CampaignRow>(),
    admin
      .from('promotional_plan_grants')
      .select('id, campaign_id, plan_id, source, starts_at, ends_at, fallback_page_id')
      .eq('owner_id', ownerId)
      .eq('status', 'active')
      .lte('starts_at', nowIso)
      .gt('ends_at', nowIso)
      .order('ends_at', { ascending: false })
      .limit(1)
      .maybeSingle<GrantRow>(),
    admin
      .from('pages')
      .select('id, name, slug, is_published, website_url, website_verified_at, custom_domain_verified')
      .eq('owner_id', ownerId)
      .order('created_at', { ascending: true })
      .returns<PageRow[]>(),
    admin
      .from('billing_subscriptions')
      .select('stripe_connect_charges_enabled')
      .eq('owner_id', ownerId)
      .maybeSingle<{ stripe_connect_charges_enabled: boolean | null }>(),
    admin
      .from('shopify_installs')
      .select('shop_domain')
      .eq('owner_id', ownerId)
      .is('uninstalled_at', null)
      .limit(1),
  ])

  const liveGrant = isLiveGrant(grantRes.data, now.getTime()) ? grantRes.data : null
  let campaign = activeCampaignRes.data ?? null

  if (liveGrant && campaign?.id !== liveGrant.campaign_id) {
    const { data } = await admin
      .from('seller_growth_campaigns')
      .select('id, campaign_key, name, status, grant_plan_id, grant_duration_days, invite_slots, invite_expires_days, starts_at, signup_closes_at, enrollment_mode')
      .eq('id', liveGrant.campaign_id)
      .maybeSingle<CampaignRow>()
    campaign = data ?? campaign
  }

  if (!campaign) return { ...empty, grant: liveGrant ? grantView(liveGrant) : null }

  const [sentInvitesRes, acceptedInviteRes] = await Promise.all([
    admin
      .from('seller_growth_invites')
      .select('id, campaign_id, invitee_email, status, expires_at, accepted_at, qualified_at, delivery_count, last_sent_at, invite_kind')
      .eq('campaign_id', campaign.id)
      .eq('inviter_owner_id', ownerId)
      .order('created_at', { ascending: true })
      .returns<InviteRow[]>(),
    admin
      .from('seller_growth_invites')
      .select('id, campaign_id, invitee_email, status, expires_at, accepted_at, qualified_at, delivery_count, last_sent_at, invite_kind')
      .eq('campaign_id', campaign.id)
      .eq('accepted_by_owner_id', ownerId)
      .in('status', ['claimed', 'qualified'])
      .limit(1)
      .maybeSingle<InviteRow>(),
  ])

  const pages = pagesRes.data ?? []
  const identityMethods: SellerGrowthQualification['identityMethods'] = []
  if (pages.some((page) => Boolean(page.website_verified_at))) identityMethods.push('website')
  if (pages.some((page) => Boolean(page.custom_domain_verified))) identityMethods.push('custom_domain')
  if ((shopifyRes.data ?? []).length > 0) identityMethods.push('shopify')
  if (billingRes.data?.stripe_connect_charges_enabled) identityMethods.push('stripe')

  const accountCreatedMs = authFacts.createdAt ? Date.parse(authFacts.createdAt) : Number.NaN
  const startsMs = Date.parse(campaign.starts_at)
  const closesMs = campaign.signup_closes_at ? Date.parse(campaign.signup_closes_at) : Number.POSITIVE_INFINITY
  const isNewBusiness =
    Number.isFinite(accountCreatedMs)
    && accountCreatedMs >= startsMs
    && accountCreatedMs <= closesMs
  const wasInvited = Boolean(acceptedInviteRes.data)
  const campaignOpen =
    campaign.status === 'active'
    && startsMs <= now.getTime()
    && (!campaign.signup_closes_at || closesMs >= now.getTime())
  const campaignAccess = wasInvited || (campaign.enrollment_mode === 'open' && isNewBusiness)
  const acceptedInviteKind = acceptedInviteRes.data?.invite_kind
  const emailVerified = Boolean(authFacts.emailConfirmedAt)
  const publishedListing = pages.some((page) => page.is_published === true)
  const identityVerified = identityMethods.length > 0
  const missingGates: SellerGrowthQualification['missingGates'] = []
  if (!campaignAccess) missingGates.push('campaign_access')
  if (!emailVerified) missingGates.push('email')
  if (!publishedListing) missingGates.push('published_listing')
  if (!identityVerified) missingGates.push('identity')
  const qualification: SellerGrowthQualification = {
    campaignOpen,
    emailVerified,
    publishedListing,
    identityVerified,
    identityMethods,
    campaignAccess,
    accessSource: wasInvited
      ? acceptedInviteKind === 'cohort' ? 'cohort' : 'invitation'
      : campaign.enrollment_mode === 'open' && isNewBusiness
        ? 'new_business'
        : 'none',
    missingGates,
    completedGates: 4 - missingGates.length,
    totalGates: 4,
    eligible: campaignOpen
      && campaignAccess
      && emailVerified
      && publishedListing
      && identityVerified,
  }

  const invites = (sentInvitesRes.data ?? []).map(inviteView)
  const slotsUsed = invites.filter((invite) => (
    invite.status === 'claimed'
    || invite.status === 'qualified'
    || (invite.status === 'pending' && Date.parse(invite.expiresAt) > now.getTime())
  )).length
  const pageOptions = pages.map((page) => ({
    id: page.id,
    name: page.name || page.slug || 'Untitled listing',
    slug: page.slug || '',
    isPublished: page.is_published === true,
    websiteUrl: page.website_url,
    websiteVerified: Boolean(page.website_verified_at),
    customDomainVerified: Boolean(page.custom_domain_verified),
  }))

  return {
    asOf: nowIso,
    available: true,
    campaign: campaignView(campaign),
    grant: liveGrant ? grantView(liveGrant) : null,
    qualification,
    invites,
    slotsUsed,
    slotsAvailable: Math.max(0, campaign.invite_slots - slotsUsed),
    pages: pageOptions,
    businessName: pageOptions[0]?.name || 'Your business',
  }
}
