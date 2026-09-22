import { rememberShopifyBillingOwner } from '../../../../lib/server/shopify-billing'
import { cookies } from 'next/headers'
import { NextResponse } from 'next/server'
import { enforceRateLimit } from '../../../../lib/rate-limit'
import { appUrl } from '../../../../lib/site'
import { signPendingShop, shopifyConfigured } from '../../../../lib/server/shopify'
import { consumeShopifyLinkToken } from '../../../../lib/server/shopify-install'
import { createAdminClient, hasSupabaseAdminEnv } from '../../../../utils/supabase/admin'
import { createClient } from '../../../../utils/supabase/server'

/**
 * Move a verified Shopify admin from the embedded iframe into Nexez's top-level
 * sign-in/linking flow. The query credential is random, hashed at rest, expires
 * after ten minutes, and is atomically consumed before a cookie is issued.
 */
export async function GET(request: Request) {
  if (!shopifyConfigured()) {
    return NextResponse.json({ error: 'Shopify app is not configured.' }, { status: 404 })
  }
  if (!hasSupabaseAdminEnv()) {
    return NextResponse.json({ error: 'Shopify install storage is unavailable.' }, { status: 503 })
  }
  const limited = await enforceRateLimit(request, 'shopify-claim', 20, 60_000)
  if (limited) return limited

  const token = new URL(request.url).searchParams.get('token') || ''
  const shop = await consumeShopifyLinkToken(createAdminClient(), token)
  if (!shop) {
    const expired = NextResponse.redirect(
      appUrl('/login?next=/dashboard/shopify&error=shopify_link_expired'),
      302,
    )
    expired.headers.set('cache-control', 'no-store')
    expired.headers.set('referrer-policy', 'no-referrer')
    return expired
  }

  const jar = await cookies()
  jar.set('shopify_pending_shop', signPendingShop(shop), {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: 60 * 60,
  })

  let ownerId: string | null = null
  try {
    const { data } = await createClient(jar).auth.getUser()
    ownerId = data.user?.id ?? null
  } catch {
    /* continue to sign in */
  }
  if (ownerId) {
    try {
      await rememberShopifyBillingOwner(createAdminClient(), ownerId)
    } catch {
      return NextResponse.json({ error: 'Could not prepare Shopify billing. Reopen the app in Shopify and try again.' }, { status: 503 })
    }
  }
  const destination = ownerId ? '/dashboard/shopify' : '/login?next=/dashboard/shopify'
  const response = NextResponse.redirect(appUrl(destination), 302)
  response.headers.set('cache-control', 'no-store')
  response.headers.set('referrer-policy', 'no-referrer')
  return response
}
