import { Tabs, useRouter } from 'expo-router'
import { Inbox, Layers, LayoutDashboard, Plus, Settings } from 'lucide-react-native'
import type { LucideIcon } from 'lucide-react-native'
import { BlurView } from 'expo-blur'
import { Pressable, StyleSheet, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { renderProtectedScreen } from '@/src/components/AuthGate'
import { colors, shadows } from '@/src/theme/colors'

const NAV: { name: string; icon: LucideIcon; label: string; dot?: boolean }[] = [
  { name: 'overview', icon: LayoutDashboard, label: 'Overview' },
  { name: 'listings', icon: Layers, label: 'Listings' },
  { name: 'inbox', icon: Inbox, label: 'Inbox', dot: true },
  { name: 'settings', icon: Settings, label: 'Settings' },
]

function FloatingNav({ state, navigation }: { state: { index: number; routes: { name: string }[] }; navigation: { navigate: (name: string) => void } }) {
  const router = useRouter()
  const insets = useSafeAreaInsets()
  const current = state.routes[state.index]?.name
  const bottom = Math.max(insets.bottom, 14) + 10
  return (
    <View pointerEvents="box-none" style={[s.wrap, { bottom }]}>
      <View style={s.pill}>
        <BlurView intensity={48} tint="dark" style={StyleSheet.absoluteFill} />
        <View pointerEvents="none" style={[StyleSheet.absoluteFill, { backgroundColor: 'rgba(255,255,255,0.1)' }]} />
        <View pointerEvents="none" style={s.pillRim} />
        {NAV.map((t) => {
          const active = current === t.name
          const Icon = t.icon
          return (
            <Pressable key={t.name} accessibilityLabel={t.label} onPress={() => navigation.navigate(t.name)} style={[s.tab, active ? s.tabActive : null]}>
              <Icon size={23} color={active ? colors.ember : 'rgba(255,255,255,0.62)'} />
              {t.dot ? <View style={s.dot} /> : null}
            </Pressable>
          )
        })}
      </View>
      <Pressable accessibilityLabel="Create listing" onPress={() => router.push('/listing/create')} style={({ pressed }) => [s.create, pressed ? { opacity: 0.85 } : null]}>
        <Plus size={26} color={colors.white} />
      </Pressable>
    </View>
  )
}

export default function TabLayout() {
  return (
    <Tabs
      screenLayout={renderProtectedScreen}
      tabBar={(props) => <FloatingNav state={props.state} navigation={props.navigation} />}
      screenOptions={{ headerShown: false, sceneStyle: { backgroundColor: colors.background } }}
    >
      <Tabs.Screen name="overview" />
      <Tabs.Screen name="listings" />
      <Tabs.Screen name="inbox" />
      <Tabs.Screen name="settings" />
      {/* Registered but not in the floating nav - reached via Overview's CTA / Create circle. */}
      <Tabs.Screen name="analytics" options={{ href: null }} />
      <Tabs.Screen name="create" options={{ href: null }} />
    </Tabs>
  )
}

const s = StyleSheet.create({
  wrap: { position: 'absolute', left: 0, right: 0, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 12 },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 9,
    paddingVertical: 7,
    borderRadius: 40,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.2)',
    overflow: 'hidden',
    ...shadows.nav,
  },
  pillRim: { position: 'absolute', top: 0, left: 0, right: 0, height: 1, backgroundColor: 'rgba(255,255,255,0.3)' },
  tab: { width: 50, height: 44, borderRadius: 26, alignItems: 'center', justifyContent: 'center' },
  tabActive: { backgroundColor: colors.ringBgStrong },
  dot: { position: 'absolute', top: 8, right: 12, width: 8, height: 8, borderRadius: 4, backgroundColor: colors.danger, borderWidth: 1.5, borderColor: '#0a0e16' },
  create: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: colors.ember,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.32)',
    alignItems: 'center',
    justifyContent: 'center',
    ...shadows.create,
  },
})
