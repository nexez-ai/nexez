import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createSupabaseMock } from '../../../test/supabase-mock'
import { formatOfferLines, parseOfferLines, type OfferItem } from '../../agent-page'

const { captureEventMock } = vi.hoisted(() => ({ captureEventMock: vi.fn() }))
vi.mock('../../observability', () => ({
  captureEvent: captureEventMock,
  captureError: vi.fn(),
  isObservabilityConfigured: () => false,
}))

beforeEach(() => captureEventMock.mockClear())
import {
  commitIntakeSession,
  draftReadiness,
  handleIntakeTurn,
  importResultToExtraction,
  normalizeLlmAnswer,
  type IntakeSessionRow,
} from '../intake'
import { applyIntakeAction, createIntakeState, type IntakeState } from '../../intake'

// ---------------------------------------------------------------------------
// Fixtures

const T0 = '2026-07-06T00:00:00.000Z'
const OWNER = { id: 'owner-1', email: 'owner@example.com' }

/** A realistic analyzed session: one URL source, extraction folded, gaps live.
 *  Built through the real machine so the fixture can never drift from it. */
function analyzedState(): IntakeState {
  let state = createIntakeState()
  for (const action of [
    { type: 'ADD_SOURCE' as const, source: { id: 'src-1', kind: 'url' as const, value: 'https://apex.example', addedAt: T0 } },
    {
      type: 'RECORD_EXTRACTION' as const,
      extraction: {
        sourceId: 'src-1',
        title: 'Apex Catering Co.',
        description: 'Full-service catering.',
        website_url: 'https://apex.example',
        offers: [
          { name: 'Event Catering', description: 'Full service', price: '$1,200', url: '', duration: '4 hours' },
          { name: 'Drop-off Trays', description: 'Delivered trays', price: '', url: '' },
        ] as OfferItem[],
        industry: 'Catering',
        clarifyingQuestions: null,
      },
    },
    { type: 'ANALYZE_GAPS' as const },
  ]) {
    const applied = applyIntakeAction(state, action)
    if (!applied.ok) throw new Error(`fixture failed at ${action.type}: ${applied.error}`)
    state = applied.state
  }
  return state
}

function sessionRow(state: IntakeState, overrides: Partial<IntakeSessionRow> = {}): IntakeSessionRow {
  return { id: 'sess-1', owner_id: OWNER.id, page_id: null, status: 'active', phase: state.phase, state, ...overrides }
}

/** DB mock serving one intake_sessions row + capturing updates per table. */
function makeDb(
  row: IntakeSessionRow | null,
  captured: { sessions: any[]; pages: any[] } = { sessions: [], pages: [] },
  pageBaseline: { services: OfferItem[]; products: OfferItem[] } | null = null,
) {
  const db = createSupabaseMock((ctx) => {
    if (ctx.table === 'intake_sessions' && ctx.op === 'select') return { data: row }
    if (ctx.table === 'intake_sessions' && ctx.op === 'update') {
      captured.sessions.push(ctx.payload)
      return { data: null }
    }
    if (ctx.table === 'pages' && ctx.op === 'update') {
      captured.pages.push(ctx.payload)
      return { data: null }
    }
    if (ctx.table === 'pages' && ctx.op === 'select') return { data: pageBaseline }
    return { data: null }
  })
  return { db: db as any, captured }
}

const toolCall = (name: string, args: unknown) => ({
  id: `call-${name}`,
  type: 'function' as const,
  function: { name, arguments: JSON.stringify(args) },
})

const ids = { now: () => new Date(T0), newId: (() => { let n = 0; return () => `id-${n++}` })() }

// ---------------------------------------------------------------------------

describe('handleIntakeTurn - session guards', () => {
  it('404s when the session does not exist (or belongs to someone else - RLS + eq)', async () => {
    const { db } = makeDb(null)
    const result = await handleIntakeTurn({ db, user: OWNER, sessionId: 'sess-1', content: 'hi' }, ids)
    expect(result).toMatchObject({ ok: false, status: 404 })
  })

  it('409s when the interview already handed off', async () => {
    const { db } = makeDb(sessionRow(analyzedState(), { status: 'handed_off' }))
    const result = await handleIntakeTurn({ db, user: OWNER, sessionId: 'sess-1', content: 'hi' }, ids)
    expect(result).toMatchObject({ ok: false, status: 409, code: 'already_handed_off' })
  })
})

describe('handleIntakeTurn - deterministic interviewer (no LLM)', () => {
  it('an explicit deterministic-only policy suppresses a configured deployment model', async () => {
    vi.stubEnv('LLM_API_KEY', 'configured-but-not-entitled')
    const fetchMock = vi.spyOn(globalThis, 'fetch')
    try {
      const { db } = makeDb(sessionRow(analyzedState()))
      const result = await handleIntakeTurn(
        { db, user: OWNER, sessionId: 'sess-1', content: 'ready when you are' },
        { ...ids, llm: null },
      )
      expect(result.ok).toBe(true)
      expect(fetchMock).not.toHaveBeenCalled()
    } finally {
      fetchMock.mockRestore()
      vi.unstubAllEnvs()
    }
  })

  it('asks the top gap batch verbatim with a gap_batch card and persists', async () => {
    const { db, captured } = makeDb(sessionRow(analyzedState()))
    const result = await handleIntakeTurn({ db, user: OWNER, sessionId: 'sess-1', content: 'ready when you are' }, ids)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.state.phase).toBe('INTERVIEW')
    const batch = result.cards.find((c) => c.type === 'gap_batch')
    expect(batch).toBeTruthy()
    if (batch?.type === 'gap_batch') {
      expect(batch.gaps.length).toBeGreaterThan(0)
      expect(batch.gaps.length).toBeLessThanOrEqual(3)
      expect(result.message).toContain(batch.gaps[0].question)
    }
    expect(captured.sessions).toHaveLength(1)
    expect(captured.sessions[0].phase).toBe('INTERVIEW')
  })

  it('applies structured quick-answers through the reducer and re-interviews', async () => {
    const { db, captured } = makeDb(sessionRow(analyzedState()))
    const result = await handleIntakeTurn(
      {
        db,
        user: OWNER,
        sessionId: 'sess-1',
        structuredAnswers: [
          { gapId: 'offer:services-1:price', answer: '$250', fields: [{ target: 'offer', offerKey: 'services-1', field: 'price', value: '$250' }] },
        ],
      },
      ids,
    )
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.state.draft.services[1].price).toBe('$250')
    expect(result.state.provenance['offer:dropofftrays:price']).toBe('stated')
    expect(captured.sessions).toHaveLength(1)
  })

  it('rejects invalid structured answers with a 400 and does not persist', async () => {
    const { db, captured } = makeDb(sessionRow(analyzedState()))
    const result = await handleIntakeTurn(
      { db, user: OWNER, sessionId: 'sess-1', structuredAnswers: [{ gapId: 'not-a-gap', answer: 'x' }] },
      ids,
    )
    expect(result).toMatchObject({ ok: false, status: 400, code: 'unknown_gap' })
    expect(captured.sessions).toHaveLength(0)
  })

  it('fails structured Open to offers closed below Pro and allows it with the resolved capability', async () => {
    const answer = {
      gapId: 'offer:services-0:posture',
      answer: 'Open to offers',
      fields: [{ target: 'offer' as const, offerKey: 'services-0', field: 'offerType' as const, value: 'negotiable' as const }],
    }

    const blockedDb = makeDb(sessionRow(analyzedState()))
    const blocked = await handleIntakeTurn(
      { db: blockedDb.db, user: OWNER, sessionId: 'sess-1', structuredAnswers: [answer] },
      ids,
    )
    expect(blocked).toMatchObject({ ok: false, status: 403, code: 'feature_not_available' })
    expect(blockedDb.captured.sessions).toHaveLength(0)

    const allowedDb = makeDb(sessionRow(analyzedState()))
    const allowed = await handleIntakeTurn(
      {
        db: allowedDb.db,
        user: OWNER,
        sessionId: 'sess-1',
        structuredAnswers: [answer],
        negotiationAllowed: true,
      },
      ids,
    )
    expect(allowed.ok).toBe(true)
    if (allowed.ok) expect(allowed.state.draft.services[0].offerType).toBe('negotiable')
  })

  it('accepts structured core offer rules below Pro without opening negotiation', async () => {
    const db = makeDb(sessionRow(analyzedState()))
    const result = await handleIntakeTurn({
      db: db.db,
      user: OWNER,
      sessionId: 'sess-1',
      structuredAnswers: [{
        gapId: 'volunteered:core-rules',
        answer: 'Allow four bookings per week and include setup',
        fields: [{
          target: 'offer_rules',
          offerKey: 'services-0',
          rules: { maxBookingsPerWeek: 4, includedScope: 'Setup' },
        }],
      }],
    }, ids)

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.state.draft.services[0].offerType).toBeUndefined()
    expect(result.state.draft.services[0].rules).toEqual({ maxBookingsPerWeek: 4, includedScope: 'Setup' })
  })

  it('auto-advances INGEST sessions through analysis on the first turn', async () => {
    let state = createIntakeState()
    const added = applyIntakeAction(state, {
      type: 'ADD_SOURCE',
      source: { id: 'src-s', kind: 'none', value: '', addedAt: T0 },
    })
    if (added.ok) state = added.state
    const { db } = makeDb(sessionRow(state))
    const result = await handleIntakeTurn({ db, user: OWNER, sessionId: 'sess-1', content: 'starting from scratch' }, ids)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.state.phase).toBe('INTERVIEW') // INGEST → analyzed → asked
  })
})

describe('handleIntakeTurn - LLM tool loop (the reducer is the firewall)', () => {
  it('a valid ask_gaps tool call interviews with the model phrasing', async () => {
    const state = analyzedState()
    const firstGap = state.gaps[0]
    const llm = vi
      .fn()
      .mockResolvedValueOnce({
        choices: [{ message: { content: null, tool_calls: [toolCall('ask_gaps', { gapIds: [firstGap.id], phrasing: 'Quick one - what do the trays cost?' })] } }],
      })
      .mockResolvedValueOnce({ choices: [{ message: { content: '' } }] })
    const { db } = makeDb(sessionRow(state))
    const result = await handleIntakeTurn({ db, user: OWNER, sessionId: 'sess-1', content: 'hi' }, { ...ids, llm })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.message).toBe('Quick one - what do the trays cost?')
    expect(result.state.phase).toBe('INTERVIEW')
    expect(result.cards.some((c) => c.type === 'gap_batch')).toBe(true)
  })

  it('rejects a phase-skip: request_handoff with blocking gaps feeds the error back and never advances', async () => {
    const state = analyzedState() // Drop-off Trays unpriced → blocking gap
    const llm = vi
      .fn()
      .mockResolvedValueOnce({
        choices: [{ message: { content: null, tool_calls: [toolCall('request_handoff', { summary: 'All done!' })] } }],
      })
      .mockResolvedValueOnce({ choices: [{ message: { content: 'You are right - one more question first.' } }] })
    const { db } = makeDb(sessionRow(state))
    const result = await handleIntakeTurn({ db, user: OWNER, sessionId: 'sess-1', content: 'wrap it up' }, { ...ids, llm })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.state.phase).not.toBe('REVIEW_HANDOFF')
    expect(result.state.handoff).toBeNull()
    // the model saw the rejection as a tool result on the second round
    const secondCallMessages = llm.mock.calls[1][0] as Array<{ role: string; content: string }>
    const toolResult = secondCallMessages.find((m) => m.role === 'tool')
    expect(toolResult?.content).toContain('blocking_gaps_remain')
    expect(result.message).toBe('You are right - one more question first.')
  })

  it('rejects invented offers: propose_offers outside the pool leaves the draft untouched', async () => {
    const state = analyzedState()
    const llm = vi
      .fn()
      .mockResolvedValueOnce({
        choices: [{ message: { content: null, tool_calls: [toolCall('propose_offers', { kind: 'services', offers: [{ name: 'Platinum Mega Package', description: '', price: '$9,999', url: '' }] })] } }],
      })
      .mockResolvedValueOnce({ choices: [{ message: { content: 'Understood - sticking to what your site offers.' } }] })
    const { db } = makeDb(sessionRow(state))
    const result = await handleIntakeTurn({ db, user: OWNER, sessionId: 'sess-1', content: 'make me look bigger' }, { ...ids, llm })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.state.draft.services.map((o) => o.name)).toEqual(['Event Catering', 'Drop-off Trays'])
    const secondCallMessages = llm.mock.calls[1][0] as Array<{ role: string; content: string }>
    expect(secondCallMessages.find((m) => m.role === 'tool')?.content).toContain('invented_offer')
  })

  it('feeds an LLM-derived negotiation attempt back as a Pro rejection below Pro', async () => {
    const state = analyzedState()
    const llm = vi
      .fn()
      .mockResolvedValueOnce({
        choices: [{
          message: {
            content: null,
            tool_calls: [toolCall('record_answers', {
              answers: [{
                gapId: 'offer:services-0:posture',
                answer: 'Open to offers',
                fields: [{ target: 'offer', offerKey: 'services-0', field: 'offerType', value: 'negotiable' }],
              }],
            })],
          },
        }],
      })
      .mockResolvedValueOnce({ choices: [{ message: { content: 'That setting needs Pro, so I kept the listed price fixed.' } }] })
    const { db } = makeDb(sessionRow(state))
    const result = await handleIntakeTurn(
      { db, user: OWNER, sessionId: 'sess-1', content: 'Let buyers make offers.' },
      { ...ids, llm },
    )
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.state.draft.services[0].offerType).toBeUndefined()
    const secondRound = llm.mock.calls[1][0] as Array<{ role: string; content: string }>
    expect(secondRound.find((message) => message.role === 'tool')?.content).toContain('feature_not_available')
  })

  it('malformed tool arguments are survivable (bad_arguments fed back, no crash, no state change)', async () => {
    const state = analyzedState()
    const llm = vi
      .fn()
      .mockResolvedValueOnce({
        choices: [{ message: { content: null, tool_calls: [{ id: 'c1', type: 'function' as const, function: { name: 'ask_gaps', arguments: '{not json' } }] } }],
      })
      .mockResolvedValueOnce({ choices: [{ message: { content: 'Let me rephrase.' } }] })
    const { db } = makeDb(sessionRow(state))
    const result = await handleIntakeTurn({ db, user: OWNER, sessionId: 'sess-1', content: 'hi' }, { ...ids, llm })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.state.phase).toBe('GAP_ANALYSIS') // unchanged by the bad call
  })

  it('an LLM failure mid-turn falls back to the deterministic interviewer', async () => {
    const llm = vi.fn().mockRejectedValue(new Error('model down'))
    const { db } = makeDb(sessionRow(analyzedState()))
    const result = await handleIntakeTurn({ db, user: OWNER, sessionId: 'sess-1', content: 'hi' }, { ...ids, llm })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.message.length).toBeGreaterThan(0)
    expect(result.state.phase).toBe('INTERVIEW')
  })

  it('a legitimate handoff (no blocking gaps) succeeds and surfaces the draft_summary + handoff cards', async () => {
    // Resolve the blocking gap first through the machine.
    let state = analyzedState()
    const answered = applyIntakeAction(state, {
      type: 'RECORD_ANSWERS',
      answers: [{ gapId: 'offer:services-1:price', answer: '$250', fields: [{ target: 'offer', offerKey: 'services-1', field: 'price', value: '$250' }] }],
    })
    if (answered.ok) state = answered.state
    const llm = vi.fn().mockResolvedValueOnce({
      choices: [{ message: { content: null, tool_calls: [toolCall('request_handoff', { summary: 'Two offers, priced - review in the builder.' })] } }],
    })
    const { db } = makeDb(sessionRow(state))
    const result = await handleIntakeTurn({ db, user: OWNER, sessionId: 'sess-1', content: 'looks good' }, { ...ids, llm })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.state.phase).toBe('REVIEW_HANDOFF')
    expect(result.cards.some((c) => c.type === 'draft_summary')).toBe(true)
    expect(result.cards.some((c) => c.type === 'handoff' && c.via === 'agent')).toBe(true)
    expect(result.message).toContain('review in the builder')
    expect(llm).toHaveBeenCalledTimes(1) // handoff ends the loop's usefulness; no repair round needed
  })
})

describe('commitIntakeSession - materialization (spec §10)', () => {
  /** Rich offers exercising every roundtrip-sensitive field. */
  const richOffers: OfferItem[] = [
    {
      name: 'Event Catering',
      description: 'Full service',
      price: '$1,200',
      url: 'https://apex.example/book',
      duration: '4 hours',
      serviceArea: 'Austin metro',
      travelFee: '$50',
      isMobile: true,
      offerType: 'negotiable',
      rules: { minPrice: '$900', minNoticeHours: 48 },
      tiers: [{ name: 'Basic', price: '$800' }],
    },
    { name: 'Drop-off Trays', description: 'Delivered trays', price: '$250', url: '' },
  ]

  function committableState(): IntakeState {
    let state = analyzedState()
    for (const [i, offer] of richOffers.entries()) {
      const applied = applyIntakeAction(state, {
        type: 'RECORD_ANSWERS',
        answers: [
          {
            gapId: `volunteered:offer-${i}`,
            answer: 'offer details',
            fields: [{ target: 'new_offer', kind: 'services', offer }],
          },
        ],
      })
      if (applied.ok) state = applied.state
    }
    return state
  }

  function makeAdmin(takenSlugs: string[], inserted: any[]) {
    return createSupabaseMock((ctx) => {
      if (ctx.table === 'rpc:nz_public_identifier_availability') {
        const available = !takenSlugs.includes(ctx.payload.p_identifier)
        return { data: [{ available, reason: available ? 'available' : 'taken' }] }
      }
      if (ctx.table === 'pages' && ctx.op === 'select') {
        return { data: takenSlugs.includes(ctx.eqs.slug) ? { id: 'taken' } : null }
      }
      if (ctx.table === 'pages' && ctx.op === 'insert') {
        inserted.push(ctx.payload)
        return { data: { id: 'page-new', slug: ctx.payload.slug } }
      }
      return { data: null }
    }) as any
  }

  it('creates a NEW page owned by the caller, as a draft, with a unique slug', async () => {
    const state = committableState()
    const { db, captured } = makeDb(sessionRow(state))
    const inserted: any[] = []
    const admin = makeAdmin(['apex-catering-co'], inserted) // base slug taken → -2
    const result = await commitIntakeSession({ db, admin, user: OWNER, sessionId: 'sess-1' }, { now: () => new Date(T0) })
    expect(result).toMatchObject({ ok: true, pageId: 'page-new', slug: 'apex-catering-co-2', alreadyCommitted: false })
    expect(inserted).toHaveLength(1)
    expect(inserted[0]).toMatchObject({ owner_id: OWNER.id, is_published: false, name: 'Apex Catering Co.', industry: 'Catering' })
    // the session is closed and linked
    expect(captured.sessions[0]).toMatchObject({ status: 'handed_off', page_id: 'page-new' })
    expect(captured.sessions[0].state.phase).toBe('REVIEW_HANDOFF')
    expect(captured.sessions[0].state.handoff.via).toBe('owner_exit') // commit before agent handoff = the owner exit
  })

  it('skips deleted and renamed listing URLs even when no current page uses them', async () => {
    const { db } = makeDb(sessionRow(committableState()))
    const inserted: any[] = []
    const admin = makeAdmin([], inserted)
    admin.rpc.mockImplementation(async (_fn: string, args: Record<string, unknown>) => {
      const available = args.p_identifier === 'apex-catering-co-3'
      return { data: [{ available, reason: available ? 'available' : args.p_identifier === 'apex-catering-co' ? 'reserved' : 'taken' }], error: null }
    })

    const result = await commitIntakeSession({ db, admin, user: OWNER, sessionId: 'sess-1' })
    expect(result).toMatchObject({ ok: true, slug: 'apex-catering-co-3' })
    expect(inserted).toHaveLength(1)
    expect(admin.rpc).toHaveBeenCalledWith('nz_public_identifier_availability', {
      p_namespace: 'page_slug', p_identifier: 'apex-catering-co', p_owner_id: OWNER.id, p_subject_id: null,
    })
  })

  it.each([
    { data: null, error: { code: 'XX000' } },
    { data: [], error: null },
    { data: [{ available: 'true' }], error: null },
  ])('does not insert or close the interview when identifier availability is unreadable: %j', async (response) => {
    const { db, captured } = makeDb(sessionRow(committableState()))
    const inserted: any[] = []
    const admin = makeAdmin([], inserted)
    admin.rpc.mockResolvedValue(response)

    const result = await commitIntakeSession({ db, admin, user: OWNER, sessionId: 'sess-1' })
    expect(result).toMatchObject({ ok: false, status: 503 })
    expect(inserted).toHaveLength(0)
    expect(captured.sessions).toHaveLength(0)
  })

  it('bounds URL search and checks the random fallback before attempting an insert', async () => {
    const { db, captured } = makeDb(sessionRow(committableState()))
    const inserted: any[] = []
    const admin = makeAdmin([], inserted)
    admin.rpc.mockResolvedValue({ data: [{ available: false, reason: 'reserved' }], error: null })

    expect(await commitIntakeSession({ db, admin, user: OWNER, sessionId: 'sess-1' })).toMatchObject({ ok: false, status: 503 })
    expect(admin.rpc).toHaveBeenCalledTimes(51)
    expect(admin.rpc.mock.calls[50][1].p_identifier).toMatch(/^apex-catering-co-[a-f0-9]{8}$/)
    expect(inserted).toHaveLength(0)
    expect(captured.sessions).toHaveLength(0)
  })

  it('atomically retains an exact, registered template selection on a new listing', async () => {
    const state = committableState()
    state.sources.push({
      id: 'template-source',
      kind: 'template',
      value: 'commerce-template:events.party-rentals@1',
      addedAt: '2026-08-25T22:30:00.000Z',
    })
    const { db } = makeDb(sessionRow(state))
    const inserted: any[] = []

    const result = await commitIntakeSession({
      db,
      admin: makeAdmin([], inserted),
      user: OWNER,
      sessionId: 'sess-1',
    })

    expect(result.ok).toBe(true)
    expect(inserted[0]).toMatchObject({
      commerce_template_id: 'events.party-rentals',
      commerce_template_version: 1,
      commerce_template_adopted_at: '2026-08-25T22:30:00.000Z',
      commerce_template_source: 'owner_selected_intake',
    })
  })

  it('does not persist an unregistered template reference', async () => {
    const state = committableState()
    state.sources.push({
      id: 'unknown-template-source',
      kind: 'template',
      value: 'commerce-template:events.party-rentals@999',
      addedAt: '2026-08-25T22:30:00.000Z',
    })
    const { db } = makeDb(sessionRow(state))
    const inserted: any[] = []

    const result = await commitIntakeSession({
      db,
      admin: makeAdmin([], inserted),
      user: OWNER,
      sessionId: 'sess-1',
    })

    expect(result.ok).toBe(true)
    expect(inserted[0].commerce_template_id).toBeUndefined()
    expect(inserted[0].commerce_template_version).toBeUndefined()
    expect(inserted[0].commerce_template_adopted_at).toBeUndefined()
    expect(inserted[0].commerce_template_source).toBeUndefined()
  })

  it('serializes offers losslessly - the formatOfferLines/parseOfferLines roundtrip holds for every field', async () => {
    const state = committableState()
    const { db } = makeDb(sessionRow(state))
    const inserted: any[] = []
    const result = await commitIntakeSession({ db, admin: makeAdmin([], inserted), user: OWNER, sessionId: 'sess-1' })
    expect(result.ok).toBe(true)
    const services = inserted[0].services as OfferItem[]
    const roundtripped = parseOfferLines(formatOfferLines(services))
    expect(roundtripped).toHaveLength(services.length)
    for (const [i, original] of services.entries()) {
      const back = roundtripped[i]
      expect(back.name).toBe(original.name)
      expect(back.price).toBe(original.price)
      expect(back.description).toBe(original.description)
      expect(back.url).toBe(original.url)
      expect(back.duration).toBe(original.duration)
      expect(back.serviceArea).toBe(original.serviceArea)
      expect(back.travelFee).toBe(original.travelFee)
      expect(Boolean(back.isMobile)).toBe(Boolean(original.isMobile))
      expect(back.offerType).toBe(original.offerType)
      expect(back.rules).toEqual(original.rules)
      expect(back.tiers).toEqual(original.tiers)
    }
  })

  it('re-interview stages onto pages.draft and never touches live columns', async () => {
    const state = committableState()
    const { db, captured } = makeDb(sessionRow(state, { page_id: 'page-existing' }))
    const result = await commitIntakeSession({ db, admin: makeAdmin([], []), user: OWNER, sessionId: 'sess-1' }, { now: () => new Date(T0) })
    expect(result).toMatchObject({ ok: true, pageId: 'page-existing' })
    expect(captured.pages).toHaveLength(1)
    const patch = captured.pages[0]
    expect(patch.draft).toBeTruthy()
    expect(patch.draft.services.length).toBeGreaterThan(0)
    // live columns stay untouched - publishing is the builder's job
    expect(patch.name).toBeUndefined()
    expect(patch.services).toBeUndefined()
    expect(patch.is_published).toBeUndefined()
  })

  it('normalizes forged new negotiation config below Pro but preserves it for Pro', async () => {
    const state = committableState()
    state.draft.services[0] = {
      ...state.draft.services[0],
      offerType: 'negotiable',
      rules: { minPrice: '$900', minNoticeHours: 48 },
    }

    const freeInserted: any[] = []
    const freeDb = makeDb(sessionRow(state))
    const free = await commitIntakeSession({
      db: freeDb.db,
      admin: makeAdmin([], freeInserted),
      user: OWNER,
      sessionId: 'sess-1',
    })
    expect(free.ok).toBe(true)
    expect(freeInserted[0].services[0]).toMatchObject({ offerType: 'fixed' })
    expect(freeInserted[0].services[0].rules).toEqual({ minNoticeHours: 48 })
    expect(freeDb.captured.sessions[0].state.draft.services[0].rules).toEqual({ minNoticeHours: 48 })

    const proInserted: any[] = []
    const proDb = makeDb(sessionRow(state))
    const pro = await commitIntakeSession({
      db: proDb.db,
      admin: makeAdmin([], proInserted),
      user: OWNER,
      sessionId: 'sess-1',
      negotiationAllowed: true,
    })
    expect(pro.ok).toBe(true)
    expect(proInserted[0].services[0]).toMatchObject({
      offerType: 'negotiable',
      rules: { minPrice: '$900', minNoticeHours: 48 },
    })
  })

  it('retains a downgraded page contract, restores rule tampering, and permits Fixed cleanup', async () => {
    const retainedOffer: OfferItem = {
      name: 'Event Catering',
      description: 'Full service',
      price: '$1,200',
      url: '',
      offerType: 'negotiable',
      rules: { minPrice: '$900', minNoticeHours: 48 },
    }
    const baseline = { services: [retainedOffer], products: [] }

    const retainedState = committableState()
    retainedState.draft.services = [{ ...retainedOffer, description: 'Updated copy' }]
    const retainedDb = makeDb(sessionRow(retainedState, { page_id: 'page-existing' }), undefined, baseline)
    const retained = await commitIntakeSession({
      db: retainedDb.db,
      admin: makeAdmin([], []),
      user: OWNER,
      sessionId: 'sess-1',
    })
    expect(retained.ok).toBe(true)
    expect(retainedDb.captured.pages[0].draft.services[0]).toMatchObject({
      description: 'Updated copy',
      offerType: 'negotiable',
      rules: { minPrice: '$900', minNoticeHours: 48 },
    })

    const tamperedState = committableState()
    tamperedState.draft.services = [{
      ...retainedOffer,
      rules: { minPrice: '$100', minNoticeHours: 72, includedScope: 'Updated scope' },
    }]
    const tamperedDb = makeDb(sessionRow(tamperedState, { page_id: 'page-existing' }), undefined, baseline)
    await commitIntakeSession({ db: tamperedDb.db, admin: makeAdmin([], []), user: OWNER, sessionId: 'sess-1' })
    expect(tamperedDb.captured.pages[0].draft.services[0].rules).toEqual({
      minPrice: '$900',
      minNoticeHours: 72,
      includedScope: 'Updated scope',
    })

    const clearedState = committableState()
    clearedState.draft.services = [{ ...retainedOffer, offerType: 'fixed', rules: undefined }]
    const clearedDb = makeDb(sessionRow(clearedState, { page_id: 'page-existing' }), undefined, baseline)
    await commitIntakeSession({ db: clearedDb.db, admin: makeAdmin([], []), user: OWNER, sessionId: 'sess-1' })
    expect(clearedDb.captured.pages[0].draft.services[0]).toMatchObject({ offerType: 'fixed' })
    expect(clearedDb.captured.pages[0].draft.services[0].rules).toBeUndefined()
  })

  it('is idempotent - a committed session replays to the same page id', async () => {
    const { db } = makeDb(sessionRow(committableState(), { status: 'handed_off', page_id: 'page-done' }))
    const result = await commitIntakeSession({ db, admin: makeAdmin([], []), user: OWNER, sessionId: 'sess-1' })
    expect(result).toMatchObject({ ok: true, pageId: 'page-done', alreadyCommitted: true })
  })

  it('404s for a session the caller does not own', async () => {
    const { db } = makeDb(null)
    const result = await commitIntakeSession({ db, admin: makeAdmin([], []), user: OWNER, sessionId: 'sess-1' })
    expect(result).toMatchObject({ ok: false, status: 404 })
  })
})

describe('normalizeLlmAnswer - deterministic repairs from the live pass', () => {
  it('parses fields sent as a JSON string', () => {
    const fixed = normalizeLlmAnswer({
      gapId: 'g',
      answer: 'a',
      fields: JSON.stringify([{ target: 'page', field: 'location', value: 'Austin' }]) as never,
    })
    expect(fixed.fields).toEqual([{ target: 'page', field: 'location', value: 'Austin' }])
  })

  it('coerces the unambiguous {name, value} page-field mistake into a page update', () => {
    const fixed = normalizeLlmAnswer({
      gapId: 'page:audience',
      answer: 'realtors and wedding planners',
      fields: [{ name: 'audience', value: 'realtors and wedding planners' } as never],
    })
    expect(fixed.fields).toEqual([{ target: 'page', field: 'audience', value: 'realtors and wedding planners' }])
  })

  it('leaves ambiguous/unknown shapes for the reducer to reject teachably', () => {
    const untouched = normalizeLlmAnswer({
      gapId: 'g',
      answer: 'a',
      fields: [{ name: 'not_a_page_field', value: 'x' } as never],
    })
    expect(untouched.fields?.[0]).toEqual({ name: 'not_a_page_field', value: 'x' })
    const noFields = normalizeLlmAnswer({ gapId: 'g', answer: 'a' })
    expect(noFields.fields).toBeUndefined()
  })

  it('the LLM loop repairs a malformed record_answers via the teaching rejection', async () => {
    const state = analyzedState()
    const llm = vi
      .fn()
      .mockResolvedValueOnce({
        choices: [{ message: { content: null, tool_calls: [toolCall('record_answers', { answers: [{ gapId: 'offer:services-1:price', answer: '$250', fields: [{ price: '$250' }] }] })] } }],
      })
      .mockResolvedValueOnce({
        choices: [{ message: { content: null, tool_calls: [toolCall('record_answers', { answers: [{ gapId: 'offer:services-1:price', answer: '$250', fields: [{ target: 'offer', offerKey: 'services-1', field: 'price', value: '$250' }] }] })] } }],
      })
      .mockResolvedValueOnce({ choices: [{ message: { content: 'Got it - trays at $250.' } }] })
    const { db } = makeDb(sessionRow(state))
    const result = await handleIntakeTurn({ db, user: OWNER, sessionId: 'sess-1', content: 'trays are $250' }, { ...ids, llm })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    // round 1's malformed update was rejected with the shape guide…
    const round2 = llm.mock.calls[1][0] as Array<{ role: string; content: string }>
    expect(round2.find((m) => m.role === 'tool')?.content).toContain('invalid_field_update')
    // …and round 2's corrected call landed on the draft
    expect(result.state.draft.services[1].price).toBe('$250')
  })
})

describe('telemetry (spec §8)', () => {
  it('every turn emits intake.turn with the gap counters', async () => {
    const { db } = makeDb(sessionRow(analyzedState()))
    const result = await handleIntakeTurn({ db, user: OWNER, sessionId: 'sess-1', content: 'hi' }, ids)
    expect(result.ok).toBe(true)
    const event = captureEventMock.mock.calls.find(([name]) => name === 'intake.turn')
    expect(event).toBeTruthy()
    expect(event?.[1]).toMatchObject({ sessionId: 'sess-1', phase: 'INTERVIEW', llm: false })
    expect(typeof event?.[1].gapsRemaining).toBe('number')
    expect(typeof event?.[1].blockingRemaining).toBe('number')
    expect(typeof event?.[1].durationMs).toBe('number')
  })

  it('commit emits intake.handoff with gap outcomes + time-to-handoff', async () => {
    let state = analyzedState()
    const skipped = applyIntakeAction(state, {
      type: 'RECORD_ANSWERS',
      answers: [{ gapId: 'offer:services-1:price', answer: 'later', skipped: true }],
    })
    if (skipped.ok) state = skipped.state
    const { db } = makeDb(sessionRow(state, { created_at: '2026-07-06T00:00:00.000Z' }))
    const inserted: any[] = []
    const admin = createSupabaseMock((ctx) => {
      if (ctx.table === 'rpc:nz_public_identifier_availability') return { data: [{ available: true, reason: 'available' }] }
      if (ctx.table === 'pages' && ctx.op === 'select') return { data: null }
      if (ctx.table === 'pages' && ctx.op === 'insert') {
        inserted.push(ctx.payload)
        return { data: { id: 'page-new', slug: ctx.payload.slug } }
      }
      return { data: null }
    }) as any
    const result = await commitIntakeSession(
      { db, admin, user: OWNER, sessionId: 'sess-1' },
      { now: () => new Date('2026-07-06T00:12:00.000Z') },
    )
    expect(result.ok).toBe(true)
    const event = captureEventMock.mock.calls.find(([name]) => name === 'intake.handoff')
    expect(event).toBeTruthy()
    expect(event?.[1]).toMatchObject({
      sessionId: 'sess-1',
      via: 'owner_exit',
      pageId: 'page-new',
      newPage: true,
      gapsSkipped: 1,
      timeToHandoffMs: 12 * 60 * 1000,
    })
    expect(event?.[1].sourceKinds).toEqual(['url'])
  })

  it('an idempotent commit replay does NOT double-count a handoff', async () => {
    const { db } = makeDb(sessionRow(analyzedState(), { status: 'handed_off', page_id: 'page-done' }))
    await commitIntakeSession({ db, admin: createSupabaseMock(() => ({ data: null })) as any, user: OWNER, sessionId: 'sess-1' })
    expect(captureEventMock.mock.calls.filter(([name]) => name === 'intake.handoff')).toHaveLength(0)
  })
})

describe('helpers', () => {
  it('importResultToExtraction trims the importer result into the stored shape', () => {
    const extraction = importResultToExtraction('src-9', {
      title: 'Biz',
      description: 'Desc',
      website_url: 'https://b.example',
      structuredOffers: [{ name: 'A', description: '', price: '$1', url: '', confidence: 0.9 }],
      suggestedOffers: [],
      suggestedFaqs: [],
      evidence: [],
      businessDetails: {},
      telemetry: { importerVersion: '2.0.0', cacheHit: false, durationMs: 1, pagesConsidered: 1, pagesUsed: 1, sourceFingerprint: 'fixture', extractionMethods: {}, skippedPages: [] },
      servicesText: 'A | $1 |  | ',
      faqs: [{ question: 'Q', answer: 'A' }],
      industry: 'Plumbing',
      audience: null,
      location: 'Austin',
      cta_label: 'Book',
      cta_url: 'https://b.example/book',
      clarifyingQuestions: [{ id: 'q1', field: 'audience', question: '?', why: 'w' }],
      confidence: 0.8,
      aiStatus: { configured: false, attempted: false, used: false, status: 'deterministic', provider: '', model: '', reason: '' },
      pagesAnalyzed: 3,
      agentDocumentsAnalyzed: 0,
    })
    expect(extraction).toMatchObject({
      sourceId: 'src-9',
      title: 'Biz',
      industry: 'Plumbing',
      confidence: 0.8,
    })
    expect(extraction.offers).toHaveLength(1)
    expect(extraction.clarifyingQuestions).toHaveLength(1)
  })

  it('draftReadiness runs the platform rubric over the working draft', () => {
    const empty = createIntakeState().draft
    expect(draftReadiness(empty)).toBe(0)
    const state = analyzedState()
    expect(draftReadiness(state.draft)).toBeGreaterThan(0)
  })
})
