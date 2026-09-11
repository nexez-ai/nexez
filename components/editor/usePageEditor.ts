'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import {
  AgentPage,
  OfferItem,
  OWNER_PAGE_SELECT,
  formatFaqLines,
  formatOfferLines,
  getReadinessScore,
  parseFaqLines,
  parseOfferLines,
} from '../../lib/agent-page'
import {
  smartMergeOffers,
  countOfferChanges,
  buildSavePayload,
  buildDraftContent,
  type EditorSaveInput,
} from '../../lib/editor-merge'
import { applyDraftOverlay, draftToLiveUpdate, isSupportedPageDraft } from '../../lib/draft'
import { publishErrorMessage } from '../../lib/publish-error'
import { requestAiEnhancement } from '../../lib/ai-enhance-client'
import { mutateTeamApproval } from '../../lib/team-approval-client'
import { mergeOfferCollectionPreservingConfiguration } from '../../lib/configured-offer'
import { createClient } from '../../utils/supabase/client'
import {
  publicIdentifierDatabaseMessage,
  validatePublicIdentifier,
} from '../../lib/public-identifier'
import { usePublicIdentifierAvailability } from '../public-identifier/PublicIdentifierFeedback'
import {
  EditorEvent,
  EditorInitial,
  IntegrationStatus,
  PendingReanalysis,
  ResyncProvider,
  resolveShopifyIntegrationStatus,
  shopifyConnectionCanSync,
} from './types'

const RESYNC_LABELS: Record<ResyncProvider, string> = {
  calendly: 'Calendly',
  stripe: 'Stripe',
  shopify: 'Shopify',
  square: 'Square',
  acuity: 'Acuity',
}

/**
 * Owns all editor state, derived values, and handlers. Seeded synchronously
 * from server-fetched `initial` (no client load waterfall). The save / draft /
 * re-analysis logic delegates to the pure, unit-tested helpers in
 * `lib/editor-merge.ts`.
 */
export function usePageEditor(initial: EditorInitial) {
  const id = initial.page.id as string
  const aiFeaturesEnabled = initial.aiFeaturesEnabled === true
  const integrationsEnabled = initial.integrationsEnabled === true
  const outboundWebhooksEnabled = initial.outboundWebhooksEnabled === true
  const teamCollaborationEnabled = initial.teamCollaborationEnabled === true
  const negotiationEnabled = initial.negotiationEnabled === true

  const initialContent = useMemo(() => isSupportedPageDraft(initial.page.draft)
    ? applyDraftOverlay(initial.page, initial.page.draft)
    : initial.page, [initial.page])
  const writeInProgress = useRef(false)

  const [page, setPage] = useState<AgentPage>(initial.page)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState('')
  const [syncing, setSyncing] = useState(false)
  const [aiBusy, setAiBusy] = useState(false)
  const [integrationResyncing, setIntegrationResyncing] = useState<string | null>(null)

  const [name, setName] = useState(initialContent.name ?? '')
  const [slug, setSlug] = useState(initial.page.slug ?? '')
  const [description, setDescription] = useState(initialContent.description ?? '')
  const [websiteUrl, setWebsiteUrl] = useState(initial.page.website_url ?? '')
  const [ctaUrl, setCtaUrl] = useState(initial.page.cta_url ?? '')
  const [ctaLabel, setCtaLabel] = useState(initial.page.cta_label ?? 'Visit website')
  const [audience, setAudience] = useState(initial.page.audience ?? '')
  const [location, setLocation] = useState(initial.page.location ?? '')
  const [contactEmail, setContactEmail] = useState(initial.page.contact_email ?? '')
  const [industry, setIndustry] = useState(initialContent.industry ?? '')
  const [preferOriginalSite, setPreferOriginalSite] = useState(!!initialContent.prefer_original_site)
  const [nextAvailable, setNextAvailable] = useState((initial.page as any).next_available ?? '')
  const [googleCalendarId] = useState((initial.page as any).google_calendar_id ?? '')
  const [products, setProducts] = useState(formatOfferLines(initialContent.products))
  const [services, setServices] = useState(formatOfferLines(initialContent.services))
  const [faqs, setFaqs] = useState(formatFaqLines(initialContent.faqs))
  const [servicesOffers, setServicesOffers] = useState<OfferItem[]>((initialContent.services ?? []) as OfferItem[])
  const [productsOffers, setProductsOffers] = useState<OfferItem[]>((initialContent.products ?? []) as OfferItem[])
  const [isPublished, setIsPublished] = useState(initial.page.is_published)
  const slugValidation = validatePublicIdentifier(slug, { current: page.slug })
  const slugAvailability = usePublicIdentifierAvailability({
    namespace: 'page_slug',
    value: slug,
    subjectId: id,
    enabled: slugValidation.ok,
  })

  const [pendingReanalysis, setPendingReanalysis] = useState<PendingReanalysis | null>(null)
  const [restoredVersion, setRestoredVersion] = useState<any>(null)

  const [recentCalendlyBookings, setRecentCalendlyBookings] = useState<EditorEvent[]>(initial.recentCalendlyBookings)
  const [lastBooking, setLastBooking] = useState<any>((initial.page as any).last_booking ?? null)
  const [recentOutboundFires] = useState<EditorEvent[]>(initial.recentOutboundFires)
  const [trustEvents] = useState<EditorEvent[]>(initial.trustEvents)
  const [integrationStatus, setIntegrationStatus] = useState<IntegrationStatus>({})

  const parsedServices = useMemo(
    () => (servicesOffers.length ? servicesOffers : parseOfferLines(services)),
    [servicesOffers, services],
  )
  const parsedProducts = useMemo(
    () => (productsOffers.length ? productsOffers : parseOfferLines(products)),
    [productsOffers, products],
  )

  const score = useMemo(
    () =>
      getReadinessScore({
        name,
        slug,
        description,
        website_url: websiteUrl,
        cta_url: ctaUrl,
        audience,
        location,
        contact_email: contactEmail,
        industry,
        prefer_original_site: preferOriginalSite,
        products: productsOffers.length ? productsOffers : parseOfferLines(products),
        services: servicesOffers.length ? servicesOffers : parseOfferLines(services),
        faqs: parseFaqLines(faqs),
        is_published: isPublished,
      }),
    [
      audience,
      contactEmail,
      ctaUrl,
      description,
      faqs,
      industry,
      isPublished,
      location,
      name,
      preferOriginalSite,
      products,
      productsOffers,
      services,
      servicesOffers,
      slug,
      websiteUrl,
    ],
  )

  // Snapshot of the offer-bearing + save state for the pure helpers.
  const saveInput = (): EditorSaveInput => ({
    name,
    slug,
    description,
    websiteUrl,
    ctaUrl,
    ctaLabel,
    audience,
    location,
    contactEmail,
    industry,
    preferOriginalSite,
    nextAvailable,
    isPublished,
    services,
    products,
    faqs,
    servicesOffers,
    productsOffers,
  })

  // Legacy browser markers remain useful for one-off import history, but only
  // the server-resolved page connection may classify Shopify as OAuth or token.
  useEffect(() => {
    try {
      const status: IntegrationStatus = {}
      const cal = localStorage.getItem('nexez_calendly_connection')
      if (cal) status.calendly = JSON.parse(cal)
      const str = localStorage.getItem('nexez_stripe_connection')
      if (str) status.stripe = JSON.parse(str)
      const sh = localStorage.getItem('nexez_shopify_connection')
      const browserShopify = sh ? JSON.parse(sh) as { lastImport?: unknown } : null
      status.shopify = resolveShopifyIntegrationStatus(initial.shopifyConnection, {
        present: Boolean(browserShopify),
        lastImport: typeof browserShopify?.lastImport === 'string' ? browserShopify.lastImport : null,
      })
      const sq = localStorage.getItem('nexez_square_connection')
      if (sq) status.square = JSON.parse(sq)
      const ac = localStorage.getItem('nexez_acuity_connection')
      if (ac) status.acuity = JSON.parse(ac)
      setIntegrationStatus(status)
    } catch {}
  }, [initial.shopifyConnection])

  // Arrival from the create wizard after publishing a new page. The public
  // page opens separately; the creator lands here to keep working.
  useEffect(() => {
    if (typeof window === 'undefined') return
    const url = new URL(window.location.href)
    if (url.searchParams.get('created') !== '1') return

    const publicSlug = url.searchParams.get('public')
    setMessage(publicSlug
      ? `Listing published. The public listing opened in a new tab. If your browser blocked it, use "View public listing" here.`
      : 'Listing published. Continue editing here, or use "View public listing" to inspect the live listing.')

    url.searchParams.delete('created')
    url.searchParams.delete('public')
    window.history.replaceState({}, '', `${url.pathname}${url.search}${url.hash}`)
  }, [])

  // Auto-trigger reanalysis preview when arriving from Settings "Re-sync".
  useEffect(() => {
    if (typeof window === 'undefined') return
    const search = new URLSearchParams(window.location.search)
    if (search.get('reanalyzed') === 'true') {
      const structured = sessionStorage.getItem('nexez_imported_structured')
      if (structured) {
        try {
          const incoming = JSON.parse(structured) as OfferItem[]
          const { newCount, updateCount } = countOfferChanges(servicesOffers, incoming)
          setPendingReanalysis({
            incomingServices: incoming,
            incomingProducts: [],
            summary: `${newCount} new offers, ${updateCount} potential updates from your website.`,
          })
          setMessage('Review the imported changes from your site below.')
        } catch {}
      }
      sessionStorage.removeItem('nexez_imported_structured')
      sessionStorage.removeItem('nexez_imported_page')
      window.history.replaceState({}, '', window.location.pathname)
    }
  }, [id, servicesOffers.length])

  // Version restore handoff from Settings history - populate state from snapshot.
  useEffect(() => {
    if (typeof window === 'undefined') return
    const search = new URLSearchParams(window.location.search)
    if (search.get('restore') === 'true') {
      const raw = sessionStorage.getItem('nexez_restore_version')
      if (raw) {
        try {
          const v = JSON.parse(raw) as any
          if (v.name) setName(v.name)
          if (typeof v.description === 'string') setDescription(v.description)
          if (v.industry) setIndustry(v.industry)
          if (typeof v.prefer_original_site === 'boolean') setPreferOriginalSite(v.prefer_original_site)
          const svc = Array.isArray(v.services) ? (v.services as OfferItem[]) : []
          const prod = Array.isArray(v.products) ? (v.products as OfferItem[]) : []
          setServicesOffers(svc)
          setProductsOffers(prod)
          setServices(formatOfferLines(svc))
          setProducts(formatOfferLines(prod))
          if (Array.isArray(v.faqs)) setFaqs(formatFaqLines(v.faqs))
          setRestoredVersion(v)
          setMessage('Restored from previous version. Review the offers in the Visual Builder, then Save to persist as current.')
        } catch {}
      }
      sessionStorage.removeItem('nexez_restore_version')
      window.history.replaceState({}, '', window.location.pathname)
    }
  }, [id])

  async function optimizeOffersWithAI() {
    if (!aiFeaturesEnabled) {
      setMessage('AI optimization is available on the Launch plan and above.')
      return
    }
    const currentServices = parsedServices
    const currentProducts = parsedProducts
    const allOffers = [...currentServices, ...currentProducts]
    if (allOffers.length === 0) {
      setMessage('Add at least one offer before running AI optimization.')
      return
    }
    const businessName = name || 'This business'
    const buyer = audience || 'qualified buyers'
    setAiBusy(true)
    setMessage('Optimizing offers…')
    try {
      const result = await requestAiEnhancement({
        operation: 'optimize_offers',
        pageId: id,
        businessName,
        audience: buyer,
        offers: allOffers,
      })
      if (!Array.isArray(result.offers) || result.offers.length !== allOffers.length) {
        setMessage('AI optimization returned an incomplete result. Nothing changed.')
        return
      }
      const nextServices = mergeOfferCollectionPreservingConfiguration(
        currentServices,
        result.offers.slice(0, currentServices.length),
      )
      const nextProducts = mergeOfferCollectionPreservingConfiguration(
        currentProducts,
        result.offers.slice(currentServices.length),
      )
      setServicesOffers(nextServices)
      setProductsOffers(nextProducts)
      setServices(formatOfferLines(nextServices))
      setProducts(formatOfferLines(nextProducts))
      setMessage('Offers rewritten for AI agents.')
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'AI optimization could not be completed.')
    } finally {
      setAiBusy(false)
    }
  }

  async function enhanceDescriptionWithAI() {
    if (!aiFeaturesEnabled) {
      setMessage('AI optimization is available on the Launch plan and above.')
      return
    }
    const businessName = name || 'This business'
    const buyer = audience || 'buyers evaluating services'
    setAiBusy(true)
    setMessage('Enhancing listing summary…')
    try {
      const result = await requestAiEnhancement({
        operation: 'enhance_description',
        pageId: id,
        businessName,
        audience: buyer,
        description,
      })
      if (typeof result.enhanced !== 'string' || !result.enhanced.trim()) {
        setMessage('AI enhancement returned no copy. Nothing changed.')
        return
      }
      setDescription(result.enhanced)
      setMessage('Description enhanced for agent readability.')
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'AI optimization could not be completed.')
    } finally {
      setAiBusy(false)
    }
  }

  async function enhanceAllOffers() {
    if (!aiFeaturesEnabled) {
      setMessage('AI optimization is available on the Launch plan and above.')
      return
    }
    const currentServices = parsedServices
    const currentProducts = parsedProducts
    const allOffers = [...currentServices, ...currentProducts]
    if (allOffers.length === 0) {
      setMessage('Add at least one offer before enhancing descriptions.')
      return
    }
    const bn = name || 'This business'
    const aud = audience || 'qualified buyers'
    setAiBusy(true)
    setMessage('Enhancing offer descriptions…')
    try {
      const result = await requestAiEnhancement({
        operation: 'enhance_offers',
        pageId: id,
        businessName: bn,
        audience: aud,
        offers: allOffers,
      })
      if (!Array.isArray(result.offers) || result.offers.length !== allOffers.length) {
        setMessage('AI enhancement returned an incomplete result. Nothing changed.')
        return
      }
      const enhancedServices = mergeOfferCollectionPreservingConfiguration(
        currentServices,
        result.offers.slice(0, currentServices.length),
      )
      const enhancedProducts = mergeOfferCollectionPreservingConfiguration(
        currentProducts,
        result.offers.slice(currentServices.length),
      )
      setServicesOffers(enhancedServices)
      setProductsOffers(enhancedProducts)
      setServices(formatOfferLines(enhancedServices))
      setProducts(formatOfferLines(enhancedProducts))
      setMessage('All offer descriptions enhanced for AI agents.')
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'AI optimization could not be completed.')
    } finally {
      setAiBusy(false)
    }
  }

  async function handleSyncFromWebsite() {
    if (!websiteUrl) {
      setMessage('No website URL set on this listing.')
      return
    }
    setSyncing(true)
    setMessage('')
    try {
      const res = await fetch('/api/tools/import-site', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: websiteUrl, industry, pageId: page.id }),
      })
      const data = await res.json()
      if (!res.ok || !data.suggestedPage) {
        setMessage(data.error || 'Failed to sync from website.')
        return
      }
      if (data.suggestedPage.description) setDescription(data.suggestedPage.description)

      if (data.structuredOffers && data.structuredOffers.length > 0) {
        const merged = smartMergeOffers(servicesOffers, data.structuredOffers as OfferItem[], 'all')
        setServicesOffers(merged)
        setServices(formatOfferLines(merged))
      } else if (data.suggestedPage.services) {
        const newServices = data.suggestedPage.services
        const currentServices = services.trim()
        setServices(currentServices ? `${currentServices}\n${newServices}` : newServices)
      }
      setMessage('Synced successfully from your website (rich fields where detected). Review in the Visual Builder.')
    } catch {
      setMessage('Error syncing from website.')
    } finally {
      setSyncing(false)
    }
  }

  async function startReanalysis() {
    if (!websiteUrl) {
      setMessage('No website URL set on this listing.')
      return
    }
    setSyncing(true)
    setMessage('')
    setPendingReanalysis(null)
    try {
      const res = await fetch('/api/tools/import-site', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: websiteUrl, industry, pageId: page.id }),
      })
      const data = await res.json()
      if (!res.ok || !data.structuredOffers) {
        setMessage(data.error || 'Failed to re-analyze the website.')
        return
      }
      const incomingServices = (data.structuredOffers as OfferItem[]).filter((o: any) => !o.kind || o.kind === 'services')
      const incomingProducts = (data.structuredOffers as OfferItem[]).filter((o: any) => o.kind === 'products')
      const { newCount, updateCount } = countOfferChanges(servicesOffers, incomingServices)
      setPendingReanalysis({
        incomingServices,
        incomingProducts,
        summary: `${newCount} new offers, ${updateCount} potential updates detected.`,
      })
      setMessage('Review the proposed changes below before applying.')
    } catch {
      setMessage('Error re-analyzing the website.')
    } finally {
      setSyncing(false)
    }
  }

  function applyPendingReanalysis(mode: 'all' | 'new' = 'all') {
    if (!pendingReanalysis) return
    const { incomingServices } = pendingReanalysis
    const merged = smartMergeOffers(servicesOffers, incomingServices, mode)
    setServicesOffers(merged)
    setServices(formatOfferLines(merged))
    setPendingReanalysis(null)

    // Stripe-sourced prices are already fresh in `merged`, so this count is
    // effectively 0 - preserved from the original for behavioral parity.
    const stripePriceChanges = incomingServices.filter(
      (inc) =>
        inc.source === 'stripe' &&
        merged.some((m) => m.name.toLowerCase() === inc.name.toLowerCase() && m.price !== inc.price),
    ).length
    const baseMsg = 'Changes applied successfully. Review in the Visual Builder.'
    setMessage(
      stripePriceChanges > 0
        ? `${baseMsg} (${stripePriceChanges} Stripe price change(s) applied from integration.)`
        : baseMsg,
    )
  }

  function cancelPendingReanalysis() {
    setPendingReanalysis(null)
    setMessage('Re-analysis discarded.')
  }

  async function persistEditorUpdate(payload: Record<string, unknown>, successMessage: string) {
    if (writeInProgress.current) return
    if (!page.owner_id || !page.updated_at) {
      setMessage('Reload this listing before saving. Its current version could not be verified.')
      return
    }
    writeInProgress.current = true
    setSaving(true)
    setMessage('')
    try {
      // RLS authorizes the caller. These filters prevent a stale editor from
      // overwriting a newer row or a page whose owner changed while it was open.
      // Return the database timestamp, never a client-created version token.
      const { data, error } = await createClient().from('pages')
        .update(payload)
        .eq('id', page.id)
        .eq('owner_id', page.owner_id)
        .eq('updated_at', page.updated_at)
        .select(OWNER_PAGE_SELECT)
        .maybeSingle<AgentPage>()
      if (error) setMessage(publicIdentifierDatabaseMessage(error) || publishErrorMessage(error))
      else if (!data) setMessage('This listing changed or your access ended. Keep a copy of your edits, then reload the listing.')
      else {
        setPage(data)
        setMessage(successMessage)
      }
    } catch {
      setMessage('The connection was interrupted. Reload the listing to check whether your update was saved before trying again.')
    } finally {
      writeInProgress.current = false
      setSaving(false)
    }
  }

  async function handleSubmit(event: React.FormEvent) {
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
    const { payload } = buildSavePayload(saveInput(), (page as any).versions || [])
    await persistEditorUpdate(payload, 'Saved. Version snapshot created.')
  }

  async function handleSaveDraft() {
    if (!page) return
    if (page.draft != null && !isSupportedPageDraft(page.draft)) {
      setMessage('This saved draft uses an unsupported format. It has been kept intact; contact support to recover it.')
      return
    }
    const draft = buildDraftContent(saveInput())
    const draftUpdatedAt = new Date().toISOString()
    await persistEditorUpdate({ draft, draft_updated_at: draftUpdatedAt }, 'Draft saved (staged). Preview it on your listing, then Publish to go live.')
  }

  async function handlePublishDraft() {
    if (!page) return
    const draft = page.draft
    if (!draft) {
      setMessage('No draft to publish.')
      return
    }
    if (!isSupportedPageDraft(draft)) {
      setMessage('This saved draft uses an unsupported format. It has been kept intact; contact support to recover it.')
      return
    }
    await persistEditorUpdate({ ...draftToLiveUpdate(draft), draft: null, draft_updated_at: null },
      page.is_published ? 'Draft published to your live listing.' : 'Draft applied. Publish the listing when you are ready to make it public.')
  }

  async function duplicateThisPage() {
    if (!page) return
    setMessage('Duplicating…')
    // Server route: clones under the PAGE OWNER (so an editor-collaborator's copy lands
    // in the owner's workspace, not the editor's own account). Authorizes owner/editor.
    try {
      const res = await fetch('/api/pages/duplicate', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ pageId: page.id }),
      })
      const data = (await res.json().catch(() => ({}))) as { id?: string; error?: string }
      if (!res.ok || !data.id) {
        setMessage(`Could not duplicate: ${data.error ?? 'unknown error'}`)
        return
      }
      window.location.href = `/dashboard/${data.id}`
    } catch {
      setMessage('Could not duplicate - try again.')
    }
  }

  // Re-sync a connected integration from its STORED credential - no token
  // prompt. Routes through the unified per-listing sync engine (saves server-
  // side, safe source-scoped merge), then reloads to show the result. Connect /
  // disconnect live in Settings -> Integrations.
  async function resyncIntegration(provider: ResyncProvider) {
    if (!id) return
    if (provider === 'stripe') {
      setMessage('Stripe is managed from Settings → Integrations (prices auto-sync from your Stripe account).')
      return
    }
    if (provider === 'shopify' && !shopifyConnectionCanSync(integrationStatus.shopify?.kind, integrationsEnabled)) {
      setMessage(
        integrationStatus.shopify?.kind === 'other'
          ? 'That was a one-time public catalog import, not a live Shopify connection. Install the Shopify app or connect Admin credentials in Settings.'
          : 'Manual Shopify Admin sync is paused. Upgrade to Pro, or install the Shopify app on any plan.',
      )
      return
    }
    if (!integrationsEnabled && provider !== 'shopify') {
      setMessage('Premium integration sync is paused. Upgrade to Pro to resume live imports.')
      return
    }
    setIntegrationResyncing(provider)
    try {
      const res = await fetch(`/api/pages/${id}/integrations/${provider}/sync`, { method: 'POST' })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        // 400 here means "not connected" -> the message points to Settings.
        setMessage(data.error || `${RESYNC_LABELS[provider]} sync failed.`)
        return
      }
      setMessage(`Synced ${data.imported ?? 0} ${RESYNC_LABELS[provider]} offer(s) from the saved connection - reloading…`)
      setTimeout(() => window.location.reload(), 600)
    } catch (err: any) {
      setMessage(`${RESYNC_LABELS[provider]} sync failed: ${err.message}`)
    } finally {
      setIntegrationResyncing(null)
    }
  }

  async function sendTestBooking() {
    if (!integrationsEnabled) {
      setMessage('Calendly automation is paused. Upgrade to Pro to send a test booking.')
      return
    }
    try {
      const demoSecret = `nexez-test-${Date.now()}`
      const res = await fetch('/api/webhooks/calendly', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-nexez-test-secret': demoSecret,
          'x-nexez-test-page-slug': slug || page?.slug || '',
          'x-nexez-test-mode': 'true',
        },
        body: JSON.stringify({
          event: 'invitee.created',
          payload: {
            invitee: { name: 'Test Booker', email: 'test@nexez.app' },
            event: { name: 'Test Consultation', start_time: new Date().toISOString() },
          },
        }),
      })
      if (res.ok) {
        const sb = createClient()
        const { data: freshPage } = await sb.from('pages').select('last_booking').eq('id', id).single()
        if ((freshPage as any)?.last_booking) setLastBooking((freshPage as any).last_booking)
        const { data: events } = await sb
          .from('checkout_events')
          .select('*')
          .eq('slug', slug || page?.slug || '')
          .contains('metadata', { source: 'calendly_webhook' })
          .order('created_at', { ascending: false })
          .limit(3)
        if (events) setRecentCalendlyBookings(events)
        setMessage('Test booking recorded. Connected webhook URLs were notified.')
      }
    } catch {
      setMessage('Test webhook failed. Check the booking settings and try again.')
    }
  }

  async function requestTeamApproval() {
    if (!page?.id) {
      setMessage('Save this listing before requesting approval.')
      return
    }
    try {
      const teamCollaboration = await mutateTeamApproval({
        pageId: page.id,
        action: 'request',
        note: 'Current saved listing is ready for review',
      })
      setPage((current) => ({ ...(current as AgentPage), team_collaboration: teamCollaboration } as AgentPage))
      setMessage('Approval request saved. Manage it in Settings → Team & history.')
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Team approval could not be requested.')
    }
  }

  return {
    id,
    page,
    // status
    saving,
    syncing,
    integrationResyncing,
    message,
    setMessage,
    score,
    // form state + setters
    name,
    setName,
    slug,
    setSlug,
    slugValidation,
    slugAvailability,
    description,
    setDescription,
    websiteUrl,
    setWebsiteUrl,
    ctaUrl,
    setCtaUrl,
    ctaLabel,
    setCtaLabel,
    audience,
    setAudience,
    location,
    setLocation,
    contactEmail,
    setContactEmail,
    industry,
    setIndustry,
    preferOriginalSite,
    setPreferOriginalSite,
    nextAvailable,
    setNextAvailable,
    googleCalendarId,
    products,
    setProducts,
    services,
    setServices,
    faqs,
    setFaqs,
    servicesOffers,
    setServicesOffers,
    productsOffers,
    setProductsOffers,
    isPublished,
    setIsPublished,
    parsedServices,
    parsedProducts,
    // reanalysis + restore
    pendingReanalysis,
    restoredVersion,
    setRestoredVersion,
    // events / integrations
    recentCalendlyBookings,
    lastBooking,
    recentOutboundFires,
    trustEvents,
    integrationStatus,
    aiFeaturesEnabled,
    integrationsEnabled,
    outboundWebhooksEnabled,
    teamCollaborationEnabled,
    negotiationEnabled,
    aiBusy,
    // handlers
    optimizeOffersWithAI,
    enhanceDescriptionWithAI,
    enhanceAllOffers,
    handleSyncFromWebsite,
    startReanalysis,
    applyPendingReanalysis,
    cancelPendingReanalysis,
    handleSubmit,
    handleSaveDraft,
    handlePublishDraft,
    duplicateThisPage,
    resyncIntegration,
    sendTestBooking,
    requestTeamApproval,
  }
}

export type PageEditor = ReturnType<typeof usePageEditor>
