import { afterEach, describe, expect, it, vi } from 'vitest'
import { GeminiAdapter } from './GeminiAdapter'

afterEach(() => vi.unstubAllGlobals())

describe('installed Google GenAI SDK wire compatibility', () => {
  it('serializes native tools and decodes a Gemini function-call response without a network request', async () => {
    const fetchMock = vi.fn(async () => Response.json({
      candidates: [{
        content: {
          role: 'model',
          parts: [{ functionCall: { name: 'accept_proposal', args: { reasoning: 'Within rules.' } } }],
        },
        finishReason: 'STOP',
      }],
    }))
    vi.stubGlobal('fetch', fetchMock)

    await expect(new GeminiAdapter('synthetic-test-key').negotiate({}, { query: 'Proposal' }, []))
      .resolves.toMatchObject({ action: 'accept', reasoning: 'Within rules.' })
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(String(url)).toContain('gemini-2.5-flash:generateContent')
    const body = JSON.parse(init.body as string)
    expect(body.toolConfig.functionCallingConfig.mode).toBe('ANY')
    expect(body.tools[0].functionDeclarations).toHaveLength(4)
    expect(body.generationConfig.maxOutputTokens).toBe(1024)
    expect(body.systemInstruction.parts[0].text).toContain('Nexez Negotiation Assistant')
  })
})
