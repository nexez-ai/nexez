import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { shopifyApiKey, shopifyConfigured, signPendingShop, verifyShopifyOAuthHmac } from '../../../../lib/server/shopify'
import { resolveShopDomain } from '../../../../lib/server/integration-importers'
import { upsertInstall } from '../../../../lib/server/shopify-install'
import { appUrl } from '../../../../lib/site'
import { createClient } from '../../../../utils/supabase/server'
import { createAdminClient, hasSupabaseAdminEnv } from '../../../../utils/supabase/admin'
import { hasSecretCryptoKey } from '../../../../lib/server/secret-crypto'

const TOKEN_EXCHANGE_TIMEOUT_MS = 10_000

/**
 * Shopify OAuth callback: verifies the request HMAC + CSRF `state`, exchanges the
 * code for an OFFLINE access token (host-pinned to the myshopify.com shop, no
 * redirect follow), encrypts + stores it in `shopify_installs`, and sends the
 * merchant into the app to link the install to a Nexez listing. INERT (404)
 * until SHOPIFY_API_KEY/SECRET are set.
 */
export async function GET(request: Request) {
  if (!shopifyConfigured()) {
    return NextResponse.json({ error: 'Shopify app is not configured.' }, { status: 404 })
  }
  if (!hasSupabaseAdminEnv() || !hasSecretCryptoKey()) {
    return NextResponse.json({ error: 'Shopify credential storage is not configured.' }, { status: 503 })
  }
  const params = new URL(request.url).searchParams
  const shop = resolveShopDomain(params.get('shop') || '')
  if (!shop) {
    return NextResponse.json({ error: 'Invalid shop parameter.' }, { status: 400 })
  }
  if (!verifyShopifyOAuthHmac(params)) {
    return NextResponse.json({ error: 'HMAC verification failed.' }, { status: 401 })
  }

  const jar = await cookies()
  const expectedState = jar.get('shopify_oauth_state')?.value
  const state = params.get('state')
  if (!expectedState || !state || expectedState !== state) {
    return NextResponse.json({ error: 'Invalid OAuth state.' }, { status: 401 })
  }
  const code = params.get('code')
  if (!code) {
    return NextResponse.json({ error: 'Missing authorization code.' }, { status: 400 })
  }

  let token = ''
  let refreshToken = ''
  let expiresIn = 0
  let refreshTokenExpiresIn = 0
  let scope = ''
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TOKEN_EXCHANGE_TIMEOUT_MS)
  try {
    const body = new URLSearchParams({
      client_id: shopifyApiKey(),
      client_secret: process.env.SHOPIFY_API_SECRET || '',
      code,
      expiring: '1',
    })
    const res = await fetch(`https://${shop}/admin/oauth/access_token`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
      body,
      redirect: 'error',
      signal: controller.signal,
    })
    if (!res.ok) return NextResponse.json({ error: 'Token exchange failed.' }, { status: 502 })
    const json = (await res.json()) as {
      access_token?: string
      refresh_token?: string
      expires_in?: number
      refresh_token_expires_in?: number
      scope?: string
    }
    token = String(json.access_token || '')
    refreshToken = String(json.refresh_token || '')
    expiresIn = Number(json.expires_in || 0)
    refreshTokenExpiresIn = Number(json.refresh_token_expires_in || 0)
    scope = String(json.scope || '')
  } catch {
    return NextResponse.json({ error: 'Token exchange error.' }, { status: 502 })
  } finally {
    clearTimeout(timer)
  }
  if (!token || !refreshToken || expiresIn <= 0 || refreshTokenExpiresIn <= 0) {
    return NextResponse.json({ error: 'Shopify did not return rotating offline credentials.' }, { status: 502 })
  }

  // Link the install to the signed-in Nexez owner if there is one (the OAuth
  // proved Shopify-admin control of the shop; the session identifies the owner).
  // If not signed in, the install stays unlinked and is claimed on the linking
  // page after login. owner_id is only written when known (undefined → preserved).
  let ownerId: string | null = null
  try {
    const { data } = await createClient(jar).auth.getUser()
    ownerId = data.user?.id ?? null
  } catch {
    /* not signed in */
  }

  try {
    await upsertInstall(createAdminClient(), {
      shop,
      offlineToken: token,
      refreshToken,
      expiresIn,
      refreshTokenExpiresIn,
      scope,
      ownerId: ownerId ?? undefined,
    })
  } catch {
    return NextResponse.json({ error: 'Could not save the Shopify installation.' }, { status: 503 })
  }
  jar.delete('shopify_oauth_state')
  // Signed proof that THIS browser just installed THIS shop → authorizes the
  // shop→listing link on the isolated /shopify/link surface (a client can't
  // forge it and the free connector never enters Nexez billing UI).
  jar.set('shopify_pending_shop', signPendingShop(shop), {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: 3600,
  })
  const dest = ownerId ? '/shopify/link' : '/login?next=/shopify/link'
  return NextResponse.redirect(appUrl(dest), 302)
}
