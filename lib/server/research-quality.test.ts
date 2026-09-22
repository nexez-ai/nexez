import { describe, expect, it } from 'vitest'
import { EXCLUDED_HOSTS } from '../../scripts/research-frame.mjs'
import { isResearchLlmsText, researchPageFailure, RESEARCH_EXCLUDED_HOSTS } from './research-quality'

const page = {
  origin: 'https://example.com', contentType: 'text/html; charset=utf-8',
  html: '<!doctype html><html><body>Business</body></html>', title: 'Acme Plumbing',
  text: 'Acme Plumbing provides repairs and installation throughout our local service area. Contact our team to schedule a visit.',
}

describe('research protocol 4 content validation', () => {
  it('keeps final-destination exclusions aligned with the source policy', () => {
    expect(RESEARCH_EXCLUDED_HOSTS).toEqual(EXCLUDED_HOSTS)
  })
  it.each(['# Acme', '\uFEFF# Acme\n\n> Services and contact information.', '# Acme\r\n\r\n## Links\r\n- [About](/about.md)'])('accepts the required llms.txt H1 with optional sections', (body) => {
    expect(isResearchLlmsText(body, 'text/plain')).toBe(true)
  })
  it.each([null, '', '<html><h1>Acme</h1></html>', 'Page not found. Please try again.', '{"title":"# Acme"}', '## Acme', '# '])('rejects non-Markdown discovery responses', (body) => {
    expect(isResearchLlmsText(body, null)).toBe(false)
  })
  it.each(['text/html', 'application/xhtml+xml', 'application/json'])('rejects incompatible discovery MIME %s', (mime) => {
    expect(isResearchLlmsText('# Acme', mime)).toBe(false)
  })
  it('accepts readable HTML without requiring good readiness signals', () => {
    expect(researchPageFailure(page)).toBeNull()
    expect(researchPageFailure({ ...page, contentType: null })).toBeNull()
    expect(researchPageFailure({ ...page, title: '' })).toBeNull()
  })
  it.each([
    [{ contentType: 'application/json', html: '{"ok":true}' }, 'non_html'],
    [{ contentType: null, html: 'Not an HTML document' }, 'non_html'],
    [{ text: '', title: 'Acme' }, 'insufficient_content'],
    [{ title: 'Just a moment...', text: 'Enable JavaScript and cookies to continue' }, 'challenge_page'],
    [{ title: 'Welcome', text: 'Please verify you are human before continuing to this website.' }, 'challenge_page'],
    [{ title: 'Domain for sale', text: 'Buy this domain' }, 'parked_domain'],
    [{ title: 'Welcome', text: 'This domain is available for purchase. Contact the owner today.' }, 'parked_domain'],
    [{ title: 'Page not found', text: page.text }, 'unavailable_page'],
    [{ title: 'Account suspended', text: page.text }, 'unavailable_page'],
    [{ origin: 'https://www.facebook.com' }, 'excluded_destination'],
  ] as const)('classifies an unusable response with a closed reason', (change, reason) => {
    expect(researchPageFailure({ ...page, ...change })).toBe(reason)
  })
  it('does not confuse business prose or a hostname suffix with an exclusion', () => {
    expect(researchPageFailure({ ...page, title: 'Find a page with our bookstore', text: `${page.text} Our article explains the phrase buy this domain. ${'Book descriptions. '.repeat(200)}` })).toBeNull()
    expect(researchPageFailure({ ...page, origin: 'https://notfacebook.com' })).toBeNull()
  })
  it('rejects a titleless expired-domain renewal page with readable boilerplate', () => {
    expect(researchPageFailure({ ...page, title: '', text: 'Domain registration has expired. Renewal instructions: sign in to your registrar account, select this domain and choose Renew. Browse our domain auctions.' })).toBe('parked_domain')
  })
  it.each(['This domain has expired.', 'This domain name has expired.', 'Domain registration has expired.'])('rejects an explicit expiry notice at the start: %s', notice => {
    expect(researchPageFailure({ ...page, title: '', text: `${notice} ${page.text}` })).toBe('parked_domain')
  })
  it('does not reject ordinary business prose about domain renewal', () => {
    expect(researchPageFailure({ ...page, title: 'Domain renewal services', text: `${page.text} We help when domain registration has expired and explain your renewal options.` })).toBeNull()
  })
  it.each([
    'This Townsquare Interactive website is no longer available. If you have any questions please contact our support team.',
    'This website is no longer available. Please contact the hosting support team if you have questions.',
    'This Example Hosting website has been disabled. Please contact the hosting support team for assistance.',
    "Sorry, this website is temporarily unavailable. If you're the owner of this domain, contact your customer service representative to get your website back online.",
  ])('rejects a leading discontinued-hosting notice', text => {
    expect(researchPageFailure({ ...page, title: 'Website not available', text })).toBe('unavailable_page')
  })
  it.each(['', 'example.com '])('rejects a recently registered registrar placeholder', prefix => {
    const text = `${prefix}has been recently registered with Namecheap. Want a domain name like this? Discover domains on auction now. See all auctions.`
    expect(researchPageFailure({ ...page, title: '', text })).toBe('parked_domain')
  })
  it.each([
    'Therapy for adults. Confidence in movement. Visit our clinic or phone our team for an appointment.',
    'Nail appointments are available Monday through Saturday. Contact the salon to book. Gift certificates available.',
    'Acme Hosting helps customers when their website is no longer available. Contact our team for support.',
    'Our domain has been recently registered with Namecheap. We are a local plumbing business, not a domain auction.',
    'Our retirement statement thanks every customer for many years of support. We have enjoyed serving the community.',
  ])('preserves readable business pages without judging trading status', text => {
    expect(researchPageFailure({ ...page, text })).toBeNull()
  })
  it('excludes a domain offered to a future business', () => {
    expect(researchPageFailure({ ...page, text: 'Become a Featured Business on Example Directory and start using this domain today! Please email for more information.' })).toBe('parked_domain')
  })
  it('excludes the unbound-domain hosting control panel', () => {
    expect(researchPageFailure({ ...page, text: 'Website not found Sorry, Please confirm that this domain name has been bound to your website. Powered by the hosting control panel.' })).toBe('unavailable_page')
  })
  it.each([
    'This site uses cookies and similar technology (including Google Analytics and Meta Pixel) to understand site traffic. See our Privacy Policy for details. Got it',
    'Collapse Menu Your cart is empty. Close Cart Checkout $0.00 Loading, please wait. View Cart 0 $0.00',
  ])('does not qualify a body containing only UI boilerplate', text => {
    expect(researchPageFailure({ ...page, text })).toBe('insufficient_content')
    expect(researchPageFailure({ ...page, text: `${page.text} ${text}` })).toBeNull()
    expect(researchPageFailure({ ...page, text: `${text} ${page.text}` })).toBeNull()
  })
  it('preserves useful business content alongside a new-site notice or empty blog', () => {
    expect(researchPageFailure({ ...page, title: 'New site coming soon', text: `NEW SITE COMING SOON. ${page.text}` })).toBeNull()
    expect(researchPageFailure({ ...page, text: `Nothing Found. ${page.text}` })).toBeNull()
  })
})
