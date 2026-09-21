import {
  ArrowRight,
  Bot,
  CalendarClock,
  FileSpreadsheet,
  Globe2,
  TrendingUp,
  ShieldCheck,
  ShoppingBag,
  Sparkles,
  CheckCircle2,
  Search,
  RefreshCw,
  Handshake,
  ChevronDown,
} from 'lucide-react'
import type { ComponentType } from 'react'
import type { Metadata } from 'next'
import { appUrl, marketingUrl } from '../lib/site'
import { buildPlatformStructuredData } from '../lib/platform-agent-manifest'
import { SimulatorTeaser } from '../components/SimulatorTeaser'
import { AgentXray } from '../components/home/AgentXray'
import { HeroScan } from '../components/home/HeroScan'
import { ReadinessLab } from '../components/home/ReadinessLab'
import { LiveAgentFeed } from '../components/home/LiveAgentFeed'
import { ScrollProgress } from '../components/home/ScrollProgress'
import { ShaderBackdrop } from '../components/home/ShaderBackdrop'
import { ChatGPTLaunchAnnouncement } from '../components/marketing/ChatGPTLaunch'
import { safeJsonScript } from '../lib/safe-json'

// Marketing homepage: fully static (fast on nexez.ai). Product capability demos
// remain available while human marketplace browsing is gated elsewhere.
const metaTitle = 'Nexez - Commerce for AI agents'
const metaDescription =
  'Help customers and AI assistants buy from your business while your prices, requirements, and rules stay under your control.'

export const metadata: Metadata = {
  title: metaTitle,
  description: metaDescription,
  keywords: [
    'AI commerce',
    'AI shopping agents',
    'service commerce',
    'AI-ready business',
    'agent checkout',
    'service pricing',
    'recurring services',
  ],
  alternates: {
    canonical: marketingUrl('/'),
  },
  openGraph: {
    type: 'website',
    siteName: 'Nexez',
    url: marketingUrl('/'),
    title: metaTitle,
    description: metaDescription,
  },
}

type Feature = {
  title: string
  copy: string
  Icon: ComponentType<{ className?: string }>
}

const workflow = [
  {
    step: '01',
    title: 'Connect what you use',
    copy: 'Add your store, calendar, website, or file. Nexez turns it into offers you can edit.',
  },
  {
    step: '02',
    title: 'Set your rules',
    copy: 'Choose what buyers must tell you, what changes the price, and which work you accept.',
  },
  {
    step: '03',
    title: 'Let buyers choose',
    copy: 'A person or AI assistant can choose an offer and provide the details you need.',
  },
  {
    step: '04',
    title: 'Review each sale',
    copy: 'Nexez checks the details and price, then sends the buyer to the right next step.',
  },
]

const keyFeatures: Feature[] = [
  {
    title: 'Pricing and choices',
    copy: 'Set a starting price and show how choices, extras, or quantity change the total.',
    Icon: TrendingUp,
  },
  {
    title: 'Buyer questions',
    copy: 'Ask for the details you need before an order moves forward.',
    Icon: Search,
  },
  {
    title: 'Sale rules',
    copy: 'Choose which requests can continue, which need your review, and which should stop.',
    Icon: ShieldCheck,
  },
  {
    title: 'Repeat services',
    copy: 'Offer ongoing services with the timing and price you choose.',
    Icon: RefreshCw,
  },
  {
    title: 'Agent Simulator',
    copy: 'Try a buying request and see what Nexez understands, what is missing, and what happens next.',
    Icon: Bot,
  },
  {
    title: 'Clear order records',
    copy: 'Keep the offer, buyer details, price, and approvals together.',
    Icon: Handshake,
  },
  {
    title: 'Copilot',
    copy: 'Get help improving your offers while your prices and rules stay in charge.',
    Icon: Sparkles,
  },
  {
    title: 'Your brand, your domain',
    copy: 'Publish on Nexez or your own domain so the storefront still feels like your business.',
    Icon: Globe2,
  },
  {
    title: 'Trust context',
    copy: 'Keep your policies and proof close to each offer so buyers know what they are choosing.',
    Icon: ShieldCheck,
  },
]

// Hero stat ticker (the X-Ray instrument's "instrument readout" framing).
const stats = [
  { value: '<200ms', label: 'Fast pages' },
  { value: '19+', label: 'AI assistants' },
  { value: '10+', label: 'Connections' },
  { value: 'Live', label: 'Sales insights' },
]

const integrationRail = ['Stripe', 'Shopify', 'Square', 'Calendly', 'Acuity', 'Google Calendar']

const integrationGroups: Feature[] = [
  {
    title: 'Products and payments',
    copy: 'Bring in products and prices from Stripe, Shopify, or Square.',
    Icon: ShoppingBag,
  },
  {
    title: 'Booking and calendars',
    copy: 'Connect Calendly, Acuity, or Google Calendar so buyers can book the next step.',
    Icon: CalendarClock,
  },
  {
    title: 'Files and workflows',
    copy: 'Start with your website, CSV, Excel, or Zapier.',
    Icon: FileSpreadsheet,
  },
]

// Agents that read structured pages - monogram lockups for the marquee.
const marqueeModels = [
  { name: 'ChatGPT', mark: 'G' },
  { name: 'Claude', mark: 'C' },
  { name: 'Gemini', mark: 'G' },
  { name: 'Perplexity', mark: 'P' },
  { name: 'Grok', mark: 'X' },
  { name: 'Copilot', mark: 'C' },
  { name: 'Llama', mark: 'L' },
  { name: 'Mistral', mark: 'M' },
  { name: 'DeepSeek', mark: 'D' },
  { name: 'Qwen', mark: 'Q' },
  { name: 'Cohere', mark: 'C' },
  { name: 'Amazon Nova', mark: 'N' },
]

const pinnedStories: Feature[] = [
  {
    title: 'Your prices stay yours.',
    copy: 'You set the price and the choices that change it. Nexez follows those terms.',
    Icon: TrendingUp,
  },
  {
    title: 'Bad-fit orders can stop before payment.',
    copy: 'Set what work you accept. Nexez can continue, ask for your review, or stop the request.',
    Icon: ShieldCheck,
  },
  {
    title: 'Repeat work can stay repeatable.',
    copy: 'Choose the timing and price for repeat services instead of rebuilding each sale by hand.',
    Icon: RefreshCw,
  },
  {
    title: 'AI gets a buying path, not control of your business.',
    copy: 'Customers and AI assistants can choose what you offer and move forward only within your rules.',
    Icon: Bot,
  },
]

const problemCards = [
  {
    title: 'Your website tells the story',
    copy: 'People can browse it, but an AI assistant may still miss the price, choices, or next step.',
  },
  {
    title: 'Missing details slow the sale',
    copy: 'If the buying rules are unclear, an assistant may misunderstand the offer or stop too soon.',
  },
  {
    title: 'Nexez keeps the steps clear',
    copy: 'Your offers, questions, prices, and limits stay together in one buying path.',
  },
]

const valueBullets = [
  'Prices and options you set',
  'Buyer details before checkout',
  'Rules that can stop a bad fit',
  'Repeat services on your terms',
]

const analyticsBullets = [
  'See which assistants and offers bring buyers',
  'See what people want to buy',
  'Follow interest from search to sale',
]

const discoveryFlow = [
  { title: 'Your business', label: 'Your terms', Icon: Globe2 },
  { title: 'Nexez', label: 'Checks the request', Icon: Sparkles },
  { title: 'Buyer or AI', label: 'Can move forward', Icon: Bot },
]

const commerceChips = ['Offers', 'Buyer details', 'Pricing', 'Rules']

const homeStructuredData = buildPlatformStructuredData()

export default function NexezHome() {
  return (
    <main className="nx-home-page">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: safeJsonScript(homeStructuredData) }}
      />
      <ScrollProgress />
      <ChatGPTLaunchAnnouncement />
      {/* HERO + MARQUEE share one smoke field that bleeds across both */}
      <div className="relative overflow-hidden" style={{ background: 'var(--bg)' }}>
        <ShaderBackdrop />
        {/* HERO - text + CTAs on the left, the live agent-readiness scanner on the right */}
        <section
          className="nx-home-hero relative z-10"
          aria-label="Hero"
          data-section-name="Hero"
          style={{
            background:
              'radial-gradient(120% 75% at 50% -12%, color-mix(in srgb, var(--signal) 9%, transparent), transparent 55%)',
          }}
        >
          <p className="sr-only">Hero</p>
        <div className="nx-home-hero-inner relative z-10 mx-auto max-w-7xl px-5 py-16 lg:py-20">
          <div className="nx-home-hero-grid grid items-center gap-10 lg:grid-cols-[minmax(0,0.95fr)_minmax(440px,0.9fr)] lg:gap-12">
            {/* LEFT - h1, copy, CTAs */}
            <div className="nx-home-hero-copy">
              <h1 className="nx-home-hero-title text-balance text-[2.3rem] font-semibold leading-[1.05] tracking-[-0.035em] sm:text-[2.7rem] lg:text-[3.05rem]">
                Turn AI assistants into <span className="nx-accent-text">a sales channel.</span>
              </h1>
              <p className="nx-home-hero-lead mt-6 max-w-xl text-base leading-7 text-muted-foreground md:text-lg">
                AI assistants are already shopping for your customers. Nexez gives them your real
                prices, options, and rules, so the sale happens on your terms.
              </p>
              <div className="nx-home-hero-actions mt-7 flex flex-col gap-3 sm:flex-row">
                <a href={appUrl('/create')} className="btn-secondary h-11 px-5">
                  List your offers
                </a>
                <a href="/how-it-works" className="nx-home-hero-secondary btn-secondary h-11 px-5">See how it works</a>
              </div>

              {/* stat ticker - compact, tucked under the CTAs beside the scanner */}
              <div className="nx-home-proof-grid mt-7 flex max-w-xl overflow-hidden rounded-[11px] border border-border" style={{ background: 'var(--ov-02)' }}>
                {stats.map((s, i) => (
                  <div key={s.label} className={`flex-1 px-3 py-2.5 ${i < stats.length - 1 ? 'border-r border-border' : ''}`}>
                    <div className="font-display text-base font-bold tracking-[-0.02em] sm:text-lg">{s.value}</div>
                    <div className="mt-0.5 text-[10px] leading-tight text-muted-foreground">{s.label}</div>
                  </div>
                ))}
              </div>
            </div>

            {/* RIGHT - the live scanner: free, anonymous, and the fastest proof we have */}
            <div className="nx-home-hero-scan mt-[0.15rem] md:mt-0">
              <HeroScan />
            </div>
          </div>
        </div>
      </section>

      {/* AGENT LOGO MARQUEE */}
      <section
        className="nx-home-agent-proof relative z-10"
        aria-label="Built for the AI assistants buyers use"
        data-section-name="Built for the AI assistants buyers use"
      >
        <div className="mx-auto max-w-7xl px-5 py-10">
          <p className="mb-7 text-center font-mono text-[11px] uppercase tracking-[0.16em] text-muted-foreground">
            Works with the AI assistants buyers use
          </p>
          <div className="nx-marquee">
            <div className="nx-marquee-track">
              {[...marqueeModels, ...marqueeModels].map((m, i) => (
                <span
                  key={`${m.name}-${i}`}
                  aria-hidden={i >= marqueeModels.length}
                  className="inline-flex shrink-0 items-center gap-2.5 whitespace-nowrap px-6"
                >
                  <span className="flex size-[27px] items-center justify-center rounded-[7px] border border-border bg-white/[0.03] font-mono text-[13px] font-bold text-muted-foreground">
                    {m.mark}
                  </span>
                  <span className="font-mono text-[18px] font-medium text-[var(--fg-muted-2)]">{m.name}</span>
                </span>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* MERCHANT INTEGRATION PROOF */}
      <section
        className="nx-home-integration-proof relative z-10 border-t border-border"
        aria-label="Connects with the tools your business already uses"
        data-section-name="Integration proof"
      >
        <div className="mx-auto max-w-7xl px-5 py-8">
          <p className="text-center font-mono text-[11px] uppercase tracking-[0.16em] text-muted-foreground">
            Connects with the tools your business already uses
          </p>
          <div className="mt-5 flex flex-wrap items-center justify-center gap-2">
            {integrationRail.map((provider) => (
              <span
                key={provider}
                className="rounded-full border border-border bg-white/[0.025] px-3 py-1.5 text-xs font-medium text-[var(--fg-muted-2)]"
              >
                {provider}
              </span>
            ))}
          </div>
          <p className="mt-4 text-center text-xs text-muted-foreground">
            Plus your website, CSV, Excel, and Zapier.
          </p>
        </div>
      </section>
      </div>

      {/* PROBLEM */}
      <section
        className="nx-home-reveal-band border-b border-border"
        aria-label="Problem"
        data-section-name="Problem"
        style={{ position: 'relative', zIndex: 1 }}
      >
        <p className="sr-only">Problem</p>
        <div className="nx-home-section-inner nx-home-problem-layout mx-auto grid max-w-7xl gap-10 px-5 py-20 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)] lg:items-start" data-reveal>
          <div>
            <h2 className="max-w-3xl text-[1.7rem] font-semibold leading-[1.12] tracking-[-0.025em] md:text-[2.15rem]">
              Your site was built for eyes. <span className="nx-accent-text">AI assistants read it differently.</span>
            </h2>
            <p className="mt-4 max-w-xl text-sm leading-6 text-muted-foreground md:text-base">
              A person fills in the gaps without noticing. An assistant cannot. It needs the exact
              price, the exact options, the requirement, and a safe next step. Here is the same
              business, twice.
            </p>
            <div className="nx-home-problem-xray w-full md:mt-9">
              <AgentXray />
            </div>
          </div>
          <div className="grid gap-4">
            <div className="nx-tile overflow-hidden p-5" role="group" aria-label="Nexez buying flow">
              <div className="nx-home-flow-mobile grid gap-2 sm:hidden">
                {discoveryFlow.map(({ title, label, Icon }, index) => (
                  <div key={title} className="flex items-center gap-3 rounded-lg border border-border bg-white/[0.035] p-3">
                    <span className="font-mono text-[10px] text-[var(--signal)]">0{index + 1}</span>
                    <div className="flex size-8 shrink-0 items-center justify-center rounded-md border border-border bg-black">
                      <Icon className="size-3.5 text-[var(--fg-muted)]" />
                    </div>
                    <div className="min-w-0">
                      <p className="text-sm font-medium tracking-tight">{title}</p>
                      <p className="mt-0.5 text-xs text-muted-foreground">{label}</p>
                    </div>
                  </div>
                ))}
              </div>
              <div className="nx-home-flow relative hidden gap-3 sm:grid sm:grid-cols-[1fr_auto_1fr_auto_1fr] sm:items-stretch">
                {discoveryFlow.map(({ title, label, Icon }, index) => (
                  <div key={title} className="contents">
                    <div className="flex h-full flex-col rounded-lg border border-border bg-white/[0.035] p-4">
                      <div className="flex items-center justify-between gap-3">
                        <div className="flex size-9 shrink-0 items-center justify-center rounded-md border border-border bg-black">
                          <Icon className="size-4 text-[var(--fg-muted)]" />
                        </div>
                        <span className="text-right font-mono text-[10px] uppercase leading-[1.5] tracking-[0.14em] text-muted-foreground">
                          {label}
                        </span>
                      </div>
                      <p className="mt-auto whitespace-nowrap pt-5 text-sm font-medium tracking-tight">{title}</p>
                    </div>
                    {index < discoveryFlow.length - 1 ? (
                      <div className="hidden items-center justify-center sm:flex">
                        <div className="nx-flow-line" />
                        <ArrowRight className="mx-2 size-4 shrink-0 text-[var(--signal)]" />
                        <div className="nx-flow-line" />
                      </div>
                    ) : null}
                  </div>
                ))}
              </div>
              <div className="nx-home-commerce-chips mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
                {commerceChips.map((chip) => (
                  <span
                    key={chip}
                    className="rounded-md border border-border bg-black/20 px-3 py-2 text-center font-mono text-[11px] text-muted-foreground"
                  >
                    {chip}
                  </span>
                ))}
              </div>
            </div>
            <div className="nx-home-problem-mobile nx-tile hidden divide-y divide-border px-4">
              {problemCards.map(({ title, copy }) => (
                <div key={title} className="py-3.5">
                  <h3 className="text-sm font-medium tracking-tight">{title}</h3>
                  <p className="mt-1 text-xs leading-5 text-muted-foreground">{copy}</p>
                </div>
              ))}
            </div>
            <div className="nx-home-problem-desktop hidden gap-3 sm:grid sm:grid-cols-3 lg:grid-cols-1">
              {problemCards.map(({ title, copy }) => (
                <div key={title} className="nx-tile p-5">
                  <h3 className="text-sm font-medium tracking-tight">{title}</h3>
                  <p className="mt-2 text-sm leading-6 text-muted-foreground">{copy}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* WHY IT MATTERS */}
      <section
        id="readiness"
        className="nx-home-reveal-band border-b border-border"
        aria-label="Why it matters"
        data-section-name="Why it matters"
        style={{ position: 'relative', zIndex: 2 }}
      >
        <p className="sr-only">Why it matters</p>
        <div className="nx-home-section-inner mx-auto max-w-7xl px-5 py-20" data-reveal>
          <h2 className="max-w-3xl text-[1.7rem] font-semibold leading-[1.12] tracking-[-0.025em] md:text-[2.15rem]">
            Six signals. <span className="nx-accent-text">Each one turns on something an AI assistant can do.</span>
          </h2>
          <p className="mt-4 max-w-2xl text-sm leading-6 text-muted-foreground md:text-base">
            That gap breaks down into six things. Your score is
            the number the scan at the top of this page gives you, and the number Nexez moves.
          </p>
          <div className="nx-home-readiness mt-10">
            <ReadinessLab />
          </div>
        </div>
      </section>

      {/* WORKFLOW */}
      <section
        id="how-it-works"
        className="nx-home-static-band border-b border-border"
        aria-label="How it works"
        data-section-name="How it works"
        style={{ zIndex: 3 }}
      >
        <p className="sr-only">How it works</p>
        <div className="nx-home-section-inner mx-auto max-w-7xl px-5 py-20">
          <div className="mb-10 max-w-2xl">
            <h2 className="text-[1.7rem] font-semibold leading-[1.12] tracking-[-0.025em] md:text-[2.15rem]">
              Four simple steps. <span className="nx-accent-text">Your rules stay in charge.</span>
            </h2>
            <p className="mt-4 max-w-xl text-sm leading-6 text-muted-foreground md:text-base">
              Closing those gaps takes four steps. Nothing goes live until you approve it.
            </p>
          </div>
          <div className="nx-home-workflow-mobile grid md:hidden">
            {workflow.map((item) => (
              <div key={item.step} className="nx-home-workflow-step grid grid-cols-[36px_minmax(0,1fr)] gap-3">
                <div className="relative z-10 flex size-9 items-center justify-center rounded-full border border-[var(--signal)]/35 bg-black font-mono text-[10px] text-[var(--signal)]">
                  {item.step}
                </div>
                <div className="pt-1">
                  <h3 className="text-sm font-medium">{item.title}</h3>
                  <p className="mt-1 text-xs leading-5 text-muted-foreground">{item.copy}</p>
                </div>
              </div>
            ))}
          </div>
          <div className="nx-home-workflow-desktop hidden gap-4 md:grid md:grid-cols-2 xl:grid-cols-4">
            {workflow.map((item, i) => (
              <div key={item.step} data-reveal className="nx-tile p-5">
                <div className="flex items-center justify-between">
                  <p className="font-mono text-xs text-muted-foreground">{item.step}</p>
                  {i < workflow.length - 1 ? <ArrowRight className="size-4 text-white/20" /> : <CheckCircle2 className="size-4 text-[var(--ready)]/60" />}
                </div>
                <h3 className="mt-4 text-xl font-medium">{item.title}</h3>
                <p className="mt-2 text-sm leading-6 text-muted-foreground">{item.copy}</p>
              </div>
            ))}
          </div>
          <div className="mt-7">
            <a href="/how-it-works" className="inline-flex items-center gap-2 text-sm font-medium text-[var(--signal)]">
              See the full buying journey
              <ArrowRight className="size-4" />
            </a>
          </div>
        </div>
      </section>

      {/* INTEGRATIONS */}
      <section
        id="integrations"
        className="nx-home-static-band border-b border-border"
        aria-label="Integrations"
        data-section-name="Integrations"
        style={{ zIndex: 4 }}
      >
        <div className="nx-home-section-inner mx-auto max-w-7xl px-5 py-20">
          <div className="nx-home-integration-layout grid gap-8 lg:grid-cols-[minmax(0,0.82fr)_minmax(0,1.18fr)] lg:items-start">
            <div>
              <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-[var(--signal)]">
                Integrations
              </p>
              <h2 className="mt-4 max-w-xl text-[1.7rem] font-semibold leading-[1.12] tracking-[-0.025em] md:text-[2.15rem]">
                Your existing tools become <span className="nx-accent-text">one clear buying path.</span>
              </h2>
              <p className="mt-4 max-w-xl text-sm leading-6 text-muted-foreground md:text-base">
                Start with what you already have. Bring in your products, prices, and calendar.
                Review every offer before it goes live.
              </p>
              <a href="/integrations" className="mt-7 inline-flex items-center gap-2 text-sm font-medium text-[var(--signal)]">
                Explore integrations
                <ArrowRight className="size-4" />
              </a>
            </div>
            <div className="nx-home-integration-mobile grid grid-cols-2 gap-2 md:hidden">
              {integrationRail.map((provider) => (
                <div key={provider} className="nx-tile flex min-h-12 items-center gap-2 px-3 py-2.5">
                  <CheckCircle2 className="size-3.5 shrink-0 text-[var(--ready)]" />
                  <span className="text-xs font-medium">{provider}</span>
                </div>
              ))}
            </div>
            <div className="nx-home-integration-desktop hidden gap-4 md:grid md:grid-cols-3 lg:grid-cols-1 xl:grid-cols-3">
              {integrationGroups.map(({ title, copy, Icon }) => (
                <article key={title} className="nx-tile p-5">
                  <div className="flex size-9 items-center justify-center rounded-md border border-border bg-black">
                    <Icon className="size-4 text-[var(--fg-muted)]" />
                  </div>
                  <h3 className="mt-5 text-sm font-medium tracking-tight">{title}</h3>
                  <p className="mt-2 text-sm leading-6 text-muted-foreground">{copy}</p>
                </article>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* PRODUCT CAPABILITIES */}
      <section
        id="capabilities"
        className="nx-home-static-band nx-home-reveal-band--tint-01 border-b border-border overflow-hidden"
        aria-label="Product capabilities"
        data-section-name="Product capabilities"
        style={{ position: 'relative', zIndex: 5 }}
      >
        <p className="sr-only">Product capabilities</p>
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0"
          style={{
            backgroundImage:
              'radial-gradient(circle, color-mix(in srgb, var(--signal) 7%, transparent) 1px, transparent 1px)',
            backgroundSize: '24px 24px',
            WebkitMaskImage: 'radial-gradient(110% 75% at 50% 8%, #000, transparent 72%)',
            maskImage: 'radial-gradient(110% 75% at 50% 8%, #000, transparent 72%)',
          }}
        />
        <div className="nx-home-section-inner relative z-10 mx-auto max-w-7xl px-5 py-20">
          <div className="mb-10 max-w-2xl">
            <h2 className="text-[1.7rem] font-semibold leading-[1.12] tracking-[-0.025em] md:text-[2.15rem]">
              Everything a sale needs, <span className="nx-accent-text">in one place.</span>
            </h2>
            <p className="mt-4 max-w-xl text-sm leading-6 text-muted-foreground md:text-base">
              This is what every sale runs on. Tell Nexez how your business works. It keeps the
              buying steps clear.
            </p>
          </div>
          <div className="nx-home-feature-mobile md:hidden">
            <div className="grid grid-cols-2 gap-3">
              {keyFeatures.slice(0, 4).map(({ title, copy, Icon }) => (
                <div key={title} className="card flex min-h-24 flex-col items-start gap-3 !p-4" title={copy}>
                  <div className="flex size-9 shrink-0 items-center justify-center rounded-md border border-border bg-black">
                    <Icon className="size-4 text-[var(--fg-muted)]" />
                  </div>
                  <h3 className="text-sm font-medium leading-5 tracking-tight">{title}</h3>
                </div>
              ))}
            </div>
            <details className="nx-home-capabilities-disclosure mt-3">
              <summary className="nx-tile">
                <span className="nx-home-capabilities-closed">View all capabilities</span>
                <span className="nx-home-capabilities-open">Show fewer capabilities</span>
                <ChevronDown aria-hidden="true" className="nx-home-disclosure-chevron size-4 text-muted-foreground" />
              </summary>
              <div className="mt-3 grid gap-3">
                {keyFeatures.map(({ title, copy, Icon }) => (
                  <div key={title} className="card flex items-start gap-3 !p-4">
                    <div className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-md border border-border bg-black">
                      <Icon className="size-4 text-[var(--fg-muted)]" />
                    </div>
                    <div>
                      <h3 className="text-sm font-medium tracking-tight">{title}</h3>
                      <p className="mt-1 text-xs leading-5 text-muted-foreground">{copy}</p>
                    </div>
                  </div>
                ))}
              </div>
            </details>
          </div>
          <div className="nx-home-feature-desktop hidden gap-4 md:grid md:grid-cols-2 xl:grid-cols-3">
            {keyFeatures.map(({ title, copy, Icon }) => (
              <div key={title} data-reveal className="card flex items-start gap-3">
                <div className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-md border border-border bg-black">
                  <Icon className="size-4 text-[var(--fg-muted)]" />
                </div>
                <div>
                  <h3 className="text-sm font-medium tracking-tight">{title}</h3>
                  <p className="mt-1 text-xs leading-5 text-muted-foreground">{copy}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ANALYTICS */}
      <section
        id="analytics"
        className="nx-home-reveal-band border-b border-border"
        aria-label="Analytics"
        data-section-name="Analytics"
        style={{ position: 'relative', zIndex: 6 }}
      >
        <p className="sr-only">Analytics</p>
        <div className="nx-home-section-inner mx-auto max-w-7xl px-5 py-20" data-reveal>
          <div className="nx-home-analytics-head grid gap-8 lg:grid-cols-[minmax(0,0.95fr)_minmax(0,1.05fr)] lg:items-start">
            <div>
              <h2 className="max-w-3xl text-[1.7rem] font-semibold leading-[1.12] tracking-[-0.025em] md:text-[2.15rem]">
                See where your AI buyers come from.
              </h2>
              <p className="mt-4 max-w-xl text-sm leading-6 text-muted-foreground md:text-base">
                Every request is recorded. See what buyers want, which offers get
                attention, and what leads to a sale.
              </p>
            </div>
            <ul className="nx-home-analytics-points nx-tile hidden gap-3 p-5 text-sm text-muted-foreground md:grid md:p-6">
              {analyticsBullets.map((item) => (
                <li key={item} className="flex items-center gap-3">
                  <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-[var(--ready)]" />
                  <span>{item}</span>
                </li>
              ))}
            </ul>
          </div>
          <div className="nx-home-analytics-demo mt-10">
            <LiveAgentFeed />
          </div>
        </div>
      </section>

      {/* PINNED STORY CARDS */}
      <section
        className="nx-home-reveal-band--tint-015 border-b border-border"
        aria-label="Merchant control"
        data-section-name="Merchant control"
        data-benefits-section-name="Benefits"
        style={{ position: 'relative', zIndex: 7 }}
      >
        <p className="sr-only">Merchant control</p>
        <p className="sr-only">Benefits</p>
        <div className="nx-home-section-inner nx-home-control-layout mx-auto grid max-w-7xl gap-10 px-5 py-20 lg:grid-cols-[minmax(0,0.82fr)_minmax(0,1.18fr)] lg:items-start">
          <div className="lg:sticky lg:top-24">
            <h2 className="max-w-xl text-[1.7rem] font-semibold leading-[1.12] tracking-[-0.025em] md:text-[2.15rem]">
              Sell through AI assistants. <span className="nx-accent-text">Keep control of how you sell.</span>
            </h2>
            <p className="mt-5 max-w-lg text-sm leading-6 text-muted-foreground md:text-base">
              None of this changes who sets the terms. Buyers can move forward without changing your prices, skipping your requirements, or promising work you did not approve.
            </p>
            <ul className="nx-home-value-list mt-7 grid gap-3 text-sm text-muted-foreground sm:grid-cols-2">
              {valueBullets.map((item) => (
                <li key={item} className="flex items-center gap-3">
                  <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-[var(--ready)]" />
                  <span>{item}</span>
                </li>
              ))}
            </ul>
          </div>

          <div>
            <h3 className="text-lg font-semibold tracking-[-0.015em] md:text-xl">What stays under your control</h3>
            <div className="nx-home-story-mobile mt-5 grid gap-3 md:hidden">
              {pinnedStories.map(({ title, copy, Icon }, index) => (
                <details key={title} name="merchant-control" open={index === 0} className="nx-home-story-disclosure nx-tile">
                  <summary>
                    <div className="flex min-w-0 items-center gap-3">
                      <div className="flex size-9 shrink-0 items-center justify-center rounded-lg border border-border bg-black">
                        <Icon className="size-4 text-[var(--fg-muted)]" />
                      </div>
                      <span className="text-sm font-semibold leading-5">{title}</span>
                    </div>
                    <ChevronDown aria-hidden="true" className="nx-home-disclosure-chevron size-4 shrink-0 text-muted-foreground" />
                  </summary>
                  <div className="border-t border-border px-4 pb-4 pt-3">
                    <p className="text-sm leading-6 text-muted-foreground">{copy}</p>
                    <p className="mt-3 text-xs font-medium text-[var(--signal)]">
                      {index === 0
                        ? 'Your pricing'
                        : index === 1
                          ? 'Your limits'
                          : index === 2
                            ? 'Your timing'
                            : 'Your business'}
                    </p>
                  </div>
                </details>
              ))}
            </div>
            <div className="nx-home-story-desktop mt-5 hidden gap-5 pb-0 md:grid lg:pb-[34vh]">
              {pinnedStories.map(({ title, copy, Icon }, index) => (
                <article
                  key={title}
                  className="nx-home-story-card nx-tile min-h-[320px] p-6 transition-colors lg:!sticky lg:min-h-[360px]"
                  style={{ top: `${96 + index * 18}px`, zIndex: index + 1 }}
                >
                  <div className="flex h-full flex-col justify-between gap-10">
                    <div>
                      <div className="flex size-10 items-center justify-center rounded-lg border border-border bg-black">
                        <Icon className="size-4 text-[var(--fg-muted)]" />
                      </div>
                      <h3 className="mt-6 max-w-xl text-lg font-semibold leading-tight tracking-[-0.015em] md:text-2xl">{title}</h3>
                      <p className="mt-4 max-w-xl text-sm leading-6 text-muted-foreground md:text-base">{copy}</p>
                    </div>
                    <div className="flex items-center justify-between border-t border-border pt-5">
                      <span className="font-mono text-xs text-muted-foreground">0{index + 1} / 04</span>
                      <span className="inline-flex items-center gap-2 text-sm font-medium text-[var(--signal)]">
                        {index === 0
                          ? 'Your pricing'
                          : index === 1
                            ? 'Your limits'
                            : index === 2
                              ? 'Your timing'
                              : 'Your business'}
                        <ArrowRight className="size-4" />
                      </span>
                    </div>
                  </div>
                </article>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* The simulator demonstrates platform capability without exposing Discovery. */}
      <section
        id="simulator"
        className="nx-home-simulator nx-home-static-band nx-home-reveal-band--tint-02 border-b border-border py-20"
        aria-label="Agent simulator"
        data-section-name="Agent simulator"
        style={{ zIndex: 8 }}
      >
        <p className="sr-only">Agent simulator</p>
        <div className="mx-auto max-w-4xl px-5 text-center" data-reveal>
          <h2 className="text-[1.7rem] font-semibold leading-[1.12] tracking-[-0.025em] md:text-[2.15rem]">
            Run a buying scenario before a real buyer does.
          </h2>
          <p className="mx-auto mt-4 max-w-2xl text-sm leading-6 text-muted-foreground md:text-base">
            Test it before you publish. See what an AI assistant understands, what details are missing, and whether the request can move forward.
          </p>
          <div className="mt-8">
            <SimulatorTeaser />
          </div>
        </div>
      </section>

      {/* FINAL CTA */}
      <section
        className="nx-home-static-band relative overflow-hidden"
        aria-label="Final call to action"
        data-section-name="Final call to action"
        style={{ zIndex: 9 }}
      >
        <p className="sr-only">Final call to action</p>
        <div className="pointer-events-none absolute inset-0 z-0">
          <div className="nx-orb nx-orb--purple !opacity-25" style={{ top: 'auto', bottom: '-22rem', left: '50%', transform: 'translateX(-50%)' }} />
        </div>
        <div className="nx-home-final-inner relative z-10 mx-auto max-w-3xl px-5 py-24 text-center" data-reveal>
          <h2 className="text-[2rem] font-semibold leading-tight tracking-[-0.03em] md:text-[2.75rem]">
            Make your business easier for <span className="nx-accent-text">people and AI to buy from.</span>
          </h2>
          <p className="mx-auto mt-4 max-w-xl text-sm leading-6 text-muted-foreground md:text-base">
            Add your offers, set your rules, and be ready when the next buyer arrives.
          </p>
          <div className="nx-home-final-actions mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
            <a href={appUrl('/create')} className="btn-primary h-11 px-5">
              List your offers
            </a>
            <a href="/how-it-works" className="nx-home-final-secondary btn-secondary h-11 px-5">See how it works</a>
          </div>
        </div>
      </section>
    </main>
  )
}
