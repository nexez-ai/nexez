import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { LoginForm } from '../../components/LoginForm'
import { createClient } from '../../utils/supabase/server'
import { createAdminClient, hasSupabaseAdminEnv } from '../../utils/supabase/admin'
import { readPendingShop } from '../../lib/server/shopify'
import { getOwnerShopifyBillingContext } from '../../lib/server/shopify-billing'
import OnboardClient from './OnboardClient'

export default async function OnboardPage() {
  const jar = await cookies()
  const pending = jar.get('shopify_pending_shop')?.value
  const shop = readPendingShop(pending)
  const { data: { user } } = await createClient(jar).auth.getUser()
  if (user && hasSupabaseAdminEnv()) {
    const billing = await getOwnerShopifyBillingContext(createAdminClient(), user.id, pending)
    if (billing) redirect(shop ? '/dashboard/shopify' : '/dashboard/billing')
  }
  // Render the correct flow on the server, with no flash of Nexez plans or
  // Stripe Connect while a client-side billing probe is still loading.
  if (shop) return <LoginForm initialMode="signup" nextPath="/dashboard/shopify" shopifyShop={shop} />
  return <OnboardClient />
}
