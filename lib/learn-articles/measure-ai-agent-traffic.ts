import type { LearnArticle } from '../learn-content'

export const measureAiAgentTraffic: LearnArticle = {
  slug: 'measure-ai-agent-traffic',
  metaTitle: 'How to Measure AI Agent Traffic',
  metaDescription:
    'Your analytics cannot see AI crawlers, under-counts AI referrals, and misses agent purchases entirely. Here is how to measure all three layers properly.',
  title: 'How to measure AI agent traffic (when your analytics cannot see it)',
  dek: 'Google Analytics reports zero AI crawler visits no matter how many you get, because crawlers do not run JavaScript. That is one of three separate blind spots, each needing a different instrument. Here is the full measurement stack, with the user agents, the queries, and the verification step most guides skip.',
  category: 'Agent readiness',
  publishedAt: '2026-08-16',
  updatedAt: '2026-09-19',
  readMinutes: 11,
  blocks: [
    {
      type: 'p',
      text: 'If you open Google Analytics looking for AI crawler traffic, you will find none, and that tells you nothing about whether you have any. JavaScript-based analytics work by running a script in a browser; crawlers do not execute JavaScript, so they never fire the tag. Your site can be fetched thousands of times a month by GPTBot, ClaudeBot, and PerplexityBot while every dashboard you own reports a clean zero. The traffic is real and it is in your server logs, which is a place most marketing teams have never looked.',
    },
    {
      type: 'p',
      text: 'That is only the first blind spot. AI activity actually reaches your business through three separate layers, and each is invisible to a different tool: crawler fetches (visible only in server logs), referral visits from AI interfaces (visible in analytics, but under-attributed), and agent-completed transactions (visible only in your order data, since they generate no session at all). Measuring one and calling it done is how businesses conclude the channel is small while it quietly compounds.',
    },
    {
      type: 'p',
      text: 'This guide covers all three layers: what to look for, how to query it, which user agents matter and what each one actually does, how to verify a bot is who it claims to be, and what to change once you can finally see the numbers.',
    },
    { type: 'h2', text: 'The three layers, and what sees each one' },
    {
      type: 'table',
      headers: ['Layer', 'What it is', 'Where it shows up', 'What misses it'],
      rows: [
        ['Crawler fetches', 'AI bots retrieving your pages for training, indexing, or live answers', 'Server or CDN access logs', 'All JavaScript analytics'],
        ['Referral visits', 'Humans arriving after an AI recommended you', 'Analytics referrer reports', 'Under-counted; some arrive with no referrer'],
        ['Agent transactions', 'Purchases or bookings completed by an agent through a protocol or API', 'Order and checkout data', 'Analytics entirely; no pageview exists'],
      ],
    },
    {
      type: 'p',
      text: 'The third row is the one that surprises commerce teams. When a sale completes through a protocol like UCP or ACP, there is no visit, no session, and no event on your site; revenue simply appears with no traffic behind it. The [Google UCP guide](/learn/what-is-google-ucp) covers that mechanic in detail. The practical consequence is that agentic revenue must be instrumented at the order layer or it does not get counted at all.',
    },
    { type: 'h2', text: 'Layer one: reading crawler traffic in your logs' },
    {
      type: 'p',
      text: 'Server logs are the only reliable source here. If you are on a CDN, use its logs (Cloudflare, Fastly, CloudFront) since they see requests your origin may never receive from cache. The basic move is to grep access logs for known AI user agents and count them:',
    },
    {
      type: 'code',
      language: 'bash',
      content: `# Count AI crawler hits by bot, most active first
grep -oiE 'GPTBot|OAI-SearchBot|ChatGPT-User|ClaudeBot|Claude-User|Claude-SearchBot|PerplexityBot|Perplexity-User|Google-Extended|Bytespider|CCBot|Amazonbot|Applebot|meta-externalagent|DuckAssistBot|MistralAI-User' access.log \\
  | sort | uniq -c | sort -rn

# Which pages one specific bot fetches most
grep -i 'GPTBot' access.log | awk '{print $7}' | sort | uniq -c | sort -rn | head -20

# Status codes served to AI crawlers (looking for 403s, 404s, and 5xx)
grep -iE 'GPTBot|ClaudeBot|PerplexityBot' access.log | awk '{print $9}' | sort | uniq -c`,
    },
    {
      type: 'p',
      text: 'That third query is the one worth running first, because it is where problems hide. Crawlers receiving 403s are being blocked by a firewall or bot rule you may not know exists; crawlers receiving 404s are following stale links; crawlers receiving 200s but on pages that render empty without JavaScript are getting nothing useful. Any of those quietly removes you from AI answers while looking fine to human visitors.',
    },
    { type: 'h2', text: 'Which bots are which (and why the distinction matters)' },
    {
      type: 'p',
      text: 'Every major provider now runs several crawlers with different jobs, and conflating them leads to genuinely bad decisions. Blocking a training crawler is a defensible content-rights choice. Blocking a search or user-triggered crawler removes you from AI citations and answers, which is usually the opposite of what a business wants.',
    },
    {
      type: 'table',
      headers: ['User agent', 'Operator', 'Purpose', 'Blocking it means'],
      rows: [
        ['GPTBot', 'OpenAI', 'Model training crawl', 'Excluded from future training data'],
        ['OAI-SearchBot', 'OpenAI', 'ChatGPT search index', 'Not eligible for ChatGPT search citations'],
        ['ChatGPT-User', 'OpenAI', 'Fetches a page when a user asks about it', 'ChatGPT cannot read your page on request'],
        ['ClaudeBot', 'Anthropic', 'Primary crawl', 'Excluded from Claude’s crawled corpus'],
        ['Claude-SearchBot / Claude-User', 'Anthropic', 'Retrieval and user-triggered fetch', 'Claude cannot cite or fetch you live'],
        ['PerplexityBot / Perplexity-User', 'Perplexity', 'Index build and real-time retrieval', 'Removed from Perplexity answers'],
        ['Google-Extended', 'Google', 'Controls Gemini and Vertex AI training', 'Excluded from Gemini training, Search ranking unaffected'],
        ['CCBot', 'Common Crawl', 'Open dataset used by many models', 'Excluded from a widely reused corpus'],
      ],
    },
    {
      type: 'p',
      text: 'For scale context: Cloudflare reported AI crawlers generating more than 50 billion requests per day across its network as of March 2025, just under 1% of all requests it saw.',
    },
    {
      type: 'p',
      text: 'By January 2026 its comparison of crawl breadth found Googlebot still reaching far more unique URLs than any AI crawler, roughly 1.76 times more than GPTBot and 167 times more than PerplexityBot, so AI crawl volume is meaningful but nowhere near search-scale yet.',
    },
    {
      type: 'p',
      text: 'Growth is the real signal: ClaudeBot approximately doubled its crawl rate between Q3 2025 and Q1 2026 on monitored sites, and AI search visits overall grew about 42.8% year over year, from 15.6 billion to 27.4 billion between Q1 2025 and Q1 2026.',
    },
    {
      type: 'callout',
      tone: 'amber',
      title: 'User agents can be forged',
      text: 'Anyone can send a request claiming to be GPTBot, and scrapers do exactly that to inherit whatever access you grant real crawlers. Before you trust a number or write a firewall rule around it, verify: each major provider publishes IP ranges for its crawlers, and reverse DNS lookups on the source IP should resolve to the provider’s domain and forward-resolve back to the same IP. Unverified user-agent strings are a signal, not proof. Note too that some crawlers, including Bytespider and certain Perplexity fetchers, have been documented ignoring robots.txt, so robots directives alone are not enforcement.',
    },
    { type: 'h2', text: 'Layer two: AI referral traffic' },
    {
      type: 'p',
      text: 'This layer does show up in analytics, because it is a human in a browser. Segment referrers for chatgpt.com, perplexity.ai, claude.ai, gemini.google.com, and copilot.microsoft.com, and treat the group as its own acquisition channel. Concentration is heavy: roughly 87% of AI referral traffic originates from ChatGPT, so a single-source segment gets you most of the picture, though Gemini referrals grew several hundred percent through late 2025 and deserve their own line.',
    },
    {
      type: 'code',
      language: 'javascript',
      content: `// Classify AI referrers into a single channel dimension
const AI_SOURCES = {
  'chatgpt.com': 'ChatGPT',
  'chat.openai.com': 'ChatGPT',
  'perplexity.ai': 'Perplexity',
  'claude.ai': 'Claude',
  'gemini.google.com': 'Gemini',
  'copilot.microsoft.com': 'Copilot',
}

function aiChannel(referrer) {
  if (!referrer) return null
  try {
    const host = new URL(referrer).hostname.replace(/^www\\./, '')
    return AI_SOURCES[host] || null
  } catch {
    return null
  }
}`,
    },
    {
      type: 'p',
      text: 'Two honest caveats. First, this under-counts: someone who reads an AI recommendation and then types your name into a browser arrives as direct traffic, and no attribution model recovers that. Second, judge this segment on quality rather than volume, because AI referrals arrive pre-recommended and Adobe Analytics measured them converting roughly 42% better than traditional search traffic. A small, high-converting segment growing steadily is the shape to expect.',
    },
    { type: 'h2', text: 'Layer three: agent transactions' },
    {
      type: 'p',
      text: 'Instrument this in your commerce backend, not your analytics. Practical approach: stamp every order with its origin at creation time, so agent-initiated checkouts carry a durable flag through to your reporting. If you expose an API or agent endpoints, require or encourage a client identifier on requests and record it with the order. Protocol-originated orders (UCP, ACP) should be tagged distinctly from your own API traffic, since they come from different surfaces and deserve separate lines in reporting.',
    },
    {
      type: 'p',
      text: 'The reason to do this before the volume justifies it is simple: you cannot reconstruct attribution retroactively. Teams that wait until agent revenue is obviously material then spend a quarter unable to say where any of it came from or which surfaces are working.',
    },
    {
      type: 'cta',
      title: 'Find out what agents can see before you measure them',
      text: 'Measurement only matters if agents can actually read you. The free Nexez scanner fetches your site the way an AI crawler does and scores crawler access, server-rendered content, structured data, and callable actions. No signup, about a minute.',
      href: '/scan',
      label: 'Scan your site free',
    },
    { type: 'h2', text: 'What Google now reports directly' },
    {
      type: 'p',
      text: 'The three layers above are all instruments you install yourself, which was for a long time the only option, because the platforms reported nothing. That changed in September 2026, when Google added AI Performance Insights to Merchant Center: a share-of-voice comparison against competitors across AI Mode and AI Overviews, available at launch in the United States, Canada, Australia, New Zealand and India.',
    },
    {
      type: 'p',
      text: 'Treat it as a fourth instrument rather than a replacement for the other three, because it answers a different question. Your logs tell you who fetched your pages. Your referral segment tells you who arrived. Share of voice tells you how often you were the answer at all, including every time you were mentioned and nobody clicked, which is the measurement gap this whole guide exists to work around. It is also the only one of the four you cannot audit, since the number is Google reporting on Google.',
    },
    { type: 'h2', text: 'What to do with the numbers' },
    {
      type: 'p',
      text: 'Measurement is only worth the setup if it changes decisions. The four that usually follow from a first honest look:',
    },
    {
      type: 'ol',
      items: [
        'Fix access errors first. Any 403s or 404s served to legitimate AI crawlers are pure lost visibility, and they are usually a CDN bot rule nobody remembered enabling.',
        'Compare crawl coverage against your sitemap. Pages crawlers never fetch cannot be cited; if your most valuable pages are missing from crawler logs, that is an internal linking or discoverability problem.',
        'Watch crawl frequency on updated pages. Answer engines weight freshness heavily, so a page you refreshed that has not been re-crawled will keep getting cited with its old content.',
        'Correlate the layers. Rising crawler activity with flat referrals suggests you are being read but not recommended, which is a [content and structure problem](/learn/generative-engine-optimization). Rising referrals with flat agent transactions suggests you are recommended but not transactable, which is a [callable-actions problem](/learn/what-is-an-mcp-server).',
      ],
    },
    {
      type: 'p',
      text: 'That last point is the reason to instrument all three layers rather than whichever one is easiest. Each pair of adjacent layers has a specific failure mode between them, and the diagnosis only appears when you can see both sides. A business that measures nothing here is not neutral about the channel; it has decided, by default, that it will find out how big it got only in hindsight.',
    },
    {
      type: 'cta',
      title: 'Make yourself readable, callable, and countable',
      text: 'Nexez publishes your business as agent-legible, agent-transactable listings (JSON-LD, llms.txt, agent.json, OpenAPI, a per-merchant MCP server, and ACP/UCP feeds) with agent visits and checkout events tracked as first-class data. Start on Free with no card; paid plans include a 7-day trial.',
      href: '/how-it-works',
      label: 'See how it works',
    },
  ],
  faqs: [
    {
      question: 'Why does Google Analytics show no AI crawler traffic?',
      answer:
        'Because JavaScript analytics only record visitors whose browser executes the tracking script, and crawlers do not run JavaScript. GPTBot, ClaudeBot, PerplexityBot, and the rest fetch your HTML and leave, so they never fire the tag. The traffic exists and is recorded in your server or CDN access logs, which is the only reliable place to measure it.',
    },
    {
      question: 'How do I tell AI crawlers apart in my server logs?',
      answer:
        'Match on the user-agent string. The main ones are GPTBot, OAI-SearchBot, and ChatGPT-User (OpenAI), ClaudeBot, Claude-SearchBot, and Claude-User (Anthropic), PerplexityBot and Perplexity-User (Perplexity), Google-Extended (Gemini and Vertex training), plus CCBot, Amazonbot, Applebot, and meta-externalagent. A single grep across those strings, counted and sorted, gives you a per-bot picture in one command.',
    },
    {
      question: 'What is the difference between GPTBot and ChatGPT-User?',
      answer:
        'GPTBot is OpenAI’s training crawler, collecting content that may inform future models. ChatGPT-User fetches a specific page on demand when someone inside ChatGPT asks about it, and OAI-SearchBot powers ChatGPT’s search index and citations. The distinction matters: blocking GPTBot is a content-rights decision with no direct effect on today’s citations, while blocking the other two removes you from ChatGPT answers about your business.',
    },
    {
      question: 'Can AI crawler traffic be faked?',
      answer:
        'Yes. User-agent strings are trivially forged, and scrapers impersonate known crawlers to inherit whatever access those crawlers are granted. Verify before trusting the data or building rules on it: the major providers publish IP ranges for their crawlers, and a reverse DNS lookup on the source IP should resolve to the provider’s domain and forward-resolve back to the same address. Some crawlers also ignore robots.txt entirely, so enforcement belongs at the server or WAF level.',
    },
    {
      question: 'How do I track sales that AI agents complete?',
      answer:
        'In your order data, not your analytics. Protocol-completed transactions generate no pageview or session on your site, so tag orders with their origin at creation, record any agent or client identifier sent with the request, and report protocol-originated orders (UCP, ACP) separately from your own API traffic. Set this up before the volume looks meaningful, since origin cannot be reconstructed after the fact.',
    },
    {
      question: 'Is AI crawler traffic large enough to bother measuring?',
      answer:
        'It is meaningful and growing fast, though still well below search-crawl scale. Cloudflare observed AI crawlers making over 50 billion requests per day across its network as of March 2025, just under 1% of all requests, and by January 2026 Googlebot still reached roughly 1.76 times more unique URLs than GPTBot. The trend is the argument: ClaudeBot roughly doubled its crawl rate in two quarters, and AI search visits grew about 42.8% year over year. Measuring now costs one afternoon and gives you a baseline you cannot recreate later.',
    },
  ],
}
