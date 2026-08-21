import { cookies, headers } from 'next/headers'
import { redirect } from 'next/navigation'
import { LoginForm, LoginMode } from '../../components/LoginForm'
import { createClient } from '../../utils/supabase/server'
import { safeNextPath } from '../../lib/safe-redirect'
import { isShopifyLinkPath } from '../../lib/shopify-link-flow'

type LoginPageProps = {
  searchParams?: Promise<{
    mode?: string | string[]
    next?: string | string[]
  }>
}

function firstValue(value?: string | string[]) {
  return Array.isArray(value) ? value[0] : value
}

function toLoginMode(value?: string): LoginMode {
  return value === 'signup' || value === 'reset' ? value : 'signin'
}

export default async function LoginPage({ searchParams }: LoginPageProps) {
  const params = await searchParams
  const initialMode = toLoginMode(firstValue(params?.mode))
  const nextPath = firstValue(params?.next)
  const safeNext = safeNextPath(nextPath, '')
  const shopifyLinking = isShopifyLinkPath(safeNext)

  // Already signed in? Don't show a login form. Shared .nexez.ai cookies let
  // nexez.ai and app.nexez.ai agree on auth state, while nexez.app stays focused
  // on public agent pages.
  if (initialMode !== 'reset') {
    const host = (await headers()).get('host')
    const supabase = createClient(await cookies(), host)
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (user) redirect(safeNextPath(nextPath))
  }

  // Every new signup goes through onboarding so Free or a paid trial is an explicit
  // choice. A direct /login?mode=signup link (or LoginForm's "Create an account")
  // lands on /onboard, carrying any `next`.
  if (initialMode === 'signup' && !shopifyLinking) {
    redirect(safeNext ? `/onboard?next=${encodeURIComponent(safeNext)}` : '/onboard')
  }

  return <LoginForm initialMode={initialMode} nextPath={nextPath} />
}
