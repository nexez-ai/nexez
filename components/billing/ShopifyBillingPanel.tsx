import type { ShopifyBillingContext } from '../../lib/server/shopify-billing'

export function ShopifyBillingPanel({ billing }: { billing: ShopifyBillingContext }) {
  const needsConnection = billing.status === 'connection_required'
  return (
    <main className="nx-platform-surface min-h-screen bg-[var(--bg)] text-[var(--fg)]">
      <div className="mx-auto max-w-3xl px-6 py-10">
        <p className="text-sm text-[var(--signal)]">Shopify app billing</p>
        <h1 className="mt-3 text-4xl font-semibold tracking-tight">Your app plan is managed in Shopify</h1>
        <p className="mt-5 text-[var(--fg-muted)]">
          {needsConnection
            ? 'Finish connecting your store to choose a plan. If you uninstalled Nexez, reinstall it from Shopify admin first.'
            : `Compare plans, upgrade, downgrade, or cancel for ${billing.shop} in Shopify admin.`}
        </p>
        <p className="mt-3 text-[var(--fg-muted)]">
          Shopify processes your Nexez app subscription and provides its invoices. Product checkout and payouts also stay with your Shopify store.
        </p>
        <a href={billing.pricingUrl} target="_top" className="mt-6 inline-flex rounded-xl bg-[var(--signal-solid)] px-5 py-3 font-medium text-white">
          {needsConnection ? 'Connect your Shopify store' : 'Manage plan in Shopify'}
        </a>
      </div>
    </main>
  )
}
