import { getBillingSubscription, getFinanceRollup } from '@/src/lib/data'
import { commissionPercentForPlan } from '@/src/lib/billing'
import { useAsyncData } from './useAsyncData'
import { useSession } from './useSession'

export function useFinance() {
  const { user } = useSession()
  return useAsyncData(async () => {
    if (!user) throw new Error('Sign in required.')

    const billing = await getBillingSubscription(user.id)
    const fallbackCommissionBps = Math.round(commissionPercentForPlan(billing?.plan_id) * 100)
    return getFinanceRollup(new Date(Date.now() - 30 * 86400000), fallbackCommissionBps)
  }, [user?.id])
}
