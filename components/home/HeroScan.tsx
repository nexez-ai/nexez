'use client'

import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { ArrowRight, Check, Loader2, Minus, X } from 'lucide-react'
import { appUrl } from '../../lib/site'
import { scanUrlPrefill } from '../../lib/scan-funnel'

/**
 * Homepage hero scanner. Thin, marketing-weight wrapper over the same public
 * POST /api/scan endpoint that powers /scan: anonymous, no LLM spend, rate
 * limited 6/60s. The full report (evidence checks, rescan compare, share link,
 * AI buyer-agent read, email capture) stays on /scan; this surface exists to
 * turn "what would an agent even see?" into a number before we ask for a signup.
 */

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

const DIMENSION_ORDER: DimensionKey[] = ['discovery', 'understanding', 'transactability', 'trust']

// Shown before a scan runs, so the panel explains itself instead of sitting empty.
const IDLE_ROWS: Array<[string, string]> = [
  ['Discovery', 'Can AI assistants reach your pages at all?'],
  ['Understanding', 'Can they pull your real offers and prices?'],
  ['Ways to buy', 'Is there a booking or checkout path to follow?'],
  ['Trust', 'Do your details hold up when verified?'],
]

// /api/scan returns its own dimension labels, and one of them is
// "Transactability". Merchants do not use that word, so the panel shows its own
// plain label and ignores the wire label. Keyed, so a server rename cannot
// silently put jargon back on the homepage.
const DIMENSION_LABEL: Record<DimensionKey, string> = {
  discovery: 'Discovery',
  understanding: 'Understanding',
  transactability: 'Ways to buy',
  trust: 'Trust',
}

// A visitor who will not type their own domain still needs to see a real result.
// example.com is IANA-reserved for exactly this purpose, so the homepage never
// publishes an unconsenting real business's low score as marketing.
const EXAMPLE_URL = 'https://example.com'

// A scheme with nothing after it is not a scannable value, so it must not enable
// the button even if someone types it by hand.
function hostPart(value: string): string {
  return value.replace(/^https?:\/\//i, '').trim()
}

function scoreTone(score: number): { color: string; label: string } {
  if (score >= 85) return { color: 'var(--ready)', label: 'Agent-ready' }
  if (score >= 60) return { color: 'var(--amber)', label: 'Almost ready' }
  return { color: 'var(--signal)', label: 'Ready to set up' }
}

function CompactRing({ score }: { score: number }) {
  const { color, label } = scoreTone(score)
  const radius = 40
  const circumference = 2 * Math.PI * radius
  const dash = (Math.max(0, Math.min(100, score)) / 100) * circumference
  return (
    <div className="flex shrink-0 flex-col items-center gap-1.5">
      <div className="relative size-[108px]">
        <svg width={108} height={108} viewBox="0 0 108 108" aria-hidden="true">
          <circle cx={54} cy={54} r={radius} fill="none" stroke="var(--bd-10)" strokeWidth={9} />
          <circle
            cx={54}
            cy={54}
            r={radius}
            fill="none"
            stroke={color}
            strokeWidth={9}
            strokeLinecap="round"
            strokeDasharray={`${dash} ${circumference}`}
            transform="rotate(-90 54 54)"
            style={{ transition: 'stroke-dasharray 700ms cubic-bezier(.4,0,.2,1)' }}
          />
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className="font-mono text-[2rem] font-semibold leading-none" style={{ color }}>{score}</span>
          <span className="mt-0.5 text-[10px] text-[var(--fg-muted)]">/ 100</span>
        </div>
      </div>
      <span className="text-xs font-semibold" style={{ color }}>{label}</span>
    </div>
  )
}

function MiniMeter({ dimension, value }: { dimension: DimensionKey; value: Dimension }) {
  const label = DIMENSION_LABEL[dimension]
  return (
    <div>
      <div className="flex items-baseline justify-between gap-2">
        <span className="truncate text-[11px] font-medium text-[var(--fg-muted)]">{label}</span>
        <span className="font-mono text-xs font-semibold tabular-nums">{value.score}</span>
      </div>
      <div
        className="mt-1.5 h-1 overflow-hidden rounded-full bg-[var(--bd-10)]"
        role="progressbar"
        aria-label={`${label} score`}
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

function FixRow({ check }: { check: ScanCheck }) {
  const icon = check.status === 'pass'
    ? <Check className="size-3.5 text-[var(--ready)]" />
    : check.status === 'warn'
      ? <Minus className="size-3.5 text-[var(--amber)]" />
      : <X className="size-3.5 text-red-400" />
  return (
    <li className="flex items-start gap-2.5 border-t border-[var(--bd-10)] py-2.5 first:border-t-0 first:pt-0">
      <span className="mt-0.5 shrink-0">{icon}</span>
      <span className="min-w-0 flex-1">
        <span className="block text-[13px] font-medium leading-5">{check.label}</span>
        <span className="block text-[11px] leading-4 text-[var(--fg-muted)]">{check.detail}</span>
      </span>
    </li>
  )
}

export function HeroScan() {
  const [url, setUrl] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [retryAfter, setRetryAfter] = useState(0)
  const [result, setResult] = useState<ScanResult | null>(null)

  useEffect(() => {
    const prefill = scanUrlPrefill(window.location.search)
    if (prefill) setUrl((current) => current || prefill)
  }, [])

  const runScan = useCallback(async (rawValue: string) => {
    const value = rawValue.trim()
    if (!value) return
    setLoading(true)
    setError('')
    setRetryAfter(0)
    setResult(null)
    try {
      const response = await fetch('/api/scan', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        // `source` lets observability separate hero scans from /scan scans, so the
        // homepage change is measurable on its own.
        body: JSON.stringify({ url: value, source: 'hero' }),
      })
      const data = await response.json().catch(() => ({}))
      if (response.status === 429) {
        // The scanner is shared and rate limited. On the homepage this is a normal
        // busy signal, not the visitor's fault, so it never shows the raw API string.
        const wait = Number(data?.retryAfter) || Number(response.headers.get('Retry-After')) || 0
        setRetryAfter(wait)
        setError('The scanner is busy right now.')
        return
      }
      if (!response.ok) {
        setError(data?.error || 'Could not scan that URL. Try another.')
        return
      }
      setResult(data as ScanResult)
    } catch {
      setError('Network error. Please try again.')
    } finally {
      setLoading(false)
    }
  }, [])

  function onSubmit(event: FormEvent) {
    event.preventDefault()
    if (!loading && hostPart(url)) void runScan(url)
  }

  function runExample() {
    if (loading) return
    setUrl(EXAMPLE_URL)
    void runScan(EXAMPLE_URL)
  }

  // Worst-first, so the panel leads with what is actually costing the visitor sales.
  const topFixes = result
    ? [...result.checks]
        .filter((c) => c.status !== 'pass')
        .sort((a, b) => (a.status === 'fail' ? -1 : 1) - (b.status === 'fail' ? -1 : 1))
        .slice(0, 3)
    : []

  return (
    <div className="nx-hero-scan glass rounded-[16px] p-[1.1rem] sm:rounded-[20px] sm:p-6" data-testid="hero-scan">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-mono text-[11px] uppercase tracking-[0.14em] text-[var(--fg-muted)]">
          Agent readiness scan
        </span>
        <span className="chip text-[10px] uppercase tracking-[0.1em] text-[var(--ready)]">No account needed</span>
      </div>

      <form onSubmit={onSubmit} className="mt-4 flex flex-col gap-2.5 sm:flex-row">
        <label className="sr-only" htmlFor="hero-scan-url">Website URL to scan</label>
        <input
          id="hero-scan-url"
          type="text"
          inputMode="url"
          value={url}
          onChange={(event) => setUrl(event.target.value)}
          placeholder="https://yourwebsite.com"
          disabled={loading}
          className="min-h-[48px] flex-1 rounded-[14px] border border-[var(--bd-10)] bg-[var(--ov-03)] px-4 text-sm outline-none transition focus:border-[var(--signal)]"
        />
        <button
          type="submit"
          disabled={loading || !hostPart(url)}
          className="btn-primary min-h-[48px] w-full shrink-0 px-5 disabled:opacity-60 sm:w-auto"
        >
          {loading ? <Loader2 className="size-4 animate-spin" /> : null}
          {loading ? 'Scanning...' : 'Scan my site'}
          {!loading ? <ArrowRight className="size-4" /> : null}
        </button>
      </form>

      {error ? (
        <div role="alert" className="mt-3">
          <p className="text-sm text-[var(--amber)]">
            {error}
            {retryAfter ? ` Try again in ${retryAfter}s.` : ''}
          </p>
          <p className="mt-1.5 text-[12px] leading-5 text-[var(--fg-muted)]">
            {retryAfter
              ? 'Nothing is wrong with your site. The free scanner is shared, so it throttles during busy periods.'
              : 'Check the address, or '}
            {retryAfter ? null : (
              <button type="button" onClick={runExample} className="underline underline-offset-2 hover:text-[var(--fg)]">
                try the example
              </button>
            )}
            {retryAfter ? null : '.'}
          </p>
        </div>
      ) : null}

      {!result && !loading && !error ? (
        <div className="mt-5 border-t border-[var(--bd-10)] pt-4">
          <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-[var(--fg-muted)]">
            What gets checked
          </p>
          <ul className="mt-3 grid gap-2.5">
            {IDLE_ROWS.map(([label, detail]) => (
              <li key={label} className="flex items-baseline gap-2.5">
                <span className="shrink-0 text-[13px] font-medium">{label}</span>
                <span className="min-w-0 flex-1 text-[12px] leading-5 text-[var(--fg-muted)]">{detail}</span>
              </li>
            ))}
          </ul>
          <p className="mt-4 text-[11px] leading-4 text-[var(--fg-muted)]">
            Deterministic checks on your public pages. Takes a few seconds.{' '}
            <button
              type="button"
              onClick={runExample}
              className="underline underline-offset-2 hover:text-[var(--fg)]"
            >
              Or try an example
            </button>
            .
          </p>
        </div>
      ) : null}

      {loading ? (
        <p className="mt-5 border-t border-[var(--bd-10)] pt-4 text-sm text-[var(--fg-muted)]" aria-live="polite">
          Reading your page the way an agent would.
        </p>
      ) : null}

      {result ? (
        <div className="mt-5 border-t border-[var(--bd-10)] pt-5" aria-live="polite">
          <div className="flex flex-col items-center gap-5 sm:flex-row sm:items-center">
            <CompactRing score={result.score} />
            <div className="min-w-0 flex-1 text-center sm:text-left">
              <p className="truncate text-[15px] font-semibold">{result.origin}</p>
              <p className="mt-1 text-[12px] leading-5 text-[var(--fg-muted)]">
                {result.checks.filter((c) => c.status === 'pass').length} of {result.checks.length} evidence checks already pass across discovery, understanding, ways to buy, and trust.
              </p>
              {result.blockedBots.length ? (
                <div className="mt-2 flex flex-wrap justify-center gap-1.5 sm:justify-start">
                  {result.blockedBots.slice(0, 3).map((bot) => (
                    <span key={bot} className="chip text-[10px] text-[var(--amber)]">{bot} blocked</span>
                  ))}
                </div>
              ) : null}
            </div>
          </div>

          <div className="mt-5 grid grid-cols-2 gap-x-4 gap-y-3">
            {DIMENSION_ORDER.map((key) => (
              <MiniMeter key={key} dimension={key} value={result.dimensions[key]} />
            ))}
          </div>

          {topFixes.length ? (
            <div className="mt-5 border-t border-[var(--bd-10)] pt-4">
              <p className="mb-2.5 text-[11px] font-semibold uppercase tracking-[0.12em] text-[var(--fg-muted)]">
                Turn these on next
              </p>
              <ul>{topFixes.map((check) => <FixRow key={check.id} check={check} />)}</ul>
            </div>
          ) : null}

          <div className="mt-5 flex flex-col gap-2.5 sm:flex-row">
            <a
              href={appUrl(`/create?url=${encodeURIComponent(result.url)}`)}
              className="btn-primary min-h-[44px] flex-1 px-4"
            >
              List your offers
            </a>
            <a
              href={`/scan?url=${encodeURIComponent(result.url)}`}
              className="btn-secondary min-h-[44px] flex-1 px-4"
            >
              Full report
            </a>
          </div>
        </div>
      ) : null}
    </div>
  )
}
