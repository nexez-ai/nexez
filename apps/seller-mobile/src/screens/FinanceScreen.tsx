import { useRouter } from 'expo-router'
import { AlertTriangle, ExternalLink, ReceiptText, ShieldAlert, TimerReset, WalletCards } from 'lucide-react-native'
import { useMemo, useState } from 'react'
import { Pressable, Text, View } from 'react-native'
import * as WebBrowser from 'expo-web-browser'
import { AppButton, Card, ErrorState, LoadingState, MetricCard, Screen, SectionTitle, StackHeader } from '@/src/components/ui'
import { useFinance } from '@/src/hooks/useFinance'
import { webPath } from '@/src/lib/api'
import { formatCurrency } from '@/src/lib/format'
import { colors, fonts, radii } from '@/src/theme/colors'

const CHANNEL_LABELS: Record<string, string> = {
  direct: 'Direct checkout',
  agent_protocol: 'Agent protocol',
  recurring: 'Recurring service',
  staged: 'Staged settlement',
  reserved: 'Reserved resource',
  nexie: 'Nexie',
  negotiated_order: 'Negotiated order',
}

export function FinanceScreen() {
  const router = useRouter()
  const { data, loading, refreshing, error, reload, refresh } = useFinance()
  const [requestedCurrency, setRequestedCurrency] = useState<string | null>(null)
  const currencies = useMemo(() => {
    if (!data) return []
    return [...new Set([...data.currencies.map((row) => row.currency), ...data.escrow.map((row) => row.currency)])]
  }, [data])
  const selectedCurrency = requestedCurrency && currencies.includes(requestedCurrency) ? requestedCurrency : currencies[0] ?? 'usd'

  if (loading) return <LoadingState label="Reconciling finance" />
  if (error || !data) return <ErrorState message={error || 'Finance is unavailable.'} onRetry={reload} />

  const direct = data.currencies.find((row) => row.currency === selectedCurrency)
  const escrow = data.escrow.find((row) => row.currency === selectedCurrency)
  const channels = data.channels.filter((row) => row.currency === selectedCurrency)
  const reversalCents = direct?.outflowCents ?? 0
  const escrowReversalCents = escrow?.outflowCents ?? 0
  const disputes = data.operations.disputedOrders + data.operations.disputedNegotiations

  return (
    <Screen header={<StackHeader title="Finance & payouts" onBack={() => router.back()} />} refreshing={refreshing} onRefresh={refresh}>
      {currencies.length > 1 ? (
        <View style={st.currencyRow}>
          {currencies.map((currency) => {
            const selected = currency === selectedCurrency
            return (
              <Pressable
                key={currency}
                accessibilityRole="button"
                accessibilityState={{ selected }}
                onPress={() => setRequestedCurrency(currency)}
                style={({ pressed }) => [st.currencyChip, selected ? st.currencyChipActive : null, pressed ? st.pressed : null]}
              >
                <Text style={[st.currencyText, selected ? st.currencyTextActive : null]}>{currency.toUpperCase()}</Text>
              </Pressable>
            )
          })}
        </View>
      ) : null}

      <Card style={st.hero}>
        <Text style={st.heroEyebrow}>SETTLED SALES · 30 DAYS</Text>
        <Text style={st.heroValue}>{formatCurrency(direct?.grossCents ?? 0, selectedCurrency)}</Text>
        <View style={st.heroFooter}>
          <Text style={st.heroLabel}>Net after reversals and Nexez fees</Text>
          <Text style={st.heroNet}>{formatCurrency(direct?.netCents ?? 0, selectedCurrency)}</Text>
        </View>
      </Card>

      <SectionTitle title="Reconciliation" />
      <View style={st.grid}>
        <MetricCard label="Nexez fees" value={formatCurrency(direct?.feeCents ?? 0, selectedCurrency)} detail="Retained fee" icon={ReceiptText} tone="gold" />
        <MetricCard label="Reversals" value={formatCurrency(reversalCents, selectedCurrency)} detail={`${direct?.partialRefunds ?? 0} partial`} icon={TimerReset} tone={reversalCents > 0 ? 'warn' : 'muted'} />
      </View>
      <View style={st.grid}>
        <MetricCard label="Transactions" value={direct?.transactions ?? 0} detail="Live payments" icon={WalletCards} />
        <MetricCard label="Average sale" value={formatCurrency(direct?.aovCents ?? 0, selectedCurrency)} detail="Gross average" />
      </View>

      <SectionTitle title="Needs attention" />
      <View style={st.grid}>
        <MetricCard label="Buyer requests" value={data.operations.openRequests} detail="Open or acknowledged" icon={AlertTriangle} tone={data.operations.openRequests > 0 ? 'warn' : 'muted'} />
        <MetricCard label="Open disputes" value={disputes} detail="Orders and deals" icon={ShieldAlert} tone={disputes > 0 ? 'danger' : 'muted'} />
      </View>
      <View style={st.grid}>
        <MetricCard label="Stale holds" value={data.operations.staleHeldNegotiations} detail="Held over 48 hours" icon={TimerReset} tone={data.operations.staleHeldNegotiations > 0 ? 'warn' : 'muted'} />
        <MetricCard label="Estimated fees" value={data.operations.estimatedEconomics} detail="Legacy rows without fee terms" tone={data.operations.estimatedEconomics > 0 ? 'warn' : 'muted'} />
      </View>

      <SectionTitle title="Settlement channels" />
      <Card>
        {channels.length ? channels.map((channel, index) => (
          <View key={channel.channel} style={[st.row, index < channels.length - 1 ? st.rowBorder : null]}>
            <View style={st.rowCopy}>
              <Text style={st.rowTitle}>{CHANNEL_LABELS[channel.channel] ?? channel.channel.replace(/_/g, ' ')}</Text>
              <Text style={st.rowDetail}>{channel.transactions} captured {channel.transactions === 1 ? 'transaction' : 'transactions'}</Text>
            </View>
            <View style={st.rowMoney}>
              <Text style={st.rowValue}>{formatCurrency(channel.grossCents, selectedCurrency)}</Text>
              <Text style={st.rowNet}>Net {formatCurrency(channel.netCents, selectedCurrency)}</Text>
            </View>
          </View>
        )) : <Text style={st.empty}>No captured sales in this window.</Text>}
      </Card>

      <SectionTitle title="Negotiated escrow" />
      <Card>
        <FinanceRow label="Funded" value={formatCurrency(escrow?.fundedCents ?? 0, selectedCurrency)} />
        <FinanceRow label="Currently held" value={formatCurrency(escrow?.heldCents ?? 0, selectedCurrency)} />
        <FinanceRow label="Captured" value={formatCurrency(escrow?.capturedCents ?? 0, selectedCurrency)} />
        <FinanceRow label="Refunded or disputed" value={formatCurrency(escrowReversalCents, selectedCurrency)} last />
      </Card>
      <Text style={st.note}>Held funds stay separate from captured sales until settlement completes.</Text>

      <AppButton label="Open detailed finance dashboard" icon={ExternalLink} onPress={() => void WebBrowser.openBrowserAsync(webPath('/dashboard/finance'))} />
    </Screen>
  )
}

function FinanceRow({ label, value, last = false }: { label: string; value: string; last?: boolean }) {
  return (
    <View style={[st.row, !last ? st.rowBorder : null]}>
      <Text style={st.rowTitle}>{label}</Text>
      <Text style={st.rowValue}>{value}</Text>
    </View>
  )
}

const st = {
  currencyRow: { flexDirection: 'row' as const, flexWrap: 'wrap' as const, gap: 8 },
  currencyChip: { borderRadius: radii.pill, borderWidth: 1, borderColor: colors.glassBorder, backgroundColor: colors.inputBg, paddingHorizontal: 13, paddingVertical: 8 },
  currencyChipActive: { borderColor: colors.ringBorder, backgroundColor: colors.ringBgStrong },
  currencyText: { color: colors.textSecondary, fontFamily: fonts.monoMedium, fontSize: 12 },
  currencyTextActive: { color: colors.emberTint },
  pressed: { opacity: 0.7 },
  hero: { gap: 8, backgroundColor: 'rgba(228,95,56,0.08)' },
  heroEyebrow: { color: colors.emberTint, fontFamily: fonts.monoMedium, fontSize: 11, letterSpacing: 0.8 },
  heroValue: { color: colors.text, fontFamily: fonts.display, fontSize: 34 },
  heroFooter: { marginTop: 4, paddingTop: 12, borderTopWidth: 1, borderTopColor: colors.hairline, gap: 3 },
  heroLabel: { color: colors.textSecondary, fontFamily: fonts.body, fontSize: 12 },
  heroNet: { color: colors.steelLight, fontFamily: fonts.bodyBold, fontSize: 18 },
  grid: { flexDirection: 'row' as const, gap: 12 },
  row: { minHeight: 56, flexDirection: 'row' as const, alignItems: 'center' as const, justifyContent: 'space-between' as const, gap: 12, paddingVertical: 10 },
  rowBorder: { borderBottomWidth: 1, borderBottomColor: colors.hairline },
  rowCopy: { flex: 1, minWidth: 0 },
  rowMoney: { alignItems: 'flex-end' as const },
  rowTitle: { color: colors.body, fontFamily: fonts.bodySemibold, fontSize: 13, textTransform: 'capitalize' as const },
  rowDetail: { color: colors.textTertiary, fontFamily: fonts.body, fontSize: 11, marginTop: 2 },
  rowValue: { color: colors.text, fontFamily: fonts.bodyBold, fontSize: 13 },
  rowNet: { color: colors.textTertiary, fontFamily: fonts.body, fontSize: 11, marginTop: 2 },
  empty: { color: colors.textSecondary, fontFamily: fonts.body, fontSize: 13, paddingVertical: 8 },
  note: { color: colors.textTertiary, fontFamily: fonts.body, fontSize: 12, lineHeight: 18, marginTop: -8 },
}
