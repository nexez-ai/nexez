'use client'

import { useEffect, useMemo, useState } from 'react'
import {
  Bot,
  Check,
  Code2,
  Copy,
  ExternalLink,
  Globe2,
  History,
  Loader2,
  Save,
  Settings,
  ShieldCheck,
  X,
} from 'lucide-react'
import {
  AGENT_READY_STANDARD,
  AgentPage,
  OWNER_PAGE_SELECT,
  PreferredContact,
  getBaseUrl,
  getCertification,
  normalizeSlug,
} from '../../../../lib/agent-page'
import { normalizeDomainPath, validateDomainPath } from '../../../../lib/custom-domain'
import type { CustomDomainClaim } from '../../../../lib/custom-domain-claim'
import { removeManagedCustomDomain } from '../../../../lib/custom-domain-cleanup'
import { normalizeBranding } from '../../../../lib/branding'
import { deploymentChangeAt, summarizeDeployments } from '../../../../lib/deployments'
import { buildAgentPagePayload, getAgentJsonPath } from '../../../../lib/agent-manifest'
import { createClient } from '../../../../utils/supabase/client'
import { agentRuntimeUrl } from '../../../../lib/site'
import { CredentialsManager } from '../../../../components/CredentialsManager'
import { IntegrationsPanel } from '../../../../components/settings/IntegrationsPanel'
import { WebsitePanel } from '../../../../components/settings/WebsitePanel'
import { WebsiteBaselinePanel } from '../../../../components/settings/WebsiteBaselinePanel'
import { BrandingPanel } from '../../../../components/settings/BrandingPanel'
import { DomainConnectionPanel } from '../../../../components/settings/DomainConnectionPanel'
import { AvailabilityPanel, stripAvailabilityMarker } from '../../../../components/settings/AvailabilityPanel'
import {
  OutboundWebhooksPanel,
  type OutboundEndpoint,
  type OutboundTestResult,
} from '../../../../components/settings/OutboundWebhooksPanel'
import { planAllows } from '../../../../lib/billing'
import { PlanBadge, PlanGate } from '../../../../components/billing/PlanGate'
import { usePlan } from '../../../../components/billing/PlanProvider'
import { SUPPORTED_CURRENCIES, normalizeCurrency } from '../../../../lib/currency'
import {
  SettingRow,
  SettingsNav,
  SettingsSection,
  SettingsSwitch,
  StatusPill,
} from '../../../../components/settings/SettingsPrimitives'
import { SurfaceHeader, surfaceActionClass } from '../../../../components/dashboard/SurfacePrimitives'
import { mutateTeamApproval } from '../../../../lib/team-approval-client'
import { agentMemoryCopy } from '../../../../lib/agent-memory-copy'
import {
  publicIdentifierDatabaseMessage,
  validatePublicIdentifier,
} from '../../../../lib/public-identifier'
import {
  PublicIdentifierFeedback,
  usePublicIdentifierAvailability,
} from '../../../../components/public-identifier/PublicIdentifierFeedback'

type PageProps = {
  params: Promise<{ id: string }>
}

const SETTINGS_SECTIONS = [
  { id: 'general', label: 'General', icon: Settings },
  { id: 'brand-domain', label: 'Brand & domain', icon: Globe2 },
  { id: 'agent-experience', label: 'Agent experience', icon: Bot },
  { id: 'commerce-integrations', label: 'Commerce & integrations', icon: ExternalLink },
  { id: 'trust-verification', label: 'Trust & verification', icon: ShieldCheck },
  { id: 'team-history', label: 'Team & history', icon: History },
  { id: 'developer', label: 'Developer', icon: Code2 },
] as const

export default function PageSettings({ params }: PageProps) {
  // The EFFECTIVE plan governing this page's feature gates is the page OWNER's, not
  // the logged-in user's - so an editor-collaborator sees the owner's entitlements.
  // Falls back to the logged-in user's plan until the settings-context loads.
  const ownPlan = usePlan()
  const [plan, setPlan] = useState(ownPlan)
  const [pageRole, setPageRole] = useState<'owner' | 'editor' | 'viewer'>('owner')
  const [id, setId] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState('')
  const [page, setPage] = useState<AgentPage | null>(null)
  const [name, setName] = useState('')
  const [slug, setSlug] = useState('')
  const [websiteUrl, setWebsiteUrl] = useState('')
  const [ctaUrl, setCtaUrl] = useState('')
  const [ctaLabel, setCtaLabel] = useState('')
  const [contactEmail, setContactEmail] = useState('')
  const [preferredContact, setPreferredContact] = useState<'' | PreferredContact>('')
  const [isPublished, setIsPublished] = useState(false)
  const [customDomain, setCustomDomain] = useState('')
  const [domainPath, setDomainPath] = useState('/')
  const [brandName, setBrandName] = useState('')
  const [accentColor, setAccentColor] = useState('')
  const [logoUrl, setLogoUrl] = useState('')
  const [hideNexezBadge, setHideNexezBadge] = useState(false)
  const [currency, setCurrency] = useState('usd')
  const [domainProvisioning, setDomainProvisioning] = useState(false)
  const [domainClaim, setDomainClaim] = useState<CustomDomainClaim | null>(null)
  const [domainClaimStatusAvailable, setDomainClaimStatusAvailable] = useState(false)
  const [domainStatus, setDomainStatus] = useState<
    | null
    | {
        state: string
        label: string
        detail: string
        providerConfigured: boolean
        ownershipVerified: boolean
        verifiedAt?: string | null
        verificationMethod: 'cname' | 'txt' | 'unknown'
        legacyTxtBlocksCname: boolean
        requiredRecords: Array<{ type: string; name?: string; value?: string }>
        routingRecords: Array<{ type: string; name?: string; value?: string }>
      }
  >(null)
  const [preferOriginalSite, setPreferOriginalSite] = useState(false)
  const [industry, setIndustry] = useState('')
  const [copied, setCopied] = useState('')

  // Phase 3: Per-page outbound webhooks - now first-class (url + optional secret per endpoint)
  const [outboundEndpoints, setOutboundEndpoints] = useState<OutboundEndpoint[]>([])
  const [testResults, setTestResults] = useState<Record<string, OutboundTestResult>>({})

  // Real recent fires (from checkout_events) for visibility of outbound value
  const [recentOutboundFires, setRecentOutboundFires] = useState<any[]>([])

  // Google Calendar availability state.
  const [googleCalendarId, setGoogleCalendarId] = useState('')
  const [availabilityNote, setAvailabilityNote] = useState('')

  // Phase 5: Real custom domain verification state (persisted on page)
  const [domainVerificationToken, setDomainVerificationToken] = useState('')
  const [domainVerified, setDomainVerified] = useState(false)
  const [verifyingDomain, setVerifyingDomain] = useState(false)

  // Deeper Calendly: per-page webhook secret for real signature verification (beyond demo headers)
  const [calendlyWebhookSecret, setCalendlyWebhookSecret] = useState('')
  // Calendly write-side connection: a stored (encrypted) PAT. Write-only - the
  // raw token is never loaded back; we only know whether one is connected.

  // Verification details for trust score
  const [verificationDetails, setVerificationDetails] = useState<any>({})

  // Dedicated clean state for Agent Memory (fix audit hacky reuse of verificationDetails)
  const [memoryNotes, setMemoryNotes] = useState('')

  // LLM opt-in flag state (clean, for UI refresh after toggle)
  const [llmOptIn, setLlmOptIn] = useState(false)
  const [llmSaving, setLlmSaving] = useState(false)
  const [mcpSaving, setMcpSaving] = useState(false)
  const [activeSection, setActiveSection] = useState<(typeof SETTINGS_SECTIONS)[number]['id']>('general')

  useEffect(() => {
    params.then(({ id }) => setId(id))
  }, [params])

  useEffect(() => {
    if (!id) return
    loadPage(id)
  }, [id])

  useEffect(() => {
    if (loading || !page) return

    const sectionIds = SETTINGS_SECTIONS.map((section) => section.id)
    const syncFromHash = () => {
      const next = window.location.hash.slice(1)
      if (sectionIds.includes(next as (typeof sectionIds)[number])) {
        setActiveSection(next as (typeof SETTINGS_SECTIONS)[number]['id'])
      } else if (!next) {
        setActiveSection('general')
      }
    }

    syncFromHash()
    window.addEventListener('hashchange', syncFromHash)
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((entry) => entry.isIntersecting)
          .sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0]
        if (visible?.target.id) {
          setActiveSection(visible.target.id as (typeof SETTINGS_SECTIONS)[number]['id'])
        }
      },
      { rootMargin: '-18% 0px -68% 0px', threshold: [0, 0.15, 0.5] },
    )

    for (const sectionId of sectionIds) {
      const element = document.getElementById(sectionId)
      if (element) observer.observe(element)
    }

    return () => {
      window.removeEventListener('hashchange', syncFromHash)
      observer.disconnect()
    }
  }, [loading, page])

  const cleanSlug = normalizeSlug(slug || name)
  const slugValidation = validatePublicIdentifier(cleanSlug, { current: page?.slug })
  const slugAvailability = usePublicIdentifierAvailability({
    namespace: 'page_slug',
    value: cleanSlug,
    subjectId: id,
    enabled: Boolean(page && id && slugValidation.ok),
  })
  const domainPathValidation = validateDomainPath(domainPath)
  const publicUrl = `${getBaseUrl()}/${cleanSlug || page?.slug || ''}`
  const agentJsonUrl = `${getBaseUrl()}${getAgentJsonPath(cleanSlug || page?.slug || '')}`
  const searchUrl = `${getBaseUrl()}/api/agent-search?q=${encodeURIComponent(name || page?.name || 'service')}`
  const certification = page ? getCertification(page) : null

  const manifestPreview = useMemo(() => {
    if (!page) return '{}'
    return JSON.stringify(
      buildAgentPagePayload({
        ...page,
        name,
        slug: cleanSlug || page.slug,
        website_url: websiteUrl || null,
        cta_url: ctaUrl || websiteUrl || null,
        cta_label: ctaLabel || 'Visit website',
        contact_email: contactEmail || null,
        is_published: isPublished,
      }),
      null,
      2,
    )
  }, [cleanSlug, contactEmail, ctaLabel, ctaUrl, isPublished, name, page, websiteUrl])

  async function loadPage(pageId: string) {
    const supabase = createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()

    if (!user) {
      window.location.href = `/login?next=/dashboard/${pageId}/settings`
      return
    }

    // Load by id (RLS grants the owner OR a collaborator read). Then settings-context
    // authorizes EDITORS only + returns the OWNER's effective plan + owner-only secrets
    // (an editor can't read page_secrets directly under RLS).
    const { data, error } = await supabase
      .from('pages')
      .select(OWNER_PAGE_SELECT)
      .eq('id', pageId)
      .single<AgentPage>()

	    if (error || !data) {
	      setMessage('Listing not found, or you do not have access to its settings.')
	      setLoading(false)
	      return
	    }

	    const ctxRes = await fetch(`/api/pages/${pageId}/settings-context`)
	    if (!ctxRes.ok) {
	      setMessage('You do not have edit access to this listing’s settings.')
	      setLoading(false)
	      return
	    }
	    const ctx = (await ctxRes.json().catch(() => ({}))) as {
	      role?: 'owner' | 'editor' | 'viewer'
	      plan?: typeof ownPlan
	      customDomainClaim?: CustomDomainClaim | null
	      customDomainClaimAvailable?: boolean
	      secrets?: { calendly_webhook_secret: string | null; outbound_webhooks: unknown; domain_verification_token: string | null; calendly_connected?: boolean }
	    }
	    if (ctx.plan) setPlan(ctx.plan)
	    if (ctx.role) setPageRole(ctx.role)
	    setDomainClaim(ctx.customDomainClaim ?? null)
	    setDomainClaimStatusAvailable(ctx.customDomainClaimAvailable === true)
	    const secrets = ctx.secrets

	    const activePage = {
	      ...data,
	      calendly_webhook_secret: secrets?.calendly_webhook_secret ?? null,
	      outbound_webhooks: secrets?.outbound_webhooks ?? null,
	      domain_verification_token: secrets?.domain_verification_token ?? null,
	    } as AgentPage

	    setPage(activePage)
	    setCurrency(normalizeCurrency((activePage as { currency?: string }).currency))
	    setName(activePage.name)
	    setSlug(activePage.slug)
	    setWebsiteUrl(activePage.website_url ?? '')
	    setCtaUrl(activePage.cta_url ?? '')
	    setCtaLabel(activePage.cta_label ?? 'Visit website')
	    setContactEmail(activePage.contact_email ?? '')
	    setPreferredContact((activePage.preferred_contact as PreferredContact | null) ?? '')
	    setIsPublished(activePage.is_published)
	    setCustomDomain(activePage.custom_domain ?? '')
	    setDomainPath(activePage.domain_path ?? '/')
	    {
	      const b = (activePage.branding ?? {}) as Record<string, unknown>
	      setBrandName(typeof b.brand_name === 'string' ? b.brand_name : '')
	      setAccentColor(typeof b.accent_color === 'string' ? b.accent_color : '')
	      setLogoUrl(typeof b.logo_url === 'string' ? b.logo_url : '')
	      setHideNexezBadge(b.hide_nexez_badge === true)
	    }
	    setPreferOriginalSite(!!activePage.prefer_original_site)
	    setIndustry(activePage.industry ?? '')

	    // Phase 3: Load per-page outbound webhooks (support richer shape with optional secrets)
	    const ob = activePage.outbound_webhooks
    setTestResults({})
    if (ob) {
      const arr: OutboundEndpoint[] = Array.isArray(ob)
        ? ob.map((o: any) => (
            typeof o === 'string'
              ? { url: o, persisted: true }
              : { url: o?.url, hasSecret: o?.hasSecret === true, persisted: true }
          )).filter((o) => o.url)
        : []
      setOutboundEndpoints(arr)
    } else {
      setOutboundEndpoints([])
    }

    // Load Google Calendar availability.
    setGoogleCalendarId(activePage.google_calendar_id || '')
    setAvailabilityNote(stripAvailabilityMarker(activePage.next_available))

    // Phase 5 custom domain verification status + pending token
    setDomainVerificationToken(activePage.domain_verification_token || '')
    setDomainVerified(!!activePage.custom_domain_verified)

    setCalendlyWebhookSecret(activePage.calendly_webhook_secret || '')

    setVerificationDetails(activePage.verification_details || {})
    setMemoryNotes((activePage as any)?.agent_memory?.notes || '')
    setLlmOptIn(!!activePage.llm_opt_in)

    // Load real recent events that trigger outbound (for history surface)
    try {
      const { data: events } = await supabase
        .from('checkout_events')
        .select('id, event_type, offer_name, created_at, metadata')
	        .eq('slug', activePage.slug)
        .in('event_type', ['provider_redirect', 'stripe_session_created', 'checkout_attempt'])
        .order('created_at', { ascending: false })
        .limit(5)
      if (events) setRecentOutboundFires(events)
    } catch {}

    setLoading(false)
  }

  // Phase 5: Real custom domain verification helpers
  async function generateDomainVerificationToken() {
    if (!customDomain.trim()) {
      setMessage('Enter your custom domain first (e.g. agents.yourcompany.com).')
      return
    }
    const token = 'nexez-verify-' + Math.random().toString(36).slice(2, 14)
    setDomainVerificationToken(token)
    setMessage('Token generated. Add the DNS TXT record below, then click Verify.')

	    // Persist the pending token in owner-only page_secrets so it never appears on public page reads.
	    try {
	      await upsertPageSecrets({ domain_verification_token: token })
	    } catch (e: any) {
	      console.warn('Failed to persist verification token', e)
	    }
  }

  // A2/A3: provider provisioning + live status (Vercel-backed when configured).
  async function requestDomainRemoval(domain: string) {
    return removeManagedCustomDomain({ domain, pageId: id })
  }

  async function callDomainAction(action: 'claim' | 'attach' | 'status' | 'remove') {
    const targetDomain = action === 'remove'
      ? (page?.custom_domain || '').trim()
      : customDomain.trim()
    if (!targetDomain) {
      setMessage('Enter and save your custom domain first.')
      return
    }
    setDomainProvisioning(true)
    try {
      if (action === 'remove') {
        const result = await requestDomainRemoval(targetDomain)
        if (!result.ok) {
          setMessage(`Domain cleanup failed: ${result.error}`)
          return
        }
        setCustomDomain('')
        setDomainPath('/')
        setDomainVerified(false)
        setDomainStatus(null)
        setDomainClaim(null)
        setDomainClaimStatusAvailable(true)
        setDomainVerificationToken('')
        setPage((current) => current
          ? { ...current, custom_domain: null, custom_domain_verified: null, domain_path: '/' }
          : current)
        setMessage(
          result.sharedDomainRetained
            ? 'Domain removed from this listing. It remains connected for your other listing paths.'
            : result.staleClaimRemoved
              ? 'Expired domain reference removed from this listing.'
              : result.providerDetached
                ? 'Domain detached from hosting and removed from this listing.'
                : 'Domain removed from this listing.',
        )
        return
      }

      const res = await fetch('/api/custom-domain', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, domain: targetDomain, pageId: id }),
      })
      const data = await res.json()
      if (!res.ok) {
        if (data.claim !== undefined) {
          setDomainClaim(data.claim ?? null)
          setDomainClaimStatusAvailable(true)
        }
        setMessage(data.error || 'Domain action failed.')
        return
      }
      if (data.claim !== undefined) {
        setDomainClaim(data.claim ?? null)
        setDomainClaimStatusAvailable(true)
      }
      if (action === 'claim') return
      setDomainStatus({
        state: data.state,
        label: data.label,
        detail: data.detail,
        providerConfigured: data.providerConfigured,
        ownershipVerified: Boolean(data.ownershipVerified),
        verifiedAt: data.verifiedAt || null,
        verificationMethod: data.verificationMethod || 'unknown',
        legacyTxtBlocksCname: Boolean(data.legacyTxtBlocksCname),
        requiredRecords: data.requiredRecords || [],
        routingRecords: data.routingRecords || [],
      })
      setDomainVerified(Boolean(data.ownershipVerified))
      if (data.ownershipVerified && data.verificationMethod === 'cname') {
        setDomainVerificationToken('')
        setPage((current) =>
          current
            ? { ...current, custom_domain_verified: data.verifiedAt || current.custom_domain_verified || new Date().toISOString() }
            : current,
        )
      }
      setMessage(`${data.label}: ${data.detail}`)
    } catch (e: any) {
      setMessage('Domain action failed: ' + (e.message || 'network error'))
    } finally {
      setDomainProvisioning(false)
    }
  }

  async function verifyCustomDomain() {
    if (!customDomain.trim() || !domainVerificationToken) {
      setMessage('Generate a verification token first.')
      return
    }
    setVerifyingDomain(true)
    setMessage('Checking DNS TXT record... (propagation can take 30s–few minutes)')

    try {
      const res = await fetch('/api/verify-custom-domain', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          customDomain: customDomain.trim(),
          token: domainVerificationToken,
          pageId: id,
        }),
      })
      const data = await res.json()
      if (data.claim !== undefined) {
        setDomainClaim(data.claim ?? null)
        setDomainClaimStatusAvailable(true)
      }

      if (data.verified) {
        // The server persists verified status and clears the owner-only token.
        setDomainVerified(true)
        setDomainVerificationToken('')
        setPage((current) => current ? { ...current, custom_domain_verified: data.verifiedAt || new Date().toISOString() } : current)
        setMessage(`✓ Verified! ${customDomain.trim()} now shows as verified. Real DNS ownership proven.`)
      } else {
        setMessage(data.message || data.error || 'Verification failed. Check the exact TXT value and try again after propagation.')
      }
    } catch (e: any) {
      setMessage('Verification request failed: ' + (e.message || 'network error'))
    } finally {
      setVerifyingDomain(false)
    }
  }

  async function saveSettings(event: React.FormEvent) {
    event.preventDefault()
    if (!page) return

    if (!slugValidation.ok) {
      setMessage(slugValidation.message)
      return
    }
    if (slugAvailability.result?.available === false) {
      setMessage(slugAvailability.result.message)
      return
    }
    if (!domainPathValidation.ok) {
      setMessage(domainPathValidation.message)
      return
    }

    setSaving(true)
    setMessage('')

    const previousDomain = (page.custom_domain || '').trim().toLowerCase()
    const nextDomain = (customDomain || '').trim().toLowerCase()
    const domainChanged = previousDomain !== nextDomain

    // A direct pages update cannot detach a managed hostname from Vercel. Always
    // use the authoritative cleanup boundary before clearing or replacing a saved
    // domain; abort the broader save if provider cleanup cannot be confirmed.
    if (domainChanged && previousDomain) {
      setDomainProvisioning(true)
      const removal = await requestDomainRemoval(previousDomain)
      setDomainProvisioning(false)
      if (!removal.ok) {
        setSaving(false)
        setMessage(`Settings were not changed because the previous domain could not be detached: ${removal.error}`)
        return
      }
    }
    const branding = normalizeBranding({
      brand_name: brandName,
      accent_color: accentColor,
      logo_url: logoUrl,
      hide_nexez_badge: hideNexezBadge,
    })
    const supabase = createClient()
    const { data: savedRow, error } = await supabase
      .from('pages')
      .update({
        name,
        slug: cleanSlug,
        website_url: websiteUrl,
        cta_url: ctaUrl || websiteUrl,
        cta_label: ctaLabel || 'Visit website',
        contact_email: contactEmail,
        preferred_contact: preferredContact || null,
        is_published: isPublished,
        custom_domain: customDomain || null,
	        domain_path: normalizeDomainPath(domainPath),
	        branding,
	        prefer_original_site: preferOriginalSite,
	      })
	      .eq('id', page.id)
        .select('id')
        .single()

    if (error || !savedRow) {
      setSaving(false)
      const identifierError = publicIdentifierDatabaseMessage(error)
      setMessage(identifierError || `Settings could not be saved: ${error?.message || 'the listing was not updated'}.`)
      return
    }

    const integrationAllowed = planAllows(plan, 'integrations')
    const secretPatch: Record<string, unknown> = {
      ...(integrationAllowed ? { calendly_webhook_secret: calendlyWebhookSecret || null } : {}),
      ...(domainChanged ? { domain_verification_token: null } : {}),
    }
    const { error: secretError } = Object.keys(secretPatch).length
      ? await upsertPageSecrets(secretPatch)
      : { error: null }

    if (domainChanged) {
      setDomainVerified(false)
      setDomainStatus(null)
      setDomainClaim(null)
      setDomainClaimStatusAvailable(!nextDomain)
      if (!secretError) setDomainVerificationToken('')
    }
    setPage({
	      ...page,
        name,
        slug: cleanSlug,
        website_url: websiteUrl,
        cta_url: ctaUrl || websiteUrl,
        cta_label: ctaLabel || 'Visit website',
	      contact_email: contactEmail,
        preferred_contact: preferredContact || null,
	      is_published: isPublished,
        custom_domain: customDomain || null,
        custom_domain_verified: domainChanged ? null : page.custom_domain_verified,
        domain_path: normalizeDomainPath(domainPath),
        branding,
        prefer_original_site: preferOriginalSite,
	      calendly_webhook_secret: integrationAllowed && !secretError
          ? calendlyWebhookSecret || null
          : page.calendly_webhook_secret,
	    })
    if (domainChanged && nextDomain) {
      try {
        const claimRes = await fetch('/api/custom-domain', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'claim', domain: nextDomain, pageId: id }),
        })
        const claimData = await claimRes.json().catch(() => ({}))
        setDomainClaim(claimData.claim ?? null)
        setDomainClaimStatusAvailable(claimRes.ok)
      } catch {
        setDomainClaim(null)
        setDomainClaimStatusAvailable(false)
      }
    }
	    setSaving(false)
    setMessage(
      secretError
        ? `Listing settings saved, but the private Calendly setting was not saved: ${secretError.message}`
        : 'Listing settings saved.',
    )
	}

  async function updateMcpEnabled(next: boolean) {
    if (!page || mcpSaving) return

    const previous = Boolean(page.mcp_enabled)
    setMcpSaving(true)
    setMessage('')
    setPage((current) => (current ? { ...current, mcp_enabled: next } : current))

    try {
      const supabase = createClient()
      const { data, error } = await supabase
        .from('pages')
        .update({ mcp_enabled: next })
        .eq('id', page.id)
        .select('id, mcp_enabled')
        .single()

      if (error || !data) {
        setPage((current) => (current ? { ...current, mcp_enabled: previous } : current))
        setMessage('MCP setting could not be saved. Nothing changed - please try again.')
        return
      }

      setPage((current) => (current ? { ...current, mcp_enabled: Boolean(data.mcp_enabled) } : current))
      setMessage(
        next
          ? 'MCP support enabled. Compatible agents can now discover richer listing context.'
          : 'MCP support disabled for this listing.',
      )
    } catch {
      setPage((current) => (current ? { ...current, mcp_enabled: previous } : current))
      setMessage('MCP setting could not be saved. Nothing changed - please try again.')
    } finally {
      setMcpSaving(false)
    }
  }

  async function updateLlmOptIn(next: boolean) {
    if (!page || llmSaving) return
    if (next && !planAllows(plan, 'aiFeatures')) {
      setMessage('Advanced AI Assist is available on the Launch plan and above.')
      return
    }

    const previous = llmOptIn
    setLlmOptIn(next)
    setLlmSaving(true)
    setMessage('')

    try {
      const supabase = createClient()
      const { data, error } = await supabase
        .from('pages')
        .update({ llm_opt_in: next })
        .eq('id', page.id)
        .select('llm_opt_in')
        .single()

      if (error || !data) {
        setLlmOptIn(previous)
        setMessage('AI assist setting could not be saved. Nothing changed - please try again.')
        return
      }

      const persisted = Boolean(data.llm_opt_in)
      setLlmOptIn(persisted)
      setMessage(
        persisted
          ? 'Advanced AI assist enabled for this listing.'
          : 'Advanced AI assist disabled for this listing.',
      )
    } catch {
      setLlmOptIn(previous)
      setMessage('AI assist setting could not be saved. Nothing changed - please try again.')
    } finally {
      setLlmSaving(false)
    }
  }

	  async function copy(label: string, value: string) {
	    await navigator.clipboard.writeText(value)
	    setCopied(label)
	    window.setTimeout(() => setCopied(''), 1200)
	  }

	  async function upsertPageSecrets(values: Record<string, unknown>) {
	    if (!page?.id) {
	      return { error: { message: 'Listing missing for private settings.' } }
	    }
	    // Write via the server route: page_secrets is owner-RLS'd, so a collaborator
	    // can't upsert it directly. The route authorizes (owner/editor) + writes under
	    // the PAGE OWNER via the service-role client.
	    try {
	      const res = await fetch(`/api/pages/${page.id}/secrets`, {
	        method: 'POST',
	        headers: { 'content-type': 'application/json' },
	        body: JSON.stringify(values),
	      })
	      if (!res.ok) {
	        const data = (await res.json().catch(() => ({}))) as { error?: string }
	        return { error: { message: data.error || 'Could not save settings.' } }
	      }
	      return { error: null }
	    } catch {
	      return { error: { message: 'Could not save settings - try again.' } }
	    }
	  }

  if (loading) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-[var(--bg)] text-[var(--fg)]">
        Loading settings...
      </main>
    )
  }

  if (!page) {
    return (
      <main className="min-h-screen bg-[var(--bg)] px-6 py-12 text-[var(--fg)]">
        <div className="mx-auto max-w-2xl">
          <p className="rounded-lg border border-white/10 bg-white/[0.04] p-6 text-zinc-300">
            {message || 'Listing not found.'}
          </p>
        </div>
      </main>
    )
  }

  // Verification belongs to the saved hostname. Editing the input must never
  // carry the old domain's verified badge onto a different, unsaved host.
  const savedCustomDomain = (page.custom_domain || '').trim().toLowerCase()
  const typedCustomDomain = customDomain
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .split('/')[0]
    .split(':')[0]
  const showDomainVerified =
    domainVerified && Boolean(typedCustomDomain) && typedCustomDomain === savedCustomDomain
  const visibleDomainClaim = typedCustomDomain === savedCustomDomain ? domainClaim : null
  const visibleDomainClaimStatusAvailable =
    typedCustomDomain === savedCustomDomain ? domainClaimStatusAvailable : true
  const customDomainActivationAllowed = planAllows(plan, 'customDomain')
  const aiFeaturesAllowed = planAllows(plan, 'aiFeatures')
  const teamCollaborationAllowed = planAllows(plan, 'teamCollaboration')
  const showDomainActive = showDomainVerified && customDomainActivationAllowed
  const domainRoutingPaused = showDomainVerified && !customDomainActivationAllowed
  const showTxtVerification =
    customDomainActivationAllowed && (
      domainStatus?.verificationMethod === 'txt' ||
      Boolean(domainStatus && !domainStatus.providerConfigured && domainStatus.verificationMethod === 'unknown')
    )
  const domainAttachIsNext = Boolean(customDomainActivationAllowed && customDomain.trim() && !showDomainVerified && !domainStatus)
  const domainCnameIsNext = Boolean(
    !showDomainVerified &&
    domainStatus?.verificationMethod === 'cname' &&
    domainStatus.routingRecords.length,
  )
  const domainTxtGenerateIsNext = Boolean(showTxtVerification && !showDomainVerified && !domainVerificationToken)
  const domainTxtVerifyIsNext = Boolean(showTxtVerification && !showDomainVerified && domainVerificationToken)
  const visibilityChanged = isPublished !== Boolean(page.is_published)
  const visibilityStatus = visibilityChanged
    ? isPublished
      ? 'Will publish after saving'
      : 'Will unpublish after saving'
    : isPublished
      ? 'Published'
      : 'Draft'
  const reviewedCredentialCount = Array.isArray(verificationDetails.docs_provided)
    ? verificationDetails.docs_provided.filter(
        (document: any) => document && typeof document === 'object' && document.status === 'verified',
      ).length
    : 0
  const outboundTestStates = Object.values(testResults)
  const failedOutboundTests = outboundTestStates.filter((result) => result.state === 'failure').length
  const successfulOutboundTests = outboundTestStates.filter((result) => result.state === 'success').length
  const testingOutboundEndpoints = outboundTestStates.filter((result) => result.state === 'testing').length
  const outboundStatus: { label: string; tone: 'danger' | 'ready' | 'neutral' } = failedOutboundTests
    ? {
        label: `${failedOutboundTests} webhook test${failedOutboundTests === 1 ? '' : 's'} failed`,
        tone: 'danger',
      }
    : successfulOutboundTests
      ? {
          label: `${successfulOutboundTests} webhook test${successfulOutboundTests === 1 ? '' : 's'} passed`,
          tone: 'ready',
        }
      : testingOutboundEndpoints
        ? {
            label: `Testing ${testingOutboundEndpoints} webhook${testingOutboundEndpoints === 1 ? '' : 's'}`,
            tone: 'neutral',
          }
        : {
            label: outboundEndpoints.length
              ? `${outboundEndpoints.length} webhook${outboundEndpoints.length === 1 ? '' : 's'} configured`
              : 'No webhooks',
            tone: 'neutral',
          }

  return (
    <main className="nx-listing-settings nx-platform-surface min-h-screen bg-[var(--bg)] text-[var(--fg)]" data-testid="page-settings-screen">
      <div className="mx-auto max-w-[1180px] px-4 py-6 sm:px-7 sm:py-9">
        <SurfaceHeader
          eyebrow="Listing settings"
          icon={Settings}
          title={page.name}
          description="Shape how this listing appears, how agents understand it, and where customers complete the next step."
          actions={(
            <>
              <a href={`/dashboard/${page.id}`} className={surfaceActionClass}>Edit Listing</a>
              <a href={agentRuntimeUrl(`/${page.slug}`)} className={surfaceActionClass} target="_blank" rel="noreferrer">
                <ExternalLink className="size-4" />
                Public Listing
              </a>
            </>
          )}
          footer={(
            <>
            <StatusPill
              label={visibilityStatus}
              tone={visibilityChanged ? 'attention' : isPublished ? 'ready' : 'neutral'}
            />
            <StatusPill
              label={pageRole === 'owner' ? 'Owner access' : pageRole === 'editor' ? 'Collaborator access' : 'View only'}
              tone={pageRole === 'viewer' ? 'attention' : 'neutral'}
            />
            <StatusPill
              label={showDomainActive ? 'Domain active' : domainRoutingPaused ? 'Domain paused by plan' : customDomain ? 'Domain needs verification' : 'Platform domain'}
              tone={showDomainActive ? 'ready' : customDomain ? 'attention' : 'neutral'}
            />
            <StatusPill
              label={certification?.certified ? 'Agent-Ready certified' : `${certification?.criteria_met ?? 0}/${certification?.criteria_total ?? 11} readiness checks`}
              tone={certification?.certified ? 'ready' : 'neutral'}
            />
            </>
          )}
        />

        {message ? (
          <div
            className="fixed inset-x-4 bottom-[calc(4.75rem+env(safe-area-inset-bottom))] z-50 mx-auto flex max-w-xl items-start gap-3 rounded-2xl border border-[var(--line)] bg-[var(--glass-strong)] px-4 py-3 text-sm text-[var(--fg-soft)] shadow-[var(--settings-panel-shadow)] backdrop-blur-xl sm:inset-x-auto sm:bottom-6 sm:right-6 sm:mx-0 sm:max-w-md"
            role="status"
            aria-live="polite"
          >
            <span className="min-w-0 flex-1">{message}</span>
            <button
              type="button"
              onClick={() => setMessage('')}
              className="inline-flex size-8 shrink-0 items-center justify-center rounded-full text-[var(--fg-muted)] outline-none hover:bg-[var(--fill-1)] hover:text-[var(--fg)] focus-visible:ring-2 focus-visible:ring-[var(--control-focus)]"
              aria-label="Dismiss notification"
            >
              <X className="size-4" aria-hidden="true" />
            </button>
          </div>
        ) : null}

        <div className="mt-8 grid min-w-0 grid-cols-[minmax(0,1fr)] items-start gap-8 lg:grid-cols-[220px_minmax(0,1fr)]">
          <aside className="sticky top-16 z-30 min-w-0 max-w-full lg:top-24">
            <SettingsNav
              items={SETTINGS_SECTIONS}
              activeId={activeSection}
              onNavigate={(sectionId) => setActiveSection(sectionId as (typeof SETTINGS_SECTIONS)[number]['id'])}
              ariaLabel="Listing settings sections"
            />
          </aside>

          <div className="grid min-w-0 gap-8">
          <div className="min-w-0 space-y-8">
            <SettingsSection
              id="general"
              active={activeSection === 'general'}
              title="General"
              hint="The essential identity, contact path, visibility, and checkout defaults for this listing."
              icon={Settings}
              status={<StatusPill label={visibilityStatus} tone={visibilityChanged ? 'attention' : isPublished ? 'ready' : 'neutral'} />}
            >
              <form onSubmit={saveSettings} className="space-y-6 p-5 sm:p-6">
              <SettingRow
                label="Listing visibility"
                description="Draft listings stay private. Published listings are available to buyers, crawlers, and compatible agents after you save."
                htmlFor="listing-visibility"
                className="!px-0 !py-0"
              >
                <SettingsSwitch
                  id="listing-visibility"
                  checked={isPublished}
                  onCheckedChange={setIsPublished}
                  label="Listing visibility"
                  checkedLabel={visibilityChanged ? 'Publish on save' : 'Published'}
                  uncheckedLabel={visibilityChanged ? 'Unpublish on save' : 'Draft'}
                />
              </SettingRow>

              <div className="grid gap-5 md:grid-cols-2">
                <Field label="Listing name">
                  <input id="listing-name" value={name} onChange={(event) => setName(event.target.value)} className={inputClass} required />
                </Field>
                <Field label="Public listing name">
                  <input id="listing-slug" value={slug} onChange={(event) => setSlug(normalizeSlug(event.target.value))} className={inputClass} required />
                  <PublicIdentifierFeedback
                    checking={slugAvailability.checking}
                    result={slugAvailability.result}
                    localMessage={slugValidation.ok ? null : slugValidation.message}
                    onSuggestion={setSlug}
                  />
                </Field>
              </div>

              <div className="grid gap-5 md:grid-cols-2">
                <Field label="Main website">
                  <input id="website-url" type="url" value={websiteUrl} onChange={(event) => setWebsiteUrl(event.target.value)} className={inputClass} />
                </Field>
                <Field label="Action URL">
                  <input id="cta-url" type="url" value={ctaUrl} onChange={(event) => setCtaUrl(event.target.value)} className={inputClass} />
                </Field>
              </div>

              <div className="grid gap-5 md:grid-cols-2">
                <Field label="Action label">
                  <input id="cta-label" value={ctaLabel} onChange={(event) => setCtaLabel(event.target.value)} className={inputClass} />
                </Field>
                <Field label="Contact email">
                  <input id="contact-email" type="email" value={contactEmail} onChange={(event) => setContactEmail(event.target.value)} className={inputClass} />
                </Field>
              </div>

              <Field label="Preferred contact for agents">
                <select
                  id="preferred-contact"
                  value={preferredContact}
                  onChange={(event) => setPreferredContact(event.target.value as '' | PreferredContact)}
                  className={`${inputClass} [color-scheme:dark]`}
                >
                  <option value="">Auto (recommended)</option>
                  {contactEmail.trim() ? <option value="email">{`Email - ${contactEmail.trim()}`}</option> : null}
                  {ctaUrl.trim() ? <option value="cta">{`Primary action${ctaLabel.trim() ? ` - ${ctaLabel.trim()}` : ''}`}</option> : null}
                  {websiteUrl.trim() ? <option value="website">Website</option> : null}
                </select>
              </Field>
              <p className="text-sm leading-6 text-[var(--fg-muted)]">
                Auto chooses email first, then your primary action, then your website. This preference is included in agent.json and llms.txt.
              </p>

              <SettingRow
                label="Settlement currency"
                description="The currency buyers are charged in at checkout for this listing's offers. Currency saves immediately."
                htmlFor="settlement-currency"
              >
                <select
                  id="settlement-currency"
                  value={currency}
                  onChange={async (event) => {
                    if (!page) return
                    const next = normalizeCurrency(event.target.value)
                    const previous = currency
                    setCurrency(next)
                    const supabase = createClient()
                    const { data: savedCurrency, error } = await supabase
                      .from('pages')
                      .update({ currency: next })
                      .eq('id', page.id)
                      .select('currency')
                      .single()
                    if (error || !savedCurrency) {
                      setCurrency(previous)
                      setMessage('Currency could not be saved. Please try again.')
                    } else {
                      setCurrency(normalizeCurrency(savedCurrency.currency))
                      setMessage(`Checkout currency set to ${normalizeCurrency(savedCurrency.currency).toUpperCase()}.`)
                    }
                  }}
                  className={`${inputClass} [color-scheme:dark]`}
                >
                  {SUPPORTED_CURRENCIES.map((supportedCurrency) => (
                    <option key={supportedCurrency.code} value={supportedCurrency.code}>{supportedCurrency.label}</option>
                  ))}
                </select>
              </SettingRow>

              <button
                type="submit"
                disabled={
                  saving
                  || !slugValidation.ok
                  || slugAvailability.result?.available === false
                }
                className="btn-primary w-full px-5 py-3 disabled:opacity-60"
              >
                {saving ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
                {saving ? 'Saving...' : 'Save listing settings'}
              </button>
              </form>
            </SettingsSection>

            <SettingsSection
              id="brand-domain"
              active={activeSection === 'brand-domain'}
              title="Brand & domain"
              description="Connect a trusted hostname and carry your identity through every buyer and agent touchpoint."
              icon={Globe2}
              status={
                <StatusPill
                  label={showDomainActive ? 'Domain active' : domainRoutingPaused ? 'Domain paused by plan' : customDomain ? 'Verification needed' : 'Using Nexez URL'}
                  tone={showDomainActive ? 'ready' : customDomain ? 'attention' : 'neutral'}
                />
              }
              footer={
                <div className="flex flex-wrap items-center justify-between gap-3 text-sm text-[var(--fg-muted)]">
                  <span>Domain and branding edits are staged with the listing.</span>
                  <a href="#general" className="font-medium text-[var(--fg)] underline-offset-4 hover:underline">Review and save</a>
                </div>
              }
              contentClassName="space-y-5 divide-y-0 p-4 sm:p-5"
            >
              <div className="rounded-2xl border border-[var(--line-soft)] bg-[var(--fill-1)] p-4 sm:p-5">
              <div className="space-y-3 text-sm">
                <div>
                  <p className="flex items-center gap-2 text-xs uppercase tracking-widest text-zinc-400">
                    Custom domain
                    {!planAllows(plan, 'customDomain') && <PlanBadge feature="customDomain" />}
                  </p>
                  <div className="flex flex-wrap gap-2">
                    <input
                      value={customDomain}
                      onChange={(e) => {
                        setCustomDomain(e.target.value)
                        setDomainStatus(null)
                      }}
                      placeholder="agents.yourcompany.com"
                      className="mt-1 w-full min-w-0 flex-1 rounded border border-white/15 bg-black/30 px-2 py-1 text-sm sm:w-auto"
                    />
                    {showDomainActive ? (
                      <span
                        className="mt-1 inline-flex items-center gap-1 rounded border border-[var(--ready)]/40 bg-[var(--ready)]/10 px-3 py-1 text-xs text-[var(--ready)]"
                        title={page.custom_domain_verified ? `Verified ${new Date(page.custom_domain_verified as string).toLocaleString()}` : 'Verified'}
                      >
                        ✓ Active
                      </span>
                    ) : domainRoutingPaused ? (
                      <span className="mt-1 inline-flex items-center gap-1 rounded border border-[var(--amber)]/40 bg-[var(--amber)]/10 px-3 py-1 text-xs text-[var(--amber)]">
                        Proof retained · paused by plan
                      </span>
                    ) : null}
                  </div>
                  <p className="mt-1 text-[10px] text-zinc-500">
                    {domainStatus?.verificationMethod === 'cname'
                      ? 'This subdomain uses one CNAME record. No Nexez TXT token is required.'
                      : domainStatus?.verificationMethod === 'txt'
                        ? 'This apex domain uses its routing record plus a Nexez TXT ownership check.'
                        : 'Save the domain, then attach it below to detect the correct DNS setup.'}
                  </p>

                  {showTxtVerification ? (
                    <div
                      role={domainTxtGenerateIsNext || domainTxtVerifyIsNext ? 'group' : undefined}
                      aria-label={domainTxtGenerateIsNext || domainTxtVerifyIsNext ? 'Recommended next step: verify custom domain ownership' : undefined}
                      className="mt-2 flex flex-wrap items-center gap-2"
                    >
                      {domainTxtGenerateIsNext || domainTxtVerifyIsNext ? (
                        <span className="text-xs font-semibold uppercase tracking-[0.12em] text-[var(--fg-muted)]">
                          Recommended next step
                        </span>
                      ) : null}
                      <button
                        type="button"
                        onClick={generateDomainVerificationToken}
                        className={`rounded px-3 py-1 text-xs ${
                          domainTxtGenerateIsNext
                            ? 'settings-emphasis-action'
                            : 'border border-[var(--line)] text-[var(--fg-muted)] hover:bg-[var(--fill-1)]'
                        }`}
                      >
                        Generate TXT token
                      </button>
                      <button
                        type="button"
                        disabled={verifyingDomain || !domainVerificationToken}
                        onClick={verifyCustomDomain}
                        className={`rounded px-3 py-1 text-xs disabled:opacity-50 ${
                          domainTxtVerifyIsNext
                            ? 'settings-emphasis-action'
                            : 'border border-[var(--ready)]/40 text-[var(--ready)] hover:bg-[var(--ready)]/10'
                        }`}
                      >
                        {verifyingDomain ? 'Checking DNS...' : 'Verify TXT now'}
                      </button>
                    </div>
                  ) : null}

                  <div className="mt-2 flex items-center gap-2">
                    <label className="text-[10px] uppercase tracking-widest text-zinc-400">Path on domain</label>
                    <input
                      value={domainPath}
                      onChange={(e) => setDomainPath(e.target.value)}
                      onBlur={() => setDomainPath(normalizeDomainPath(domainPath))}
                      placeholder="/"
                      className="w-40 rounded border border-white/15 bg-black/30 px-2 py-1 text-sm"
                    />
                    <span className="text-[10px] text-zinc-500">
                      e.g. “/” or “/pricing” - host several listings on one domain.
                    </span>
                  </div>
                  {!domainPathValidation.ok ? (
                    <p className="mt-1 text-xs text-[var(--amber)]">{domainPathValidation.message}</p>
                  ) : null}

                  {domainStatus?.verificationMethod === 'cname' && domainStatus.routingRecords.length ? (
                    <div
                      role={domainCnameIsNext ? 'group' : undefined}
                      aria-label={domainCnameIsNext ? 'Recommended next step: add DNS CNAME record' : undefined}
                      className={`mt-3 rounded p-3 text-[11px] ${
                        domainCnameIsNext
                          ? 'settings-priority-card'
                          : 'border border-[var(--line-soft)] bg-[var(--fill-1)]'
                      }`}
                    >
                      {domainCnameIsNext ? (
                        <p className="mb-2 text-xs font-semibold uppercase tracking-[0.12em] text-[var(--fg-muted)]">
                          Recommended DNS step
                        </p>
                      ) : null}
                      <div className="font-medium text-zinc-200">Add this DNS CNAME record</div>
                      {domainStatus.routingRecords.map((record, index) => (
                        <div key={`${record.type}-${index}`} className="mt-2 grid gap-1 sm:grid-cols-2">
                          <div>
                            <div className="text-[10px] text-zinc-500">Name / Host</div>
                            <code className="block break-all rounded bg-black/40 p-1 text-[var(--ready)]">
                              {record.name}
                            </code>
                          </div>
                          <div>
                            <div className="text-[10px] text-zinc-500">Target / Value</div>
                            <code className="block break-all rounded bg-black/40 p-1 text-[var(--ready)]">
                              {record.value}
                            </code>
                          </div>
                        </div>
                      ))}
                      <p className="mt-2 text-[10px] text-zinc-500">
                        Some DNS providers append your zone automatically. If yours does, enter only the host portion instead of the full name.
                      </p>
                    </div>
                  ) : null}

                  {domainStatus?.legacyTxtBlocksCname ? (
                    <div className="mt-2 rounded border border-[var(--amber)]/40 bg-[var(--amber)]/10 p-2 text-[11px] text-[var(--amber)]">
                      Remove the legacy <code>_nexez-verify.{typedCustomDomain}</code> TXT record before publishing the CNAME. DNS does not allow that child TXT record beneath a CNAME host.
                    </div>
                  ) : null}

                  {/* C10: white-label branding */}
                  <BrandingPanel
                    pageId={id}
                    plan={plan}
                    websiteUrl={websiteUrl}
                    values={{ brandName, accentColor, logoUrl, hideNexezBadge }}
                    onChange={(patch) => {
                      if (patch.brandName !== undefined) setBrandName(patch.brandName)
                      if (patch.accentColor !== undefined) setAccentColor(patch.accentColor)
                      if (patch.logoUrl !== undefined) setLogoUrl(patch.logoUrl)
                      if (patch.hideNexezBadge !== undefined) setHideNexezBadge(patch.hideNexezBadge)
                    }}
                    onMessage={setMessage}
                  />

                  {showTxtVerification && domainVerificationToken && (
                    <div className="mt-2 rounded border border-[var(--amber)]/30 bg-[var(--amber)]/5 p-2 text-[11px] text-[var(--amber)]">
                      <div className="font-medium mb-1">Add this DNS TXT record:</div>
                      <div className="text-[10px] text-[var(--amber)]/80">Record name</div>
                      <code className="block bg-black/40 p-1 rounded text-[var(--ready)] break-all">
                        _nexez-verify.{typedCustomDomain}
                      </code>
                      <div className="mt-1 text-[10px] text-[var(--amber)]/80">Value</div>
                      <code className="block bg-black/40 p-1 rounded text-[var(--ready)] break-all">
                        {domainVerificationToken}
                      </code>
                      <div className="mt-1 text-[10px] text-[var(--amber)]/80">
                        Many providers append your DNS zone to the Host field. If yours does, enter only the part before your zone. Use a low TTL (300), then Verify.
                      </div>
                    </div>
                  )}

                  <div className="mt-1 flex items-center gap-2 text-[10px]">
                    {showDomainActive ? (
                      <span className="text-[var(--ready)]">✓ Active - ownership confirmed and routing allocated.</span>
                    ) : domainRoutingPaused ? (
                      <span className="text-[var(--amber)]">Ownership proof retained; routing is paused by plan.</span>
                    ) : customDomain ? (
                      <span className="text-zinc-400">
                        Status:{' '}
                        {domainStatus?.verificationMethod === 'cname'
                          ? domainStatus.label
                          : domainVerificationToken && showTxtVerification
                            ? 'Token ready - awaiting DNS verify'
                            : domainStatus?.label || 'Pending setup detection'}
                      </span>
                    ) : null}
                  </div>

                  {/* A3: connection wizard - provider attach + SSL state machine */}
                  <DomainConnectionPanel
                    customDomain={customDomain}
                    publicUrl={publicUrl}
                    status={domainStatus}
                    claim={visibleDomainClaim}
                    claimStatusAvailable={visibleDomainClaimStatusAvailable}
                    domainVerified={showDomainVerified}
                    activationAllowed={customDomainActivationAllowed}
                    busy={domainProvisioning}
                    attachIsNext={domainAttachIsNext}
                    onAction={callDomainAction}
                    onMessage={setMessage}
                  />
                </div>

              <div className="mt-4 border-t border-white/10 pt-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-xs uppercase tracking-widest text-zinc-400">Agent-Ready certification</p>
                  <span
                    className={`rounded-full border px-2 py-0.5 text-[10px] font-medium ${
                      certification?.certified
                        ? 'border-[var(--ready)]/30 bg-[var(--ready)]/10 text-[var(--ready)]'
                        : 'border-white/10 bg-white/[0.04] text-zinc-400'
                    }`}
                  >
                    {certification?.certified
                      ? 'Certified'
                      : `${certification?.criteria_met ?? 0}/${certification?.criteria_total ?? 11} checks`}
                  </span>
                </div>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={`${publicUrl}/badge.svg`}
                  alt={certification?.certified ? 'Nexez Certified Agent-Ready badge' : 'Nexez readiness badge'}
                  className="mt-2 h-7"
                />
                <pre className="mt-2 overflow-x-auto rounded bg-black/40 p-2 text-[10px] text-zinc-400">{`<a href="${publicUrl}"><img src="${publicUrl}/badge.svg" alt="Agent-Ready" height="28"></a>`}</pre>
                <p className="mt-2 text-[10px] leading-4 text-zinc-500">
                  {certification?.certified
                    ? `This listing passes every required check in standard ${AGENT_READY_STANDARD.version}. The badge is evaluated live and links agents back to this listing.`
                    : 'The badge shows your current readiness without claiming certification. Complete every required check and publish the listing to earn the certified version.'}
                </p>
                {!certification?.certified && certification?.missing.length ? (
                  <div className="mt-2 rounded border border-white/10 bg-black/20 p-2">
                    <p className="text-[10px] font-medium text-zinc-300">Next checks</p>
                    <ul className="mt-1 space-y-1 text-[10px] text-zinc-500">
                      {certification.missing.slice(0, 3).map((item) => (
                        <li key={item.id}>{item.label}: {item.hint}</li>
                      ))}
                    </ul>
                  </div>
                ) : null}
                <p className="mt-1 text-[10px] text-zinc-500">
                  <a href={AGENT_READY_STANDARD.url} className="text-[var(--signal)] hover:underline">Read the standard</a>
                  {' · '}
                  <a href={`${publicUrl}/badge.json`} className="text-[var(--signal)] hover:underline">Verify this badge</a>
                </p>
              </div>
            </div>
            </div>
            </SettingsSection>
          </div>

          <div className="min-w-0 space-y-8">
            <div className="space-y-8">
              <SettingsSection
                id="agent-experience"
                active={activeSection === 'agent-experience'}
                title="Agent experience"
                description="Control the context agents receive and the handoff customers experience beyond the listing."
                icon={Bot}
                status={<StatusPill label={preferOriginalSite ? 'Original-site handoff' : 'Nexez checkout'} tone="neutral" />}
                footer={
                  <p className="text-sm text-[var(--fg-muted)]">
                    Website verification, memory, and AI Assist save in place. The original-site preference is staged and saves from <a href="#general" className="font-medium text-[var(--fg)] underline-offset-4 hover:underline">General</a>.
                  </p>
                }
                contentClassName="space-y-5 divide-y-0 p-4 sm:p-5"
              >
              {/* Plugin pivot: verify your existing website + copy-paste Agent-Ready Kit. */}
              {page ? (
                <div className="rounded-lg border border-white/10 bg-white/[0.02] p-5">
                  <WebsitePanel
                    pageId={id}
                    page={page}
                    onMessage={setMessage}
                    onVerified={(at, m) => setPage((current) => (current ? { ...current, website_verified_at: at, website_verified_method: m } : current))}
                  />
                </div>
              ) : null}

              {pageRole === 'owner' ? <WebsiteBaselinePanel key={`${id}:${page?.website_url ?? ''}`} listingId={id} /> : null}
              {/* Phase 4: Enhanced Embed & Per-Offer Original Site Linking */}
              <div className="rounded-lg border border-white/10 bg-white/[0.02] p-5">
                <div className="flex items-center gap-2 mb-3">
                  <Code2 className="size-4 text-[var(--signal)]" />
                  <span className="font-semibold">Embed & Link to Original Site</span>
                </div>

                <div className="space-y-4 text-sm">
                  <SettingsSwitch
                    id="prefer-original-site"
                    checked={preferOriginalSite}
                    onCheckedChange={setPreferOriginalSite}
                    label="Prefer the original website"
                    description="Listing-level default. Per-offer choices in the Visual Offer Builder take precedence."
                    checkedLabel="Original site"
                    uncheckedLabel="Nexez checkout"
                  />

                  <div>
                    <p className="text-xs uppercase tracking-widest text-zinc-400 mb-1.5">Iframe embed (recommended)</p>
                    <pre className="text-[10px] bg-black/40 p-3 rounded overflow-x-auto text-[var(--signal)] whitespace-pre-wrap">{`<iframe src="${publicUrl}" width="100%" height="900" style="border:1px solid #222; border-radius:12px;" loading="lazy"></iframe>`}</pre>
                    <button
                      type="button"
                      onClick={() => {
                        const code = `<iframe src="${publicUrl}" width="100%" height="900" style="border:1px solid #222; border-radius:12px;" loading="lazy"></iframe>`
                        navigator.clipboard.writeText(code)
                        setMessage('Iframe embed code copied.')
                      }}
                      className="mt-1.5 text-xs text-[var(--signal)] hover:underline"
                    >
                      Copy iframe code
                    </button>
                  </div>

                  <div>
                    <p className="text-xs uppercase tracking-widest text-zinc-400 mb-1.5">Lightweight JS widget (floating action button)</p>
                    <pre className="text-[10px] bg-black/40 p-3 rounded overflow-x-auto text-[var(--signal)] whitespace-pre-wrap">{`<script>
  (function(){var s=document.createElement('script');s.src='${getBaseUrl()}/widget.js';s.onload=function(){Nexez.init({slug:'${slug}',theme:'light'})};document.head.appendChild(s);})();
</script>`}</pre>
                    <p className="text-[10px] text-zinc-500 mt-1">Adds a floating booking button to your site and follows the listing and offer settings you already chose.</p>
                    <button
                      type="button"
                      onClick={() => {
                        const js = `(function(){var s=document.createElement('script');s.src='${getBaseUrl()}/widget.js';s.onload=function(){Nexez.init({slug:'${slug}',theme:'light'})};document.head.appendChild(s);})();`
                        navigator.clipboard.writeText(js)
                        setMessage('JS widget snippet copied.')
                      }}
                      className="mt-1.5 text-xs text-[var(--signal)] hover:underline"
                    >
                      Copy JS widget snippet
                    </button>
                  </div>

                  <div className="pt-2 border-t border-white/10 text-[11px] text-[var(--ready)]/80">
                    Per-offer "Book on original site" toggles in the builder override this listing default for individual offers.
                  </div>

                  {/* Live Embed Preview (further enhanced) */}
                  <div className="mt-4 border-t border-white/10 pt-4">
                    <div className="flex items-center justify-between mb-2">
                      <p className="text-xs uppercase tracking-widest text-zinc-400">Live Preview (respects current settings)</p>
                      <a href={publicUrl} target="_blank" className="text-[10px] text-[var(--signal)] hover:underline">Open full listing →</a>
                    </div>
                    <div className="rounded border border-white/10 overflow-hidden bg-[#0A0A0F]">
                      <iframe
                        src={publicUrl}
                        className="w-full h-[420px]"
                        title="Live embed preview"
                        sandbox="allow-scripts allow-same-origin allow-forms"
                      />
                    </div>
                    <div className="mt-1 text-[10px] text-zinc-500">
                      Responsive by default (100% width). Per-offer original-site toggles take precedence.
                      {preferOriginalSite ? " Listing-level original site mode is active." : " Nexez checkout is default unless overridden per offer."}
                    </div>
                    <div className="mt-1 text-[9px] text-[var(--ready)]/80">
                      Tip: Use the Visual Offer Builder to set per-offer "Book on original site" for granular control.
                    </div>
                  </div>
                </div>
              </div>

              <div className="rounded-2xl border border-[var(--line-soft)] bg-[var(--fill-1)] p-4 sm:p-5">
                <div className="mb-2 flex flex-wrap items-center gap-2">
                  <p className="font-medium text-[var(--fg)]">Agent memory & context</p>
                  <StatusPill label={agentMemoryCopy.status} />
                </div>
                <p className="mb-3 text-xs leading-5 text-[var(--fg-muted)]">
                  {agentMemoryCopy.description}
                </p>
                <label htmlFor="agent-memory" className="sr-only">{agentMemoryCopy.fieldLabel}</label>
                <textarea
                  id="agent-memory"
                  className="min-h-28 w-full rounded-xl border border-[var(--line)] bg-[var(--glass)] p-3 text-sm leading-6 text-[var(--fg)]"
                  placeholder={agentMemoryCopy.placeholder}
                  value={memoryNotes}
                  onChange={(event) => setMemoryNotes(event.target.value)}
                />
                <div className="mt-3 flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={async () => {
                      if (!page) return
                      const supabase = createClient()
                      const memory = { notes: memoryNotes, updated: new Date().toISOString() }
                      const { data: savedMemory, error } = await supabase
                        .from('pages')
                        .update({ agent_memory: memory })
                        .eq('id', page.id)
                        .select('id')
                        .single()
                      setMessage(
                        error || !savedMemory
                          ? `Save failed: ${error?.message || 'the listing was not updated'}`
                          : agentMemoryCopy.saved,
                      )
                    }}
                    className="btn-secondary px-3 py-2 text-xs"
                  >
                    Save memory context
                  </button>
                  {aiFeaturesAllowed ? (
                    <button
                      type="button"
                      onClick={async () => {
                        if (!page) return
                        try {
                          const response = await fetch('/api/ai/suggest', {
                            method: 'POST',
                            headers: { 'content-type': 'application/json' },
                            body: JSON.stringify({ pageId: page.id, kind: 'memory' }),
                          })
                          const data = await response.json()
                          if (!response.ok) {
                            setMessage(data.error || 'AI suggestion is unavailable right now.')
                            return
                          }
                          if (data.suggestion) {
                            setMemoryNotes(String(data.suggestion).trim())
                            setMessage('AI suggested memory notes. Edit and save when ready.')
                          }
                        } catch {
                          setMessage('AI suggestion failed. You can continue editing manually.')
                        }
                      }}
                      className="btn-secondary px-3 py-2 text-xs"
                    >
                      Suggest with AI
                    </button>
                  ) : (
                    <span className="inline-flex items-center gap-2">
                      <button type="button" disabled className="btn-secondary px-3 py-2 text-xs opacity-55">
                        Suggest with AI
                      </button>
                      <PlanBadge feature="aiFeatures" />
                    </span>
                  )}
                </div>
              </div>

              <SettingRow
                label="Advanced AI Assist"
                description={
                  <span className="inline-flex flex-wrap items-center gap-2">
                    Allow Nexez to improve listing copy, agent summaries, imports, and simulator responses.
                    {!aiFeaturesAllowed ? <PlanBadge feature="aiFeatures" /> : null}
                    {!aiFeaturesAllowed && llmOptIn
                      ? <span className="text-[var(--amber)]">Consent is retained, but AI execution is paused until plan access returns.</span>
                      : null}
                  </span>
                }
                htmlFor="advanced-ai-assist"
              >
                <SettingsSwitch
                  id="advanced-ai-assist"
                  checked={llmOptIn}
                  onCheckedChange={updateLlmOptIn}
                  label="Advanced AI Assist"
                  uncheckedLabel="Disabled"
                  pending={llmSaving}
                  pendingLabel="Saving"
                  disabled={!aiFeaturesAllowed && !llmOptIn}
                  checkedLabel={!aiFeaturesAllowed && llmOptIn ? 'Configured · paused' : 'Enabled'}
                />
              </SettingRow>
              </SettingsSection>

              <SettingsSection
                id="commerce-integrations"
                active={activeSection === 'commerce-integrations'}
                title="Commerce & integrations"
                description="Keep offers, availability, booking automation, and outbound systems in sync."
                icon={ExternalLink}
                status={
                  <span data-testid="outbound-webhook-summary" data-tone={outboundStatus.tone}>
                    <StatusPill label={outboundStatus.label} tone={outboundStatus.tone} />
                  </span>
                }
                footer={
                  <p className="text-sm text-[var(--fg-muted)]">
                    Integrations, webhooks, and availability save in place. The Calendly signing secret is staged and saves from <a href="#general" className="font-medium text-[var(--fg)] underline-offset-4 hover:underline">General</a>.
                  </p>
                }
                contentClassName="space-y-5 divide-y-0 p-4 sm:p-5"
              >
              <button
                type="button"
                onClick={async () => {
                  if (!websiteUrl) { 
                    setMessage('No original website URL set.');
                    return; 
                  }
                  const res = await fetch('/api/tools/import-site', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ url: websiteUrl, industry })
                  });
                  const data = await res.json();
                  if (data.suggestedPage && data.structuredOffers) {
                    // Phase 1 polish: store for the editor's re-analysis preview flow
                    sessionStorage.setItem('nexez_imported_page', JSON.stringify(data.suggestedPage));
                    sessionStorage.setItem('nexez_imported_structured', JSON.stringify(data.structuredOffers));
                    window.location.href = `/dashboard/${id}?reanalyzed=true`;
                  } else {
                    setMessage(data.error || 'Sync failed. Please try again.');
                  }
                }}
                className="mt-3 w-full rounded-lg border border-white/15 px-5 py-3 text-sm text-zinc-200 hover:bg-white/5"
              >
                Re-sync Offers from Original Website (Preview in Editor)
              </button>

              {/* Unified per-listing integrations - connect once, then re-sync
                  without re-entering the token until you disconnect. */}
              <div className="mt-4">
                <div className="text-sm font-medium text-[var(--signal)] mb-1">Integrations</div>
                <IntegrationsPanel pageId={id} isPro={planAllows(plan, 'integrations')} onMessage={setMessage} />
              </div>

              {/* Phase 3: Per-page outbound webhooks - FIRST CLASS (url + optional secret, real test button, auto-fired) */}
              <PlanGate
                feature="outboundWebhooks"
                currentPlan={plan}
                variant="inline"
                title="Booking event webhooks"
                description="Signed outbound automation is available on the Pro plan and up."
              >
                <OutboundWebhooksPanel
                  slug={slug}
                  pageId={page?.id}
                  endpoints={outboundEndpoints}
                  setEndpoints={setOutboundEndpoints}
                  testResults={testResults}
                  setTestResults={setTestResults}
                  recentFires={recentOutboundFires}
                  upsertSecrets={upsertPageSecrets}
                  onMessage={setMessage}
                  onPersisted={(next) => setPage((current) => (current ? { ...current, outbound_webhooks: next } : current))}
                />
              </PlanGate>
              {!planAllows(plan, 'outboundWebhooks') && outboundEndpoints.length > 0 ? (
                <button
                  type="button"
                  className="mt-2 text-xs text-[var(--fg-muted)] underline decoration-white/20 underline-offset-4 hover:text-white"
                  onClick={async () => {
                    const { error } = await upsertPageSecrets({ outbound_webhooks: [] })
                    if (error) {
                      setMessage(error.message)
                      return
                    }
                    setOutboundEndpoints([])
                    setPage((current) => (current ? { ...current, outbound_webhooks: [] } : current))
                    setMessage('Saved webhook endpoints disconnected.')
                  }}
                >
                  Disconnect saved booking webhooks
                </button>
              ) : null}

              {/* Google Calendar Availability */}
              <AvailabilityPanel
                pageId={page?.id}
                integrationsAllowed={planAllows(plan, 'integrations')}
                calendarId={googleCalendarId}
                setCalendarId={setGoogleCalendarId}
                note={availabilityNote}
                setNote={setAvailabilityNote}
                onMessage={setMessage}
                onPersisted={(patch) => setPage((current) => (current ? ({ ...current, ...patch } as AgentPage) : current))}
              />

              <PlanGate
                feature="integrations"
                currentPlan={plan}
                variant="inline"
                title="Calendly booking updates"
                description="Signed Calendly booking updates are available on the Pro plan and up."
              >
                <div className="rounded-2xl border border-[var(--line-soft)] bg-[var(--fill-1)] p-4 sm:p-5">
                  <label htmlFor="calendly-webhook-secret" className="text-sm font-medium text-[var(--fg)]">
                    Calendly webhook secret
                  </label>
                  <p className="mt-1 text-xs leading-5 text-[var(--fg-muted)]">
                    Paste the signing secret from Calendly so Nexez can verify incoming booking events for this listing.
                  </p>
                  <input
                    id="calendly-webhook-secret"
                    type="password"
                    value={calendlyWebhookSecret}
                    onChange={(event) => setCalendlyWebhookSecret(event.target.value)}
                    placeholder="Paste Calendly signing secret"
                    className={`${inputClass} mt-3 font-mono`}
                  />
                  <p className="mt-2 text-xs text-[var(--fg-muted)]">
                    This secret is staged with the listing settings. Save it from General, then use your listing slug in the Calendly webhook URL.
                  </p>
                </div>
              </PlanGate>
              {!planAllows(plan, 'integrations') && calendlyWebhookSecret ? (
                <button
                  type="button"
                  className="mt-2 text-xs text-[var(--fg-muted)] underline decoration-white/20 underline-offset-4 hover:text-white"
                  onClick={async () => {
                    const { error } = await upsertPageSecrets({ calendly_webhook_secret: null })
                    if (error) {
                      setMessage(error.message)
                      return
                    }
                    setCalendlyWebhookSecret('')
                    setPage((current) => (current ? { ...current, calendly_webhook_secret: null } : current))
                    setMessage('Saved Calendly credential disconnected.')
                  }}
                >
                  Disconnect saved Calendly credential
                </button>
              ) : null}
              </SettingsSection>

              <SettingsSection
                id="trust-verification"
                active={activeSection === 'trust-verification'}
                title="Trust & verification"
                description="Verification is earned from server-confirmed ownership checks. Credential reviews add context, but are not seller verification."
                icon={ShieldCheck}
                status={
                  <StatusPill
                    label={`${reviewedCredentialCount} reviewed credential${reviewedCredentialCount === 1 ? '' : 's'}`}
                    tone="neutral"
                  />
                }
                contentClassName="space-y-5 divide-y-0 p-4 sm:p-5"
              >
                <div className="divide-y divide-[var(--line-soft)] rounded-2xl border border-[var(--line-soft)] bg-[var(--fill-1)] px-4 sm:px-5">
                  <SettingRow
                    label="Website ownership"
                    description={page.website_verified_at
                      ? `Confirmed ${new Date(page.website_verified_at as string).toLocaleDateString()}`
                      : 'Run the ownership check in Agent experience to verify your existing website.'}
                  >
                    <StatusPill
                      label={page.website_verified_at ? 'Verified' : 'Not verified'}
                      tone={page.website_verified_at ? 'ready' : 'attention'}
                    />
                  </SettingRow>
                  <SettingRow
                    label="Custom domain ownership"
                    description={customDomain
                      ? 'Derived from the saved hostname and its server-side DNS verification result.'
                      : 'Add a custom hostname in Brand & domain to begin verification.'}
                  >
                    <StatusPill
                      label={showDomainActive ? 'Verified & active' : domainRoutingPaused ? 'Verified · routing paused' : customDomain ? 'Pending' : 'Not configured'}
                      tone={showDomainActive ? 'ready' : customDomain ? 'attention' : 'neutral'}
                    />
                  </SettingRow>
                  <SettingRow
                    label="Reviewed credentials"
                    description="Automated review adds document context, but does not independently verify the seller or affect Trust Score."
                  >
                    <StatusPill
                      label={`${reviewedCredentialCount} reviewed`}
                      tone="neutral"
                    />
                  </SettingRow>
                </div>

                <div className="rounded-2xl border border-[var(--line-soft)] bg-[var(--fill-1)] p-4 sm:p-5">
                  <CredentialsManager
                    pageId={page.id}
                    docs={verificationDetails.docs_provided || []}
                    onChange={(docs) => setVerificationDetails({ ...verificationDetails, docs_provided: docs })}
                  />
                </div>
              </SettingsSection>

              <SettingsSection
                id="team-history"
                active={activeSection === 'team-history'}
                title="Team & history"
                description="Review listing versions, restore earlier work, and coordinate approval requests."
                icon={History}
                status={
                  <StatusPill
                    label={`${(page as any)?.team_collaboration?.approvals?.filter((approval: any) => approval.status === 'pending').length || 0} pending${teamCollaborationAllowed ? '' : ' · paused by plan'}`}
                    tone={(page as any)?.team_collaboration?.approvals?.some((approval: any) => approval.status === 'pending') ? 'attention' : 'neutral'}
                  />
                }
                contentClassName="space-y-5 divide-y-0 p-4 sm:p-5"
              >
              {(page as any)?.versions?.length > 0 ? (
                <div className="rounded-2xl border border-[var(--line-soft)] bg-[var(--fill-1)] p-4 sm:p-5">
                  <div className="mb-3 flex flex-wrap items-center gap-2">
                    <History className="size-4 text-[var(--signal)]" />
                    <span className="font-semibold">Deployments</span>
                    <span className="text-xs text-[var(--fg-muted)]">Last 10 saves · newest first</span>
                  </div>
                  <div className="max-h-72 space-y-2 overflow-auto text-sm">
                    {summarizeDeployments((page as any).versions).map((deployment) => (
                      <div
                        key={deployment.index}
                        className={`flex items-center justify-between gap-3 rounded-xl border p-3 ${
                          deployment.isCurrent
                            ? 'border-[var(--ready)]/30 bg-[var(--ready)]/5'
                            : 'border-[var(--line-soft)] bg-[var(--glass)]'
                        }`}
                      >
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="truncate text-[var(--fg)]">{deployment.name}</span>
                            {deployment.isCurrent ? <StatusPill label="Live now" tone="ready" /> : null}
                          </div>
                          <div className="mt-1 text-xs text-[var(--fg-muted)]">
                            {new Date(deployment.timestamp).toLocaleString()} · {deployment.offerCount} offer
                            {deployment.offerCount === 1 ? '' : 's'} · {deploymentChangeAt((page as any).versions, deployment.index)}
                          </div>
                        </div>
                        {deployment.isCurrent ? (
                          <span className="text-xs text-[var(--fg-muted)]">Current</span>
                        ) : (
                          <button
                            type="button"
                            onClick={() => {
                              sessionStorage.setItem(
                                'nexez_restore_version',
                                JSON.stringify((page as any).versions[deployment.index]),
                              )
                              window.location.href = `/dashboard/${id}?restore=true`
                            }}
                            className="btn-secondary shrink-0 px-3 py-2 text-xs"
                          >
                            Roll back
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                  <p className="mt-3 text-xs leading-5 text-[var(--fg-muted)]">
                    Rollback opens the selected version in the editor so you can review it before publishing again.
                  </p>
                </div>
              ) : (
                <div className="rounded-2xl border border-dashed border-[var(--line)] bg-[var(--fill-1)] p-5 text-sm text-[var(--fg-muted)]">
                  Deployment history appears here after the listing has saved versions.
                </div>
              )}

              {/* Advanced Team Collaboration & Approval Workflows (full) */}
              <div className="rounded-2xl border border-[var(--line-soft)] bg-[var(--fill-1)] p-4 sm:p-5">
                <div className="font-medium text-zinc-200 mb-1">Team Approvals & Collaboration</div>
                <p className="text-[10px] text-zinc-400 mb-2">
                  {teamCollaborationAllowed
                    ? 'Request and manage approvals for changes like offer updates or pricing. Approvals appear in editor health checks and team review surfaces.'
                    : 'Approval history is retained, but new requests and decisions are paused until the owner has Pro access.'}
                </p>

                <div className="text-xs mb-2">Pending / History Approvals:</div>
                <div className="max-h-24 overflow-auto text-xs bg-black/30 p-2 rounded mb-2 border border-white/10">
                  {(page as any)?.team_collaboration?.approvals?.length ? (
                    (page as any).team_collaboration.approvals.map((a: any, i: number) => (
                      <div key={i} className="flex justify-between py-0.5 border-b border-white/5 last:border-0">
                        <span>{a.note || 'Change request'} - {a.status || 'pending'}</span>
                        <span className="text-zinc-500">{new Date(a.ts).toLocaleDateString()}</span>
                      </div>
                    ))
                  ) : (
                    <span className="text-zinc-500">No approvals yet. Use "Request Approval" in editor.</span>
                  )}
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  {teamCollaborationAllowed ? (
                    <button
                      type="button"
                      onClick={async () => {
                        if (!page) return
                        let note = 'Offer pricing/structure update'
                        try {
                          const response = await fetch('/api/ai/suggest', {
                            method: 'POST',
                            headers: { 'content-type': 'application/json' },
                            body: JSON.stringify({ pageId: page.id, kind: 'approval-note' }),
                          })
                          if (response.ok) {
                            const data = await response.json()
                            if (data.suggestion) note = String(data.suggestion).trim().slice(0, 80)
                          }
                        } catch {}
                        try {
                          const teamCollaboration = await mutateTeamApproval({ pageId: page.id, action: 'request', note })
                          setPage((current) => current ? ({ ...current, team_collaboration: teamCollaboration } as AgentPage) : current)
                          setMessage('Approval request added. Team members can review it in the editor.')
                        } catch (error) {
                          setMessage(error instanceof Error ? error.message : 'Approval request could not be added.')
                        }
                      }}
                      className="text-xs rounded border border-white/20 px-3 py-1 hover:bg-white/5"
                    >
                      Request Approval
                    </button>
                  ) : <PlanBadge feature="teamCollaboration" />}

                  {teamCollaborationAllowed && pageRole === 'owner' ? (
                    <button
                      type="button"
                      onClick={async () => {
                        if (!page) return
                        try {
                          const teamCollaboration = await mutateTeamApproval({ pageId: page.id, action: 'approve_all' })
                          setPage((current) => current ? ({ ...current, team_collaboration: teamCollaboration } as AgentPage) : current)
                          setMessage('All pending approval requests are marked approved.')
                        } catch (error) {
                          setMessage(error instanceof Error ? error.message : 'Approvals could not be updated.')
                        }
                      }}
                      className="text-xs rounded border border-white/20 px-3 py-1 hover:bg-white/5"
                    >
                      Approve All Pending
                    </button>
                  ) : null}

                  {pageRole === 'owner' && (page as any)?.team_collaboration?.approvals?.length ? (
                    <button
                      type="button"
                      onClick={async () => {
                        if (!page || !window.confirm('Clear all retained approval history for this listing?')) return
                        try {
                          const teamCollaboration = await mutateTeamApproval({ pageId: page.id, action: 'clear' })
                          setPage((current) => current ? ({ ...current, team_collaboration: teamCollaboration } as AgentPage) : current)
                          setMessage('Approval history cleared.')
                        } catch (error) {
                          setMessage(error instanceof Error ? error.message : 'Approval history could not be cleared.')
                        }
                      }}
                      className="text-xs rounded border border-red-400/30 px-3 py-1 text-red-300 hover:bg-red-400/10"
                    >
                      Clear approval history
                    </button>
                  ) : null}
                </div>
              </div>
              </SettingsSection>

              <SettingsSection
                id="developer"
                active={activeSection === 'developer'}
                title="Developer"
                description="Copy canonical machine-readable endpoints and control protocol discovery for compatible agents."
                icon={Code2}
                status={<StatusPill label={(page as any)?.mcp_enabled ? 'MCP enabled' : 'Public endpoints'} tone={(page as any)?.mcp_enabled ? 'ready' : 'neutral'} />}
                contentClassName="space-y-5 divide-y-0 p-4 sm:p-5"
              >
                <LinkPanel
                  title="Agent links"
                  links={([
                    ['Public listing', publicUrl],
                    ['Agent JSON', agentJsonUrl],
                    ['Search API', searchUrl],
                    ['OpenAPI', `${getBaseUrl()}/openapi.json`],
                    ...((page as any)?.mcp_enabled
                      ? [
                          ['MCP Manifest', `${getBaseUrl()}/${cleanSlug || page.slug}/mcp.json`],
                          ['MCP Discovery', `${getBaseUrl()}/.well-known/mcp.json`],
                        ]
                      : []),
                  ] as [string, string][])}
                  copied={copied}
                  onCopy={copy}
                />

                <div className="divide-y divide-[var(--line-soft)] rounded-2xl border border-[var(--line-soft)] bg-[var(--fill-1)] px-4 sm:px-5">
                  <SettingRow
                    label="MCP structured data"
                    description="Compatible AI agents can discover richer listing context and offer actions."
                    htmlFor="mcp-structured-data"
                  >
                    <SettingsSwitch
                      id="mcp-structured-data"
                      checked={Boolean((page as any)?.mcp_enabled)}
                      onCheckedChange={updateMcpEnabled}
                      label="MCP structured data"
                      checkedLabel="Enabled"
                      uncheckedLabel="Disabled"
                      pending={mcpSaving}
                      pendingLabel="Saving"
                    />
                  </SettingRow>
                  <SettingRow
                    label="Agent access"
                    description="Machine-readable listing links are available without a private API key."
                  >
                    <StatusPill label="Public links" tone="neutral" />
                  </SettingRow>
                </div>

                <section className="overflow-hidden rounded-2xl border border-[var(--line-soft)] bg-[var(--fill-1)]">
                  <div className="flex items-center justify-between border-b border-[var(--line-soft)] p-5">
                    <div className="flex items-center gap-2">
                      <Code2 className="size-5 text-[var(--signal)]" />
                      <h2 className="font-semibold">Agent Manifest Preview</h2>
                    </div>
                    <button
                      type="button"
                      onClick={() => copy('Manifest', manifestPreview)}
                      className="btn-secondary px-3 py-2 text-sm"
                    >
                      {copied === 'Manifest' ? <Check className="size-4 text-[var(--ready)]" /> : <Copy className="size-4" />}
                      Copy
                    </button>
                  </div>
                  <pre className="max-h-[560px] overflow-auto p-5 text-xs leading-6 text-[var(--signal)]">
                    {manifestPreview}
                  </pre>
                </section>
              </SettingsSection>
          </div>
        </div>
        </div>
      </div>
      </div>
    </main>
  )
}

function LinkPanel({
  title,
  links,
  copied,
  onCopy,
}: {
  title: string
  links: [string, string][]
  copied: string
  onCopy: (label: string, value: string) => void
}) {
  return (
    <div className="rounded-lg border border-white/10 bg-white/[0.04] p-5">
      <h2 className="font-semibold">{title}</h2>
      <div className="mt-4 space-y-2">
        {links.map(([label, value]) => (
          <button
            key={label}
            type="button"
            onClick={() => onCopy(label, value)}
            className="flex w-full items-center justify-between gap-3 rounded-lg border border-white/10 bg-black/20 px-3 py-3 text-left text-sm text-zinc-300 hover:bg-white/10"
          >
            <span className="min-w-0">
              <span className="block text-zinc-100">{label}</span>
              <span className="block truncate font-mono text-xs text-zinc-500">{value}</span>
            </span>
            {copied === label ? <Check className="size-4 shrink-0 text-[var(--ready)]" /> : <Copy className="size-4 shrink-0" />}
          </button>
        ))}
      </div>
    </div>
  )
}

function DisabledRow({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-4 rounded-lg border border-[var(--signal)]/10 bg-black/20 px-3 py-3">
      <span className="flex items-center gap-2 text-zinc-300">
        <span className="text-[var(--signal)]">{icon}</span>
        {label}
      </span>
      <span className="text-zinc-500">{value}</span>
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-2 block text-sm font-medium text-zinc-200">{label}</span>
      {children}
    </label>
  )
}

const inputClass =
  'w-full rounded-lg border border-white/10 bg-white/[0.06] px-4 py-3 text-white placeholder:text-zinc-600 outline-none transition focus:border-[var(--signal)]/60'
