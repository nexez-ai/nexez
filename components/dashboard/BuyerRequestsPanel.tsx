'use client'

import { useState } from 'react'
import { Loader2, MessageSquareWarning, RotateCcw } from 'lucide-react'

export type BuyerRequestRow = {
  id: string
  order_kind: 'checkout' | 'negotiation'
  order_id: string
  kind: 'refund_request' | 'problem_report'
  status: string
  message: string | null
  buyer_email: string | null
  slug: string | null
  created_at: string
}

const KIND_LABEL: Record<string, string> = {
  refund_request: 'Refund request',
  problem_report: 'Problem report',
}

const STATUS_STYLE: Record<string, string> = {
  open: 'text-[var(--amber)] border-[var(--amber)]/30 bg-[var(--amber)]/10',
  acknowledged: 'text-[var(--signal)] border-[var(--signal)]/30 bg-[var(--signal)]/10',
  resolved: 'text-[var(--ready)] border-[var(--ready)]/30 bg-[var(--ready)]/10',
  declined: 'text-zinc-400 border-[var(--bd-15)] bg-[var(--ov-05)]',
}

const STATUS_LABEL: Record<string, string> = {
  open: 'New',
  acknowledged: 'Reviewing',
  resolved: 'Resolved',
  declined: 'Declined',
}

/** Buyer-filed refund requests / problem reports (from the order portal). The seller
 *  refunds from the matching order/deal workflow; here they triage the request itself. */
export function BuyerRequestsPanel({ requests }: { requests: BuyerRequestRow[] }) {
  const [rows, setRows] = useState(requests)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [error, setError] = useState('')

  if (!requests.length) return null

  async function setStatus(id: string, status: string) {
    setBusyId(id)
    setError('')
    try {
      const res = await fetch('/api/orders/request-status', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ id, status }),
      })
      const data = (await res.json().catch(() => ({}))) as { error?: string }
      if (!res.ok) {
        setError(data.error || 'Could not update.')
        return
      }
      setRows((r) => r.map((o) => (o.id === id ? { ...o, status } : o)))
    } catch {
      setError('Could not update - try again.')
    } finally {
      setBusyId(null)
    }
  }

  return (
    <section id="buyer-requests" className="nx-rise mt-8 scroll-mt-6">
      <h2 className="flex items-center gap-2 text-lg font-semibold">
        <MessageSquareWarning className="size-4 text-[var(--amber)]" /> Buyer requests
      </h2>
      <p className="mt-1 text-sm text-[var(--fg-muted-2)]">
        Refund requests and problem reports buyers filed from their order page. Open the linked order or negotiated deal
        before resolving the request so the payment action and recourse record stay aligned.
      </p>
      {error ? <p className="mt-2 text-sm text-red-300">{error}</p> : null}
      <div className="mt-4 space-y-3">
        {rows.map((r) => {
          const closed = r.status === 'resolved' || r.status === 'declined'
          return (
            <div key={r.id} className="rounded-xl border border-[var(--bd-10)] bg-[var(--ov-02)] p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <span className="flex items-center gap-1.5 text-sm font-medium text-zinc-100">
                    {r.kind === 'refund_request' ? <RotateCcw className="size-3.5" /> : <MessageSquareWarning className="size-3.5" />}
                    {KIND_LABEL[r.kind] || r.kind}
                  </span>
                  {r.slug ? <span className="text-xs text-[var(--fg-muted-2)]">/{r.slug}</span> : null}
                  <span className="text-xs text-zinc-600">· {new Date(r.created_at).toLocaleDateString()}</span>
                </div>
                <span className={`inline-flex rounded-full border px-2 py-0.5 text-xs ${STATUS_STYLE[r.status] || 'border-[var(--bd-15)] text-[var(--fg-muted)]'}`}>
                  {STATUS_LABEL[r.status] || r.status}
                </span>
              </div>
              {r.buyer_email ? <p className="mt-2 text-xs text-[var(--fg-muted-2)]">From {r.buyer_email}</p> : null}
              {r.message ? <p className="mt-2 whitespace-pre-wrap text-sm text-[var(--fg-muted)]">{r.message}</p> : null}
              {!closed ? (
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <a
                    href={r.order_kind === 'negotiation' ? `/dashboard/negotiations#negotiation-${r.order_id}` : `#order-${r.order_id}`}
                    className="inline-flex items-center rounded-lg border border-[var(--signal)]/30 bg-[var(--signal)]/10 px-3 py-1.5 text-xs font-semibold text-[var(--signal)] hover:bg-[var(--signal)]/20"
                  >
                    Review {r.order_kind === 'negotiation' ? 'deal' : 'order'}
                  </a>
                  {r.status === 'open' ? (
                    <button
                      type="button"
                      onClick={() => setStatus(r.id, 'acknowledged')}
                      disabled={busyId === r.id}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--bd-15)] px-3 py-1.5 text-xs text-[var(--fg)] hover:bg-[var(--ov-05)] disabled:opacity-50"
                    >
                      {busyId === r.id ? <Loader2 className="size-3.5 animate-spin" /> : null} Mark reviewing
                    </button>
                  ) : null}
                  <button
                    type="button"
                    onClick={() => setStatus(r.id, 'resolved')}
                    disabled={busyId === r.id}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--ready)]/40 bg-[var(--ready)]/10 px-3 py-1.5 text-xs font-semibold text-[var(--ready)] hover:bg-[var(--ready)]/20 disabled:opacity-50"
                  >
                    {busyId === r.id ? <Loader2 className="size-3.5 animate-spin" /> : null} Mark resolved
                  </button>
                  <button
                    type="button"
                    onClick={() => setStatus(r.id, 'declined')}
                    disabled={busyId === r.id}
                    className="text-xs text-[var(--fg-muted-2)] hover:text-[var(--fg-muted)] disabled:opacity-50"
                  >
                    Decline
                  </button>
                </div>
              ) : null}
            </div>
          )
        })}
      </div>
    </section>
  )
}
