'use client'

import { useState } from 'react'
import { createClient } from '@/utils/supabase/client'

export default function OrganizationSignOut() {
  const [pending, setPending] = useState(false)
  const [error, setError] = useState(false)

  async function signOut() {
    if (pending) return
    setPending(true)
    setError(false)
    try {
      const { error } = await createClient().auth.signOut({ scope: 'local' })
      if (error) throw error
      // A full navigation clears the in-memory workspace/RSC state as well as
      // the session cookies. Other devices keep their own sessions.
      window.location.replace('/login?next=%2Fconsole')
    } catch {
      setError(true)
      setPending(false)
    }
  }

  return (
    <div>
      <button type="button" onClick={signOut} disabled={pending} className="text-sm text-[var(--fg-muted)] hover:text-[var(--fg)] disabled:opacity-50">
        {pending ? 'Signing out...' : 'Sign out'}
      </button>
      {error && <p role="alert" className="mt-1 text-xs text-[var(--fg-muted)]">Could not sign out. Please try again.</p>}
    </div>
  )
}
