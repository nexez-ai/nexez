'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { WEBSITE_APPROVAL_VERSION, websiteBaselineViewSchema, type WebsiteBaselineView } from '@/lib/merchant-website-baselines'
import { SCAN_CHECK_COPY, SCAN_FAILURE_COPY } from '@/lib/organization-scans'

const buttonClass = 'rounded-lg border border-[var(--border)] px-3 py-2 text-sm font-medium disabled:opacity-50'

/** Mounted only for listing owners. The API independently enforces ownership.
 * A disabled, empty pilot adds no controls to the ordinary settings experience.
 */
export function WebsiteBaselinePanel({ listingId }: { listingId: string }) {
  const [view, setView] = useState<WebsiteBaselineView | null>(null)
  const [approvedOrigin, setApprovedOrigin] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const pending = useRef<{ signature: string; key: string } | null>(null)
  const alive = useRef(true)
  const approved = Boolean(view?.suggestedOrigin && approvedOrigin === view.suggestedOrigin)

  const accept = useCallback((data: unknown) => {
    const parsed = websiteBaselineViewSchema.safeParse(data)
    if (!parsed.success || parsed.data.listingId !== listingId) throw new Error('Website baseline could not be loaded.')
    if (alive.current) setView(parsed.data)
    return parsed.data
  }, [listingId])

  const refresh = useCallback(async (signal?: AbortSignal) => {
    const response = await fetch(`/api/merchant/website-baseline?listingId=${listingId}`, { cache: 'no-store', signal })
    if (!response.ok) throw new Error('Website baseline could not be loaded. Refresh to try again.')
    accept(await response.json())
  }, [accept, listingId])

  useEffect(() => {
    alive.current = true
    const controller = new AbortController()
    void refresh(controller.signal).catch(() => { /* Inactive or unavailable pilot stays hidden. */ })
    return () => { alive.current = false; controller.abort() }
  }, [refresh])

  async function command(action: 'approve' | 'revoke' | 'collect') {
    if (!view || busy) return
    const payload = action === 'approve'
      ? { action, listingId, origin: view.suggestedOrigin, attested: approved, approvalVersion: WEBSITE_APPROVAL_VERSION }
      : { action, listingId, associationId: view.association?.id }
    const signature = JSON.stringify(payload)
    if (action !== 'revoke' && pending.current?.signature !== signature) pending.current = { signature, key: crypto.randomUUID() }
    setBusy(true)
    setMessage('')
    try {
      const response = await fetch('/api/merchant/website-baseline', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: AbortSignal.timeout(65_000),
        body: JSON.stringify({ ...payload, ...(action === 'revoke' ? {} : { idempotencyKey: pending.current!.key }) }),
      })
      const data: unknown = await response.json()
      if (!response.ok) {
        if (response.status < 500) pending.current = null
        // Server copy is bounded. Fetched website content never enters this API.
        const error = data && typeof data === 'object' && 'error' in data ? data.error : null
        throw new Error(typeof error === 'string' && error.length < 300 ? error : 'Website baseline request failed.')
      }
      const current = accept(data)
      pending.current = null
      if (alive.current) {
        setApprovedOrigin(null)
        setMessage(action === 'revoke' ? 'Website approval revoked.' : action === 'approve' ? 'Website approved. You can now collect a baseline.'
          : current.attempt?.state === 'queued' || current.attempt?.state === 'running' ? 'Collection is still in progress. Refresh shortly.'
          : current.attempt?.state === 'expired' || current.attempt?.state === 'cancelled' ? 'Collection did not finish. Refresh before requesting again.'
          : 'Collection finished. Review the observation below.')
      }
    } catch (error) {
      if (alive.current) setMessage(error instanceof Error && error.name !== 'TimeoutError' ? error.message : 'The request timed out. Refresh to check its status before trying again.')
    } finally { if (alive.current) setBusy(false) }
  }

  if (!view || (!view.collectionEnabled && !view.association)) return null
  const inProgress = view.attempt?.state === 'queued' || view.attempt?.state === 'running'
  return (
    <section aria-labelledby={`website-baseline-${listingId}`} className="space-y-4 rounded-lg border border-[var(--border)] p-5">
      <div>
        <h3 id={`website-baseline-${listingId}`} className="font-semibold">Website baseline</h3>
        <p className="mt-1 text-sm text-[var(--fg-muted)]">Save an observation of your public website. Listing readiness is measured separately.</p>
      </div>
      {!view.association ? (
        view.suggestedOrigin ? <div className="space-y-3">
          <p className="break-all text-sm">Website: <strong>{view.suggestedOrigin}</strong></p>
          <label className="flex items-start gap-2 text-sm">
            <input type="checkbox" checked={approved} onChange={event => setApprovedOrigin(event.target.checked ? view.suggestedOrigin : null)} disabled={busy} className="mt-1" />
            <span>I confirm this website represents this listing and approve Nexez fetching its public pages on my request. Approval lasts up to 30 days or until pilot access expires. Observations are retained for 30 days. This approval does not verify domain ownership.</span>
          </label>
          <button className={buttonClass} disabled={!approved || busy || !view.collectionEnabled} onClick={() => void command('approve')}>Approve website</button>
          <p className="text-xs text-[var(--fg-muted)]">Use the final website address in your listing settings. Redirects to a different origin require approval of that address.</p>
        </div> : <p className="text-sm">Save a public website URL in General before approving a baseline.</p>
      ) : <div className="space-y-3">
        <p className="break-all text-sm"><strong>{view.association.origin}</strong><br />Merchant approved, valid until {new Date(view.association.expiresAt).toLocaleString(undefined, { timeZoneName: 'short' })}.</p>
        <div className="flex flex-wrap gap-2">
          <button className={buttonClass} disabled={busy || inProgress || !view.collectionEnabled} onClick={() => void command('collect')}>
            {busy ? 'Working…' : view.latest ? 'Check website again' : 'Collect baseline'}
          </button>
          <button className={buttonClass} disabled={busy} onClick={() => void command('revoke')}>Revoke website approval</button>
        </div>
        <p className="text-xs text-[var(--fg-muted)]">Up to three collections per UTC day across your listings. Revoking approval stops new results and hides this association’s observations.</p>
      </div>}
      {inProgress ? <p role="status" className="text-sm">Collection is in progress. Refresh shortly to check the result.</p> : null}
      {view.attempt?.state === 'expired' || view.attempt?.state === 'cancelled' ? <p className="text-sm">The latest collection did not complete. It produced no new observation.</p> : null}
      {view.latest ? <div className="space-y-2 border-t border-[var(--border)] pt-4">
        <h4 className="text-sm font-semibold">Latest observation</h4>
        <p className="text-xs text-[var(--fg-muted)]">{new Date(view.latest.evaluatedAt).toLocaleString(undefined, { timeZoneName: 'short' })} · Website rubric 2 · A single observation does not establish a trend.</p>
        {view.latest.result ? <>
          <p className="text-lg font-semibold">Website agent readiness: {view.latest.result.score}%</p>
          <ul className="grid gap-1 text-sm sm:grid-cols-2">
            {view.latest.result.checks.map(check => <li key={check.id}>{SCAN_CHECK_COPY[check.id].label}: {check.status}</li>)}
          </ul>
        </> : <p className="text-sm">Observation unavailable. {SCAN_FAILURE_COPY[view.latest.failure ?? 'network_error'] ?? 'Please try again later.'} A failed collection is not a score of zero.</p>}
      </div> : null}
      <button className={buttonClass} disabled={busy} onClick={() => { void refresh().catch(error => setMessage(error.message)) }}>Refresh status</button>
      {message ? <p role="status" className="text-sm">{message}</p> : null}
    </section>
  )
}
