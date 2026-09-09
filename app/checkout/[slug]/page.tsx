import type { Metadata } from 'next'
import { after } from 'next/server'
import { notFound, permanentRedirect, redirect } from 'next/navigation'
import { headers } from 'next/headers'
import {
  ArrowLeft,
  ArrowRight,
  BadgeCheck,
  Bot,
  CheckCircle2,
  CreditCard,
  LockKeyhole,
  Mail,
  ShieldCheck,
  Sparkles,
} from 'lucide-react'
import {
  AgentPage,
  CheckoutOffer,
  PUBLIC_PAGE_SELECT,
  getCheckoutOffer,
  getCheckoutOfferKey,
  getOfferDestination,
  getPreferredOriginalOfferUrl,
  getRequestBaseUrl,
} from '../../../lib/agent-page'
import { parseMoney } from '../../../lib/checkout'
import { getOfferCheckoutPath } from '../../../lib/agent-offer-configuration'
import {
  getOfferCustomerInputs,
  getOfferReservableResourceTerms,
  getOfferStagedSettlementTerms,
} from '../../../lib/configured-offer'
import { normalizeCurrency, toStripeAmount, formatCurrencyAmount, toMajorAmount } from '../../../lib/currency'
import type { OfferInputField } from '../../../lib/offer-configuration'
import { priceValidUntil } from '../../../lib/freshness'
import { logCheckoutEvent } from '../../../lib/server/log-checkout-event'
import { safeJsonScript } from '../../../lib/safe-json'
import { agentRuntimeUrl } from '../../../lib/site'
import { supabase } from '../../../lib/supabase'
import { ApprovedActionForm } from '../../../components/ApprovedActionForm'
import { resolveRenamedPageSlug } from '../../../lib/server/public-identifier'

type PageProps = {
  params: Promise<{ slug: string }>
  searchParams: Promise<{ offer?: string | string[]; missing_checkout?: string | string[] }>
}

async function getPage(slug: string) {
  const { data } = await supabase
    .from('pages_public')
    .select(PUBLIC_PAGE_SELECT)
    .eq('slug', slug)
    .eq('is_published', true)
    .single<AgentPage>()

  return data
}

export async function generateMetadata({ params, searchParams }: PageProps): Promise<Metadata> {
  const [{ slug }, search] = await Promise.all([params, searchParams])
  const page = await getPage(slug)

  if (!page) {
    return {}
  }

  const offer = getCheckoutOffer(page, search.offer)

  return {
    title: `${offer?.name ?? page.name} checkout`,
    description: `Agent-friendly checkout context for ${offer?.name ?? page.name}.`,
    // Thin transactional page: keep it out of the index (it can outrank the
    // listing / read as a soft 404) and canonicalize to the parent listing.
    robots: {
      index: false,
      follow: true,
    },
    alternates: {
      canonical: agentRuntimeUrl(`/${slug}`),
    },
  }
}

export default async function CheckoutPage({ params, searchParams }: PageProps) {
  const [{ slug }, search] = await Promise.all([params, searchParams])
  const page = await getPage(slug)

  if (!page) {
    const renamed = await resolveRenamedPageSlug(slug)
    if (renamed) {
      const query = new URLSearchParams()
      const offer = Array.isArray(search.offer) ? search.offer[0] : search.offer
      const missingCheckout = Array.isArray(search.missing_checkout)
        ? search.missing_checkout[0]
        : search.missing_checkout
      if (offer) query.set('offer', offer)
      if (missingCheckout) query.set('missing_checkout', missingCheckout)
      permanentRedirect(`/checkout/${renamed}${query.size ? `?${query}` : ''}`)
    }
    notFound()
  }

  const offer = getCheckoutOffer(page, search.offer)

  if (!offer) {
    notFound()
  }

  // Legacy/deep checkout links must honor the same original-site preference as
  // the API. Imported Shopify products never render a Nexez/Stripe payment form.
  const originalUrl = getPreferredOriginalOfferUrl(page, offer)
  if (originalUrl) redirect(originalUrl)

  const destination = getOfferDestination(page, offer)
  const offerKey = getCheckoutOfferKey(offer.kind, offer.index)
  const requestHeaders = await headers()
  const baseUrl = getRequestBaseUrl(requestHeaders)
  const checkoutUrl = `${baseUrl}/checkout/${page.slug}?offer=${offerKey}`
  const publicUrl = `${baseUrl}/${page.slug}`
  // Show the buyer the SAME currency + amount the charge will use (the page's
  // settlement currency), not a hardcoded USD - otherwise the displayed price
  // silently mismatches what Stripe charges.
  const currency = normalizeCurrency(page.currency)
  const priceCents = toStripeAmount(parseMoney(offer.price) ?? 0, currency) || null
  const displayPrice = priceCents ? formatCurrencyAmount(priceCents, currency) : offer.price || 'Custom quote'
  const jsonLd = buildCheckoutJsonLd(page, offer, checkoutUrl, destination, priceCents, baseUrl, currency)
  const missingCheckout = Boolean(search.missing_checkout)
  const resourceTerms = getOfferReservableResourceTerms(offer)
  const stagedSettlementTerms = getOfferStagedSettlementTerms(offer)
  const offerInputs = getOfferCustomerInputs(offer)
  const checkoutAction = getOfferCheckoutPath(offer)
  const usesNexezCheckout = checkoutAction !== '/api/checkout'
  const canContinue = usesNexezCheckout ? Boolean(priceCents) : Boolean(priceCents || destination)

  // Non-blocking: record the checkout_view after the response is sent so it
  // never adds latency to the page render.
  const checkoutUserAgent = requestHeaders.get('user-agent')
  const checkoutReferrer = requestHeaders.get('referer')
  after(() =>
    logCheckoutEvent({
      page,
      offer,
      eventType: 'checkout_view',
      userAgent: checkoutUserAgent,
      referrer: checkoutReferrer,
      query: null,
      checkoutUrl,
      providerUrl: destination || null,
      metadata: {
        amount_cents: priceCents,
        source: 'checkout_page_render',
      },
    }),
  )

  return (
    <main className="min-h-screen bg-[#090b10] text-white">
	      <script
	        type="application/ld+json"
	        dangerouslySetInnerHTML={{ __html: safeJsonScript(jsonLd) }}
	      />

      <div className="mx-auto max-w-6xl px-6 py-8">
        <div className="flex flex-col justify-between gap-4 md:flex-row md:items-center">
          <a href={`/${page.slug}`} className="inline-flex items-center gap-2 text-sm text-zinc-400 hover:text-white">
            <ArrowLeft className="size-4" />
            Back to listing
          </a>
          <div className="flex flex-wrap items-center gap-2 text-xs text-zinc-300">
            <StatusPill icon={<ShieldCheck className="size-3.5" />} label="Agent context attached" />
            <StatusPill icon={<LockKeyhole className="size-3.5" />} label="Stripe-ready" />
          </div>
        </div>

        <section className="mt-8 overflow-hidden card !p-0 border border-white/10 bg-gradient-to-br from-[var(--panel)] via-[var(--bg-2)] to-[var(--panel)]">
          <div className="border-b border-white/10 px-6 py-8 text-center md:px-10">
            <p className="text-sm font-medium text-[var(--signal)]">Powered by Nexez + payment provider</p>
            <h1 className="mt-3 text-4xl font-semibold tracking-tight md:text-5xl">
              Secure Checkout - AI Agent Friendly
            </h1>
          </div>

          <div className="grid gap-0 lg:grid-cols-[0.95fr_1.05fr]">
            <section className="border-b border-white/10 p-6 md:p-8 lg:border-b-0 lg:border-r">
              <div className="flex items-start justify-between gap-5">
                <div>
                  <p className="text-sm text-zinc-400">Order Summary</p>
                  <h2 className="mt-2 text-2xl font-semibold">{offer.name}</h2>
                </div>
                <div className="rounded-full border border-[var(--amber)]/30 bg-[var(--amber)]/10 px-3 py-2 text-xs font-semibold text-[var(--amber)]">
                  SSL
                </div>
              </div>

              <div className="mt-7 space-y-4 text-sm">
                <DetailRow label="Provider" value={page.name} />
                <DetailRow label="Offer type" value={offer.kind === 'services' ? 'Service' : 'Product'} />
                <DetailRow label="Buyer fit" value={page.audience || 'Qualified buyer or authorized agent'} />
                <DetailRow label="Service area" value={page.location || 'Online or by request'} />
              </div>

              {offer.description ? (
                <p className="mt-6 rounded-lg border border-white/10 bg-black/20 p-4 text-sm leading-6 text-zinc-300">
                  {offer.description}
                </p>
              ) : null}

              {/* Phase 1 A: Show consumer service details on checkout for bookable services */}
              {(offer.duration || offer.serviceArea || offer.isMobile || offer.travelFee) && (
                <div className="mt-4 flex flex-wrap gap-2 text-xs">
                  {offer.duration && <span className="rounded bg-white/5 px-2 py-0.5 border border-white/10">{offer.duration}</span>}
                  {offer.serviceArea && <span className="rounded bg-white/5 px-2 py-0.5 border border-white/10">{offer.serviceArea}</span>}
                  {offer.isMobile && <span className="rounded bg-[var(--ready)]/10 px-2 py-0.5 border border-[var(--ready)]/30 text-[var(--ready)]">Mobile / on-site</span>}
                  {offer.travelFee && <span className="rounded bg-white/5 px-2 py-0.5 border border-white/10">+ {offer.travelFee} travel</span>}
                </div>
              )}

              <div className="mt-7 space-y-3 border-t border-white/10 pt-6 text-sm">
                <DetailRow label="Subtotal" value={displayPrice} />
                <DetailRow
                  label="Processing"
                  value={priceCents ? 'Stripe Checkout when configured' : destination ? 'Handled by provider' : 'Needs price or checkout URL'}
                />
                <DetailRow label="Total" value={displayPrice} strong />
              </div>

              {resourceTerms ? (
                <div className="mt-6 rounded-lg border border-[var(--ready)]/25 bg-[var(--ready)]/10 p-4 text-sm leading-6 text-zinc-200">
                  <p className="font-medium text-[var(--ready)]">Availability is checked live</p>
                  <p className="mt-1 text-zinc-300">
                    Nothing is fabricated or pre-claimed. Continue checks the merchant’s authoritative capacity and
                    creates a temporary hold before Stripe opens. Payment commits that exact allocation.
                  </p>
                </div>
              ) : null}

              {stagedSettlementTerms ? (
                <div className="mt-6 rounded-lg border border-[var(--amber)]/25 bg-[var(--amber)]/10 p-4 text-sm leading-6 text-zinc-200">
                  <p className="font-medium text-[var(--amber)]">Each stage needs fresh buyer approval</p>
                  <p className="mt-1 text-zinc-300">
                    Continue opens only the first payment stage. Later stages remain locked until the merchant marks
                    them ready and the buyer approves each payment separately.
                  </p>
                </div>
              ) : null}

              <label className="mt-7 flex items-center gap-3 text-sm text-zinc-300">
                <input type="checkbox" defaultChecked className="size-5 accent-[var(--signal)]" />
                Request human review for high-value or custom purchases
              </label>
            </section>

            <section className="p-6 md:p-8">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="text-sm text-zinc-400">Payment Step</p>
                  <h2 className="mt-2 text-2xl font-semibold">Provider checkout</h2>
                </div>
                <StatusPill icon={<BadgeCheck className="size-3.5" />} label="Agent-authenticated" />
              </div>

              <div className="mt-7 rounded-xl border border-white/10 bg-black/20 p-5">
                <div className="flex items-start gap-3">
                  <LockKeyhole className="mt-0.5 size-5 shrink-0 text-[var(--ready)]" />
                  <div>
                    <p className="font-medium">You’ll pay securely on Stripe</p>
                    <p className="mt-1 text-sm leading-6 text-zinc-400">
                      No card details are entered or stored on Nexez. Continue to complete payment on Stripe’s secure
                      checkout - your selected offer and buyer context are passed along, and the seller is paid directly.
                    </p>
                  </div>
                </div>
              </div>

              <div className="mt-6 rounded-lg border border-[var(--signal)]/20 bg-[var(--signal)]/10 p-4">
                <div className="flex items-start gap-3">
                  <Bot className="mt-1 size-5 text-[var(--signal)]" />
                  <p className="text-sm leading-6 text-zinc-200">
                    Buyer intent, selected offer, provider URL, and listing context are packaged for the payment handoff.
                  </p>
                </div>
              </div>

              {missingCheckout ? (
                <div className="mt-4 rounded-lg border border-[var(--amber)]/20 bg-[var(--amber)]/10 p-3 text-sm text-[var(--amber)]">
                  Stripe is not configured yet and this offer has no provider URL, so checkout needs a payment destination.
                </div>
              ) : null}

              {canContinue ? (
                <ApprovedActionForm action={checkoutAction} className="mt-6">
                  <input type="hidden" name="slug" value={page.slug} />
                  <input type="hidden" name="offer" value={offerKey} />
                  <input type="hidden" name="query" value="agent_checkout_confirm" />
                  {offerInputs.length ? (
                    <div className="mb-5 grid gap-4 text-left">
                      {offerInputs.map((field) => <OfferConfigurationField key={field.key} field={field} />)}
                    </div>
                  ) : null}
                  <button
                    type="submit"
                    className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-[var(--signal)] px-5 py-4 text-sm font-semibold text-zinc-950 hover:bg-[var(--signal)]"
                  >
                    {resourceTerms
                      ? 'Check availability & Continue'
                      : stagedSettlementTerms
                        ? 'Review first stage & Continue'
                        : 'Confirm & Continue'}
                    <ArrowRight className="size-4" />
                  </button>
                </ApprovedActionForm>
              ) : (
                <button
                  disabled
                  className="mt-6 inline-flex w-full items-center justify-center gap-2 rounded-lg bg-zinc-700 px-5 py-4 text-sm font-semibold text-zinc-300"
                >
                  Add checkout URL to continue
                </button>
              )}

              <div className="mt-6 grid gap-3 text-sm md:grid-cols-3">
                <Signal icon={<CheckCircle2 className="size-4" />} label="Offer parsed" />
                <Signal icon={<CreditCard className="size-4" />} label={resourceTerms ? 'Hold before payment' : 'Tokenized handoff'} />
                <Signal icon={<Mail className="size-4" />} label={resourceTerms ? 'Commit after payment' : 'Review optional'} />
              </div>
            </section>
          </div>
        </section>

        <section className="mt-6 grid gap-6 lg:grid-cols-[0.8fr_1.2fr]">
          <div className="card !p-5">
            <div className="flex items-center gap-2 text-[var(--signal)]">
              <Sparkles className="size-5" />
              <h2 className="font-semibold">Agent Handoff</h2>
            </div>
            <p className="mt-4 text-sm leading-6 text-zinc-400">
              This route gives AI buyers one stable URL for the selected offer, the public source listing, and the
              provider action URL.
            </p>
            <div className="mt-5 space-y-3 text-sm">
              <DetailRow label="Checkout URL" value={checkoutUrl} />
              <DetailRow label="Source listing" value={publicUrl} />
              <DetailRow label="Action URL" value={usesNexezCheckout ? checkoutAction : destination || 'Not configured'} />
            </div>
          </div>

          <pre className="overflow-x-auto rounded-lg border border-white/10 bg-black p-5 text-xs leading-6 text-[var(--signal)]">
{JSON.stringify(
  {
    checkoutUrl,
    sourcePage: publicUrl,
    seller: page.name,
    offer: {
      name: offer.name,
      type: offer.kind === 'services' ? 'service' : 'product',
      price: offer.price || null,
      description: offer.description || null,
    },
    buyerFit: page.audience || null,
    contactEmail: page.contact_email || null,
    actionUrl: usesNexezCheckout ? checkoutAction : destination || null,
  },
  null,
  2,
)}
          </pre>
        </section>
      </div>
    </main>
  )
}

function StatusPill({ icon, label }: { icon: React.ReactNode; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-white/10 px-3 py-1.5">
      <span className="text-[var(--signal)]">{icon}</span>
      {label}
    </span>
  )
}

function DetailRow({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="flex items-start justify-between gap-4">
      <span className="text-zinc-500">{label}</span>
      <span className={`max-w-[68%] text-right ${strong ? 'text-xl font-semibold text-white' : 'text-zinc-200'}`}>
        {value}
      </span>
    </div>
  )
}

function Signal({ icon, label }: { icon: React.ReactNode; label: string }) {
  return (
    <div className="flex items-center gap-2 card !p-3 text-zinc-300">
      <span className="text-[var(--signal)]">{icon}</span>
      {label}
    </div>
  )
}

function OfferConfigurationField({ field }: { field: OfferInputField }) {
  const name = `offerConfiguration.${field.valueType}.${field.key}`
  const shared = {
    id: `offer-configuration-${field.key}`,
    name,
    required: field.required,
    className: 'mt-2 w-full rounded-lg border border-white/15 bg-black/30 px-3 py-3 text-white outline-none focus:border-[var(--signal)]',
  }

  let control: React.ReactNode
  if (field.valueType === 'single-select' || field.valueType === 'multi-select') {
    control = (
      <select {...shared} multiple={field.valueType === 'multi-select'} defaultValue={field.valueType === 'multi-select' ? [] : ''}>
        {field.valueType === 'single-select' ? <option value="">Select one</option> : null}
        {(field.options ?? []).map((option) => (
          <option key={option.value} value={option.value}>{option.label}</option>
        ))}
      </select>
    )
  } else if (field.valueType === 'boolean') {
    control = (
      <select {...shared} defaultValue="">
        <option value="">Select yes or no</option>
        <option value="true">Yes</option>
        <option value="false">No</option>
      </select>
    )
  } else {
    const type = field.valueType === 'date'
      ? 'date'
      : field.valueType === 'date-time'
        ? 'datetime-local'
        : field.valueType === 'number' || field.valueType === 'quantity'
          ? 'number'
          : field.valueType === 'asset'
            ? 'url'
            : 'text'
    control = (
      <input
        {...shared}
        type={type}
        step={field.valueType === 'quantity' ? 1 : field.valueType === 'number' ? 'any' : undefined}
        min={field.valueType === 'quantity' ? 1 : undefined}
        placeholder={field.askBuyer}
      />
    )
  }

  return (
    <label htmlFor={shared.id} className="block text-sm text-zinc-200">
      <span className="font-medium">{field.label}{field.required ? ' *' : ''}</span>
      {field.description ? <span className="mt-1 block text-xs leading-5 text-zinc-400">{field.description}</span> : null}
      {control}
    </label>
  )
}

function buildCheckoutJsonLd(
  page: AgentPage,
  offer: CheckoutOffer,
  checkoutUrl: string,
  destination: string,
  priceCents: number | null,
  baseUrl: string,
  currency: string,
) {
  return {
    '@context': 'https://schema.org',
    '@type': 'WebPage',
    name: `${offer.name} checkout`,
    url: checkoutUrl,
    isPartOf: {
      '@type': 'WebPage',
      name: page.name,
      url: `${baseUrl}/${page.slug}`,
    },
    mainEntity: {
      '@type': 'Offer',
      name: offer.name,
      description: offer.description || undefined,
      price: priceCents ? toMajorAmount(priceCents, currency) : undefined,
      priceCurrency: priceCents ? currency.toUpperCase() : undefined,
      priceValidUntil: priceCents ? priceValidUntil(page) || undefined : undefined,
      url: checkoutUrl,
      seller: {
        '@type': 'Organization',
        name: page.name,
        url: page.website_url || `${baseUrl}/${page.slug}`,
        email: page.contact_email || undefined,
      },
    },
    potentialAction: destination
      ? {
          '@type': 'BuyAction',
          target: destination,
          object: offer.name,
        }
      : undefined,
  }
}
