import type { LearnArticle } from '../learn-content'

export const jsonLdForAiAgents: LearnArticle = {
  slug: 'json-ld-for-ai-agents',
  metaTitle: 'JSON-LD for AI Agents: Schema That Works',
  metaDescription:
    'The practical JSON-LD guide for AI visibility: the schema types agents actually use, copy-paste templates, implementation rules, and mistakes to avoid.',
  title: 'JSON-LD for AI agents: the schema markup that actually gets read',
  dek: 'JSON-LD is the highest-leverage hour in the entire agent-readiness stack: typed, machine-verifiable facts about your business embedded in your pages. This is the practical version, with copy-paste templates for the types that matter, the implementation rules that keep them trusted, and the mistakes that get markup ignored.',
  category: 'Agent readiness',
  publishedAt: '2026-08-10',
  updatedAt: '2026-09-07',
  readMinutes: 10,
  blocks: [
    {
      type: 'p',
      text: 'JSON-LD is a block of structured data embedded in a script tag on your page, describing your business in the shared schema.org vocabulary: what you are, what you sell, at what price, when you are open, what customers say. Humans never see it; machines read it first.',
    },
    {
      type: 'p',
      text: 'For AI agents and answer engines it converts your website from prose they must interpret into typed facts they can assert, and that difference shows up in results: industry studies have consistently found pages with structured data cited around three times more often in AI answers, and it is the artifact with the best-documented consumers in the whole readiness stack.',
    },
    {
      type: 'p',
      text: 'The consumers are not hypothetical. Google documents structured data as an input across its surfaces and leaned on the same fundamentals in its 2026 guidance for generative features, Bing parses it, the answer engines ground facts in it, and shopping pipelines cross-check it against product feeds. When an assistant states your price or your Saturday hours in an answer, structured data is the reason it can say so confidently instead of hedging.',
    },
    {
      type: 'p',
      text: 'This guide is the practical version: the format, the four types that cover most businesses (with templates to adapt), the implementation rules that keep markup trusted, validation, and the mistakes that get it ignored. For where this sits in the bigger picture, see the [generative engine optimization guide](/learn/generative-engine-optimization) for the citation side and [agentic commerce](/learn/what-is-agentic-commerce) for the transaction side.',
    },
    { type: 'h2', text: 'Why JSON-LD and not the other formats' },
    {
      type: 'p',
      text: 'Schema.org data can also be written as microdata or RDFa, woven attribute by attribute into your HTML. Do not. JSON-LD is Google’s recommended format for a reason: it lives in one self-contained block, so it is easy to generate from a template, easy to validate, and impossible to break by restyling your page. Every template below is JSON-LD inside a script tag with type application/ld+json, placed anywhere in the page (head is conventional).',
    },
    { type: 'h2', text: 'The four types that cover most businesses' },
    {
      type: 'p',
      text: 'Schema.org defines hundreds of types; agents care about a handful. Ship these four well before touching anything exotic.',
    },
    {
      type: 'table',
      headers: ['Type', 'What an agent gets from it', 'Who needs it'],
      rows: [
        ['LocalBusiness / Organization', 'Identity: who you are, where, when open, how to reach you', 'Everyone'],
        ['Service + Offer', 'What you do and what it costs, as typed facts', 'Service businesses'],
        ['Product + Offer', 'Catalog data: price, availability, customer ratings', 'Anyone selling products'],
        ['FAQPage', 'Your canonical answers to common questions', 'Everyone with a questions page'],
      ],
    },
    { type: 'h3', text: '1. LocalBusiness: your identity block' },
    {
      type: 'p',
      text: 'The foundation. Use the most specific subtype that fits (Physiotherapy, Restaurant, Plumber, LegalService); specificity is free relevance for category queries. Adapt this:',
    },
    {
      type: 'code',
      language: 'html',
      content: `<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "Physiotherapy",
  "name": "Riverside Physio",
  "url": "https://riversidephysio.com",
  "telephone": "+1-512-555-0142",
  "address": {
    "@type": "PostalAddress",
    "streetAddress": "412 Riverside Dr",
    "addressLocality": "Austin",
    "addressRegion": "TX",
    "postalCode": "78704",
    "addressCountry": "US"
  },
  "openingHoursSpecification": [{
    "@type": "OpeningHoursSpecification",
    "dayOfWeek": ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"],
    "opens": "08:00",
    "closes": "18:00"
  }],
  "areaServed": "Austin, TX",
  "priceRange": "$$"
}
</script>`,
    },
    { type: 'h3', text: '2. Service with an Offer: what you do and what it costs' },
    {
      type: 'p',
      text: 'This is the block most service businesses are missing, and it is the one that lets an agent answer "how much does X cost" with your actual number instead of a shrug. One block per service, on the page describing that service:',
    },
    {
      type: 'code',
      language: 'html',
      content: `<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "Service",
  "name": "Initial Physiotherapy Assessment",
  "serviceType": "Sports physiotherapy",
  "provider": { "@type": "Physiotherapy", "name": "Riverside Physio" },
  "areaServed": "Austin, TX",
  "offers": {
    "@type": "Offer",
    "price": "140.00",
    "priceCurrency": "USD",
    "availability": "https://schema.org/InStock"
  }
}
</script>`,
    },
    { type: 'h3', text: '3. Product with an Offer: catalog data' },
    {
      type: 'p',
      text: 'For anything sold as a product. This block is also what shopping pipelines cross-reference against your merchant feed, so the two must agree, and note the aggregateRating below: it is legitimate here because it summarizes genuine customer reviews of a product, which is a different thing from rating your own business. That distinction is a hard rule and it is covered next:',
    },
    {
      type: 'code',
      language: 'html',
      content: `<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "Product",
  "name": "Recovery Foam Roller Pro",
  "description": "High-density foam roller, 45cm, for post-training recovery.",
  "sku": "RFR-PRO-45",
  "image": "https://example.com/img/roller.jpg",
  "brand": { "@type": "Brand", "name": "Riverside" },
  "offers": {
    "@type": "Offer",
    "price": "39.00",
    "priceCurrency": "USD",
    "availability": "https://schema.org/InStock",
    "url": "https://example.com/products/foam-roller-pro"
  },
  "aggregateRating": {
    "@type": "AggregateRating",
    "ratingValue": "4.7",
    "reviewCount": "132"
  }
}
</script>`,
    },
    { type: 'h3', text: '4. FAQPage: your canonical answers' },
    {
      type: 'p',
      text: 'FAQPage markup turns your questions page into extractable question-answer pairs, which is exactly the shape answer engines lift. Only mark up questions and answers that are visibly on the page:',
    },
    {
      type: 'code',
      language: 'html',
      content: `<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "FAQPage",
  "mainEntity": [{
    "@type": "Question",
    "name": "Do you take walk-in appointments?",
    "acceptedAnswer": {
      "@type": "Answer",
      "text": "No, all visits are by appointment. Same-day slots are often available and can be booked online."
    }
  }]
}
</script>`,
    },
    { type: 'h2', text: 'Implementation rules that keep your markup trusted' },
    {
      type: 'p',
      text: 'Structured data is a trust system, and trust is easy to lose. The rules that matter:',
    },
    {
      type: 'ul',
      items: [
        'Mirror the visible page. Every fact in JSON-LD must appear in the human-readable content. Markup that claims what the page does not show is treated as spam by Google and as noise by agents.',
        'Keep it current, automatically. A price in structured data that disagrees with your checkout is worse than no markup, because an assistant will quote it. Generate JSON-LD from the same source of truth as your pages, never hand-edit a stale copy.',
        'Use standard formats. ISO 8601 for dates and times, schema.org URLs for enumerations like availability, numbers as strings without currency symbols in price fields, and full absolute URLs.',
        'Connect your entities. Reference the same organization name, URL, and identity across every block on every page, so machines resolve all of it to one entity instead of fragments.',
        'One graph per page is fine. Multiple types can live in a single script tag using @graph, which is tidier than scattering blocks, and it is exactly how well-built platforms emit it.',
      ],
    },
    {
      type: 'callout',
      tone: 'amber',
      title: 'The mistakes that get markup ignored',
      text: 'The common failure modes: marking up content that is not on the page (the classic penalty case), rating your own business (Google makes a page ineligible for stars when the entity being reviewed controls the reviews about itself, which is exactly what a testimonials block with an aggregateRating attached is doing; [reviews and ratings for AI agents](/learn/reviews-ratings-and-ai-agents) covers the rule and what to do instead), fake or inflated ratings on things you may legitimately mark up (cross-checkable and reputation-destroying), stale prices from hand-maintained blocks, invalid JSON from a hand-edited template (one trailing comma silently kills the whole block), and marking up only the homepage while the service and product pages that actually answer queries carry nothing.',
    },
    { type: 'h2', text: 'Validate before you trust it' },
    {
      type: 'p',
      text: 'Never assume markup works; check it. Google’s Rich Results Test shows what Google extracts and flags eligibility issues, and the schema.org validator checks vocabulary correctness beyond Google’s subset. Paste your live URL, not your source file, so you test what crawlers actually receive after rendering. Then re-validate whenever your templates change; structured data breaks silently, and a JSON error takes the whole block out without any visible symptom on the page.',
    },
    {
      type: 'cta',
      title: 'Check your structured data the way an agent does',
      text: 'The free Nexez scanner fetches your pages like an AI crawler, extracts your JSON-LD, and scores what agents can and cannot verify about your business: identity, services, prices, hours, and the rest of the readiness stack. No signup, about a minute.',
      href: '/scan',
      label: 'Scan your site free',
    },
    { type: 'h2', text: 'Where JSON-LD stops' },
    {
      type: 'p',
      text: 'Structured data makes your facts legible; it does not make your business transactable. An agent that reads a perfect Offer block still cannot check whether Tuesday at 3pm is free or complete a booking. That is the next layer up: live feeds for the shopping surfaces and callable endpoints like an [MCP server](/learn/what-is-an-mcp-server) for actions. But the layers stack in order, and this one comes first, because every downstream surface, from [ChatGPT recommendations](/learn/get-recommended-by-chatgpt) to shopping feeds, cross-references the typed facts you publish here.',
    },
    {
      type: 'p',
      text: 'If you maintain your own site, the templates above plus an hour of adaptation cover most of it. If you would rather not maintain markup by hand, this is one of the things platforms should simply do for you: Nexez generates the full JSON-LD graph for your business, services, offers, and FAQs from your listing data automatically, so the markup can never drift from the page, and ships it alongside the rest of the agent stack.',
    },
    {
      type: 'cta',
      title: 'Get the whole readiness stack generated for you',
      text: 'Nexez turns your existing website into agent-legible, agent-transactable listings: auto-generated JSON-LD, llms.txt, agent.json, OpenAPI, a per-merchant MCP server, and ACP/UCP feeds, all from one source of truth. Start on Free with no card; paid plans include a 7-day trial.',
      href: '/how-it-works',
      label: 'See how it works',
    },
  ],
  faqs: [
    {
      question: 'What is JSON-LD in simple terms?',
      answer:
        'A block of machine-readable facts about your page, written in the schema.org vocabulary and embedded in a script tag. Visitors never see it; search engines, answer engines, and AI agents read it to learn typed facts (your prices, hours, services, ratings) they can verify and repeat confidently instead of guessing from prose.',
    },
    {
      question: 'Does JSON-LD actually help with AI visibility?',
      answer:
        'Yes, and it is among the best-evidenced tactics available. Industry studies consistently find pages with structured data cited around three times more often in AI answers, Google’s guidance for its generative surfaces leans on the same fundamentals, and shopping pipelines cross-check it against product feeds. It is typically the highest-leverage single hour in the whole [GEO playbook](/learn/generative-engine-optimization).',
    },
    {
      question: 'Where do I put JSON-LD on my website?',
      answer:
        'In a script tag with type application/ld+json, conventionally in the head, on the page the data describes: LocalBusiness on your homepage or contact page, each Service or Product block on its own page, FAQPage on your questions page. Marking up only the homepage is a common mistake; the deeper pages are the ones that answer specific queries.',
    },
    {
      question: 'Do I need a plugin or can I write JSON-LD by hand?',
      answer:
        'Both work; the failure mode is staleness, not authorship. Hand-written markup is fine for facts that rarely change, like your address. For prices and availability, generate the markup from the same data that renders the page (via your platform, CMS, or a plugin) so the two can never disagree. An assistant quoting a stale price from your own markup is the worst outcome.',
    },
    {
      question: 'Which schema types should a small business start with?',
      answer:
        'Four cover most needs: the most specific LocalBusiness subtype for identity, Service with nested Offer blocks for what you do and charge, Product with Offer if you sell goods, and FAQPage for your questions page. Ship those correctly, validate them, and only then consider additional types like Event or Review where they genuinely apply.',
    },
    {
      question: 'Can I add review or rating markup for my own business?',
      answer:
        'Not for reviews about your own business that you control. Google states that when the entity being reviewed controls the reviews about itself, those pages are ineligible for the star feature, and that local business ratings must come from users rather than being created, curated or compiled by human editors. Product reviews are different: genuine customer reviews of a product you sell can carry aggregateRating. The full rule, including the inverted regime for product sellers, is in [reviews and ratings for AI agents](/learn/reviews-ratings-and-ai-agents).',
    },
    {
      question: 'Can wrong structured data hurt me?',
      answer:
        'Yes, in two ways. Markup that misrepresents the visible page violates Google’s spam policies and can cost you rich results eligibility. And factually stale markup, like an outdated price, gets repeated verbatim by assistants, creating wrong answers about your own business. Accurate-and-automated beats extensive-and-stale every time; a [free scan](/scan) shows what your markup currently tells agents.',
    },
  ],
}
