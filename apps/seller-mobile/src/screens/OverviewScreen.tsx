import { useRouter } from 'expo-router'
import { BarChart3, Bell, ChevronRight, Plus } from 'lucide-react-native'
import { BlurView } from 'expo-blur'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import {
  AppButton,
  AvatarChip,
  Card,
  EmptyState,
  ErrorState,
  GroupCard,
  Glass,
  Screen,
  SectionTitle,
  Skeleton,
} from '@/src/components/ui'
import { compactNumber, formatCurrency, formatDateTime } from '@/src/lib/format'
import { getReadinessScore } from '@/src/lib/agent-page'
import { useSellerOverview } from '@/src/hooks/useSellerOverview'
import { useSession } from '@/src/hooks/useSession'
import { colors, fonts, radii } from '@/src/theme/colors'

const DOT: Record<string, string> = { info: colors.ember, success: colors.success, warn: colors.warning, muted: colors.steel }

export function OverviewScreen() {
  const router = useRouter()
  const { user } = useSession()
  const { data, loading, refreshing, error, reload, refresh } = useSellerOverview()

  const name = (user?.user_metadata?.full_name as string | undefined) || user?.email?.split('@')[0] || 'there'
  const initial = (name[0] || 'N').toUpperCase()

  if (loading) {
    return (
      <Screen>
        <View style={s.headerRow}>
          <View style={{ flex: 1, gap: 8 }}>
            <Skeleton width={120} height={12} />
            <Skeleton width={200} height={26} />
          </View>
          <Skeleton width={42} height={42} radius={14} />
        </View>
        <Skeleton height={150} radius={22} />
        <Skeleton width={130} height={12} />
        <Skeleton height={66} radius={16} />
        <Skeleton height={66} radius={16} />
        <View style={{ flexDirection: 'row', gap: 10 }}>
          <Skeleton height={64} radius={14} />
          <Skeleton height={64} radius={14} />
          <Skeleton height={64} radius={14} />
        </View>
      </Screen>
    )
  }
  if (error || !data) return <ErrorState message={error || 'Overview unavailable.'} onRetry={reload} />

  const totalTraffic = data.agentVisits + data.humanVisits
  const aiSplit = totalTraffic ? Math.round((data.agentVisits / totalTraffic) * 100) : 0
  const sparkMax = Math.max(1, ...data.spark)

  type QItem = { key: string; title: string; sub: string; tag: string; tone: string; open: () => void }
  const queue: QItem[] = []
  if (data.openNegotiations > 0)
    queue.push({ key: 'neg', title: `${data.openNegotiations} negotiation${data.openNegotiations === 1 ? '' : 's'} need attention`, sub: 'Review proposals, approvals, held funds, and disputes', tag: 'Deal', tone: colors.ember, open: () => router.push('/inbox') })
  for (const page of data.readinessAlerts.slice(0, 3 - queue.length)) {
    queue.push({ key: page.id, title: page.name, sub: `/${page.slug} · ${getReadinessScore(page)}% ready`, tag: 'Readiness', tone: colors.warning, open: () => router.push({ pathname: '/listing/[id]/readiness', params: { id: page.id } }) })
  }

  return (
    <Screen refreshing={refreshing} onRefresh={refresh}>
      <View style={s.headerRow}>
        <View style={{ flex: 1 }}>
          <Text style={s.greeting}>Welcome back, {name}</Text>
          <Text style={s.title}>Command Center</Text>
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
          <Pressable accessibilityLabel="Notifications" onPress={() => router.push('/notifications')} style={s.bell}>
            <Bell size={21} color={colors.body} />
            {data.openNegotiations > 0 ? <View style={s.bellDot} /> : null}
          </Pressable>
          <AvatarChip initial={initial} />
        </View>
      </View>

      {/* Money hero */}
      <View style={s.heroWrap}>
        <BlurView intensity={30} tint="dark" style={StyleSheet.absoluteFill} />
        <View pointerEvents="none" style={[StyleSheet.absoluteFill, { backgroundColor: 'rgba(255,255,255,0.1)' }]} />
        <View pointerEvents="none" style={s.heroRim} />
        <View style={s.heroContent}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' }}>
            <View>
              <Text style={s.heroLabel}>Settled sales · 30d</Text>
              <Text style={s.heroValue}>{formatCurrency(data.pipelineCents, data.financeCurrency)}</Text>
              <Text style={s.heroDelta}>{data.financeCurrency.toUpperCase()} · Stripe confirmed</Text>
            </View>
            <View style={{ alignItems: 'flex-end' }}>
              <Text style={s.heroLabel}>Net sales</Text>
              <Text style={s.heroSecondary}>{formatCurrency(data.payoutsCents, data.financeCurrency)}</Text>
              <Text style={s.heroMeta}>after refunds + Nexez fees</Text>
            </View>
          </View>
          <View style={s.spark}>
            {data.spark.map((v, i) => {
              const h = Math.max(8, Math.round((v / sparkMax) * 100))
              return <View key={i} style={{ flex: 1, height: `${h}%`, borderRadius: 2, backgroundColor: colors.ember, opacity: 0.3 + 0.7 * (v / sparkMax) }} />
            })}
          </View>
        </View>
      </View>

      {/* Needs you queue */}
      <View style={s.queueHead}>
        <Text style={s.sectionLabel}>Needs you · {queue.length}</Text>
        <Pressable onPress={() => router.push('/inbox')}>
          <Text style={s.openInbox}>Open inbox →</Text>
        </Pressable>
      </View>
      {queue.length ? (
        queue.map((q) => (
          <Pressable key={q.key} onPress={q.open} style={({ pressed }) => [{ opacity: pressed ? 0.85 : 1 }]}>
            <Glass tone="raised" radius={radii.cardSm} contentStyle={s.queueRow}>
              <View style={[s.queueDot, { backgroundColor: q.tone }]} />
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={s.queueTitle}>{q.title}</Text>
                <Text style={s.queueSub} numberOfLines={1}>
                  {q.sub}
                </Text>
              </View>
              <View style={[s.queueTag, { backgroundColor: `${q.tone}22` }]}>
                <Text style={[s.queueTagText, { color: q.tone }]}>{q.tag}</Text>
              </View>
              <ChevronRight size={20} color="rgba(255,255,255,0.3)" />
            </Glass>
          </Pressable>
        ))
      ) : (
        <EmptyState title="You're all caught up" detail="No deals, refunds, or readiness drops need you right now." />
      )}

      {/* Compact stats */}
      <View style={s.stats}>
        <Stat label="Agent visits" value={compactNumber(data.agentVisits)} />
        <Stat label="AI share" value={`${aiSplit}%`} color={colors.ember} />
        <Stat label="Conversions" value={compactNumber(data.conversions)} />
      </View>

      <SectionTitle title="Recent activity" />
      {data.recentActivity.length ? (
        <GroupCard>
          {data.recentActivity.map((item, i) => (
            <View key={item.id} style={[s.activityRow, i < data.recentActivity.length - 1 ? s.activityDivider : null]}>
              <View style={[s.dot, { backgroundColor: DOT[item.tone] || colors.ember }]} />
              <Text style={s.activityText} numberOfLines={2}>
                {item.title} · {item.detail}
              </Text>
              <Text style={s.activityTime}>{formatDateTime(item.createdAt)}</Text>
            </View>
          ))}
        </GroupCard>
      ) : (
        <EmptyState title="No activity yet" detail="Signals appear once agents, buyers, or integrations touch your listings." />
      )}

      <View style={{ flexDirection: 'row', gap: 12, marginTop: 4 }}>
        <AppButton full label="Create listing" icon={Plus} onPress={() => router.push('/listing/create')} />
        <AppButton full label="View analytics" icon={BarChart3} variant="secondary" onPress={() => router.push('/analytics')} />
      </View>
    </Screen>
  )
}

function Stat({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <Glass tone="group" radius={14} contentStyle={s.statContent}>
      <Text style={s.statLabel}>{label}</Text>
      <Text style={[s.statValue, color ? { color } : null]}>{value}</Text>
    </Glass>
  )
}

const s = StyleSheet.create({
  headerRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  greeting: { color: colors.textSecondary, fontFamily: fonts.bodySemibold, fontSize: 13, marginBottom: 4 },
  title: { color: colors.text, fontFamily: fonts.display, fontSize: 26, letterSpacing: -0.3 },
  bell: { width: 42, height: 42, borderRadius: 13, backgroundColor: colors.neutralBg, borderWidth: 1, borderColor: colors.neutralBorder, alignItems: 'center', justifyContent: 'center' },
  bellDot: { position: 'absolute', top: 8, right: 9, width: 9, height: 9, borderRadius: 5, backgroundColor: colors.ember, borderWidth: 1.5, borderColor: colors.background },

  heroWrap: { borderRadius: radii.cardLg, borderWidth: 1, borderColor: 'rgba(255,255,255,0.16)', overflow: 'hidden' },
  heroRim: { position: 'absolute', top: 0, left: 0, right: 0, height: 1, backgroundColor: 'rgba(255,255,255,0.22)' },
  heroContent: { padding: 18, gap: 16 },
  heroLabel: { color: 'rgba(255,255,255,0.45)', fontFamily: fonts.bodyBold, fontSize: 11, letterSpacing: 0.6, textTransform: 'uppercase', marginBottom: 6 },
  heroValue: { color: colors.text, fontFamily: fonts.display, fontSize: 34, lineHeight: 36 },
  heroDelta: { color: colors.emberText, fontFamily: fonts.bodyBold, fontSize: 12, marginTop: 5 },
  heroSecondary: { color: colors.steelLight, fontFamily: fonts.display, fontSize: 20 },
  heroMeta: { color: colors.textTertiary, fontFamily: fonts.body, fontSize: 11, marginTop: 3 },
  spark: { flexDirection: 'row', alignItems: 'flex-end', gap: 4, height: 34 },

  queueHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  sectionLabel: { color: colors.label, fontFamily: fonts.bodyBold, fontSize: 12, letterSpacing: 0.9, textTransform: 'uppercase' },
  openInbox: { color: colors.emberText, fontFamily: fonts.bodyBold, fontSize: 12 },
  queueRow: { flexDirection: 'row', alignItems: 'center', gap: 13, padding: 14 },
  queueDot: { width: 10, height: 10, borderRadius: 5 },
  queueTitle: { color: colors.text, fontFamily: fonts.bodyBold, fontSize: 14 },
  queueSub: { color: colors.textSecondary, fontFamily: fonts.body, fontSize: 12, marginTop: 2 },
  queueTag: { paddingHorizontal: 9, paddingVertical: 4, borderRadius: 8 },
  queueTagText: { fontFamily: fonts.bodyBold, fontSize: 10, textTransform: 'uppercase', letterSpacing: 0.4 },

  stats: { flexDirection: 'row', gap: 10 },
  statContent: { padding: 12 },
  statLabel: { color: colors.textTertiary, fontFamily: fonts.bodyBold, fontSize: 10, letterSpacing: 0.5, textTransform: 'uppercase', marginBottom: 5 },
  statValue: { color: colors.text, fontFamily: fonts.display, fontSize: 19 },

  activityRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 15, paddingVertical: 13 },
  activityDivider: { borderBottomWidth: 1, borderBottomColor: colors.hairline },
  dot: { width: 8, height: 8, borderRadius: 4 },
  activityText: { flex: 1, color: colors.body, fontFamily: fonts.bodyMedium, fontSize: 13, lineHeight: 18 },
  activityTime: { color: colors.textFaint, fontFamily: fonts.mono, fontSize: 11 },
})
