import { cookies } from 'next/headers'
import { NextResponse } from 'next/server'
import { enforceRateLimit } from '../../../../lib/rate-limit'
import { appUrl } from '../../../../lib/site'
import { readPendingShop } from '../../../../lib/server/shopify'
import { getInstallByShop } from '../../../../lib/server/shopify-install'
import { rememberShopifyBillingOwner } from '../../../../lib/server/shopify-billing'
import { createClient } from '../../../../utils/supabase/server'
import { createAdminClient, hasSupabaseAdminEnv } from '../../../../utils/supabase/admin'

/** Preserve the verified Shopify origin before email confirmation, including
 * confirmation on another device where the browser handoff cookie is absent.
 * This creates no paid entitlement and never changes an existing subscription.
 */
export async function POST(request: Request) {
  const limited = await enforceRateLimit(request, 'shopify-signup', 5, 60_000, { failClosed: true })
  if (limited) return limited
  const jar = await cookies()
  const shop = readPendingShop(jar.get('shopify_pending_shop')?.value)
  if (!shop) return NextResponse.json({ error: 'Reopen Nexez from Shopify to continue account setup.' }, { status: 400 })
  if (!hasSupabaseAdminEnv()) return NextResponse.json({ error: 'Account setup is temporarily unavailable.' }, { status: 503 })

  const admin = createAdminClient()
  const install = await getInstallByShop(admin, shop)
  if (!install) return NextResponse.json({ error: 'Reinstall Nexez from Shopify to continue account setup.' }, { status: 400 })

  const body = await request.json().catch(() => null)
  if (!body || typeof body.email !== 'string' || typeof body.password !== 'string'
    || typeof body.fullName !== 'string' || typeof body.company !== 'string'
    || !body.email.trim() || body.password.length < 8 || !body.fullName.trim() || !body.company.trim()) {
    return NextResponse.json({ error: 'Enter your name, business, email, and a password of at least eight characters.' }, { status: 400 })
  }

  const startedAt = Date.now()
  const { data, error } = await createClient(jar).auth.signUp({
    email: body.email.trim(),
    password: body.password,
    options: {
      emailRedirectTo: appUrl('/auth/callback?next=%2Fdashboard%2Fshopify'),
      data: { full_name: body.fullName.trim(), company: body.company.trim() },
    },
  })
  if (error) return NextResponse.json({ error: error.message }, { status: 400 })

  // Auth can return an obfuscated user for an existing email. Never use that
  // response to change another account's billing. An existing user is marked
  // only after sign-in proves ownership in the normal handoff flow.
  const createdAt = Date.parse(data.user?.created_at || '')
  const newlyCreated = Boolean(data.user?.identities?.length)
    && Number.isFinite(createdAt) && createdAt >= startedAt - 5_000
  if (data.user && (data.session || newlyCreated)) {
    try {
      await rememberShopifyBillingOwner(admin, data.user.id)
    } catch {
      return NextResponse.json({ error: 'Your account was created. Sign in from Shopify to finish setup.' }, { status: 503 })
    }
  }
  return NextResponse.json({ ok: true, needsEmailConfirm: !data.session })
}
