#!/usr/bin/env node

import { randomUUID } from 'node:crypto'
import { writeFile } from 'node:fs/promises'

const AGENT_BASE = trimBase(process.env.NEXEZ_A2A_CERT_BASE || 'https://nexez.app')
const APP_BASE = trimBase(process.env.NEXEZ_A2A_CERT_APP_BASE || 'https://app.nexez.ai')
const A2A_URL = process.env.NEXEZ_A2A_CERT_ENDPOINT || `${AGENT_BASE}/api/v1/a2a`
const AGENT_CARD_URL = process.env.NEXEZ_A2A_CERT_AGENT_CARD || `${AGENT_BASE}/.well-known/agent-card.json`
const HEALTH_URL = process.env.NEXEZ_A2A_CERT_HEALTH_ENDPOINT || `${APP_BASE}/api/internal/launch-health`
const RECORD_URL = process.env.NEXEZ_A2A_CERT_RECORD_ENDPOINT || `${APP_BASE}/api/internal/release-certifications`
const PRIMARY_KEY = process.env.NEXEZ_A2A_CERT_API_KEY || ''
const SECONDARY_KEY = process.env.NEXEZ_A2A_CERT_SECONDARY_API_KEY || ''
const REVOKED_KEY = process.env.NEXEZ_A2A_CERT_REVOKED_API_KEY || ''
const NONPRO_KEY = process.env.NEXEZ_A2A_CERT_NONPRO_API_KEY || ''
const RELEASE_SECRET = process.env.NEXEZ_RELEASE_CERT_SECRET || ''
const COMMIT_SHA = normalizeSha(process.env.NEXEZ_COMMIT_SHA || process.env.GITHUB_SHA)
const TIMEOUT_MS = positiveNumber(process.env.NEXEZ_A2A_CERT_TIMEOUT_MS, 15_000)
// Blocking tasks can use the route's full 60-second execution window.
const BLOCKING_TIMEOUT_MS = positiveNumber(process.env.NEXEZ_A2A_CERT_BLOCKING_TIMEOUT_MS, 90_000)
const WAIT_MS = positiveNumber(process.env.NEXEZ_A2A_CERT_WAIT_MS, process.env.GITHUB_ACTIONS ? 600_000 : 1)
const POLL_MS = positiveNumber(process.env.NEXEZ_A2A_CERT_POLL_MS, 1_000)
const SETTLE_MS = positiveNumber(process.env.NEXEZ_A2A_CERT_SETTLE_MS, 90_000)
const STREAM_MS = positiveNumber(process.env.NEXEZ_A2A_CERT_STREAM_MS, 90_000)
const POST_CANCEL_OBSERVE_MS = positiveNumber(process.env.NEXEZ_A2A_CERT_POST_CANCEL_OBSERVE_MS, 2_500)
const REPORT_PATH = process.env.NEXEZ_A2A_CERT_REPORT_PATH || 'a2a-production-certification.json'
const startedAt = new Date().toISOString()
const checks = []
const taskIds = {}
let machineHealth = null

validateConfiguration()

await check('deployed-revision', 'Exact production revision', true, async () => {
  machineHealth = await waitForDeploymentRevision()
  return `Production serves ${COMMIT_SHA.slice(0, 12)}.`
})

await check('agent-card', 'Live A2A discovery contract', true, async () => {
  const card = await fetchJson(AGENT_CARD_URL)
  assert(Array.isArray(card.supportedInterfaces), 'Agent Card supportedInterfaces is missing')
  assert(card.supportedInterfaces.length === 1, 'Agent Card must advertise exactly one interface')
  const entry = card.supportedInterfaces[0]
  assert(entry?.url === A2A_URL, `Agent Card points to ${entry?.url || 'no URL'}`)
  assert(entry?.protocolBinding === 'JSONRPC', 'Agent Card binding is not JSONRPC')
  assert(entry?.protocolVersion === '1.0', 'Agent Card protocol version is not 1.0')
  assert(card.capabilities?.streaming === true, 'Agent Card does not advertise streaming')
  assert(card.capabilities?.pushNotifications === false, 'Agent Card advertises push notifications')
  assert(card.capabilities?.extendedAgentCard === false, 'Agent Card advertises an extended card')
  return 'One JSONRPC 1.0 interface, streaming enabled, push and extended cards disabled.'
})

await check('content-type-boundary', 'Content type boundary', true, async () => {
  const response = await rawRequest({
    headers: { 'content-type': 'text/plain', 'a2a-version': '1.0' },
    body: 'hello',
  })
  assertRpcError(response, 415, -32005)
  return 'Non-JSON input failed before authentication.'
})

await check('version-boundary', 'Explicit A2A v1 negotiation', true, async () => {
  const response = await rawRequest({
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(rpcEnvelope('GetTask', { id: fakeTaskId() })),
  })
  assertRpcError(response, 400, -32009)
  return 'A missing version header was rejected as unsupported 0.3.'
})

await check('json-boundary', 'Malformed JSON boundary', true, async () => {
  const response = await rawRequest({
    headers: { 'content-type': 'application/json', 'a2a-version': '1.0' },
    body: '{not-json',
  })
  assertRpcError(response, 400, -32700)
  return 'Malformed JSON returned the protocol parse error.'
})

await check('body-limit', 'Incremental request body limit', true, async () => {
  const response = await rawRequest({
    headers: { 'content-type': 'application/json', 'a2a-version': '1.0' },
    body: JSON.stringify({ padding: 'x'.repeat(70 * 1024) }),
  })
  assertRpcError(response, 413, -32600)
  return 'A request larger than 64 KiB was rejected.'
})

await check('anonymous-auth', 'Anonymous access denial', true, async () => {
  const response = await postRpc('', 'GetTask', { id: fakeTaskId() })
  assertRpcError(response, 401, -32000)
  assert(response.headers.get('www-authenticate') === 'Bearer', 'WWW-Authenticate is missing')
  return 'Anonymous traffic received a bounded Bearer challenge.'
})

await check('invalid-key', 'Invalid API key denial', true, async () => {
  const response = await postRpc(`nxz_live_invalid_${randomUUID()}`, 'GetTask', { id: fakeTaskId() })
  assertRpcError(response, 401, -32000)
  return 'An unknown API key was rejected.'
})

await optionalCredentialCheck(
  'revoked-key',
  'Revoked API key denial',
  REVOKED_KEY,
  async (key) => {
    const response = await postRpc(key, 'GetTask', { id: fakeTaskId() })
    assertRpcError(response, 401, -32000)
    return 'A designated revoked key was rejected.'
  },
)

await optionalCredentialCheck(
  'nonpro-entitlement',
  'Non-Pro entitlement denial',
  NONPRO_KEY,
  async (key) => {
    const response = await postRpc(key, 'GetTask', { id: fakeTaskId() })
    assertRpcError(response, 402, -32000)
    return 'A designated non-Pro owner was rejected by the API access gate.'
  },
)

await check('remote-approval-input', 'Remote approval metadata denial', true, async () => {
  const params = sendParams(
    messageId('remote-approval'),
    'Return a short acknowledgement without calling tools.',
    { returnImmediately: false },
  )
  params.metadata = { nested: { approvalDecision: 'approve' } }
  const response = await postRpc(PRIMARY_KEY, 'SendMessage', params)
  assertRpcError(response, 400, -32004)
  return 'Nested remote approval metadata failed closed before execution.'
})

await check('push-disabled', 'Push notification methods remain disabled', true, async () => {
  const response = await postRpc(PRIMARY_KEY, 'CreateTaskPushNotificationConfig', {})
  assertRpcError(response, 400, -32003)
  return 'Push configuration returned pushNotSupported.'
})

let asynchronousTask = null
await check('return-immediately', 'Return-immediately execution settles', true, async () => {
  const id = messageId('return-immediately')
  const params = sendParams(
    id,
    'Reply with a brief confirmation that the Nexez A2A production certification is running. Do not call tools or propose a transaction.',
    {
      returnImmediately: true,
      historyLength: 4,
      acceptedOutputModes: ['application/json'],
    },
  )
  const accepted = assertRpcSuccess(
    await postRpc(PRIMARY_KEY, 'SendMessage', params),
  ).task
  assertTask(accepted)
  assert(accepted.status.state === 'TASK_STATE_SUBMITTED', `Expected submitted, received ${accepted.status.state}`)
  taskIds.returnImmediately = accepted.id

  const settled = await waitForTask(PRIMARY_KEY, accepted.id, 'TASK_STATE_COMPLETED')
  asynchronousTask = { messageId: id, params, task: settled }
  return `Task ${shortId(accepted.id)} settled after the HTTP response.`
})

await check('idempotency', 'Message ID idempotency and conflict', true, async () => {
  assert(asynchronousTask, 'Return-immediately task was not created')
  const replay = assertRpcSuccess(
    await postRpc(PRIMARY_KEY, 'SendMessage', asynchronousTask.params),
  ).task
  assertTask(replay)
  assert(replay.id === asynchronousTask.task.id, 'An identical replay created a different task')
  assert(replay.status.state === 'TASK_STATE_COMPLETED', 'The replay did not return the settled task')
  assertOnlyOutputMode(replay, 'application/json')

  const conflicting = structuredClone(asynchronousTask.params)
  conflicting.message.parts[0].text = `${conflicting.message.parts[0].text} Changed work.`
  const conflict = await postRpc(PRIMARY_KEY, 'SendMessage', conflicting)
  assertRpcError(conflict, 409, -32602)
  return `Identical replay reused ${shortId(replay.id)}; changed work conflicted.`
})

await check('owner-isolation', 'Cross-owner task isolation', true, async () => {
  assert(asynchronousTask, 'Return-immediately task was not created')
  const response = await postRpc(SECONDARY_KEY, 'GetTask', { id: asynchronousTask.task.id })
  assertRpcError(response, 404, -32001)
  return `A second owner could not read ${shortId(asynchronousTask.task.id)}.`
})

await check('blocking-send', 'Blocking SendMessage result', true, async () => {
  const params = sendParams(
    messageId('blocking'),
    'Reply with a brief acknowledgement of this non-transactional A2A certification request. Do not call tools.',
    {
      returnImmediately: false,
      historyLength: 2,
      acceptedOutputModes: ['text/plain'],
    },
  )
  const task = assertRpcSuccess(await postRpc(PRIMARY_KEY, 'SendMessage', params)).task
  assertTask(task)
  assert(task.status.state === 'TASK_STATE_COMPLETED', `Blocking task ended in ${task.status.state}`)
  assertOnlyOutputMode(task, 'text/plain')
  taskIds.blocking = task.id
  return `Blocking task ${shortId(task.id)} completed with text-only output.`
})

await check('stream-resume', 'Streaming order, disconnect, and resume', true, async () => {
  const params = sendParams(
    messageId('streaming'),
    'Provide a short non-transactional explanation of why resumable A2A task streams are useful. Do not call tools.',
    { returnImmediately: false, historyLength: 2 },
  )
  const firstConnection = await openSse(PRIMARY_KEY, 'SendStreamingMessage', params)
  const firstIterator = sseEvents(firstConnection.response)[Symbol.asyncIterator]()
  let firstSnapshot
  let firstDurable = null
  try {
    firstSnapshot = await nextSse(firstIterator, STREAM_MS)
    assertTaskFirst(firstSnapshot)
    taskIds.streaming = firstSnapshot.payload.result.task.id

    while (!firstDurable) {
      const event = await nextSse(firstIterator, STREAM_MS)
      if (event.id !== undefined) firstDurable = event
    }
  } finally {
    firstConnection.abort()
    await firstIterator.return?.()
  }
  const cursor = parseEventId(firstDurable.id)

  const resumedConnection = await openSse(
    PRIMARY_KEY,
    'SendStreamingMessage',
    params,
    { 'last-event-id': String(cursor) },
  )
  const resumed = await collectSse(resumedConnection, STREAM_MS)
  assert(resumed.length > 0, 'Resumed stream returned no events')
  assertTaskFirst(resumed[0])

  const durable = [firstDurable, ...resumed.filter((event) => event.id !== undefined)]
  const ids = durable.map((event) => parseEventId(event.id))
  for (let index = 1; index < ids.length; index += 1) {
    assert(ids[index] === ids[index - 1] + 1, `Stream sequence jumped from ${ids[index - 1]} to ${ids[index]}`)
  }
  assert(ids.slice(1).every((id) => id > cursor), 'Resumed stream replayed the cursor event')

  const payloads = durable.map((event) => event.payload.result)
  const authoritative = payloads.find((result) =>
    result?.artifactUpdate?.lastChunk === true
      && result.artifactUpdate.artifact?.metadata?.['nexez:authoritative'] === true)
  assert(authoritative, 'Stream did not expose the authoritative final artifact')
  const terminal = [...payloads].reverse().find((result) => result?.statusUpdate?.status?.state)
  assert(terminal?.statusUpdate?.status?.state === 'TASK_STATE_COMPLETED', 'Stream did not end in completed state')
  return `Stream resumed after event ${cursor} and ended at event ${ids.at(-1)} without gaps.`
})

await check('subscribe-cancel', 'Subscription and cancellation race', true, async () => {
  const params = sendParams(
    messageId('cancellation'),
    'Search Nexez for several cleaning services and compare their non-price tradeoffs. Do not create, approve, book, pay, or negotiate anything.',
    { returnImmediately: true, historyLength: 2 },
  )
  const accepted = assertRpcSuccess(await postRpc(PRIMARY_KEY, 'SendMessage', params)).task
  assertTask(accepted)
  assert(accepted.status.state === 'TASK_STATE_SUBMITTED', `Expected submitted, received ${accepted.status.state}`)
  taskIds.canceled = accepted.id

  const subscription = await openSse(PRIMARY_KEY, 'SubscribeToTask', { id: accepted.id, historyLength: 2 })
  const iterator = sseEvents(subscription.response)[Symbol.asyncIterator]()
  let initial
  let remaining
  try {
    initial = await nextSse(iterator, STREAM_MS)
    assertTaskFirst(initial)

    const canceled = assertRpcSuccess(await postRpc(PRIMARY_KEY, 'CancelTask', { id: accepted.id })).status
    assert(canceled?.state === 'TASK_STATE_CANCELED', `CancelTask returned ${canceled?.state || 'no state'}`)
    remaining = await collectIterator(iterator, STREAM_MS)
  } finally {
    subscription.abort()
    await iterator.return?.()
  }
  const all = [initial, ...remaining]
  const ids = all.filter((event) => event.id !== undefined).map((event) => parseEventId(event.id))
  for (let index = 1; index < ids.length; index += 1) {
    assert(ids[index] > ids[index - 1], 'Subscription event IDs were not increasing')
  }
  const terminal = [...all].reverse().find((event) => event.payload.result?.statusUpdate?.status?.state)
  assert(terminal?.payload.result.statusUpdate.status.state === 'TASK_STATE_CANCELED', 'Subscription did not end with cancellation')

  await sleep(POST_CANCEL_OBSERVE_MS)
  const observed = assertRpcSuccess(await postRpc(PRIMARY_KEY, 'GetTask', { id: accepted.id })).status
  assert(observed?.state === 'TASK_STATE_CANCELED', 'A worker overwrote the canceled terminal state')
  return `Task ${shortId(accepted.id)} stayed canceled after worker observation.`
})

await check('approval-fail-closed', 'Approval-required result stays inside Nexxi', true, async () => {
  const params = sendParams(
    messageId('approval'),
    'On Nexez, prepare a negotiation proposal for offer services-0 on storefront nexez-agent-negotiation-lab with a budget of USD 2100 and a timeline of next week. Return the human approval request, but do not approve or execute it.',
    { returnImmediately: false, historyLength: 4 },
  )
  const task = assertRpcSuccess(await postRpc(PRIMARY_KEY, 'SendMessage', params)).task
  assertTask(task)
  assert(task.status.state === 'TASK_STATE_INPUT_REQUIRED', `Approval task ended in ${task.status.state}`)
  const cards = collectObjects(task)
    .filter((value) => value.type === 'approval')
  assert(cards.length > 0, 'No approval card was returned')
  assert(cards.some((card) =>
    card.status === 'PENDING'
      && card.remoteExecution === false
      && card.completionChannel === 'nexxi'), 'Approval card did not preserve the Nexxi completion boundary')
  assertNoForbiddenExecutionKeys(task)
  taskIds.approval = task.id
  return `Task ${shortId(task.id)} required human input with no remote execution payload.`
})

const completedAt = new Date().toISOString()
const submission = {
  schemaVersion: 1,
  idempotencyKey: releaseIdempotencyKey(),
  source: releaseSource(),
  environment: 'production',
  commitSha: COMMIT_SHA,
  deploymentUrl: machineHealth?.deployment?.deploymentUrl || AGENT_BASE,
  ...(workflowUrl() ? { workflowUrl: workflowUrl() } : {}),
  ...(process.env.GITHUB_REPOSITORY ? { repository: process.env.GITHUB_REPOSITORY } : {}),
  ...(process.env.GITHUB_ACTOR ? { triggeredBy: process.env.GITHUB_ACTOR } : {}),
  startedAt,
  completedAt,
  checks,
}

let persisted = null
try {
  persisted = await postEvidence(submission)
  console.log(`RECORD ${persisted.recordId} ${persisted.status}${persisted.replayed ? ' (replay)' : ''}`)
} catch (error) {
  console.error(`RECORD FAILED: ${safeDetail(error)}`)
}

const localPassed = checks.filter((item) => item.required).every((item) => item.status === 'pass')
const passed = localPassed && persisted?.status === 'passed'
const report = {
  schemaVersion: 1,
  status: passed ? 'passed' : 'failed',
  promotionEligible: passed,
  commitSha: COMMIT_SHA,
  startedAt,
  completedAt,
  endpoint: A2A_URL,
  checks,
  taskIds,
  record: persisted,
}
await writeFile(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`, 'utf8')
printSummary(passed)
if (!passed) process.exitCode = 1

async function check(id, label, required, fn) {
  const started = Date.now()
  try {
    const detail = cleanDetail(await fn())
    checks.push({
      id,
      label,
      status: 'pass',
      required,
      durationMs: Date.now() - started,
      ...(detail ? { detail } : {}),
    })
    console.log(`PASS ${label}`)
  } catch (error) {
    const detail = safeDetail(error)
    checks.push({ id, label, status: 'fail', required, durationMs: Date.now() - started, detail })
    console.error(`FAIL ${label}: ${detail}`)
  }
}

function optionalCredentialCheck(id, label, credential, fn) {
  if (!credential) {
    checks.push({
      id,
      label,
      status: 'skip',
      required: false,
      durationMs: 0,
      detail: 'No designated credential was configured.',
    })
    console.log(`SKIP ${label}: no designated credential was configured.`)
    return
  }
  return check(id, label, false, () => fn(credential))
}

async function waitForDeploymentRevision() {
  const deadline = Date.now() + WAIT_MS
  let lastError = 'deployment health did not respond'
  do {
    try {
      const response = await fetchWithTimeout(HEALTH_URL, {
        headers: { Authorization: `Bearer ${RELEASE_SECRET}`, Accept: 'application/json' },
      })
      const text = await response.text()
      let body = null
      try { body = text ? JSON.parse(text) : null } catch {}
      if (response.status === 401) throw new FatalProbeError('Release-certification bearer token was rejected')
      const revision = normalizeSha(body?.deployment?.revision)
      if (revision === COMMIT_SHA) return body
      lastError = revision
        ? `production still serves ${revision.slice(0, 12)}`
        : `machine health returned HTTP ${response.status} without a deployment revision`
    } catch (error) {
      if (error instanceof FatalProbeError) throw error
      lastError = safeDetail(error)
    }
    if (Date.now() < deadline) await sleep(Math.min(POLL_MS, Math.max(1, deadline - Date.now())))
  } while (Date.now() < deadline)
  throw new Error(`Timed out waiting for ${COMMIT_SHA.slice(0, 12)}: ${lastError}`)
}

async function waitForTask(key, taskId, expectedState) {
  const deadline = Date.now() + SETTLE_MS
  let lastState = 'unknown'
  do {
    const task = assertRpcSuccess(await postRpc(key, 'GetTask', { id: taskId, historyLength: 4 }))
    assertTask(task)
    lastState = task.status.state
    if (lastState === expectedState) return task
    if (isSettled(lastState)) {
      throw new Error(`Task settled in ${lastState}, expected ${expectedState}`)
    }
    if (Date.now() < deadline) await sleep(Math.min(POLL_MS, Math.max(1, deadline - Date.now())))
  } while (Date.now() < deadline)
  throw new Error(`Task ${shortId(taskId)} did not settle; last state was ${lastState}`)
}

async function postRpc(key, method, params, extraHeaders = {}) {
  const headers = {
    'content-type': 'application/json',
    'a2a-version': '1.0',
    accept: 'application/json',
    ...(key ? { authorization: `Bearer ${key}` } : {}),
    ...extraHeaders,
  }
  const timeoutMs = method === 'SendMessage' && params?.configuration?.returnImmediately === false
    ? BLOCKING_TIMEOUT_MS
    : TIMEOUT_MS
  return rawRequest({ headers, body: JSON.stringify(rpcEnvelope(method, params)) }, timeoutMs)
}

async function rawRequest({ headers, body }, timeoutMs = TIMEOUT_MS) {
  const response = await fetchWithTimeout(A2A_URL, {
    method: 'POST',
    headers,
    body,
  }, timeoutMs)
  const text = await response.text()
  let parsed = null
  try { parsed = text ? JSON.parse(text) : null } catch {}
  return { status: response.status, headers: response.headers, body: parsed, text }
}

async function openSse(key, method, params, extraHeaders = {}) {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), STREAM_MS)
  const response = await fetch(A2A_URL, {
    method: 'POST',
    headers: {
      accept: 'text/event-stream',
      'content-type': 'application/json',
      'a2a-version': '1.0',
      authorization: `Bearer ${key}`,
      'user-agent': 'Nexez-A2A-Certification/1.0',
      'x-nexez-client': 'a2a-certification/1.0',
      ...extraHeaders,
    },
    body: JSON.stringify(rpcEnvelope(method, params)),
    signal: controller.signal,
  })
  clearTimeout(timeout)
  if (response.status !== 200 || !response.headers.get('content-type')?.includes('text/event-stream')) {
    const text = await response.text()
    throw new Error(`${method} returned HTTP ${response.status}: ${text.slice(0, 240)}`)
  }
  assert(response.headers.get('a2a-version') === '1.0', `${method} omitted A2A-Version: 1.0`)
  return { response, abort: () => controller.abort() }
}

async function *sseEvents(response) {
  if (!response.body) throw new Error('SSE response body is missing')
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true }).replace(/\r\n/g, '\n')
      while (buffer.includes('\n\n')) {
        const index = buffer.indexOf('\n\n')
        const block = buffer.slice(0, index)
        buffer = buffer.slice(index + 2)
        const event = parseSseBlock(block)
        if (event) yield event
      }
    }
    buffer += decoder.decode().replace(/\r\n/g, '\n')
    const event = parseSseBlock(buffer)
    if (event) yield event
  } finally {
    try { await reader.cancel() } catch {}
  }
}

function parseSseBlock(block) {
  const lines = block.split('\n')
  const data = lines
    .filter((line) => line.startsWith('data:'))
    .map((line) => line.slice(5).trimStart())
  if (!data.length) return null
  const idLine = lines.find((line) => line.startsWith('id:'))
  let payload
  try { payload = JSON.parse(data.join('\n')) } catch { throw new Error('SSE data was not valid JSON') }
  return {
    ...(idLine ? { id: idLine.slice(3).trim() } : {}),
    payload,
  }
}

async function nextSse(iterator, timeoutMs) {
  const result = await withTimeout(iterator.next(), timeoutMs, 'Timed out waiting for SSE data')
  if (result.done || !result.value) throw new Error('SSE stream ended before the required event')
  return result.value
}

async function collectSse(connection, timeoutMs) {
  try {
    return await collectIterator(sseEvents(connection.response)[Symbol.asyncIterator](), timeoutMs)
  } finally {
    connection.abort()
  }
}

async function collectIterator(iterator, timeoutMs) {
  const values = []
  const deadline = Date.now() + timeoutMs
  while (true) {
    const remaining = Math.max(1, deadline - Date.now())
    const result = await withTimeout(iterator.next(), remaining, 'Timed out waiting for SSE completion')
    if (result.done) return values
    values.push(result.value)
  }
}

function assertTaskFirst(event) {
  assert(event?.payload?.jsonrpc === '2.0', 'SSE payload is not JSON-RPC 2.0')
  assert(event.id === undefined, 'The initial Task snapshot unexpectedly had an event ID')
  assertTask(event.payload.result?.task)
}

function assertRpcSuccess(response) {
  if (response.status < 200 || response.status >= 300) {
    throw new Error(`Expected success, received HTTP ${response.status}: ${safeJson(response.body || response.text)}`)
  }
  assert(response.headers.get('a2a-version') === '1.0', 'Response omitted A2A-Version: 1.0')
  assert(response.body?.jsonrpc === '2.0', 'Response is not JSON-RPC 2.0')
  assert(!response.body.error, `Response returned an error: ${safeJson(response.body.error)}`)
  assert(response.body.result !== undefined, 'Response omitted result')
  return response.body.result
}

function assertRpcError(response, status, code) {
  assert(response.status === status, `Expected HTTP ${status}, received ${response.status}`)
  assert(response.headers.get('a2a-version') === '1.0', 'Error response omitted A2A-Version: 1.0')
  assert(response.body?.jsonrpc === '2.0', 'Error response is not JSON-RPC 2.0')
  assert(response.body?.error?.code === code, `Expected error ${code}, received ${response.body?.error?.code}`)
  assert(typeof response.body?.error?.message === 'string', 'Error message is missing')
  assert(response.body.error.message.length <= 300, 'Error message is not bounded')
}

function assertTask(task) {
  assert(task && typeof task === 'object', 'Task is missing')
  assert(typeof task.id === 'string' && task.id.length > 0, 'Task id is missing')
  assert(typeof task.status?.state === 'string', 'Task status is missing')
}

function assertOnlyOutputMode(task, mode) {
  const parts = (task.artifacts || []).flatMap((artifact) => artifact.parts || [])
  assert(parts.length > 0, `Task has no ${mode} artifact parts`)
  if (mode === 'application/json') {
    assert(parts.every((part) => Object.prototype.hasOwnProperty.call(part, 'data') && !Object.prototype.hasOwnProperty.call(part, 'text')), 'JSON-only output included a text part')
  } else {
    assert(parts.every((part) => Object.prototype.hasOwnProperty.call(part, 'text') && !Object.prototype.hasOwnProperty.call(part, 'data')), 'Text-only output included a data part')
  }
}

function assertNoForbiddenExecutionKeys(value) {
  const forbidden = new Set([
    'approvaldecision',
    'approvaltoken',
    'decision',
    'executiontoken',
    'preparedpayload',
    'providermetadata',
  ])
  const visit = (item, path) => {
    if (Array.isArray(item)) {
      item.forEach((entry, index) => visit(entry, `${path}[${index}]`))
      return
    }
    if (!item || typeof item !== 'object') return
    for (const [key, nested] of Object.entries(item)) {
      const normalized = key.replace(/[^a-z]/gi, '').toLowerCase()
      assert(!forbidden.has(normalized), `Approval response leaked ${path}.${key}`)
      visit(nested, `${path}.${key}`)
    }
  }
  visit(value, 'task')
}

function collectObjects(value) {
  const objects = []
  const visit = (item) => {
    if (Array.isArray(item)) {
      item.forEach(visit)
      return
    }
    if (!item || typeof item !== 'object') return
    objects.push(item)
    Object.values(item).forEach(visit)
  }
  visit(value)
  return objects
}

async function fetchJson(url) {
  const response = await fetchWithTimeout(url, { headers: { accept: 'application/json' } })
  const text = await response.text()
  if (!response.ok) throw new Error(`${url} returned HTTP ${response.status}: ${text.slice(0, 240)}`)
  try { return JSON.parse(text) } catch { throw new Error(`${url} did not return JSON`) }
}

async function fetchWithTimeout(url, init = {}, timeoutMs = TIMEOUT_MS) {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), timeoutMs)
  try {
    return await fetch(url, {
      ...init,
      signal: controller.signal,
      headers: {
        'user-agent': 'Nexez-A2A-Certification/1.0',
        'x-nexez-client': 'a2a-certification/1.0',
        ...(init.headers || {}),
      },
    })
  } finally {
    clearTimeout(timeout)
  }
}

async function postEvidence(body) {
  let lastError = 'release record endpoint did not respond'
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const response = await fetchWithTimeout(RECORD_URL, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${RELEASE_SECRET}`,
          Accept: 'application/json',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      })
      const text = await response.text()
      let parsed = null
      try { parsed = text ? JSON.parse(text) : null } catch {}
      if (response.status >= 400 && response.status < 500) {
        throw new FatalProbeError(`Evidence was rejected (${response.status}): ${cleanDetail(text)}`)
      }
      if (!response.ok || !parsed?.recordId) throw new Error(`Evidence returned HTTP ${response.status}`)
      return parsed
    } catch (error) {
      if (error instanceof FatalProbeError) throw error
      lastError = safeDetail(error)
      if (attempt < 3) await sleep(attempt * 250)
    }
  }
  throw new Error(lastError)
}

function rpcEnvelope(method, params) {
  return { jsonrpc: '2.0', id: `cert-${randomUUID()}`, method, params }
}

function sendParams(id, text, configuration) {
  return {
    message: {
      messageId: id,
      role: 'ROLE_USER',
      parts: [{ text, mediaType: 'text/plain' }],
    },
    configuration,
  }
}

function messageId(label) {
  return `a2a-cert-${label}-${randomUUID()}`
}

function fakeTaskId() {
  return `a2a-cert-missing-${randomUUID()}`
}

function parseEventId(value) {
  const parsed = Number(value)
  assert(Number.isSafeInteger(parsed) && parsed >= 0, `Invalid SSE event ID ${String(value)}`)
  return parsed
}

function isSettled(state) {
  return [
    'TASK_STATE_COMPLETED',
    'TASK_STATE_FAILED',
    'TASK_STATE_CANCELED',
    'TASK_STATE_INPUT_REQUIRED',
    'TASK_STATE_REJECTED',
    'TASK_STATE_AUTH_REQUIRED',
  ].includes(state)
}

function releaseIdempotencyKey() {
  const seed = process.env.NEXEZ_A2A_CERT_IDEMPOTENCY_KEY
    || `a2a-${process.env.GITHUB_RUN_ID || 'local'}-${process.env.GITHUB_RUN_ATTEMPT || randomUUID()}`
  return seed.replace(/[^A-Za-z0-9._:-]/g, '-').slice(0, 160)
}

function releaseSource() {
  const value = process.env.NEXEZ_RELEASE_SOURCE
  if (value === 'github' || value === 'manual' || value === 'local') return value
  return process.env.GITHUB_ACTIONS ? 'github' : 'local'
}

function workflowUrl() {
  if (process.env.NEXEZ_WORKFLOW_URL) return process.env.NEXEZ_WORKFLOW_URL
  if (process.env.GITHUB_SERVER_URL && process.env.GITHUB_REPOSITORY && process.env.GITHUB_RUN_ID) {
    return `${process.env.GITHUB_SERVER_URL}/${process.env.GITHUB_REPOSITORY}/actions/runs/${process.env.GITHUB_RUN_ID}`
  }
  return null
}

function validateConfiguration() {
  if (!COMMIT_SHA) throw new Error('A2A certification requires NEXEZ_COMMIT_SHA or GITHUB_SHA.')
  if (PRIMARY_KEY.length < 16) throw new Error('A2A certification requires NEXEZ_A2A_CERT_API_KEY.')
  if (SECONDARY_KEY.length < 16) throw new Error('A2A certification requires NEXEZ_A2A_CERT_SECONDARY_API_KEY.')
  if (PRIMARY_KEY === SECONDARY_KEY) throw new Error('Primary and secondary A2A certification keys must differ.')
  if (RELEASE_SECRET.length < 32) throw new Error('A2A certification requires a 32-byte NEXEZ_RELEASE_CERT_SECRET.')
}

function normalizeSha(value) {
  const normalized = typeof value === 'string' ? value.trim().toLowerCase() : ''
  return /^[0-9a-f]{7,64}$/.test(normalized) ? normalized : ''
}

function trimBase(value) {
  return value.replace(/\/+$/, '')
}

function positiveNumber(value, fallback) {
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
}

function shortId(value) {
  return typeof value === 'string' ? value.slice(0, 12) : 'unknown'
}

function safeJson(value) {
  try { return JSON.stringify(value).slice(0, 300) } catch { return String(value).slice(0, 300) }
}

function cleanDetail(value) {
  if (value === undefined || value === null) return ''
  return String(value).replace(/\s+/g, ' ').trim().slice(0, 300)
}

function safeDetail(error) {
  return cleanDetail(error instanceof Error ? error.message : String(error)) || 'Unknown failure'
}

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function withTimeout(promise, timeoutMs, message) {
  let timeout
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      timeout = setTimeout(() => reject(new Error(message)), timeoutMs)
    }),
  ]).finally(() => clearTimeout(timeout))
}

function printSummary(passed) {
  const passedCount = checks.filter((item) => item.status === 'pass').length
  const failedCount = checks.filter((item) => item.status === 'fail').length
  const skippedCount = checks.filter((item) => item.status === 'skip').length
  console.log('')
  console.log(`A2A production certification: ${passed ? 'PASSED' : 'FAILED'} | ${passedCount} passed | ${failedCount} failed | ${skippedCount} skipped`)
  for (const item of checks) {
    const suffix = item.detail ? ` - ${item.detail}` : ''
    console.log(`${item.status.toUpperCase().padEnd(4)} ${String(item.durationMs).padStart(6)}ms ${item.label}${suffix}`)
  }
  console.log(`Evidence: ${REPORT_PATH}`)
}

class FatalProbeError extends Error {}
