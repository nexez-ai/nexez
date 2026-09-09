// Seller intake interview - the platform service behind /api/agents/intake/*
// (spec: nexez-intake-interview-spec.md §5). Mirrors the Nexxi pattern: routes
// are thin; this module owns the turn loop, the LLM tool schema, and the
// materialization at commit. Every tool call the LLM makes is validated by the
// pure reducer (lib/intake) - the model cannot skip phases, invent offers, or
// commit; validation failures are fed back as tool results so it can repair.
//
// Dependency injection: the LLM call and the site importer are injectable
// (deps.llm / deps.importSite) so unit tests run hermetically and a missing
// LLM_API_KEY degrades to a deterministic interviewer that asks the top gap
// batch verbatim (structured quick-answers keep the loop functional without
// any model).
import type { SupabaseClient } from '@supabase/supabase-js'
import { getReadinessScore, normalizeSlug, type AgentPage, type OfferItem } from '../agent-page'
import { commerceTemplateLineageFromSources } from '../commerce-template-lineage'
import {
  publicIdentifierSuggestions,
  publicIdentifierWithSuffix,
  validatePublicIdentifier,
} from '../public-identifier'
import type { ImportResult } from '../importer'
import { INTAKE_SAFETY_PREAMBLE, fenceUntrusted } from '../llm-engine/prompt-safety'
import { captureError, captureEvent } from '../observability'
import {
  analyzeGaps,
  applyIntakeAction,
  createIntakeState,
  handoffEligible,
  hasNegotiationConfiguration,
  normalizeIntakeDraftNegotiation,
  VOLUNTEERED_PREFIX,
  type Gap,
  type GapAnswer,
  type IntakeApplyResult,
  type IntakeDraft,
  type IntakeExtraction,
  type IntakeEntitlementPolicy,
  type IntakePageField,
  type IntakeState,
} from '../intake'
import {
  OFFER_ATTRIBUTE_TOOL_SCHEMA,
  OFFER_CONFIGURATION_PROMPT,
  OFFER_INPUT_TOOL_SCHEMA,
} from './intake-commerce-tool-schema'

type Db = SupabaseClient

export type IntakeSessionRow = {
  id: string
  owner_id: string
  page_id: string | null
  status: 'active' | 'handed_off' | 'abandoned'
  phase: IntakeState['phase']
  state: IntakeState | Record<string, never>
  created_at?: string
  updated_at?: string
}

export type IntakeCard =
  | { type: 'source_ingested'; sourceId: string; label: string; offers: number; confidence?: number }
  | { type: 'gap_batch'; gaps: Gap[] }
  | { type: 'draft_summary'; draft: IntakeDraft; readiness: number; handoffEligible: boolean }
  | { type: 'handoff'; via: 'agent' | 'owner_exit' }
  // Client-only: the web intake seeds this to let the seller pull a live catalog
  // (Calendly/Shopify/Square/Acuity) mid-interview. The server never emits it -
  // the client posts the chosen provider + credentials to /ingest and folds the
  // result. `calendlyConnected` (re-interview only) offers "use saved token".
  | { type: 'integration_connect'; calendlyConnected?: boolean }

export type IntakeTurnResult =
  | { ok: true; message: string; cards: IntakeCard[]; state: IntakeState; status: IntakeSessionRow['status'] }
  | { ok: false; status: number; error: string; code?: string }

type ToolCall = { id: string; type: 'function'; function: { name: string; arguments: string } }
type ChatMessage =
  | { role: 'system' | 'user'; content: string }
  | { role: 'assistant'; content: string | null; tool_calls?: ToolCall[] }
  | { role: 'tool'; tool_call_id: string; content: string }
type ChatResponse = { choices?: Array<{ message?: { content?: string | null; tool_calls?: ToolCall[] } }> }

export type IntakeDeps = {
  /** OpenAI-compatible chat completion. Injectable for tests / alternates.
   * Explicit null disables the deployment model for deterministic-only plans. */
  llm?: ((messages: ChatMessage[], tools: typeof INTAKE_TOOLS) => Promise<ChatResponse>) | null
  /** Site importer boundary (lib/importer analyzeSite). Injectable for tests. */
  importSite?: (url: string) => Promise<ImportResult>
  /** Clock + id source (kept out of the pure reducer; injectable for tests). */
  now?: () => Date
  newId?: () => string
}

// ---------------------------------------------------------------------------
// System prompt + tool schema (spec §5)

export const INTAKE_SYSTEM_PROMPT = `You are the Nexez intake interviewer - a seller-side agent genuinely interested in understanding this business so it succeeds on the platform.

You are NOT a form. The extraction already captured what the owner's website and integrations state; your job is to interview the owner ONLY about the gaps the platform surfaces to you, conversationally.

Rules:
- Ask at most 1–3 RELATED questions per turn (one ask_gaps call), acknowledging what you already learned ("Your site lists three wedding packages - do those prices still hold?"). Never a laundry list.
- Map free-form answers into record_answers with structured field updates. Quote the owner faithfully in the answer text. An answer WITHOUT field updates records nothing on the draft - if the owner stated a fact, it must appear in fields.
- Never invent offers, prices, or facts. propose_offers only curates what extraction or the owner provided. If a fact is missing, ask.
- Mark skipped:true ONLY when the owner declines a question ("skip", "later", "no thanks"). Never skip questions on their behalf.
- When the platform tells you no blocking gaps remain, summarize the draft in plain language and call request_handoff so the owner can review in the builder. Keep going on quality/opportunity gaps only if the owner is engaged.
- Your text reply is ALWAYS spoken directly to the owner - never narrate tools, internal state, or bookkeeping ("no new input to record" is forbidden). Keep replies short, warm, and specific to THIS business. Sentence case. No emoji.

FIELD-UPDATE GRAMMAR (record_answers fields[] - the only shapes the platform accepts):
- Listing fact:   {"target":"page","field":"location","value":"Austin, TX"}   (fields: name, description, website_url, cta_url, cta_label, audience, location, contact_email, industry)
- Edit an offer:  {"target":"offer","offerKey":"services-0","field":"price","value":"$350"}
- NEW offer:      {"target":"new_offer","kind":"services","offer":{"name":"Real Estate Aerial Package","price":"$350","description":"Aerial property shoot","duration":"2 hours","url":""}}
- Negotiation:    {"target":"offer_rules","offerKey":"services-0","rules":{"minPrice":"$900","minNoticeHours":48}}
- FAQ:            {"target":"faq","question":"Do you travel?","answer":"Yes, within the metro."}
${OFFER_CONFIGURATION_PROMPT}
Example - owner says "We offer a Real Estate Aerial Package for $350, takes about 2 hours, and a Wedding Aerial Film from $1,200":
record_answers with TWO new_offer updates, one per offer, each carrying name + price (+ duration when stated).` + INTAKE_SAFETY_PREAMBLE

export const INTAKE_TOOLS = [
  {
    type: 'function' as const,
    function: {
      name: 'ask_gaps',
      description: 'Ask the owner about 1–3 related gaps (by id, from the CURRENT GAPS list). phrasing is your conversational wording of those questions, shown to the owner.',
      parameters: {
        type: 'object',
        properties: {
          gapIds: { type: 'array', items: { type: 'string' }, maxItems: 3 },
          phrasing: { type: 'string' },
        },
        required: ['gapIds', 'phrasing'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'record_answers',
      description:
        "Record the owner's answers to previously asked gaps, mapping their words into structured field updates (see the FIELD-UPDATE GRAMMAR in your instructions). An answer without fields records NOTHING on the draft. skipped:true ONLY when the owner declines.",
      parameters: {
        type: 'object',
        properties: {
          answers: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                gapId: { type: 'string' },
                answer: { type: 'string', description: "The owner's words (faithful quote or close paraphrase)." },
                skipped: { type: 'boolean' },
                fields: {
                  type: 'array',
                  description: 'Structured updates derived from the answer - one per stated fact.',
                  items: {
                    type: 'object',
                    properties: {
                      target: { type: 'string', enum: ['page', 'offer', 'offer_rules', 'offer_input', 'offer_attribute', 'new_offer', 'faq'] },
                      field: {
                        type: 'string',
                        description:
                          'page: name|description|website_url|cta_url|cta_label|audience|location|contact_email|industry · offer: name|price|description|duration|serviceArea|travelFee|isMobile|url|offerType',
                      },
                      value: { type: 'string' },
                      offerKey: { type: 'string', description: 'e.g. services-0 - required for target offer / offer_rules / offer_input / offer_attribute.' },
                      kind: { type: 'string', enum: ['services', 'products'], description: 'for target new_offer.' },
                      offer: {
                        type: 'object',
                        description: 'for target new_offer: {name, price, description, url, duration?, serviceArea?, travelFee?}. Structured configuration must use dedicated offer_input / offer_attribute updates.',
                      },
                      rules: {
                        type: 'object',
                        description: 'for target offer_rules: {minPrice?, maxDiscountPercent?, minNoticeHours?, blackoutDates?, maxBookingsPerWeek?}.',
                      },
                      input: OFFER_INPUT_TOOL_SCHEMA,
                      attribute: OFFER_ATTRIBUTE_TOOL_SCHEMA,
                      origin: {
                        type: 'string',
                        enum: ['suggested'],
                        description: 'Use only when the owner explicitly confirms a fact you suggested; records suggested_confirmed provenance.',
                      },
                      question: { type: 'string', description: 'for target faq.' },
                      answer: { type: 'string', description: 'for target faq.' },
                    },
                    required: ['target'],
                  },
                },
              },
              required: ['gapId', 'answer'],
            },
          },
        },
        required: ['answers'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'set_page_field',
      description: 'Record a fact the owner volunteered unprompted (a listing-level field only). statement is their wording.',
      parameters: {
        type: 'object',
        properties: {
          field: { type: 'string', enum: ['name', 'description', 'website_url', 'cta_url', 'cta_label', 'audience', 'location', 'contact_email', 'industry'] },
          value: { type: 'string' },
          statement: { type: 'string' },
        },
        required: ['field', 'value', 'statement'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'propose_offers',
      description: 'Curate the draft\'s offers for one kind (services|products). Only offers derived from extraction or stated by the owner are accepted.',
      parameters: {
        type: 'object',
        properties: {
          kind: { type: 'string', enum: ['services', 'products'] },
          offers: { type: 'array', items: { type: 'object' } },
        },
        required: ['kind', 'offers'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'ingest_url',
      description: 'Ingest another URL the owner mentioned (their site, a pricing page, a socials page). The platform crawls and extracts it.',
      parameters: {
        type: 'object',
        properties: { url: { type: 'string' } },
        required: ['url'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'request_handoff',
      description: 'Offer the builder handoff once no blocking gaps remain. summary is your plain-language recap of the draft, shown to the owner.',
      parameters: {
        type: 'object',
        properties: { summary: { type: 'string' } },
        required: ['summary'],
      },
    },
  },
]

// ---------------------------------------------------------------------------
// Extraction mapping

/** Trim an ImportResult into the serializable extraction the session stores. */
export function importResultToExtraction(sourceId: string, result: ImportResult): IntakeExtraction {
  return {
    sourceId,
    title: result.title || null,
    description: result.description || null,
    website_url: result.website_url || null,
    offers: (result.structuredOffers ?? []).map((o) => ({ ...o })),
    faqs: result.faqs ?? null,
    industry: result.industry ?? null,
    audience: result.audience ?? null,
    location: result.location ?? null,
    cta_label: result.cta_label || null,
    cta_url: result.cta_url || null,
    clarifyingQuestions: result.clarifyingQuestions ?? null,
    confidence: result.confidence,
  }
}

// ---------------------------------------------------------------------------
// Session load/persist (RLS-bound - tenancy is enforced by both the .eq and RLS)

export async function loadIntakeSession(db: Db, sessionId: string, ownerId: string): Promise<IntakeSessionRow | null> {
  const { data, error } = await db
    .from('intake_sessions')
    .select('*')
    .eq('id', sessionId)
    .eq('owner_id', ownerId)
    .maybeSingle()
  if (error || !data) return null
  return data as IntakeSessionRow
}

/** Parse the stored JSONB into a usable IntakeState, tolerating legacy/empty rows. */
export function sessionState(row: IntakeSessionRow): IntakeState {
  const state = row.state as Partial<IntakeState> | null
  if (!state || typeof state !== 'object' || !state.phase) return createIntakeState()
  return {
    phase: state.phase,
    sources: state.sources ?? [],
    extractions: state.extractions ?? [],
    gaps: state.gaps ?? [],
    askedGapIds: state.askedGapIds ?? [],
    answers: state.answers ?? [],
    draft: state.draft ?? createIntakeState().draft,
    provenance: state.provenance ?? {},
    messages: state.messages ?? [],
    handoff: state.handoff ?? null,
  }
}

async function persistState(db: Db, row: IntakeSessionRow, state: IntakeState, patch: Partial<IntakeSessionRow> = {}) {
  const { error } = await db
    .from('intake_sessions')
    .update({ state, phase: state.phase, updated_at: new Date().toISOString(), ...patch })
    .eq('id', row.id)
    .eq('owner_id', row.owner_id)
  if (error) throw error
}

// ---------------------------------------------------------------------------
// The turn

const MAX_LLM_ROUNDS = 3
const CONTEXT_MESSAGES = 12
const CONTEXT_GAPS = 10

export async function handleIntakeTurn(
  input: {
    db: Db
    user: { id: string; email?: string | null }
    sessionId: string
    content?: string
    /** Structured quick-answers from the client's gap_batch card - bypasses LLM mapping. */
    structuredAnswers?: GapAnswer[]
    /** Effective owner capability resolved by the route. Missing is fail-closed. */
    negotiationAllowed?: boolean
  },
  deps: IntakeDeps = {},
): Promise<IntakeTurnResult> {
  const now = deps.now ?? (() => new Date())
  const newId = deps.newId ?? (() => crypto.randomUUID())
  const turnStartedAt = Date.now()
  const policy: IntakeEntitlementPolicy = { negotiationAllowed: input.negotiationAllowed === true }

  const row = await loadIntakeSession(input.db, input.sessionId, input.user.id)
  if (!row) return { ok: false, status: 404, error: 'Interview not found.' }
  if (row.status !== 'active') {
    return { ok: false, status: 409, error: 'This interview has already handed off to the builder.', code: 'already_handed_off' }
  }

  let state = sessionState(row)
  const cards: IntakeCard[] = []

  // 1. Record the owner's turn.
  if (input.content?.trim()) {
    const applied = applyIntakeAction(state, {
      type: 'ADD_MESSAGE',
      message: { id: newId(), role: 'owner', content: input.content.trim().slice(0, 4000), at: now().toISOString() },
    }, policy)
    if (applied.ok) state = applied.state
  }

  // 2. Structured quick-answers apply directly - no LLM interpretation needed.
  if (input.structuredAnswers?.length) {
    const applied = applyIntakeAction(state, { type: 'RECORD_ANSWERS', answers: input.structuredAnswers }, policy)
    if (!applied.ok) {
      return { ok: false, status: applied.code === 'feature_not_available' ? 403 : 400, error: applied.error, code: applied.code }
    }
    state = applied.state
  }

  // 3. Auto-advance through analysis once sources exist - the conversational
  //    surface never exposes ANALYZE_GAPS as something the LLM must remember.
  if ((state.phase === 'INGEST' || state.phase === 'EXTRACT') && state.sources.length > 0) {
    const applied = applyIntakeAction(state, { type: 'ANALYZE_GAPS' }, policy)
    if (applied.ok) state = applied.state
  }

  // 4. The agent's turn: LLM when configured, deterministic interviewer otherwise.
  const llm = deps.llm === undefined
    ? (process.env.LLM_API_KEY ? defaultChatCompletion : null)
    : deps.llm
  let message: string
  if (llm && state.phase !== 'REVIEW_HANDOFF') {
    const turn = await runLlmTurn(state, llm, { now, newId, importSite: deps.importSite, cards, policy })
    state = turn.state
    message = turn.message
  } else {
    const turn = deterministicTurn(state, { now, newId, policy })
    state = turn.state
    message = turn.message
    cards.push(...turn.cards)
  }

  // 5. Standing cards: the draft summary whenever handoff is on the table.
  if (state.phase === 'REVIEW_HANDOFF' || handoffEligible(state)) {
    cards.push({ type: 'draft_summary', draft: state.draft, readiness: draftReadiness(state.draft), handoffEligible: true })
  }
  if (state.handoff) cards.push({ type: 'handoff', via: state.handoff.via })

  try {
    await persistState(input.db, row, state)
  } catch {
    return { ok: false, status: 500, error: 'Could not save the interview. Please retry.' }
  }

  // Telemetry (spec §8) - the dataset that tunes analyzeGaps priorities later.
  captureEvent('intake.turn', {
    sessionId: row.id,
    phase: state.phase,
    llm: Boolean(llm),
    structuredAnswers: input.structuredAnswers?.length ?? 0,
    gapsRemaining: state.gaps.length,
    blockingRemaining: state.gaps.filter((g) => g.kind === 'blocking').length,
    answered: state.answers.filter((a) => !a.skipped).length,
    skipped: state.answers.filter((a) => a.skipped).length,
    durationMs: Date.now() - turnStartedAt,
  })
  return { ok: true, message, cards, state, status: row.status }
}

/** Readiness of the working draft, through the same rubric the platform uses. */
export function draftReadiness(draft: IntakeDraft): number {
  const page: Partial<AgentPage> = {
    name: draft.name || undefined,
    slug: draft.name ? normalizeSlug(draft.name) : undefined,
    description: draft.description || null,
    website_url: draft.website_url || null,
    cta_url: draft.cta_url || null,
    audience: draft.audience || null,
    industry: draft.industry || null,
    location: draft.location || null,
    contact_email: draft.contact_email || null,
    services: draft.services,
    products: draft.products,
    faqs: draft.faqs,
    is_published: false,
  }
  return getReadinessScore(page)
}

// ---------------------------------------------------------------------------
// Deterministic interviewer (no LLM): ask the top gap batch verbatim. The
// gap_batch card's quick answers keep the loop functional via structuredAnswers.

function deterministicTurn(
  state: IntakeState,
  ids: { now: () => Date; newId: () => string; policy: IntakeEntitlementPolicy },
): { state: IntakeState; message: string; cards: IntakeCard[] } {
  if (state.phase === 'REVIEW_HANDOFF') {
    return { state, message: 'This interview has wrapped - your draft is ready to review in the builder.', cards: [] }
  }
  const batch = state.gaps.slice(0, 3)
  if (batch.length === 0) {
    if (state.sources.length === 0) {
      return {
        state,
        message: 'Share your website URL (or say "start from scratch") and I will pull in everything it already says before asking you anything.',
        cards: [],
      }
    }
    return {
      state,
      message: 'I have everything I need - review your draft in the builder whenever you are ready.',
      cards: [],
    }
  }
  const phrasing = batch.map((g) => g.question).join('\n')
  const applied = applyIntakeAction(state, {
    type: 'ASK_GAPS',
    gapIds: batch.map((g) => g.id),
    message: { id: ids.newId(), role: 'agent', content: phrasing, at: ids.now().toISOString() },
  }, ids.policy)
  const next = applied.ok ? applied.state : state
  return { state: next, message: phrasing, cards: [{ type: 'gap_batch', gaps: batch }] }
}

// ---------------------------------------------------------------------------
// LLM turn loop

async function runLlmTurn(
  initial: IntakeState,
  llm: NonNullable<IntakeDeps['llm']>,
  ctx: {
    now: () => Date
    newId: () => string
    importSite?: IntakeDeps['importSite']
    cards: IntakeCard[]
    policy: IntakeEntitlementPolicy
  },
): Promise<{ state: IntakeState; message: string }> {
  let state = initial
  const transcript: ChatMessage[] = [
    { role: 'system', content: INTAKE_SYSTEM_PROMPT },
    { role: 'user', content: buildContextBlock(state, 'opening', ctx.policy.negotiationAllowed) },
  ]

  let finalText = ''
  for (let round = 0; round < MAX_LLM_ROUNDS; round++) {
    let response: ChatResponse
    try {
      response = await llm(transcript, INTAKE_TOOLS)
    } catch (error) {
      captureError(error, { scope: 'intake.llm', round })
      break // model unavailable mid-turn → fall back below
    }
    const assistant = response.choices?.[0]?.message
    if (!assistant) break
    const toolCalls = Array.isArray(assistant.tool_calls) ? assistant.tool_calls : []
    if (typeof assistant.content === 'string' && assistant.content.trim()) {
      finalText = assistant.content.trim()
    }
    if (toolCalls.length === 0) break

    transcript.push({ role: 'assistant', content: assistant.content ?? null, tool_calls: toolCalls })
    for (const call of toolCalls) {
      const executed = await executeToolCall(state, call, ctx)
      state = executed.state
      if (executed.message) finalText = executed.message
      transcript.push({ role: 'tool', tool_call_id: call.id, content: JSON.stringify(executed.result) })
    }
    // A successful handoff ends the interview - no further rounds (any extra
    // tool call would only bounce off already_handed_off).
    if (state.handoff) break
    // Refresh the machine context after mutations so the next round sees
    // current gaps/eligibility rather than a stale list. The follow-up
    // instruction differs from the opening one: re-sending "record their
    // answers first" after they were recorded made the model narrate
    // bookkeeping ("no new input to record") instead of talking to the owner.
    transcript.push({ role: 'user', content: buildContextBlock(state, 'followup', ctx.policy.negotiationAllowed) })
  }

  if (!finalText) {
    const fallback = deterministicTurn(state, ctx)
    state = fallback.state
    finalText = fallback.message
    ctx.cards.push(...fallback.cards)
  }
  return { state, message: finalText }
}

/** The machine-truth block the model reasons over each round. Owner words are
 *  already in state.messages; extraction/pasted content is fenced as data. */
function buildContextBlock(
  state: IntakeState,
  stage: 'opening' | 'followup' = 'opening',
  negotiationAllowed = false,
): string {
  const gaps = state.gaps.slice(0, CONTEXT_GAPS).map((g) => ({ id: g.id, kind: g.kind, question: g.question, why: g.why }))
  const recent = state.messages.slice(-CONTEXT_MESSAGES).map((m) => `${m.role === 'owner' ? 'OWNER' : 'YOU'}: ${m.content}`)
  const draftSummary = {
    name: state.draft.name,
    description: state.draft.description.slice(0, 240),
    industry: state.draft.industry,
    location: state.draft.location,
    audience: state.draft.audience,
    offers: [...state.draft.services, ...state.draft.products].map((o) => ({ name: o.name, price: o.price, duration: o.duration })),
    faqs: state.draft.faqs.length,
  }
  const instruction =
    stage === 'followup'
      ? 'Your tool calls were processed (results above; a rejection explains the exact shape to retry with). Now reply to the OWNER in plain conversational text - acknowledge what you captured in their words, and if you have not asked the next 1–3 gaps this turn, call ask_gaps (or request_handoff when eligible). Never mention tools or internal state.'
      : 'Respond to the owner now. FIRST record every fact from their last message (record_answers with field updates - an answer without fields records nothing), then ask the next 1–3 related gaps via ask_gaps, or request_handoff when eligible.'
  return [
    `PHASE: ${state.phase}`,
    `HANDOFF_ELIGIBLE: ${handoffEligible(state)}`,
    negotiationAllowed
      ? 'PLAN CAPABILITY: New open-to-offers pricing and negotiation rules are allowed.'
      : 'PLAN CAPABILITY: Do not create or change open-to-offers pricing or negotiation rules. Existing retained settings may stay unchanged; Fixed/clear is allowed.',
    `CURRENT DRAFT:\n${JSON.stringify(draftSummary, null, 1)}`,
    `CURRENT GAPS (ask via ask_gaps with these ids):\n${JSON.stringify(gaps, null, 1)}`,
    recent.length ? `CONVERSATION SO FAR:\n${fenceUntrusted('OWNER CONVERSATION', recent.join('\n'))}` : 'CONVERSATION SO FAR: (none - this is your opening turn)',
    instruction,
  ].join('\n\n')
}

/** Deterministic repairs for the model mistakes the first live pass surfaced -
 *  narrow and unambiguous only; everything else reaches the reducer, whose
 *  teaching rejections feed back for the model to repair itself.
 *  - `fields` sent as a JSON STRING → parsed.
 *  - `{name|field, value}` with no target, where the key is a page field →
 *    coerced to a page update (page-field names are unambiguous). */
export function normalizeLlmAnswer(answer: GapAnswer): GapAnswer {
  let fields: unknown = answer.fields
  if (typeof fields === 'string') {
    try {
      fields = JSON.parse(fields)
    } catch {
      return answer // the reducer rejects non-array fields with a teaching error
    }
  }
  if (!Array.isArray(fields)) return fields === undefined || fields === null ? answer : { ...answer, fields: fields as GapAnswer['fields'] }
  const normalized = fields.map((update) => {
    if (update && typeof update === 'object' && !('target' in update)) {
      const u = update as Record<string, unknown>
      const key = typeof u.field === 'string' ? u.field : typeof u.name === 'string' ? u.name : null
      if (key && (PAGE_FIELDS as readonly string[]).includes(key) && typeof u.value === 'string') {
        return { target: 'page' as const, field: key as IntakePageField, value: u.value }
      }
    }
    return update
  })
  return { ...answer, fields: normalized as GapAnswer['fields'] }
}

const PAGE_FIELDS = [
  'name',
  'description',
  'website_url',
  'cta_url',
  'cta_label',
  'audience',
  'location',
  'contact_email',
  'industry',
] as const

type ExecutedTool = { state: IntakeState; result: Record<string, unknown>; message?: string }

async function executeToolCall(
  state: IntakeState,
  call: ToolCall,
  ctx: {
    now: () => Date
    newId: () => string
    importSite?: IntakeDeps['importSite']
    cards: IntakeCard[]
    policy: IntakeEntitlementPolicy
  },
): Promise<ExecutedTool> {
  let args: Record<string, unknown>
  try {
    args = JSON.parse(call.function.arguments || '{}')
  } catch {
    return { state, result: { ok: false, code: 'bad_arguments', error: 'Tool arguments were not valid JSON.' } }
  }

  const fold = (applied: IntakeApplyResult, onOk?: (next: IntakeState) => { result?: Record<string, unknown>; message?: string }): ExecutedTool => {
    if (!applied.ok) return { state, result: { ok: false, code: applied.code, error: applied.error } }
    const extra = onOk?.(applied.state) ?? {}
    return { state: applied.state, result: { ok: true, ...extra.result }, message: extra.message }
  }

  switch (call.function.name) {
    case 'ask_gaps': {
      const gapIds = Array.isArray(args.gapIds) ? (args.gapIds as string[]) : []
      const phrasing = typeof args.phrasing === 'string' ? args.phrasing.trim() : ''
      if (!phrasing) return { state, result: { ok: false, code: 'bad_arguments', error: 'ask_gaps needs phrasing.' } }
      return fold(
        applyIntakeAction(state, {
          type: 'ASK_GAPS',
          gapIds,
          message: { id: ctx.newId(), role: 'agent', content: phrasing, at: ctx.now().toISOString() },
        }, ctx.policy),
        (next) => {
          ctx.cards.push({ type: 'gap_batch', gaps: next.gaps.filter((g) => gapIds.includes(g.id)) })
          return { message: phrasing }
        },
      )
    }
    case 'record_answers': {
      const answers = Array.isArray(args.answers) ? (args.answers as GapAnswer[]).map(normalizeLlmAnswer) : []
      return fold(applyIntakeAction(state, { type: 'RECORD_ANSWERS', answers }, ctx.policy), (next) => ({
        result: { remainingGaps: next.gaps.length, handoffEligible: handoffEligible(next) },
      }))
    }
    case 'set_page_field': {
      const field = args.field as IntakePageField
      const value = typeof args.value === 'string' ? args.value : ''
      const statement = typeof args.statement === 'string' ? args.statement : value
      const answer: GapAnswer = {
        gapId: `${VOLUNTEERED_PREFIX}page:${field}`,
        answer: statement,
        fields: [{ target: 'page', field, value }],
      }
      return fold(applyIntakeAction(state, { type: 'RECORD_ANSWERS', answers: [answer] }, ctx.policy))
    }
    case 'propose_offers': {
      const kind = args.kind === 'products' ? 'products' : 'services'
      const offers = Array.isArray(args.offers) ? (args.offers as OfferItem[]) : []
      return fold(applyIntakeAction(state, { type: 'PROPOSE_OFFERS', kind, offers }, ctx.policy))
    }
    case 'ingest_url': {
      const url = typeof args.url === 'string' ? args.url.trim() : ''
      if (!ctx.importSite) {
        return { state, result: { ok: false, code: 'importer_unavailable', error: 'URL ingestion is unavailable right now - continue the interview.' } }
      }
      const sourceId = ctx.newId()
      const added = applyIntakeAction(state, {
        type: 'ADD_SOURCE',
        source: { id: sourceId, kind: 'url', value: url, label: url, addedAt: ctx.now().toISOString() },
      }, ctx.policy)
      if (!added.ok) return { state, result: { ok: false, code: added.code, error: added.error } }
      let extraction: IntakeExtraction
      try {
        extraction = importResultToExtraction(sourceId, await ctx.importSite(url))
      } catch {
        return { state, result: { ok: false, code: 'import_failed', error: 'Could not crawl that URL. Ask the owner to paste the key details instead.' } }
      }
      return fold(applyIntakeAction(added.state, { type: 'RECORD_EXTRACTION', extraction }, ctx.policy), (next) => {
        ctx.cards.push({ type: 'source_ingested', sourceId, label: url, offers: extraction.offers.length, confidence: extraction.confidence })
        return { result: { offersFound: extraction.offers.length, newGaps: next.gaps.length } }
      })
    }
    case 'request_handoff': {
      const summary = typeof args.summary === 'string' && args.summary.trim() ? args.summary.trim() : 'Your draft is ready to review in the builder.'
      return fold(
        applyIntakeAction(state, {
          type: 'REQUEST_HANDOFF',
          at: ctx.now().toISOString(),
          message: { id: ctx.newId(), role: 'agent', content: summary, at: ctx.now().toISOString() },
        }, ctx.policy),
        () => ({ message: summary }),
      )
    }
    default:
      return { state, result: { ok: false, code: 'unknown_tool', error: `No tool named ${call.function.name}.` } }
  }
}

// ---------------------------------------------------------------------------
// Commit (spec §3 REVIEW_HANDOFF): materialize through the existing paths. The
// builder remains the single source of truth for editing - a NEW page is
// created as a draft (is_published false) exactly like /create does; a
// re-interview stages onto pages.draft (the D12 overlay) and never touches
// live columns.

export type IntakeCommitResult =
  | { ok: true; pageId: string; slug: string | null; alreadyCommitted: boolean }
  | { ok: false; status: number; error: string }

export async function commitIntakeSession(
  input: {
    db: Db
    admin: Db
    user: { id: string }
    sessionId: string
    /** Effective owner capability resolved by the route. Missing is fail-closed. */
    negotiationAllowed?: boolean
  },
  deps: { now?: () => Date } = {},
): Promise<IntakeCommitResult> {
  const now = deps.now ?? (() => new Date())
  const row = await loadIntakeSession(input.db, input.sessionId, input.user.id)
  if (!row) return { ok: false, status: 404, error: 'Interview not found.' }
  if (row.status === 'handed_off' && row.page_id) {
    // Idempotent replay - the client can safely retry a commit.
    return { ok: true, pageId: row.page_id, slug: null, alreadyCommitted: true }
  }
  if (row.status !== 'active') return { ok: false, status: 409, error: 'This interview is no longer active.' }

  let state = sessionState(row)
  if (state.phase !== 'REVIEW_HANDOFF') {
    // An owner-initiated commit is always allowed - it IS the exit.
    const applied = applyIntakeAction(
      state,
      { type: 'EXIT_TO_BUILDER', at: now().toISOString() },
      { negotiationAllowed: input.negotiationAllowed === true },
    )
    if (!applied.ok) return { ok: false, status: 409, error: applied.error }
    state = applied.state
  }

  let negotiationNormalized = 0
  if (input.negotiationAllowed !== true) {
    let trustedBaseline: Pick<IntakeDraft, 'services' | 'products'> | null = null
    if (row.page_id) {
      const { data: page, error: pageError } = await input.db
        .from('pages')
        .select('services, products')
        .eq('id', row.page_id)
        .eq('owner_id', input.user.id)
        .maybeSingle<{ services: OfferItem[] | null; products: OfferItem[] | null }>()
      const draftHasNegotiation = [...state.draft.services, ...state.draft.products]
        .some(hasNegotiationConfiguration)
      if ((pageError || !page) && draftHasNegotiation) {
        return {
          ok: false,
          status: 503,
          error: 'Could not verify this listing’s retained offer rules. Nothing was changed; please retry.',
        }
      }
      if (page) {
        trustedBaseline = {
          services: Array.isArray(page.services) ? page.services : [],
          products: Array.isArray(page.products) ? page.products : [],
        }
      }
    }
    const normalized = normalizeIntakeDraftNegotiation(state.draft, trustedBaseline)
    state = { ...state, draft: normalized.draft }
    negotiationNormalized = normalized.normalizedOffers
  }

  const draft = state.draft
  const commerceTemplateLineage = commerceTemplateLineageFromSources(state.sources)
  let pageId: string
  let slug: string | null = null

  if (row.page_id) {
    // Re-interview: stage onto the existing page's draft overlay (owner RLS write).
    const { error } = await input.db
      .from('pages')
      .update({
        draft: {
          name: draft.name || undefined,
          description: draft.description || null,
          services: draft.services,
          products: draft.products,
          faqs: draft.faqs,
          industry: draft.industry || null,
        },
        draft_updated_at: now().toISOString(),
      })
      .eq('id', row.page_id)
      .eq('owner_id', input.user.id)
    if (error) return { ok: false, status: 500, error: 'Could not stage the draft onto your listing.' }
    pageId = row.page_id
  } else {
    // New listing: same insert shape as /create, always as a draft - publishing
    // stays a human decision in the builder (spec §2.3).
    const name = draft.name.trim() || 'Untitled listing'
    slug = await uniqueIntakeSlug(input.admin, normalizeSlug(name) || 'listing', input.user.id)
    if (!slug) return { ok: false, status: 503, error: 'Could not check listing URL availability. Please try again.' }
    const { data, error } = await input.admin
      .from('pages')
      .insert({
        owner_id: input.user.id,
        name,
        slug,
        description: draft.description || null,
        website_url: draft.website_url || null,
        cta_url: draft.cta_url || draft.website_url || null,
        cta_label: draft.cta_label || 'Visit website',
        audience: draft.audience || null,
        location: draft.location || null,
        contact_email: draft.contact_email || null,
        industry: draft.industry || null,
        services: draft.services,
        products: draft.products,
        faqs: draft.faqs,
        is_published: false,
        branding: {},
        ...(commerceTemplateLineage ?? {}),
      })
      .select('id, slug')
      .single()
    if (error || !data) {
      captureError(new Error('Intake listing insert failed'), { scope: 'intake.commit', code: error?.code ?? 'missing_row' })
      return { ok: false, status: 500, error: 'Could not create your listing from the interview.' }
    }
    pageId = data.id
    slug = data.slug
  }

  try {
    await persistState(input.db, row, state, { status: 'handed_off', page_id: pageId })
  } catch {
    return { ok: false, status: 500, error: 'Draft created, but the interview could not be closed. Retry to finish.' }
  }

  // Telemetry (spec §8): the per-session record - sources used, gap outcomes
  // (incl. asked-but-abandoned), time-to-handoff. Publish rate vs the form path
  // comes from joining these sessions' page_ids against publish events.
  const answeredIds = new Set(state.answers.filter((a) => !a.skipped).map((a) => a.gapId))
  const skippedIds = new Set(state.answers.filter((a) => a.skipped).map((a) => a.gapId))
  const abandonedGapIds = state.askedGapIds.filter((id) => !answeredIds.has(id) && !skippedIds.has(id))
  captureEvent('intake.handoff', {
    sessionId: row.id,
    via: state.handoff?.via ?? 'owner_exit',
    pageId,
    newPage: !row.page_id,
    sourceKinds: state.sources.map((s) => s.kind),
    gapsAsked: state.askedGapIds.length,
    gapsAnswered: answeredIds.size,
    gapsSkipped: skippedIds.size,
    abandonedGapIds: abandonedGapIds.slice(0, 20),
    readiness: draftReadiness(state.draft),
    offers: state.draft.services.length + state.draft.products.length,
    negotiationNormalized,
    commerceTemplateId: commerceTemplateLineage?.commerce_template_id ?? null,
    commerceTemplateVersion: commerceTemplateLineage?.commerce_template_version ?? null,
    timeToHandoffMs: row.created_at ? Math.max(0, now().getTime() - new Date(row.created_at).getTime()) : null,
  })
  return { ok: true, pageId, slug, alreadyCommitted: false }
}

/** Check the identifier registry, which also protects deleted and renamed URLs.
 *  The insert trigger remains the final authority for concurrent claims. */
async function uniqueIntakeSlug(admin: Db, base: string, ownerId: string): Promise<string | null> {
  const normalized = normalizeSlug(base)
  const root = validatePublicIdentifier(normalized).ok
    ? normalized
    : publicIdentifierSuggestions(normalized)[0] || 'new-listing'
  for (let i = 0; i <= 50; i++) {
    const candidate = i === 50
      ? publicIdentifierWithSuffix(root, crypto.randomUUID().slice(0, 8))
      : i === 0 ? root : publicIdentifierWithSuffix(root, i + 1)
    const { data, error } = await admin.rpc('nz_public_identifier_availability', {
      p_namespace: 'page_slug',
      p_identifier: candidate,
      p_owner_id: ownerId,
      p_subject_id: null,
    })
    const availability = Array.isArray(data) ? data[0] : data
    if (error || typeof availability?.available !== 'boolean') {
      captureError(new Error('Intake identifier availability check failed'), { scope: 'intake.commit', code: error?.code ?? 'invalid_response' })
      return null
    }
    if (availability.available) return candidate
  }
  return null
}

// ---------------------------------------------------------------------------
// Default LLM boundary (mirrors the Nexxi chatCompletion fetch)

async function defaultChatCompletion(messages: ChatMessage[], tools: typeof INTAKE_TOOLS): Promise<ChatResponse> {
  const base = (process.env.LLM_BASE_URL || 'https://api.openai.com/v1').replace(/\/$/, '')
  const res = await fetch(`${base}/chat/completions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.LLM_API_KEY}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: process.env.LLM_MODEL || 'gpt-4o-mini',
      messages,
      tools,
      tool_choice: 'auto',
      temperature: 0.4,
      max_tokens: 700,
    }),
    signal: AbortSignal.timeout(18_000),
  })
  if (!res.ok) throw new Error(`Intake model request failed with HTTP ${res.status}`)
  return res.json()
}

/** Re-analyze helper for freshly created/seeded sessions (used by the threads
 *  create route so the first GET already shows gaps). */
export function initialAnalyzedState(state: IntakeState): IntakeState {
  if ((state.phase === 'INGEST' || state.phase === 'EXTRACT') && state.sources.length > 0) {
    const applied = applyIntakeAction(state, { type: 'ANALYZE_GAPS' })
    if (applied.ok) return applied.state
  }
  return state
}

export { analyzeGaps, createIntakeState }
