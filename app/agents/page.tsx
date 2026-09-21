import type { Metadata } from 'next'
import {
  ArrowRight,
  Bot,
  CheckCircle2,
  Code2,
  ExternalLink,
  Globe2,
  Search,
  ShieldCheck,
  Terminal,
} from 'lucide-react'
import { CodeCopyButton } from '../../components/CodeCopyButton'
import { ChatGPTInstallCard } from '../../components/marketing/ChatGPTLaunch'
import {
  NEXEZ_AGENT_EXAMPLES,
  NEXEZ_OPENCLAW_PLUGIN,
  NEXEZ_OPENCLAW_SKILL,
  NEXEZ_PYTHON_SDK,
  NEXEZ_TYPESCRIPT_SDK,
  buildAgentDistributionLinks,
} from '../../lib/agent-distribution'
import { agentRuntimeUrl, appUrl, marketingUrl } from '../../lib/site'
import { MARKETPLACE_DISCOVERY_ENABLED } from '../../lib/marketplace-discovery'
import { safeJsonScript } from '../../lib/safe-json'

export const metadata: Metadata = {
  title: 'AI Agent Access and Distribution',
  description:
    'Install Nexez Buyer in ChatGPT to find, compare, and check offers. Explore OpenClaw tools, SDKs, and APIs for custom agent workflows.',
  alternates: {
    canonical: marketingUrl('/agents'),
  },
  // Page-level openGraph replaces the layout's wholesale (shallow merge) - re-carry type/siteName.
  openGraph: {
    type: 'website',
    siteName: 'Nexez',
    url: marketingUrl('/agents'),
    title: 'AI Agent Access and Distribution',
    description:
      'Install Nexez Buyer in ChatGPT to find, compare, and check offers. Explore OpenClaw tools, SDKs, and APIs for custom agent workflows.',
  },
}

const distribution = buildAgentDistributionLinks()

const installCards = [
  {
    label: 'Native tool plugin',
    title: NEXEZ_OPENCLAW_PLUGIN.displayName,
    version: NEXEZ_OPENCLAW_PLUGIN.version,
    command: NEXEZ_OPENCLAW_PLUGIN.installCommand,
    copy: NEXEZ_OPENCLAW_PLUGIN.purpose,
  },
  {
    label: 'Discovery skill',
    title: NEXEZ_OPENCLAW_SKILL.displayName,
    version: NEXEZ_OPENCLAW_SKILL.version,
    command: NEXEZ_OPENCLAW_SKILL.installCommand,
    copy: NEXEZ_OPENCLAW_SKILL.purpose,
  },
]

const sdkCards = [
  {
    label: 'Published npm',
    title: NEXEZ_TYPESCRIPT_SDK.displayName,
    version: NEXEZ_TYPESCRIPT_SDK.version,
    command: NEXEZ_TYPESCRIPT_SDK.installCommand,
    href: NEXEZ_TYPESCRIPT_SDK.npmUrl,
    hrefLabel: 'npm',
    copy: NEXEZ_TYPESCRIPT_SDK.purpose,
  },
  {
    label: 'Published PyPI',
    title: NEXEZ_PYTHON_SDK.displayName,
    version: NEXEZ_PYTHON_SDK.version,
    command: NEXEZ_PYTHON_SDK.installCommand,
    href: NEXEZ_PYTHON_SDK.pypiUrl,
    hrefLabel: 'PyPI',
    copy: NEXEZ_PYTHON_SDK.purpose,
  },
]

const exampleCards = [
  {
    title: 'Buyer approval',
    path: 'examples/agents/python/buyer_approval.py',
    href: '/developers/buyer-approval',
    copy: 'Build a consent card with seller, offer, terms, risk notes, dry-run result, and explicit approval copy.',
  },
  {
    title: 'Find and validate',
    path: 'examples/agents/python/find_and_validate.py',
    copy: 'Search by buyer intent, fetch the listing manifest, then dry-run checkout or negotiation before any action.',
  },
  {
    title: 'Location shortlist',
    path: 'examples/agents/python/location_shortlist.py',
    copy: 'Rank nearby or remote matches, compare actionability, validate the top offer, and stop for buyer approval.',
  },
  {
    title: 'Submit negotiation',
    path: 'examples/agents/python/submit_negotiation.py',
    copy: 'Prepare terms, validate rules, stop for buyer approval, submit, then poll the returned status URL.',
  },
  {
    title: 'TypeScript parity',
    path: 'examples/agents/typescript',
    copy: 'The same agent workflows are mirrored for builders using the published TypeScript SDK.',
  },
]

const endpoints = [
  {
    label: 'Search',
    href: agentRuntimeUrl('/api/agent-search?q=strategy%20session'),
    value: `${distribution.runtime_base_url}/api/agent-search?q={query}`,
    copy: 'Find matching listings and offer-level actions from a buyer request.',
  },
  {
    label: 'Index',
    href: distribution.agent_index_url,
    value: distribution.agent_index_url,
    copy: 'List published listings, manifests, readiness, offers, and checkout URLs.',
  },
  {
    label: 'LLM guide',
    href: distribution.llms_url,
    value: distribution.llms_url,
    copy: 'Plain-text global context for agents that read llms.txt first.',
  },
  {
    label: 'OpenAPI',
    href: distribution.openapi_url,
    value: distribution.openapi_url,
    copy: 'Schemas and operation IDs for agent builders and action catalogs.',
  },
  {
    label: 'MCP catalog',
    href: distribution.mcp_discovery_url,
    value: distribution.mcp_discovery_url,
    copy: 'Discovery catalog for listings exposing MCP-compatible resources.',
  },
  {
    label: 'ARD catalog',
    href: agentRuntimeUrl('/.well-known/ai-catalog.json'),
    value: `${distribution.runtime_base_url}/.well-known/ai-catalog.json`,
    copy: 'Agentic Resource Discovery manifest so registries can index every Nexez MCP server by capability.',
  },
  {
    label: 'Capabilities',
    href: distribution.capabilities_url,
    value: distribution.capabilities_url,
    copy: 'Compact manifest describing Nexez endpoints, safety posture, and distribution.',
  },
]

const workflow = [
  {
    title: 'Search by buyer intent',
    copy: 'Use the directory, plugin tool, or search API with natural buyer language.',
    sample: 'Find a Chicago consultant for a one-week growth audit.',
  },
  {
    title: 'Read the listing manifest',
    copy: 'Fetch agent.json or llms.txt for seller context, offers, FAQs, policies, and direct actions.',
    sample: '/{slug}/agent.json',
  },
  {
    title: 'Validate before acting',
    copy: 'Dry-run checkout or negotiation so the agent can confirm the handoff before money or contact occurs.',
    sample: 'POST /api/checkout { dryRun: true }',
  },
  {
    title: 'Hand off with approval',
    copy: 'After user approval, open checkout, submit negotiation terms, or route to the seller action URL.',
    sample: 'checkout, negotiate, book, or contact',
  },
]

const safetyRules = [
  'Public discovery requires no secret.',
  'Use dry-run validation before checkout or negotiation.',
  'Do not infer private seller rules from public constraints.',
  'Ask for buyer approval before spending money or contacting a seller.',
]

const manifestPreview = {
  schema_version: 'nexez.agent-access.v1',
  docs_url: distribution.docs_url,
  runtime_base_url: distribution.runtime_base_url,
  openclaw: {
    plugin: {
      name: NEXEZ_OPENCLAW_PLUGIN.name,
      version: NEXEZ_OPENCLAW_PLUGIN.version,
      install: NEXEZ_OPENCLAW_PLUGIN.installCommand,
    },
    skill: {
      slug: NEXEZ_OPENCLAW_SKILL.slug,
      version: NEXEZ_OPENCLAW_SKILL.version,
      install: NEXEZ_OPENCLAW_SKILL.installCommand,
    },
  },
  sdks: {
    typescript: {
      name: NEXEZ_TYPESCRIPT_SDK.name,
      version: NEXEZ_TYPESCRIPT_SDK.version,
      status: NEXEZ_TYPESCRIPT_SDK.status,
      install: NEXEZ_TYPESCRIPT_SDK.installCommand,
      package: NEXEZ_TYPESCRIPT_SDK.npmUrl,
      source: NEXEZ_TYPESCRIPT_SDK.sourcePath,
    },
    python: {
      name: NEXEZ_PYTHON_SDK.name,
      module: NEXEZ_PYTHON_SDK.moduleName,
      version: NEXEZ_PYTHON_SDK.version,
      status: NEXEZ_PYTHON_SDK.status,
      install: NEXEZ_PYTHON_SDK.installCommand,
      package: NEXEZ_PYTHON_SDK.pypiUrl,
      source: NEXEZ_PYTHON_SDK.sourceUrl,
    },
  },
  examples: NEXEZ_AGENT_EXAMPLES.sourceUrl,
  endpoints: {
    search: distribution.agent_search_url_template,
    index: distribution.agent_index_url,
    llms: distribution.llms_url,
    openapi: distribution.openapi_url,
    mcp: distribution.mcp_discovery_url,
    ard_catalog: `${distribution.runtime_base_url}/.well-known/ai-catalog.json`,
  },
}

const manifestText = JSON.stringify(manifestPreview, null, 2)
const sdkExample = `import { createNexezClient } from '@nexez/agent-sdk'

const nexez = createNexezClient()

const matches = await nexez.search('book a strategy session next week', {
  location: 'Chicago, IL',
  limit: 5,
})

const first = matches.results[0]
const page = await nexez.getAgentPage(first.page.slug)

await nexez.validateCheckout({
  slug: first.page.slug,
  offer: first.offer?.key ?? 'services-0',
  query: 'Buyer wants a strategy session next week.',
  buyerAgent: 'buyer-agent',
})`

const pythonSdkExample = `from nexez_agent_sdk import create_client

nexez = create_client(buyer_agent="buyer-agent")

matches = nexez.search(
    "book a strategy session next week",
    location="Chicago, IL",
    limit=5,
)

first = matches["results"][0]
page = nexez.get_agent_page(first["page"]["slug"])

nexez.validate_negotiation(
    slug=page["page"]["slug"],
    offer=first.get("offer", {}).get("key", "services-0"),
    query="Buyer wants a strategy session next week.",
    budget="USD 2100",
)`

export default function AgentAccessPage() {
  return (
    <main className="min-h-screen">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: safeJsonScript({
            '@context': 'https://schema.org',
            '@type': 'TechArticle',
            name: 'Nexez AI Agent Access',
            description: metadata.description,
            url: marketingUrl('/agents'),
            publisher: {
              '@type': 'Organization',
              name: 'Nexez',
              url: marketingUrl('/'),
            },
            about: ['AI agent commerce', 'Nexez Buyer', 'ChatGPT', 'OpenClaw', 'llms.txt', 'MCP', 'OpenAPI', 'Agentic Resource Discovery'],
          }),
        }}
      />

      <section className="relative overflow-hidden border-b border-border bg-white/[0.015]">
        <div className="pointer-events-none absolute inset-0 opacity-[0.18]">
          <div className="nx-grid" />
        </div>
        <div className="relative z-10 mx-auto grid max-w-7xl gap-10 px-5 py-20 lg:grid-cols-[minmax(0,0.88fr)_minmax(420px,0.72fr)] lg:items-center lg:py-24">
          <div>
            <div className="inline-flex items-center gap-2 rounded-full border border-[var(--signal)]/30 bg-[var(--signal)]/10 px-3 py-1.5 font-mono text-[11px] uppercase tracking-[0.16em] text-[var(--signal)]">
              <Bot className="size-3.5" />
              AI Agent Access
            </div>
            <h1 className="mt-6 max-w-4xl text-balance text-5xl font-semibold leading-[0.95] tracking-[-0.06em] sm:text-6xl lg:text-7xl">
              Give agents a clean path into <span className="nx-accent-text">Nexez.</span>
            </h1>
            <p className="mt-6 max-w-2xl text-base leading-7 text-muted-foreground md:text-lg">
              Start with Nexez Buyer in ChatGPT to find, compare, and check offers without code.
              Building your own agent? Explore OpenClaw tools, SDKs, and the published API contracts below.
            </p>
            <div className="mt-8 flex flex-col gap-3 sm:flex-row">
              <a href="#chatgpt" className="btn-primary h-11 px-5">
                Use Nexez Buyer
                <ArrowRight className="size-4" />
              </a>
              <a href="#install" className="btn-secondary h-11 px-5">
                Developer install options
              </a>
            </div>
            <a href={agentRuntimeUrl('/agent-pages.json')} className="mt-4 inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground">
              Open the live agent index <ExternalLink className="size-3.5" />
            </a>
          </div>

          <div className="nx-glass-panel overflow-hidden p-0">
            <div className="flex items-center justify-between border-b border-border px-5 py-4">
              <div className="flex items-center gap-2">
                <div className="flex size-8 items-center justify-center rounded-md border border-border bg-black/40">
                  <Terminal className="size-4 text-[var(--signal)]" />
                </div>
                <div>
                  <p className="text-sm font-medium">agent-access.json</p>
                  <p className="font-mono text-xs text-muted-foreground">public discovery contract</p>
                </div>
              </div>
              <CodeCopyButton text={manifestText} />
            </div>
            <pre className="max-h-[480px] max-w-full overflow-auto p-5 text-left font-mono text-[11px] leading-5 text-[var(--fg-muted-2)]">
              <code>{manifestText}</code>
            </pre>
          </div>
        </div>
      </section>

      <ChatGPTInstallCard />

      <section id="install" className="scroll-mt-24 border-b border-border">
        <div className="mx-auto max-w-7xl px-5 py-16 md:py-20">
          <div className="mb-8 max-w-2xl">
            <p className="text-sm font-medium text-[var(--signal)]">Install paths</p>
            <h2 className="mt-2 text-3xl font-semibold tracking-[-0.045em] md:text-5xl">
              Use tools, instructions, or both.
            </h2>
            <p className="mt-4 text-sm leading-6 text-muted-foreground md:text-base">
              The plugin gives agents callable tools. The skill gives agents the discovery logic and safety rubric.
            </p>
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            {installCards.map((card) => (
              <InstallCard key={card.title} {...card} />
            ))}
          </div>
        </div>
      </section>

      <section className="border-b border-border bg-white/[0.015]">
        <div className="mx-auto max-w-7xl px-5 py-16 md:py-20">
          <div className="grid gap-8 lg:grid-cols-[0.7fr_1.3fr] lg:items-start">
            <div>
              <p className="text-sm font-medium text-[var(--signal)]">Agent workflow</p>
              <h2 className="mt-2 text-3xl font-semibold tracking-[-0.045em] md:text-5xl">
                From request to safe handoff.
              </h2>
              <p className="mt-4 text-sm leading-6 text-muted-foreground md:text-base">
                Nexez is designed for agents that need to compare offers, explain why a seller fits, and only then
                request approval for checkout or negotiation.
              </p>
            </div>
            <div className="grid gap-4 md:grid-cols-2">
              {workflow.map((step, index) => (
                <FlowStep key={step.title} index={index + 1} {...step} />
              ))}
            </div>
          </div>
        </div>
      </section>

      <section className="border-b border-border">
        <div className="mx-auto max-w-7xl px-5 py-16 md:py-20">
          <div className="mb-8 flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
            <div className="max-w-2xl">
              <p className="text-sm font-medium text-[var(--signal)]">Public machine surfaces</p>
              <h2 className="mt-2 text-3xl font-semibold tracking-[-0.045em] md:text-5xl">
                Everything points to one source of truth.
              </h2>
              <p className="mt-4 text-sm leading-6 text-muted-foreground md:text-base">
                These endpoints stay on the public agent runtime so listings remain fast, crawlable, and separate from
                the authenticated app.
              </p>
            </div>
            <a href="/developers" className="btn-secondary h-10 px-4">
              Developer docs
              <ArrowRight className="size-4" />
            </a>
          </div>

          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {endpoints.map((endpoint) => (
              <EndpointCard key={endpoint.label} {...endpoint} />
            ))}
          </div>
        </div>
      </section>

      <section className="border-b border-border bg-white/[0.015]">
        <div className="mx-auto grid max-w-7xl gap-8 px-5 py-16 md:py-20 lg:grid-cols-[0.76fr_1.24fr] lg:items-start">
          <div>
            <p className="text-sm font-medium text-[var(--signal)]">SDKs</p>
            <h2 className="mt-2 text-3xl font-semibold tracking-[-0.045em] md:text-5xl">
              Helpers for agent builders.
            </h2>
            <p className="mt-4 text-sm leading-6 text-muted-foreground md:text-base">
              The TypeScript SDK is live on npm, and the Python SDK is live on PyPI for agent runtimes that prefer
              scripts, workers, notebooks, or server automation.
            </p>
            <div className="mt-5 grid gap-3">
              {sdkCards.map((sdk) => (
                <div key={sdk.title} className="overflow-hidden rounded-lg border border-border bg-white/[0.03]">
                  <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-3">
                    <div>
                      <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-muted-foreground">
                        {sdk.label}
                      </p>
                      <p className="mt-1 text-sm font-medium">{sdk.title} · v{sdk.version}</p>
                    </div>
                    <a
                      href={sdk.href}
                      className="inline-flex items-center gap-1.5 text-xs font-medium text-[var(--signal)] hover:text-[var(--signal-2)]"
                    >
                      {sdk.hrefLabel}
                      <ExternalLink className="size-3" />
                    </a>
                  </div>
                  <div className="flex items-center justify-between gap-3 px-4 py-3">
                    <code className="min-w-0 overflow-x-auto whitespace-nowrap font-mono text-xs text-[var(--fg-muted-2)]">
                      {sdk.command}
                    </code>
                    <CodeCopyButton text={sdk.command} />
                  </div>
                  <p className="border-t border-border px-4 py-3 text-sm leading-6 text-muted-foreground">
                    {sdk.copy}
                  </p>
                </div>
              ))}
            </div>
          </div>

          <div className="nx-glass-panel overflow-hidden p-0">
            <div className="flex items-center justify-between border-b border-border px-5 py-4">
              <div className="flex items-center gap-2">
                <div className="flex size-8 items-center justify-center rounded-md border border-border bg-black/40">
                  <Code2 className="size-4 text-[var(--signal)]" />
                </div>
                <div>
                  <p className="text-sm font-medium">agent-sdk.ts</p>
                  <p className="font-mono text-xs text-muted-foreground">search · manifest · dry-run</p>
                </div>
              </div>
              <CodeCopyButton text={sdkExample} />
            </div>
            <pre className="max-w-full overflow-auto p-5 text-left font-mono text-[11px] leading-5 text-[var(--fg-muted-2)]">
              <code>{sdkExample}</code>
            </pre>
          </div>
        </div>
      </section>

      <section className="border-b border-border">
        <div className="mx-auto grid max-w-7xl gap-8 px-5 py-16 md:py-20 lg:grid-cols-[0.78fr_1.22fr] lg:items-start">
          <div>
            <p className="text-sm font-medium text-[var(--signal)]">Agent examples</p>
            <h2 className="mt-2 text-3xl font-semibold tracking-[-0.045em] md:text-5xl">
              Copy the full buyer flow.
            </h2>
            <p className="mt-4 text-sm leading-6 text-muted-foreground md:text-base">
              The examples show agents how to search, fetch structured context, validate handoffs, stop for buyer
              approval, submit negotiation terms, and poll status.
            </p>
            <div className="mt-5 grid gap-3">
              {exampleCards.map((example) => (
                <a
                  key={example.path}
                  href={example.href ?? `${NEXEZ_AGENT_EXAMPLES.sourceUrl}/${example.path.replace('examples/agents/', '')}`}
                  className="rounded-lg border border-border bg-white/[0.03] p-4 transition hover:border-[var(--signal)]/40 hover:bg-white/[0.055]"
                >
                  <p className="text-sm font-medium">{example.title}</p>
                  <p className="mt-1 font-mono text-[11px] text-muted-foreground">{example.path}</p>
                  <p className="mt-3 text-sm leading-6 text-muted-foreground">{example.copy}</p>
                </a>
              ))}
            </div>
          </div>

          <div className="nx-glass-panel overflow-hidden p-0">
            <div className="flex items-center justify-between border-b border-border px-5 py-4">
              <div className="flex items-center gap-2">
                <div className="flex size-8 items-center justify-center rounded-md border border-border bg-black/40">
                  <Code2 className="size-4 text-[var(--signal)]" />
                </div>
                <div>
                  <p className="text-sm font-medium">agent-sdk.py</p>
                  <p className="font-mono text-xs text-muted-foreground">search · manifest · negotiation dry-run</p>
                </div>
              </div>
              <CodeCopyButton text={pythonSdkExample} />
            </div>
            <pre className="max-w-full overflow-auto p-5 text-left font-mono text-[11px] leading-5 text-[var(--fg-muted-2)]">
              <code>{pythonSdkExample}</code>
            </pre>
          </div>
        </div>
      </section>

      <section className="border-b border-border bg-white/[0.015]">
        <div className="mx-auto grid max-w-7xl gap-8 px-5 py-16 md:py-20 lg:grid-cols-[0.9fr_1.1fr]">
          <div className="nx-glass-panel p-6">
            <div className="flex items-center gap-3">
              <div className="flex size-10 items-center justify-center rounded-md border border-[var(--ready)]/30 bg-[var(--ready)]/10">
                <ShieldCheck className="size-5 text-[var(--ready)]" />
              </div>
              <div>
                <p className="font-medium">Safety posture</p>
                <p className="text-sm text-muted-foreground">Open for discovery. Careful for actions.</p>
              </div>
            </div>
            <div className="mt-6 grid gap-3">
              {safetyRules.map((rule) => (
                <div key={rule} className="flex gap-3 rounded-lg border border-border bg-white/[0.03] p-4">
                  <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-[var(--ready)]" />
                  <p className="text-sm leading-6 text-muted-foreground">{rule}</p>
                </div>
              ))}
            </div>
          </div>

          <div className="grid content-between gap-4">
            <div className="nx-tile p-6">
              <div className="flex items-center gap-3">
                <Search className="size-5 text-[var(--signal)]" />
                <p className="font-medium">For buyer agents</p>
              </div>
              <p className="mt-3 text-sm leading-6 text-muted-foreground">
                Search by outcome, location, budget signal, or service type. Nexez returns listings with structured
                offers, trust signals, and direct next actions.
              </p>
            </div>
            <div className="nx-tile p-6">
              <div className="flex items-center gap-3">
                <Globe2 className="size-5 text-[var(--signal)]" />
                <p className="font-medium">For seller listings</p>
              </div>
              <p className="mt-3 text-sm leading-6 text-muted-foreground">
                Public listings remain on the agent runtime, while the marketing site and dashboard stay on their own
                domains. That split protects crawlability and signed-in workflows.
              </p>
            </div>
            <div className="nx-tile p-6">
              <div className="flex items-center gap-3">
                <Code2 className="size-5 text-[var(--signal)]" />
                <p className="font-medium">For registries</p>
              </div>
              <p className="mt-3 text-sm leading-6 text-muted-foreground">
                The ARD catalog at /.well-known/ai-catalog.json lists every Nexez MCP server, its capabilities, and sample queries.
                A discovery service can index the network from that single file.
              </p>
            </div>
          </div>
        </div>
      </section>

      <section>
        <div className="mx-auto max-w-3xl px-5 py-20 text-center md:py-24">
          <h2 className="text-4xl font-semibold tracking-[-0.055em] md:text-6xl">
            Ready for the agent web.
          </h2>
          <p className="mx-auto mt-4 max-w-xl text-sm leading-6 text-muted-foreground md:text-base">
            Publish a seller listing and let agents discover the offer through the clean runtime.
          </p>
          <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
            <a href={appUrl('/create')} className="btn-primary h-11 px-5">
              Create a listing
              <ArrowRight className="size-4" />
            </a>
            {MARKETPLACE_DISCOVERY_ENABLED ? (
              <a href="/discovery" className="btn-secondary h-11 px-5">
                Browse discovery
              </a>
            ) : null}
          </div>
        </div>
      </section>
    </main>
  )
}

function InstallCard({
  label,
  title,
  version,
  command,
  copy,
}: {
  label: string
  title: string
  version: string
  command: string
  copy: string
}) {
  return (
    <div className="nx-glass-panel min-w-0 p-5 transition-transform duration-200 hover:-translate-y-0.5">
      <div className="flex min-w-0 flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-[var(--signal)]">{label}</p>
          <h3 className="mt-2 text-2xl font-semibold tracking-[-0.035em]">{title}</h3>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">{copy}</p>
        </div>
        <span className="w-fit shrink-0 rounded-md border border-border bg-white/[0.04] px-2 py-1 font-mono text-[11px] text-muted-foreground">
          v{version}
        </span>
      </div>
      <div className="mt-5 min-w-0 max-w-full rounded-lg border border-border bg-black/45">
        <div className="flex items-center justify-between border-b border-border px-3 py-2">
          <span className="font-mono text-[11px] text-muted-foreground">Terminal</span>
          <CodeCopyButton text={command} />
        </div>
        <pre className="max-w-full overflow-x-auto p-4 font-mono text-xs text-[var(--signal)]">
          <code>{command}</code>
        </pre>
      </div>
    </div>
  )
}

function FlowStep({
  index,
  title,
  copy,
  sample,
}: {
  index: number
  title: string
  copy: string
  sample: string
}) {
  return (
    <div className="nx-tile p-5">
      <div className="flex items-center justify-between gap-3">
        <div className="flex size-8 items-center justify-center rounded-full border border-[var(--signal)]/30 bg-[var(--signal)]/10 font-mono text-xs text-[var(--signal)]">
          {String(index).padStart(2, '0')}
        </div>
        <ArrowRight className="size-4 text-white/20" />
      </div>
      <h3 className="mt-5 text-lg font-medium tracking-tight">{title}</h3>
      <p className="mt-2 text-sm leading-6 text-muted-foreground">{copy}</p>
      <code className="mt-4 block rounded-md border border-border bg-black/35 px-3 py-2 font-mono text-[11px] text-[var(--fg-muted-2)]">
        {sample}
      </code>
    </div>
  )
}

function EndpointCard({
  label,
  href,
  value,
  copy,
}: {
  label: string
  href: string
  value: string
  copy: string
}) {
  return (
    <a
      href={href}
      className="group rounded-lg border border-border bg-white/[0.03] p-5 transition-colors hover:border-[var(--signal)]/40 hover:bg-white/[0.05]"
    >
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm font-medium">{label}</p>
        <ExternalLink className="size-4 text-muted-foreground transition-colors group-hover:text-[var(--signal)]" />
      </div>
      <p className="mt-3 min-h-[3rem] text-sm leading-6 text-muted-foreground">{copy}</p>
      <code className="mt-4 block break-all rounded-md border border-border bg-black/30 px-3 py-2 font-mono text-[11px] text-[var(--fg-muted-2)]">
        {value}
      </code>
    </a>
  )
}
