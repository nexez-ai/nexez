/** Research-only protocol. Customer scan scoring and behavior stay unchanged. */
export const RESEARCH_PROTOCOL_VERSION = 3 as const
export const RESEARCH_MIN_VISIBLE_CHARS = 80

// Mirrors the frozen source selector. A regression test guards policy drift.
export const RESEARCH_EXCLUDED_HOSTS = [
  'facebook.com', 'instagram.com', 'linktr.ee', 'yelp.com', 'google.com', 'goo.gl',
  'doordash.com', 'ubereats.com', 'grubhub.com', 'opentable.com', 'toasttab.com',
  'squareup.com', 'order.online', 'wa.me', 'twitter.com', 'x.com', 'tiktok.com',
  'youtube.com', 'linkedin.com', 'etsy.com', 'ebay.com', 'amazon.com',
  'wixsite.com', 'business.site', 'mapquest.com', 'yellowpages.com', 'tripadvisor.com',
]

export type ResearchContentFailure = 'non_html' | 'insufficient_content'
  | 'challenge_page' | 'parked_domain' | 'unavailable_page' | 'excluded_destination'

export type ResearchQuality = {
  protocolVersion: typeof RESEARCH_PROTOCOL_VERSION
  failure: ResearchContentFailure | null
}

/** A format check, not a guarantee that the file is accurate or useful to AI.
 * The llms.txt proposal requires an H1; all other sections are optional.
 */
export function isResearchLlmsText(text: string | null, contentType: string | null): boolean {
  if (!text || /(?:text\/html|application\/(?:xhtml\+xml|json))/i.test(contentType || '')) return false
  const body = text.replace(/^\uFEFF/, '').trim()
  if (/<(?:!doctype\s+html|html|head|body|script)(?:\s|>)/i.test(body)) return false
  return /^# [^#\s][^\r\n]*$/m.test(body.split(/\r?\n/, 1)[0] || '')
}

/** Conservative, deterministic exclusions. Never evaluates page instructions.
 * This measures accessible HTML, not whether a business is legitimate or closed.
 */
export function researchPageFailure(input: {
  origin: string
  contentType: string | null
  html: string
  text: string
  title: string
}): ResearchContentFailure | null {
  const host = new URL(input.origin).hostname.toLowerCase().replace(/\.$/, '')
  if (RESEARCH_EXCLUDED_HOSTS.some(base => host === base || host.endsWith(`.${base}`))) return 'excluded_destination'
  const mime = (input.contentType || '').split(';', 1)[0].trim().toLowerCase()
  if (mime ? !['text/html', 'application/xhtml+xml'].includes(mime)
    : !/<(?:!doctype\s+html|html|head|body)(?:\s|>)/i.test(input.html)) return 'non_html'
  const title = input.title.trim()
  const text = input.text.trim()
  const shortPage = text.length < 2500
  if (/^(?:just a moment(?:\.\.\.)?|attention required|security (?:check|verification)|verify (?:you are|you're) human)[!?.\s]*$/i.test(title)
    || (shortPage && /\b(?:checking (?:your )?browser|verify (?:that )?you are (?:a )?human|enable javascript and cookies to continue|performing security verification)\b/i.test(text))) return 'challenge_page'
  if (/\b(?:domain (?:name )?(?:is )?for sale|domain parked|parked domain)\b/i.test(title)
    || (shortPage && /\b(?:this domain (?:name )?(?:is |may be )?(?:for sale|available for (?:sale|purchase))|buy this domain)\b/i.test(text))
    // Registrar renewal screens may omit a title and contain ample boilerplate.
    // Anchor the notice so an ordinary business FAQ about renewal still passes.
    || (shortPage && /^(?:this domain(?: name)?|domain registration) (?:has expired|is expired)\b/i.test(text))) return 'parked_domain'
  if (/^(?:(?:error\s*)?404(?:\s*[-:|]\s*)?)?(?:page |website |site |account )?(?:not found|unavailable|suspended|coming soon|under construction)[!?.\s]*$/i.test(title)
    || (shortPage && /\b(?:this (?:website|account) has been suspended|this website is currently unavailable)\b/i.test(text))) return 'unavailable_page'
  if (text.length < RESEARCH_MIN_VISIBLE_CHARS) return 'insufficient_content'
  return null
}
