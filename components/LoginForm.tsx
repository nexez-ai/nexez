'use client'

import { useEffect, useMemo, useState, type FormEvent, type MouseEvent, type ReactNode } from 'react'
import {
  ArrowRight,
  Building2,
  Eye,
  EyeOff,
  Loader2,
  LockKeyhole,
  Mail,
  User,
} from 'lucide-react'
import { NexezLogo } from './NexezLogo'
import { safeNextPath } from '../lib/safe-redirect'
import { createClient } from '../utils/supabase/client'
import { INDUSTRIES } from '../lib/industries'
import { isShopifyLinkPath, SHOPIFY_LINK_PATH } from '../lib/shopify-link-flow'

export type LoginMode = 'signin' | 'signup' | 'reset'

function scorePassword(pw: string): { score: number; label: string; color: string } {
  let score = 0
  if (pw.length >= 8) score++
  if (pw.length >= 12) score++
  if (/[A-Z]/.test(pw) && /[a-z]/.test(pw)) score++
  if (/\d/.test(pw) && /[^A-Za-z0-9]/.test(pw)) score++
  const labels = ['Too short', 'Weak', 'Fair', 'Good', 'Strong']
  const colors = ['#ef4444', '#f59e0b', '#eab308', '#22c55e', '#10b981']
  return { score, label: labels[score], color: colors[score] }
}

const meshSource = { x: 500, y: 480 }
const meshNodeDefs = [
  { name: 'ChatGPT', x: 250, y: 180 },
  { name: 'Claude', x: 500, y: 130, hot: true },
  { name: 'Gemini', x: 780, y: 200 },
  { name: 'Perplexity', x: 880, y: 430, hot: true },
  { name: 'Copilot', x: 850, y: 700 },
  { name: 'Grok', x: 620, y: 850 },
  { name: 'Mistral', x: 360, y: 860, hot: true },
  { name: 'Llama', x: 140, y: 660 },
  { name: 'DeepSeek', x: 120, y: 400 },
  { name: 'Qwen', x: 320, y: 520 },
  { name: 'Cohere', x: 700, y: 560 },
  { name: 'Amazon Nova', x: 660, y: 340 },
]

const meshNodes = meshNodeDefs.map((node, index) => ({
  ...node,
  size: node.hot ? 14 : 8 + (index % 3) * 2,
  delay: `${(index * 0.35).toFixed(1)}s`,
  duration: `${5 + (index % 4)}s`,
  twinkle: `${(2.2 + (index % 3) * 0.6).toFixed(1)}s`,
}))

const meshRingOrder = [0, 1, 2, 11, 3, 10, 4, 5, 6, 9, 7, 8]
const meshCrossLinks = [
  [0, 9],
  [2, 11],
  [8, 6],
  [4, 10],
]

const meshSourceEdges = meshNodes.map((node) => ({
  x1: meshSource.x,
  y1: meshSource.y,
  x2: node.x,
  y2: node.y,
  hot: !!node.hot,
}))

const meshRingEdges = meshRingOrder.map((nodeIndex, index) => {
  const current = meshNodes[nodeIndex]
  const next = meshNodes[meshRingOrder[(index + 1) % meshRingOrder.length]]
  return { x1: current.x, y1: current.y, x2: next.x, y2: next.y }
})

const meshCrossEdges = meshCrossLinks.map(([a, b]) => ({
  x1: meshNodes[a].x,
  y1: meshNodes[a].y,
  x2: meshNodes[b].x,
  y2: meshNodes[b].y,
}))

export function LoginForm({ initialMode = 'signin', nextPath }: { initialMode?: LoginMode; nextPath?: string }) {
  const [hydrated, setHydrated] = useState(false)
  const [mode, setMode] = useState<LoginMode>(initialMode)
  const [fullName, setFullName] = useState('')
  const [company, setCompany] = useState('')
  const [industry, setIndustry] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [agree, setAgree] = useState(false)
  const [loading, setLoading] = useState(false)
  const [oauthLoading, setOauthLoading] = useState(false)
  const [message, setMessage] = useState('')
  const [messageTone, setMessageTone] = useState<'error' | 'info'>('info')

  const strength = useMemo(() => scorePassword(password), [password])
  const shopifyLinking = isShopifyLinkPath(safeNextPath(nextPath, ''))
  const onboardingHref = nextPath ? `/onboard?next=${encodeURIComponent(nextPath)}` : '/onboard'
  const signupHref = shopifyLinking
    ? `/login?mode=signup&next=${encodeURIComponent(SHOPIFY_LINK_PATH)}`
    : onboardingHref

  useEffect(() => {
    setHydrated(true)
  }, [])

  useEffect(() => {
    setMode(initialMode)
    setMessage('')
    setLoading(false)
  }, [initialMode])

  useEffect(() => {
    const err = new URLSearchParams(window.location.search).get('error')
    if (err === 'auth_callback') {
      setMessageTone('error')
      setMessage('That sign-in link is invalid or has expired. Please sign in again.')
    }
  }, [])

  function setError(msg: string) {
    setMessageTone('error')
    setMessage(msg)
  }

  function setInfo(msg: string) {
    setMessageTone('info')
    setMessage(msg)
  }

  function switchMode(next: LoginMode) {
    setMode(next)
    setMessage('')
    setLoading(false)
  }

  function modeHref(next: LoginMode) {
    const params = new URLSearchParams()
    if (next !== 'signin') params.set('mode', next)
    if (nextPath) params.set('next', nextPath)
    const query = params.toString()
    return query ? `/login?${query}` : '/login'
  }

  function handleModeLink(next: LoginMode) {
    return (event: MouseEvent<HTMLAnchorElement>) => {
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0) return
      event.preventDefault()
      window.history.pushState(null, '', modeHref(next))
      switchMode(next)
    }
  }

  function validate(): string | null {
    if (mode === 'reset') {
      if (!email.trim()) return 'Enter the email associated with your account.'
      return null
    }
    if (!email.trim()) return 'Email is required.'
    if (!password) return 'Password is required.'
    if (mode === 'signup') {
      if (!fullName.trim()) return 'Please enter your full name.'
      if (!company.trim()) return 'Please enter your company or business name.'
      if (password.length < 8) return 'Password must be at least 8 characters.'
      if (password !== confirm) return 'Passwords do not match.'
      if (!agree) return 'Please accept the Terms and Privacy Policy to continue.'
    }
    return null
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (loading) return

    const validationError = validate()
    if (validationError) {
      setError(validationError)
      return
    }

    setLoading(true)
    setMessage('')
    const supabase = createClient()

    try {
      if (mode === 'reset') {
        const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), {
          redirectTo: `${window.location.origin}/auth/callback`,
        })
        if (error) return setError(error.message)
        return setInfo('Password reset link sent. Check your email to continue.')
      }

      if (mode === 'signin') {
        const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password })
        if (error) return setError(error.message)
      } else {
        const callback = new URL('/auth/callback', window.location.origin)
        if (shopifyLinking) callback.searchParams.set('next', SHOPIFY_LINK_PATH)
        const { data, error } = await supabase.auth.signUp({
          email: email.trim(),
          password,
          options: {
            emailRedirectTo: callback.toString(),
            data: {
              full_name: fullName.trim(),
              company: company.trim(),
              industry: industry || null,
              signup_source: shopifyLinking ? 'shopify' : undefined,
            },
          },
        })
        if (error) return setError(error.message)
        if (!data.session) {
          return setInfo('Account created. Check your email to confirm, then sign in.')
        }
      }

      const next = safeNextPath(new URLSearchParams(window.location.search).get('next') || nextPath)
      window.location.href = next
    } finally {
      setLoading(false)
    }
  }

  async function handleGoogle() {
    if (loading || oauthLoading) return
    setOauthLoading(true)
    setMessage('')
    const supabase = createClient()
    // Preserve the post-auth destination through the OAuth round-trip; the shared
    // /auth/callback exchanges the code, persists the selected Free/trial plan,
    // and honors ?next (open-redirect-guarded server-side).
    const next = safeNextPath(new URLSearchParams(window.location.search).get('next') || nextPath)
    const callback = new URL('/auth/callback', window.location.origin)
    if (next && next !== '/') callback.searchParams.set('next', next)
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: callback.toString() },
    })
    // On success the browser navigates to Google — leave the button spinning.
    if (error) {
      setError(error.message)
      setOauthLoading(false)
    }
  }

  const title =
    mode === 'signin'
      ? shopifyLinking ? 'Connect your Shopify store' : 'Welcome back'
      : mode === 'signup'
        ? shopifyLinking ? 'Create your free connector account' : 'Create your Nexez workspace'
        : 'Reset your password'
  const subtitle =
    mode === 'signin'
      ? shopifyLinking
        ? 'Sign in to choose the listing that receives your Shopify catalog. The connector has no app charge.'
        : 'Sign in to continue managing your agent-ready business layer.'
      : mode === 'signup'
        ? shopifyLinking
          ? 'Create an account to link, sync, and publish your Shopify catalog for agent discovery at no app charge.'
          : 'Launch a structured presence AI agents can understand, recommend, and act on.'
        : 'Enter your email and we will send a secure reset link.'

  return (
    <main className="nx-auth-page">
      <AuthBackdrop />
      <div className="nx-auth-shell">
        <header className="nx-auth-topbar">
          <a href="/" className="nx-auth-logo" aria-label="Nexez home">
            <span className="nx-auth-logo-mark">
              <NexezLogo className="size-6" />
            </span>
            <span>Nexez</span>
          </a>
          <nav className="nx-auth-nav" aria-label="Login links">
            {shopifyLinking ? (
              <>
                <a href="https://nexez.ai/privacy" className="nx-auth-link">Privacy</a>
                <a href="https://nexez.ai/support" className="nx-auth-link">Support</a>
              </>
            ) : (
              <>
                <a href="/pricing" className="nx-auth-link">Pricing</a>
                <a href="/simulator" className="nx-auth-link">Simulator</a>
              </>
            )}
            <a href={mode === 'signin' ? signupHref : modeHref('signin')} className="nx-auth-secondary">
              {mode === 'signin' ? shopifyLinking ? 'Create account' : 'Start Free' : 'Sign in'}
            </a>
          </nav>
        </header>

        <div className="nx-auth-layout nx-auth-layout--login">
          <section className="nx-auth-copy-block">
            <SignInMeshGraphic />

            <div className="nx-auth-copy-content">
              <h1 className="nx-auth-title">Manage the layer AI buyers can act on.</h1>
              <p className="nx-auth-copy">
                {shopifyLinking
                  ? 'Connect one Shopify store to a Nexez listing, keep its product catalog synchronized, and preserve Shopify storefront checkout.'
                  : 'Update listings, review simulations, track agent traffic, and manage buyer actions from one focused workspace.'}
              </p>
            </div>
          </section>

          <section className="nx-auth-form-wrap">
            <div className="nx-auth-card">
              <div className="nx-auth-card-body">
                <div className="nx-auth-form-intro">
                  <h2 className="nx-auth-form-title">{title}</h2>
                  <p className="nx-auth-form-copy">{subtitle}</p>
                </div>

                {mode !== 'reset' ? (
                  <div className="nx-auth-toggle mt-6">
                    <a
                      href={modeHref('signin')}
                      onClick={handleModeLink('signin')}
                      aria-current={mode === 'signin' ? 'true' : undefined}
                    >
                      Sign in
                    </a>
                    <a
                      href={signupHref}
                      onClick={shopifyLinking ? handleModeLink('signup') : undefined}
                      aria-current={mode === 'signup' ? 'true' : undefined}
                    >
                      {shopifyLinking ? 'Create account' : 'Start Free'}
                    </a>
                  </div>
                ) : null}

                {mode !== 'reset' ? (
                  <div className="mt-5 space-y-4">
                    <button
                      type="button"
                      onClick={handleGoogle}
                      disabled={!hydrated || loading || oauthLoading}
                      className="nx-auth-oauth"
                    >
                      {oauthLoading ? <Loader2 className="size-4 animate-spin" /> : <GoogleGlyph className="size-[18px]" />}
                      Continue with Google
                    </button>
                    <div className="nx-auth-divider" role="separator">
                      <span>or continue with email</span>
                    </div>
                  </div>
                ) : null}

                <form onSubmit={handleSubmit} data-hydrated={hydrated ? 'true' : 'false'} className="mt-5 space-y-4">
                  {mode === 'signup' ? (
                    <>
                      <Field label="Full name" icon={<User className="size-4" />}>
                        <input
                          name="fullName"
                          value={fullName}
                          onChange={(event) => setFullName(event.target.value)}
                          className={inputClass}
                          placeholder="Jordan Rivera"
                          autoComplete="name"
                          disabled={!hydrated || loading}
                        />
                      </Field>
                      <Field label="Company or business" icon={<Building2 className="size-4" />}>
                        <input
                          name="company"
                          value={company}
                          onChange={(event) => setCompany(event.target.value)}
                          className={inputClass}
                          placeholder="Apex Strategy Co."
                          autoComplete="organization"
                          disabled={!hydrated || loading}
                        />
                      </Field>
                      <Field label="Industry">
                        <select
                          name="industry"
                          value={industry}
                          onChange={(event) => setIndustry(event.target.value)}
                          className={inputClass}
                          disabled={!hydrated || loading}
                        >
                          <option value="">Select an industry</option>
                          {INDUSTRIES.map((opt) => (
                            <option key={opt} value={opt}>
                              {opt}
                            </option>
                          ))}
                        </select>
                      </Field>
                    </>
                  ) : null}

                  <Field label={mode === 'reset' ? 'Account email' : 'Work email'} icon={<Mail className="size-4" />}>
                    <input
                      name="email"
                      type="email"
                      value={email}
                      onChange={(event) => setEmail(event.target.value)}
                      className={inputClass}
                      placeholder="you@company.com"
                      autoComplete="email"
                      disabled={!hydrated || loading}
                      required
                    />
                  </Field>

                  {mode !== 'reset' ? (
                    <Field label="Password" icon={<LockKeyhole className="size-4" />}>
                      <div className="relative">
                        <input
                          name="password"
                          type={showPassword ? 'text' : 'password'}
                          value={password}
                          onChange={(event) => setPassword(event.target.value)}
                          className={`${inputClass} pr-12`}
                          placeholder={mode === 'signup' ? 'At least 8 characters' : 'Your password'}
                          autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
                          disabled={!hydrated || loading}
                          required
                        />
                        <button
                          type="button"
                          onClick={() => setShowPassword((s) => !s)}
                          disabled={!hydrated || loading}
                          className="absolute right-3 top-1/2 flex size-8 -translate-y-1/2 items-center justify-center rounded-lg text-[var(--nx-auth-muted)] transition hover:bg-white/10 hover:text-[var(--nx-auth-text)] disabled:opacity-50"
                          aria-label={showPassword ? 'Hide password' : 'Show password'}
                          title={showPassword ? 'Hide password' : 'Show password'}
                        >
                          {showPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                        </button>
                      </div>
                      {mode === 'signup' && password.length > 0 ? (
                        <div className="mt-2">
                          <div className="h-1.5 w-full overflow-hidden rounded-full bg-white/10">
                            <div
                              className="h-full rounded-full transition-all"
                              style={{ width: `${Math.max(10, (strength.score / 4) * 100)}%`, backgroundColor: strength.color }}
                            />
                          </div>
                          <p className="mt-1 text-xs" style={{ color: strength.color }}>
                            {strength.label}
                          </p>
                        </div>
                      ) : null}
                    </Field>
                  ) : null}

                  {mode === 'signup' ? (
                    <Field label="Confirm password">
                      <input
                        name="confirm"
                        type={showPassword ? 'text' : 'password'}
                        value={confirm}
                        onChange={(event) => setConfirm(event.target.value)}
                        className={inputClass}
                        placeholder="Re-enter your password"
                        autoComplete="new-password"
                        disabled={!hydrated || loading}
                        required
                      />
                      <p aria-live="polite" className="mt-1 min-h-[1rem] text-xs text-red-300">
                        {confirm.length > 0 && confirm !== password ? 'Passwords do not match yet.' : ''}
                      </p>
                    </Field>
                  ) : null}

                  {mode === 'signup' ? (
                    <label className="flex items-start gap-3 rounded-[18px] bg-white/[0.03] p-3 text-xs leading-5 text-[var(--nx-auth-muted)]">
                      <input
                        type="checkbox"
                        name="agree"
                        checked={agree}
                        onChange={(event) => setAgree(event.target.checked)}
                        disabled={!hydrated || loading}
                        className="mt-0.5 size-4 rounded border-white/20 bg-white/10 accent-[var(--nx-auth-signal)]"
                      />
                      <span>
                        I agree to the{' '}
                        <a href="/terms" className="text-[var(--nx-auth-text)] underline decoration-white/25 underline-offset-4 hover:decoration-white">
                          Terms
                        </a>{' '}
                        and{' '}
                        <a href="/privacy" className="text-[var(--nx-auth-text)] underline decoration-white/25 underline-offset-4 hover:decoration-white">
                          Privacy Policy
                        </a>
                        .
                      </span>
                    </label>
                  ) : null}

                  {mode === 'signin' ? (
                    <div className="flex justify-end">
                      <a
                        href={modeHref('reset')}
                        onClick={handleModeLink('reset')}
                        className="text-xs text-[var(--nx-auth-muted)] transition hover:text-[var(--nx-auth-text)]"
                      >
                        Forgot password?
                      </a>
                    </div>
                  ) : null}

                  {message ? (
                    <p role="alert" className={`nx-auth-message ${messageTone === 'error' ? 'nx-auth-message--error' : 'nx-auth-message--info'}`}>
                      {message}
                    </p>
                  ) : null}

                  <button type="submit" disabled={!hydrated || loading || oauthLoading} className="nx-auth-submit">
                    {loading ? <Loader2 className="size-4 animate-spin" /> : null}
                    {mode === 'signin' ? 'Sign in' : mode === 'signup' ? 'Create account' : 'Send reset link'}
                    {!loading ? <ArrowRight className="size-4" /> : null}
                  </button>
                </form>

                {/* Cross-sell only where it isn't already offered: the Sign in / Start
                    Free toggle above covers signin mode, so this shows only for
                    signup + reset. De-boxed (subtle tint, no border) for calm. */}
                {mode !== 'signin' ? (
                  <div className="mt-5 rounded-[18px] bg-white/[0.03] p-4 text-sm text-[var(--nx-auth-muted)]">
                    {mode === 'signup' ? (
                      <p>
                        Already have an account?{' '}
                        <a
                          href={modeHref('signin')}
                          onClick={handleModeLink('signin')}
                          className="font-semibold text-[var(--nx-auth-text)] underline decoration-white/25 underline-offset-4 hover:decoration-white"
                        >
                          Sign in
                        </a>
                      </p>
                    ) : (
                      <p>
                        Remembered it?{' '}
                        <a
                          href={modeHref('signin')}
                          onClick={handleModeLink('signin')}
                          className="font-semibold text-[var(--nx-auth-text)] underline decoration-white/25 underline-offset-4 hover:decoration-white"
                        >
                          Sign in instead
                        </a>
                      </p>
                    )}
                  </div>
                ) : null}
              </div>
            </div>

          </section>
        </div>
      </div>
    </main>
  )
}

function AuthBackdrop() {
  return <div aria-hidden="true" className="nx-auth-backdrop" />
}

function SignInMeshGraphic() {
  return (
    <div className="nx-auth-mesh" aria-hidden="true">
      <div className="nx-auth-mesh-bg" />
      <div className="nx-auth-mesh-dots" />
      <div className="nx-auth-mesh-glow" />
      <div className="nx-auth-mesh-label nx-auth-mesh-label--top">NEXEZ · AGENT MESH</div>
      <div className="nx-auth-mesh-label nx-auth-mesh-label--bottom">12 nodes · 28 edges</div>

      <svg className="nx-auth-mesh-svg" viewBox="0 0 1000 1000" role="img" aria-label="Agent mesh showing AI systems discovering a Nexez listing">
        <defs>
          <filter id="nx-auth-mesh-glow-filter" x="-80%" y="-80%" width="260%" height="260%">
            <feGaussianBlur stdDeviation="1.4" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
          <radialGradient id="nx-auth-mesh-hub-halo" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="#f15a29" stopOpacity="0.6" />
            <stop offset="70%" stopColor="#f15a29" stopOpacity="0" />
          </radialGradient>
          <linearGradient id="nx-auth-mesh-hub-fill" x1="0" x2="1" y1="0" y2="1">
            <stop offset="0%" stopColor="#ff8a5c" />
            <stop offset="62%" stopColor="#f15a29" />
            <stop offset="100%" stopColor="#d8481d" />
          </linearGradient>
        </defs>

        {meshRingEdges.map((edge) => (
          <line key={`ring-${edge.x1}-${edge.y1}-${edge.x2}-${edge.y2}`} className="nx-auth-mesh-edge" x1={edge.x1} y1={edge.y1} x2={edge.x2} y2={edge.y2} />
        ))}
        {meshCrossEdges.map((edge) => (
          <line key={`cross-${edge.x1}-${edge.y1}-${edge.x2}-${edge.y2}`} className="nx-auth-mesh-edge nx-auth-mesh-edge--cross" x1={edge.x1} y1={edge.y1} x2={edge.x2} y2={edge.y2} />
        ))}
        {meshSourceEdges
          .filter((edge) => !edge.hot)
          .map((edge) => (
            <line key={`source-${edge.x1}-${edge.y1}-${edge.x2}-${edge.y2}`} className="nx-auth-mesh-edge nx-auth-mesh-edge--source" x1={edge.x1} y1={edge.y1} x2={edge.x2} y2={edge.y2} />
          ))}
        {meshSourceEdges
          .filter((edge) => edge.hot)
          .map((edge) => (
            <line key={`hot-${edge.x1}-${edge.y1}-${edge.x2}-${edge.y2}`} className="nx-auth-mesh-edge nx-auth-mesh-edge--hot" x1={edge.x1} y1={edge.y1} x2={edge.x2} y2={edge.y2} />
          ))}

        {meshNodes.map((node) => (
          <g key={node.name} className="nx-auth-mesh-node" style={{ animationDelay: node.delay, animationDuration: node.duration }}>
            <circle cx={node.x} cy={node.y} r={node.size + 8} className={node.hot ? 'nx-auth-mesh-node-halo is-hot' : 'nx-auth-mesh-node-halo'} />
            <circle cx={node.x} cy={node.y} r={node.size} className={node.hot ? 'nx-auth-mesh-node-dot is-hot' : 'nx-auth-mesh-node-dot'} style={{ animationDuration: node.twinkle }} />
            <text x={node.x} y={node.y + node.size + 21} textAnchor="middle" className={node.hot ? 'nx-auth-mesh-node-label is-hot' : 'nx-auth-mesh-node-label'}>
              {node.name}
            </text>
          </g>
        ))}

        <g className="nx-auth-mesh-hub" transform={`translate(${meshSource.x} ${meshSource.y})`}>
          <circle r="62" className="nx-auth-mesh-hub-halo" />
          <circle r="41" className="nx-auth-mesh-hub-orb" />
          <text y="5" textAnchor="middle" className="nx-auth-mesh-hub-text">
            nexez
          </text>
        </g>
      </svg>
    </div>
  )
}

function GoogleGlyph({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path
        fill="#4285F4"
        d="M23.06 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h6.19a5.29 5.29 0 0 1-2.29 3.47v2.88h3.71c2.17-2 3.45-4.94 3.45-8.36z"
      />
      <path
        fill="#34A853"
        d="M12 24c3.1 0 5.7-1.03 7.6-2.79l-3.71-2.88c-1.03.69-2.35 1.1-3.89 1.1-2.99 0-5.52-2.02-6.43-4.74H1.74v2.98A11.5 11.5 0 0 0 12 24z"
      />
      <path
        fill="#FBBC05"
        d="M5.57 14.69a6.9 6.9 0 0 1 0-4.38V7.33H1.74a11.5 11.5 0 0 0 0 10.34l3.83-2.98z"
      />
      <path
        fill="#EA4335"
        d="M12 4.75c1.68 0 3.19.58 4.38 1.71l3.29-3.29C17.7 1.2 15.1 0 12 0 7.4 0 3.43 2.65 1.74 7.33l3.83 2.98C6.48 7.29 9.01 4.75 12 4.75z"
      />
    </svg>
  )
}

function Field({ label, icon, children }: { label: string; icon?: ReactNode; children: ReactNode }) {
  return (
    <label className="nx-auth-field">
      <span className="nx-auth-label">
        {icon ? <span className="text-[var(--nx-auth-muted)]">{icon}</span> : null}
        {label}
      </span>
      {children}
    </label>
  )
}

const inputClass = 'nx-auth-input'
