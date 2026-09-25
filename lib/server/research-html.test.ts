import { describe, expect, it } from 'vitest'
import { extractResearchHtml } from './research-html'
import { researchPageFailure } from './research-quality'

const prose = 'Acme Plumbing provides repairs and installation throughout our local service area. Contact our team to schedule a visit.'
const failure = (html: string) => researchPageFailure({
  origin: 'https://example.com', contentType: 'text/html', html, ...extractResearchHtml(html),
})

describe('protocol 7 research-only HTML evidence', () => {
  it.each([
    '<img src="' + 'attribute '.repeat(100),
    "<img alt='attribute > " + 'attribute '.repeat(100),
    '<script>' + 'payload '.repeat(100),
    '<SCRIPT type="text/javascript">' + 'payload '.repeat(100),
    '<style>' + '.css{content:"payload"}'.repeat(100),
    '<!--' + 'comment '.repeat(100),
    '<head><title>' + 'head '.repeat(100),
    '<template><p>' + 'template '.repeat(100),
  ])('does not turn a truncated non-content region into prose', tail => {
    const html = '<html><body>Example' + tail
    expect(extractResearchHtml(html).text).toBe('Example')
    expect(failure(html)).toBe('insufficient_content')
    expect(failure('<html><body>' + prose + tail)).toBeNull()
  })
  it('handles completed tags with quoted greater-than signs and entities', () => {
    expect(extractResearchHtml('<p data-value="a > b">Fish &amp; chips &#169; &#x1F41F; &lt;script&gt;</p>').text)
      .toBe('Fish & chips © 🐟 <script>')
  })
  it('excludes head, script, style and inert template text but preserves no-script content', () => {
    const html = '<html><head><title>Title &amp; co</title><style>CSS</style></head><body><script>payload</script><template>inert</template><noscript><p>Readable fallback</p></noscript><p>Body</p></body>'
    expect(extractResearchHtml(html)).toEqual({ title: 'Title & co', text: 'Readable fallback Body' })
  })
  it('preserves legitimate text before an incomplete closing tag', () => {
    expect(extractResearchHtml('<p>' + prose + '</p').text).toBe(prose)
  })
  it('does not qualify a 512 KiB attribute payload', () => {
    const html = '<html><body>Example<img src="' + 'x'.repeat(524288 - 30)
    expect(extractResearchHtml(html).text).toBe('Example')
    expect(failure(html)).toBe('insufficient_content')
  })
  it('keeps text and title diagnostics bounded without recursive tree walking', () => {
    const html = '<title>' + 't'.repeat(9000) + '</title><body>' + '<div>'.repeat(2000) + 'a'.repeat(60000)
    expect(extractResearchHtml(html).text).toHaveLength(50000)
    expect(extractResearchHtml(html).title).toHaveLength(8000)
  })
  it.each(['Enter Store using Password:', 'Enter store with password:', 'ENTER USING PASSWORD:'])('rejects only the complete password template: %s', prompt => {
    const text = prompt + ' ' + prompt + ' Example Shop This Store will be powered by shopify'
    expect(failure('<html><body>' + text)).toBe('unavailable_page')
    expect(failure('<html><body>' + prose + ' ' + text)).toBeNull()
    expect(failure('<html><body>' + text + ' ' + prose)).toBeNull()
  })
  it('retains useful business prose with ordinary account access and password instructions', () => {
    expect(failure('<html><body>' + prose + ' Enter using password: to access your account.')).toBeNull()
  })
})
