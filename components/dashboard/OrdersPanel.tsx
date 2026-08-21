'use client'

import { useState } from 'react'
import { Loader2, RotateCcw } from 'lucide-react'
import { formatCurrencyAmount, toMajorAmount } from '../../lib/currency'

export type OrderRow = {
  id: string
  offer_name: string | null
  amount_cents: number
  currency: string
  status: string
  slug: string | null
  refunded_cents?: number | null
  buyer_email?: string | null
  buyer_name?: string | null
  buyer_reference?: string | null
}

const STATUS_STYLE: Record<string, string> = {
  paid: 'text-[var(--ready)] border-[var(--ready)]/30 bg-[var(--ready)]/10',
  refunded: 'text-zinc-400 border-white/15 bg-white/5',
  disputed: 'text-[var(--amber)] border-[var(--amber)]/30 bg-[var(--amber)]/10',
  dispute_won: 'text-[var(--ready)] border-[var(--ready)]/30 bg-[var(--ready)]/10',
}

/** Direct-checkout orders with an in-app refund action (negotiated deals are refunded
 *  from the Negotiations inbox). Supports FULL or PARTIAL refunds - the amount field
 *  prefills to the refundable remainder; lower it for a partial. A partial keeps the
 *  order open for the rest. Inline confirm - no window.confirm. */
export function OrdersPanel({ orders }: { orders: OrderRow[] }) {
  const [rows, setRows] = useState(orders)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [confirmId, setConfirmId] = useState<string | null>(null)
  const [amountInput, setAmountInput] = useState('')
  const [error, setError] = useState('')

  if (!orders.length) return null

  const remainingMinor = (o: OrderRow) => Math.max(0, o.amount_cents - (o.refunded_cents || 0))

  function openConfirm(o: OrderRow) {
    setError('')
    setConfirmId(o.id)
    // Prefill with the refundable remainder (major units).
    setAmountInput(String(toMajorAmount(remainingMinor(o), o.currency)))
  }

  async function refund(o: OrderRow) {
    const remainingMajor = toMajorAmount(remainingMinor(o), o.currency)
    const entered = Number(amountInput)
    if (!Number.isFinite(entered) || entered <= 0) {
      setError('Enter a valid refund amount.')
      return
    }
    if (entered > remainingMajor + 1e-9) {
      setError('Amount exceeds the refundable remainder.')
      return
    }
    // At/above the remainder → full remainder (omit amount so the server refunds the
    // exact remaining cents, free of float rounding); otherwise a partial.
    const partial = entered < remainingMajor - 1e-9
    setBusyId(o.id)
    setError('')
    try {
      const res = await fetch('/api/orders/refund', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ orderId: o.id, ...(partial ? { amount: entered } : {}) }),
      })
      const data = (await res.json().catch(() => ({}))) as { error?: string; status?: string; refundedCents?: number; fully?: boolean }
      if (!res.ok) {
        setError(data.error || 'Refund failed.')
        return
      }
      setConfirmId(null)
      setRows((r) =>
        r.map((row) =>
          row.id === o.id
            ? { ...row, status: data.fully ? 'refunded' : 'paid', refunded_cents: data.refundedCents ?? row.refunded_cents }
            : row,
        ),
      )
    } catch {
      setError('Refund failed - try again.')
    } finally {
      setBusyId(null)
    }
  }

  return (
    <section className="nx-rise mt-8">
      <h2 className="text-lg font-semibold">Settled orders</h2>
      <p className="mt-1 text-sm text-zinc-500">
        Stripe-confirmed checkout, protocol, recurring, staged, and reserved-resource transactions. A refund returns the
        buyer&rsquo;s money and gives Nexez&rsquo;s commission back too—in full, or partially with the rest still refundable.
      </p>
      {error ? <p className="mt-2 text-sm text-red-300">{error}</p> : null}
      <div className="mt-4 overflow-x-auto rounded-xl border border-white/10">
        <table className="w-full text-sm">
          <thead className="text-left text-xs uppercase tracking-wide text-zinc-500">
            <tr className="border-b border-white/10">
              <th className="px-4 py-2 font-medium">Offer</th>
              <th className="px-4 py-2 font-medium">Buyer</th>
              <th className="px-4 py-2 font-medium">Amount</th>
              <th className="px-4 py-2 font-medium">Status</th>
              <th className="px-4 py-2 text-right font-medium">Action</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((o) => {
              const refunded = o.refunded_cents || 0
              const partiallyRefunded = o.status === 'paid' && refunded > 0
              return (
                <tr id={`order-${o.id}`} key={o.id} className="scroll-mt-6 border-b border-white/5 last:border-0">
                  <td className="px-4 py-3">
                    <span className="text-zinc-200">{o.offer_name || 'Offer'}</span>
                    {o.slug ? <span className="ml-2 text-xs text-zinc-500">/{o.slug}</span> : null}
                  </td>
                  <td className="px-4 py-3">
                    {o.buyer_name || o.buyer_email ? (
                      <span className="flex flex-col">
                        {o.buyer_name ? <span className="text-zinc-200">{o.buyer_name}</span> : null}
                        {o.buyer_email ? <span className="text-xs text-zinc-500">{o.buyer_email}</span> : null}
                        {o.buyer_reference ? <span className="text-[11px] text-zinc-600">ref: {o.buyer_reference}</span> : null}
                      </span>
                    ) : (
                      <span className="text-xs text-zinc-600">-</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-zinc-200">
                    {formatCurrencyAmount(o.amount_cents, o.currency)}
                    {partiallyRefunded ? (
                      <span className="ml-2 text-xs text-[var(--amber)]">
                        {formatCurrencyAmount(refunded, o.currency)} refunded
                      </span>
                    ) : null}
                  </td>
                  <td className="px-4 py-3">
                    <span className={`inline-flex rounded-full border px-2 py-0.5 text-xs capitalize ${STATUS_STYLE[o.status] || 'border-white/15 text-zinc-400'}`}>
                      {partiallyRefunded ? 'partial refund' : o.status.replace('_', ' ')}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right">
                    {o.status !== 'paid' ? (
                      <span className="text-xs text-zinc-600">-</span>
                    ) : confirmId === o.id ? (
                      <span className="inline-flex items-center gap-2">
                        <span className="text-xs text-zinc-400">Refund</span>
                        <input
                          type="number"
                          min="0"
                          step="0.01"
                          value={amountInput}
                          onChange={(e) => setAmountInput(e.target.value)}
                          aria-label="Refund amount"
                          className="w-20 rounded-md border border-white/15 bg-black/30 px-2 py-1 text-xs text-zinc-100"
                        />
                        <button type="button" onClick={() => refund(o)} disabled={busyId === o.id} className="rounded-lg border border-red-400/40 bg-red-400/10 px-2.5 py-1 text-xs font-semibold text-red-300 hover:bg-red-400/20 disabled:opacity-50">
                          {busyId === o.id ? <Loader2 className="size-3.5 animate-spin" /> : 'Confirm'}
                        </button>
                        <button type="button" onClick={() => setConfirmId(null)} className="text-xs text-zinc-500 hover:text-zinc-300">
                          Cancel
                        </button>
                      </span>
                    ) : (
                      <button type="button" onClick={() => openConfirm(o)} className="inline-flex items-center gap-1.5 rounded-lg border border-white/15 px-3 py-1.5 text-xs text-zinc-200 hover:bg-white/5">
                        <RotateCcw className="size-3.5" /> Refund
                      </button>
                    )}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </section>
  )
}
