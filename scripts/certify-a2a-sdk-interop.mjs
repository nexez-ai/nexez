#!/usr/bin/env node

import { randomUUID } from 'node:crypto'
import { writeFile } from 'node:fs/promises'
import { Role, TaskState } from '@a2a-js/sdk'
import {
  ClientFactory,
  ClientFactoryOptions,
  DefaultAgentCardResolver,
  JsonRpcTransportFactory,
} from '@a2a-js/sdk/client'

const SDK_VERSION = '1.2.0'
const MODE = mode(process.env.NEXEZ_A2A_INTEROP_MODE || 'public')
const AGENT_BASE = trim(process.env.NEXEZ_A2A_INTEROP_BASE_URL || 'https://nexez.app')
const APP_BASE = trim(process.env.NEXEZ_A2A_INTEROP_APP_BASE_URL || 'https://app.nexez.ai')
const A2A_URL = `${AGENT_BASE}/api/v1/a2a`
const CARD_URL = `${AGENT_BASE}/.well-known/agent-card.json`
const HEALTH_URL = `${APP_BASE}/api/internal/launch-health`
const API_KEY = process.env.NEXEZ_A2A_CERT_API_KEY || ''
const RELEASE_SECRET = process.env.NEXEZ_RELEASE_CERT_SECRET || ''
const COMMIT_SHA = sha(process.env.NEXEZ_COMMIT_SHA || process.env.GITHUB_SHA)
const REPORT_PATH = process.env.NEXEZ_A2A_INTEROP_REPORT_PATH || 'a2a-sdk-interop.json'
const REQUEST_MS = number(process.env.NEXEZ_A2A_INTEROP_REQUEST_TIMEOUT_MS, 90_000)
const STREAM_MS = number(process.env.NEXEZ_A2A_INTEROP_STREAM_TIMEOUT_MS, 90_000)
const DEPLOY_MS = number(process.env.NEXEZ_A2A_INTEROP_DEPLOYMENT_WAIT_MS, process.env.GITHUB_ACTIONS ? 600_000 : 1)
const POLL_MS = number(process.env.NEXEZ_A2A_INTEROP_POLL_MS, 1_000)
const startedAt = new Date().toISOString()
const checks = []
const traces = []
const taskIds = {}
let card
let client

await check('sdk-discovery', 'Official SDK discovery and transport selection', async () => {
  const fetchImpl = tracedFetch
  const factory = new ClientFactory(
    ClientFactoryOptions.createFrom(ClientFactoryOptions.default, {
      cardResolver: new DefaultAgentCardResolver({ fetchImpl }),
      transports: [new JsonRpcTransportFactory({ fetchImpl })],
      preferredTransports: ['JSONRPC'],
    }),
  )
  client = await factory.createFromUrl(AGENT_BASE)
  card = await client.getAgentCard()
  assert(card.supportedInterfaces?.length === 1, 'Agent Card must expose exactly one interface')
  const selected = card.supportedInterfaces[0]
  assert(selected.url === A2A_URL, `Agent Card points to ${selected.url || 'no endpoint'}`)
  assert(selected.protocolBinding === 'JSONRPC', 'Agent Card binding is not JSONRPC')
  assert(selected.protocolVersion === '1.0', 'Agent Card protocol version is not 1.0')
  assert(client.protocolVersion === '1.0', `SDK negotiated ${client.protocolVersion || 'no version'}`)
  assert(client.transport?.protocolName === 'JSONRPC', 'SDK did not select JSONRPC')
  assert(card.capabilities?.streaming === true, 'Streaming is not advertised')
  assert(card.capabilities?.pushNotifications === false, 'Push is incorrectly advertised')
  assert(card.capabilities?.extendedAgentCard === false, 'Extended card is incorrectly advertised')
  const request = lastTrace(CARD_URL)
  assert(request?.status === 200, 'SDK discovery did not return 200')
  assert(request.request.a2aVersion === '1.0', 'SDK discovery omitted A2A-Version: 1.0')
  return 'Discovered one JSONRPC 1.0 endpoint and selected the official JSON-RPC transport.'
})

await check('anonymous-auth', 'Official SDK receives the anonymous Bearer challenge', async () => {
  requireClient()
  const before = traces.length
  await fails(() => client.sendMessage(message('anonymous'), options('')), 'Anonymous SendMessage succeeded')
  const request = lastTrace(A2A_URL, before)
  assert(request?.status === 401, `Anonymous SDK call returned HTTP ${request?.status ?? 'unknown'}`)
  assert(request.request.authorization === 'absent', 'Anonymous SDK call sent Authorization')
  assert(request.request.a2aVersion === '1.0', 'Anonymous SDK call omitted A2A-Version: 1.0')
  assert(request.response.wwwAuthenticate === 'Bearer', 'Bearer challenge is missing')
  return 'Anonymous SendMessage was rejected with WWW-Authenticate: Bearer.'
})

await check('invalid-auth', 'Official SDK injects and rejects an invalid Bearer key', async () => {
  requireClient()
  const before = traces.length
  const invalid = `nxz_live_invalid_${randomUUID()}`
  await fails(() => client.sendMessage(message('invalid'), options(invalid)), 'Invalid-key SendMessage succeeded')
  const request = lastTrace(A2A_URL, before)
  assert(request?.status === 401, `Invalid-key SDK call returned HTTP ${request?.status ?? 'unknown'}`)
  assert(request.request.authorization === 'present', 'SDK did not inject Authorization')
  assert(request.request.a2aVersion === '1.0', 'SDK call omitted A2A-Version: 1.0')
  assert(request.request.contentType === 'application/json', 'SDK did not send JSON')
  assert(request.request.accept === 'application/json', 'SDK did not request JSON')
  return 'The official client injected Bearer auth and Nexez rejected the unknown key.'
})

await check('capability-guard', 'Official SDK honors disabled push and extended-card capabilities', async () => {
  requireClient()
  const beforePush = traces.length
  await fails(() => client.createTaskPushNotificationConfig({}), 'Disabled push configuration succeeded')
  assert(traces.length === beforePush, 'Disabled push produced a network request')
  const beforeCard = traces.length
  assert(await client.getAgentCard() === card, 'SDK did not return its cached Agent Card')
  assert(traces.length === beforeCard, 'Disabled extended card produced a network request')
  return 'Unsupported capabilities failed locally without probing disabled methods.'
})

if (MODE === 'authenticated') {
  await check('authenticated-config', 'Authenticated SDK configuration', async () => {
    assert(API_KEY.length >= 16, 'NEXEZ_A2A_CERT_API_KEY is required')
    assert(RELEASE_SECRET.length >= 32, 'NEXEZ_RELEASE_CERT_SECRET is required')
    assert(COMMIT_SHA.length === 40, 'A full NEXEZ_COMMIT_SHA is required')
    return `Configured exact revision ${COMMIT_SHA.slice(0, 12)}.`
  })

  await check('deployed-revision', 'Exact production revision', async () => {
    const revision = await waitForRevision()
    return `Production serves ${revision.slice(0, 12)}.`
  })

  let blocking
  await check('blocking-send', 'Official SDK parses a blocking Nexez Task', async () => {
    requireClient()
    blocking = await timeout(
      client.sendMessage(
        message('blocking', 'Reply briefly that the official A2A JavaScript SDK reached Nexez. Do not call tools or propose a transaction.', false, ['text/plain']),
        options(API_KEY),
      ),
      REQUEST_MS,
      'Blocking SendMessage timed out',
    )
    assert(isTask(blocking), 'SDK did not decode SendMessage as a Task')
    assert(blocking.status?.state === TaskState.TASK_STATE_COMPLETED, `Blocking task ended in ${state(blocking)}`)
    assert(blocking.artifacts?.length > 0, 'Blocking task has no artifacts')
    taskIds.blocking = blocking.id
    return `Decoded completed task ${short(blocking.id)} through SendMessageResponse.task.`
  })

  await check('get-task', 'Official SDK retrieves the same Nexez Task', async () => {
    assert(blocking, 'Blocking task was not created')
    const task = await timeout(
      client.getTask({ tenant: '', id: blocking.id, historyLength: 2 }, options(API_KEY)),
      REQUEST_MS,
      'GetTask timed out',
    )
    assert(task.id === blocking.id, 'GetTask returned a different task')
    assert(task.contextId === blocking.contextId, 'GetTask returned a different context')
    assert(task.status?.state === TaskState.TASK_STATE_COMPLETED, `GetTask returned ${state(task)}`)
    return `GetTask returned ${short(task.id)} with the same context and state.`
  })

  await check('streaming', 'Official SDK parses Nexez SSE task events', async () => {
    requireClient()
    const cases = []
    let taskId = ''
    let finalState
    let authoritative = false
    const stream = client.sendMessageStream(
      message('streaming', 'Explain briefly why interoperable A2A streams are useful. Do not call tools.', false),
      options(API_KEY, STREAM_MS),
    )
    await timeout((async () => {
      for await (const event of stream) {
        const payload = event?.payload
        assert(payload?.$case, 'SDK returned an event without a payload case')
        cases.push(payload.$case)
        if (payload.$case === 'task') {
          taskId ||= payload.value.id
          finalState = payload.value.status?.state ?? finalState
        } else if (payload.$case === 'statusUpdate') {
          taskId ||= payload.value.taskId
          finalState = payload.value.status?.state ?? finalState
        } else if (payload.$case === 'artifactUpdate') {
          taskId ||= payload.value.taskId
          authoritative ||= payload.value.lastChunk === true
            && payload.value.artifact?.metadata?.['nexez:authoritative'] === true
        }
      }
    })(), STREAM_MS, 'Official SDK stream timed out')
    assert(cases[0] === 'task', `First stream payload was ${cases[0] || 'missing'}`)
    assert(cases.includes('statusUpdate'), 'Stream contained no status update')
    assert(cases.includes('artifactUpdate'), 'Stream contained no artifact update')
    assert(authoritative, 'Stream did not decode the authoritative artifact')
    assert(finalState === TaskState.TASK_STATE_COMPLETED, `Stream ended in ${String(finalState)}`)
    assert(taskId, 'Stream exposed no task ID')
    taskIds.streaming = taskId
    return `Parsed ${cases.length} events for ${short(taskId)}, Task first and completed.`
  })
}

const passed = checks.every((item) => item.status === 'pass')
const report = {
  schemaVersion: 1,
  status: passed ? 'passed' : 'failed',
  mode: MODE,
  sdk: { package: '@a2a-js/sdk', version: SDK_VERSION },
  commitSha: COMMIT_SHA || null,
  startedAt,
  completedAt: new Date().toISOString(),
  agentBase: AGENT_BASE,
  checks,
  taskIds,
  traces,
}
await writeFile(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`, 'utf8')
console.log(`${passed ? 'PASS' : 'FAIL'} A2A official SDK interoperability: ${checks.filter((x) => x.status === 'pass').length} passed, ${checks.filter((x) => x.status === 'fail').length} failed.`)
console.log(`Report: ${REPORT_PATH}`)
if (!passed) process.exitCode = 1

async function check(id, label, fn) {
  const started = Date.now()
  try {
    const detail = clean(await fn())
    checks.push({ id, label, status: 'pass', durationMs: Date.now() - started, detail })
    console.log(`PASS ${label}`)
  } catch (error) {
    const detail = safe(error)
    checks.push({ id, label, status: 'fail', durationMs: Date.now() - started, detail })
    console.error(`FAIL ${label}: ${detail}`)
  }
}

async function tracedFetch(input, init = {}) {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
  const headers = new Headers(input instanceof Request ? input.headers : undefined)
  new Headers(init.headers).forEach((value, key) => headers.set(key, value))
  const started = Date.now()
  const response = await fetch(input, init)
  traces.push({
    method: init.method || (input instanceof Request ? input.method : 'GET'),
    url,
    status: response.status,
    durationMs: Date.now() - started,
    request: {
      authorization: headers.has('authorization') ? 'present' : 'absent',
      a2aVersion: headers.get('a2a-version'),
      contentType: headers.get('content-type'),
      accept: headers.get('accept'),
    },
    response: {
      a2aVersion: response.headers.get('a2a-version'),
      contentType: response.headers.get('content-type'),
      wwwAuthenticate: response.headers.get('www-authenticate'),
    },
  })
  return response
}

function message(label, text = `Nexez official SDK interoperability probe: ${label}. Do not call tools.`, returnImmediately = true, acceptedOutputModes = ['text/plain', 'application/json']) {
  return {
    tenant: '',
    message: {
      messageId: `sdk-interop-${label}-${randomUUID()}`,
      contextId: '',
      taskId: '',
      role: Role.ROLE_USER,
      parts: [{ content: { $case: 'text', value: text }, metadata: undefined, filename: '', mediaType: 'text/plain' }],
      metadata: {},
      extensions: [],
      referenceTaskIds: [],
    },
    configuration: {
      acceptedOutputModes,
      taskPushNotificationConfig: undefined,
      historyLength: 2,
      returnImmediately,
    },
    metadata: {},
  }
}

function options(key, timeoutMs = REQUEST_MS) {
  return {
    signal: AbortSignal.timeout(timeoutMs),
    serviceParameters: {
      ...(key ? { Authorization: `Bearer ${key}` } : {}),
      'X-Nexez-Client': `official-a2a-js-sdk/${SDK_VERSION}`,
    },
  }
}

async function waitForRevision() {
  const deadline = Date.now() + DEPLOY_MS
  let last = 'deployment health did not respond'
  do {
    try {
      const response = await fetchWithTimeout(HEALTH_URL, {
        headers: { Authorization: `Bearer ${RELEASE_SECRET}`, Accept: 'application/json' },
      })
      const body = await response.json().catch(() => null)
      if (response.status === 401) throw new Error('Release-certification Bearer token was rejected')
      const revision = sha(body?.deployment?.revision)
      if (revision === COMMIT_SHA) return revision
      last = revision ? `production still serves ${revision.slice(0, 12)}` : `health returned HTTP ${response.status} without a revision`
    } catch (error) {
      last = safe(error)
    }
    if (Date.now() < deadline) await sleep(Math.min(POLL_MS, deadline - Date.now()))
  } while (Date.now() < deadline)
  throw new Error(`Timed out waiting for ${COMMIT_SHA.slice(0, 12)}: ${last}`)
}

async function fetchWithTimeout(url, init) {
  return fetch(url, { ...init, signal: AbortSignal.timeout(REQUEST_MS) })
}

async function fails(fn, message) {
  try {
    await fn()
  } catch {
    return
  }
  throw new Error(message)
}

function lastTrace(url, start = 0) {
  for (let i = traces.length - 1; i >= start; i -= 1) if (traces[i].url === url) return traces[i]
  return null
}

function requireClient() {
  assert(client, 'Official SDK client was not created')
}

function isTask(value) {
  return Boolean(value && typeof value === 'object' && typeof value.id === 'string' && value.status)
}

function timeout(promise, ms, message) {
  let timer
  return Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(message)), ms) })])
    .finally(() => clearTimeout(timer))
}

function mode(value) {
  const result = String(value).trim().toLowerCase()
  if (!['public', 'authenticated'].includes(result)) throw new Error('NEXEZ_A2A_INTEROP_MODE must be public or authenticated')
  return result
}

function sha(value) {
  const result = typeof value === 'string' ? value.trim().toLowerCase() : ''
  return /^[0-9a-f]{40}$/.test(result) ? result : ''
}

function number(value, fallback) {
  const result = Number(value)
  return Number.isFinite(result) && result > 0 ? result : fallback
}

function trim(value) {
  return String(value).trim().replace(/\/+$/, '')
}

function state(task) {
  return String(task?.status?.state ?? 'unknown')
}

function short(value) {
  return typeof value === 'string' ? value.slice(0, 8) : 'unknown'
}

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

function clean(value) {
  return String(value || '').replace(/\s+/g, ' ').trim().slice(0, 500)
}

function safe(error) {
  return clean(error instanceof Error ? error.message : error)
    .replace(/nxz_live_[A-Za-z0-9_-]+/g, '[redacted-api-key]')
    .replace(/Bearer\s+[A-Za-z0-9._~+\/-]+/gi, 'Bearer [redacted]')
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
