# A2A production canary and observability

## Cadence and safety

`A2A Production Canary` runs once per day and can also be dispatched manually.
The job is serialized for the shared credential and verifies the exact production
revision before it exercises the protocol. It creates two non-transactional tasks:

- one direct immediate-return task, followed by `GetTask` and an identical replay
- one blocking send through `@a2a-js/sdk@1.2.0`

The prompts explicitly prohibit tools and transactions. The canary does not perform
checkout, booking, negotiation execution, payment, approval submission, customer
inventory mutation, or arbitrary remote fetches. Missing credentials fail closed.

The existing `A2A Production Certification` workflow remains the manual full matrix
for owner isolation, stream resume, cancellation, approval boundaries, and optional
revoked or non-Pro credentials.

## Evidence and retention

Workflow reports contain operational results, task IDs, response classes, and
timings only. A second workflow step rejects reports containing Nexez API key or
Bearer material. GitHub retains the canary report artifact for 90 days.

Canary-created message receipts have one of these prefixes:

- `a2a-canary-immediate-`
- `a2a-canary-sdk-`

Synthetic task payloads are retained for 30 days after terminal settlement. A daily
database job deletes at most 100 eligible tasks per run. Eligibility requires every
one of these independent boundaries:

- the owner is explicitly registered in `private.a2a_test_principals`
- the owner registration is active
- the task is terminal and older than the registered retention period
- the task has at least one receipt with an `a2a-cert-` or `a2a-canary-` prefix
- the task has no receipt outside those two prefixes

Age alone is never sufficient. Application roles, including `service_role`, cannot
read the registration table or execute the cleanup function. Registration is an
operator database action and must resolve the dedicated certification owner from
verified account and API-key evidence. Customer accounts must never be registered.
Durable release certificates and GitHub workflow evidence are not deleted by this
job and remain the longer-lived audit trail.

## Runtime event contract

All A2A events use a fixed allowlist of dimensions. They may include environment,
route, method, task state, result class, error class, deployment revision, event
sequence, and bounded timings. They never include prompts, model output, API keys,
key hashes, email, owner identity, approval payloads, provider bodies, or arbitrary
caller metadata.

The production observability webhook receives normal structured events. Critical
invariant failures also use the shared error fan-out, which reaches the configured
webhook and Sentry sinks.

| Operational condition | Signal |
| --- | --- |
| Message accepted, replayed, or conflicted | `a2a.v1.message.*` |
| Claim timing or lost claim race | `a2a.v1.task.claimed`, `a2a.v1.task.claim_lost`; warning signal at 10 seconds |
| Submitted work does not complete | Daily canary `immediate-task` failure |
| Working lease expires | Alert-level `a2a.v1.task.reconciled` |
| Reconciliation repeats unexpectedly | Any additional alert-level reconciliation signal |
| Event sequence write fails | Alert-level `a2a.v1.event.persistence_failed` |
| Terminal or cancellation write loses | Alert-level `a2a.v1.task.terminal_write_conflict` |
| Task completion, input, failure, or cancellation | `a2a.v1.task.state_changed`, `a2a.v1.task.canceled` |
| SSE connection, resume, cursor, or disconnect | `a2a.v1.sse.*` |
| Authentication or entitlement surge | Countable warning `a2a.v1.auth.denied` by `errorClass`; alert at 25 events in 5 minutes |
| IP, owner, or turn throttling | Countable warning `a2a.v1.rate_limited` by `scope`; alert at 5 events in 5 minutes |
| Claim waits at least 10 seconds | Countable warning `a2a.v1.task.claim_delayed`; alert on the first event |
| Scheduled execution fails | Alert-level `a2a.v1.scheduled_execution.failed` |
| Daily direct or official SDK canary fails | Failed `A2A Production Canary` workflow |

Alert-level events are intentionally generic errors or warning signals. Their error
messages and contexts contain only the event name and allowlisted operational
dimensions. Sentry groups the three warning signals by event name and error class,
so thresholds are executable independently of the optional observability webhook.

## Independent SDK conformance

The JavaScript and Python interoperability workflows are separate clients with
separately pinned official SDKs. Pull requests run public discovery, version,
capability, anonymous-auth, and invalid-auth checks. An authenticated manual run is
bound to an exact production revision and proves blocking `SendMessage`, `GetTask`,
streaming event order, terminal completion, and explicit rejection of unadvertised
optional methods. Reports are redacted and retained by GitHub for 90 days.
