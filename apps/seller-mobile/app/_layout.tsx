import { useFonts } from 'expo-font'
import { SpaceGrotesk_500Medium, SpaceGrotesk_600SemiBold } from '@expo-google-fonts/space-grotesk'
import { Manrope_400Regular, Manrope_500Medium, Manrope_600SemiBold, Manrope_700Bold, Manrope_800ExtraBold } from '@expo-google-fonts/manrope'
import { JetBrainsMono_400Regular, JetBrainsMono_500Medium } from '@expo-google-fonts/jetbrains-mono'
import { DarkTheme, Stack, ThemeProvider } from 'expo-router'
import * as SplashScreen from 'expo-splash-screen'
import { useEffect } from 'react'
import 'react-native-reanimated'
import { StatusBar } from 'expo-status-bar'
import { SessionProvider } from '@/src/hooks/useSession'
import { ToastProvider } from '@/src/components/Toast'
import { NotificationObserver } from '@/src/components/NotificationObserver'
import { renderAuthScreen } from '@/src/components/AuthGate'
import { initObservability, withObservability } from '@/src/lib/observability'
import { colors } from '@/src/theme/colors'

export {
  // Catch any errors thrown by the Layout component.
  ErrorBoundary,
} from 'expo-router';

export const unstable_settings = {
  initialRouteName: 'index',
}

SplashScreen.preventAutoHideAsync()

initObservability()

function RootLayout() {
  const [loaded, error] = useFonts({
    SpaceMono: require('../assets/fonts/SpaceMono-Regular.ttf'),
    SpaceGrotesk_500Medium,
    SpaceGrotesk_600SemiBold,
    Manrope_400Regular,
    Manrope_500Medium,
    Manrope_600SemiBold,
    Manrope_700Bold,
    Manrope_800ExtraBold,
    JetBrainsMono_400Regular,
    JetBrainsMono_500Medium,
  })

  useEffect(() => {
    if (error) throw error
  }, [error])

  useEffect(() => {
    if (loaded) {
      SplashScreen.hideAsync()
    }
  }, [loaded])

  if (!loaded) {
    return null
  }

  return <RootLayoutNav />
}

export default withObservability(RootLayout)

function RootLayoutNav() {
  return (
    <SessionProvider>
      <NotificationObserver />
      <ThemeProvider value={DarkTheme}>
        <ToastProvider>
          <StatusBar style="light" />
          <Stack screenLayout={renderAuthScreen} screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.background } }}>
            <Stack.Screen name="index" />
            <Stack.Screen name="login" />
            <Stack.Screen name="onboarding" />
            <Stack.Screen name="(tabs)" />
            <Stack.Screen name="listing/[id]" />
            <Stack.Screen name="listing/[id]/edit" />
            <Stack.Screen name="listing/[id]/offers" />
            <Stack.Screen name="listing/[id]/readiness" />
            <Stack.Screen name="listing/[id]/simulator" />
            <Stack.Screen name="listing/[id]/competitor" />
            <Stack.Screen name="listing/[id]/trust" />
            <Stack.Screen name="listing/[id]/autorules" />
            <Stack.Screen name="listing/create" />
            <Stack.Screen name="inbox/negotiations" />
            <Stack.Screen name="inbox/negotiations/[id]" />
            <Stack.Screen name="inbox/orders" />
            <Stack.Screen name="inbox/orders/[id]" />
            <Stack.Screen name="inbox/reviews" />
            <Stack.Screen name="inbox/requests" />
            <Stack.Screen name="notifications/index" />
            <Stack.Screen name="notifications/settings" />
            <Stack.Screen name="tools/importer" />
            <Stack.Screen name="tools/integrations" />
            <Stack.Screen name="tools/billing" />
            <Stack.Screen name="tools/finance" />
            <Stack.Screen name="tools/support" />
          </Stack>
        </ToastProvider>
      </ThemeProvider>
    </SessionProvider>
  )
}
