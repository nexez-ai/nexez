'use client'

import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { useRouter } from 'next/navigation'
import {
  ArrowLeft,
  ArrowRight,
  BadgeCheck,
  Check,
  CheckCircle2,
  CreditCard,
  Eye,
  EyeOff,
  Gauge,
  Globe2,
  Loader2,
  LockKeyhole,
  Mail,
  Rocket,
  ShieldCheck,
  Sparkles,
  User,
  WalletCards,
} from 'lucide-react'
import { NexezLogo } from '../../components/NexezLogo'
import { createClient } from '../../utils/supabase/client'
import { billingPlans } from '../../lib/billing'
import { safeNextPath } from '../../lib/safe-redirect'

type Step = 1 | 2 | 3 | 4

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

const steps: Array<{ num: Step; title: string; text: string; icon: ReactNode }> = [
  { num: 1, title: 'Plan', text: 'Choose how to begin.', icon: <Sparkles className="size-4" /> },
  { num: 2, title: 'Account', text: 'Create your workspace.', icon: <User className="size-4" /> },
  { num: 3, title: 'Payments', text: 'Prepare direct checkout.', icon: <WalletCards className="size-4" /> },
  { num: 4, title: 'Launch', text: 'Start building listings.', icon: <Rocket className="size-4" /> },
]

const launchChecklist = [
  'Agent-readable listing structure',
  'Deterministic simulator and readiness scoring',
  'Conversion tracking for AI traffic',
  'Bookings and checkout paths',
]

export default function OnboardPage() {
  const router = useRouter()
  const [step, setStep] = useState<Step>(1)
  const [selectedPlanId, setSelectedPlanId] = useState('free')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [fullName, setFullName] = useState('')
  const [company, setCompany] = useState('')
  const [agree, setAgree] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [needsEmailConfirm, setNeedsEmailConfirm] = useState(false)
  const [nextPath, setNextPath] = useState('/dashboard')
  // Signed in but plan-less (OAuth first-touch, e.g. Continue with Google): the account
  // exists, so onboarding skips the Account step and the plan pick starts the trial.
  const [authedPlanPick, setAuthedPlanPick] = useState(false)
  const [authedEmail, setAuthedEmail] = useState('')
  const [scanContext, setScanContext] = useState<{ domain: string; score: number | null } | null>(null)

  const selectablePlans = useMemo(() => billingPlans.filter((p) => p.id !== 'enterprise'), [])
  const selectedPlan = billingPlans.find((p) => p.id === selectedPlanId) || selectablePlans[0]
  const postSignupPath = nextPath
  const strength = useMemo(() => scorePassword(password), [password])
  const progress = Math.round((step / steps.length) * 100)

  useEffect(() => {
    let cancelled = false
    const params = new URLSearchParams(window.location.search)
    const planParam = params.get('plan')
    if (planParam && selectablePlans.some((p) => p.id === planParam)) setSelectedPlanId(planParam)
    const next = safeNextPath(params.get('next'))
    if (next) setNextPath(next)
    const scanToken = params.get('scan')
    if (scanToken) {
      fetch('/api/scan/attribution', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ token: scanToken }),
      })
        .then(async (response) => response.ok
          ? response.json() as Promise<{ domain: string; score: number | null }>
          : null)
        .then((context) => {
          if (!cancelled && context?.domain) setScanContext(context)
        })
        .catch(() => null)
    }
    createClient()
      .auth.getUser()
      .then(async ({ data }) => {
        if (!data.user || cancelled) return
        // Signed in: does this account already have billing state? An OAuth first-touch
        // (Continue with Google) does not - keep them here to pick a plan. Anyone with a
        // billing row heads to the dashboard as before. On a failed probe, STAYING is the
        // safe default: the plan pick is idempotent for accounts that already have billing,
        // while bouncing a plan-less account would silently seed the default trial.
        const res = await fetch('/api/billing/start-trial').catch(() => null)
        const info = res && res.ok ? ((await res.json().catch(() => null)) as { hasBilling?: boolean } | null) : null
        if (cancelled) return
        if (info?.hasBilling) {
          router.replace(next || '/dashboard')
          return
        }
        setAuthedPlanPick(true)
        setAuthedEmail(data.user.email ?? '')
      })
    return () => {
      cancelled = true
    }
  }, [router, selectablePlans])

  function validateAccount() {
    if (!fullName.trim()) return 'Enter your full name.'
    if (!company.trim()) return 'Enter your company or business name.'
    if (!email.trim()) return 'Enter your work email.'
    if (password.length < 8) return 'Password must be at least 8 characters.'
    if (!agree) return 'Accept the Terms and Privacy Policy to continue.'
    return ''
  }

  async function handleSignupAndContinue() {
    const validationError = validateAccount()
    if (validationError) {
      setError(validationError)
      return
    }

    setLoading(true)
    setError('')
    const supabase = createClient()

    try {
      const { data, error: signUpError } = await supabase.auth.signUp({
        email: email.trim(),
        password,
        options: {
          data: { full_name: fullName.trim(), company: company.trim(), plan: selectedPlanId },
          emailRedirectTo: `${window.location.origin}/auth/callback?next=${encodeURIComponent(postSignupPath)}`,
        },
      })

      if (signUpError) {
        setError(signUpError.message)
        return
      }

      if (!data.session) {
        setNeedsEmailConfirm(true)
        return
      }

      // Non-fatal: the auth-callback + dashboard backstops persist the selected
      // billing state from user_metadata, so a transient failure self-heals. Still
      // validate the response (parity with the signUp / connect calls) and log a
      // non-OK instead of silently swallowing it.
      const trialRes = await fetch('/api/billing/start-trial', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ plan: selectedPlanId }),
      }).catch(() => null)
      if (!trialRes || !trialRes.ok) {
        console.warn('[onboard] billing initialization did not confirm; relying on the seed backstop', trialRes?.status ?? 'network')
      }

      setStep(3)
    } finally {
      setLoading(false)
    }
  }

  // Authed plan-less path (OAuth first-touch): the account already exists, so persist
  // the explicit Free/trial choice and skip the Account step.
  async function handleAuthedPlanContinue() {
    if (loading) return
    setLoading(true)
    setError('')
    try {
      const res = await fetch('/api/billing/start-trial', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ plan: selectedPlanId }),
      }).catch(() => null)
      const data = res
        ? ((await res.json().catch(() => ({}))) as { error?: string; alreadyHadAccount?: boolean; planId?: string | null })
        : null
      if (!res || !res.ok) {
        setError(data?.error || 'Could not initialize your plan. Please try again.')
        return
      }
      // A billing row already existed (double-click, or back-and-repick after the first
      // Continue): billing is the source of truth, so reflect ITS plan in the UI rather
      // than pretending the new selection took. Plan changes happen from Billing.
      if (data?.alreadyHadAccount && typeof data.planId === 'string' && data.planId) {
        setSelectedPlanId(data.planId)
      }
      setStep(3)
    } finally {
      setLoading(false)
    }
  }

  async function handleStripeConnect() {
    setLoading(true)
    setError('')
    try {
      const res = await fetch('/api/billing/connect', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ plan: selectedPlanId }),
      })
      const data = await res.json()
      if (data.url) {
        window.location.href = data.url
        return
      }
      setError(data.error || 'Failed to start Stripe Connect onboarding.')
    } catch (event) {
      setError(event instanceof Error ? event.message : 'Connect error')
    } finally {
      setLoading(false)
    }
  }

  function finishOnboarding() {
    router.push(postSignupPath)
  }

  return (
    <main className="nx-auth-page nx-onboard-page">
      <OnboardingBackdrop />
      <div className="nx-auth-shell">
        <header className="nx-auth-topbar">
          <a href="/" className="nx-auth-logo" aria-label="Nexez home">
            <span className="nx-auth-logo-mark">
              <NexezLogo className="size-6" />
            </span>
            <span>Nexez</span>
          </a>
          <nav className="nx-auth-nav" aria-label="Onboarding links">
            {!authedPlanPick ? (
              <a href="/login" className="nx-auth-link">
                Sign in
              </a>
            ) : null}
            <a href="/pricing" className="nx-auth-secondary">
              Compare plans
            </a>
          </nav>
        </header>

        <div className="nx-onboard-stage">
          <aside className="nx-onboard-lead">
            <div className="nx-auth-eyebrow">
              <span className="nx-auth-signal-dot" />
              Guided launch
            </div>
            <h1 className="nx-onboard-lead-title">Build your agent-ready storefront.</h1>
            <p className="nx-onboard-lead-copy">
              Start free, create your workspace, prepare direct payments, then publish a business agents can understand.
            </p>

            <div className="nx-onboard-meter">
              <div className="nx-onboard-meter-top">
                <span>Setup progress</span>
                <span className="font-mono">{progress}%</span>
              </div>
              <div className="nx-onboard-meter-bar">
                <span style={{ width: `${progress}%` }} />
              </div>
            </div>

            <ol className="nx-onboard-step-list">
              {steps.map((s) => {
                // Authed plan-pick (OAuth first-touch): the workspace already exists, so
                // the Account step reads as done from the start.
                const accountDone = authedPlanPick && s.num === 2
                const done = accountDone || step > s.num
                const status = !done && step === s.num ? 'is-active' : done ? 'is-done' : ''
                return (
                  <li key={s.num} className={`nx-onboard-step-item ${status}`}>
                    <span className="nx-onboard-step-icon">{done ? <Check className="size-4" /> : s.icon}</span>
                    <span className="min-w-0">
                      <span className="block text-sm font-semibold">{s.title}</span>
                      <span className="block text-xs leading-5 text-[var(--nx-auth-muted)]">
                        {accountDone ? 'Signed in.' : s.text}
                      </span>
                    </span>
                  </li>
                )
              })}
            </ol>

            <div className="nx-onboard-selected">
              <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[var(--nx-auth-muted)]">Selected plan</p>
              <div className="mt-3 flex items-end justify-between gap-3">
                <div>
                  <p className="text-xl font-semibold">{selectedPlan.name}</p>
                  <p className="mt-1 text-xs leading-5 text-[var(--nx-auth-muted)]">{selectedPlan.blurb}</p>
                </div>
                <p className="shrink-0 font-mono text-lg font-semibold">
                  {selectedPlan.price}
                  {selectedPlan.cadence ? <span className="text-xs text-[var(--nx-auth-muted)]">/{selectedPlan.cadence}</span> : null}
                </p>
              </div>
            </div>
          </aside>

          <section className="nx-onboard-workspace">
            <div className="nx-onboard-main-card">
              <div className="nx-onboard-main-head">
                <div>
                  <p className="nx-onboard-kicker">Step {step} of 4</p>
                  <h2 className="nx-onboard-heading">
                    {step === 1
                      ? 'Choose your starting plan'
                      : step === 2
                        ? needsEmailConfirm
                          ? 'Confirm your email'
                          : 'Create your account'
                        : step === 3
                          ? 'Prepare direct payments'
                          : selectedPlan.id === 'free'
                            ? 'Your workspace is ready'
                            : 'Your trial is live'}
                  </h2>
                </div>
                <StatusPill step={step} />
              </div>

              <div className="nx-onboard-main-body">
                {scanContext ? (
                  <div className="mb-5 rounded-[18px] border border-[var(--nx-auth-signal)]/25 bg-[var(--nx-auth-signal)]/10 p-4 text-sm leading-6 text-[var(--nx-auth-soft)]">
                    <p className="font-semibold text-[var(--nx-auth-text)]">Continuing from your {scanContext.domain} scan</p>
                    <p className="mt-1 text-xs leading-5 text-[var(--nx-auth-muted)]">
                      {typeof scanContext.score === 'number'
                        ? `Your ${scanContext.score}/100 result stays linked to this workspace so you can measure the path from scan to published listing and Launch activation.`
                        : 'Your scan stays linked to this workspace so you can measure the path from scan to published listing and Launch activation.'}
                    </p>
                  </div>
                ) : null}
                {step === 1 ? (
                  <PlanStep
                    selectablePlans={selectablePlans}
                    selectedPlanId={selectedPlanId}
                    onSelect={setSelectedPlanId}
                    onContinue={authedPlanPick ? handleAuthedPlanContinue : () => setStep(2)}
                    loading={authedPlanPick && loading}
                    error={authedPlanPick ? error : ''}
                    authedEmail={authedPlanPick ? authedEmail : ''}
                  />
                ) : null}

                {step === 2 && needsEmailConfirm ? (
                  <EmailConfirmStep
                    email={email}
                    selectedPlanName={selectedPlan.name}
                    isFree={selectedPlan.id === 'free'}
                    onBack={() => setNeedsEmailConfirm(false)}
                  />
                ) : null}

                {step === 2 && !needsEmailConfirm ? (
                  <AccountStep
                    selectedPlanName={selectedPlan.name}
                    fullName={fullName}
                    company={company}
                    email={email}
                    password={password}
                    showPassword={showPassword}
                    agree={agree}
                    loading={loading}
                    error={error}
                    strength={strength}
                    onFullName={setFullName}
                    onCompany={setCompany}
                    onEmail={setEmail}
                    onPassword={setPassword}
                    onTogglePassword={() => setShowPassword((value) => !value)}
                    onAgree={setAgree}
                    onBack={() => setStep(1)}
                    onContinue={handleSignupAndContinue}
                  />
                ) : null}

                {step === 3 ? (
                  <PaymentsStep
                    loading={loading}
                    error={error}
                    onConnect={handleStripeConnect}
                    onSkip={() => setStep(4)}
                    onBack={() => setStep(authedPlanPick ? 1 : 2)}
                  />
                ) : null}

                {step === 4 ? <LaunchStep selectedPlan={selectedPlan} onDashboard={finishOnboarding} /> : null}
              </div>
            </div>
          </section>
        </div>
      </div>
    </main>
  )
}

function PlanStep({
  selectablePlans,
  selectedPlanId,
  onSelect,
  onContinue,
  loading = false,
  error = '',
  authedEmail = '',
}: {
  selectablePlans: typeof billingPlans
  selectedPlanId: string
  onSelect: (id: string) => void
  onContinue: () => void
  loading?: boolean
  error?: string
  authedEmail?: string
}) {
  return (
    <div>
      <p className="max-w-2xl text-sm leading-6 text-[var(--nx-auth-muted)]">
        {authedEmail ? (
          <>
            Signed in as <span className="font-medium text-[var(--nx-auth-text)]">{authedEmail}</span>. Start permanently
            on Free or choose a seven-day paid-plan trial. No card is required today.
          </>
        ) : (
          <>Start permanently on Free or choose a seven-day paid-plan trial. Eligible verified Free businesses with a live listing can receive Launch for 180 days while the campaign is available.</>
        )}
      </p>
      <div className="nx-onboard-plan-grid">
        {selectablePlans.map((plan) => {
          const isSelected = selectedPlanId === plan.id
          const isPopular = plan.id === 'pro'
          return (
            <button
              key={plan.id}
              type="button"
              onClick={() => onSelect(plan.id)}
              className={`nx-onboard-plan ${isSelected ? 'is-selected' : ''}`}
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-lg font-semibold">{plan.name}</p>
                  <p className="mt-1 text-xs leading-5 text-[var(--nx-auth-muted)]">{plan.blurb}</p>
                </div>
                {isPopular ? <span className="nx-auth-live">Best fit</span> : null}
                {plan.id === 'free' ? <span className="nx-auth-live">Start here</span> : null}
              </div>
              <div className="mt-6">
                <span className="text-4xl font-semibold tracking-[-0.04em]">{plan.price}</span>
                {plan.cadence ? <span className="text-sm text-[var(--nx-auth-muted)]">/{plan.cadence}</span> : null}
              </div>
              <ul className="mt-6 space-y-2 text-xs leading-5 text-[var(--nx-auth-muted)]">
                {plan.features.slice(0, 4).map((feature) => (
                  <li key={feature} className="flex gap-2">
                    <Check className="mt-0.5 size-3.5 shrink-0 text-[var(--nx-auth-ready)]" />
                    <span>{feature}</span>
                  </li>
                ))}
              </ul>
              {plan.id === 'free' ? (
                <p className="mt-4 rounded-xl border border-[var(--nx-auth-ready)]/20 bg-[var(--nx-auth-ready)]/10 p-3 text-xs leading-5 text-[var(--nx-auth-soft)]">
                  Eligible verified businesses with a live listing can receive 180 complimentary days of Launch access while the campaign is available.
                </p>
              ) : null}
              <div className="mt-auto pt-6">
                <span className={`inline-flex w-full items-center justify-center gap-2 rounded-[17px] px-4 py-3 text-sm font-semibold transition ${isSelected ? 'bg-[#fafafa] text-[#050505]' : 'border border-[var(--nx-auth-line)] text-[var(--nx-auth-muted)] group-hover:text-[var(--nx-auth-text)]'}`}>
                  {isSelected ? 'Selected' : 'Select plan'}
                </span>
              </div>
            </button>
          )
        })}
      </div>

      <div className="nx-onboard-callout">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <span className="flex size-10 items-center justify-center rounded-2xl border border-[var(--nx-auth-line)] bg-white/[0.055] text-[var(--nx-auth-signal)]">
              <Gauge className="size-5" />
            </span>
            <div>
              <p className="font-semibold">Build before you pay</p>
              <p className="text-xs text-[var(--nx-auth-muted)]">Free includes the core publishing and agent-readiness tools.</p>
            </div>
          </div>
          <a href="/pricing" className="text-sm font-medium text-[var(--nx-auth-muted)] underline decoration-white/25 underline-offset-4 hover:text-[var(--nx-auth-text)] hover:decoration-white">
            Compare every plan
          </a>
        </div>
        <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {launchChecklist.map((item) => (
            <div key={item} className="flex gap-3 rounded-[18px] border border-[var(--nx-auth-line)] bg-white/[0.035] p-3 text-sm text-[var(--nx-auth-soft)]">
              <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-[var(--nx-auth-ready)]" />
              {item}
            </div>
          ))}
        </div>
      </div>

      {error ? (
        <p role="alert" className="nx-auth-message nx-auth-message--error mt-6">
          {error}
        </p>
      ) : null}

      <div className="mt-6 flex flex-wrap items-center gap-3">
        <button type="button" onClick={onContinue} disabled={loading} className="nx-auth-primary disabled:cursor-not-allowed disabled:opacity-60">
          {loading ? <Loader2 className="size-4 animate-spin" /> : null}
          {selectedPlanId === 'free'
            ? 'Start Free'
            : authedEmail
              ? 'Start my trial'
              : 'Continue with selected plan'}
          {!loading ? <ArrowRight className="size-4" /> : null}
        </button>
        {!authedEmail ? (
          <a href="/login" className="nx-auth-ghost-button">
            I already have an account
          </a>
        ) : null}
      </div>
    </div>
  )
}

function EmailConfirmStep({
  email,
  selectedPlanName,
  isFree,
  onBack,
}: {
  email: string
  selectedPlanName: string
  isFree: boolean
  onBack: () => void
}) {
  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
      <div>
        <div className="flex size-14 items-center justify-center rounded-2xl border border-[var(--nx-auth-ready)]/30 bg-[var(--nx-auth-ready)]/10 text-[var(--nx-auth-ready)]">
          <Mail className="size-6" />
        </div>
        <h3 className="mt-6 text-3xl font-semibold tracking-[-0.04em]">Check your inbox.</h3>
        <p className="mt-3 max-w-xl text-sm leading-6 text-[var(--nx-auth-muted)]">
          We sent a confirmation link to <span className="font-medium text-[var(--nx-auth-text)]">{email}</span>. Confirm your email to activate your {isFree ? 'Free workspace' : `seven-day ${selectedPlanName} trial`}.
        </p>
        <button type="button" onClick={onBack} className="nx-auth-ghost-button mt-6">
          <ArrowLeft className="size-4" />
          Edit account details
        </button>
      </div>
      <div className="rounded-[24px] border border-[var(--nx-auth-line)] bg-[#050505] p-5">
        <p className="text-sm font-semibold">What happens next</p>
        <div className="mt-4 space-y-3 text-sm text-[var(--nx-auth-muted)]">
          {['Open the confirmation email.', 'Return to Nexez with your session active.', 'Create your first agent-ready listing.'].map((item, index) => (
            <div key={item} className="flex gap-3">
              <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-white/10 font-mono text-xs text-[var(--nx-auth-text)]">{index + 1}</span>
              <span>{item}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

function AccountStep(props: {
  selectedPlanName: string
  fullName: string
  company: string
  email: string
  password: string
  showPassword: boolean
  agree: boolean
  loading: boolean
  error: string
  strength: { score: number; label: string; color: string }
  onFullName: (value: string) => void
  onCompany: (value: string) => void
  onEmail: (value: string) => void
  onPassword: (value: string) => void
  onTogglePassword: () => void
  onAgree: (value: boolean) => void
  onBack: () => void
  onContinue: () => void
}) {
  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
      <div className="max-w-2xl">
        <p className="text-sm leading-6 text-[var(--nx-auth-muted)]">
          You are starting on the {props.selectedPlanName} plan. This creates your owner workspace so listings, imports, analytics, and payments stay tied to your business.
        </p>
        <div className="mt-6 grid gap-4 sm:grid-cols-2">
          <Field label="Full name" icon={<User className="size-4" />}>
            <input value={props.fullName} onChange={(event) => props.onFullName(event.target.value)} className={inputClass} placeholder="Jordan Rivera" autoComplete="name" />
          </Field>
          <Field label="Business name" icon={<Globe2 className="size-4" />}>
            <input value={props.company} onChange={(event) => props.onCompany(event.target.value)} className={inputClass} placeholder="Apex Strategy Co." autoComplete="organization" />
          </Field>
          <Field label="Work email" icon={<Mail className="size-4" />}>
            <input value={props.email} onChange={(event) => props.onEmail(event.target.value)} className={inputClass} placeholder="you@company.com" type="email" autoComplete="email" />
          </Field>
          <Field label="Password" icon={<LockKeyhole className="size-4" />}>
            <div className="relative">
              <input
                value={props.password}
                onChange={(event) => props.onPassword(event.target.value)}
                className={`${inputClass} pr-12`}
                placeholder="At least 8 characters"
                type={props.showPassword ? 'text' : 'password'}
                autoComplete="new-password"
              />
              <button
                type="button"
                onClick={props.onTogglePassword}
                className="absolute right-3 top-1/2 flex size-8 -translate-y-1/2 items-center justify-center rounded-lg text-[var(--nx-auth-muted)] transition hover:bg-white/10 hover:text-[var(--nx-auth-text)]"
                aria-label={props.showPassword ? 'Hide password' : 'Show password'}
              >
                {props.showPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
              </button>
            </div>
            {props.password ? (
              <div className="mt-2">
                <div className="h-1.5 w-full overflow-hidden rounded-full bg-white/10">
                  <div className="h-full rounded-full transition-all" style={{ width: `${Math.max(10, (props.strength.score / 4) * 100)}%`, backgroundColor: props.strength.color }} />
                </div>
                <p className="mt-1 text-xs" style={{ color: props.strength.color }}>
                  {props.strength.label}
                </p>
              </div>
            ) : null}
          </Field>
        </div>

        <label className="mt-5 flex items-start gap-3 rounded-[18px] border border-[var(--nx-auth-line)] bg-white/[0.035] p-4 text-xs leading-5 text-[var(--nx-auth-muted)]">
          <input
            type="checkbox"
            checked={props.agree}
            onChange={(event) => props.onAgree(event.target.checked)}
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

        {props.error ? <p role="alert" className="nx-auth-message nx-auth-message--error mt-4">{props.error}</p> : null}

        <div className="mt-6 flex flex-wrap gap-3">
          <button type="button" onClick={props.onBack} className="nx-auth-ghost-button">
            <ArrowLeft className="size-4" />
            Back
          </button>
          <button type="button" onClick={props.onContinue} disabled={props.loading} className="nx-auth-submit max-w-[220px]">
            {props.loading ? <Loader2 className="size-4 animate-spin" /> : null}
            Create account
            {!props.loading ? <ArrowRight className="size-4" /> : null}
          </button>
        </div>
      </div>

      <div className="rounded-[24px] border border-[var(--nx-auth-line)] bg-[#050505] p-5">
        <p className="text-sm font-semibold">Workspace protection</p>
        <div className="mt-4 space-y-3">
          <SecurityRow icon={<ShieldCheck className="size-4" />} title="Session protected" text="Private tools stay behind auth." />
          <SecurityRow icon={<BadgeCheck className="size-4" />} title="Public listings stay crawlable" text="Listings remain clean and fast." />
          <SecurityRow icon={<Gauge className="size-4" />} title="No card required" text="Free remains available after promotional access." />
        </div>
      </div>
    </div>
  )
}

function PaymentsStep(props: { loading: boolean; error: string; onConnect: () => void; onSkip: () => void; onBack: () => void }) {
  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
      <div>
        <p className="max-w-2xl text-sm leading-6 text-[var(--nx-auth-muted)]">
          Stripe Connect lets agents and buyers pay through Nexez checkout. You can skip this now and use external booking links until payouts are connected.
        </p>
        <div className="mt-6 rounded-[24px] border border-[var(--nx-auth-line)] bg-[#050505] p-5">
          <div className="flex items-start gap-4">
            <span className="flex size-12 shrink-0 items-center justify-center rounded-2xl border border-[var(--nx-auth-line)] bg-white/[0.055] text-[var(--nx-auth-signal)]">
              <CreditCard className="size-6" />
            </span>
            <div>
              <p className="text-lg font-semibold">Secure Stripe Connect</p>
              <p className="mt-1 text-sm leading-6 text-[var(--nx-auth-muted)]">
                Nexez never sees card details. Stripe handles account verification, payouts, and payment security.
              </p>
            </div>
          </div>
          {props.error ? <p role="alert" className="nx-auth-message nx-auth-message--error mt-5">{props.error}</p> : null}
          <div className="mt-6 flex flex-wrap gap-3">
            <button type="button" onClick={props.onBack} className="nx-auth-ghost-button">
              <ArrowLeft className="size-4" />
              Back
            </button>
            <button type="button" onClick={props.onConnect} disabled={props.loading} className="nx-auth-submit max-w-[210px]">
              {props.loading ? <Loader2 className="size-4 animate-spin" /> : null}
              Connect Stripe
            </button>
            <button type="button" onClick={props.onSkip} className="nx-auth-ghost-button border-transparent bg-transparent">
              Skip for now
            </button>
          </div>
        </div>
      </div>
      <div className="rounded-[24px] border border-[var(--nx-auth-line)] bg-[#050505] p-5">
        <p className="text-sm font-semibold">When connected</p>
        <div className="mt-4 space-y-3 text-sm text-[var(--nx-auth-muted)]">
          {['Accept direct checkout payments.', 'Support agent-assisted purchases.', 'Track revenue from AI-driven sessions.'].map((item) => (
            <div key={item} className="flex gap-3">
              <Check className="mt-0.5 size-4 shrink-0 text-[var(--nx-auth-ready)]" />
              <span>{item}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

function LaunchStep({ selectedPlan, onDashboard }: { selectedPlan: (typeof billingPlans)[number]; onDashboard: () => void }) {
  const isFree = selectedPlan.id === 'free'
  return (
    <div className="text-center">
      <div className="mx-auto flex size-16 items-center justify-center rounded-3xl border border-[var(--nx-auth-ready)]/30 bg-[var(--nx-auth-ready)]/10 text-[var(--nx-auth-ready)]">
        <Rocket className="size-8" />
      </div>
      <h3 className="mt-6 text-4xl font-semibold tracking-[-0.05em]">
        {isFree ? 'Your workspace is ready.' : 'Your trial is live.'}
      </h3>
      <p className="mx-auto mt-3 max-w-2xl text-sm leading-6 text-[var(--nx-auth-muted)]">
        {isFree
          ? 'Build and publish your first agent-readable listing. Eligible businesses can receive 180 days of Launch access and two business invite passes after email and business verification, while the campaign is available.'
          : `Your seven-day ${selectedPlan.name} trial is ready. Build your first listing, publish it, then track which AI traffic turns into real demand.`}
      </p>
      <div className="mx-auto mt-8 grid max-w-3xl gap-3 text-left sm:grid-cols-3">
        {[
          ['Plan', isFree ? 'Free, no expiry' : `${selectedPlan.name} trial`],
          ['Next move', 'Create listing'],
          ['Payments', 'Connect anytime'],
        ].map(([label, value]) => (
          <div key={label} className="rounded-[18px] border border-[var(--nx-auth-line)] bg-[#050505] p-4">
            <p className="text-[11px] uppercase tracking-[0.16em] text-[var(--nx-auth-muted)]">{label}</p>
            <p className="mt-2 text-sm font-semibold">{value}</p>
          </div>
        ))}
      </div>
      <div className="mt-8 flex flex-wrap justify-center gap-3">
        <button type="button" onClick={onDashboard} className="nx-auth-primary">
          Go to Dashboard <ArrowRight className="size-4" />
        </button>
        <a href="/create" className="nx-auth-ghost-button">
          Create first listing
        </a>
      </div>
    </div>
  )
}

function StatusPill({ step }: { step: Step }) {
  const label = step === 1 ? 'No card required' : step === 2 ? 'Secure account' : step === 3 ? 'Optional now' : 'Ready'
  return (
    <span className="nx-auth-live">
      <span className="inline-block size-1.5 rounded-full bg-[var(--nx-auth-ready)]" />
      {label}
    </span>
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

function SecurityRow({ icon, title, text }: { icon: ReactNode; title: string; text: string }) {
  return (
    <div className="flex gap-3 rounded-[18px] border border-[var(--nx-auth-line)] bg-white/[0.035] p-3">
      <span className="flex size-8 shrink-0 items-center justify-center rounded-xl bg-white/[0.055] text-[var(--nx-auth-signal)]">{icon}</span>
      <span>
        <span className="block text-sm font-semibold">{title}</span>
        <span className="block text-xs leading-5 text-[var(--nx-auth-muted)]">{text}</span>
      </span>
    </div>
  )
}

function OnboardingBackdrop() {
  return <div aria-hidden="true" className="nx-auth-backdrop" />
}

const inputClass = 'nx-auth-input'
