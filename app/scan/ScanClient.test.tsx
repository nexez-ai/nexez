// @vitest-environment jsdom

import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ScanClient } from './ScanClient'

const scanResult = {
  ok: true,
  url: 'https://axleplumbing.com/',
  origin: 'https://axleplumbing.com',
  elapsedMs: 120,
  scannedAt: '2026-08-27T12:00:00Z',
  version: 1,
  score: 34,
  dimensions: {
    discovery: { label: 'Discovery', score: 40 },
    understanding: { label: 'Understanding', score: 30 },
    transactability: { label: 'Transactability', score: 20 },
    trust: { label: 'Trust', score: 50 },
  },
  checks: [{
    id: 'pricing', dimension: 'understanding', label: 'Readable pricing',
    status: 'fail', detail: 'No public price found.',
  }],
  blockedBots: [],
}

describe('ScanClient email result control', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('offers email only after a result and posts the canonical result URL', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify(scanResult), {
        status: 200, headers: { 'content-type': 'application/json' },
      }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true, queued: true, attributionToken: 'scan-token' }), {
        status: 200, headers: { 'content-type': 'application/json' },
      }))
    vi.stubGlobal('fetch', fetchMock)
    const user = userEvent.setup()
    render(<ScanClient />)

    expect(screen.queryByText('Email me this scan')).toBeNull()
    await user.type(screen.getByLabelText('Website URL to scan'), 'axleplumbing.com')
    await user.click(screen.getByRole('button', { name: /see what agents see/i }))

    expect(await screen.findByText('Email me this scan')).toBeTruthy()
    expect(JSON.parse(fetchMock.mock.calls[0]![1].body)).toEqual({
      url: 'axleplumbing.com', source: 'scan-page',
    })
    await user.type(screen.getByLabelText('Email address for scan result'), 'owner@example.com')
    await user.click(screen.getByRole('button', { name: /email my result/i }))

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2))
    expect(fetchMock.mock.calls[1]![0]).toBe('/api/scan/subscribe')
    expect(JSON.parse(fetchMock.mock.calls[1]![1].body)).toEqual({
      url: 'https://axleplumbing.com/',
      email: 'owner@example.com',
    })
    expect(await screen.findByText(/report is on its way/i)).toBeTruthy()
    expect(screen.getByRole('link', { name: /build the agent-ready version/i }).getAttribute('href'))
      .toContain('scan=scan-token')
  })
})
