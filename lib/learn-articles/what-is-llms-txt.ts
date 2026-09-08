import type { LearnArticle } from '../learn-content'

export const whatIsLlmsTxt: LearnArticle = {
  slug: 'what-is-llms-txt',
  metaTitle: 'What Is llms.txt? Do You Actually Need One?',
  metaDescription:
    'llms.txt explained honestly: the spec, what Ahrefs and Google actually found, what AI agents really consume instead, and where the file belongs in your stack.',
  title: 'What is llms.txt, and do you actually need one in 2026?',
  dek: 'The honest answer is nuanced: llms.txt is a ten-minute, zero-risk addition with no evidence behind it, sitting inside an agent-readiness stack where other artifacts demonstrably matter more. Here is what the file is, what the data shows, and what to prioritize.',
  category: 'Agent readiness',
  publishedAt: '2026-07-13',
  updatedAt: '2026-09-07',
  readMinutes: 9,
  blocks: [
    {
      type: 'p',
      text: 'Ask ten SEO consultants whether your site needs an llms.txt file and you will start a fight. Proponents call it the robots.txt of the AI era. Skeptics point out that no major AI company has ever confirmed using it for anything. Both camps are partly right, and the honest answer fits in one sentence: llms.txt is a cheap, harmless addition that belongs near the bottom of your agent-readiness list, not at the top.',
    },
    {
      type: 'p',
      text: 'The stakes behind the question are real. Assistants now summarize, recommend, and in some categories phone a business on a customer’s behalf, so owners are right to ask what makes a website readable to them. The problem is that llms.txt got marketed as the whole answer while the artifacts agents demonstrably consume went ignored.',
    },
    {
      type: 'p',
      text: 'This guide covers what the file actually is, what the evidence says (with sources, because this topic is drowning in vendor claims), how to create one in ten minutes, and the priority order for everything that should come before it.',
    },
    { type: 'h2', text: 'What llms.txt actually is' },
    {
      type: 'p',
      text: 'llms.txt is a plain markdown file served at the root of your domain, so it resolves at yoursite.com/llms.txt. It was proposed in September 2024 by Jeremy Howard, co-founder of Answer.AI, and the spec lives at [llmstxt.org](https://llmstxt.org). The pitch: language models have limited context windows, and a typical web page is mostly navigation, scripts, and boilerplate. A hand-curated markdown map lets a model skip the noise and load only what matters.',
    },
    {
      type: 'p',
      text: 'The format is deliberately simple. An H1 with the site name, a blockquote summary, then H2 sections containing annotated links to your canonical pages. For a physiotherapy clinic it might look like this:',
    },
    {
      type: 'code',
      language: 'markdown',
      content: `# Riverside Physio
> Sports physiotherapy clinic in Austin, TX. Initial assessments,
> follow-up treatments, and dry needling. Online booking available.

## Services
- [Initial Assessment](https://riversidephysio.com/assessment): 60 min, $140
- [Follow-up Treatment](https://riversidephysio.com/follow-up): 30 min, $85

## Policies
- [Cancellations](https://riversidephysio.com/policies): 24-hour notice required`,
    },
    {
      type: 'p',
      text: 'There is also a heavier sibling, llms-full.txt, which inlines the complete text of every page into one giant file instead of linking out. Documentation sites adopted the idea fastest: Mintlify generates both files automatically for the docs it hosts, and Anthropic publishes one for its own developer documentation. That docs-world adoption is the strongest real-world signal the format has.',
    },
    { type: 'h2', text: 'The case proponents make' },
    {
      type: 'p',
      text: 'The arguments for llms.txt are plausible on their face, which is why the file spread so fast:',
    },
    {
      type: 'ul',
      items: [
        'Token efficiency. An agent that fetches one curated markdown file spends far fewer tokens than one that crawls and strips twenty HTML pages.',
        'Narrative control. You decide what an AI reads first: your best pages, your current prices, your actual service area, instead of whatever a crawler happens to land on.',
        'Cheap insurance. It costs ten minutes and nothing can break. If agents start honoring it later, early adopters are already in place.',
        'Precedent. robots.txt and sitemap.xml both started as informal conventions before becoming universal. Maybe llms.txt follows the same path.',
      ],
    },
    {
      type: 'p',
      text: 'Every one of those claims describes what the file could do. The open question is whether anything on the consuming side actually honors it. That is where the evidence gets uncomfortable for the maximalists.',
    },
    { type: 'h2', text: 'What the evidence actually shows' },
    {
      type: 'p',
      text: 'Start with the strongest data point. Ahrefs studied sites with and without llms.txt and found no correlation with AI visibility or rankings. Sites that added the file did not get cited more often in AI answers, and their traffic from AI sources looked no different from sites without it.',
    },
    {
      type: 'p',
      text: 'Google has been unusually direct. Its guidance says llms.txt is not required and that Google’s systems do not use it; Gemini and AI Overviews work from ordinary Google crawling and indexing. Google’s John Mueller went further and publicly compared llms.txt to the keywords meta tag, the canonical example of a signal search engines learned to ignore because site owners could write anything they wanted into it.',
    },
    {
      type: 'p',
      text: 'OpenAI and Anthropic tell a similar story by omission. Both document a roster of crawlers and how each treats robots.txt, covered in the [crawler guide](/learn/which-ai-crawlers-to-allow), but neither lists llms.txt as an input to search, browsing, or shopping features. When ChatGPT surfaces products to buy, OpenAI’s own merchant documentation points to structured product feeds, not markdown manifests. There is a real irony in Anthropic publishing an llms.txt for its docs while never committing to read anyone else’s.',
    },
    {
      type: 'callout',
      tone: 'amber',
      title: 'Watch for the llms.txt sales pitch',
      text: 'A cottage industry now sells llms.txt generation as an "AI SEO" service, sometimes on a monthly subscription. The file is static text you can write in a text editor. If a vendor leads with llms.txt as the fix for AI visibility, ask what evidence they have that any agent reads it. If they charge recurring fees for it, walk. Free generators exist from several vendors, including [Nexez’s Agent-Ready Kit](/how-it-works), which produces it alongside the artifacts that matter more.',
    },
    {
      type: 'p',
      text: 'None of this makes the file useless. It costs ten minutes, it cannot hurt you, and some smaller agents and custom crawlers do fetch it opportunistically. The problem is opportunity cost: every hour spent perfecting llms.txt is an hour not spent on the artifacts with actual evidence behind them.',
    },
    { type: 'h2', text: 'What AI agents demonstrably consume' },
    {
      type: 'p',
      text: 'While llms.txt sits mostly unread, real agent traffic flows through a different set of artifacts. These are the ones with documented, verifiable consumption today:',
    },
    {
      type: 'p',
      text: 'Clean, crawlable HTML is the baseline. Every browsing agent and AI crawler parses your rendered pages, and content that only appears after JavaScript executes is invisible to many of them. Structured data comes next: [JSON-LD using schema.org vocabulary](https://developers.google.com/search/docs/appearance/structured-data/intro-structured-data) is documented by Google, parsed by Bing, and read by the answer engines, because it turns prose into typed facts (prices, hours, service areas, review scores) a machine can trust.',
    },
    {
      type: 'p',
      text: 'Then come the commerce-specific surfaces, and this is where an earlier version of this article was wrong. It said OpenAI revamped Instant Checkout in March 2026 toward discovery-first surfacing. OpenAI retired it, on March 4, 2026, and moved back to discovery in the assistant with the purchase completing on the merchant’s own site; [what happened to ChatGPT Instant Checkout](/learn/chatgpt-instant-checkout-retired) has the account. Merchant product feeds still drive ChatGPT’s shopping experience, so the feed work kept its value while the checkout surface it was sold alongside disappeared. Google’s UCP is the live agent-checkout rail on its side. And for agents that act rather than just read, machine-readable action surfaces (OpenAPI specs, agent.json files, MCP servers) let an agent check availability or complete a booking instead of just describing your business. If those acronyms are new, the [UCP vs ACP vs MCP explainer](/learn/ucp-vs-acp-vs-mcp) untangles which protocol does what.',
    },
    {
      type: 'table',
      headers: ['Artifact', 'What it gives an agent', 'Evidence it is consumed', 'Effort'],
      rows: [
        [
          'Server-rendered HTML',
          'Content parseable without executing JavaScript',
          'Strong: every crawler and browsing agent',
          'Varies by site',
        ],
        [
          'JSON-LD (schema.org)',
          'Typed facts: prices, hours, services, policies',
          'Strong: documented by Google and Bing',
          'Low',
        ],
        [
          'Product/offer feed (ACP, UCP)',
          'A structured catalog for shopping surfaces',
          'Strong: how ChatGPT surfaces products, and the route into UCP checkout',
          'Low to medium',
        ],
        [
          'OpenAPI + agent.json',
          'Documented endpoints an agent can call',
          'Emerging: custom agents and frameworks',
          'Low',
        ],
        [
          'MCP server',
          'Live tools: check availability, book, buy',
          'Strong and growing: apps in ChatGPT are built on it, and Claude ships a directory',
          'Medium',
        ],
        [
          'llms.txt',
          'A curated markdown map of the site',
          'Weak: no major provider documents using it',
          'Trivial',
        ],
      ],
    },
    {
      type: 'p',
      text: 'Notice the pattern. Everything with strong evidence is either structured (feeds, JSON-LD) or executable (APIs, MCP). llms.txt is neither; it is a suggestion, and suggestions only work when someone commits to reading them.',
    },
    {
      type: 'cta',
      title: 'Can agents actually read your site today?',
      text: 'The free Nexez scanner fetches your site the way an AI agent does and scores it across the checks that matter: crawlable HTML, structured data, agent artifacts, and yes, llms.txt. No signup, results in about a minute.',
      href: '/scan',
      label: 'Scan your site free',
    },
    { type: 'h2', text: 'How to create an llms.txt anyway' },
    {
      type: 'p',
      text: 'Since the cost is ten minutes and the downside is zero, there is no reason not to have one once the higher-priority work is done. The manual route:',
    },
    {
      type: 'ol',
      items: [
        'Open a text editor. Start with an H1 (# Your Business Name) and a two-sentence blockquote describing what you do, where, and for whom.',
        'Add one H2 section per topic (Services, Pricing, Policies, Contact) containing markdown links to your canonical pages, each with a one-line note.',
        'Keep it short. Curation is the entire point; pasting your sitemap into it defeats the purpose.',
        'Save it as llms.txt and upload it to your web root so it loads at yourdomain.com/llms.txt as plain text. No registration or submission step exists; being at that URL is the whole deployment.',
        'Put a review reminder on your calendar. A file quoting last year’s prices is worse than no file at all.',
      ],
    },
    {
      type: 'p',
      text: 'If you would rather not hand-write it, free generators exist from several SEO and docs vendors. Nexez’s Agent-Ready Kit takes a different angle: it generates llms.txt as one artifact in a bundle that also includes JSON-LD, an agent.json link, and redirect recipes for your own site, and the WordPress plugin injects the bundle automatically. The point is not the markdown file; it is that the file ships alongside the artifacts agents actually use.',
    },
    {
      type: 'callout',
      tone: 'ready',
      title: 'Three gotchas worth knowing',
      text: 'First, llms.txt is not access control: it grants and denies nothing, so keep managing crawler permissions in robots.txt. Second, make sure robots.txt does not accidentally block the file itself. Third, if your file lists prices or availability, treat it like any other published price list and keep it current, because a confidently wrong answer sourced from your own stale file is a bad look.',
    },
    { type: 'h2', text: 'The priority-ordered agent-readiness checklist' },
    {
      type: 'p',
      text: 'If you get one afternoon a month for this work, spend it in this order. Each step builds on the one before it.',
    },
    {
      type: 'ol',
      items: [
        'Make sure agents can fetch your pages at all. Server-render your content, keep critical information out of JavaScript-only rendering, and check that robots.txt is not blocking GPTBot, ClaudeBot, or Google-Extended unless you mean to.',
        'Add JSON-LD structured data for your business, services, and offers. This is the highest-leverage hour on the list: it is cheap, and the consumers are documented.',
        'Publish a structured catalog or feed if you sell anything or take bookings. Feeds are what shopping surfaces read to surface you at all, which is now the whole prize on the OpenAI side since there is no in-chat checkout left to enroll in; the [ACP enrollment guide](/learn/acp-enrollment-guide) covers where the protocol still applies.',
        'Expose actions, not just facts. An OpenAPI spec or MCP server lets an agent move from "here is a physio clinic" to "I booked your Tuesday 3pm." For service businesses this is where [AI booking becomes real revenue](/learn/ai-agents-book-service-businesses) rather than a demo.',
        'Then add llms.txt. At this point it costs nothing, and there is a nonzero chance some agent someday reads it.',
      ],
    },
    {
      type: 'p',
      text: 'Steps one through four are exactly the stack Nexez publishes for a business automatically: structured listings served as clean HTML plus JSON-LD, agent.json, llms.txt, an OpenAPI spec, and a per-merchant MCP server, with ACP and UCP feeds for the shopping surfaces. Discovery artifacts are included [on every plan](/pricing).',
    },
    { type: 'h2', text: 'So, do you actually need one in 2026?' },
    {
      type: 'p',
      text: 'Need? No. Nothing measurable happens when you add llms.txt today, and both the biggest study and the biggest search company say so plainly. Anyone telling you otherwise is selling something.',
    },
    {
      type: 'p',
      text: 'Should you have one? Sure, once the real work is done. It is the cheapest line item in the agent-readiness stack, and the format could still win adoption the way sitemap.xml eventually did. Just be honest with yourself about which artifact earns the next hour of your time. In 2026, that hour belongs to structured data, feeds, and callable endpoints, in that order, with llms.txt riding along for free.',
    },
    {
      type: 'cta',
      title: 'Skip the checklist, ship the stack',
      text: 'Nexez turns your existing website into agent-legible, agent-transactable listings: JSON-LD, llms.txt, agent.json, OpenAPI, MCP, and ACP/UCP feeds from one setup, with real Stripe checkout and Calendly-backed scheduling behind them. Start on Free with no card; paid plans include a 7-day trial.',
      href: '/how-it-works',
      label: 'See how it works',
    },
  ],
  faqs: [
    {
      question: 'Does llms.txt improve SEO or AI rankings?',
      answer:
        'There is no evidence that it does. Ahrefs studied sites with and without the file and found no correlation with AI visibility, and Google’s guidance states that llms.txt is not required and its systems do not use it. Treat the file as a low-cost extra, not a ranking play.',
    },
    {
      question: 'Where do I put an llms.txt file?',
      answer:
        'At the root of your domain, so it loads at yourdomain.com/llms.txt as plain text. There is no registration, validation, or submission step anywhere; publishing it at that URL is the entire deployment. Verify it by opening the URL in a browser.',
    },
    {
      question: 'What is the difference between llms.txt and robots.txt?',
      answer:
        'robots.txt is access control: it tells crawlers what they may and may not fetch, and the major AI crawlers document that they obey it. llms.txt is a content suggestion: a curated reading list that no major provider has committed to consuming. One is enforced etiquette, the other is an open offer.',
    },
    {
      question: 'Do ChatGPT, Claude, or Gemini actually read llms.txt?',
      answer:
        'None of the three companies documents llms.txt as an input to its products. OpenAI’s shopping surfaces work from merchant product feeds, and Google says its systems, including Gemini and AI Overviews, rely on standard crawling instead. Some smaller agents and custom crawlers do fetch the file opportunistically, which is part of why it is worth ten minutes but not more.',
    },
    {
      question: 'What is llms-full.txt?',
      answer:
        'A companion variant that inlines the complete text of every page into a single markdown file, rather than linking out the way llms.txt does. Documentation platforms use it so a model can ingest an entire docs site in one fetch. For a typical business website it is overkill and can grow unwieldy fast.',
    },
    {
      question: 'If I only do one thing for AI agents, what should it be?',
      answer:
        'Confirm your pages are crawlable and then add JSON-LD structured data, because those are the two artifacts with documented consumers and the lowest effort. The fastest way to find your specific gaps is a [free agent-legibility scan](/scan), which shows what an agent can and cannot read on your site right now.',
    },
  ],
}
