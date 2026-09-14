// @vitest-environment jsdom
import React from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { ClaimInviteCard } from './ClaimInviteCard'

vi.mock('../../../utils/supabase/client', () => ({ createClient: vi.fn() }))

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('Launch invitation copy and handoff', () => {
  it('states exact duration and all qualification gates before signup', () => {
    render(<ClaimInviteCard mode="signed_out" inviterBusinessName="Test Business" inviteeEmail="owner@example.test" />)
    expect(screen.getByRole('heading').textContent).toBe('180 days of complimentary Launch')
    expect(screen.getByText(/Access starts only after your email and business identity are verified/)).toBeTruthy()
    expect(screen.getByText(/unless you choose a paid plan/)).toBeTruthy()
    expect(screen.getByRole('link', { name: /Create account/ }).getAttribute('href')).toBe('/login?mode=signup&next=/invite/claim')
  })

  it('keeps wrong-email claims blocked', () => {
    render(<ClaimInviteCard mode="wrong_email" inviteeEmail="owner@example.test" signedInEmail="different@example.test" />)
    expect(screen.queryByRole('button', { name: 'Claim Launch pass' })).toBeNull()
    expect(screen.getByText(/Sign in with owner@example.test to claim this pass/)).toBeTruthy()
  })

  it('does not treat a claimed invitation as activated access', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ activated: false }), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    render(<ClaimInviteCard mode="ready" inviteeEmail="owner@example.test" />)
    fireEvent.click(screen.getByRole('button', { name: 'Claim Launch pass' }))
    expect(await screen.findByRole('heading', { name: 'Your pass is claimed' })).toBeTruthy()
    expect(screen.getByText(/Finish publishing and verifying/)).toBeTruthy()
    expect(fetchMock).toHaveBeenCalledExactlyOnceWith('/api/growth-invites/claim', { method: 'POST' })
  })

  it.each(['invalid', 'expired', 'unavailable'] as const)('offers no claim action for %s invitations', (mode) => {
    render(<ClaimInviteCard mode={mode} />)
    expect(screen.queryByRole('button', { name: 'Claim Launch pass' })).toBeNull()
  })
})
