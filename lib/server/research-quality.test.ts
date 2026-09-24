import { describe, expect, it } from 'vitest'
import { EXCLUDED_HOSTS } from '../../scripts/research-frame.mjs'
import { isResearchLlmsText, researchPageDiagnostics, researchPageFailure, RESEARCH_EXCLUDED_HOSTS } from './research-quality'

const page = {
  origin: 'https://example.com', contentType: 'text/html; charset=utf-8',
  html: '<!doctype html><html><body>Business</body></html>', title: 'Acme Plumbing',
  text: 'Acme Plumbing provides repairs and installation throughout our local service area. Contact our team to schedule a visit.',
}

describe('research protocol 6 content validation', () => {
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
  it.each([
    ['Unpublished', 'This site is ready Nothing has been published here yet. Please check back soon. Is this your site? Upload your files with an index in the top folder. This page disappears automatically as soon as that file is there.', 'unavailable_page'],
    ['Future home under construction', "Future home of something quite cool If you're the site owner, log in to launch this site. If you are a visitor, please check back soon.", 'unavailable_page'],
    ['Index of /', 'Index of / Name Last modified Size Description cgi-bin folder assets archive files server footer', 'unavailable_page'],
    ['Index of /', 'Index of / Name Last Modified Size cgi-bin 2026-01-01 10:00 - Proudly Served by Example Server', 'unavailable_page'],
    ['Welcome', 'This website may be down for maintenance. Site available for sale. Contact the administrator for information.', 'parked_domain'],
    ['App', "We're sorry but Example Studio doesn't work properly without JavaScript enabled. Please enable it to continue.", 'insufficient_content'],
    ['App', 'We are sorry but Example Studio does not work properly without JavaScript enabled. Please enable it to continue.', 'insufficient_content'],
    ['Welcome to nginx!', 'Welcome to nginx! If you see this page, the nginx web server is successfully installed and working. Further configuration is required. For online documentation and support please refer to the server manual. Thank you for using nginx.', 'unavailable_page'],
    ['Down', "The Website is Currently Down. We're sorry for the inconvenience. If you need assistance, please contact our web support team at the hosting provider.", 'unavailable_page'],
    ['Redirect', "Loading redirection target In approx. 2 seconds the redirection target page should load. If it doesn't please select the link above.", 'insufficient_content'],
    ['', "JavaScript is disabled In order to continue, we need to verify that you're not a robot. This requires JavaScript. Enable JavaScript and then reload the page.", 'challenge_page'],
  ])('excludes a template family without scoring its boilerplate: %s', (title, text, reason) => {
    expect(researchPageFailure({ ...page, title, text })).toBe(reason)
  })
  it('rejects an HTML MIME label on binary or mostly undecodable data', () => {
    expect(researchPageFailure({ ...page, html: 'compressed-binary-payload' })).toBe('non_html')
    expect(researchPageFailure({ ...page, text: 'bad\uFFFD'.repeat(30) })).toBe('insufficient_content')
    expect(researchPageFailure({ ...page, text: `${page.text} \uFFFD` })).toBeNull()
  })
  it.each(['gzip', 'br', 'deflate', 'gzip, br'])('excludes unsupported transport encoding %s without inflating it', contentEncoding => {
    expect(researchPageFailure({ ...page, contentEncoding })).toBe('non_html')
  })
  it.each([null, '', 'identity', ' Identity '])('accepts an uncompressed response: %s', contentEncoding => {
    expect(researchPageFailure({ ...page, contentEncoding })).toBeNull()
  })
  it.each([
    'We build JavaScript applications and help when a website is currently down. Contact our local support team.',
    'Our business has moved. Visit our new website for services, hours and appointments. Thank you for your support.',
    'MENU HOME CONTACT Our clinic offers appointments Monday to Friday. Telephone and email bookings welcome.',
    'Café São Paulo provides food and drinks. Bienvenidos, bienvenue, willkommen. Contact us for reservations.',
    'This frames fallback describes our clinic, treatments, opening hours and how to contact the reception team.',
    "The website is currently down, but our shop is open. Visit us for repairs or call our team for appointments.",
    "We're sorry but Example doesn't work properly without JavaScript enabled. Please enable it to continue. We provide plumbing repairs, installations and emergency support. Contact our team to book a service.",
    'Welcome to nginx! Our hosting company provides local support, migration, backups and managed servers for businesses.',
  ])('preserves readable business content and multilingual text', text => {
    expect(researchPageFailure({ ...page, text })).toBeNull()
  })
  it('emits only bounded numeric content evidence, never page bodies', () => {
    expect(researchPageDiagnostics('<p>Test</p>', ' Test ', 'Title')).toEqual({ visibleChars: 4, replacementChars: 0, htmlBytes: 11, titleChars: 5 })
  })
  describe('provider promotional holding template', () => {
    // Synthetic examples only, not saved research responses or real identities.
    const bodies = ['Affordable, Reliable', 'Affordable and Reliable', 'Reliable, Affordable']
      .flatMap(pitch => ['ExampleHost', 'Sample Hosting Ltd.', 'demo.example'].flatMap(provider => [
        `${pitch} Web Hosting Solutions Web Hosting - courtesy of ${provider} Awards --> Help Center Contact Us About Us Affiliates Terms &copy;2012 ${provider}. All rights reserved.`,
        `${pitch} Web Hosting Solutions. Web Hosting: courtesy of ${provider} Contact Us Help Centre About Us Terms of Service © 2026 ${provider} All rights reserved`,
        `${pitch} Web Hosting Solutions Web Hosting courtesy of ${provider} Help Center Contact Us About Us Affiliates Terms Copyright 2012-2026 ${provider} All rights reserved.`,
        `${pitch} Web Hosting Solutions Web Hosting - courtesy of www.${provider} Awards --> Help Center Contact Us About Us Affiliates Terms &copy;2012 ${provider}. All rights reserved.`,
        `${pitch} Web Hosting Solutions Web Hosting - courtesy of ${provider} Help Center About Us Contact Us Terms (c) 2026 www.${provider}. All rights reserved.`,
      ]))
    it.each(bodies)('rejects the complete holding template without depending on provider or title: %s', text => {
      for (const title of ['', 'Welcome', page.title]) {
        expect(researchPageFailure({ ...page, title, text })).toBe('unavailable_page')
        expect(researchPageFailure({ ...page, title, text: text.replaceAll(' ', '\n\t') })).toBe('unavailable_page')
      }
    })
    it.each(bodies)('preserves real business prose alongside the template: %s', text => {
      expect(researchPageFailure({ ...page, text: `${page.text} ${text}` })).toBeNull()
      expect(researchPageFailure({ ...page, text: `${text} ${page.text}` })).toBeNull()
    })
    it.each([
      'Affordable, Reliable Web Hosting Solutions. Our managed plans include backups and local telephone support. Contact us to arrange migration.',
      'Affordable, Reliable Web Hosting Solutions Web Hosting - courtesy of ExampleHost. We offer managed servers from $12 monthly. Contact Us About Us Terms ©2026 ExampleHost All rights reserved.',
      'Example Clinic. Appointments, opening hours and contact information. Web hosting courtesy of ExampleHost. All rights reserved.',
      'Help Center Contact Us About Us Affiliates Terms. Example Hosting provides backups, migrations and hosting packages for local businesses.',
      'Affordable, Reliable Web Hosting Solutions. Our shop has retired after many years of service. Thank you to all customers for your support.',
      'Example Salon has moved to a new location. Call our team to book an appointment. Web Hosting - courtesy of ExampleHost.',
      'Affordable, Reliable Web Hosting Solutions. Help Center Contact Us About Us Affiliates Terms ©2026 ExampleHost All rights reserved.',
    ])('does not ban hosting, navigation, relocation or retirement language: %s', text => {
      expect(researchPageFailure({ ...page, text })).toBeNull()
    })
  })
})
