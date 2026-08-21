import { useRouter } from 'expo-router'
import { CreditCard, ExternalLink } from 'lucide-react-native'
import * as WebBrowser from 'expo-web-browser'
import { Text, View } from 'react-native'
import { AppButton, Card, ErrorState, LoadingState, MetricCard, Screen, SectionTitle, StackHeader } from '@/src/components/ui'
import { useBilling } from '@/src/hooks/useBilling'
import { formatCurrency } from '@/src/lib/format'
import { webPath } from '@/src/lib/api'
import { colors, fonts, radii } from '@/src/theme/colors'

export function BillingScreen() {
  const router = useRouter()
  const { data, loading, refreshing, error, reload, refresh } = useBilling()
  if (loading) return <LoadingState label="Loading billing" />
  if (error || !data) return <ErrorState message={error || 'Billing unavailable.'} onRetry={reload} />

  const plan = data.planId ? data.planId[0].toUpperCase() + data.planId.slice(1) : 'Trial'

  return (
    <Screen header={<StackHeader title="Billing & plan" onBack={() => router.back()} />} refreshing={refreshing} onRefresh={refresh}>
      <View style={st.hero}>
        <View>
          <Text style={st.heroLabel}>Current plan</Text>
          <Text style={st.heroValue}>{plan}</Text>
        </View>
        <View style={{ alignItems: 'flex-end' }}>
          <Text style={st.heroLabel}>Status</Text>
          <Text style={[st.heroValue, { fontSize: 18 }]}>{data.status}</Text>
        </View>
      </View>

      <SectionTitle title="Usage this cycle" />
      <View style={st.grid}>
        <MetricCard label="Listings" value={data.pageCount} detail={`${data.publishedCount} published`} />
        <MetricCard label="Offers" value={data.offerCount} />
      </View>

      <SectionTitle title="Fees & revenue" />
      <Card>
        <FeeRow label="Transaction fee" value={`${data.commissionPercent}% + Stripe`} />
        <FeeRow label="Settled sales · 30d" value={formatCurrency(data.agentRevenueCents, data.financeCurrency)} />
        <FeeRow label="Nexez fees · 30d" value={formatCurrency(data.platformFeesCents, data.financeCurrency)} />
      </Card>

      <AppButton label="Finance & payouts" icon={CreditCard} variant="secondary" onPress={() => router.push('/tools/finance')} />
      <AppButton label="Manage billing on web" icon={ExternalLink} onPress={() => void WebBrowser.openBrowserAsync(webPath('/dashboard/billing'))} />
      <AppButton label="Compare plans" icon={CreditCard} variant="secondary" onPress={() => void WebBrowser.openBrowserAsync(webPath('/pricing'))} />
    </Screen>
  )
}

function FeeRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={st.feeRow}>
      <Text style={st.feeLabel}>{label}</Text>
      <Text style={st.feeValue}>{value}</Text>
    </View>
  )
}

const st = {
  hero: {
    flexDirection: 'row' as const,
    justifyContent: 'space-between' as const,
    alignItems: 'flex-start' as const,
    backgroundColor: 'rgba(255,106,51,0.12)',
    borderWidth: 1,
    borderColor: 'rgba(233,162,59,0.3)',
    borderRadius: radii.card,
    padding: 18,
  },
  heroLabel: { color: colors.textSecondary, fontFamily: fonts.bodySemibold, fontSize: 12, marginBottom: 4 },
  heroValue: { color: colors.text, fontFamily: fonts.display, fontSize: 24, textTransform: 'capitalize' as const },
  grid: { flexDirection: 'row' as const, gap: 12 },
  feeRow: { flexDirection: 'row' as const, justifyContent: 'space-between' as const, alignItems: 'center' as const, paddingVertical: 4 },
  feeLabel: { color: colors.textSecondary, fontFamily: fonts.body, fontSize: 13 },
  feeValue: { color: colors.body, fontFamily: fonts.bodyBold, fontSize: 13 },
}
