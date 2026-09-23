/** Research-only protocol. Customer scan scoring and behavior stay unchanged. */
export const RESEARCH_PROTOCOL_VERSION = 5 as const
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
  diagnostics?: ReturnType<typeof researchPageDiagnostics>
}

/** Numeric evidence only. Never persist the text, title or response headers. */
export function researchPageDiagnostics(html: string, text: string, title: string) {
  return {
    visibleChars: text.trim().length,
    replacementChars: (text.match(/\uFFFD/g) || []).length,
    htmlBytes: Buffer.byteLength(html, 'utf8'),
    titleChars: title.trim().length,
  }
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
  contentEncoding?: string | null
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
  // The pinned HTTP transport requests identity encoding and does not inflate
  // responses. Never count compressed or mostly undecodable bytes as prose.
  if (input.contentEncoding && input.contentEncoding.trim().toLowerCase() !== 'identity') return 'non_html'
  if (!/<(?:!doctype\s+html|html|head|body|main|div|p|h[1-6]|a|table|section|article|ul|ol)(?:\s|>)/i.test(input.html)) return 'non_html'
  const replacements = (text.match(/\uFFFD/g) || []).length
  if (replacements >= 3 && replacements / Math.max(1, text.length) > 0.02) return 'insufficient_content'
  if (shortPage && (
    /^(?:javascript is disabled[.!]?\s*)?(?:in order to continue,?\s*)?(?:we need to\s+)?verify that you(?:['’]re| are) not a robot\b/i.test(text)
    || /^(?:please wait[.!]?\s*)?(?:checking|verifying) (?:your )?(?:browser|connection) (?:before|for|security)\b/i.test(text)
  )) return 'challenge_page'
  // Empty application shells and auto-generated server pages are not readable
  // business homepages. Whole-body or paired-template checks preserve real
  // content alongside an ordinary notice about JavaScript or hosting.
  if (text.length < 600 && (
    /^(?:we(?:['’]re| are) sorry[, ]+but\s+)?[^.!?]{1,160}does(?:n['’]t| not) work(?: properly)? without javascript(?: enabled)?[.!]?\s*(?:please )?enable it to continue[.!]?$/i.test(text)
    || /^(?:you (?:need|have) to |please )?enable javascript(?: in your browser)? to (?:run|use|view) this (?:app|application|website|site)[.!]?$/i.test(text)
    || /^loading redirection target\b.{0,450}\bredirection target page should load\b.{0,200}\bselect the link above[.!]?$/i.test(text)
  )) return 'insufficient_content'
  if (shortPage && /^index of\s*\//i.test(title)
    && /^index of\s*\/.*\bname\s+last\s+modified\s+size\b/i.test(text)) return 'unavailable_page'
  if (text.length < 1000 && (
    /^welcome to (?:nginx|apache)[!.]?\s*if you see this page\b.{0,450}\b(?:further configuration is required|successfully installed)\b.{0,450}(?:thank you for using (?:nginx|apache)[!.]?|commercial support is available[^.]*\.)$/i.test(text)
    || /^this site is ready\s+nothing has been published here yet\b.{0,650}\bthis page disappears automatically\b.{0,150}\bfile is there[.!]?$/i.test(text)
    || /^future home of\b.{0,120}\bif you['’]re the site owner\b.{0,100}\blog in to launch this site\b.{0,160}\bplease check back soon[.!]?$/i.test(text)
    || /^(?:the|this) website is currently down[.!]?\s*we['’]re sorry for the inconvenience\b.{0,300}\bweb support team\b.{0,180}$/i.test(text)
  )) return 'unavailable_page'
  if (text.length < 600 && /^(?:this|the) website may be down\b/i.test(text)
    && /\bsite available for sale[.!]?\s*contact\b/i.test(text)) return 'parked_domain'
  if (/^(?:just a moment(?:\.\.\.)?|attention required|security (?:check|verification)|verify (?:you are|you're) human)[!?.\s]*$/i.test(title)
    || (shortPage && /\b(?:checking (?:your )?browser|verify (?:that )?you are (?:a )?human|enable javascript and cookies to continue|performing security verification)\b/i.test(text))) return 'challenge_page'
  if (/\b(?:domain (?:name )?(?:is )?for sale|domain parked|parked domain)\b/i.test(title)
    || (shortPage && /\b(?:this domain (?:name )?(?:is |may be )?(?:for sale|available for (?:sale|purchase))|buy this domain)\b/i.test(text))
    // Registrar renewal screens may omit a title and contain ample boilerplate.
    // Anchor the notice so an ordinary business FAQ about renewal still passes.
    || (shortPage && /^(?:this domain(?: name)?|domain registration) (?:has expired|is expired)\b/i.test(text))
    // A fresh registrar holding page is not an operating business homepage.
    // Require both its leading notice and a specific domain-auction prompt.
    || (shortPage && /^(?:\S{1,253}\s+)?has been recently registered with\b/i.test(text)
      && /\b(?:want a domain name like this|discover domains on auction)\b/i.test(text))
    || (shortPage && /^become a featured business on\b.{1,280}\band start using this domain today\b/i.test(text))) return 'parked_domain'
  if (/^(?:(?:error\s*)?404(?:\s*[-:|]\s*)?)?(?:page |website |site |account )?(?:not found|unavailable|suspended|coming soon|under construction)[!?.\s]*$/i.test(title)
    || (shortPage && /\b(?:this (?:website|account) has been suspended|this website is currently unavailable)\b/i.test(text))
    // Hosting providers may insert their name before the discontinued-site
    // notice. Keep the leading match and provider-name length bounded.
    || (shortPage && /^(?:sorry[,!.]?\s*)?(?:this|the) (?:[a-z0-9&'-]+ ){0,5}(?:website|site|account) (?:is (?:no longer available|temporarily unavailable|not (?:currently )?available)|has been (?:disabled|suspended|removed|deactivated))\b/i.test(text))
    || (shortPage && /^website not found\b/i.test(text)
      && /\bconfirm that this domain name has been bound to your website\b/i.test(text))) return 'unavailable_page'
  // These complete bodies are UI boilerplate, not readable homepage content.
  // Full-text anchors preserve a business page that also contains the controls.
  if (/^This (?:site|website) uses cookies and similar technology\b[^.]{0,200}\.\s*See our Privacy Policy for details\.\s*Got it[.!]?$/i.test(text)
    || /^(?:Collapse Menu\s+)?Your cart is empty\.\s+Close Cart\s+Checkout\s+[$€£]\s*0(?:[.,]00)?\s+Loading, please wait\.\s+View Cart\s+0\s+[$€£]\s*0(?:[.,]00)?$/i.test(text)) return 'insufficient_content'
  if (text.length < RESEARCH_MIN_VISIBLE_CHARS) return 'insufficient_content'
  return null
}
