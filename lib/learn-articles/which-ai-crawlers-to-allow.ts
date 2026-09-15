import type { LearnArticle } from '../learn-content'

export const whichAiCrawlersToAllow: LearnArticle = {
  slug: 'which-ai-crawlers-to-allow',
  metaTitle: 'Which AI Crawlers Should You Allow?',
  metaDescription:
    'Search, Agent and Training bots do different jobs. The allow-or-block call for each, the Cloudflare default landing September 15, and the traps.',
  title: 'Which AI crawlers should you allow? The robots.txt decision most sites make by accident',
  dek: 'The publisher version of this question is about compensation. The small-business version is much simpler, and the risk runs the other way: almost every site that is invisible to AI agents got that way without ever deciding to be. Here is the decision, bot by bot, plus the three blocks people set without realizing.',
  category: 'Agent readiness',
  publishedAt: '2026-08-21',
  updatedAt: '2026-09-15',
  readMinutes: 11,
  blocks: [
    {
      type: 'p',
      text: 'Most writing about AI crawlers is written for publishers, and publishers have a genuine grievance: their product is the content, and a model that ingests it and answers on their behalf takes the visit with it. That fight is real, it is why pay-per-crawl marketplaces exist, and none of it describes your situation if you run a clinic, a bakery, or a plumbing company.',
    },
    {
      type: 'p',
      text: 'For a business that wants customers, content is the advertisement, not the product. An agent reading your prices and hours and then telling a buyer to come to you is the outcome you want. The failure mode is not being read too much. It is being unreadable, and in our [scan of 652 small-business websites](/learn/agent-readiness-study-2026) almost a third of sites offered agents nothing machine-readable at all. A meaningful slice of that was not a choice anyone made. It was a default.',
    },
    {
      type: 'p',
      text: 'One of those defaults changes on September 15, 2026, which is a good excuse to do this properly.',
    },
    { type: 'h2', text: 'There is no such thing as "AI crawlers"' },
    {
      type: 'p',
      text: 'The single biggest reason people get this wrong is treating one label as one decision. At least three different jobs hide under it, and a sensible business answers them differently. Cloudflare formalized the split in July 2026, and the categories are worth borrowing whatever your host is.',
    },
    {
      type: 'table',
      headers: ['Category', 'What it does', 'What blocking costs you', 'Sensible default'],
      rows: [
        [
          'Search',
          'Indexes your pages so an assistant can answer questions about you later',
          'You stop being a candidate answer in ChatGPT search, Perplexity, and similar',
          'Allow',
        ],
        [
          'Agent',
          'Fetches a page in real time because a person just asked something',
          'A live customer gets "I could not access that site" instead of your hours',
          'Allow',
        ],
        [
          'Training',
          'Collects text to train or fine-tune future models',
          'Little, for most businesses. Your prices change; a model snapshot does not',
          'Your call',
        ],
      ],
    },
    {
      type: 'p',
      text: 'Notice that the category people actually have feelings about, Training, is the one with the smallest practical stake for a local business. The two that decide whether a buyer hears about you at all are the two nobody thinks about.',
    },
    { type: 'h2', text: 'The roster, by who sends it' },
    {
      type: 'p',
      text: 'Every major provider now runs separate user agents for the separate jobs, which is what makes a considered answer possible. These are the tokens you write into robots.txt, taken from each company’s own documentation rather than from an aggregator blog.',
    },
    {
      type: 'table',
      headers: ['User agent', 'Operator', 'Job', 'Obeys robots.txt'],
      rows: [
        ['OAI-SearchBot', 'OpenAI', 'Search: powers ChatGPT search answers', 'Yes'],
        ['ChatGPT-User', 'OpenAI', 'Agent: fetches a page a user just asked about', 'May not apply'],
        ['GPTBot', 'OpenAI', 'Training', 'Yes'],
        ['Claude-SearchBot', 'Anthropic', 'Search: improves Claude search results', 'Yes'],
        ['Claude-User', 'Anthropic', 'Agent: retrieves pages for a user’s question', 'Yes'],
        ['ClaudeBot', 'Anthropic', 'Training', 'Yes'],
        ['PerplexityBot', 'Perplexity', 'Search: surfaces and links your site', 'Yes'],
        ['Perplexity-User', 'Perplexity', 'Agent: user-initiated visit', 'Generally ignores it'],
        ['Googlebot', 'Google', 'Search, and everything Google builds on Search', 'Yes'],
        ['Google-Extended', 'Google', 'Gemini training and grounding in Gemini apps', 'Yes'],
        ['Storebot-Google', 'Google', 'Shopping and the Shopping tab', 'Yes'],
      ],
    },
    {
      type: 'p',
      text: 'Two entries in that table deserve a second look, because they are where the accidents happen.',
    },
    {
      type: 'p',
      text: 'ChatGPT-User and Perplexity-User are not crawlers. They are a person, right now, asking about you, with an assistant doing the fetching. OpenAI notes that robots.txt may not apply to ChatGPT-User because the request is user-initiated, and Perplexity documents that Perplexity-User generally ignores robots.txt for the same reason. That is exactly why these get blocked at the firewall instead, and blocking them is the closest thing to hanging up on an inbound call that exists on the modern web.',
    },
    {
      type: 'callout',
      tone: 'amber',
      title: 'Google-Extended does not do what its name suggests',
      text: 'Blocking Google-Extended opts you out of Gemini model training and grounding inside Gemini apps. It does not remove you from AI Overviews or AI Mode. Google’s own documentation is explicit that robots.txt for Googlebot is the control for AI features in Search, which means the only way out of AI Overviews is leaving Google Search. Anyone who told you Google-Extended was the AI Overviews opt-out was guessing.',
    },
    { type: 'h2', text: 'What changes on September 15, 2026' },
    {
      type: 'p',
      text: 'On July 1, 2026, Cloudflare announced new defaults for AI traffic that take effect September 15. For every new domain onboarding to Cloudflare, Training and Agent bots are blocked by default on pages that display advertisements. Search bots stay allowed everywhere. Existing sites keep their current behavior and can set their preference in Security settings before the date.',
    },
    {
      type: 'p',
      text: 'Read the scope carefully, because the coverage around it has been loose. This is a default for new domains, on ad-bearing pages. If you are an established site that does not run ads, September 15 does nothing to you on its own. The reason to care anyway is the second half of Cloudflare’s note: a customer who chooses to block Training also blocks multi-purpose crawlers that combine training with search, and Cloudflare names Googlebot, Bingbot, and Applebot as examples.',
    },
    {
      type: 'p',
      text: 'That is the trap in one line. The control is labeled Training. The blast radius includes Google Search. A three-click decision made on principle can quietly cost you the channel that still sends most of your traffic.',
    },
    {
      type: 'callout',
      tone: 'signal',
      title: 'Ten minutes worth spending before mid-September',
      text: 'Open your CDN or host’s bot settings and read what is already switched on, especially anything named bot fight mode, super bot fight mode, or AI scraping protection. These are frequently enabled during setup by someone who is no longer at the company, and they operate above robots.txt: a welcoming robots.txt file cannot un-block a request the edge already refused.',
    },
    { type: 'h2', text: 'The robots.txt a local business should actually publish' },
    {
      type: 'p',
      text: 'For the overwhelming majority of businesses selling a product or a service, the correct file is short and permissive, with the AI agents named explicitly rather than left to a wildcard. Naming them costs nothing and removes the ambiguity that gets you dropped by a cautious parser.',
    },
    {
      type: 'code',
      language: 'text',
      content: `User-agent: *
Allow: /

# Search and agent traffic: these decide whether a buyer hears about you
User-agent: OAI-SearchBot
User-agent: ChatGPT-User
User-agent: Claude-SearchBot
User-agent: Claude-User
User-agent: PerplexityBot
User-agent: Perplexity-User
User-agent: Googlebot
User-agent: Storebot-Google
Allow: /

# Training: allow, or drop these three lines if you would rather not
User-agent: GPTBot
User-agent: ClaudeBot
User-agent: Google-Extended
Allow: /

Sitemap: https://yourdomain.com/sitemap.xml`,
    },
    {
      type: 'p',
      text: 'This is close to what Nexez publishes for itself, for the obvious reason that a company promising to make businesses legible to agents would look silly blocking them. If you want to see the pattern in the wild, fetch the robots.txt of any site you admire and compare.',
    },
    {
      type: 'p',
      text: 'Three rules that matter more than the file’s contents. Serve it from the root of every subdomain you use, because robots.txt does not inherit. Keep any path you want quoted out of the disallow list, since a blocked page cannot be cited. And do not disallow your own sitemap, feed, or structured-data endpoints, which is a surprisingly common own goal.',
    },
    {
      type: 'cta',
      title: 'Find out what agents can actually reach',
      text: 'The free Nexez scanner fetches your site the way an AI agent does and reports what came back: whether your pages render without JavaScript, whether your robots.txt or edge rules turned it away, and what structured data it could read. About a minute, no signup.',
      href: '/scan',
      label: 'Scan your site free',
    },
    { type: 'h2', text: 'When blocking is the right answer' },
    {
      type: 'p',
      text: 'This guide argues for allowing, and the argument does not generalize to everyone. Blocking Training crawlers is reasonable and sometimes correct when your content is the thing being sold rather than the thing selling something else.',
    },
    {
      type: 'ul',
      items: [
        'Publishers, research shops, and anyone whose archive is the product. A model that absorbs the archive competes with the archive.',
        'Proprietary datasets, original photography, and licensed material where the license terms genuinely constrain redistribution.',
        'Sites with a real compensation path available. Cloudflare’s pay-per-crawl marketplace, and the pay-per-use successor it announced in July 2026, only pay you if the free door is closed first.',
        'Anywhere the crawl load itself is a cost problem, though rate limiting is usually the better instrument than an outright block.',
      ],
    },
    {
      type: 'p',
      text: 'Even in those cases, keep the Search and Agent categories open unless you have decided you do not want to be found. Blocking Training while staying discoverable is a coherent position. Blocking everything is a decision to exit the channel.',
    },
    { type: 'h2', text: 'robots.txt is a request, not a lock' },
    {
      type: 'p',
      text: 'Whichever way you decide, be clear about what the file is. robots.txt is a published preference that well-behaved operators honor voluntarily. The named crawlers from OpenAI, Anthropic, Google, and Perplexity do honor it, which is what makes it useful. Nothing enforces it, and anyone can send a request claiming to be GPTBot.',
    },
    {
      type: 'p',
      text: 'That cuts both ways, and the practical consequence is the same in either direction: never make a decision based on the user agent string alone. If you are blocking, a string match blocks the honest bots and misses the dishonest ones. If you are allowlisting, a string match hands your allowlist to anyone who can type. OpenAI and Perplexity publish JSON files of their crawler IP ranges for exactly this reason, and Anthropic now publishes ranges too. Verify against those, or against reverse DNS, and treat the string as a hint.',
    },
    {
      type: 'p',
      text: 'Where this is heading is cryptographic rather than textual, and it arrived faster than expected. Signed requests now carry proof of origin that no string can forge, OpenAI publishes no IP ranges for its agent at all, and the verification work has moved to the edge. If you are writing access rules today, read [how to verify an AI agent](/learn/how-to-verify-ai-agents) before you invest further in matching strings.',
    },
    { type: 'h2', text: 'Then measure it, because the answer changes' },
    {
      type: 'p',
      text: 'A robots.txt decision made once and never revisited is how sites end up blocking a crawler that was renamed two years ago while missing three that launched last quarter. The roster in this article will be out of date; the discipline of checking will not be.',
    },
    {
      type: 'p',
      text: 'The check is a log query, not an analytics dashboard, because AI crawlers do not execute JavaScript and Google Analytics therefore reports zero of them no matter how many arrive.',
    },
    {
      type: 'p',
      text: '[Measuring AI agent traffic](/learn/measure-ai-agent-traffic) covers the full instrument set, but the ninety-second version is: grep your server or CDN logs for the user agents in the table above, and look at the response codes rather than the hit count.',
    },
    {
      type: 'p',
      text: 'A wall of 403s means something in your stack is answering the door and slamming it, and that is worth knowing before you spend another afternoon on structured data nobody is allowed to fetch.',
    },
    {
      type: 'p',
      text: 'Once the door is open, the work that follows is about being worth reading: [JSON-LD that states your facts in a typed form](/learn/json-ld-for-ai-agents), a feed if you sell anything, and eventually an endpoint an agent can act on rather than just quote. Access is only the precondition. It is a precondition an unsettling number of sites fail.',
    },
    {
      type: 'cta',
      title: 'Be readable, then be transactable',
      text: 'Nexez publishes your business as agent-legible listings: clean HTML with JSON-LD, agent.json, llms.txt, an OpenAPI spec, and a per-merchant MCP server, with real checkout and scheduling behind them. Start on Free with no card.',
      href: '/how-it-works',
      label: 'See how it works',
    },
  ],
  faqs: [
    {
      question: 'Should a small business block AI crawlers?',
      answer:
        'Usually not. If your content exists to bring you customers rather than to be sold directly, an agent reading your prices and hours and recommending you is the outcome you want. Blocking Training crawlers is defensible if you feel strongly about model training, but keep the search and agent user agents allowed, because those are the ones that decide whether a buyer ever hears your name.',
    },
    {
      question: 'Does blocking Google-Extended remove me from AI Overviews?',
      answer:
        'No. Google-Extended governs Gemini model training and grounding in Gemini apps. AI Overviews and AI Mode are part of Google Search and follow your Googlebot rules, so the only way out is leaving Search entirely. You can limit what is shown with nosnippet, max-snippet, or data-nosnippet, which restrict the snippet rather than the inclusion.',
    },
    {
      question: 'What is Cloudflare changing on September 15, 2026?',
      answer:
        'New domains onboarding to Cloudflare get Training and Agent bots blocked by default on pages that display advertisements, while Search bots stay allowed. Existing sites are unchanged and can set their preference in Security settings beforehand. The detail that catches people out is that choosing to block Training also blocks multi-purpose crawlers such as Googlebot, Bingbot, and Applebot.',
    },
    {
      question: 'What is the difference between GPTBot and ChatGPT-User?',
      answer:
        'GPTBot crawls the open web to gather training data for OpenAI’s models. ChatGPT-User fetches a specific page because a person in ChatGPT just asked about it, so it is closer to a visitor than a crawler, and OpenAI notes that robots.txt may not apply to it for that reason. Blocking GPTBot is a position on model training; blocking ChatGPT-User turns away a live prospect.',
    },
    {
      question: 'Why do my logs show AI crawlers getting 403 errors?',
      answer:
        'Almost always an edge rule rather than robots.txt. Managed bot protection, WAF rules, or a bot fight mode toggle enabled during setup will reject requests before robots.txt is ever consulted, so a permissive file cannot rescue them. Check your CDN or host’s bot settings first, then the origin firewall, then rate limits.',
    },
    {
      question: 'Can I get paid instead of blocking?',
      answer:
        'There are marketplaces for it, including Cloudflare’s pay-per-crawl and the pay-per-use model it announced in July 2026, but the economics only work at publisher scale, where the archive itself is the product. For a business whose website exists to win customers, the value of being cited in an answer is worth more than any per-crawl fee you would collect.',
    },
    {
      question: 'How often should I revisit this?',
      answer:
        'Twice a year, or whenever a major assistant launches, whichever comes first. New user agents appear regularly and old ones get renamed or split, so a file written in 2024 is likely silent about half the crawlers now reaching you. Reviewing your logs is faster than reviewing the file, because the logs tell you who is actually knocking.',
    },
  ],
}
