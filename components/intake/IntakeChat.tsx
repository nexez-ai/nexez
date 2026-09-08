'use client'

// Seller intake interview: web client (spec §6). A thin client of the shared
// agent-chat primitive over the threads API: no interview logic lives here.
// The reducer on the server decides what is askable; this component renders
// turns + cards and posts owner input (free text, or structured quick-answers
// from gap_batch chips, which work with or without a configured LLM).
//
// Color rubric (current brand, not the spec draft's periwinkle): teal --ready
// carries readiness/positive, amber --amber flags blocking gaps, persimmon
// --signal stays on interactive accents.
import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { ArrowRight, CircleCheck, Globe2, ListChecks, Loader2, MessageCircleQuestion, Plug, Sparkles } from 'lucide-react'
import { AgentChat, type AgentChatController, type AgentChatMessage, type AgentTurnResponse } from '../agent-chat'
import { PlanBadge, UpgradeBanner } from '../billing/PlanGate'
import { usePlan } from '../billing/PlanProvider'
import type { IntakeCard } from '../../lib/agents/intake'
import { planAllows, type PlanId } from '../../lib/billing'
import type { Gap, GapAnswer, IntakeState } from '../../lib/intake'

type IntakeChatProps = {
  /** "Just take me to the form": the fork's escape hatch. */
  onSwitchToForm?: () => void
  /** Re-interview an EXISTING listing: the session seeds from the page and
   *  commit stages onto its draft (never a new page). Entry: the editor's
   *  Re-interview action -> /create?reinterview=<pageId>. */
  reinterviewPageId?: string
  /** Prefill the "your website" input (e.g. from the /scan → onboarding funnel).
   *  Prefill ONLY - the user still clicks start, so no surprise outbound fetch. */
  initialSourceUrl?: string
  className?: string
}

type SetupPhase = 'setup' | 'starting' | 'signin' | 'chat'

type ActiveSession = { id: string; updatedAt: string | null }

function selectedCommerceTemplateId(): string {
  if (typeof window === 'undefined') return ''
  return new URLSearchParams(window.location.search).get('commerceTemplate')?.trim() || ''
}

function authNextHref(path: '/onboard' | '/login', returnPath: string): string {
  // Keep the long-standing no-query href byte-for-byte for existing E2E and
  // bookmarks. Encode only when we need to preserve template-selection context.
  const next = returnPath === '/create' ? '/create' : encodeURIComponent(returnPath)
  return `${path}?next=${next}`
}

export function IntakeChat({ onSwitchToForm, reinterviewPageId, initialSourceUrl = '', className = '' }: IntakeChatProps) {
  const router = useRouter()
  // /create resolves this effective viewer plan on the server. Re-interviews
  // are owner-only, so the viewer is also the capability owner.
  const currentPlan = usePlan()
  const negotiationAllowed = planAllows(currentPlan, 'negotiation')
  const integrationsAllowed = planAllows(currentPlan, 'integrations')
  const [isHydrated, setIsHydrated] = useState(false)
  const [phase, setPhase] = useState<SetupPhase>('setup')
  const [sourceUrl, setSourceUrl] = useState(initialSourceUrl)
  const [setupError, setSetupError] = useState('')
  const [resumable, setResumable] = useState<ActiveSession | null>(null)
  const [initialMessages, setInitialMessages] = useState<AgentChatMessage<IntakeCard>[]>([])
  const [authReturnPath, setAuthReturnPath] = useState('/create')
  // Re-interview only: whether the listing already has a managed OAuth or legacy
  // personal-token connection, so the connector can reuse it without re-entry.
  const [calendlyConnected, setCalendlyConnected] = useState(false)
  const sessionIdRef = useRef<string | null>(null)

  useEffect(() => {
    setIsHydrated(true)
  }, [])

  useEffect(() => {
    if (!reinterviewPageId) return
    let cancelled = false
    fetch(`/api/pages/${reinterviewPageId}/settings-context`)
      .then((r) => (r.ok ? r.json() : null))
      .then((json) => {
        if (!cancelled && json?.secrets?.calendly_connected) setCalendlyConnected(true)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [reinterviewPageId])

  // Surface an existing interview so a second visit resumes instead of
  // duplicating (cross-device: start on mobile, finish here). Best-effort:
  // unauthenticated visitors just see the fresh-start setup. In re-interview
  // mode only a session for THAT listing counts. A deliberate reference-template
  // selection starts a fresh context instead of resuming an unrelated session.
  useEffect(() => {
    if (!reinterviewPageId && selectedCommerceTemplateId()) return
    let cancelled = false
    fetch('/api/agents/intake/threads')
      .then((r) => (r.ok ? r.json() : null))
      .then((json) => {
        if (cancelled || !json?.sessions?.length) return
        const sessions = json.sessions as Array<{ id: string; pageId: string | null; updatedAt: string | null }>
        const match = reinterviewPageId ? sessions.find((s) => s.pageId === reinterviewPageId) : sessions[0]
        if (match) setResumable({ id: match.id, updatedAt: match.updatedAt ?? null })
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [reinterviewPageId])

  function openingMessages(state: IntakeState): AgentChatMessage<IntakeCard>[] {
    const extraction = state.extractions[0]
    const hasTemplateContext = state.sources.some((source) => source.kind === 'template')
    const cards: IntakeCard[] = []
    if (extraction) {
      cards.push({
        type: 'source_ingested',
        sourceId: extraction.sourceId,
        label: state.sources.find((s) => s.id === extraction.sourceId)?.label || 'your site',
        offers: extraction.offers.length,
        confidence: extraction.confidence,
      })
    }
    // Let the seller pull a live catalog (Calendly/Shopify/Square/Acuity) any time.
    cards.push({ type: 'integration_connect', calendlyConnected })
    if (state.gaps.length > 0) {
      cards.push({ type: 'gap_batch', gaps: state.gaps.slice(0, 3) })
    }
    const intro = extraction
      ? `I read what your site already says. ${extraction.offers.length} offer${extraction.offers.length === 1 ? '' : 's'} came through, and I will only ask about what is missing or unclear.`
      : state.draft.name.trim()
        ? `I re-read ${state.draft.name}. It is already on Nexez, so I will only ask about what is missing or could be stronger. Your answers land as a draft on the listing.`
        : hasTemplateContext
          ? 'You selected a reference template. I will use it only to guide what I ask - your prices, policies, service area, offers, and other business facts still come from you.'
          : 'We are starting fresh. A few focused questions and your draft will be ready to review in the builder. Answer, skip, or jump to the form any time.'
    return [{ id: 'intake-opening', role: 'assistant', content: intro, cards }]
  }

  function transcriptMessages(state: IntakeState): AgentChatMessage<IntakeCard>[] {
    const replay: AgentChatMessage<IntakeCard>[] = state.messages.map((m) => ({
      id: m.id,
      role: m.role === 'owner' ? 'user' : 'assistant',
      content: m.content,
    }))
    if (state.gaps.length > 0) {
      replay.push({
        id: 'intake-resume-gaps',
        role: 'assistant',
        content: 'Picking up where we left off:',
        cards: [{ type: 'gap_batch', gaps: state.gaps.slice(0, 3) }],
      })
    }
    return replay.length ? replay : openingMessages(state)
  }

  async function start(body: Record<string, unknown>) {
    setPhase('starting')
    setSetupError('')
    try {
      const templateId = reinterviewPageId ? '' : selectedCommerceTemplateId()
      const requestBody = templateId ? { ...body, template_id: templateId } : body
      const response = await fetch('/api/agents/intake/threads', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(requestBody),
      })
      const json = await response.json()
      if (response.status === 401) {
        setAuthReturnPath(templateId ? `/create?commerceTemplate=${templateId}` : '/create')
        setPhase('signin')
        return
      }
      if (!response.ok) throw new Error(json.error || 'Could not start the interview.')
      sessionIdRef.current = json.id
      setInitialMessages(openingMessages(json.state as IntakeState))
      setPhase('chat')
    } catch (error) {
      setSetupError(error instanceof Error ? error.message : 'Could not start the interview.')
      setPhase('setup')
    }
  }

  async function resume(id: string) {
    setPhase('starting')
    setSetupError('')
    try {
      const response = await fetch(`/api/agents/intake/threads/${id}`)
      const json = await response.json()
      if (response.status === 401) {
        setPhase('signin')
        return
      }
      if (!response.ok) throw new Error(json.error || 'Could not resume the interview.')
      sessionIdRef.current = json.id
      setInitialMessages(transcriptMessages(json.state as IntakeState))
      setPhase('chat')
    } catch (error) {
      setSetupError(error instanceof Error ? error.message : 'Could not resume the interview.')
      setPhase('setup')
    }
  }

  async function postTurn(body: Record<string, unknown>): Promise<AgentTurnResponse<IntakeCard>> {
    const response = await fetch(`/api/agents/intake/threads/${sessionIdRef.current}/messages`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    })
    const json = await response.json()
    if (!response.ok) throw new Error(json.error || 'The interview hit a snag. Try again.')
    return { message: json.message, cards: json.cards ?? [] }
  }

  // Connect a live integration mid-interview: POST the provider + credentials to
  // /ingest, then fold the result (the source + refreshed gaps) into the chat.
  async function postIngest(body: Record<string, unknown>): Promise<AgentTurnResponse<IntakeCard>> {
    const response = await fetch(`/api/agents/intake/threads/${sessionIdRef.current}/ingest`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    })
    const json = await response.json()
    if (!response.ok) throw new Error(json.error || 'Could not connect that tool.')
    const state = json.state as IntakeState
    const source = state.sources[state.sources.length - 1]
    const label = source?.label || 'your tool'
    const cards: IntakeCard[] = [{ type: 'source_ingested', sourceId: json.sourceId, label, offers: json.offersFound }]
    if (state.gaps.length > 0) cards.push({ type: 'gap_batch', gaps: state.gaps.slice(0, 3) })
    const found = json.offersFound as number
    const message =
      found > 0
        ? `Connected ${label} - imported ${found} offer${found === 1 ? '' : 's'}.${state.gaps.length ? ' Here is what is still worth confirming:' : ' Your draft is looking complete.'}`
        : `Connected ${label}, but I did not find any offers to import. We can keep going with what we have.`
    return { message, cards }
  }

  async function commit() {
    const response = await fetch(`/api/agents/intake/threads/${sessionIdRef.current}/commit`, { method: 'POST' })
    const json = await response.json()
    if (!response.ok) throw new Error(json.error || 'Could not open the builder.')
    // Keep the authenticated app host in previews and local development too.
    router.push(`/dashboard/${encodeURIComponent(json.pageId)}`)
    return { message: 'Opening your draft in the builder...' }
  }

  if (phase !== 'chat') {
    return (
      <section className={`mx-auto flex min-h-[720px] w-full max-w-md flex-col justify-center overflow-hidden rounded-[2rem] border border-[var(--bd-15)] bg-[var(--panel)] p-8 text-[var(--fg)] shadow-[0_24px_80px_rgba(15,23,42,0.12)] dark:border-white/15 dark:bg-[#07070A] dark:text-white dark:shadow-[0_24px_80px_rgba(0,0,0,0.45)] ${className}`}>
        <div className="flex size-12 items-center justify-center rounded-2xl border border-[var(--signal)]/40 bg-[var(--signal)]/15">
          <Sparkles className="size-6 text-[var(--signal)]" />
        </div>
        <h2 className="mt-5 text-2xl font-semibold tracking-[-0.03em]">
          {reinterviewPageId ? 'Re-interview this listing' : 'Talk it through'}
        </h2>
        <p className="mt-2 text-sm leading-6 text-[var(--fg-muted)]">
          {reinterviewPageId
            ? 'Nexez re-reads what the listing already says and only asks about what is missing or could be stronger. Your answers land as a draft on the listing. Nothing goes live without you.'
            : 'I will read what already exists: your site and your listings. Then I only ask about the gaps. Twenty minutes of conversation, not forty form fields.'}
        </p>

        {phase === 'signin' ? (
          <div className="mt-6 rounded-2xl border border-[var(--amber)]/30 bg-[var(--amber)]/10 p-4 text-sm leading-6 text-[var(--fg-soft)]">
            Sign in to start your interview. Your progress saves to your account and resumes on any device.
            <div className="mt-3 flex flex-col gap-2">
              <a href={authNextHref('/onboard', authReturnPath)} className="inline-flex min-h-[44px] items-center justify-center rounded-xl bg-white font-medium text-zinc-950 hover:bg-zinc-200">
                Create Free account
              </a>
              <a href={authNextHref('/login', authReturnPath)} className="inline-flex min-h-[44px] items-center justify-center rounded-xl border border-[var(--bd-15)] text-sm text-[var(--fg)] hover:bg-[var(--ov-05)]">
                I already have an account
              </a>
            </div>
          </div>
        ) : (
          <div className="mt-6 space-y-3">
            {resumable ? (
              <button
                type="button"
                disabled={!isHydrated || phase === 'starting'}
                onClick={() => resume(resumable.id)}
                className="flex w-full items-center justify-between rounded-2xl border border-[var(--ready)]/30 bg-[var(--ready)]/10 px-4 py-3 text-left text-sm text-[var(--fg)] transition hover:bg-[var(--ready)]/15 disabled:opacity-50"
              >
                <span>Resume your interview in progress</span>
                <ArrowRight className="size-4 text-[var(--ready)]" />
              </button>
            ) : null}
            {reinterviewPageId ? (
              <button
                type="button"
                disabled={!isHydrated || phase === 'starting'}
                onClick={() => start({ page_id: reinterviewPageId })}
                className="flex w-full items-center justify-center gap-2 rounded-2xl bg-[var(--inverse-bg)] px-4 py-3 text-sm font-medium text-[var(--inverse-fg)] transition hover:brightness-95 disabled:opacity-40"
              >
                {phase === 'starting' ? <Loader2 className="size-4 animate-spin" /> : <Sparkles className="size-4" />}
                {phase === 'starting' ? 'Re-reading your listing…' : 'Start the re-interview'}
              </button>
            ) : (
              <>
                <div className="rounded-2xl border border-[var(--bd-15)] bg-[var(--ov-04)] p-2 dark:border-white/12 dark:bg-white/[0.045]">
                  <input
                    type="url"
                    value={sourceUrl}
                    onChange={(event) => setSourceUrl(event.target.value)}
                    placeholder="https://yourbusiness.com"
                    className="w-full bg-transparent px-3 py-3 text-sm text-[var(--fg)] outline-none placeholder:text-[var(--fg-muted)]"
                  />
                  <button
                    type="button"
                    disabled={!isHydrated || phase === 'starting' || !sourceUrl.trim()}
                    onClick={() => start({ source_url: sourceUrl.trim() })}
                    className="mt-1 flex w-full items-center justify-center gap-2 rounded-xl bg-[var(--inverse-bg)] px-4 py-3 text-sm font-medium text-[var(--inverse-fg)] transition hover:brightness-95 disabled:opacity-40"
                  >
                    {phase === 'starting' ? <Loader2 className="size-4 animate-spin" /> : <Globe2 className="size-4" />}
                    Start with my site
                  </button>
                </div>
                <button
                  type="button"
                  disabled={!isHydrated || phase === 'starting'}
                  onClick={() => start({})}
                  className="w-full rounded-2xl border border-[var(--bd-15)] px-4 py-3 text-sm text-[var(--fg-soft)] transition hover:bg-[var(--ov-05)] disabled:opacity-50 dark:border-white/12 dark:text-white/75 dark:hover:bg-white/5"
                >
                  Start from scratch
                </button>
              </>
            )}
            {setupError ? <p className="text-xs text-red-500">{setupError}</p> : null}
          </div>
        )}

        {onSwitchToForm ? (
          <button type="button" onClick={onSwitchToForm} className="mt-6 text-xs text-[var(--fg-muted)] underline-offset-4 hover:text-[var(--fg)] hover:underline">
            Skip the chat, build with the form
          </button>
        ) : null}
      </section>
    )
  }

  return (
    <div className={className}>
      <AgentChat<IntakeCard>
        config={{
          agentName: 'Nexez intake',
          badge: 'seller agent',
          tagline: 'Interviews the gaps, drafts your listing.',
          welcome: 'Tell me about your business and I will only ask about what is missing.',
          initialMessages,
          placeholder: 'Answer, ask, or say "skip"...',
          footnote: 'Nothing publishes without you. The interview hands off to the builder for review.',
          headerIcon: <MessageCircleQuestion className="size-5 text-[var(--signal)]" />,
          errorFallback: 'The interview hit a snag. Try again.',
          sendTurn: ({ text }) => postTurn({ content: text }),
          cardKey: intakeCardKey,
          renderCard: (card, controller) => (
            <IntakeCardView
              card={card}
              controller={controller}
              currentPlan={currentPlan}
              negotiationAllowed={negotiationAllowed}
              integrationsAllowed={integrationsAllowed}
              onCommit={commit}
              onAnswers={(answers) => postTurn({ answers })}
              onConnect={postIngest}
            />
          ),
        }}
      />
      {onSwitchToForm ? (
        <p className="mt-3 text-center text-xs text-[var(--fg-muted)]">
          Prefer fields?{' '}
          <button type="button" onClick={onSwitchToForm} className="underline underline-offset-4 hover:text-[var(--fg)]">
            Build with the form instead
          </button>
        </p>
      ) : null}
    </div>
  )
}

function intakeCardKey(card: IntakeCard): string {
  switch (card.type) {
    case 'source_ingested':
      return `source-${card.sourceId}`
    case 'gap_batch':
      return `gaps-${card.gaps.map((g) => g.id).join('+')}`
    case 'draft_summary':
      return `summary-${card.readiness}-${card.draft.services.length + card.draft.products.length}`
    case 'handoff':
      return `handoff-${card.via}`
    case 'integration_connect':
      return 'integration-connect'
  }
}

// ---------------------------------------------------------------------------
// Cards

function IntakeCardView({
  card,
  controller,
  currentPlan,
  negotiationAllowed,
  integrationsAllowed,
  onCommit,
  onAnswers,
  onConnect,
}: {
  card: IntakeCard
  controller: AgentChatController<IntakeCard>
  currentPlan: PlanId
  negotiationAllowed: boolean
  integrationsAllowed: boolean
  onCommit: () => Promise<AgentTurnResponse<IntakeCard>>
  onAnswers: (answers: GapAnswer[]) => Promise<AgentTurnResponse<IntakeCard>>
  onConnect: (body: Record<string, unknown>) => Promise<AgentTurnResponse<IntakeCard>>
}) {
  if (card.type === 'integration_connect') {
    return (
      <IntegrationConnect
        card={card}
        controller={controller}
        currentPlan={currentPlan}
        integrationsAllowed={integrationsAllowed}
        onConnect={onConnect}
      />
    )
  }

  if (card.type === 'source_ingested') {
    return (
      <article className="rounded-3xl border border-[var(--bd-10)] bg-[var(--ov-04)] p-4 shadow-xl backdrop-blur-2xl dark:border-white/10 dark:bg-white/[0.04]">
        <div className="flex items-center gap-3">
          <div className="flex size-10 shrink-0 items-center justify-center rounded-2xl bg-[var(--ready)]/15 text-[var(--ready)]">
            <Globe2 className="size-5" />
          </div>
          <div className="min-w-0 flex-1">
            <h3 className="truncate text-sm font-semibold text-[var(--fg)]">Read {card.label}</h3>
            <p className="mt-0.5 text-xs text-[var(--fg-muted)]">
              {card.offers} offer{card.offers === 1 ? '' : 's'} imported
              {typeof card.confidence === 'number' ? ` · ${Math.round(card.confidence * 100)}% confidence` : ''}
            </p>
          </div>
        </div>
      </article>
    )
  }

  if (card.type === 'gap_batch') {
    return (
      <article className="space-y-3 rounded-3xl border border-[var(--bd-10)] bg-[var(--ov-04)] p-4 shadow-xl backdrop-blur-2xl dark:border-white/10 dark:bg-white/[0.04]">
        {card.gaps.map((gap) => (
          <GapRow
            key={gap.id}
            gap={gap}
            controller={controller}
            negotiationAllowed={negotiationAllowed}
            onAnswers={onAnswers}
          />
        ))}
      </article>
    )
  }

  if (card.type === 'draft_summary') {
    const offers = card.draft.services.length + card.draft.products.length
    return (
      <article className="rounded-3xl border border-[var(--ready)]/35 bg-[var(--ready)]/[0.08] p-4 shadow-xl">
        <div className="flex items-center gap-4">
          <ReadinessRing value={card.readiness} />
          <div className="min-w-0 flex-1">
            <h3 className="text-sm font-semibold text-[var(--fg)]">{card.draft.name || 'Your draft'}</h3>
            <p className="mt-0.5 text-xs text-[var(--fg-muted)]">
              {offers} offer{offers === 1 ? '' : 's'} · {card.draft.faqs.length} FAQ{card.draft.faqs.length === 1 ? '' : 's'}
              {card.draft.industry ? ` · ${card.draft.industry}` : ''}
            </p>
            {card.handoffEligible ? (
              <button
                type="button"
                disabled={controller.busy}
                onClick={() => void controller.runAction('Opening the builder...', onCommit)}
                className="mt-3 inline-flex items-center gap-2 rounded-xl bg-[var(--inverse-bg)] px-4 py-2 text-xs font-semibold text-[var(--inverse-fg)] transition hover:brightness-95 disabled:opacity-50"
              >
                Review in the builder
                <ArrowRight className="size-3.5" />
              </button>
            ) : null}
          </div>
        </div>
      </article>
    )
  }

  // handoff
  return (
    <article className="rounded-3xl border border-[var(--ready)]/35 bg-[var(--ready)]/10 p-4 shadow-xl">
      <div className="flex items-center gap-3">
        <div className="flex size-10 shrink-0 items-center justify-center rounded-2xl bg-[var(--ov-10)] text-[var(--ready)]">
          <CircleCheck className="size-5" />
        </div>
        <div className="min-w-0 flex-1">
          <h3 className="text-sm font-semibold text-[var(--fg)]">Your draft is ready</h3>
          <p className="mt-0.5 text-xs text-[var(--fg-muted)]">Review everything in the builder. Publishing stays in your hands.</p>
        </div>
        <button
          type="button"
          disabled={controller.busy}
          onClick={() => void controller.runAction('Opening the builder...', onCommit)}
          className="inline-flex shrink-0 items-center gap-2 rounded-xl bg-[var(--inverse-bg)] px-4 py-2 text-xs font-semibold text-[var(--inverse-fg)] transition hover:brightness-95 disabled:opacity-50"
        >
          Open builder
          <ArrowRight className="size-3.5" />
        </button>
      </div>
    </article>
  )
}

// Providers the interview can pull a live catalog from (the seller's own token,
// used once). Mirrors lib/server/integration-importers INGESTABLE_PROVIDERS.
const CONNECT_PROVIDERS: Array<{ key: string; label: string; fields: Array<{ name: string; label: string; type: 'text' | 'password' }> }> = [
  { key: 'calendly', label: 'Calendly', fields: [{ name: 'token', label: 'Personal Access Token', type: 'password' }] },
  { key: 'shopify', label: 'Shopify manual Admin credentials', fields: [{ name: 'shop', label: 'store.myshopify.com', type: 'text' }, { name: 'accessToken', label: 'Admin API token', type: 'password' }] },
  { key: 'square', label: 'Square', fields: [{ name: 'accessToken', label: 'Access token', type: 'password' }] },
  { key: 'acuity', label: 'Acuity', fields: [{ name: 'userId', label: 'User ID', type: 'text' }, { name: 'apiKey', label: 'API key', type: 'password' }] },
]

/** Pull a live catalog mid-interview. Pick a provider, paste the credential, and
 *  the offers fold into the draft (via /ingest, Pro-gated server-side). A
 *  re-interview with a saved Calendly token skips the paste. */
function IntegrationConnect({
  card,
  controller,
  currentPlan,
  integrationsAllowed,
  onConnect,
}: {
  card: Extract<IntakeCard, { type: 'integration_connect' }>
  controller: AgentChatController<IntakeCard>
  currentPlan: PlanId
  integrationsAllowed: boolean
  onConnect: (body: Record<string, unknown>) => Promise<AgentTurnResponse<IntakeCard>>
}) {
  const [provider, setProvider] = useState<string | null>(null)
  const [values, setValues] = useState<Record<string, string>>({})
  const meta = integrationsAllowed ? CONNECT_PROVIDERS.find((p) => p.key === provider) : undefined
  const ready = meta ? meta.fields.every((f) => (values[f.name] || '').trim().length > 0) : false

  useEffect(() => {
    if (integrationsAllowed) return
    setProvider(null)
    setValues({})
  }, [integrationsAllowed])

  function connect(body: Record<string, unknown>) {
    if (!integrationsAllowed) return
    void controller.runAction('Connecting your tool…', () => onConnect(body))
    setProvider(null)
    setValues({})
  }

  return (
    <article className="rounded-3xl border border-[var(--bd-10)] bg-[var(--ov-04)] p-4 shadow-xl backdrop-blur-2xl dark:border-white/10 dark:bg-white/[0.04]">
      <div className="flex items-center gap-2">
        <div className="flex size-8 shrink-0 items-center justify-center rounded-xl bg-[var(--signal)]/15 text-[var(--signal)]">
          <Plug className="size-4" />
        </div>
        <h3 className="text-sm font-semibold text-[var(--fg)]">Connect a booking or store tool</h3>
      </div>
      <p className="mt-1 text-[11px] leading-4 text-[var(--fg-muted)]">
        Pull live offers with seller-supplied Calendly, Shopify Admin, Square, or Acuity credentials. Manual connectors require Pro; the installed Shopify app is available on every plan.
      </p>

      {!meta ? (
        <>
          <div className="mt-3 flex flex-wrap gap-1.5">
            {CONNECT_PROVIDERS.map((p) => (
              <button
                key={p.key}
                type="button"
                disabled={controller.busy || !integrationsAllowed}
                onClick={() => setProvider(p.key)}
                title={integrationsAllowed ? undefined : `${p.label} catalog import requires Pro`}
                className="rounded-full border border-[var(--bd-15)] bg-[var(--panel)] px-3 py-1.5 text-xs text-[var(--fg-soft)] transition hover:border-[var(--signal)]/40 hover:text-[var(--signal)] disabled:opacity-40 dark:border-white/12 dark:bg-white/[0.04] dark:text-white/70"
              >
                {p.label}
              </button>
            ))}
          </div>
          {card.calendlyConnected ? (
            <button
              type="button"
              disabled={controller.busy || !integrationsAllowed}
              onClick={() => connect({ provider: 'calendly' })}
              className="mt-2 inline-flex items-center gap-1.5 text-xs text-[var(--ready)] transition hover:underline disabled:opacity-40"
            >
              <CircleCheck className="size-3.5" /> Use your saved Calendly connection
            </button>
          ) : null}
        </>
      ) : (
        <div className="mt-3 space-y-2">
          {meta.fields.map((f) => (
            <input
              key={f.name}
              type={f.type}
              value={values[f.name] || ''}
              onChange={(e) => setValues((v) => ({ ...v, [f.name]: e.target.value }))}
              placeholder={f.label}
              className="w-full rounded-xl border border-[var(--bd-15)] bg-[var(--panel)] px-3 py-2 text-xs text-[var(--fg)] outline-none placeholder:text-[var(--fg-muted)] dark:border-white/12 dark:bg-white/[0.04]"
            />
          ))}
          <div className="flex gap-2">
            <button
              type="button"
              disabled={!ready || controller.busy}
              onClick={() => connect({ provider: meta.key, ...values })}
              className="inline-flex items-center gap-1.5 rounded-xl bg-[var(--inverse-bg)] px-3 py-2 text-xs font-semibold text-[var(--inverse-fg)] transition hover:brightness-95 disabled:opacity-40"
            >
              Connect {meta.label}
              <ArrowRight className="size-3.5" />
            </button>
            <button
              type="button"
              disabled={controller.busy}
              onClick={() => {
                setProvider(null)
                setValues({})
              }}
              className="rounded-xl border border-[var(--bd-15)] px-3 py-2 text-xs text-[var(--fg-muted)] transition hover:bg-[var(--ov-05)] disabled:opacity-40 dark:border-white/12"
            >
              Back
            </button>
          </div>
        </div>
      )}
      <UpgradeBanner
        feature="integrations"
        currentPlan={currentPlan}
        title="Live catalog connectors"
        description="Seller-supplied Calendly, Shopify Admin, Square, and Acuity credentials require Pro. The installed Shopify app stays available on every plan, and existing imported offers remain visible."
        className="mt-3"
      />
    </article>
  )
}

/** One gap: the question, why it matters, and tappable quick answers. Chips
 *  post STRUCTURED answers through the reducer. No LLM interpretation needed,
 *  which keeps the interview fully functional in deterministic mode. */
function GapRow({
  gap,
  controller,
  negotiationAllowed,
  onAnswers,
}: {
  gap: Gap
  controller: AgentChatController<IntakeCard>
  negotiationAllowed: boolean
  onAnswers: (answers: GapAnswer[]) => Promise<AgentTurnResponse<IntakeCard>>
}) {
  const quickAnswers = gapQuickAnswers(gap, negotiationAllowed)
  return (
    <div>
      <div className="flex items-start gap-2">
        {gap.kind === 'blocking' ? (
          <span className="mt-1 inline-block size-1.5 shrink-0 rounded-full bg-[var(--amber)]" title="Needed before your listing can go live" />
        ) : (
          <ListChecks className="mt-0.5 size-3.5 shrink-0 text-[var(--fg-muted)]" />
        )}
        <div className="min-w-0">
          <p className="text-sm leading-5 text-[var(--fg)]">{gap.question}</p>
          <p className="mt-0.5 text-[11px] leading-4 text-[var(--fg-muted)]">{gap.why}</p>
        </div>
      </div>
      <div className="mt-2 flex flex-wrap gap-1.5 pl-3.5">
        {quickAnswers.map((qa) => (
          <button
            key={qa.label}
            type="button"
            disabled={controller.busy || qa.locked}
            onClick={() => void controller.runAction('Recording...', () => onAnswers([qa.answer]))}
            title={qa.locked ? 'Open-to-offers pricing requires Pro' : undefined}
            className="rounded-full border border-[var(--bd-15)] bg-[var(--panel)] px-3 py-1.5 text-xs text-[var(--fg-soft)] transition hover:border-[var(--signal)]/40 hover:text-[var(--signal)] disabled:opacity-40 dark:border-white/12 dark:bg-white/[0.04] dark:text-white/70"
          >
            {qa.label}
          </button>
        ))}
        {gap.field === 'offerType' && !negotiationAllowed ? <PlanBadge feature="negotiation" /> : null}
      </div>
    </div>
  )
}

/** Enumerable quick answers per gap; everything gets Skip. */
export function gapQuickAnswers(
  gap: Gap,
  negotiationAllowed = false,
): Array<{ label: string; answer: GapAnswer; locked?: boolean }> {
  const answers: Array<{ label: string; answer: GapAnswer; locked?: boolean }> = []
  if (gap.field === 'offerType' && gap.offerKey) {
    answers.push(
      {
        label: 'Fixed price',
        answer: { gapId: gap.id, answer: 'Fixed price', fields: [{ target: 'offer', offerKey: gap.offerKey, field: 'offerType', value: 'fixed' }] },
      },
      {
        label: 'Open to offers',
        locked: !negotiationAllowed,
        answer: { gapId: gap.id, answer: 'Open to offers', fields: [{ target: 'offer', offerKey: gap.offerKey, field: 'offerType', value: 'negotiable' }] },
      },
    )
  }
  answers.push({ label: 'Skip', answer: { gapId: gap.id, answer: 'skip', skipped: true } })
  return answers
}

function ReadinessRing({ value }: { value: number }) {
  const radius = 24
  const circumference = 2 * Math.PI * radius
  const filled = Math.max(0, Math.min(100, value)) / 100
  return (
    <div className="relative size-16 shrink-0" role="img" aria-label={`Readiness ${value}%`}>
      <svg viewBox="0 0 64 64" className="size-16 -rotate-90">
        <circle cx="32" cy="32" r={radius} fill="none" stroke="var(--bd-15)" strokeWidth="5" />
        <circle
          cx="32"
          cy="32"
          r={radius}
          fill="none"
          stroke="var(--ready)"
          strokeWidth="5"
          strokeLinecap="round"
          strokeDasharray={`${circumference * filled} ${circumference}`}
        />
      </svg>
      <span className="absolute inset-0 flex items-center justify-center text-sm font-semibold text-[var(--fg)]">{value}</span>
    </div>
  )
}

export { IntakeCardView }
