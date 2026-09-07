import type {
  LaunchCheck,
  LaunchControlSnapshot,
  LaunchMetrics,
  LaunchStatus,
  LaunchSummary,
} from './launch-control'

export type ReleaseProbeStatus = 'pass' | 'fail' | 'skip'
export type ReleaseCertificationStatus = 'passed' | 'failed'
export type ReleaseCertificationSource = 'github' | 'manual' | 'local'

export type ReleaseProbe = {
  id: string
  label: string
  status: ReleaseProbeStatus
  required: boolean
  durationMs: number
  detail?: string
}

export type ReleaseCertificationSubmission = {
  schemaVersion: 1
  idempotencyKey: string
  source: ReleaseCertificationSource
  environment: 'production' | 'preview' | 'development'
  commitSha: string
  deploymentUrl: string
  workflowUrl?: string
  repository?: string
  triggeredBy?: string
  startedAt: string
  completedAt: string
  checks: ReleaseProbe[]
}

export type ReleaseDeploymentIdentity = {
  revision: string | null
  deploymentId: string | null
  deploymentUrl: string | null
  environment: string | null
}

export type ReleaseLaunchFailure = {
  area: 'configuration' | 'operations' | 'certification' | 'deployment'
  id: string
  label: string
  status: LaunchStatus | 'fail'
}

export type ReleaseCertificationDecision = {
  status: ReleaseCertificationStatus
  requiredProbeCount: number
  requiredProbeFailures: ReleaseProbe[]
  launchFailures: ReleaseLaunchFailure[]
  requiredFailureCount: number
}

export type MachineLaunchHealth = {
  schemaVersion: 1
  ok: boolean
  service: 'nexez-launch-control'
  generatedAt: string
  deployment: ReleaseDeploymentIdentity
  environment: LaunchControlSnapshot['environment']
  summary: LaunchSummary
  requiredChecks: Array<{
    area: 'configuration' | 'operations' | 'certification'
    id: string
    label: string
    status: LaunchStatus
  }>
  blockers: ReleaseLaunchFailure[]
  stripeWebhookConfiguration: Pick<
    LaunchMetrics,
    | 'stripeWebhookEndpointsEnabled'
    | 'stripeWebhookEndpointRolesCovered'
    | 'stripeWebhookRefundEventsCovered'
    | 'stripeWebhookEndpointCount'
    | 'stripeWebhookMissingEndpointRoles'
    | 'stripeWebhookMissingRefundEvents'
  >
  incidentCount: number
}

export type ReleaseCertificationRecord = {
  id: string
  status: ReleaseCertificationStatus
  source: ReleaseCertificationSource
  environment: string
  commitSha: string
  deployedRevision: string | null
  deploymentUrl: string
  workflowUrl: string | null
  triggeredBy: string | null
  completedAt: string
  launchStatus: LaunchStatus
  launchScore: number
  checkCount: number
  requiredCheckCount: number
  requiredFailedCount: number
}

type CheckArea = Exclude<ReleaseLaunchFailure['area'], 'deployment'>

export function buildMachineLaunchHealth(
  snapshot: LaunchControlSnapshot,
  deployment: ReleaseDeploymentIdentity,
): MachineLaunchHealth {
  const requiredChecks = launchChecks(snapshot)
    .filter(({ check }) => check.required)
    .map(({ area, check }) => ({
      area,
      id: check.id,
      label: check.label,
      status: check.status,
    }))

  return {
    schemaVersion: 1,
    ok: snapshot.summary.status === 'ready',
    service: 'nexez-launch-control',
    generatedAt: snapshot.generatedAt,
    deployment,
    environment: snapshot.environment,
    summary: snapshot.summary,
    requiredChecks,
    blockers: requiredChecks
      .filter((check) => check.status !== 'ready')
      .map((check) => ({ ...check })),
    stripeWebhookConfiguration: {
      stripeWebhookEndpointsEnabled: snapshot.metrics.stripeWebhookEndpointsEnabled,
      stripeWebhookEndpointRolesCovered: snapshot.metrics.stripeWebhookEndpointRolesCovered,
      stripeWebhookRefundEventsCovered: snapshot.metrics.stripeWebhookRefundEventsCovered,
      stripeWebhookEndpointCount: snapshot.metrics.stripeWebhookEndpointCount,
      stripeWebhookMissingEndpointRoles: snapshot.metrics.stripeWebhookMissingEndpointRoles,
      stripeWebhookMissingRefundEvents: snapshot.metrics.stripeWebhookMissingRefundEvents,
    },
    incidentCount: snapshot.incidents.length,
  }
}

export function buildReleaseCertificationDecision(
  snapshot: LaunchControlSnapshot,
  probes: ReleaseProbe[],
  expectedRevision: string,
  deployment: ReleaseDeploymentIdentity,
): ReleaseCertificationDecision {
  const requiredProbes = probes.filter((probe) => probe.required)
  const requiredProbeFailures = requiredProbes.filter((probe) => probe.status !== 'pass')
  const launchFailures: ReleaseLaunchFailure[] = launchChecks(snapshot)
    .filter(({ check }) => check.required && check.status !== 'ready')
    .map(({ area, check }) => ({
      area,
      id: check.id,
      label: check.label,
      status: check.status,
    }))

  if (deployment.environment !== 'production') {
    launchFailures.push({
      area: 'deployment',
      id: 'production-environment',
      label: 'Production deployment environment',
      status: 'fail',
    })
  }

  if (!deployment.revision || deployment.revision !== expectedRevision) {
    launchFailures.push({
      area: 'deployment',
      id: 'deployed-revision',
      label: 'Deployed Git revision',
      status: 'fail',
    })
  }

  const requiredFailureCount = requiredProbeFailures.length + launchFailures.length
  return {
    status: requiredFailureCount === 0 ? 'passed' : 'failed',
    requiredProbeCount: requiredProbes.length,
    requiredProbeFailures,
    launchFailures,
    requiredFailureCount,
  }
}

function launchChecks(snapshot: LaunchControlSnapshot): Array<{ area: CheckArea; check: LaunchCheck }> {
  return [
    ...snapshot.configuration.map((check) => ({ area: 'configuration' as const, check })),
    ...snapshot.operations.map((check) => ({ area: 'operations' as const, check })),
    ...snapshot.certification.map((check) => ({ area: 'certification' as const, check })),
  ]
}
