import { getBillingSubscription, getFinanceRollup, getSellerPages } from '@/src/lib/data'
import { getOfferCount } from '@/src/lib/agent-page'
import { commissionPercentForPlan } from '@/src/lib/billing'
import { useAsyncData } from './useAsyncData'
import { useSession } from './useSession'

export function useBilling() {
  const { user } = useSession()
  return useAsyncData(async () => {
    if (!user) throw new Error('Sign in required.')
    const billing = await getBillingSubscription(user.id)
    const planId = billing?.plan_id ?? 'free'
    const commissionPercent = commissionPercentForPlan(planId)
    const [pages, finance] = await Promise.all([
      getSellerPages(user.id),
      getFinanceRollup(
        new Date(Date.now() - 30 * 86400000),
        Math.round(commissionPercent * 100),
      ),
    ])
    const primaryCurrency = finance.currencies[0]
    const agentRevenueCents = primaryCurrency?.grossCents ?? 0

    return {
      billing,
      planId,
      status: billing?.status ?? 'unconfigured',
      pageCount: pages.length,
      publishedCount: pages.filter((page) => page.is_published).length,
      offerCount: pages.reduce((sum, page) => sum + getOfferCount(page), 0),
      agentRevenueCents,
      financeCurrency: primaryCurrency?.currency ?? 'usd',
      commissionPercent,
      platformFeesCents: primaryCurrency?.feeCents ?? 0,
    }
  }, [user?.id])
}
