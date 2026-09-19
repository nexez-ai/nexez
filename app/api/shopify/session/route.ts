import { NextResponse } from 'next/server'
import { enforceRateLimit } from '../../../../lib/rate-limit'
import { appUrl } from '../../../../lib/site'
import type { OfferItem } from '../../../../lib/agent-page'
import { shopifyCatalogPreview } from '../../../../lib/shopify-catalog-preview'
import { hasSecretCryptoKey } from '../../../../lib/server/secret-crypto'
import { shopifyApiKey, shopifyConfigured, verifyShopifySessionToken } from '../../../../lib/server/shopify'
import { ensureShopifySessionInstall, getShopifyInstallCredentialsByShop, issueShopifyLinkToken } from '../../../../lib/server/shopify-install'
import { ensureShopifySalesChannel } from '../../../../lib/server/shopify-channel'
import { shopifyPartnerBillingConfigured, shopifyPricingUrl, verifyShopifyBilling } from '../../../../lib/server/shopify-billing'
import { createAdminClient, hasSupabaseAdminEnv } from '../../../../utils/supabase/admin'

function bearerToken(request: Request): string {
  const authorization = request.headers.get('authorization') || ''
  return authorization.match(/^Bearer\s+(.+)$/i)?.[1]?.trim() || ''
}

function json(body: Record<string, unknown>, status = 200) {
  const response = NextResponse.json(body, { status })
  response.headers.set('cache-control', 'no-store')
  return response
}

/**
 * Embedded app bootstrap. App Bridge automatically attaches a one-minute ID
 * token to this fetch. The server verifies it, establishes rotating offline API
 * credentials through token exchange, and returns only that shop's link state.
 */
export async function POST(request: Request) {
  if (!shopifyConfigured()) return json({ error: 'Shopify app is not configured.' }, 404)
  if (!hasSupabaseAdminEnv() || !hasSecretCryptoKey()) {
    return json({ error: 'Shopify credential storage is unavailable.' }, 503)
  }

  const subjectToken = bearerToken(request)
  const session = verifyShopifySessionToken(subjectToken)
  if (!session) return json({ error: 'Invalid or expired Shopify session.' }, 401)

  const limited = await enforceRateLimit(request, `shopify-session:${session.shop}`, 120, 60_000)
  if (limited) return limited

  try {
    const admin = createAdminClient()
    const install = await ensureShopifySessionInstall(admin, session.shop, subjectToken)
    if (install.mapping_transition_token) {
      return json({ error: 'This Shopify listing change is still finishing. Try again shortly.' }, 409)
    }

    type LinkedPage = {
      id: string; name: string | null; slug: string; is_published: boolean
      products: OfferItem[] | null; services: OfferItem[] | null
    }
    let linkedPage: LinkedPage | null = null
    if (install.page_id) {
      const { data } = await admin
        .from('pages')
        .select('id, name, slug, is_published, products, services')
        .eq('id', install.page_id)
        .eq('owner_id', install.owner_id)
        .maybeSingle<LinkedPage>()
      linkedPage = data ?? null
    }
    const listing = linkedPage ? { id: linkedPage.id, name: linkedPage.name, slug: linkedPage.slug } : null

    const returnedPlanHandle = new URL(request.url).searchParams.get('plan_handle')
    let billing = {
      provider: 'shopify' as const,
      pricingUrl: shopifyPricingUrl(session.shop),
      planHandle: install.shopify_plan_handle ?? null,
      status: install.shopify_billing_status ?? (shopifyPartnerBillingConfigured() ? 'checking' : 'attention'),
      verifiedAt: install.shopify_billing_verified_at ?? null,
    }
    let channel: Awaited<ReturnType<typeof ensureShopifySalesChannel>> | null = null
    let channelError: string | null = null
    const credentials = listing
      ? await getShopifyInstallCredentialsByShop(admin, session.shop)
      : null
    if (listing && credentials) {
      try {
        channel = await ensureShopifySalesChannel(admin, install, credentials, {
          pageId: listing.id,
          accountName: listing.name || listing.slug,
          startFullSync: false,
        })
      } catch (error) {
        console.error('[shopify-session] sales channel verification failed', {
          shop: session.shop,
          error: error instanceof Error ? error.message : String(error),
        })
        channelError = 'Shopify could not verify the Nexez sales channel. Use Sync now to repair it.'
      }
      if (shopifyPartnerBillingConfigured()) {
        const verified = await verifyShopifyBilling(admin, install, credentials, returnedPlanHandle)
        billing = {
          provider: 'shopify',
          pricingUrl: verified.pricingUrl,
          planHandle: verified.planHandle,
          status: verified.status,
          verifiedAt: verified.verifiedAt,
        }
      }
    } else if (listing) {
      channelError = 'Reconnect the Shopify app to repair the sales channel.'
    }

    let connectUrl: string | null = null
    if (!listing) {
      const token = await issueShopifyLinkToken(admin, session.shop)
      connectUrl = appUrl(`/api/shopify/claim?token=${encodeURIComponent(token)}`)
    }

    return json({
      ok: true,
      shop: session.shop,
      state: listing ? 'linked' : 'link_required',
      listing,
      catalog: linkedPage ? {
        published: linkedPage.is_published === true,
        products: shopifyCatalogPreview(linkedPage, session.shop, install.mapping_generation),
      } : null,
      connectUrl,
      billing,
      channel,
      channelError,
      themeEditorUrl: `https://${session.shop}/admin/themes/current/editor?context=apps&template=index&activateAppId=${encodeURIComponent(shopifyApiKey())}/agent-ready`,
      storefrontArtifactUrl: `https://${session.shop}/apps/nexez/agent.json`,
      sync: {
        lastSyncedAt: install.last_synced_at ?? null,
        pending: Boolean(install.catalog_sync_pending_at),
        attempts: Number(install.catalog_sync_attempts || 0),
        error: install.catalog_sync_error ?? null,
      },
    })
  } catch (error) {
    console.error('[shopify-session] bootstrap failed', {
      shop: session.shop,
      error: error instanceof Error ? error.message : String(error),
    })
    return json({ error: 'Nexez could not open this Shopify connection. Try again shortly.' }, 503)
  }
}
