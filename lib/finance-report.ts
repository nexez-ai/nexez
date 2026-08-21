export type FinanceCurrencyRow = {
  currency: string
  transactions: number
  grossCents: number
  retainedGrossCents: number
  refundedCents: number
  disputeCents: number
  outflowCents: number
  feeCents: number
  netCents: number
  aovCents: number
  partialRefunds: number
  snapshotTransactions: number
  estimatedTransactions: number
}

export type FinanceEscrowRow = {
  currency: string
  deals: number
  fundedCents: number
  heldCents: number
  capturedCents: number
  refundedCents: number
  disputeCents: number
  outflowCents: number
  feeCents: number
  netCents: number
  partialRefunds: number
  snapshotDeals: number
  estimatedDeals: number
}

export type FinanceNegotiatedWindowRow = Pick<FinanceEscrowRow,
  'currency' | 'deals' | 'fundedCents' | 'heldCents' | 'capturedCents' | 'netCents'
> & { outflowCents: number }

export type FinanceRollup = {
  schemaVersion: 1
  currencies: FinanceCurrencyRow[]
  channels: Array<{
    currency: string
    channel: string
    transactions: number
    grossCents: number
    netCents: number
  }>
  daily: Array<{
    currency: string
    date: string
    transactions: number
    grossCents: number
    outflowCents: number
    netCents: number
  }>
  topOffers: Array<{
    currency: string
    pageId: string | null
    slug: string
    offerKey: string
    offerName: string
    transactions: number
    grossCents: number
    netCents: number
  }>
  escrow: FinanceEscrowRow[]
  negotiatedWindow: FinanceNegotiatedWindowRow[]
  operations: {
    openRequests: number
    disputedOrders: number
    disputedNegotiations: number
    heldNegotiations: number
    staleHeldNegotiations: number
    estimatedEconomics: number
  }
}

type RpcClient = {
  rpc: (name: string, args: Record<string, unknown>) => PromiseLike<{ data: unknown; error: unknown }>
}

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

function integer(value: unknown) {
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed >= 0 ? Math.round(parsed) : 0
}

function text(value: unknown) {
  return typeof value === 'string' ? value : ''
}

function currency(value: unknown) {
  return text(value).trim().toLowerCase() || 'usd'
}

function rows<T>(value: unknown, parse: (row: Record<string, unknown>) => T | null): T[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((item) => {
    const parsed = parse(object(item))
    return parsed ? [parsed] : []
  })
}

export function parseFinanceRollup(value: unknown): FinanceRollup | null {
  const raw = object(value)
  if (Number(raw.schemaVersion) !== 1) return null
  const operations = object(raw.operations)

  return {
    schemaVersion: 1,
    currencies: rows(raw.currencies, (row) => ({
      currency: currency(row.currency),
      transactions: integer(row.transactions),
      grossCents: integer(row.grossCents),
      retainedGrossCents: integer(row.retainedGrossCents),
      refundedCents: integer(row.refundCents),
      disputeCents: integer(row.disputeCents),
      outflowCents: integer(row.outflowCents),
      feeCents: integer(row.feeCents),
      netCents: integer(row.netCents),
      aovCents: integer(row.aovCents),
      partialRefunds: integer(row.partialRefunds),
      snapshotTransactions: integer(row.snapshotTransactions),
      estimatedTransactions: integer(row.estimatedTransactions),
    })),
    channels: rows(raw.channels, (row) => text(row.channel) ? {
      currency: currency(row.currency),
      channel: text(row.channel),
      transactions: integer(row.transactions),
      grossCents: integer(row.grossCents),
      netCents: integer(row.netCents),
    } : null),
    daily: rows(raw.daily, (row) => text(row.date) ? {
      currency: currency(row.currency),
      date: text(row.date),
      transactions: integer(row.transactions),
      grossCents: integer(row.grossCents),
      outflowCents: integer(row.outflowCents),
      netCents: integer(row.netCents),
    } : null),
    topOffers: rows(raw.topOffers, (row) => text(row.offerKey) ? {
      currency: currency(row.currency),
      pageId: typeof row.pageId === 'string' ? row.pageId : null,
      slug: text(row.slug),
      offerKey: text(row.offerKey),
      offerName: text(row.offerName) || 'Order',
      transactions: integer(row.transactions),
      grossCents: integer(row.grossCents),
      netCents: integer(row.netCents),
    } : null),
    escrow: rows(raw.escrow, (row) => ({
      currency: currency(row.currency),
      deals: integer(row.deals),
      fundedCents: integer(row.fundedCents),
      heldCents: integer(row.heldCents),
      capturedCents: integer(row.capturedCents),
      refundedCents: integer(row.refundCents),
      disputeCents: integer(row.disputeCents),
      outflowCents: integer(row.outflowCents),
      feeCents: integer(row.feeCents),
      netCents: integer(row.netCents),
      partialRefunds: integer(row.partialRefunds),
      snapshotDeals: integer(row.snapshotDeals),
      estimatedDeals: integer(row.estimatedDeals),
    })),
    negotiatedWindow: rows(raw.negotiatedWindow, (row) => ({
      currency: currency(row.currency),
      deals: integer(row.deals),
      fundedCents: integer(row.fundedCents),
      heldCents: integer(row.heldCents),
      capturedCents: integer(row.capturedCents),
      outflowCents: integer(row.outflowCents),
      netCents: integer(row.netCents),
    })),
    operations: {
      openRequests: integer(operations.openRequests),
      disputedOrders: integer(operations.disputedOrders),
      disputedNegotiations: integer(operations.disputedNegotiations),
      heldNegotiations: integer(operations.heldNegotiations),
      staleHeldNegotiations: integer(operations.staleHeldNegotiations),
      estimatedEconomics: integer(operations.estimatedEconomics),
    },
  }
}

export async function loadFinanceRollup(
  client: RpcClient,
  input: { from?: Date | null; to?: Date | null; fallbackCommissionBps?: number } = {},
) {
  const { data, error } = await client.rpc('nz_owner_finance_rollup', {
    p_from: input.from?.toISOString() ?? null,
    p_to: input.to?.toISOString() ?? null,
    p_fallback_commission_bps: Math.max(0, Math.min(1000, Math.round(input.fallbackCommissionBps ?? 0))),
  })
  if (error) return { data: null, error }
  const parsed = parseFinanceRollup(data)
  return parsed
    ? { data: parsed, error: null }
    : { data: null, error: new Error('Finance reporting returned an unsupported shape.') }
}
