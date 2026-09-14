/**
 * Translate a fixed grant duration into the contractual phrase shown in merchant
 * email. This lives outside the route module because Next.js route files may only
 * export HTTP handlers and supported route configuration.
 */
export function describeGrantDuration(days: number): string {
  // A fixed day count is not a calendar month or year. Keep the stored duration
  // exact, including across month lengths, leap years, and daylight saving time.
  if (!Number.isInteger(days) || days <= 0) return 'your complimentary period'
  return days === 1 ? 'one day' : `${days} days`
}
