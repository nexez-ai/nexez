import { beforeEach, describe, expect, it, vi } from 'vitest'
import { EventEmitter } from 'node:events'
import { PassThrough } from 'node:stream'
const { lookup, transport, replies } = vi.hoisted(() => ({ lookup: vi.fn(), transport: vi.fn(), replies: [] as Array<{ status: number; location?: string }> }))
vi.mock('node:dns/promises', () => ({ default: { lookup } }))
vi.mock('node:https', () => ({ default: { request: transport } }))
vi.mock('node:http', () => ({ default: { request: transport } }))
import { safeFetch } from '../importer'

beforeEach(() => {
  vi.clearAllMocks(); replies.length = 0
  lookup.mockResolvedValue([{ address: '93.184.216.34', family: 4 }])
  transport.mockImplementation((_options, callback) => {
    const request = new EventEmitter() as EventEmitter & { end: () => void; destroy: (error: Error) => void }
    request.end = () => queueMicrotask(() => {
      const reply = replies.shift() ?? { status: 200 }
      const incoming = Object.assign(new PassThrough(), { statusCode: reply.status, statusMessage: 'OK', rawHeaders: reply.location ? ['location', reply.location] : [] })
      callback(incoming); incoming.end(reply.status >= 300 ? '' : 'bounded response')
    })
    request.destroy = (error) => { request.emit('error', error) }
    return request
  })
})

describe('scanner pinned transport', () => {
  it('pins the socket to the validated address and retains Host and TLS name', async () => {
    const response = await safeFetch('https://example.com/', {}, { pinnedDns: true, standardPortsOnly: true })
    expect(await response?.text()).toBe('bounded response')
    expect(transport.mock.calls[0][0]).toMatchObject({ hostname: '93.184.216.34', servername: 'example.com', headers: { host: 'example.com', 'accept-encoding': 'identity' } })
  })
  it('blocks DNS rebinding between preliminary validation and the pinned connection', async () => {
    lookup.mockResolvedValueOnce([{ address: '93.184.216.34', family: 4 }]).mockResolvedValueOnce([{ address: '127.0.0.1', family: 4 }])
    expect(await safeFetch('https://rebind.example.com/', {}, { pinnedDns: true })).toBeNull()
    expect(transport).not.toHaveBeenCalled()
  })
  it('rejects a mixed public/private DNS answer and private redirect', async () => {
    lookup.mockResolvedValueOnce([{ address: '93.184.216.34', family: 4 }, { address: '::ffff:169.254.169.254', family: 6 }])
    expect(await safeFetch('https://mixed.example.com/', {}, { pinnedDns: true })).toBeNull()
    expect(transport).not.toHaveBeenCalled()
    replies.push({ status: 302, location: 'http://169.254.169.254/secret' })
    expect(await safeFetch('https://redirect.example.com/', {}, { pinnedDns: true })).toBeNull()
    expect(transport).toHaveBeenCalledOnce()
  })
  it('re-evaluates policy for every redirect and stops before a denied connection', async () => {
    replies.push({ status: 302, location: 'https://other.com/path' })
    const policy = vi.fn().mockResolvedValueOnce(true).mockResolvedValueOnce(false)
    expect(await safeFetch('https://example.com/', {}, { pinnedDns: true, beforeRequest: policy })).toBeNull()
    expect(policy.mock.calls).toEqual([['https://example.com/'], ['https://other.com/path']])
    expect(transport).toHaveBeenCalledOnce()
  })
  it('keeps the parent deadline signal attached to the request and refuses an already-aborted scan', async () => {
    const abort = new AbortController()
    const response = await safeFetch('https://signal.example.com/', { signal: abort.signal }, { pinnedDns: true })
    await response?.text()
    const signal = transport.mock.calls[0][0].signal as AbortSignal
    expect(signal.aborted).toBe(false); abort.abort(); expect(signal.aborted).toBe(true)
    expect(await safeFetch('https://signal.example.com/', { signal: abort.signal }, { pinnedDns: true })).toBeNull()
    expect(transport).toHaveBeenCalledOnce()
  })
})
