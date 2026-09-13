import { appUrl, agentRuntimeUrl } from './site'
import type { CreateTemplateId } from './create-page-templates'
import { MARKETPLACE_DISCOVERY_ENABLED } from './marketplace-discovery'

export type MarketingCta = {
  label: string
  href: string
}

export type MarketingStat = {
  value: string
  label: string
}

export type MarketingCard = {
  title: string
  copy: string
}

export type MarketingSection = {
  eyebrow?: string
  title: string
  copy: string
  cards?: MarketingCard[]
}

export type MarketingPageContent = {
  slug: string
  eyebrow: string
  title: string
  accent: string
  description: string
  primaryCta: MarketingCta
  secondaryCta?: MarketingCta
  stats?: MarketingStat[]
  visualTitle: string
  visualItems: string[]
  sections: MarketingSection[]
  faq?: MarketingCard[]
  finalCtaTitle: string
  finalCtaCopy: string
}

export const marketingPages: Record<string, MarketingPageContent> = {
  'how-it-works': {
    slug: 'how-it-works',
    eyebrow: 'How it works',
    title: 'Your website is for people.',
    accent: 'Your Nexez listing is for agents.',
    description:
      'Nexez turns key information from your website into a focused listing AI agents can use. Your main site stays human-first. Your listing keeps offers and next steps clear.',
    primaryCta: { label: 'Create your first listing', href: appUrl('/create') },
    secondaryCta: { label: 'Test the simulator', href: '/simulator' },
    stats: [
      { value: '01', label: 'Import or enter offers' },
      { value: '02', label: 'Optimize for agents' },
      { value: '03', label: 'Publish and measure' },
    ],
    visualTitle: 'From website noise to agent clarity',
    visualItems: [
      'Pull services, products, prices, FAQs, and availability into one editable profile.',
      'Generate structured outputs agents already understand: schema, llms.txt, agent.json, and MCP.',
      'Track agent visits, buyer queries, handoffs, bookings, and readiness over time.',
    ],
    sections: [
      {
        eyebrow: 'Step 1',
        title: 'Start from what already exists.',
        copy:
          'Import from your website, CSV, TSV, TXT, JSON, Excel, Calendly, Stripe, Shopify, Square, or enter offers by hand. Nexez helps clean the raw material into short, purchasable services and products.',
        cards: [
          { title: 'Website importer', copy: 'Extracts offers and descriptions without asking users to start from a blank screen.' },
          { title: 'Guided builder', copy: 'Keeps the listing structured while still giving non-technical users plain language controls.' },
          { title: 'Manual control', copy: 'Every imported field can be reviewed, rewritten, reordered, or removed before publish.' },
        ],
      },
      {
        eyebrow: 'Step 2',
        title: 'Shape the listing for agent decisions.',
        copy:
          'Listings remove website noise, vague buttons, scattered pricing, and hidden next steps. Nexez gives buying assistants a clear offer they can recommend.',
        cards: [
          { title: 'Clear offers', copy: 'Services, products, packages, retainers, and bookings are separated into predictable blocks.' },
          { title: 'Direct actions', copy: 'Each offer can point to booking, checkout, contact, negotiation, or external handoff.' },
          { title: 'Readiness scoring', copy: 'A practical score tells users what is missing before agents start judging the listing.' },
        ],
      },
      {
        eyebrow: 'Step 3',
        title: 'Publish a fast public listing agents can crawl.',
        copy:
          'The published listing lives on a Nexez link, a custom domain, or the public agent runtime. It stays clean, crawlable, and linked back to the main website.',
        cards: [
          { title: 'Human preview', copy: 'The listing is still readable by people who need to inspect the offer quickly.' },
          { title: 'Agent artifacts', copy: 'Nexez emits structured files and manifests alongside the visual listing.' },
          { title: 'Analytics loop', copy: 'Visits, agent type, search intent, and conversion handoffs feed back into the dashboard.' },
        ],
      },
    ],
    faq: [
      { title: 'Does this replace my website?', copy: 'No. Nexez complements your website with a focused agent-facing listing that links back to your main brand.' },
      { title: 'Do I need technical setup?', copy: 'No. You can launch with a Nexez link first, then add custom domains, API keys, and integrations when ready.' },
      { title: 'Why not just add schema to my existing site?', copy: 'Schema helps, but it does not remove bloat, unclear actions, or scattered buying context. Nexez gives agents a clean target.' },
    ],
    finalCtaTitle: 'Give agents the listing your website was never designed to be.',
    finalCtaCopy: 'Start simple: one listing, a few offers, clean structure, and a measurable agent discovery loop.',
  },
  examples: {
    slug: 'examples',
    eyebrow: 'Examples and templates',
    title: 'Start with the listing shape',
    accent: 'agents already want.',
    description:
      'Start with a template for services, retainers, bookings, local work, software implementation, or packaged offers. Each template begins with what the buyer needs.',
    primaryCta: { label: 'Use a template', href: appUrl('/create?template=consulting') },
    secondaryCta: MARKETPLACE_DISCOVERY_ENABLED
      ? { label: 'Browse live listings', href: '/discovery' }
      : undefined,
    stats: [
      { value: '9', label: 'Launch-ready patterns' },
      { value: '5', label: 'Offer models covered' },
      { value: '1', label: 'Source of truth' },
    ],
    visualTitle: 'Template logic',
    visualItems: [
      'Position the buyer problem in one plain-language paragraph.',
      'List offers with scope, price signal, duration, and next action.',
      'Add FAQs that remove friction before the agent recommends or buys.',
    ],
    sections: [
      {
        eyebrow: 'Professional services',
        title: 'For people selling expertise.',
        copy:
          'Consultants, coaches, agencies, accountants, attorneys, and advisors need offers agents can compare quickly. The best template states who it is for, what is included, and how to start.',
        cards: [
          { title: 'Strategy session', copy: 'One-time advisory call with duration, expected outcome, calendar link, and price.' },
          { title: 'Monthly retainer', copy: 'Recurring support with scope, response time, reporting cadence, and starting price.' },
          { title: 'Fixed audit', copy: 'Defined diagnostic package with deliverables, timeline, and checkout or proposal request.' },
        ],
      },
      {
        eyebrow: 'Local services',
        title: 'For businesses agents may book on behalf of a person.',
        copy:
          'Local service listings should make eligibility, availability, service area, pricing, and booking steps obvious. Agents should not have to infer whether the business can help.',
        cards: [
          { title: 'Home services', copy: 'Service area, emergency availability, common jobs, estimate rules, and phone fallback.' },
          { title: 'Wellness bookings', copy: 'Session types, location rules, prep notes, cancellation policy, and calendar action.' },
          { title: 'Events and rentals', copy: 'Package options, capacity, add-ons, deposit terms, and quote request path.' },
        ],
      },
      {
        eyebrow: 'Products and tools',
        title: 'For offers that need direct purchase context.',
        copy:
          'Productized listings work best when they include plain descriptions, price ranges, compatibility notes, inventory or availability signals, and a direct buy action.',
        cards: [
          { title: 'Digital product', copy: 'What it solves, format, access method, refund policy, and purchase button.' },
          { title: 'Implementation package', copy: 'Software setup, onboarding scope, estimated timeline, and handoff requirements.' },
          { title: 'Bulk order', copy: 'Minimums, lead time, contact path, and structured details agents can pass to procurement.' },
        ],
      },
    ],
    faq: [
      { title: 'Can templates import my real site?', copy: 'Yes. Start with importer output, then apply a template structure to tighten the offers.' },
      { title: 'Can I create multiple listings?', copy: 'Yes. Listings can target different industries, regions, offer lines, or buyer intents.' },
      { title: 'Do examples affect live ranking?', copy: 'No. They are starting points. Real readiness depends on your published structure and completeness.' },
    ],
    finalCtaTitle: 'Make your offer obvious before an agent has to guess.',
    finalCtaCopy: 'Pick a template, import your services, and publish a clean listing agents can act on.',
  },
  security: {
    slug: 'security',
    eyebrow: 'Security and trust',
    title: 'Built for public discovery',
    accent: 'without losing control.',
    description:
      'Nexez is open where agents need discovery and closed where owners need control. Separate hosts, deliberate public projections, row-level access, encrypted credentials, and verified runtime paths protect that boundary.',
    primaryCta: { label: 'Review storefront settings', href: appUrl('/dashboard/settings') },
    secondaryCta: { label: 'Read security docs', href: '/docs#security-operations' },
    stats: [
      { value: '3', label: 'Separated domains' },
      { value: 'RLS', label: 'Database access model' },
      { value: 'AES', label: 'Recoverable secret encryption' },
    ],
    visualTitle: 'Trust model',
    visualItems: [
      'nexez.ai handles public education and discovery.',
      'app.nexez.ai handles authenticated creation, billing, and settings.',
      'nexez.app exposes published listings, narrow public projections, commerce, and agent APIs.',
    ],
    sections: [
      {
        eyebrow: 'Platform boundaries',
        title: 'The public listing is not the private dashboard.',
        copy:
          'The public runtime reads a restricted projection of published records. Drafts, account data, billing, credentials, private trust evidence, analytics, and owner controls remain behind authenticated access.',
        cards: [
          { title: 'Row-level ownership', copy: 'Owner and collaborator policies constrain workspace data at the database boundary.' },
          { title: 'Public projection', copy: 'Published surfaces read an allowlisted record instead of exposing the private base table.' },
          { title: 'Host-aware routing', copy: 'Marketing, authenticated control, and agent runtime traffic resolve to deliberate domains.' },
        ],
      },
      {
        eyebrow: 'Payments and integrations',
        title: 'Credentials and transactions stay scoped.',
        copy:
          'Recoverable integration credentials and buyer-access tokens are server-only and encrypted at rest. Signed webhooks, dry runs, idempotency, and immutable purchase economics constrain consequential actions.',
        cards: [
          { title: 'Encrypted recovery', copy: 'Calendly, Shopify, Square, Acuity, checkout, and negotiation secrets use narrow server-side recovery paths.' },
          { title: 'Verified events', copy: 'Stripe, Shopify, and Calendly deliveries are signature-checked before state changes.' },
          { title: 'Money provenance', copy: 'Price, fee rate, commission source, refunds, and settlement state remain attributable to the transaction.' },
        ],
      },
      {
        eyebrow: 'Operations and recourse',
        title: 'Critical paths are checked after they ship.',
        copy:
          'Release certification, reconciliation jobs, launch-health checks, status paths, refunds, disputes, and support escalation cover the period after a request leaves the interface.',
        cards: [
          { title: 'Release certification', copy: 'Static checks, tests, end-to-end flows, SDK parity, and production probes guard releases.' },
          { title: 'Reconciliation', copy: 'Billing, escrow, settlements, resources, freshness, and negotiations have repair-oriented jobs.' },
          { title: 'User recourse', copy: 'Owners and buyers retain order, refund, dispute, review, status, and support paths.' },
        ],
      },
    ],
    faq: [
      { title: 'Will unpublished listings be crawled?', copy: 'No. The public runtime is built around published records and explicit public artifacts.' },
      { title: 'Can users verify custom domains?', copy: 'Yes. Custom domains use verification checks before they are marked live.' },
      { title: 'Where do my API keys and secrets live?', copy: 'Private credentials stay server-side; recoverable secrets are encrypted and excluded from public listings, client bundles, and crawlable artifacts.' },
    ],
    finalCtaTitle: 'Public to agents. Private where it should be.',
    finalCtaCopy: 'Nexez gives businesses a discoverable public surface without turning the dashboard into a public target.',
  },
  integrations: {
    slug: 'integrations',
    eyebrow: 'Integrations',
    title: 'Connect the tools that already',
    accent: 'hold your buying context.',
    description:
      'Connect catalog, scheduling, payment, and automation systems to keep offers actionable. Imports remain editable, credentials stay scoped, and publication stays under owner control.',
    primaryCta: { label: 'Open integrations', href: appUrl('/dashboard/integrations') },
    secondaryCta: { label: 'Read integration docs', href: '/docs#integrations-automation' },
    stats: [
      { value: '10+', label: 'Named integration paths' },
      { value: 'CSV', label: 'No-code fallback' },
      { value: 'API', label: 'Developer-ready' },
    ],
    visualTitle: 'Integration sources',
    visualItems: [
      'Stripe, Shopify, Square, WooCommerce, CSV, and website flows shape editable catalogs and prices.',
      'Calendly, Acuity, ServiceM8, and Google Calendar connect service catalogs, job context, booking signals, and free/busy data.',
      'Inbound signatures, outbound webhooks, resync, and reconciliation keep state attributable.',
    ],
    sections: [
      {
        eyebrow: 'Scheduling',
        title: 'Make bookable services obvious.',
        copy:
          'Agents need to know whether a buyer can book, when the service is available, how long it takes, and what happens after the booking. Scheduling integrations reduce stale offer listings.',
        cards: [
          { title: 'Calendly', copy: 'Import service names, booking links, durations, and meeting context.' },
          { title: 'Google Calendar', copy: 'Connect with OAuth and derive availability from free/busy status without reading event names or descriptions.' },
          { title: 'ServiceM8', copy: 'Import job templates as editable offers and verify live job access through a scoped OAuth connection.' },
          { title: 'Acuity', copy: 'Import live appointment-type catalogs through OAuth or encrypted per-listing API credentials.' },
        ],
      },
      {
        eyebrow: 'Catalog and commerce',
        title: 'Turn connected inventory into editable offers.',
        copy:
          'Nexez imports structured source data without turning an external system into the public source of truth. Owners review the result, then attach the right checkout, booking, quote, or negotiation path.',
        cards: [
          { title: 'Stripe', copy: 'Import catalog data, connect seller payments, and preserve platform-fee and settlement evidence.' },
          { title: 'Shopify', copy: 'Install, link a listing, sync catalog records, and serve the storefront through an app proxy.' },
          { title: 'Square', copy: 'Import catalog context and read booking profiles through a scoped OAuth connection.' },
          { title: 'WooCommerce', copy: 'Authorize read-only product and order access directly from a merchant store.' },
        ],
      },
      {
        eyebrow: 'Automation',
        title: 'Keep state fresh without hiding what changed.',
        copy:
          'Signed inbound events, owner-configured outbound webhooks, manual resync, and scheduled repair jobs move changes through observable paths.',
        cards: [
          { title: 'Verified inbound events', copy: 'Provider signatures are checked before supported events update platform state.' },
          { title: 'Zapier-compatible webhooks', copy: 'Owners can send signed booking and checkout signals to saved Zapier Catch Hooks, Make, n8n, or their own HTTPS systems.' },
          { title: 'Freshness controls', copy: 'Resync and scheduled reconciliation surface failures instead of silently presenting stale availability.' },
        ],
      },
    ],
    faq: [
      { title: 'Do I need integrations to launch?', copy: 'No. Manual listings are enough for launch. Integrations make listings easier to keep fresh.' },
      { title: 'Can I review imported data?', copy: 'Yes. Imports create a draft you review, edit, and approve. Nothing publishes without you.' },
      { title: 'Does an import publish automatically?', copy: 'No. Imported records stay in the editable listing model and publication remains an explicit owner action.' },
    ],
    finalCtaTitle: 'Set it once, then keep the listing fresh.',
    finalCtaCopy: 'Connect the systems that already know your offers, prices, and availability.',
  },
  'agent-readiness': {
    slug: 'agent-readiness',
    eyebrow: 'Agent readiness',
    title: 'Make your business recommendable',
    accent: 'by AI agents.',
    description:
      'Readiness measures whether an agent can understand and use a listing. Trust adds identity and runtime evidence. Neither is a traffic promise, and neither replaces explicit buyer approval.',
    primaryCta: { label: 'Run the simulator', href: '/simulator' },
    secondaryCta: { label: 'Read readiness docs', href: '/docs#readiness-publication' },
    stats: [
      { value: '3', label: 'Readiness, trust, runtime lenses' },
      { value: '6+', label: 'Synchronized public artifacts' },
      { value: '0', label: 'Guaranteed traffic claims' },
    ],
    visualTitle: 'Readiness checklist',
    visualItems: [
      'Offers have names, descriptions, price signals, and next actions.',
      'The listing exposes schema, llms.txt, agent.json, and clear semantic HTML.',
      'Identity, freshness, website checks, policies, and runtime evidence remain distinguishable from completeness.',
    ],
    sections: [
      {
        eyebrow: 'Parse',
        title: 'Agents need the shape of the offer.',
        copy:
          'A beautiful website can still be ambiguous. Agent readiness starts with turning services and products into explicit records with scope, price, buyer fit, and action.',
        cards: [
          { title: 'Offer clarity', copy: 'Each service or product should answer what it is, who it is for, and how to start.' },
          { title: 'Price signal', copy: 'Exact price, starting price, range, quote-needed, or package tier beats silence.' },
          { title: 'Policy context', copy: 'Cancellation, deposits, service area, lead time, and human review rules reduce bad handoffs.' },
        ],
      },
      {
        eyebrow: 'Prove',
        title: 'Trust evidence must stay separate from completeness.',
        copy:
          'A complete listing can still be stale or unverified. Nexez records website checks, identity context, freshness, credentials, and observed runtime behavior without turning evidence into a guarantee.',
        cards: [
          { title: 'Trust context', copy: 'Website, identity, contact, domain, freshness, and policy signals remain visible and attributable.' },
          { title: 'Private evidence', copy: 'Credentials can be reviewed without forcing sensitive evidence onto the public listing.' },
          { title: 'Runtime checks', copy: 'Artifacts, links, domains, and action paths can be checked as systems rather than assumed from copy.' },
        ],
      },
      {
        eyebrow: 'Act',
        title: 'Agents need the next step to be safe.',
        copy:
          'The winning listing does not just describe the business. It gives a clear path for booking, buying, requesting a quote, or escalating to a human.',
        cards: [
          { title: 'Direct CTAs', copy: 'Book, buy, contact, negotiate, or request review should be attached to specific offers.' },
          { title: 'Checkout readiness', copy: 'Payment paths need clear totals, confirmation states, and agent-readable receipts.' },
          { title: 'Simulator evidence', copy: 'Owner-only dry runs show how different agent lenses interpret the listing without executing a transaction.' },
        ],
      },
    ],
    faq: [
      { title: 'Is this the same as SEO?', copy: 'No. SEO helps search engines rank pages. Agent readiness helps AI systems understand and act on your offer.' },
      { title: 'Do agents really need separate listings?', copy: 'Often, yes. Main sites are optimized for persuasion, visuals, and tracking. Agents need concise structure and direct actions.' },
      { title: 'Can a readiness score guarantee traffic?', copy: 'No score can guarantee demand. It can reduce avoidable parsing and trust failures before agents reach your listing.' },
    ],
    finalCtaTitle: 'Build the listing agents wish every business had.',
    finalCtaCopy: 'Make the offer clear, the data structured, and the next action impossible to miss.',
  },
  developers: {
    slug: 'developers',
    eyebrow: 'Developers',
    title: 'APIs and artifacts for',
    accent: 'agent-native commerce.',
    description:
      'Build with documented APIs for discovery, approval, checkout, negotiation, and account management. SDKs, examples, and agent distribution tools are ready to use.',
    primaryCta: { label: 'View OpenAPI', href: agentRuntimeUrl('/openapi.json') },
    secondaryCta: { label: 'Read developer docs', href: '/docs#developer-distribution' },
    stats: [
      { value: 'REST', label: 'Public APIs' },
      { value: 'MCP', label: 'Per-listing manifests' },
      { value: 'SDK', label: 'TypeScript and Python' },
    ],
    visualTitle: 'Developer surface',
    visualItems: [
      'Global index: /agent-pages.json for published listings.',
      'Search: /api/agent-search?q={intent} for buyer-intent discovery.',
      'Per-listing artifacts: /{slug}/agent.json, /{slug}/llms.txt, /{slug}/mcp.json.',
      'Distribution: TypeScript, Python, OpenClaw plugin and skill, examples, MCP, ARD, and agent cards.',
    ],
    sections: [
      {
        eyebrow: 'Discovery',
        title: 'Find listings and offers by intent.',
        copy:
          'Agents and tools can search the public runtime for structured offers instead of scraping arbitrary websites. The response is designed for ranking, comparison, and handoff.',
        cards: [
          { title: 'Agent search', copy: 'Query by buyer intent, service type, product phrase, or category.' },
          { title: 'Directory API', copy: 'Pull public listings with filters such as category and readiness threshold.' },
          { title: 'Global index', copy: 'Use the public index for broad crawling and periodic sync.' },
        ],
      },
      {
        eyebrow: 'Contracts and distribution',
        title: 'Use the contract your runtime understands.',
        copy:
          'Choose the interface your product supports. Nexez keeps the same listing, approval, and commerce rules across its APIs, SDKs, files, and MCP tools.',
        cards: [
          { title: 'SDKs and examples', copy: 'Published TypeScript and Python packages mirror safe search, validation, approval, and negotiation patterns.' },
          { title: 'Native agent access', copy: 'An OpenClaw plugin and discovery skill provide installable tool and context paths.' },
          { title: 'MCP and ARD', copy: 'Global and per-listing resources are discoverable through catalogs and well-known manifests.' },
        ],
      },
      {
        eyebrow: 'Action',
        title: 'Move from recommendation to handoff.',
        copy:
          'Developers can dry-run eligible actions, present the exact destination and terms, require buyer approval, then create checkout or negotiation state with a durable status path.',
        cards: [
          { title: 'Agentic commerce', copy: 'Checkout APIs include native Nexez, ACP, and UCP session contracts.' },
          { title: 'Dry-run validation', copy: 'Agents can verify a checkout path before starting a real purchase flow.' },
          { title: 'Buyer approval UX', copy: 'Render clear consent before checkout, booking, contact sharing, or negotiation submission.' },
        ],
      },
    ],
    faq: [
      { title: 'Are public APIs authenticated?', copy: 'Public discovery APIs are open by design. Account and management APIs require authentication.' },
      { title: 'Can I build an agent on top of Nexez?', copy: 'Yes. Nexez is designed to be a clean offer source for agents, search tools, and buying assistants.' },
      { title: 'How should agents ask for approval?', copy: 'Use the buyer approval pattern to show seller, offer, price, terms, risk notes, and the exact next action before side effects.' },
      { title: 'Do you support Agentic Resource Discovery?', copy: 'Yes. The public ARD catalog lists Nexez search and MCP endpoints so compatible registries can index them.' },
      { title: 'Where should crawlers start?', copy: 'Start with https://nexez.app/llms.txt, /agent-pages.json, and /openapi.json.' },
    ],
    finalCtaTitle: 'Stop scraping. Start with structured intent.',
    finalCtaCopy: 'Build against listings that were designed to be read by agents from day one.',
  },
  compare: {
    slug: 'compare',
    eyebrow: 'Compare',
    title: 'Nexez is not another',
    accent: 'landing page builder.',
    description:
      'Nexez sits beside websites, directories, schedulers, payment processors, and commerce platforms. It joins their scattered context into one governed layer agents can discover, validate, act through, and reconcile.',
    primaryCta: { label: 'Create a listing', href: appUrl('/create') },
    secondaryCta: { label: 'Read the platform model', href: '/docs#platform-model' },
    stats: [
      { value: 'Human', label: 'Website remains intact' },
      { value: 'Agent', label: 'Nexez listing is structured' },
      { value: 'Data', label: 'Analytics prove activity' },
    ],
    visualTitle: 'Positioning',
    visualItems: [
      'Website builders optimize visual presentation and content control.',
      'Directories optimize discovery, but not your owned agent-readable data.',
      'Nexez owns the cross-system offer, approval, action, evidence, and financial record after discovery.',
    ],
    sections: [
      {
        eyebrow: 'Versus your main website',
        title: 'Keep the brand site. Add the agent surface.',
        copy:
          'Your main site can stay rich, visual, tracked, and human-focused. Nexez gives agents a separate, cleaner target that points back to the brand experience when needed.',
        cards: [
          { title: 'Less page noise', copy: 'No bloated navigation, buried service pages, vague pricing, or hidden CTAs.' },
          { title: 'More structure', copy: 'Offers, FAQs, policies, actions, schema, and manifests are generated from one source.' },
          { title: 'Better measurement', copy: 'Track agent visits and handoffs separately from normal web traffic.' },
        ],
      },
      {
        eyebrow: 'Versus directories',
        title: 'Own the listing agents recommend.',
        copy:
          'Directories can help discovery, but they often own the buyer relationship. Nexez gives each business a dedicated listing, custom domain path, and structured data they control.',
        cards: [
          { title: 'Portable link', copy: 'Share the same listing anywhere: directory, website, profile, or custom domain.' },
          { title: 'Richer context', copy: 'Listings can include offer details, policies, checkout paths, and manifests.' },
          { title: 'Network effect', copy: 'The agent directory adds machine discovery while each business keeps its own listing.' },
        ],
      },
      {
        eyebrow: 'Versus disconnected commerce tools',
        title: 'A handoff is not the end of the record.',
        copy:
          'Other tools may handle a booking or payment. Nexez keeps the original request, approval, transaction, and follow-up connected.',
        cards: [
          { title: 'Clear approval', copy: 'The buyer sees the offer, terms, destination, and shared data before anything happens.' },
          { title: 'Connected follow-up', copy: 'Orders, messages, refunds, disputes, and status remain connected after the handoff.' },
          { title: 'Verified reporting', copy: 'Reports keep completed payments separate from estimates and attention.' },
        ],
      },
    ],
    faq: [
      { title: 'Can I use Nexez with Webflow, Squarespace, or Wix?', copy: 'Yes. Nexez sits beside your main website and can link to or import from it.' },
      { title: 'Is this only for AI traffic?', copy: 'No. Humans can use the listings too, but the structure is intentionally optimized for agents.' },
      { title: 'Can agencies manage listings for clients?', copy: 'Yes. Storefronts, multiple listings, invitations, collaborator access, shared branding, and portfolio reporting support managed work.' },
    ],
    finalCtaTitle: 'Do not rebuild your website for agents. Add the missing layer.',
    finalCtaCopy: 'Give every service, product, and package a listing agents can understand and act on.',
  },
  enterprise: {
    slug: 'enterprise',
    eyebrow: 'Enterprise',
    title: 'Agent-ready infrastructure',
    accent: 'for teams with many offers.',
    description:
      'For agencies, franchises, marketplaces, and complex sellers, Nexez governs listings, teams, domains, integrations, agent distribution, transactions, and reporting across a portfolio.',
    primaryCta: { label: 'Contact sales', href: '/support' },
    secondaryCta: { label: 'Read enterprise docs', href: '/docs#workspace-foundation' },
    stats: [
      { value: 'Teams', label: 'Owned collaboration' },
      { value: 'API', label: 'Managed automation' },
      { value: 'Portfolio', label: 'Operational reporting' },
    ],
    visualTitle: 'Enterprise fit',
    visualItems: [
      'Teams manage storefronts, listings, collaborators, domains, integrations, and publication from one control plane.',
      'Reusable creation, import, offer, trust, and agent distribution patterns keep portfolios consistent.',
      'Analytics, negotiation operations, immutable finance, and reconciliation make scale measurable.',
    ],
    sections: [
      {
        eyebrow: 'Scale',
        title: 'Create and maintain many listings without losing consistency.',
        copy:
          'Enterprise buyers need repeatable listing structure, governance, import workflows, and reporting across teams. Nexez is designed to standardize the agent-readable layer.',
        cards: [
          { title: 'Portfolio structure', copy: 'Group listings through storefronts and organize each business, location, vertical, or offer line deliberately.' },
          { title: 'Reusable inputs', copy: 'Use templates, website scans, CSV, catalog connections, duplication, and version history to accelerate repeatable creation.' },
          { title: 'Central reporting', copy: 'Compare traffic, intent, offers, actions, negotiations, readiness, and verified economics across owned records.' },
        ],
      },
      {
        eyebrow: 'Control',
        title: 'Give teams the right level of access.',
        copy:
          'Large deployments need clear ownership, draft review, publish workflows, domain controls, and integration hygiene.',
        cards: [
          { title: 'Owned collaboration', copy: 'Invite collaborators and inherit owner entitlements without transferring ownership or widening unrelated access.' },
          { title: 'Domain strategy', copy: 'Use the Nexez runtime, storefronts, Shopify proxy, or verified custom domains where appropriate.' },
          { title: 'Commercial controls', copy: 'Custom transaction terms, advanced settlement, integrations, API keys, and support expectations can be governed centrally.' },
        ],
      },
      {
        eyebrow: 'Data',
        title: 'Measure agent demand across a portfolio.',
        copy:
          'The value of listings compounds when teams can see which offers agents search for, which listings convert, and where structure fails.',
        cards: [
          { title: 'Agent and intent mix', copy: 'Separate human traffic, detected agents, directory discovery, queries, and trusted server actions.' },
          { title: 'Commercial operations', copy: 'Track offers, negotiation queues, latency, outcomes, orders, refunds, fees, payouts, escrow, and settlements.' },
          { title: 'Readiness governance', copy: 'Monitor completeness, trust evidence, runtime health, domains, stale context, and actionability.' },
        ],
      },
    ],
    faq: [
      { title: 'Who is Enterprise for?', copy: 'Teams managing many listings, locations, clients, merchants, or high-value workflows.' },
      { title: 'Can pricing be customized?', copy: 'Yes. Enterprise plans can include custom transaction terms, limits, onboarding, and support.' },
      { title: 'What is available today?', copy: 'The capabilities described here and in the platform documentation are current product surfaces. Deployment-specific terms are confirmed during onboarding.' },
    ],
    finalCtaTitle: 'Turn many businesses into one structured agent-ready network.',
    finalCtaCopy: 'Enterprise Nexez helps teams publish, govern, and measure listings at scale.',
  },
}

/** /pricing "Common questions" - single source for BOTH the rendered Q&A (PricingClient)
 *  and the page's FAQPage JSON-LD, so the schema can never drift from what's visible. */
export const pricingFaqs = [
  { question: 'Do I pay a commission if no one books?', answer: 'No. Nexez commission applies only to successful transactions settled through Nexez. Paid-plan subscriptions and card-processing fees are separate.' },
  { question: 'Can I change plans later?', answer: 'Yes, upgrade or downgrade from your Billing page. Prorated billing.' },
  { question: 'How does complimentary Launch access work?', answer: 'Start on Free, then verify your email and business identity and publish a listing. Eligible businesses can receive 180 days of Launch access once all qualification checks pass, while the campaign is available. No card is required for the promotion, and it does not renew into a paid subscription. Afterward, the account returns to Free unless you choose a paid plan.' },
  { question: 'What if I need custom pricing?', answer: 'Enterprise plans are fully customizable. Reach out via support.' },
] as const

export type UseCasePage = {
  slug: string
  label: string
  templateId: CreateTemplateId
  title: string
  description: string
  pain: string
  buyerIntent: string
  offers: MarketingCard[]
  pageMustProve: MarketingCard[]
  faq: MarketingCard[]
  cta: string
}

/** Use-case pages segment on whether the vertical typically already has a website.
 *
 *  Established-site verticals (consultants, agencies, saas, marketplaces) lead with
 *  "your site works for people, agents cannot read it" and never pitch hosting: those
 *  merchants already have a site and a second indexed page reads as a threat, not a perk.
 *
 *  Thin-presence verticals (coaches, local-services) lead with the missing surface and
 *  name hosting explicitly, because for them the listing is often the entire public
 *  presence and "you do not have to build a site" is the objection remover.
 *
 *  Keep exactly three FAQ entries per vertical: the renderer grid is md:grid-cols-3,
 *  and a fourth card orphans on desktop. Cover the opposite site status by widening an
 *  existing answer rather than adding a card. */
export const useCases: UseCasePage[] = [
  {
    slug: 'consultants',
    label: 'Consultants',
    templateId: 'consulting',
    title: 'Consulting listings agents can compare in seconds.',
    description:
      'Package strategy calls, audits, and retainers into clear offers with scope, price signal, buyer fit, and booking path.',
    pain:
      'Your expertise lives in paragraphs, case studies, and a contact form. When a buyer asks an AI assistant for a consultant who can start next week and explain pricing up front, none of that is legible. The agent needs scope, a price signal, and a booking link it can verify, and most consulting sites offer a phone number.',
    buyerIntent: 'Find a B2B consultant who can help next week and explain pricing before booking.',
    offers: [
      { title: 'Strategy session', copy: 'A one-time call with a set duration, a clear outcome, a price, and a calendar link. The easiest yes an agent can recommend.' },
      { title: 'Fractional advisory retainer', copy: 'Ongoing support with scope, response time, and a monthly price, so an agent can match you to a budget without a discovery call.' },
      { title: 'Fixed-scope audit', copy: 'A defined diagnostic with deliverables, a timeline, and a checkout or proposal request. High trust, low ambiguity.' },
    ],
    pageMustProve: [
      { title: 'Expertise and niche', copy: 'Who you help and what you do best, in one sentence an agent can repeat to its buyer.' },
      { title: 'Outcome and deliverables', copy: 'What the client walks away with. Agents do not recommend vague.' },
      { title: 'Availability and price signal', copy: 'Even a starting price beats silence. An agent cannot compare a number that is not there.' },
    ],
    faq: [
      { title: 'Do I have to publish exact prices?', copy: 'No. A starting price, a range, or a paid scoping call all work. Agents just need something to compare, and silence reads as a dead end.' },
      { title: 'What if my work is too custom to package?', copy: 'Package the first step instead. A paid scoping call or a fixed audit gives agents a concrete offer, and the custom engagement follows from there.' },
      { title: 'Will this compete with my main website?', copy: 'No. The listing links back to your site and gives agents a current view of your offers. If you do not have a site, the listing can stand alone on a Nexez link or your own domain.' },
    ],
    cta: 'Create a consulting listing',
  },
  {
    slug: 'agencies',
    label: 'Agencies',
    templateId: 'consulting',
    title: 'Agency offers that do not get buried in a bloated site.',
    description:
      'Turn service menus, packages, audits, retainers, and implementation work into structured listings agents can recommend.',
    pain:
      'Agency sites are built to impress people: showreels, case studies, and a services page with nine capabilities and zero prices. An agent shortlisting agencies for a client cannot rank a vibe. It ranks scope, price signal, and a clear way to start, and the agency that publishes those wins the shortlist.',
    buyerIntent: 'Shortlist an agency for launch support, compare packages, and request a proposal.',
    offers: [
      { title: 'Growth audit', copy: 'A fixed-price diagnostic that shows how you think. Easy to compare, easy to buy, and a natural door into bigger work.' },
      { title: 'Launch sprint', copy: 'A defined engagement with a timeline and a deliverable list, so agents can match you to a deadline.' },
      { title: 'Monthly execution retainer', copy: 'Recurring scope with response times and reporting cadence spelled out. This is what retainer buyers actually compare.' },
    ],
    pageMustProve: [
      { title: 'Target client', copy: 'The company size, stage, and industry you do your best work for. Fit is the first filter agents apply.' },
      { title: 'Scope boundaries', copy: 'What is included and what is not. Clear edges prevent bad-fit inquiries that waste both sides.' },
      { title: 'Proposal or checkout path', copy: 'A way to start that an agent can act on: book a call, request a proposal, or check out directly.' },
    ],
    faq: [
      { title: 'We sell custom engagements. How does that fit?', copy: 'List entry points, not your whole capability deck. An audit, a sprint, and a retainer cover most of the ways a client can start with you.' },
      { title: 'Can we manage listings for our clients too?', copy: 'Yes. Agencies run listings for clients as part of the service, and multi-listing workflows are built for exactly that.' },
      { title: 'Will agents really shortlist agencies?', copy: 'Buying assistants already compare providers when asked. The question is whether your offers are legible when it happens.' },
    ],
    cta: 'Create an agency listing',
  },
  {
    slug: 'coaches',
    label: 'Coaches',
    templateId: 'consulting',
    title: 'Coaching listings with clear programs and next steps.',
    description:
      'Help agents understand session types, program length, fit, pricing, booking rules, and what a buyer should expect.',
    pain:
      'Plenty of coaches run on a bio link, a booking page, and word of mouth, and that fills a roster fine. It does not answer an agent. When a buyer asks an assistant for a coach with a specific specialty, budget, and format, the agent is looking for session types, prices, and booking rules published somewhere it can read. A page of links gives it links.',
    buyerIntent: 'Book a coach with a specific specialty, budget, and meeting format.',
    offers: [
      { title: 'Intro session', copy: 'A low-commitment first call with a price and a calendar link. The offer agents recommend to a hesitant buyer.' },
      { title: 'Program package', copy: 'A defined arc: length, cadence, format, outcome, and price. Comparable at a glance.' },
      { title: 'Monthly coaching membership', copy: 'Recurring support with clear terms, so budget-matched buyers can start without a back-and-forth.' },
    ],
    pageMustProve: [
      { title: 'Specialty and fit', copy: 'The specific problem you coach and who it is for. Career transitions for engineers beats life coaching every time.' },
      { title: 'Session format', copy: 'Video, in person, group size, and session length. Format is a hard filter for most buyers.' },
      { title: 'Booking and cancellation rules', copy: 'Reschedule windows, refunds, and how to book. Agents check policies before recommending a stranger.' },
    ],
    faq: [
      { title: 'My coaching is personal. Can a listing capture that?', copy: 'It does not have to. The listing gets you found and booked for the intro session. The connection happens on the call.' },
      { title: 'Do I need a website first?', copy: 'No. Nexez hosts a live page with your programs, prices, and booking path. It can use a Nexez link or your own domain.' },
      { title: 'What if my prices vary by client?', copy: 'Publish the intro session at a fixed price and mark programs with a starting price. That is enough for an agent to compare.' },
    ],
    cta: 'Create a coaching listing',
  },
  {
    slug: 'local-services',
    label: 'Local services',
    templateId: 'local-service',
    title: 'Local service listings agents can safely book.',
    description:
      'Make service area, availability, job types, estimates, emergency rules, and contact paths explicit for buyer assistants.',
    pain:
      'A homeowner tells an assistant to find a plumber who can come Thursday. The agent needs your service area, your hours, the jobs you take, and whether Thursday is possible. Plenty of local businesses have nowhere to put any of that: a social page, a map pin, and a phone that rings. The one who publishes the facts somewhere an agent can read them gets the booking.',
    buyerIntent: 'Find a local provider available for a specific job, location, and timeline.',
    offers: [
      { title: 'Emergency visit', copy: 'After-hours availability, response time, and the call-out fee stated up front. The highest-intent search there is.' },
      { title: 'Standard service call', copy: 'Common jobs with typical pricing and a booking or callback path.' },
      { title: 'Quote request', copy: 'For bigger jobs: what you need from the customer, how fast you respond, and what happens next.' },
    ],
    pageMustProve: [
      { title: 'Service area', copy: 'ZIP codes, radius, or neighborhoods. The first question every local request starts with.' },
      { title: 'Availability window', copy: 'Days, hours, emergency rules, and current lead time. Stale availability kills trust instantly.' },
      { title: 'Estimate or payment rules', copy: 'Free or paid estimates, deposits, and accepted payment. No surprises at the door.' },
    ],
    faq: [
      { title: 'I get my work from referrals. Why bother?', copy: 'People now ask assistants for providers like the ones their friends recommend. A listing makes you findable in that moment. It is hosted for you, with a link you can put on a card or truck.' },
      { title: 'My availability changes daily.', copy: 'Connect your calendar and the listing updates itself. That is the point: agents see current availability, not last month.' },
      { title: 'Can an agent actually book me?', copy: 'Yes, through your booking link or calendar integration. For jobs that need a human first, it hands off to a call or quote request.' },
    ],
    cta: 'Create a local service listing',
  },
  {
    slug: 'saas',
    label: 'SaaS',
    templateId: 'productized-package',
    title: 'SaaS implementation and service offers built for agent-led evaluation.',
    description:
      'Clarify plans, implementation packages, integrations, support tiers, and sales handoffs for agents comparing software options.',
    pain:
      'Software evaluation is going agent-first: compare these three tools for a 20-person team and tell me the real cost. Pricing pages built for humans, with toggles, asterisks, and contact-us tiers, do not survive that comparison. The tool that states plans, limits, and implementation cost in structured form gets shortlisted.',
    buyerIntent: 'Compare tools, understand implementation cost, and choose the right plan or sales path.',
    offers: [
      { title: 'Starter plan', copy: 'Entry price, seat and usage limits, and what is not included. The tier agents check first for fit.' },
      { title: 'Implementation package', copy: 'Setup scope, timeline, and cost. The number every real evaluation needs and few sites publish.' },
      { title: 'Enterprise onboarding', copy: 'What the sales path involves, so agents can route bigger buyers to a human with context attached.' },
    ],
    pageMustProve: [
      { title: 'Use case fit', copy: 'The team size, stage, and problem you are built for. Agents filter on fit before they compare features.' },
      { title: 'Plan limits', copy: 'Seats, usage, and feature boundaries in plain terms. Limits buried today surface as churn later.' },
      { title: 'Integration and support path', copy: 'What it connects to and what support each plan includes. Standard evaluation questions, answered up front.' },
    ],
    faq: [
      { title: 'Our pricing is usage-based and complicated.', copy: 'Publish a worked example: a team of 20 typically pays about this much. Agents and buyers both reason better from examples than from formulas.' },
      { title: 'Will this expose our pricing to competitors?', copy: 'Your competitors already know your pricing. The buyer agent that cannot read it is the one you are losing.' },
      { title: 'We sell through demos. Does this bypass sales?', copy: 'No, it feeds sales. The listing qualifies fit and cost up front, so demo requests arrive warmer.' },
    ],
    cta: 'Create a SaaS listing',
  },
  {
    slug: 'marketplaces',
    label: 'Marketplaces',
    templateId: 'productized-package',
    title: 'Marketplace listings that agents can understand as structured inventory.',
    description:
      'Expose providers, merchants, packages, availability, and trust signals in a format agents can search, compare, and route.',
    pain:
      'Your providers are your inventory, but to an agent your marketplace is one opaque page. When an assistant is asked to find a provider for a specific request, it cannot browse your filters. Structured listings per provider turn the whole catalog into something agents can search, compare, and route buyers into.',
    buyerIntent: 'Find the right provider or merchant for a request without manually browsing every listing.',
    offers: [
      { title: 'Provider profile', copy: 'Each provider as a structured record: services, area, pricing signal, and trust markers.' },
      { title: 'Featured package', copy: 'Your best-converting offers as standalone, directly bookable listings.' },
      { title: 'Quote or booking handoff', copy: 'A clear route from an agent match into your marketplace flow, keeping the transaction in your system.' },
    ],
    pageMustProve: [
      { title: 'Provider eligibility', copy: 'Who is allowed on the platform and what vetting they pass. Agents read gatekeeping as trust.' },
      { title: 'Trust and verification', copy: 'Reviews, verification badges, and completion signals in machine-readable form.' },
      { title: 'Clear handoff path', copy: 'Where the agent sends the buyer and what happens next. Ambiguous handoffs lose the transaction.' },
    ],
    faq: [
      { title: 'Does this disintermediate us?', copy: 'The opposite. Handoffs route through your marketplace flow, so you keep the relationship and the transaction while gaining agent-side discovery.' },
      { title: 'We have hundreds of providers.', copy: 'That is the enterprise fit: bulk listing workflows, shared templates, and portfolio-level reporting.' },
      { title: 'Which providers should go first?', copy: 'Your most complete profiles: clear services, prices, availability, and reviews. They perform best and set the pattern for the rest.' },
    ],
    cta: 'Create marketplace-ready listings',
  },
]

export function getUseCase(slug: string): UseCasePage | undefined {
  return useCases.find((useCase) => useCase.slug === slug)
}
