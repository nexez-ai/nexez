import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { once } from 'node:events'
import { mkdtemp, readFile } from 'node:fs/promises'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

const SHA = 'a'.repeat(40)
const SECRET = 'r'.repeat(32)
const PRIMARY = 'nxz_live_primary_certification_key'
const SECONDARY = 'nxz_live_secondary_certification_key'
const REVOKED = 'nxz_live_revoked_certification_key'
const NONPRO = 'nxz_live_nonpro_certification_key'

type TaskState =
  | 'TASK_STATE_SUBMITTED'
  | 'TASK_STATE_WORKING'
  | 'TASK_STATE_COMPLETED'
  | 'TASK_STATE_CANCELED'
  | 'TASK_STATE_INPUT_REQUIRED'

type ArtifactPart = { text?: string; data?: unknown; mediaType?: string }
type Artifact = {
  artifactId: string
  parts: ArtifactPart[]
  metadata?: Record<string, unknown>
}
type Task = {
  id: string
  contextId: string
  status: { state: TaskState }
  artifacts?: Artifact[]
  metadata: { 'nexez:eventSequence': number }
}
type DurableEvent = {
  sequence: number
  result: Record<string, unknown>
}
type TaskRecord = {
  owner: string
  messageId: string
  requestHash: string
  task: Task
  events: DurableEvent[]
  timer?: NodeJS.Timeout
}
type RpcRequest = {
  jsonrpc?: string
  id?: unknown
  method?: unknown
  params?: unknown
}
type Check = {
  id: string
  status: string
  required: boolean
}

type HarnessOptions = { leakSecondary?: boolean; approvalDelayMs?: number }

let closeServer: (() => Promise<void>) | null = null

afterEach(async () => {
  await closeServer?.()
  closeServer = null
})

describe('A2A production certification runner', () => {
  it('certifies the exact revision, task lifecycles, isolation, streaming, and approval boundary', async () => {
    const harness = await startHarness()
    closeServer = harness.close
    const outputDir = await mkdtemp(join(tmpdir(), 'nexez-a2a-cert-'))
    const reportPath = join(outputDir, 'report.json')

    const result = await runCertification(harness.base, reportPath)

    expect(result.code, result.output).toBe(0)
    expect(result.output).toContain('A2A production certification: PASSED')
    expect(result.output).not.toContain(PRIMARY)
    expect(result.output).not.toContain(SECONDARY)

    const reportText = await readFile(reportPath, 'utf8')
    const report = JSON.parse(reportText) as {
      status: string
      promotionEligible: boolean
      commitSha: string
      checks: Check[]
      taskIds: Record<string, string>
      record: { recordId: string; status: string }
    }
    expect(report).toMatchObject({
      status: 'passed',
      promotionEligible: true,
      commitSha: SHA,
      record: { recordId: 'a2a-release-1', status: 'passed' },
    })
    expect(report.checks.filter((check) => check.required).every((check) => check.status === 'pass')).toBe(true)
    expect(report.checks).toContainEqual(expect.objectContaining({ id: 'return-immediately', status: 'pass' }))
    expect(report.checks).toContainEqual(expect.objectContaining({ id: 'stream-resume', status: 'pass' }))
    expect(report.checks).toContainEqual(expect.objectContaining({ id: 'subscribe-cancel', status: 'pass' }))
    expect(report.checks).toContainEqual(expect.objectContaining({ id: 'approval-fail-closed', status: 'pass' }))
    expect(Object.keys(report.taskIds)).toEqual(expect.arrayContaining([
      'returnImmediately',
      'blocking',
      'streaming',
      'canceled',
      'approval',
    ]))
    expect(reportText).not.toContain(PRIMARY)
    expect(reportText).not.toContain(SECONDARY)

    expect(harness.submission.value).toMatchObject({
      schemaVersion: 1,
      environment: 'production',
      commitSha: SHA,
    })
    const submittedChecks = harness.submission.value?.checks as Check[]
    expect(submittedChecks.map((check) => check.id)).toEqual(expect.arrayContaining([
      'deployed-revision',
      'owner-isolation',
      'stream-resume',
      'approval-fail-closed',
    ]))
  }, 20_000)

  it('fails certification and persists failed evidence when a second owner can read the task', async () => {
    const harness = await startHarness({ leakSecondary: true })
    closeServer = harness.close
    const outputDir = await mkdtemp(join(tmpdir(), 'nexez-a2a-cert-'))
    const reportPath = join(outputDir, 'report.json')

    const result = await runCertification(harness.base, reportPath)

    expect(result.code).toBe(1)
    expect(result.output).toContain('FAIL Cross-owner task isolation')
    expect(result.output).toContain('A2A production certification: FAILED')
    const report = JSON.parse(await readFile(reportPath, 'utf8')) as {
      status: string
      promotionEligible: boolean
      checks: Check[]
      record: { status: string }
    }
    expect(report).toMatchObject({
      status: 'failed',
      promotionEligible: false,
      record: { status: 'failed' },
    })
    expect(report.checks).toContainEqual(expect.objectContaining({
      id: 'owner-isolation',
      status: 'fail',
      required: true,
    }))
  }, 20_000)

  it('allows blocking approval work to exceed the short request deadline', async () => {
    const harness = await startHarness({ approvalDelayMs: 1_000 })
    closeServer = harness.close
    const outputDir = await mkdtemp(join(tmpdir(), 'nexez-a2a-cert-'))
    const reportPath = join(outputDir, 'report.json')

    const result = await runCertification(harness.base, reportPath, {
      timeoutMs: 250,
      blockingTimeoutMs: 3_000,
    })

    expect(result.code, result.output).toBe(0)
    const report = JSON.parse(await readFile(reportPath, 'utf8'))
    expect(report.checks).toContainEqual(expect.objectContaining({
      id: 'approval-fail-closed',
      status: 'pass',
      required: true,
    }))
  }, 20_000)

  it('still fails approval certification when the blocking deadline is exceeded', async () => {
    const harness = await startHarness({ approvalDelayMs: 1_000 })
    closeServer = harness.close
    const outputDir = await mkdtemp(join(tmpdir(), 'nexez-a2a-cert-'))
    const reportPath = join(outputDir, 'report.json')

    const result = await runCertification(harness.base, reportPath, {
      blockingTimeoutMs: 250,
    })

    expect(result.code, result.output).toBe(1)
    const report = JSON.parse(await readFile(reportPath, 'utf8'))
    expect(report.status).toBe('failed')
    expect(report.promotionEligible).toBe(false)
    expect(report.checks).toContainEqual(expect.objectContaining({
      id: 'approval-fail-closed',
      status: 'fail',
      required: true,
    }))
  }, 20_000)
})

async function startHarness(options: HarnessOptions = {}) {
  const recordsByMessage = new Map<string, TaskRecord>()
  const recordsByTask = new Map<string, TaskRecord>()
  const timers = new Set<NodeJS.Timeout>()
  const submission: { value: Record<string, unknown> | null } = { value: null }
  let base = ''

  const schedule = (fn: () => void, delay: number) => {
    const timer = setTimeout(() => {
      timers.delete(timer)
      fn()
    }, delay)
    timers.add(timer)
    return timer
  }

  const server = createServer(async (request, response) => {
    const body = await readBody(request)
    const url = new URL(request.url || '/', baseFrom(request))

    if (url.pathname === '/.well-known/agent-card.json') {
      return json(response, 200, {
        name: 'Nexez',
        supportedInterfaces: [{
          url: `${base}/api/v1/a2a`,
          protocolBinding: 'JSONRPC',
          protocolVersion: '1.0',
        }],
        capabilities: {
          streaming: true,
          pushNotifications: false,
          extendedAgentCard: false,
        },
      })
    }

    if (url.pathname === '/api/internal/launch-health') {
      expect(request.headers.authorization).toBe(`Bearer ${SECRET}`)
      return json(response, 200, {
        ok: true,
        deployment: {
          revision: SHA,
          deploymentId: 'dpl_a2a_test',
          deploymentUrl: 'https://nexez.app',
          environment: 'production',
        },
        summary: { status: 'ready', score: 100 },
        blockers: [],
      })
    }

    if (url.pathname === '/api/internal/release-certifications' && request.method === 'POST') {
      expect(request.headers.authorization).toBe(`Bearer ${SECRET}`)
      const value = JSON.parse(body) as Record<string, unknown>
      submission.value = value
      const checks = value.checks as Check[]
      const status = checks.some((check) => check.required && check.status !== 'pass') ? 'failed' : 'passed'
      return json(response, 201, {
        ok: status === 'passed',
        status,
        recordId: 'a2a-release-1',
        replayed: false,
      })
    }

    if (url.pathname !== '/api/v1/a2a') return json(response, 404, { error: 'not_found' })

    const contentType = request.headers['content-type']?.split(';', 1)[0]?.trim().toLowerCase()
    if (contentType !== 'application/json') return rpcError(response, 415, null, -32005, 'Content-Type must be application/json.')
    if (Buffer.byteLength(body, 'utf8') > 64 * 1024) return rpcError(response, 413, null, -32600, 'Request body is too large.')

    let rpc: RpcRequest
    try {
      rpc = JSON.parse(body) as RpcRequest
    } catch {
      return rpcError(response, 400, null, -32700, 'Invalid JSON payload.')
    }

    if (request.headers['a2a-version'] !== '1.0') {
      return rpcError(response, 400, rpc.id ?? null, -32009, 'A2A protocol version is not supported.')
    }

    const token = bearerToken(request.headers.authorization)
    if (!token) return rpcError(response, 401, rpc.id ?? null, -32000, 'Missing or malformed API key.', { 'WWW-Authenticate': 'Bearer' })
    if (token === REVOKED) return rpcError(response, 401, rpc.id ?? null, -32000, 'This API key has been revoked.')
    if (token === NONPRO) return rpcError(response, 402, rpc.id ?? null, -32000, 'API access requires the Pro plan.')
    if (token !== PRIMARY && token !== SECONDARY) return rpcError(response, 401, rpc.id ?? null, -32000, 'Invalid API key.')

    const owner = token === PRIMARY || options.leakSecondary ? 'owner-primary' : 'owner-secondary'
    if (containsRemoteApproval(rpc.params)) {
      return rpcError(response, 400, rpc.id ?? null, -32004, 'Remote approval execution is not supported.')
    }

    if (rpc.method === 'CreateTaskPushNotificationConfig') {
      return rpcError(response, 400, rpc.id ?? null, -32003, 'Push notifications are not supported.')
    }

    if (rpc.method === 'SendMessage' || rpc.method === 'SendStreamingMessage') {
      const params = asRecord(rpc.params)
      const message = asRecord(params.message)
      const messageId = String(message.messageId || '')
      const text = String(asArray(message.parts)[0] && asRecord(asArray(message.parts)[0]).text || '')
      const key = `${owner}:${messageId}`
      const requestHash = JSON.stringify(params)
      let record = recordsByMessage.get(key)
      if (record && record.requestHash !== requestHash) {
        return rpcError(response, 409, rpc.id ?? null, -32602, 'messageId was already used for different work.')
      }

      if (!record) {
        const taskId = `task-${randomUUID()}`
        record = {
          owner,
          messageId,
          requestHash,
          task: createTask(taskId, rpc.method === 'SendStreamingMessage' ? 'TASK_STATE_WORKING' : 'TASK_STATE_SUBMITTED'),
          events: [],
        }
        recordsByMessage.set(key, record)
        recordsByTask.set(taskId, record)

        if (rpc.method === 'SendStreamingMessage') {
          const current = record
          schedule(() => appendAuthoritativeEvent(current), 20)
          schedule(() => completeWithEvent(current), 60)
        } else if (text.includes('negotiation proposal')) {
          completeApproval(record)
        } else if (asRecord(params.configuration).returnImmediately === true) {
          const delay = text.includes('cleaning services') ? 500 : 40
          record.timer = schedule(() => complete(record!), delay)
        } else {
          complete(record)
        }
      }

      if (rpc.method === 'SendStreamingMessage') {
        const cursor = Number(request.headers['last-event-id'] || 0)
        return streamTask(response, rpc.id ?? null, record, cursor)
      }

      const modes = asArray(asRecord(params.configuration).acceptedOutputModes).map(String)
      if (text.includes('negotiation proposal') && options.approvalDelayMs) {
        schedule(() => rpcSuccess(response, rpc.id ?? null, { task: tailorTask(record.task, modes) }), options.approvalDelayMs)
        return
      }
      return rpcSuccess(response, rpc.id ?? null, { task: tailorTask(record.task, modes) })
    }

    if (rpc.method === 'GetTask') {
      const taskId = String(asRecord(rpc.params).id || '')
      const record = recordsByTask.get(taskId)
      if (!record || (record.owner !== owner && !options.leakSecondary)) {
        return rpcError(response, 404, rpc.id ?? null, -32001, 'Task not found.')
      }
      return rpcSuccess(response, rpc.id ?? null, record.task)
    }

    if (rpc.method === 'CancelTask') {
      const taskId = String(asRecord(rpc.params).id || '')
      const record = recordsByTask.get(taskId)
      if (!record || record.owner !== owner) return rpcError(response, 404, rpc.id ?? null, -32001, 'Task not found.')
      if (isSettled(record.task.status.state)) return rpcError(response, 409, rpc.id ?? null, -32002, 'Task is not cancelable.')
      if (record.timer) {
        clearTimeout(record.timer)
        timers.delete(record.timer)
      }
      record.task.status.state = 'TASK_STATE_CANCELED'
      appendEvent(record, {
        statusUpdate: {
          taskId,
          contextId: record.task.contextId,
          status: { state: 'TASK_STATE_CANCELED' },
        },
      })
      return rpcSuccess(response, rpc.id ?? null, record.task)
    }

    if (rpc.method === 'SubscribeToTask') {
      const taskId = String(asRecord(rpc.params).id || '')
      const record = recordsByTask.get(taskId)
      if (!record || record.owner !== owner) return rpcError(response, 404, rpc.id ?? null, -32001, 'Task not found.')
      if (isSettled(record.task.status.state)) return rpcError(response, 400, rpc.id ?? null, -32004, 'A terminal task cannot be subscribed to.')
      const cursor = Number(request.headers['last-event-id'] || 0)
      return streamTask(response, rpc.id ?? null, record, cursor)
    }

    return rpcError(response, 400, rpc.id ?? null, -32004, 'This operation is not supported.')
  })

  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Harness server did not bind')
  base = `http://127.0.0.1:${address.port}`

  return {
    base,
    submission,
    close: async () => {
      for (const timer of timers) clearTimeout(timer)
      timers.clear()
      server.close()
      await once(server, 'close')
    },
  }
}

function createTask(id: string, state: TaskState): Task {
  return {
    id,
    contextId: `context-${id}`,
    status: { state },
    metadata: { 'nexez:eventSequence': 0 },
  }
}

function complete(record: TaskRecord) {
  if (record.task.status.state === 'TASK_STATE_CANCELED') return
  record.task.status.state = 'TASK_STATE_COMPLETED'
  record.task.artifacts = [responseArtifact(record.task.id)]
}

function completeApproval(record: TaskRecord) {
  record.task.status.state = 'TASK_STATE_INPUT_REQUIRED'
  record.task.artifacts = [{
    artifactId: `${record.task.id}:nexxi-response`,
    parts: [
      { text: 'Human approval is required.', mediaType: 'text/plain' },
      {
        data: {
          cards: [{
            type: 'approval',
            status: 'PENDING',
            remoteExecution: false,
            completionChannel: 'nexxi',
          }],
        },
        mediaType: 'application/json',
      },
    ],
    metadata: { 'nexez:authoritative': true },
  }]
}

function responseArtifact(taskId: string): Artifact {
  return {
    artifactId: `${taskId}:nexxi-response`,
    parts: [
      { text: 'Certification acknowledged.', mediaType: 'text/plain' },
      { data: { cards: [], suggestions: [] }, mediaType: 'application/json' },
    ],
    metadata: { 'nexez:authoritative': true },
  }
}

function appendAuthoritativeEvent(record: TaskRecord) {
  if (record.task.status.state === 'TASK_STATE_CANCELED') return
  appendEvent(record, {
    artifactUpdate: {
      taskId: record.task.id,
      contextId: record.task.contextId,
      artifact: responseArtifact(record.task.id),
      append: false,
      lastChunk: true,
    },
  })
}

function completeWithEvent(record: TaskRecord) {
  if (record.task.status.state === 'TASK_STATE_CANCELED') return
  record.task.status.state = 'TASK_STATE_COMPLETED'
  record.task.artifacts = [responseArtifact(record.task.id)]
  appendEvent(record, {
    statusUpdate: {
      taskId: record.task.id,
      contextId: record.task.contextId,
      status: { state: 'TASK_STATE_COMPLETED' },
    },
  })
}

function appendEvent(record: TaskRecord, result: Record<string, unknown>) {
  const sequence = record.events.length + 1
  record.events.push({ sequence, result })
  record.task.metadata['nexez:eventSequence'] = sequence
}

function tailorTask(task: Task, modes: string[]): Task {
  const copy = structuredClone(task)
  if (!copy.artifacts || modes.length === 0) return copy
  const allowText = modes.includes('text/plain')
  const allowData = modes.includes('application/json')
  copy.artifacts = copy.artifacts.map((artifact) => ({
    ...artifact,
    parts: artifact.parts.filter((part) =>
      (allowText && Object.prototype.hasOwnProperty.call(part, 'text'))
      || (allowData && Object.prototype.hasOwnProperty.call(part, 'data'))),
  }))
  return copy
}

function streamTask(response: ServerResponse, rpcId: unknown, record: TaskRecord, cursor: number) {
  response.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'A2A-Version': '1.0',
    'Cache-Control': 'no-store',
    Connection: 'keep-alive',
  })
  response.write(`data: ${JSON.stringify({ jsonrpc: '2.0', id: rpcId, result: { task: record.task } })}\n\n`)
  let sent = cursor
  const flush = () => {
    for (const event of record.events.filter((item) => item.sequence > sent)) {
      sent = event.sequence
      response.write(`id: ${event.sequence}\ndata: ${JSON.stringify({ jsonrpc: '2.0', id: rpcId, result: event.result })}\n\n`)
    }
    if (isSettled(record.task.status.state) && sent >= record.events.length) {
      clearInterval(interval)
      if (!response.writableEnded) response.end()
    }
  }
  const interval = setInterval(flush, 5)
  response.on('close', () => clearInterval(interval))
  flush()
}

async function runCertification(
  base: string,
  reportPath: string,
  options: { timeoutMs?: number; blockingTimeoutMs?: number } = {},
) {
  const child = spawn(process.execPath, ['scripts/certify-a2a.mjs'], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      NEXEZ_A2A_CERT_BASE: base,
      NEXEZ_A2A_CERT_APP_BASE: base,
      NEXEZ_A2A_CERT_API_KEY: PRIMARY,
      NEXEZ_A2A_CERT_SECONDARY_API_KEY: SECONDARY,
      NEXEZ_A2A_CERT_REVOKED_API_KEY: REVOKED,
      NEXEZ_A2A_CERT_NONPRO_API_KEY: NONPRO,
      NEXEZ_RELEASE_CERT_SECRET: SECRET,
      NEXEZ_COMMIT_SHA: SHA,
      NEXEZ_A2A_CERT_WAIT_MS: '1000',
      NEXEZ_A2A_CERT_POLL_MS: '10',
      NEXEZ_A2A_CERT_SETTLE_MS: '2000',
      NEXEZ_A2A_CERT_STREAM_MS: '3000',
      NEXEZ_A2A_CERT_TIMEOUT_MS: String(options.timeoutMs ?? 2_000),
      NEXEZ_A2A_CERT_BLOCKING_TIMEOUT_MS: String(options.blockingTimeoutMs ?? 2_000),
      NEXEZ_A2A_CERT_POST_CANCEL_OBSERVE_MS: '20',
      NEXEZ_A2A_CERT_REPORT_PATH: reportPath,
      NEXEZ_RELEASE_SOURCE: 'local',
      GITHUB_ACTIONS: '',
      GITHUB_REPOSITORY: '',
      GITHUB_RUN_ID: '',
      GITHUB_RUN_ATTEMPT: '',
      GITHUB_ACTOR: '',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  let output = ''
  child.stdout.on('data', (chunk) => { output += String(chunk) })
  child.stderr.on('data', (chunk) => { output += String(chunk) })
  const [code] = await once(child, 'close') as [number]
  return { code, output }
}

function containsRemoteApproval(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(containsRemoteApproval)
  if (!value || typeof value !== 'object') return false
  return Object.entries(value).some(([key, nested]) => {
    const normalized = key.replace(/[^a-z]/gi, '').toLowerCase()
    return ['approval', 'approvalid', 'approvaldecision', 'decision'].includes(normalized)
      || containsRemoteApproval(nested)
  })
}

function bearerToken(header: string | undefined) {
  const match = header?.match(/^Bearer\s+(.+)$/i)
  return match?.[1] || ''
}

function rpcSuccess(response: ServerResponse, id: unknown, result: unknown) {
  return json(response, 200, { jsonrpc: '2.0', id, result }, a2aHeaders())
}

function rpcError(
  response: ServerResponse,
  status: number,
  id: unknown,
  code: number,
  message: string,
  headers: Record<string, string> = {},
) {
  return json(response, status, {
    jsonrpc: '2.0',
    id,
    error: { code, message },
  }, { ...a2aHeaders(), ...headers })
}

function a2aHeaders() {
  return {
    'A2A-Version': '1.0',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  }
}

function json(
  response: ServerResponse,
  status: number,
  value: unknown,
  headers: Record<string, string> = {},
) {
  response.writeHead(status, { 'Content-Type': 'application/json', ...headers })
  response.end(JSON.stringify(value))
}

function readBody(request: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let value = ''
    request.setEncoding('utf8')
    request.on('data', (chunk) => { value += chunk })
    request.on('end', () => resolve(value))
    request.on('error', reject)
  })
}

function baseFrom(request: IncomingMessage) {
  return `http://${request.headers.host}`
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}

function isSettled(state: TaskState) {
  return [
    'TASK_STATE_COMPLETED',
    'TASK_STATE_CANCELED',
    'TASK_STATE_INPUT_REQUIRED',
  ].includes(state)
}
