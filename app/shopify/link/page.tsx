import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { createClient } from '../../../utils/supabase/server'
import { createAdminClient, hasSupabaseAdminEnv } from '../../../utils/supabase/admin'
import { readPendingShop, shopifyApiKey, shopifyConfigured } from '../../../lib/server/shopify'
import { getInstallByShop } from '../../../lib/server/shopify-install'
import { ShopifyLinkClient } from '../../dashboard/shopify/ShopifyLinkClient'

export const metadata = { title: 'Connect Shopify | Nexez' }
export const dynamic = 'force-dynamic'

/**
 * Shopify's top-level account-link flow deliberately lives outside /dashboard.
 * The public App Store connector is free, so this page must never inherit the
 * general Nexez Billing navigation, plan gates, or Stripe subscription UI.
 */
export default async function ShopifyLinkPage() {
  if (!shopifyConfigured()) redirect('/')

  const jar = await cookies()
  const supabase = createClient(jar)
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/login?next=/shopify/link')

  const shop = readPendingShop(jar.get('shopify_pending_shop')?.value)
  const { data: pages } = await supabase
    .from('pages')
    .select('id, name, slug')
    .eq('owner_id', user.id)
    .order('created_at', { ascending: false })

  const listings = (pages ?? []) as { id: string; name: string | null; slug: string }[]

  let currentPageId: string | null = null
  if (shop && hasSupabaseAdminEnv()) {
    const install = await getInstallByShop(createAdminClient(), shop)
    if (install && install.owner_id === user.id) currentPageId = install.page_id
  }
  const currentListing = currentPageId ? listings.find((listing) => listing.id === currentPageId) : null

  return (
    <main className="min-h-screen bg-[var(--bg)] px-5 py-10 text-[var(--fg)]">
      <div className="mx-auto w-full max-w-xl">
        <header className="mb-8 border-b border-[var(--bd-10)] pb-6">
          <p className="text-sm font-semibold text-[var(--signal)]">Nexez Agent-Ready for Shopify</p>
          <h1 className="mt-2 text-2xl font-semibold">Connect your Shopify store</h1>
          <p className="mt-2 text-sm leading-6 text-[var(--fg-muted)]">
            The Shopify connector is free. Linking, catalog sync, storefront discovery, and the app proxy have no app charge.
          </p>
        </header>

        {!shop ? (
          <section className="rounded-xl border border-[var(--bd-10)] bg-[var(--ov-03)] p-5">
            <h2 className="font-medium">No pending Shopify connection</h2>
            <p className="mt-2 text-sm leading-6 text-[var(--fg-muted)]">
              Reopen Nexez Agent-Ready from Shopify admin to start a secure store connection.
            </p>
          </section>
        ) : listings.length === 0 ? (
          <section className="rounded-xl border border-[var(--bd-10)] bg-[var(--ov-03)] p-5">
            <h2 className="font-medium">A Nexez listing is required</h2>
            <p className="mt-2 text-sm leading-6 text-[var(--fg-muted)]">
              This account does not have a listing yet. Create a free listing in Nexez, then reopen the app from Shopify admin to connect it.
            </p>
          </section>
        ) : (
          <section className="rounded-xl border border-[var(--bd-10)] bg-[var(--ov-03)] p-5">
            <p className="mb-5 text-sm leading-6 text-[var(--fg-muted)]">
              <span className="font-medium text-[var(--fg)]">{shop}</span>{' '}
              {currentListing ? (
                <>is linked to <span className="font-medium text-[var(--fg)]">{currentListing.name || currentListing.slug}</span>. Choose another listing to change it.</>
              ) : (
                <>is ready to connect. Choose the listing that should receive this Shopify catalog.</>
              )}
            </p>
            <ShopifyLinkClient
              shop={shop}
              listings={listings}
              appApiKey={shopifyApiKey()}
              currentPageId={currentPageId}
            />
          </section>
        )}

        <footer className="mt-6 flex flex-wrap gap-4 text-xs text-[var(--fg-muted)]">
          <span>No Shopify customer or order data is requested.</span>
          <a href="https://nexez.ai/privacy" className="underline">Privacy</a>
          <a href="https://nexez.ai/support" className="underline">Support</a>
        </footer>
      </div>
    </main>
  )
}
