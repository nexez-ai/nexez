import { cookies } from 'next/headers'
import { createClient as createTokenClient, type SupabaseClient } from '@supabase/supabase-js'
import { createClient as createCookieClient } from '../../utils/supabase/server'

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const SUPABASE_ANON = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY

export type ResolvedAuth = {
  supabase: SupabaseClient
  user: { id: string; email?: string | null; is_anonymous?: boolean } | null
}

/**
 * Resolve the caller from EITHER the SSR cookie session (web dashboard) OR an
 * `Authorization: Bearer <supabase access_token>` header (the native seller app).
 *
 * Both paths return an RLS-scoped client + a verified user, so every downstream
 * owner-scoped query/mutation behaves identically regardless of how the caller
 * authenticated. The bearer path uses the public (anon/publishable) key with the
 * caller's JWT attached, so RLS still applies - there is no privilege escalation,
 * and an invalid/expired token resolves to `user: null` (→ 401 at the call site).
 */
export async function resolveRequestAuth(request: Request): Promise<ResolvedAuth> {
  const header = request.headers.get('authorization') || ''
  const token = header.slice(0, 7).toLowerCase() === 'bearer ' ? header.slice(7).trim() : ''

  if (token) {
    const supabase = createTokenClient(SUPABASE_URL!, SUPABASE_ANON!, {
      global: { headers: { Authorization: `Bearer ${token}` } },
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    })
    const { data, error } = await supabase.auth.getUser(token)
    if (error || !data.user) return { supabase, user: null }
    return { supabase, user: data.user }
  }

  const cookieStore = await cookies()
  const supabase = createCookieClient(cookieStore) as unknown as SupabaseClient
  const {
    data: { user },
  } = await supabase.auth.getUser()
  return { supabase, user: user ?? null }
}
