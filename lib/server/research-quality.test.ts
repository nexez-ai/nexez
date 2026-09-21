import { describe, expect, it } from 'vitest'
import { EXCLUDED_HOSTS } from '../../scripts/research-frame.mjs'
import { isResearchLlmsText, researchPageFailure, RESEARCH_EXCLUDED_HOSTS } from './research-quality'

const page = {
  origin: 'https://example.com', contentType: 'text/html; charset=utf-8',
  html: '<!doctype html><html><body>Business</body></html>', title: 'Acme Plumbing',
  text: 'Acme Plumbing provides repairs and installation throughout our local service area. Contact our team to schedule a visit.',
}

describe('research protocol 2 content validation', () => {
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
})
