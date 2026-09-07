import { Redirect, useLocalSearchParams } from 'expo-router'
import { Lock, Mail, UserPlus } from 'lucide-react-native'
import { useState } from 'react'
import { KeyboardAvoidingView, Platform, StyleSheet, Text, View } from 'react-native'
import { AppButton, Card, Header, Screen, SegmentedControl, TextField } from '@/src/components/ui'
import { useSession } from '@/src/hooks/useSession'
import { isSupabaseConfigured } from '@/src/lib/supabase'
import { authReturnPath } from '@/src/lib/auth-routing'
import { colors } from '@/src/theme/colors'

type LoginMode = 'signin' | 'signup' | 'reset'

export function LoginScreen() {
  const { session, loading, signIn, signUp, resetPassword } = useSession()
  const { returnTo } = useLocalSearchParams<{ returnTo?: string | string[] }>()
  const [mode, setMode] = useState<LoginMode>('signin')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [fullName, setFullName] = useState('')
  const [company, setCompany] = useState('')
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)

  if (!loading && session) return <Redirect href={authReturnPath(returnTo)} />

  async function submit() {
    setBusy(true)
    setMessage('')
    try {
      if (!email.trim()) throw new Error('Enter your email address.')
      if (mode === 'reset') {
        await resetPassword(email.trim())
        setMessage('Password reset email sent.')
      } else if (mode === 'signin') {
        if (!password) throw new Error('Enter your password.')
        await signIn(email.trim(), password)
      } else {
        if (!password || password.length < 8) throw new Error('Use a password with at least 8 characters.')
        const info = await signUp({ email: email.trim(), password, fullName, company })
        if (info) setMessage(info)
      }
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Authentication failed.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
      <Screen>
        <View style={styles.brandMark}>
          <Text style={styles.brandText}>N</Text>
        </View>
        <Header
          eyebrow="Nexez Seller Hub"
          title={mode === 'signin' ? 'Welcome back' : mode === 'signup' ? 'Create account' : 'Reset password'}
          subtitle="Manage listings, agent discovery, negotiations, orders, and readiness from your phone."
        />
        <SegmentedControl
          value={mode}
          onChange={setMode}
          options={[
            { label: 'Sign in', value: 'signin' },
            { label: 'Sign up', value: 'signup' },
            { label: 'Reset', value: 'reset' },
          ]}
        />
        <Card>
          {!isSupabaseConfigured ? (
            <Text style={styles.configWarning}>Set EXPO_PUBLIC_SUPABASE_URL and EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY before signing in.</Text>
          ) : null}
          {mode === 'signup' ? (
            <>
              <TextField label="Full name" value={fullName} onChangeText={setFullName} autoCapitalize="words" />
              <TextField label="Company" value={company} onChangeText={setCompany} autoCapitalize="words" />
            </>
          ) : null}
          <TextField label="Email" value={email} onChangeText={setEmail} keyboardType="email-address" />
          {mode !== 'reset' ? (
            <TextField label="Password" value={password} onChangeText={setPassword} secureTextEntry />
          ) : null}
          {message ? <Text style={styles.message}>{message}</Text> : null}
          <AppButton
            full
            disabled={busy || !isSupabaseConfigured}
            label={mode === 'signin' ? 'Sign in' : mode === 'signup' ? 'Create account' : 'Send reset email'}
            icon={mode === 'signup' ? UserPlus : mode === 'reset' ? Mail : Lock}
            onPress={submit}
          />
        </Card>
        <Text style={styles.oauthNote}>
          This mobile release uses email and password. Google, passkey, and verified-phone sign-in are available on Nexez web.
        </Text>
      </Screen>
    </KeyboardAvoidingView>
  )
}

const styles = StyleSheet.create({
  brandMark: {
    width: 46,
    height: 46,
    borderRadius: 8,
    backgroundColor: colors.white,
    alignItems: 'center',
    justifyContent: 'center',
  },
  brandText: {
    color: colors.black,
    fontWeight: '900',
    fontSize: 22,
  },
  configWarning: {
    color: colors.amber,
    fontSize: 13,
    lineHeight: 18,
  },
  message: {
    color: colors.muted,
    fontSize: 13,
    lineHeight: 18,
  },
  oauthNote: {
    color: colors.faint,
    fontSize: 12,
    lineHeight: 18,
  },
})
