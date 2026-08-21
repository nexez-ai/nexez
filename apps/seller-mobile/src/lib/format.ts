export function formatDate(value?: string | null) {
  if (!value) return 'Recently'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return 'Recently'
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

export function formatDateTime(value?: string | null) {
  if (!value) return 'Recently'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return 'Recently'
  return date.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}

const ZERO_DECIMAL_CURRENCIES = new Set([
  'bif',
  'clp',
  'djf',
  'gnf',
  'jpy',
  'kmf',
  'krw',
  'mga',
  'pyg',
  'rwf',
  'ugx',
  'vnd',
  'vuv',
  'xaf',
  'xof',
  'xpf',
])

export function formatCurrency(cents?: number | null, currency = 'usd') {
  if (cents == null || Number.isNaN(cents)) return 'Open'
  const normalizedCurrency = currency.toLowerCase()
  const zeroDecimal = ZERO_DECIMAL_CURRENCIES.has(normalizedCurrency)
  const amount = cents / (zeroDecimal ? 1 : 100)
  try {
    return new Intl.NumberFormat(undefined, {
      style: 'currency',
      currency: normalizedCurrency.toUpperCase(),
      maximumFractionDigits: zeroDecimal ? 0 : 2,
    }).format(amount)
  } catch {
    return `${amount.toFixed(zeroDecimal ? 0 : 2)} ${normalizedCurrency.toUpperCase()}`
  }
}

export function compactNumber(value: number) {
  return new Intl.NumberFormat(undefined, { notation: 'compact', maximumFractionDigits: 1 }).format(value)
}

export function percent(value: number) {
  return `${Math.round(value)}%`
}
