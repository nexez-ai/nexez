'use client'

import { useState, type FormEvent } from 'react'
import {
  BadgeCheck,
  Check,
  Clipboard,
  Gift,
  Globe2,
  Loader2,
  RefreshCw,
  Send,
  ShieldCheck,
  X,
} from 'lucide-react'
import type {
  SellerGrowthInviteView,
  SellerGrowthState,
} from '../../lib/server/seller-growth'

type ActionResult = {
  ok?: boolean
  error?: string
  emailed?: boolean
  claimUrl?: string
  invite?: SellerGrowthInviteView
  expiresAt?: string
  deliveryCount?: number
  lastSentAt?: string | null
  status?: string
}

function inviteStatusLabel(invite: SellerGrowthInviteView, nowMs: number) {
  if (invite.status === 'qualified') return 'Launch active'
  if (invite.status === 'claimed') return 'Claimed, awaiting verification'
  if (invite.status === 'pending' && Date.parse(invite.expiresAt) > nowMs) return 'Invitation sent'
  if (invite.status === 'revoked') return 'Revoked'
  return 'Expired'
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat('en', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(value))
}

export function SellerGrowthInvites({ initialState }: { initialState: SellerGrowthState }) {
  const [state, setState] = useState(initialState)
  const [email, setEmail] = useState('')
  const [loading, setLoading] = useState('')
  const [feedback, setFeedback] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null)
  const [lastClaimUrl, setLastClaimUrl] = useState<string | null>(null)
  const nowMs = Date.parse(state.asOf)

  const daysLeft = state.grant
    ? Math.max(0, Math.ceil((Date.parse(state.grant.endsAt) - nowMs) / 86_400_000))
    : 0
  const campaignAcceptingInvites =
    state.campaign?.status === 'active'
    && (
      !state.campaign.signupClosesAt
      || Date.parse(state.campaign.signupClosesAt) > nowMs
    )

  if (!state.available || !state.campaign) return null

  async function refreshState() {
    const response = await fetch('/api/growth-invites', { cache: 'no-store' })
    const body = (await response.json().catch(() => ({}))) as { state?: SellerGrowthState }
    if (response.ok && body.state) setState(body.state)
  }

  async function createInvite(event: FormEvent) {
    event.preventDefault()
    if (!email.trim() || loading) return
    setLoading('create')
    setFeedback(null)
    setLastClaimUrl(null)
    try {
      const response = await fetch('/api/growth-invites', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email }),
      })
      const body = (await response.json().catch(() => ({}))) as ActionResult
      if (!response.ok || !body.invite) {
        setFeedback({ tone: 'error', text: body.error || 'Could not create this Launch pass.' })
        return
      }
      setEmail('')
      setLastClaimUrl(body.claimUrl || null)
      setFeedback({
        tone: 'ok',
        text: body.emailed
          ? `Invitation sent to ${body.invite.email}.`
          : `Pass created for ${body.invite.email}. Email delivery is unavailable, so copy the secure link below.`,
      })
      await refreshState()
    } catch {
      setFeedback({ tone: 'error', text: 'The invitation could not be created. Check your connection and try again.' })
    } finally {
      setLoading('')
    }
  }

  async function updateInvite(invite: SellerGrowthInviteView, action: 'resend' | 'revoke') {
    if (loading) return
    setLoading(`${action}:${invite.id}`)
    setFeedback(null)
    setLastClaimUrl(null)
    try {
      const response = await fetch(`/api/growth-invites/${invite.id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action }),
      })
      const body = (await response.json().catch(() => ({}))) as ActionResult
      if (!response.ok) {
        setFeedback({ tone: 'error', text: body.error || `Could not ${action} this pass.` })
        return
      }
      setLastClaimUrl(body.claimUrl || null)
      setFeedback({
        tone: 'ok',
        text: action === 'revoke'
          ? `Pass for ${invite.email} revoked.`
          : body.emailed
            ? `A fresh invitation was sent to ${invite.email}.`
            : `The secure link was renewed for ${invite.email}. Copy it below.`,
      })
      await refreshState()
    } catch {
      setFeedback({ tone: 'error', text: `The pass could not be ${action === 'resend' ? 'renewed' : 'revoked'}. Try again.` })
    } finally {
      setLoading('')
    }
  }

  async function copyClaimUrl() {
    if (!lastClaimUrl) return
    try {
      await navigator.clipboard.writeText(lastClaimUrl)
      setFeedback({ tone: 'ok', text: 'Secure invitation link copied.' })
    } catch {
      setFeedback({ tone: 'error', text: 'Could not access your clipboard. Open the invitation email instead.' })
    }
  }

  const qualificationItems = [
    {
      label: 'Campaign access',
      complete: state.qualification.campaignAccess,
      detail: state.qualification.campaignAccess
        ? state.qualification.accessSource === 'new_business'
          ? 'Your account was created during open enrollment.'
          : 'Your founding-cohort invitation is claimed.'
        : 'This account needs a founding-cohort invitation.',
    },
    {
      label: 'Verified email',
      complete: state.qualification.emailVerified,
      detail: 'Confirms the account owner.',
    },
    {
      label: 'Published listing',
      complete: state.qualification.publishedListing,
      detail: 'Creates a live business presence.',
    },
    {
      label: 'Verified business',
      complete: state.qualification.identityVerified,
      detail: 'Use your website, custom domain, Shopify, or Stripe.',
    },
  ]
  const verificationPage = state.pages.find((page) => page.websiteUrl && !page.websiteVerified)
    ?? state.pages[0]
    ?? null
  const pendingVerification = !state.grant
    && state.qualification.publishedListing
    && !state.qualification.identityVerified

  return (
    <section className="mt-6 overflow-hidden rounded-lg border border-border bg-[var(--ov-03)]">
      <div className="grid lg:grid-cols-[minmax(0,1.05fr)_minmax(320px,.95fr)]">
        <div className="p-5 md:p-6">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <div className="flex items-center gap-2 text-sm text-[var(--signal)]">
                <Gift className="size-4" />
                180 days of Launch
              </div>
              <h2 className="mt-2 text-xl font-semibold tracking-tight text-white">
                {state.grant
                  ? 'Complimentary Launch is active'
                  : pendingVerification
                    ? 'Published, Launch pending verification'
                    : state.qualification.campaignAccess
                      ? 'Unlock 180 days of Launch'
                      : 'Launch access needs an invitation'}
              </h2>
              <p className="mt-2 max-w-xl text-sm leading-6 text-muted-foreground">
                {state.grant
                  ? `Your verified business has Launch access for ${daysLeft.toLocaleString()} more day${daysLeft === 1 ? '' : 's'}. No card is required.`
                  : `${state.qualification.completedGates} of ${state.qualification.totalGates} requirements complete. Launch activates automatically only when every requirement below is confirmed.`}
              </p>
            </div>
            {state.grant && (
              <div className="rounded-md border border-[var(--ready)]/35 bg-[var(--ready)]/10 px-3 py-2 text-right">
                <p className="text-xs text-[var(--ready)]">Active through</p>
                <p className="mt-0.5 text-sm font-medium text-white">
                  {formatDate(state.grant.endsAt)}
                </p>
              </div>
            )}
          </div>

          <div className="mt-5 grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
            {qualificationItems.map((item) => (
              <div
                key={item.label}
                className={`rounded-md border p-3 ${
                  item.complete
                    ? 'border-[var(--ready)]/25 bg-[var(--ready)]/[0.06]'
                    : 'border-border bg-black/15'
                }`}
              >
                <div className="flex items-center gap-2 text-sm font-medium text-white">
                  <span className={`flex size-5 items-center justify-center rounded-full ${
                    item.complete ? 'bg-[var(--ready)] text-black' : 'border border-border text-muted-foreground'
                  }`}>
                    {item.complete ? <Check className="size-3" strokeWidth={3} /> : null}
                  </span>
                  {item.label}
                </div>
                <p className="mt-2 text-xs leading-5 text-muted-foreground">{item.detail}</p>
              </div>
            ))}
          </div>

          {!state.grant && (
            <div className="mt-4 flex flex-wrap gap-2">
              {!state.qualification.campaignAccess && (
                <a href="/support?topic=launch-access" className="btn-secondary h-9 px-3 text-xs">
                  Request cohort access
                </a>
              )}
              {!state.qualification.publishedListing && (
                <a href={state.pages.length ? '/dashboard/listings' : '/create'} className="btn-primary h-9 px-3 text-xs">
                  Publish a listing
                </a>
              )}
              {!state.qualification.identityVerified && (
                <a
                  href={verificationPage
                    ? `/dashboard/${verificationPage.id}/settings#agent-experience`
                    : '/create'}
                  className="btn-secondary h-9 px-3 text-xs"
                >
                  <ShieldCheck className="size-3.5" /> Verify business
                </a>
              )}
            </div>
          )}

          {pendingVerification ? (
            <p className="mt-4 rounded-md border border-[var(--amber)]/30 bg-[var(--amber)]/10 p-3 text-xs leading-5 text-[var(--amber)]">
              Your listing is live, but publication alone does not start complimentary Launch. Verify your website, custom domain, Shopify connection, or Stripe account to complete business identity.
            </p>
          ) : null}

          {state.grant && (
            <p className="mt-4 text-xs leading-5 text-muted-foreground">
              When the promotion ends, your account returns to Free without an automatic charge. Drafts and extra listings remain saved.
            </p>
          )}
        </div>

        <div className="border-t border-border bg-black/15 p-5 md:p-6 lg:border-l lg:border-t-0">
          <div className="flex items-start justify-between gap-4">
            <div>
              <div className="flex items-center gap-2 text-sm font-medium text-white">
                <Globe2 className="size-4 text-[var(--signal)]" />
                Invite two businesses
              </div>
              <p className="mt-2 text-xs leading-5 text-muted-foreground">
                Each pass is email-bound and creates a separate business account.
              </p>
            </div>
            <span className="rounded-full border border-border px-2.5 py-1 text-xs text-muted-foreground">
              {state.slotsAvailable} of {state.campaign.inviteSlots} left
            </span>
          </div>

          {state.grant && campaignAcceptingInvites && state.slotsAvailable > 0 && (
            <form onSubmit={createInvite} className="mt-4 flex gap-2">
              <label className="sr-only" htmlFor="seller-growth-email">Business email</label>
              <input
                id="seller-growth-email"
                type="email"
                autoComplete="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                placeholder="owner@business.com"
                className="min-w-0 flex-1 rounded-md border border-border bg-black/25 px-3 text-sm text-white outline-none transition placeholder:text-muted-foreground focus:border-[var(--signal)]"
              />
              <button
                type="submit"
                disabled={loading === 'create'}
                className="btn-primary h-10 shrink-0 px-3 text-sm disabled:opacity-60"
                title="Send Launch pass"
              >
                {loading === 'create' ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
                <span className="hidden sm:inline">Send</span>
              </button>
            </form>
          )}

          {state.grant && !campaignAcceptingInvites && (
            <div className="mt-4 rounded-md border border-border bg-black/20 p-3 text-xs leading-5 text-muted-foreground">
              This invitation window has closed. Your existing Launch access continues through its end date.
            </div>
          )}

          {!state.grant && (
            <div className="mt-4 rounded-md border border-border bg-black/20 p-3 text-xs leading-5 text-muted-foreground">
              Your two passes unlock when your complimentary Launch access activates.
            </div>
          )}

          {state.invites.length > 0 && (
            <div className="mt-4 space-y-2">
              {state.invites.map((invite) => {
                const pendingStatus = invite.status === 'pending'
                const canRenew = pendingStatus || invite.status === 'expired'
                return (
                  <div key={invite.id} className="rounded-md border border-border bg-black/20 p-3">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium text-white">{invite.email}</p>
                        <p className="mt-1 text-xs text-muted-foreground">{inviteStatusLabel(invite, nowMs)}</p>
                      </div>
                      {invite.status === 'qualified' && <BadgeCheck className="size-4 shrink-0 text-[var(--ready)]" />}
                    </div>
                    {canRenew && (
                      <div className="mt-3 flex gap-2">
                        <button
                          type="button"
                          onClick={() => updateInvite(invite, 'resend')}
                          disabled={Boolean(loading)}
                          className="btn-secondary h-8 px-2.5 text-xs disabled:opacity-60"
                        >
                          {loading === `resend:${invite.id}`
                            ? <Loader2 className="size-3.5 animate-spin" />
                            : <RefreshCw className="size-3.5" />}
                          Renew
                        </button>
                        {pendingStatus && (
                          <button
                            type="button"
                            onClick={() => updateInvite(invite, 'revoke')}
                            disabled={Boolean(loading)}
                            className="btn-secondary h-8 px-2.5 text-xs disabled:opacity-60"
                          >
                            {loading === `revoke:${invite.id}`
                              ? <Loader2 className="size-3.5 animate-spin" />
                              : <X className="size-3.5" />}
                            Revoke
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          )}

          {lastClaimUrl && (
            <button
              type="button"
              onClick={copyClaimUrl}
              className="btn-secondary mt-3 h-9 w-full px-3 text-xs"
            >
              <Clipboard className="size-3.5" /> Copy secure invitation link
            </button>
          )}
          {feedback && (
            <p
              role="status"
              className={`mt-3 rounded-md border p-3 text-xs leading-5 ${
                feedback.tone === 'ok'
                  ? 'border-[var(--ready)]/30 bg-[var(--ready)]/10 text-[var(--ready)]'
                  : 'border-red-400/30 bg-red-400/10 text-red-200'
              }`}
            >
              {feedback.text}
            </p>
          )}
        </div>
      </div>
    </section>
  )
}
