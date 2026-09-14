'use client'

import { useState } from 'react'
import { ArrowRight, BadgeCheck, Loader2, LogOut, Mail, ShieldCheck } from 'lucide-react'
import { createClient } from '../../../utils/supabase/client'
import { GROWTH_EXPIRY_TERMS, GROWTH_NO_CARD_TERMS, GROWTH_QUALIFICATION_TERMS } from '../../../lib/growth-offer-copy'

export type ClaimInviteMode =
  | 'invalid'
  | 'expired'
  | 'unavailable'
  | 'signed_out'
  | 'wrong_email'
  | 'ready'
  | 'already_claimed'

type ClaimInviteCardProps = {
  mode: ClaimInviteMode
  inviterBusinessName?: string
  inviteeEmail?: string
  signedInEmail?: string
  expiresAt?: string
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat('en', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(value))
}

export function ClaimInviteCard({
  mode: initialMode,
  inviterBusinessName = 'A Nexez business',
  inviteeEmail = '',
  signedInEmail = '',
  expiresAt,
}: ClaimInviteCardProps) {
  const [mode, setMode] = useState(initialMode)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  async function claim() {
    if (loading) return
    setLoading(true)
    setError('')
    try {
      const response = await fetch('/api/growth-invites/claim', { method: 'POST' })
      const body = (await response.json().catch(() => ({}))) as {
        error?: string
        activated?: boolean
      }
      if (!response.ok) {
        setError(body.error || 'Could not claim this Launch pass.')
        return
      }
      if (body.activated) {
        window.location.href = '/dashboard?launch_pass=activated'
        return
      }
      setMode('already_claimed')
    } catch {
      setError('The pass could not be claimed. Check your connection and try again.')
    } finally {
      setLoading(false)
    }
  }

  async function signOut() {
    setLoading(true)
    await createClient().auth.signOut().catch(() => null)
    window.location.reload()
  }

  const invalid = mode === 'invalid' || mode === 'expired' || mode === 'unavailable'
  const title = mode === 'expired'
    ? 'This Launch pass has expired'
    : invalid
      ? 'This Launch pass is unavailable'
      : mode === 'already_claimed'
        ? 'Your pass is claimed'
        : '180 days of complimentary Launch'
  const detail = mode === 'expired'
    ? 'Ask the sender to renew the invitation from their Nexez dashboard.'
    : invalid
      ? 'The link may be invalid, revoked, or already used.'
      : mode === 'already_claimed'
        ? 'Finish publishing and verifying your business to activate any remaining qualification step.'
        : `${inviterBusinessName} invited your business to use Nexez Launch for 180 days at no subscription cost.`

  return (
    <section className="w-full max-w-xl rounded-lg border border-border bg-[var(--ov-04)] p-6 shadow-2xl shadow-black/25 md:p-8">
      <div className="flex size-11 items-center justify-center rounded-md border border-[var(--signal)]/35 bg-[var(--signal)]/10 text-[var(--signal)]">
        {invalid ? <Mail className="size-5" /> : <BadgeCheck className="size-5" />}
      </div>
      <h1 className="mt-6 text-3xl font-semibold tracking-tight text-white">{title}</h1>
      <p className="mt-3 text-sm leading-6 text-muted-foreground">{detail}</p>

      {!invalid && mode !== 'already_claimed' && (
        <div className="mt-6 space-y-3 rounded-md border border-border bg-black/20 p-4 text-sm">
          <div className="flex items-start gap-3">
            <ShieldCheck className="mt-0.5 size-4 shrink-0 text-[var(--ready)]" />
            <p className="text-muted-foreground">
              This creates a separate business account. It does not share either business&apos;s workspace or customer data.
            </p>
          </div>
          <div className="flex items-start gap-3">
            <Mail className="mt-0.5 size-4 shrink-0 text-[var(--signal)]" />
            <p className="text-muted-foreground">
              Email-bound to <span className="font-medium text-white">{inviteeEmail}</span>
              {expiresAt ? ` until ${formatDate(expiresAt)}.` : '.'}
            </p>
          </div>
        </div>
      )}

      {mode === 'signed_out' && (
        <div className="mt-6 grid gap-3 sm:grid-cols-2">
          <a
            href="/login?mode=signup&next=/invite/claim"
            className="btn-primary h-11 px-4 text-sm"
          >
            Create account <ArrowRight className="size-4" />
          </a>
          <a
            href="/login?next=/invite/claim"
            className="btn-secondary h-11 px-4 text-sm"
          >
            Sign in
          </a>
        </div>
      )}

      {mode === 'wrong_email' && (
        <div className="mt-6">
          <div className="rounded-md border border-[var(--amber)]/35 bg-[var(--amber)]/10 p-4 text-sm text-[var(--amber)]">
            You are signed in as {signedInEmail}. Sign in with {inviteeEmail} to claim this pass.
          </div>
          <button
            type="button"
            onClick={signOut}
            disabled={loading}
            className="btn-secondary mt-3 h-11 w-full px-4 text-sm disabled:opacity-60"
          >
            {loading ? <Loader2 className="size-4 animate-spin" /> : <LogOut className="size-4" />}
            Sign out and continue
          </button>
        </div>
      )}

      {mode === 'ready' && (
        <button
          type="button"
          onClick={claim}
          disabled={loading}
          className="btn-primary mt-6 h-11 w-full px-4 text-sm disabled:opacity-60"
        >
          {loading ? <Loader2 className="size-4 animate-spin" /> : <BadgeCheck className="size-4" />}
          Claim Launch pass
        </button>
      )}

      {mode === 'already_claimed' && (
        <a href="/dashboard" className="btn-primary mt-6 h-11 w-full px-4 text-sm">
          Continue to dashboard <ArrowRight className="size-4" />
        </a>
      )}

      {error && (
        <p role="alert" className="mt-4 rounded-md border border-red-400/30 bg-red-400/10 p-3 text-sm text-red-200">
          {error}
        </p>
      )}

      <p className="mt-6 text-xs leading-5 text-muted-foreground">
        {GROWTH_NO_CARD_TERMS} {GROWTH_QUALIFICATION_TERMS} {GROWTH_EXPIRY_TERMS}
      </p>
    </section>
  )
}
