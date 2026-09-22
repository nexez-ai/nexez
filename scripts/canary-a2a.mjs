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
import {
  containsA2ACredentialMaterial,
  redactA2ACredentialMaterial,
} from './a2a-canary-redaction.mjs'

const SDK_VERSION = '1.2.0'
const AGENT_BASE = trim(process.env.NEXEZ_A2A_CANARY_BASE_URL || 'https://nexez.app')
const APP_BASE = trim(process.env.NEXEZ_A2A_CANARY_APP_BASE_URL || 'https://app.nexez.ai')
const A2A_URL = `${AGENT_BASE}/api/v1/a2a`
const CARD_URL = `${AGENT_BASE}/.well-known/agent-card.json`
const HEALTH_URL = `${APP_BASE}/api/internal/launch-health`
const API_KEY = process.env.NEXEZ_A2A_CERT_API_KEY || ''
const RELEASE_SECRET = process.env.NEXEZ_RELEASE_CERT_SECRET || ''
const COMMIT_SHA = sha(process.env.NEXEZ_COMMIT_SHA || process.env.GITHUB_SHA)
const REPORT_PATH = process.env.NEXEZ_A2A_CANARY_REPORT_PATH || 'a2a-production-canary.json'
const REQUEST_MS = number(process.env.NEXEZ_A2A_CANARY_REQUEST_TIMEOUT_MS, 90_000)
const DEPLOY_MS = number(
  process.env.NEXEZ_A2A_CANARY_DEPLOYMENT_WAIT_MS,
  process.env.GITHUB_ACTIONS ? 600_000 : 1,
)
const POLL_MS = number(process.env.NEXEZ_A2A_CANARY_POLL_MS, 1_000)
const startedAt = new Date().toISOString()
const checks = []
const traces = []
const taskIds = {}

await check('configuration', 'Fail-closed canary configuration', async () => {
  assert(API_KEY.length >= 16, 'NEXEZ_A2A_CERT_API_KEY is required')
  assert(RELEASE_SECRET.length >= 32, 'NEXEZ_RELEASE_CERT_SECRET is required')
  assert(COMMIT_SHA.length === 40, 'A full NEXEZ_COMMIT_SHA is required')
  return `Configured exact revision ${COMMIT_SHA.slice(0, 12)}.`
})

if (checks.some((item) => item.status === 'fail')) await finish()

await check('deployed-revision', 'Exact production revision', async () => {
  const revision = await waitForRevision()
  return `Production serves ${revision.slice(0, 12)}.`
})

if (checks.some((item) => item.id === 'deployed-revision' && item.status === 'fail')) {
  await finish()
}

await check('agent-card', 'Live Agent Card', async () => {
  const response = await tracedFetch(CARD_URL, { headers: { accept: 'application/json' } })
  const card = await response.json().catch(() => null)
  assert(response.status === 200, `Agent Card returned HTTP ${response.status}`)
  assert(card?.supportedInterfaces?.length === 1, 'Agent Card must expose one interface')
  const selected = card.supportedInterfaces[0]
  assert(selected.url === A2A_URL, 'Agent Card endpoint does not match production')
  assert(selected.protocolBinding === 'JSONRPC', 'Agent Card binding is not JSONRPC')
  assert(selected.protocolVersion === '1.0', 'Agent Card version is not 1.0')
  assert(card.capabilities?.streaming === true, 'Agent Card does not advertise streaming')
  assert(card.capabilities?.pushNotifications === false, 'Agent Card advertises push')
  return 'Discovered one JSONRPC 1.0 endpoint with the expected capabilities.'
})

await check('anonymous-auth', 'Anonymous auth boundary', async () => {
  const response = await rpc('', 'GetTask', { id: randomUUID() })
  assert(response.status === 401, `Anonymous request returned HTTP ${response.status}`)
  assert(response.headers.get('www-authenticate') === 'Bearer', 'Bearer challenge is missing')
  assert(response.body?.error?.code === -32000, 'Anonymous request returned the wrong protocol error')
  return 'Anonymous traffic received the bounded Bearer challenge.'
})

const directMessageId = `a2a-canary-immediate-${randomUUID()}`
const directParams = {
  message: {
    messageId: directMessageId,
    role: 'ROLE_USER',
    parts: [{
      text: 'Reply briefly that the Nexez A2A daily canary reached the agent. Do not call tools or propose a transaction.',
      mediaType: 'text/plain',
    }],
  },
  configuration: {
    returnImmediately: true,
    historyLength: 2,
    acceptedOutputModes: ['text/plain'],
  },
}
let directTask

await check('immediate-task', 'Immediate-return task and eventual completion', async () => {
  const accepted = rpcResult(await rpc(API_KEY, 'SendMessage', directParams)).task
  assertTask(accepted)
  assert(accepted.status.state === 'TASK_STATE_SUBMITTED', `Immediate task returned ${accepted.status.state}`)
  taskIds.immediate = accepted.id
  directTask = await waitForCompleted(accepted.id)
  return `Task ${short(directTask.id)} completed after returning its durable handle.`
})

await check('idempotent-replay', 'Identical message replay', async () => {
  assert(directTask, 'Immediate task was not created')
  const replay = rpcResult(await rpc(API_KEY, 'SendMessage', directParams)).task
  assertTask(replay)
  assert(replay.id === directTask.id, 'Identical replay created a different task')
  assert(replay.status.state === 'TASK_STATE_COMPLETED', `Replay returned ${replay.status.state}`)
  return `Replay reused task ${short(replay.id)}.`
})

await check('official-sdk-blocking', 'Official SDK blocking send', async () => {
  const factory = new ClientFactory(
    ClientFactoryOptions.createFrom(ClientFactoryOptions.default, {
      cardResolver: new DefaultAgentCardResolver({ fetchImpl: tracedFetch }),
      transports: [new JsonRpcTransportFactory({ fetchImpl: tracedFetch })],
      preferredTransports: ['JSONRPC'],
    }),
  )
  const client = await factory.createFromUrl(AGENT_BASE)
  const result = await timeout(client.sendMessage({
    tenant: '',
    message: {
      messageId: `a2a-canary-sdk-${randomUUID()}`,
      contextId: '',
      taskId: '',
      role: Role.ROLE_USER,
      parts: [{
        content: {
          $case: 'text',
          value: 'Reply briefly that the official A2A JavaScript SDK reached Nexez. Do not call tools or propose a transaction.',
        },
        metadata: undefined,
        filename: '',
        mediaType: 'text/plain',
      }],
      metadata: {},
      extensions: [],
      referenceTaskIds: [],
    },
    configuration: {
      acceptedOutputModes: ['text/plain'],
      taskPushNotificationConfig: undefined,
      historyLength: 2,
      returnImmediately: false,
    },
    metadata: {},
  }, {
    signal: AbortSignal.timeout(REQUEST_MS),
    serviceParameters: {
      Authorization: `Bearer ${API_KEY}`,
      'X-Nexez-Client': `official-a2a-js-sdk/${SDK_VERSION}`,
    },
  }), REQUEST_MS, 'Official SDK SendMessage timed out')
  assert(result?.status?.state === TaskState.TASK_STATE_COMPLETED, 'Official SDK task did not complete')
  assert(typeof result.id === 'string' && result.id, 'Official SDK returned no task id')
  taskIds.officialSdk = result.id
  return `Official SDK decoded completed task ${short(result.id)}.`
})

await check('report-redaction', 'Safe report redaction', async () => {
  const candidate = JSON.stringify(report('passed'))
  assert(!containsA2ACredentialMaterial(candidate), 'Report contains credential material')
  assert(!candidate.includes(directParams.message.parts[0].text), 'Report contains prompt text')
  return 'Report contains operational results only.'
})

await finish()

async function finish() {
  const passed = checks.every((item) => item.status === 'pass')
  await writeFile(REPORT_PATH, `${JSON.stringify(report(passed ? 'passed' : 'failed'), null, 2)}\n`, 'utf8')
  console.log(`${passed ? 'PASS' : 'FAIL'} A2A production canary: ${checks.filter((x) => x.status === 'pass').length} passed, ${checks.filter((x) => x.status === 'fail').length} failed.`)
  console.log(`Report: ${REPORT_PATH}`)
  if (!passed) process.exitCode = 1
  if (!passed) process.exit()
}

function report(status) {
  return {
    schemaVersion: 1,
    status,
    commitSha: COMMIT_SHA || null,
    sdk: { package: '@a2a-js/sdk', version: SDK_VERSION },
    startedAt,
    completedAt: new Date().toISOString(),
    checks,
    taskIds,
    traces,
  }
}

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

async function waitForRevision() {
  const deadline = Date.now() + DEPLOY_MS
  let last = 'deployment health did not respond'
  do {
    try {
      const response = await tracedFetch(HEALTH_URL, {
        headers: { Authorization: `Bearer ${RELEASE_SECRET}`, accept: 'application/json' },
      })
      const body = await response.json().catch(() => null)
      assert(response.status !== 401, 'Release-certification credential was rejected')
      const revision = sha(body?.deployment?.revision)
      if (revision === COMMIT_SHA) return revision
      last = revision ? `production still serves ${revision.slice(0, 12)}` : `health returned HTTP ${response.status}`
    } catch (error) {
      last = safe(error)
    }
    if (Date.now() < deadline) await sleep(Math.min(POLL_MS, deadline - Date.now()))
  } while (Date.now() < deadline)
  throw new Error(`Timed out waiting for ${COMMIT_SHA.slice(0, 12)}: ${last}`)
}

async function waitForCompleted(taskId) {
  const deadline = Date.now() + REQUEST_MS
  let state = 'unknown'
  do {
    const task = rpcResult(await rpc(API_KEY, 'GetTask', { id: taskId, historyLength: 2 }))
    assertTask(task)
    state = task.status.state
    if (state === 'TASK_STATE_COMPLETED') return task
    if (isSettled(state)) throw new Error(`Task settled in ${state}`)
    if (Date.now() < deadline) await sleep(Math.min(POLL_MS, deadline - Date.now()))
  } while (Date.now() < deadline)
  throw new Error(`Task did not complete; last state was ${state}`)
}

async function rpc(key, method, params) {
  const response = await tracedFetch(A2A_URL, {
    method: 'POST',
    headers: {
      accept: 'application/json',
      'content-type': 'application/json',
      'a2a-version': '1.0',
      ...(key ? { authorization: `Bearer ${key}` } : {}),
    },
    body: JSON.stringify({ jsonrpc: '2.0', id: `canary-${randomUUID()}`, method, params }),
  })
  const text = await response.text()
  let body = null
  try { body = text ? JSON.parse(text) : null } catch {}
  return { status: response.status, headers: response.headers, body }
}

function rpcResult(response) {
  assert(response.status >= 200 && response.status < 300, `A2A request returned HTTP ${response.status}`)
  assert(response.headers.get('a2a-version') === '1.0', 'A2A response omitted version 1.0')
  assert(response.body?.jsonrpc === '2.0', 'A2A response is not JSON-RPC 2.0')
  assert(!response.body.error, 'A2A response returned a protocol error')
  assert(response.body.result !== undefined, 'A2A response omitted its result')
  return response.body.result
}

async function tracedFetch(input, init = {}) {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
  const headers = new Headers(input instanceof Request ? input.headers : undefined)
  new Headers(init.headers).forEach((value, key) => headers.set(key, value))
  const started = Date.now()
  const response = await fetch(input, { ...init, signal: init.signal || AbortSignal.timeout(REQUEST_MS) })
  traces.push({
    endpoint: endpointClass(url),
    method: init.method || (input instanceof Request ? input.method : 'GET'),
    status: response.status,
    durationMs: Date.now() - started,
    authorization: headers.has('authorization') ? 'present' : 'absent',
    a2aVersion: headers.get('a2a-version'),
  })
  return response
}

function endpointClass(url) {
  if (url === HEALTH_URL) return 'deployment-health'
  if (url === CARD_URL) return 'agent-card'
  if (url === A2A_URL) return 'a2a-jsonrpc'
  return 'unexpected'
}

function assertTask(task) {
  assert(task && typeof task === 'object', 'Task is missing')
  assert(typeof task.id === 'string' && task.id, 'Task id is missing')
  assert(typeof task.status?.state === 'string', 'Task state is missing')
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

function timeout(promise, ms, message) {
  let timer
  return Promise.race([
    promise,
    new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(message)), ms) }),
  ]).finally(() => clearTimeout(timer))
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

function short(value) {
  return typeof value === 'string' ? value.slice(0, 8) : 'unknown'
}

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

function clean(value) {
  return String(value || '').replace(/\s+/g, ' ').trim().slice(0, 400)
}

function safe(error) {
  return redactA2ACredentialMaterial(
    clean(error instanceof Error ? error.message : error),
  )
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
