import { existsSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const app = JSON.parse(readFileSync(resolve(root, 'app.json'), 'utf8')).expo
const eas = JSON.parse(readFileSync(resolve(root, 'eas.json'), 'utf8'))
const failures = []
const easProjectId = '0ebc7964-9099-4b42-b569-da181c30d155'
const require = createRequire(import.meta.url)
const applyDynamicConfig = require('../app.config.js')
const resolvedApp = applyDynamicConfig({ config: app })

function check(condition, message) {
  if (!condition) failures.push(message)
}

function png(path, expectedSize, alphaRequired = false) {
  const absolute = resolve(root, path)
  check(existsSync(absolute), `${path} is missing`)
  if (!existsSync(absolute)) return

  const data = readFileSync(absolute)
  const signature = data.subarray(0, 8).toString('hex')
  check(signature === '89504e470d0a1a0a', `${path} is not a PNG`)
  if (signature !== '89504e470d0a1a0a') return

  const width = data.readUInt32BE(16)
  const height = data.readUInt32BE(20)
  const colorType = data[25]
  check(width === expectedSize && height === expectedSize, `${path} must be ${expectedSize}x${expectedSize}`)
  if (alphaRequired) check(colorType === 4 || colorType === 6, `${path} must include an alpha channel`)
}

check(app.name === 'Nexez Seller Hub', 'Unexpected Expo app name')
check(app.slug === 'nexez-seller-hub', 'Unexpected Expo slug')
check(app.owner === 'nexez-ai', 'EAS owner must be nexez-ai')
check(app.scheme === 'nexez-seller', 'Unexpected deep-link scheme')
check(app.ios?.bundleIdentifier === 'app.nexez.sellerhub', 'Unexpected iOS bundle identifier')
check(/^\d+$/.test(app.ios?.buildNumber ?? ''), 'iOS build number must be numeric')
check(app.android?.package === 'app.nexez.sellerhub', 'Unexpected Android package')
check(Number.isInteger(app.android?.versionCode) && app.android.versionCode > 0, 'Android version code must be a positive integer')
for (const permission of [
  'android.permission.SYSTEM_ALERT_WINDOW',
  'android.permission.READ_EXTERNAL_STORAGE',
  'android.permission.WRITE_EXTERNAL_STORAGE',
]) {
  check(resolvedApp.android?.blockedPermissions?.includes(permission), `${permission} must be blocked`)
  check(!resolvedApp.android?.permissions?.includes(permission), `${permission} must not be requested`)
}
check(app.extra?.eas?.projectId === easProjectId, 'Unexpected EAS project ID')
const sentryPlugin = app.plugins?.find(
  (plugin) => Array.isArray(plugin) && plugin[0] === '@sentry/react-native/expo',
)
check(sentryPlugin?.[1]?.organization === 'nexez-ai', 'Sentry organization is not wired')
check(sentryPlugin?.[1]?.project === 'nexez-seller-hub', 'Sentry project is not wired')
check(
  resolvedApp.android?.googleServicesFile ===
    (process.env.GOOGLE_SERVICES_JSON ?? './google-services.json'),
  'Android Firebase config path is not wired',
)
check(
  resolvedApp.ios?.googleServicesFile ===
    (process.env.GOOGLE_SERVICE_INFO_PLIST ?? './GoogleService-Info.plist'),
  'iOS Firebase config path is not wired',
)
check(!app.android?.adaptiveIcon?.backgroundImage, 'Adaptive icon must use the branded solid background color')

check(eas.build?.development?.environment === 'development', 'Development profile environment is missing')
check(eas.build?.development?.developmentClient === true, 'Development profile must build a dev client')
check(eas.build?.['development-simulator']?.ios?.simulator === true, 'iOS simulator profile is missing')
check(eas.build?.preview?.environment === 'preview', 'Preview profile environment is missing')
check(eas.build?.preview?.android?.buildType === 'apk', 'Android preview must produce an APK')
check(eas.cli?.appVersionSource === 'remote', 'EAS must allocate build numbers remotely')
check(eas.cli?.requireCommit === true, 'EAS builds must use a clean committed source tree')
check(eas.build?.production?.environment === 'production', 'Production profile environment is missing')
check(eas.build?.production?.autoIncrement === true, 'Production builds must auto-increment')

const localTsconfigBase = JSON.parse(readFileSync(resolve(root, 'tsconfig.expo-base.json'), 'utf8'))
const installedExpoTsconfigBase = JSON.parse(
  readFileSync(resolve(root, 'node_modules/expo/tsconfig.base.json'), 'utf8'),
)
check(
  JSON.stringify(localTsconfigBase) === JSON.stringify(installedExpoTsconfigBase),
  'The committed Expo tsconfig base must match the pinned Expo package',
)

png('assets/images/icon.png', 1024)
png('assets/images/splash-icon.png', 1024, true)
png('assets/images/android-icon-foreground.png', 1024, true)
png('assets/images/android-icon-monochrome.png', 1024, true)
png('assets/images/favicon.png', 48)

const localEnvPath = resolve(root, '.env.local')
if (existsSync(localEnvPath)) {
  const names = readFileSync(localEnvPath, 'utf8')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#'))
    .map((line) => line.split('=', 1)[0])
  const allowed = new Set([
    'EXPO_PUBLIC_SUPABASE_URL',
    'EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY',
    'EXPO_PUBLIC_NEXEZ_API_URL',
    'EXPO_PUBLIC_AGENT_RUNTIME_URL',
    'EXPO_PUBLIC_SENTRY_DSN',
  ])
  const required = new Set([
    'EXPO_PUBLIC_SUPABASE_URL',
    'EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY',
    'EXPO_PUBLIC_NEXEZ_API_URL',
    'EXPO_PUBLIC_AGENT_RUNTIME_URL',
  ])
  check(new Set(names).size === names.length, '.env.local contains a duplicate variable')
  check(names.every((name) => allowed.has(name)), '.env.local contains a non-public or unexpected variable')
  check([...required].every((name) => names.includes(name)), '.env.local is missing a required public variable')
}

if (failures.length) {
  console.error(failures.map((failure) => `- ${failure}`).join('\n'))
  process.exit(1)
}

console.log('Release configuration is valid.')
