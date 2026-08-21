import { useRouter } from 'expo-router'
import { Bell, ChevronRight, CreditCard, ExternalLink, Globe, KeyRound, LogOut, Plug, SlidersHorizontal, Upload, Users, WalletCards } from 'lucide-react-native'
import { useState } from 'react'
import { Switch, Text, View } from 'react-native'
import * as WebBrowser from 'expo-web-browser'
import { AppButton, AvatarChip, Badge, Card, GroupCard, GroupRow, Header, Screen, SectionTitle } from '@/src/components/ui'
import { useSession } from '@/src/hooks/useSession'
import { useBilling } from '@/src/hooks/useBilling'
import { registerForPushNotifications } from '@/src/lib/notifications'
import { webPath } from '@/src/lib/api'
import { colors, fonts } from '@/src/theme/colors'

function Meta({ text, chevron = true }: { text?: string; chevron?: boolean }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
      {text ? <Text style={{ color: colors.textTertiary, fontFamily: fonts.body, fontSize: 12 }}>{text}</Text> : null}
      {chevron ? <ChevronRight size={18} color="rgba(255,255,255,0.3)" /> : null}
    </View>
  )
}

export function SettingsScreen() {
  const router = useRouter()
  const { user, signOut } = useSession()
  const { data: billing } = useBilling()
  const [notif, setNotif] = useState(false)
  const [pushMessage, setPushMessage] = useState('')

  const name = (user?.user_metadata?.full_name as string | undefined) || (user?.user_metadata?.company as string | undefined) || user?.email?.split('@')[0] || 'Nexez seller'
  const plan = billing?.planId ? billing.planId[0].toUpperCase() + billing.planId.slice(1) : 'Trial'

  async function onToggleNotif(next: boolean) {
    setNotif(next)
    if (!next || !user) return
    const result = await registerForPushNotifications(user.id, user.email ?? null)
    setPushMessage(result.message)
    if (!result.ok) setNotif(false)
  }

  return (
    <Screen>
      <Header title="Settings" />

      <Card style={{ flexDirection: 'row', alignItems: 'center', gap: 14 }}>
        <AvatarChip initial={(name[0] || 'N').toUpperCase()} size={52} />
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={st.name} numberOfLines={1}>
            {name}
          </Text>
          <Text style={st.email} numberOfLines={1}>
            {user?.email ?? 'Seller account'}
          </Text>
        </View>
        <Badge tone="gold">{plan}</Badge>
      </Card>

      <SectionTitle title="Business tools" />
      <GroupCard>
        <GroupRow icon={Plug} title="Integrations" onPress={() => router.push('/tools/integrations')} right={<Meta text="Connections" />} />
        <GroupRow icon={WalletCards} iconTone="gold" title="Finance & payouts" onPress={() => router.push('/tools/finance')} right={<Meta text="Live totals" />} />
        <GroupRow icon={CreditCard} iconTone="gold" title="Billing & plan" onPress={() => router.push('/tools/billing')} right={<Meta text={plan} />} />
        <GroupRow icon={Upload} title="Import a business" onPress={() => router.push('/tools/importer')} right={<Meta />} last />
      </GroupCard>

      <SectionTitle title="Account" />
      <GroupCard>
        <GroupRow
          icon={Bell}
          iconTone="muted"
          title="Push notifications"
          detail="New proposals, payments, reviews, readiness drops"
          right={<Switch value={notif} onValueChange={onToggleNotif} trackColor={{ false: 'rgba(255,255,255,0.15)', true: colors.ember }} thumbColor={colors.white} ios_backgroundColor="rgba(255,255,255,0.15)" />}
        />
        <GroupRow icon={SlidersHorizontal} iconTone="muted" title="Notification settings" detail="Per-event push controls" onPress={() => router.push('/notifications/settings')} right={<Meta />} />
        <GroupRow icon={KeyRound} iconTone="muted" title="API keys" onPress={() => void WebBrowser.openBrowserAsync(webPath('/dashboard/settings'))} right={<Meta text="Web ↗" chevron={false} />} />
        <GroupRow icon={Globe} iconTone="muted" title="Custom domains" onPress={() => void WebBrowser.openBrowserAsync(webPath('/dashboard/settings'))} right={<Meta text="Web ↗" chevron={false} />} />
        <GroupRow icon={Users} iconTone="muted" title="Team access" right={<Meta text="Coming soon" chevron={false} />} last />
      </GroupCard>
      {pushMessage ? <Text style={st.pushMsg}>{pushMessage}</Text> : null}

      <AppButton label="Open web dashboard" icon={ExternalLink} variant="secondary" onPress={() => void WebBrowser.openBrowserAsync(webPath('/dashboard'))} />
      <AppButton label="Help & support" variant="ghost" onPress={() => router.push('/tools/support')} />
      <AppButton label="Sign out" icon={LogOut} variant="danger" onPress={() => void signOut()} />
    </Screen>
  )
}

const st = {
  name: { color: colors.text, fontFamily: fonts.bodyBold, fontSize: 16 },
  email: { color: colors.textSecondary, fontFamily: fonts.body, fontSize: 13, marginTop: 2 },
  pushMsg: { color: colors.textSecondary, fontFamily: fonts.body, fontSize: 12, marginTop: -6 },
}
