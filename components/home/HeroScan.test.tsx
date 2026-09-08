// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '../../test/dom'
import { HeroScan } from './HeroScan'

afterEach(() => {
  vi.unstubAllGlobals()
  window.history.replaceState(null, '', '/')
})

describe('HeroScan funnel handoff', () => {
  it('prefills from the homepage query and preserves the hero source label', async () => {
    window.history.replaceState(
      null,
      '',
      '/?url=https%3A%2F%2Fexample.com%2Fservices',
    )
    const fetchMock = vi.fn(async (
      _input: RequestInfo | URL,
      _init?: RequestInit,
    ): Promise<Response> => new Response(
      JSON.stringify({ error: 'Test response' }),
      { status: 400, headers: { 'content-type': 'application/json' } },
    ))
    vi.stubGlobal('fetch', fetchMock)

    render(<HeroScan />)

    const input = screen.getByLabelText('Website URL to scan')
    await waitFor(() => expect(input).toHaveValue('https://example.com/services'))
    fireEvent.click(screen.getByRole('button', { name: 'Scan my site' }))

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
    const init = fetchMock.mock.calls[0]![1]
    expect(JSON.parse(String(init?.body))).toEqual({
      url: 'https://example.com/services',
      source: 'hero',
    })
  })
})
