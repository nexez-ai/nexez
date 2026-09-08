'use client'

import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react'
import { ArrowRight, Check, Copy, Loader2, Mail, Minus, RefreshCw, Sparkles, X } from 'lucide-react'
import { appUrl } from '../../lib/site'

type DimensionKey = 'discovery' | 'understanding' | 'transactability' | 'trust'
type Dimension = { label: string; score: number }
type ScanCheck = {
  id: string
  dimension: DimensionKey
  label: string
  status: 'pass' | 'warn' | 'fail'
  detail: string
}
type ScanResult = {
  ok: true
  url: string
  origin: string
  elapsedMs: number
  scannedAt: string
  version: number
  score: number
  dimensions: Record<DimensionKey, Dimension>
  checks: ScanCheck[]
  blockedBots: string[]
}
type Comprehension = {
  score: number
  understandingScore: number
  transactionScore: number
  agentRead: string
  topFix: string
}
type DeepResult = ScanResult & { llmAssisted: boolean; comprehension?: Comprehension; upgradeHint?: string }

const DIMENSION_ORDER: DimensionKey[] = ['discovery', 'understanding', 'transactability', 'trust']

// Pre-scan explainer: what each dimension means in buyer terms, no jargon.
const DIMENSION_EXPLAINERS: Array<[string, string]> = [
  ['Discovery', 'Can crawlers and AI agents reach your pages at all, or are they blocked before they start?'],
  ['Understanding', 'Can an agent pull your actual offers, prices, and policies out of the page?'],
  ['Ways to buy', 'Is there a booking or checkout path an AI assistant can follow all the way to the end?'],
  ['Trust', 'Do contact details, policies, and freshness signals hold up when an agent verifies them?'],
]

function scoreTone(score: number): { color: string; label: string } {
  if (score >= 85) return { color: 'var(--ready)', label: 'Agent-ready' }
  if (score >= 60) return { color: 'var(--amber)', label: 'Needs a few fixes' }
  return { color: '#ef4444', label: 'Hard for agents' }
}

function ScoreRing({ score }: { score: number }) {
  const { color, label } = scoreTone(score)
  const radius = 52
  const circumference = 2 * Math.PI * radius
  const dash = (Math.max(0, Math.min(100, score)) / 100) * circumference
  return (
    <div className="flex flex-col items-center gap-2">
      <div className="relative size-[140px]">
        <svg width={140} height={140} viewBox="0 0 140 140" aria-hidden="true">
          <circle cx={70} cy={70} r={radius} fill="none" stroke="var(--bd-10)" strokeWidth={12} />
          <circle
            cx={70}
            cy={70}
            r={radius}
            fill="none"
            stroke={color}
            strokeWidth={12}
            strokeLinecap="round"
            strokeDasharray={`${dash} ${circumference}`}
            transform="rotate(-90 70 70)"
            style={{ transition: 'stroke-dasharray 700ms cubic-bezier(.4,0,.2,1)' }}
          />
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className="font-mono text-4xl font-semibold" style={{ color }}>{score}</span>
          <span className="text-xs text-[var(--fg-muted)]">/ 100</span>
        </div>
      </div>
      <span className="text-sm font-semibold" style={{ color }}>{label}</span>
    </div>
  )
}

function DimensionMeter({ value, before }: { value: Dimension; before?: number }) {
  const delta = typeof before === 'number' ? value.score - before : null
  return (
    <div className="border-t border-[var(--bd-10)] py-4 first:border-t-0 sm:border-l sm:border-t-0 sm:px-4 sm:first:border-l-0 sm:first:pl-0">
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-xs font-medium text-[var(--fg-muted)]">{value.label}</span>
        <span className="font-mono text-sm font-semibold">
          {value.score}
          {delta !== null && delta !== 0 ? (
            <span className={delta > 0 ? 'ml-1 text-[var(--ready)]' : 'ml-1 text-red-400'}>
              {delta > 0 ? '+' : ''}{delta}
            </span>
          ) : null}
        </span>
      </div>
      <div
        className="mt-2 h-1.5 overflow-hidden rounded-full bg-[var(--bd-10)]"
        role="progressbar"
        aria-label={`${value.label} score`}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={value.score}
      >
        <div
          className="h-full rounded-full bg-[var(--signal)] transition-[width] duration-700"
          style={{ width: `${value.score}%` }}
        />
      </div>
    </div>
  )
}

function CheckRow({ check }: { check: ScanCheck }) {
  const icon = check.status === 'pass'
    ? <Check className="size-4 text-[var(--ready)]" />
    : check.status === 'warn'
      ? <Minus className="size-4 text-[var(--amber)]" />
      : <X className="size-4 text-red-400" />
  return (
    <li className="flex items-start gap-3 border-t border-[var(--bd-10)] py-3 first:border-t-0">
      <span className="mt-0.5 shrink-0">{icon}</span>
      <span className="min-w-0 flex-1">
        <span className="flex flex-wrap items-baseline justify-between gap-x-3">
          <span className="text-sm font-medium">{check.label}</span>
          <span className="font-mono text-[10px] uppercase text-[var(--fg-muted)]">{check.dimension}</span>
        </span>
        <span className="block text-xs leading-5 text-[var(--fg-muted)]">{check.detail}</span>
      </span>
    </li>
  )
}

export function ScanClient({ initialUrl = '' }: { initialUrl?: string }) {
  const [url, setUrl] = useState(initialUrl)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [result, setResult] = useState<ScanResult | null>(null)
  const [previous, setPrevious] = useState<ScanResult | null>(null)
  const [deep, setDeep] = useState<DeepResult | null>(null)
  const [deepLoading, setDeepLoading] = useState(false)
  const [deepMsg, setDeepMsg] = useState('')
  const [needsAuth, setNeedsAuth] = useState(false)
  const [shareMsg, setShareMsg] = useState('')
  const [email, setEmail] = useState('')
  const [emailStatus, setEmailStatus] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle')
  const [emailMsg, setEmailMsg] = useState('')
  const [scanAttributionToken, setScanAttributionToken] = useState('')
  const autoStarted = useRef(false)

  const runScan = useCallback(async (rawValue: string, compare = false) => {
    const value = rawValue.trim()
    if (!value) return
    const baseline = compare ? result : null
    setLoading(true)
    setError('')
    setDeep(null)
    setDeepMsg('')
    setNeedsAuth(false)
    setShareMsg('')
    setEmailStatus('idle')
    setEmailMsg('')
    if (!compare) {
      setResult(null)
      setPrevious(null)
    }
    try {
      const response = await fetch('/api/scan', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ url: value, source: 'scan-page' }),
      })
      const data = await response.json().catch(() => ({}))
      if (!response.ok) {
        setError(data?.error || 'Could not scan that URL. Try another.')
        return
      }
      const next = data as ScanResult
      setUrl(next.url)
      setPrevious(baseline?.origin === next.origin ? baseline : null)
      setResult(next)
      const shareUrl = new URL(window.location.href)
      shareUrl.pathname = '/scan'
      shareUrl.search = ''
      shareUrl.searchParams.set('url', next.url)
      window.history.replaceState(null, '', `${shareUrl.pathname}${shareUrl.search}`)
    } catch {
      setError('Network error. Please try again.')
    } finally {
      setLoading(false)
    }
  }, [result])

  useEffect(() => {
    if (!initialUrl || autoStarted.current) return
    autoStarted.current = true
    void runScan(initialUrl)
  }, [initialUrl, runScan])

  function onSubmit(event: FormEvent) {
    event.preventDefault()
    if (!loading) void runScan(url)
  }

  async function runDeep() {
    if (!result || deepLoading) return
    setDeepLoading(true)
    setDeepMsg('')
    setNeedsAuth(false)
    try {
      const response = await fetch('/api/scan/deep', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ url: result.url }),
      })
      const data = await response.json().catch(() => ({}))
      if (response.status === 401) {
        setNeedsAuth(true)
        return
      }
      if (!response.ok) {
        setDeepMsg(data?.error || 'Could not run the AI analysis.')
        return
      }
      setDeep(data as DeepResult)
      if (data?.upgradeHint) setDeepMsg(data.upgradeHint)
    } catch {
      setDeepMsg('Network error. Please try again.')
    } finally {
      setDeepLoading(false)
    }
  }

  async function copyShareLink() {
    if (!result) return
    const shareUrl = new URL('/scan', window.location.origin)
    shareUrl.searchParams.set('url', result.url)
    try {
      await navigator.clipboard.writeText(shareUrl.toString())
      setShareMsg('Link copied')
    } catch {
      setShareMsg('Copy failed')
    }
  }

  async function emailResult(event: FormEvent) {
    event.preventDefault()
    if (!result || !email.trim() || emailStatus === 'sending') return
    setEmailStatus('sending')
    setEmailMsg('')
    try {
      const response = await fetch('/api/scan/subscribe', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ url: result.url, email: email.trim() }),
      })
      const data = await response.json().catch(() => ({}))
      if (!response.ok) {
        setEmailStatus('error')
        setEmailMsg(data?.error || 'Could not queue the email. Please try again.')
        return
      }
      setEmailStatus('sent')
      if (typeof data?.attributionToken === 'string') {
        setScanAttributionToken(data.attributionToken)
      }
      setEmailMsg('If this address can receive scan results, the report is on its way.')
    } catch {
      setEmailStatus('error')
      setEmailMsg('Network error. Please try again.')
    }
  }

  const shown: ScanResult | DeepResult | null = deep ?? result
  const comparison = previous && !deep ? previous : null
  const comprehension = deep?.comprehension
  const attributionParam = scanAttributionToken
    ? `&scan=${encodeURIComponent(scanAttributionToken)}`
    : ''
  const deepHref = result
    ? appUrl(`/onboard?next=${encodeURIComponent(`/create?url=${encodeURIComponent(result.url)}`)}${attributionParam}`)
    : appUrl('/onboard')

  return (
    <main className="mx-auto w-full max-w-4xl px-5 py-16 sm:py-24">
      <div className="text-center">
        <p className="eyebrow text-[var(--signal)]">Free scan | no signup | no AI cost</p>
        <h1 className="display mt-4 text-balance">
          Your site is built for humans.{' '}
          <span className="nx-accent-text mx-auto block w-fit">Agents can&apos;t read it.</span>
        </h1>
        <p className="lede mx-auto mt-4 max-w-2xl">
          See what ChatGPT, Perplexity, and buyer agents actually pull from your site: your offers, your prices, and whether they can reach a checkout at all.
        </p>
      </div>

      <form onSubmit={onSubmit} className="mx-auto mt-8 flex max-w-2xl flex-col gap-3 sm:flex-row">
        <input
          type="text"
          inputMode="url"
          value={url}
          onChange={(event) => setUrl(event.target.value)}
          placeholder="https://yourwebsite.com"
          aria-label="Website URL to scan"
          disabled={loading}
          className="min-h-[52px] flex-1 rounded-[16px] border border-[var(--bd-10)] bg-[var(--ov-03)] px-4 text-base outline-none transition focus:border-[var(--signal)]"
        />
        <button type="submit" disabled={loading || !url.trim()} className="btn-primary min-h-[52px] px-6 disabled:opacity-60">
          {loading ? <Loader2 className="size-4 animate-spin" /> : null}
          {loading ? 'Scanning...' : 'See what agents see'}
          {!loading ? <ArrowRight className="size-4" /> : null}
        </button>
      </form>

      {error ? <p role="alert" className="mx-auto mt-4 max-w-2xl text-center text-sm text-red-400">{error}</p> : null}

      {shown ? (
        <section className="glass mt-10 rounded-[24px] p-6 sm:p-8" aria-live="polite">
          <div className="flex flex-col items-center gap-6 sm:flex-row sm:items-center sm:gap-8">
            <ScoreRing score={shown.score} />
            <div className="min-w-0 flex-1 text-center sm:text-left">
              <p className="text-xs uppercase tracking-[0.14em] text-[var(--fg-muted)]">Scanned</p>
              <p className="truncate text-lg font-semibold">{shown.origin}</p>
              <p className="mt-2 text-sm text-[var(--fg-muted)]">
                {deep?.llmAssisted
                  ? 'Evidence-based checks plus an AI buyer-agent reading of the offers.'
                  : `${shown.checks.length} evidence checks across discovery, understanding, ways to buy, and trust.`}
              </p>
              {comparison ? (
                <p className="mt-2 text-sm font-medium text-[var(--ready)]">
                  Rescan change: {shown.score - comparison.score > 0 ? '+' : ''}{shown.score - comparison.score} points
                </p>
              ) : null}
              {shown.blockedBots.length ? (
                <div className="mt-3 flex flex-wrap justify-center gap-1.5 sm:justify-start">
                  {shown.blockedBots.map((bot) => <span key={bot} className="chip text-xs text-[var(--amber)]">{bot} blocked</span>)}
                </div>
              ) : null}
            </div>
            <div className="flex shrink-0 gap-2">
              <button type="button" onClick={() => void runScan(result?.url || url, true)} disabled={loading} className="btn-secondary size-11 p-0" title="Rescan and compare" aria-label="Rescan and compare">
                <RefreshCw className={`size-4 ${loading ? 'animate-spin' : ''}`} />
              </button>
              <button type="button" onClick={copyShareLink} className="btn-secondary size-11 p-0" title="Copy shareable scan link" aria-label="Copy shareable scan link">
                <Copy className="size-4" />
              </button>
            </div>
          </div>
          {shareMsg ? <p className="mt-2 text-right text-xs text-[var(--fg-muted)]">{shareMsg}</p> : null}

          <div className="mt-8 grid sm:grid-cols-4">
            {DIMENSION_ORDER.map((key) => (
              <DimensionMeter key={key} value={shown.dimensions[key]} before={comparison?.dimensions[key].score} />
            ))}
          </div>

          <div className="mt-6 border-t border-[var(--bd-10)] pt-2">
            <p className="py-3 text-xs font-semibold uppercase tracking-[0.12em] text-[var(--fg-muted)]">Evidence checks</p>
            <ul>{shown.checks.map((check) => <CheckRow key={check.id} check={check} />)}</ul>
          </div>

          {comprehension ? (
            <div className="mt-6 border-t border-[var(--bd-10)] pt-6">
              <p className="flex flex-wrap items-center gap-2 text-sm font-semibold text-[var(--signal)]">
                <Sparkles className="size-4" /> AI buyer-agent read
                <span className="font-mono text-xs font-normal text-[var(--fg-muted)]">
                  understanding {comprehension.understandingScore} | action {comprehension.transactionScore}
                </span>
              </p>
              <p className="mt-2 text-sm leading-6">{comprehension.agentRead}</p>
              {comprehension.topFix ? <p className="mt-3 text-sm"><span className="font-semibold text-[var(--ready)]">Top fix: </span>{comprehension.topFix}</p> : null}
            </div>
          ) : (
            <div className="mt-6 flex flex-col items-start gap-2 border-t border-[var(--bd-10)] pt-6">
              <button type="button" onClick={runDeep} disabled={deepLoading} className="btn-secondary min-h-[44px] px-4 disabled:opacity-60">
                {deepLoading ? <Loader2 className="size-4 animate-spin" /> : <Sparkles className="size-4" />}
                {deepLoading ? 'Reading as an agent...' : 'Add AI buyer-agent analysis'}
              </button>
              {needsAuth ? (
                <p className="text-xs text-[var(--fg-muted)]"><a href={deepHref} className="underline underline-offset-4">Sign in</a> to run the model-assisted reading.</p>
              ) : (
                <p className="text-xs text-[var(--fg-muted)]">Optional analysis sends up to 8,000 characters of public page text to the configured model.</p>
              )}
              {deepMsg ? <p className="text-xs text-[var(--amber)]">{deepMsg}</p> : null}
            </div>
          )}

          <form onSubmit={emailResult} className="mt-8 rounded-[16px] border border-[var(--bd-10)] bg-[var(--ov-03)] p-4 sm:p-5">
            <div className="flex items-start gap-3">
              <Mail className="mt-0.5 size-4 shrink-0 text-[var(--signal)]" />
              <div>
                <p className="text-sm font-semibold">Email me this scan</p>
                <p className="mt-1 text-xs leading-5 text-[var(--fg-muted)]">
                  One scan-result email, including the findings and founding-cohort next step. Unsubscribe at any time.
                </p>
              </div>
            </div>
            <div className="mt-4 flex flex-col gap-2 sm:flex-row">
              <input
                type="email"
                inputMode="email"
                autoComplete="email"
                value={email}
                onChange={(event) => {
                  setEmail(event.target.value)
                  if (emailStatus !== 'idle') {
                    setEmailStatus('idle')
                    setEmailMsg('')
                  }
                }}
                placeholder="you@business.com"
                aria-label="Email address for scan result"
                disabled={emailStatus === 'sending' || emailStatus === 'sent'}
                required
                className="min-h-[46px] flex-1 rounded-[12px] border border-[var(--bd-10)] bg-black/20 px-4 text-sm outline-none transition focus:border-[var(--signal)] disabled:opacity-60"
              />
              <button
                type="submit"
                disabled={!email.trim() || emailStatus === 'sending' || emailStatus === 'sent'}
                className="btn-secondary min-h-[46px] px-5 disabled:opacity-60"
              >
                {emailStatus === 'sending' ? <Loader2 className="size-4 animate-spin" /> : <Mail className="size-4" />}
                {emailStatus === 'sending' ? 'Queueing...' : emailStatus === 'sent' ? 'Queued' : 'Email my result'}
              </button>
            </div>
            {emailMsg ? (
              <p role={emailStatus === 'error' ? 'alert' : 'status'} className={`mt-2 text-xs ${emailStatus === 'error' ? 'text-red-400' : 'text-[var(--ready)]'}`}>
                {emailMsg}
              </p>
            ) : null}
          </form>

          <div className="mt-8 flex flex-col gap-3 sm:flex-row">
            <a href={deepHref} className="btn-primary min-h-[48px] flex-1 justify-center px-5">Build the agent-ready version <ArrowRight className="size-4" /></a>
            <a
              href={scanAttributionToken
                ? appUrl(`/onboard?scan=${encodeURIComponent(scanAttributionToken)}`)
                : appUrl('/onboard')}
              className="btn-secondary min-h-[48px] justify-center px-5"
            >Fix this with Nexez</a>
          </div>
          <p className="mt-3 text-center text-xs leading-5 text-[var(--fg-muted)]">
            The free scan does not store page content. Nexez records the domain, score, timing, and service telemetry needed to operate and improve the scanner.
          </p>
        </section>
      ) : null}

      {!result && !loading ? (
        <section className="mt-12">
          <p className="text-center text-xs text-[var(--fg-muted)]">Try your homepage, an offer page, or a competitor site.</p>

          <p className="mt-12 text-center text-xs font-semibold uppercase tracking-[0.12em] text-[var(--fg-muted)]">
            What the scan checks
          </p>
          <div className="mt-5 grid gap-4 sm:grid-cols-2">
            {DIMENSION_EXPLAINERS.map(([title, copy]) => (
              <div key={title} className="rounded-[16px] border border-[var(--bd-10)] bg-[var(--ov-03)] p-5">
                <p className="text-sm font-semibold">{title}</p>
                <p className="mt-1.5 text-sm leading-6 text-[var(--fg-muted)]">{copy}</p>
              </div>
            ))}
          </div>

          <p className="mx-auto mt-8 max-w-2xl text-center text-sm leading-6 text-[var(--fg-muted)]">
            Most sites fail this test. We scanned 652 small-business websites for our 2026 agent-readiness study: 30.7% were
            completely invisible to AI agents, and only 4.1% published pricing an agent could read.{' '}
            <a href="/learn/agent-readiness-study-2026" className="underline underline-offset-4 hover:text-[var(--signal)]">
              Read the study
            </a>
          </p>
        </section>
      ) : null}
    </main>
  )
}
