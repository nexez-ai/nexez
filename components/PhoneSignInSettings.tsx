'use client'

import { useEffect, useState, type FormEvent } from 'react'
import { CheckCircle2, KeyRound, Loader2, MessageSquareText, Phone, ShieldCheck } from 'lucide-react'
import { maskE164PhoneNumber, normalizeE164PhoneNumber, normalizePhoneOtp } from '../lib/phone-auth'

type PhoneSignInSettingsProps = {
  initialPhoneMasked: string | null
}

type AuthPhoneResponse = {
  error?: string
  phoneMasked?: string | null
  sent?: boolean
  verified?: boolean
}

async function readResponse(response: Response): Promise<AuthPhoneResponse> {
  try {
    return (await response.json()) as AuthPhoneResponse
  } catch {
    return {}
  }
}

export function PhoneSignInSettings({ initialPhoneMasked }: PhoneSignInSettingsProps) {
  const [linkedPhoneMasked, setLinkedPhoneMasked] = useState(initialPhoneMasked)
  const [phase, setPhase] = useState<'summary' | 'number' | 'code'>(initialPhoneMasked ? 'summary' : 'number')
  const [loadingLinkedPhone, setLoadingLinkedPhone] = useState(!initialPhoneMasked)
  const [phone, setPhone] = useState('')
  const [verificationPhone, setVerificationPhone] = useState<string | null>(null)
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [messageTone, setMessageTone] = useState<'ok' | 'error'>('ok')

  useEffect(() => {
    if (initialPhoneMasked) return

    const controller = new AbortController()
    async function loadLinkedPhone() {
      try {
        const response = await fetch('/api/account/auth-phone', {
          method: 'GET',
          headers: { accept: 'application/json' },
          cache: 'no-store',
          signal: controller.signal,
        })
        const body = await readResponse(response)
        if (!response.ok || !body.phoneMasked) return
        setLinkedPhoneMasked(body.phoneMasked)
        setPhase('summary')
      } catch {
        // Keep the number-entry fallback available when status cannot load.
      } finally {
        if (!controller.signal.aborted) setLoadingLinkedPhone(false)
      }
    }

    void loadLinkedPhone()
    return () => controller.abort()
  }, [initialPhoneMasked])

  function showError(nextMessage: string) {
    setMessageTone('error')
    setMessage(nextMessage)
  }

  function beginNumberEntry() {
    if (busy) return
    setPhase('number')
    setPhone('')
    setVerificationPhone(null)
    setCode('')
    setMessage('')
  }

  async function startVerification(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (busy) return

    const normalizedPhone = normalizeE164PhoneNumber(phone)
    if (!normalizedPhone) {
      showError('Enter a mobile number in international format, such as +14155550123.')
      return
    }

    setBusy(true)
    setMessage('')
    try {
      const response = await fetch('/api/account/auth-phone', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'start', phone: normalizedPhone }),
      })
      const body = await readResponse(response)
      if (!response.ok || !body.sent) {
        showError(body.error || 'We could not send a verification code. Please try again.')
        return
      }

      setVerificationPhone(normalizedPhone)
      setCode('')
      setPhase('code')
      setMessageTone('ok')
      setMessage(`We sent a code to ${body.phoneMasked || maskE164PhoneNumber(normalizedPhone)}.`)
    } catch {
      showError('We could not send a verification code. Please try again.')
    } finally {
      setBusy(false)
    }
  }

  async function verifyPhone(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (busy || !verificationPhone) return

    const normalizedCode = normalizePhoneOtp(code)
    if (!normalizedCode) {
      showError('Enter the numeric code from your text message.')
      return
    }

    setBusy(true)
    setMessage('')
    try {
      const response = await fetch('/api/account/auth-phone', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'verify', phone: verificationPhone, code: normalizedCode }),
      })
      const body = await readResponse(response)
      if (!response.ok || !body.verified || !body.phoneMasked) {
        showError(body.error || 'That verification code was not accepted. Check it and try again.')
        return
      }

      setLinkedPhoneMasked(body.phoneMasked)
      setVerificationPhone(null)
      setPhone('')
      setCode('')
      setPhase('summary')
      setMessageTone('ok')
      setMessage('Login phone verified. You can now enter your account email to sign in by text.')
    } catch {
      showError('That verification code could not be checked. Please try again.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="card !p-5 sm:!p-6" aria-labelledby="phone-sign-in-settings-title">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <Phone className="size-5 text-[var(--signal)]" />
            <h2 id="phone-sign-in-settings-title" className="text-xl font-semibold">
              Login phone
            </h2>
          </div>
          <p className="mt-1 max-w-2xl text-sm leading-6 text-zinc-400">
            Add a verified mobile number as a secure backup sign-in method. At login, enter your account email and we will text this number. Passkeys remain the recommended primary method.
          </p>
        </div>
        {linkedPhoneMasked ? (
          <span className="inline-flex min-h-8 shrink-0 items-center gap-1.5 self-start rounded-full border border-[var(--ready)]/35 bg-[var(--ready)]/10 px-3 text-xs font-semibold text-[var(--ready)]">
            <CheckCircle2 className="size-3.5" /> Linked
          </span>
        ) : null}
      </div>

      <div className="mt-5 rounded-xl border border-white/10 bg-white/[0.03] p-4">
        {loadingLinkedPhone ? (
          <div className="flex min-h-16 items-center gap-3 text-sm text-zinc-400" role="status">
            <Loader2 className="size-4 animate-spin text-[var(--signal)]" /> Checking login phone…
          </div>
        ) : phase === 'summary' && linkedPhoneMasked ? (
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-sm font-medium text-zinc-100">{linkedPhoneMasked}</p>
              <p className="mt-1 text-xs leading-5 text-zinc-500">Verified for one-time authentication codes.</p>
            </div>
            <button
              type="button"
              onClick={beginNumberEntry}
              disabled={busy}
              className="inline-flex min-h-11 shrink-0 items-center justify-center gap-2 rounded-xl border border-[var(--line)] px-4 text-sm font-medium text-[var(--fg)] outline-none transition hover:bg-[var(--fill-2)] focus-visible:ring-2 focus-visible:ring-[var(--control-focus)] disabled:opacity-50"
            >
              <Phone className="size-4" /> Change login phone
            </button>
          </div>
        ) : phase === 'code' && verificationPhone ? (
          <form onSubmit={verifyPhone} className="space-y-4">
            <div className="flex items-start gap-3">
              <MessageSquareText className="mt-0.5 size-5 shrink-0 text-[var(--signal)]" />
              <div>
                <p className="text-sm font-medium text-zinc-100">Check {maskE164PhoneNumber(verificationPhone)}</p>
                <p className="mt-1 text-xs leading-5 text-zinc-500">Enter the one-time code sent by Nexez.</p>
              </div>
            </div>
            <label className="block text-sm text-zinc-300">
              <span className="mb-2 block text-xs font-medium uppercase tracking-[0.12em] text-zinc-500">Verification code</span>
              <input
                name="loginPhoneCode"
                type="text"
                inputMode="numeric"
                autoComplete="one-time-code"
                value={code}
                onChange={(event) => setCode(event.target.value)}
                placeholder="123456"
                maxLength={12}
                autoFocus
                disabled={busy}
                className="min-h-12 w-full rounded-xl border border-[var(--line)] bg-[var(--surface)] px-4 tracking-[0.2em] text-[var(--fg)] outline-none focus-visible:ring-2 focus-visible:ring-[var(--control-focus)] disabled:opacity-60"
              />
            </label>
            <div className="flex flex-col gap-2 sm:flex-row">
              <button
                type="submit"
                disabled={busy}
                className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-foreground px-4 text-sm font-medium text-background outline-none transition hover:opacity-90 focus-visible:ring-2 focus-visible:ring-[var(--control-focus)] disabled:opacity-50"
              >
                {busy ? <Loader2 className="size-4 animate-spin" /> : <ShieldCheck className="size-4" />} Verify login phone
              </button>
              <button
                type="button"
                onClick={beginNumberEntry}
                disabled={busy}
                className="min-h-11 rounded-xl px-4 text-sm text-[var(--fg-muted)] outline-none hover:bg-[var(--fill-2)] focus-visible:ring-2 focus-visible:ring-[var(--control-focus)] disabled:opacity-50"
              >
                Use a different number
              </button>
            </div>
          </form>
        ) : (
          <form onSubmit={startVerification} className="space-y-4">
            <label className="block text-sm text-zinc-300">
              <span className="mb-2 block text-xs font-medium uppercase tracking-[0.12em] text-zinc-500">Mobile number</span>
              <input
                name="loginPhone"
                type="tel"
                inputMode="tel"
                autoComplete="tel"
                value={phone}
                onChange={(event) => setPhone(event.target.value)}
                placeholder="+14155550123"
                disabled={busy}
                className="min-h-12 w-full rounded-xl border border-[var(--line)] bg-[var(--surface)] px-4 text-[var(--fg)] outline-none focus-visible:ring-2 focus-visible:ring-[var(--control-focus)] disabled:opacity-60"
              />
            </label>
            <div className="flex flex-col gap-2 sm:flex-row">
              <button
                type="submit"
                disabled={busy}
                className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-foreground px-4 text-sm font-medium text-background outline-none transition hover:opacity-90 focus-visible:ring-2 focus-visible:ring-[var(--control-focus)] disabled:opacity-50"
              >
                {busy ? <Loader2 className="size-4 animate-spin" /> : <KeyRound className="size-4" />} Send verification code
              </button>
              {linkedPhoneMasked ? (
                <button
                  type="button"
                  onClick={() => {
                    setPhase('summary')
                    setMessage('')
                  }}
                  disabled={busy}
                  className="min-h-11 rounded-xl px-4 text-sm text-[var(--fg-muted)] outline-none hover:bg-[var(--fill-2)] focus-visible:ring-2 focus-visible:ring-[var(--control-focus)] disabled:opacity-50"
                >
                  Cancel
                </button>
              ) : null}
            </div>
          </form>
        )}
      </div>

      <p className="mt-4 text-xs leading-5 text-zinc-500">
        This number is used only for authentication codes. Negotiation alerts and their consent controls stay separate under Notifications.
      </p>

      {message ? (
        <p
          role={messageTone === 'error' ? 'alert' : 'status'}
          className={`mt-3 text-sm ${messageTone === 'error' ? 'text-red-300' : 'text-[var(--ready)]'}`}
        >
          {message}
        </p>
      ) : null}
    </section>
  )
}
