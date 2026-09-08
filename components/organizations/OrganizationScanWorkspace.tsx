'use client'

import Link from 'next/link'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { parseOrganizationScanInput, SCAN_CHECK_COPY, SCAN_FAILURE_COPY, SCAN_INPUT_LIMIT, scanReceiptSchema, scanWorkspaceSchema, type ScanWorkspace } from '@/lib/organization-scans'

const button = 'rounded-full border border-[var(--bd-10)] px-4 py-2 text-sm font-medium disabled:cursor-not-allowed disabled:opacity-50'
const panel = 'rounded-[var(--r-card)] border border-[var(--bd-10)] bg-[var(--ov-03)] p-5 sm:p-6'

export function OrganizationScanWorkspace({ orgId, orgSlug, batchId, batchLimit, dailyLimit }: {
  orgId: string; orgSlug: string; batchId?: string; batchLimit: number; dailyLimit: number
}) {
  const router = useRouter()
  const base = `/api/organizations/${orgId}/scan-batches`
  const api = batchId ? `${base}/${batchId}` : base
  const [workspace, setWorkspace] = useState<ScanWorkspace | null>(null)
  const [error, setError] = useState('')
  const [loadError, setLoadError] = useState('')
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [input, setInput] = useState('')
  const [attested, setAttested] = useState(false)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const requestId = useRef(0)
  const mounted = useRef(false)
  const mutating = useRef(false)
  const key = useRef<string | null>(null)
  const parsed = useMemo(() => parseOrganizationScanInput(input), [input])

  const load = useCallback(async () => {
    if (mutating.current) return
    const id = ++requestId.current
    try {
      const response = await fetch(api, { cache: 'no-store', signal: AbortSignal.timeout(8000) })
      const body: unknown = await response.json()
      if (!response.ok) {
        if (mounted.current && id === requestId.current && [401, 403, 404].includes(response.status)) { setInput(''); setAttested(false); key.current = null }
        throw new Error(response.status === 401 ? 'Sign in again to view this workspace.' : response.status === 404 ? 'This workspace or batch is no longer available.' : 'Scans are temporarily unavailable. Please try again.')
      }
      const data = scanWorkspaceSchema.safeParse(body)
      if (!data.success) throw new Error('Scans are temporarily unavailable. Please try again.')
      if (mounted.current && id === requestId.current) { setWorkspace(data.data); setLoadError('') }
    } catch (cause) {
      if (mounted.current && id === requestId.current) {
        setWorkspace(null)
        setLoadError(cause instanceof Error ? cause.message.slice(0, 200) : 'Scans are temporarily unavailable.')
      }
    } finally { if (mounted.current && id === requestId.current) setLoading(false) }
  }, [api])

  useEffect(() => {
    mounted.current = true
    void load()
    const refresh = () => { if (!document.hidden) void load() }
    const timer = setInterval(refresh, 5000)
    document.addEventListener('visibilitychange', refresh)
    return () => {
      mounted.current = false
      requestId.current += 1
      clearInterval(timer)
      document.removeEventListener('visibilitychange', refresh)
    }
  }, [load])

  function changeInput(value: string) { setInput(value); key.current = null }
  async function mutate(method: 'POST' | 'PATCH' | 'DELETE', body: unknown) {
    if (mutating.current) return
    mutating.current = true
    requestId.current += 1
    setBusy(true); setError('')
    try {
      const response = await fetch(method === 'POST' ? base : api, {
        method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(25000),
      })
      const data: unknown = await response.json()
      if (!response.ok) {
        const message = data && typeof data === 'object' && 'error' in data && typeof data.error === 'string' ? data.error.slice(0, 200) : 'The request could not be completed.'
        if (response.status === 401 || response.status === 403 || response.status === 404) { setWorkspace(null); changeInput(''); setAttested(false) }
        throw new Error(message)
      }
      if (!mounted.current) return
      if (method === 'POST') {
        const receipt = scanReceiptSchema.parse(data)
        router.push(`/console/${orgSlug}/scans/${receipt.batch_id}`)
      } else if (method === 'DELETE') {
        setWorkspace(null)
        router.replace(`/console/${orgSlug}/scans`)
      }
      setDeleteOpen(false)
    } catch (cause) {
      if (mounted.current) setError(cause instanceof Error ? cause.message : 'The request could not be completed. Retry uses the same daily reservation.')
    } finally {
      mutating.current = false
      if (mounted.current) { setBusy(false); if (method !== 'DELETE') void load() }
    }
  }

  const batch = batchId ? workspace?.batches[0] : null
  const remaining = Math.max(0, dailyLimit - (workspace?.used_today ?? 0))
  const canSubmit = Boolean(workspace?.can_submit) && parsed.issues.length === 0 && parsed.targets.length <= batchLimit && parsed.targets.length <= remaining && attested && !busy

  return (
    <section className="mt-8 space-y-6" aria-label="Workspace scans">
      {(error || loadError) && <div role="alert" className={panel}><p>{error || loadError}</p><button type="button" className={`${button} mt-3`} onClick={() => { setError(''); void load() }} disabled={busy}>Refresh</button></div>}
      {loading && <p role="status" className="text-sm text-[var(--fg-muted)]">Loading scans...</p>}
      {!batchId && workspace && <>
        <div className={panel}>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <h2 className="text-lg font-semibold">Scan public websites</h2>
            <p className="text-sm text-[var(--fg-muted)]">{remaining} of {dailyLimit} targets left today (UTC)</p>
          </div>
          {workspace.can_submit ? <form className="mt-5 space-y-4" onSubmit={(event) => {
            event.preventDefault()
            if (!canSubmit) return
            key.current ??= crypto.randomUUID()
            void mutate('POST', { input, attested, idempotencyKey: key.current })
          }}>
            <label className="block text-sm font-medium" htmlFor="scan-origins">Website origins, one per line</label>
            <textarea id="scan-origins" className="min-h-36 w-full rounded-xl border border-[var(--bd-10)] bg-[var(--bg)] p-3 text-sm" rows={6}
              placeholder="https://example.com" value={input} onChange={(event) => changeInput(event.target.value)} disabled={busy} maxLength={SCAN_INPUT_LIMIT} spellCheck={false} autoCapitalize="none" />
            <div className="flex flex-wrap items-center gap-3">
              <label className="text-sm">Or load a one-column CSV <input aria-label="Load website CSV" type="file" accept=".csv,text/csv,text/plain" className="ml-2 max-w-full text-xs" disabled={busy} onChange={async (event) => {
                const file = event.target.files?.[0]
                if (!file) return
                if (file.size > SCAN_INPUT_LIMIT) { setError('Use a file smaller than 32 KB.'); return }
                const text = await file.text()
                if (mounted.current) changeInput(text)
              }} /></label>
            </div>
            <p className="text-xs leading-5 text-[var(--fg-muted)]">Up to {batchLimit} public HTTP or HTTPS origins. Omit paths, credentials, queries and custom ports. Files are parsed in your browser and are not uploaded.</p>
            {input && <div aria-live="polite" className="text-sm">
              <p>{parsed.targets.length} unique websites{parsed.duplicateCount ? `, ${parsed.duplicateCount} duplicate rows removed` : ''}.</p>
              {parsed.issues.length > 0 && <ul className="mt-2 list-inside list-disc">{parsed.issues.slice(0, 6).map((issue) => <li key={`${issue.line}:${issue.message}`}>{issue.line ? `Row ${issue.line}: ` : ''}{issue.message}</li>)}</ul>}
              {parsed.targets.length > batchLimit && <p>This exceeds your workspace’s {batchLimit}-target batch limit.</p>}
              {parsed.targets.length > remaining && <p>This exceeds your remaining daily allowance.</p>}
            </div>}
            <label className="flex items-start gap-3 text-sm leading-6"><input type="checkbox" checked={attested} onChange={(event) => setAttested(event.target.checked)} disabled={busy} className="mt-1.5" />I have a legitimate business purpose for these public website checks and will respect the sites’ crawl rules.</label>
            <p className="text-xs leading-5 text-[var(--fg-muted)]">Accepted targets use the daily allowance even if cancelled or unsuccessful. Retries do not charge it again. Results expire after 90 days; you can delete them sooner. Scanning does not establish site ownership or merchant consent.</p>
            <button type="submit" className={`${button} bg-[var(--fg)] text-[var(--bg)]`} disabled={!canSubmit}>{busy ? 'Submitting...' : `Scan ${parsed.targets.length || ''} websites`}</button>
          </form> : <p className="mt-3 text-sm text-[var(--fg-muted)]">Scanning is not available in this workspace yet. Your pilot contact will let you know when you can submit websites.</p>}
        </div>
        <div className={panel}>
          <h2 className="text-lg font-semibold">Recent batches</h2>
          {!workspace.batches.length ? <p className="mt-3 text-sm text-[var(--fg-muted)]">Your first batch will appear here.</p> : <ul className="mt-3 divide-y divide-[var(--bd-10)]">{workspace.batches.map((item) => <li key={item.id} className="py-4">
            <Link prefetch={false} href={`/console/${orgSlug}/scans/${item.id}`} className="font-medium underline underline-offset-4">{item.total} websites · {new Date(item.created_at).toLocaleString()}</Link>
            <p className="mt-1 text-sm text-[var(--fg-muted)]">{item.succeeded} results · {item.failed} failed · {item.cancelled_targets} cancelled · {item.queued + item.running} pending</p>
          </li>)}</ul>}
          {workspace.batches.length === 20 && <p className="mt-3 text-xs text-[var(--fg-muted)]">Showing the 20 most recent batches.</p>}
        </div>
      </>}
      {batch && <>
        <div className={panel}>
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div><h2 className="text-lg font-semibold">{batch.total} websites</h2><p className="mt-1 text-sm text-[var(--fg-muted)]">Submitted {new Date(batch.created_at).toLocaleString()}</p></div>
            <div className="flex flex-wrap gap-2">
              {(batch.queued + batch.running > 0) && <button className={button} type="button" disabled={busy} onClick={() => void mutate('PATCH', { action: 'cancel' })}>Cancel pending scans</button>}
              <button className={button} type="button" disabled={busy} onClick={() => setDeleteOpen(true)}>Delete batch</button>
            </div>
          </div>
          <p role="status" className="mt-4 text-sm">{batch.succeeded} results · {batch.failed} failed · {batch.cancelled_targets} cancelled · {batch.queued + batch.running} pending</p>
          <progress aria-label="Scan progress" value={batch.succeeded + batch.failed + batch.cancelled_targets} max={batch.total || 1} className="mt-3 w-full accent-[var(--signal-solid)]" />
          <p className="mt-3 text-xs leading-5 text-[var(--fg-muted)]">Failed and cancelled scans count toward completed progress. Pending work expires after 20 minutes. Results expire {new Date(batch.expires_at).toLocaleDateString()}.</p>
          {deleteOpen && <div role="alertdialog" aria-label="Delete this batch" className="mt-4 rounded-xl border border-[var(--bd-10)] p-4">
            <p className="text-sm">Delete all targets and results in this batch? This cannot be undone and does not restore the daily allowance.</p>
            <div className="mt-3 flex gap-2"><button type="button" className={button} onClick={() => void mutate('DELETE', {})} disabled={busy}>Confirm deletion</button><button type="button" className={button} onClick={() => setDeleteOpen(false)} disabled={busy}>Keep batch</button></div>
          </div>}
        </div>
        <ul className="space-y-3">{batch.targets.map((target) => <li key={target.id} className={panel}>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <a href={target.origin} target="_blank" rel="noopener noreferrer" className="min-w-0 break-all font-medium underline underline-offset-4">{target.origin}</a>
            <span className="text-sm">{target.result ? `${target.result.score}/100` : target.state === 'running' ? 'Scanning' : target.state === 'queued' ? 'Waiting' : target.state}</span>
          </div>
          {target.failure_code && <p className="mt-3 text-sm text-[var(--fg-muted)]">{SCAN_FAILURE_COPY[target.failure_code]}</p>}
          {target.result && <>
            <label className="mt-4 flex items-center gap-2 text-sm"><input type="checkbox" checked={target.follow_up} disabled={busy} onChange={(event) => void mutate('PATCH', { action: 'follow_up', targetId: target.id, selected: event.target.checked })} />Select {target.origin} for follow-up</label>
            <details className="mt-4"><summary className="cursor-pointer text-sm font-medium">View findings</summary><ul className="mt-3 space-y-3">{[...target.result.checks].sort((a, b) => ({ fail: 0, warn: 1, pass: 2 }[a.status] - { fail: 0, warn: 1, pass: 2 }[b.status])).map((check) => <li key={check.id} className="text-sm">
              <p className="font-medium">{SCAN_CHECK_COPY[check.id].label}: {check.status === 'pass' ? 'Found' : check.status === 'warn' ? 'Partial' : 'Missing'}</p>
              {check.status !== 'pass' && <p className="mt-1 text-[var(--fg-muted)]">{SCAN_CHECK_COPY[check.id].action}</p>}
            </li>)}</ul></details>
            <p className="mt-4 text-xs text-[var(--fg-muted)]">Readiness rubric v{target.result.version} · {(target.elapsed_ms / 1000).toFixed(1)} seconds · Public website evidence only</p>
          </>}
        </li>)}</ul>
        <p className="text-sm text-[var(--fg-muted)]">Use selected findings for a manual follow-up. A scan does not connect a merchant account or authorize changes.</p>
      </>}
      <p className="text-xs text-[var(--fg-muted)]">Crawl policy or scanning concern? <Link href="/support" prefetch={false} className="underline underline-offset-4">Contact support</Link>.</p>
    </section>
  )
}
