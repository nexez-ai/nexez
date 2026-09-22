import { createAdminClient, hasSupabaseAdminEnv } from '../../../utils/supabase/admin'
import { getOwnerShopifyBillingContext } from '../../../lib/server/shopify-billing'
import { NextResponse, after } from 'next/server'
import { createClient } from '../../../utils/supabase/server'
import { cookies } from 'next/headers'
import { safeNextPath } from '../../../lib/safe-redirect'
import { sendOnceSystemEmail } from '../../../lib/server/system-email'
import { markScanLeadsConverted, SCAN_ATTRIBUTION_COOKIE } from '../../../lib/server/scan-lead'
import { buildWelcomeEmail } from '../../../lib/email'
import { ensureBillingSeeded, hasBillingAccount, isSelectablePlan } from '../../../lib/server/trial'
import { isPlatformAdmin } from '../../../lib/server/plan'
import { isAdminHost } from '../../../lib/site'

// A user counts as "new" (gets the welcome) only if their account was created very
// recently - so an existing user signing in again never gets a backfill blast, and
// the send-once ledger keeps it to exactly one even if signup + first login coincide.
const WELCOME_WINDOW_MS = 24 * 60 * 60 * 1000

export async function GET(request: Request) {
  const requestUrl = new URL(request.url)
  const cookieStore = await cookies()
  const scanAttributionToken = cookieStore.get(SCAN_ATTRIBUTION_COOKIE)?.value ?? null
  const code = requestUrl.searchParams.get('code')
  // Guard against open redirect: only allow a same-origin relative path.
  const adminRequest = isAdminHost(requestUrl.host)
  const next = safeNextPath(requestUrl.searchParams.get('next'), adminRequest ? '/admin' : '/dashboard')

  // OAuth provider error / consent-cancel: Google -> Supabase forwards `error`
  // (e.g. access_denied) with NO code. Without this, we'd silently redirect an
  // unauthenticated user onward and they'd bounce to a blank login form. Surface
  // it the same way the expired-link branch below does, so LoginForm shows a message.
  if (!code && requestUrl.searchParams.get('error')) {
    const loginUrl = new URL('/login', requestUrl.origin)
    loginUrl.searchParams.set('error', 'auth_callback')
    if (next && next !== '/') loginUrl.searchParams.set('next', next)
    return NextResponse.redirect(loginUrl)
  }

  if (code) {
    const supabase = createClient(cookieStore, requestUrl.host)
    const { error } = await supabase.auth.exchangeCodeForSession(code)
    if (error) {
      // Expired / already-used confirmation or magic link: don't silently drop the
      // user on a blank login form - bounce to /login with a flag the form surfaces.
      const loginUrl = new URL('/login', requestUrl.origin)
      loginUrl.searchParams.set('error', 'auth_callback')
      if (next && next !== '/') loginUrl.searchParams.set('next', next)
      return NextResponse.redirect(loginUrl)
    }

    // Welcome the user once, on their first sign-in. Deferred so it never blocks the
    // redirect; send-once-guarded so repeat logins don't re-fire. Gated on a recent
    // created_at so existing users aren't welcomed on their next login.
    const { data: { user } } = await supabase.auth.getUser()
    if (adminRequest) {
      if (!user || !(await isPlatformAdmin(supabase, user.id))) {
        await supabase.auth.signOut()
        const loginUrl = new URL('/login', requestUrl.origin)
        loginUrl.searchParams.set('error', 'admin_access')
        return NextResponse.redirect(loginUrl)
      }
      return NextResponse.redirect(new URL(next, requestUrl.origin))
    }
    const createdMs = user?.created_at ? Date.parse(user.created_at) : NaN
    const isNew = Boolean(user?.id) && Number.isFinite(createdMs) && Date.now() - createdMs < WELCOME_WINDOW_MS

    // Persist the plan explicitly selected during onboarding before redirecting.
    // Free becomes a durable account state; paid choices start their no-card trial.
    // Plan-less OAuth accounts still return to onboarding instead of being defaulted.
    const shopifyBilling = user && hasSupabaseAdminEnv()
      ? await getOwnerShopifyBillingContext(createAdminClient(), user.id, cookieStore.get('shopify_pending_shop')?.value)
      : null
    const planMeta = user?.user_metadata?.plan
    const chosePlan = isSelectablePlan(planMeta)
    if (isNew && user && chosePlan && !shopifyBilling) {
      await ensureBillingSeeded(user.id, planMeta)
    }

    if (user?.email && (isNew || scanAttributionToken)) {
      const createUrl = new URL('/create', requestUrl.origin).toString()
      const financeUrl = new URL('/dashboard/finance', requestUrl.origin).toString()
      const docsUrl = new URL('/docs', requestUrl.origin).toString()
      const name = (user.user_metadata?.full_name as string | undefined) || (user.user_metadata?.name as string | undefined) || null
      const to = user.email
      const ownerId = user.id
      after(async () => {
        if (isNew) {
          await sendOnceSystemEmail({ ownerId, kind: 'welcome', to, build: () => buildWelcomeEmail({ name, createUrl, financeUrl, docsUrl }) })
        }
        // Close the public scanner loop. The opaque onboarding token identifies the
        // exact scan request; the verified account email remains a second check.
        await markScanLeadsConverted(ownerId, to, scanAttributionToken)
      })
      if (scanAttributionToken) cookieStore.delete(SCAN_ATTRIBUTION_COOKIE)
    }

    // Any account with NO valid chosen plan and NO billing row goes through onboarding
    // to pick one, not to a silently-seeded default trial. This is intentionally not
    // limited to the welcome window: a user may abandon OAuth and return days later.
    // Existing billing state remains the source of truth and passes through to `next`.
    if (user && !shopifyBilling && !chosePlan && !(await hasBillingAccount(user.id))) {
      const onboardUrl = new URL('/onboard', requestUrl.origin)
      if (next && next !== '/') onboardUrl.searchParams.set('next', next)
      return NextResponse.redirect(onboardUrl)
    }
  }

  return NextResponse.redirect(new URL(next, requestUrl.origin))
}
