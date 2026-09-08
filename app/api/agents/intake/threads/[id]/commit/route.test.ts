import { describe, expect, it, vi, beforeEach } from 'vitest'
import { createSupabaseMock } from '../../../../../../../test/supabase-mock'
import { applyIntakeAction, createIntakeState, type IntakeState } from '../../../../../../../lib/intake'

const { authRef, rateLimitRef, adminRef } = vi.hoisted(() => ({
  authRef: { result: null as any },
  rateLimitRef: { response: null as any },
  adminRef: { hasEnv: true, client: null as any },
}))

vi.mock('../../../../../../../lib/rate-limit', () => ({
  enforceRateLimit: vi.fn(async () => rateLimitRef.response),
}))
vi.mock('../../../../../../../lib/server/request-auth', () => ({
  resolveRequestAuth: vi.fn(async () => authRef.result),
}))
vi.mock('../../../../../../../utils/supabase/admin', () => ({
  hasSupabaseAdminEnv: vi.fn(() => adminRef.hasEnv),
  createAdminClient: vi.fn(() => adminRef.client),
}))

import { POST } from './route'

const OWNER = { id: 'owner-1' }
const params = { params: Promise.resolve({ id: 'sess-1' }) }
const post = () => new Request('https://nexez.test/api/agents/intake/threads/sess-1/commit', { method: 'POST' }) as any

function committableState(): IntakeState {
  let state = createIntakeState()
  for (const action of [
    { type: 'ADD_SOURCE' as const, source: { id: 's1', kind: 'url' as const, value: 'https://a.example', addedAt: '2026-07-06T00:00:00Z' } },
    {
      type: 'RECORD_EXTRACTION' as const,
      extraction: { sourceId: 's1', title: 'Apex Studio', description: 'D', offers: [{ name: 'Session', description: '', price: '$100', url: '' }] },
    },
    { type: 'ANALYZE_GAPS' as const },
  ]) {
    const applied = applyIntakeAction(state, action)
    if (applied.ok) state = applied.state
  }
  return state
}

function dbWith(row: any, updates: any[] = []) {
  return createSupabaseMock((ctx) => {
    if (ctx.table === 'intake_sessions' && ctx.op === 'select') return { data: row }
    if (ctx.table === 'intake_sessions' && ctx.op === 'update') {
      updates.push(ctx.payload)
      return { data: null }
    }
    return { data: null }
  })
}

function adminWith(inserted: any[]) {
  return createSupabaseMock((ctx) => {
    if (ctx.table === 'rpc:nz_public_identifier_availability') return { data: [{ available: true, reason: 'available' }] }
    if (ctx.table === 'pages' && ctx.op === 'insert') {
      inserted.push(ctx.payload)
      return { data: { id: 'page-new', slug: ctx.payload.slug } }
    }
    return { data: null }
  })
}

beforeEach(() => {
  rateLimitRef.response = null
  adminRef.hasEnv = true
  adminRef.client = adminWith([])
  authRef.result = { supabase: dbWith(null), user: OWNER }
})

describe('POST /api/agents/intake/threads/[id]/commit', () => {
  it('401s when unauthenticated', async () => {
    authRef.result = { supabase: dbWith(null), user: null }
    expect((await POST(post(), params)).status).toBe(401)
  })

  it('503s when the admin env is missing', async () => {
    adminRef.hasEnv = false
    expect((await POST(post(), params)).status).toBe(503)
  })

  it('404s for a foreign/missing session', async () => {
    expect((await POST(post(), params)).status).toBe(404)
  })

  it('materializes a new draft page owned by the caller and closes the session', async () => {
    const updates: any[] = []
    const inserted: any[] = []
    adminRef.client = adminWith(inserted)
    const row = { id: 'sess-1', owner_id: OWNER.id, page_id: null, status: 'active', phase: 'GAP_ANALYSIS', state: committableState() }
    authRef.result = { supabase: dbWith(row, updates), user: OWNER }

    const res = await POST(post(), params)
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json).toMatchObject({ ok: true, pageId: 'page-new', slug: 'apex-studio', builderPath: '/dashboard/page-new' })
    expect(inserted[0]).toMatchObject({ owner_id: OWNER.id, is_published: false, name: 'Apex Studio' })
    expect(updates[0]).toMatchObject({ status: 'handed_off', page_id: 'page-new' })
  })

  it('replays idempotently once committed', async () => {
    const row = { id: 'sess-1', owner_id: OWNER.id, page_id: 'page-done', status: 'handed_off', phase: 'REVIEW_HANDOFF', state: committableState() }
    authRef.result = { supabase: dbWith(row), user: OWNER }
    const json = await (await POST(post(), params)).json()
    expect(json).toMatchObject({ ok: true, pageId: 'page-done', alreadyCommitted: true })
  })
})
