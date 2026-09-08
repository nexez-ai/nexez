// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '../test/dom'
import { PhoneSignInSettings } from './PhoneSignInSettings'

const PHONE = '+14155550123'

function response(body: object, status = 200) {
  return Promise.resolve(new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } }))
}

describe('PhoneSignInSettings', () => {
  beforeEach(() => vi.stubGlobal('fetch', vi.fn()))
  afterEach(() => vi.unstubAllGlobals())

  it('shows only the masked linked phone and opens the change flow', () => {
    render(<PhoneSignInSettings initialPhoneMasked="+•••••••5455" />)

    expect(screen.getByText('+•••••••5455')).toBeInTheDocument()
    expect(screen.queryByText(PHONE)).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Change login phone' }))
    expect(screen.getByRole('textbox', { name: 'Mobile number' })).toBeInTheDocument()
  })

  it('preserves keyboard focus when the initial phone lookup finishes', async () => {
    vi.mocked(fetch).mockImplementationOnce(() => response({ phoneMasked: null }))
    render(<><button>Open account menu</button><PhoneSignInSettings initialPhoneMasked={null} /></>)
    const accountMenu = screen.getByRole('button', { name: 'Open account menu' })
    accountMenu.focus()

    await screen.findByRole('textbox', { name: 'Mobile number' })
    expect(accountMenu).toHaveFocus()
    expect(fetch).toHaveBeenCalledOnce()
  })

  it('sends a possession challenge without changing notification consent', async () => {
    vi.mocked(fetch)
      .mockImplementationOnce(() => response({ phoneMasked: null }))
      .mockImplementationOnce(() => response({ sent: true, phoneMasked: '+•••••••5455' }))
    render(<PhoneSignInSettings initialPhoneMasked={null} />)

    fireEvent.change(await screen.findByRole('textbox', { name: 'Mobile number' }), { target: { value: PHONE } })
    fireEvent.click(screen.getByRole('button', { name: 'Send verification code' }))

    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(2))
    expect(fetch).toHaveBeenLastCalledWith('/api/account/auth-phone', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'start', phone: PHONE }),
    })
    expect(await screen.findByRole('textbox', { name: 'Verification code' })).toBeInTheDocument()
    expect(screen.getByText(/Negotiation alerts and their consent controls stay separate/)).toBeInTheDocument()
  })

  it('links the verified phone after the correct code', async () => {
    vi.mocked(fetch)
      .mockImplementationOnce(() => response({ phoneMasked: null }))
      .mockImplementationOnce(() => response({ sent: true, phoneMasked: '+•••••••5455' }))
      .mockImplementationOnce(() => response({ verified: true, phoneMasked: '+•••••••5455' }))
    render(<PhoneSignInSettings initialPhoneMasked={null} />)

    fireEvent.change(await screen.findByRole('textbox', { name: 'Mobile number' }), { target: { value: PHONE } })
    fireEvent.click(screen.getByRole('button', { name: 'Send verification code' }))
    const code = await screen.findByRole('textbox', { name: 'Verification code' })
    fireEvent.change(code, { target: { value: '123 456' } })
    fireEvent.click(screen.getByRole('button', { name: 'Verify login phone' }))

    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(3))
    expect(fetch).toHaveBeenLastCalledWith('/api/account/auth-phone', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'verify', phone: PHONE, code: '123456' }),
    })
    expect(await screen.findByText('Login phone verified. You can now enter your account email to sign in by text.')).toBeInTheDocument()
    expect(screen.getByText('Linked')).toBeInTheDocument()
  })

  it('blocks malformed phone numbers before a request is sent', async () => {
    vi.mocked(fetch).mockImplementationOnce(() => response({ phoneMasked: null }))
    render(<PhoneSignInSettings initialPhoneMasked={null} />)

    fireEvent.change(await screen.findByRole('textbox', { name: 'Mobile number' }), { target: { value: '(762) 744-5455' } })
    fireEvent.click(screen.getByRole('button', { name: 'Send verification code' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('international format')
    expect(fetch).toHaveBeenCalledOnce()
  })

  it('hydrates a linked phone from authoritative Auth state when server props are stale', async () => {
    vi.mocked(fetch).mockImplementationOnce(() => response({ phoneMasked: '+•••••••5455' }))
    render(<PhoneSignInSettings initialPhoneMasked={null} />)

    expect(await screen.findByText('+•••••••5455')).toBeInTheDocument()
    expect(screen.getByText('Linked')).toBeInTheDocument()
    expect(fetch).toHaveBeenCalledWith('/api/account/auth-phone', {
      method: 'GET',
      headers: { accept: 'application/json' },
      cache: 'no-store',
      signal: expect.any(AbortSignal),
    })
  })
})
