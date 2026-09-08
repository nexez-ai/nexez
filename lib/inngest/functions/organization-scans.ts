import { inngest } from '../client'
import { ORGANIZATION_SCAN_BATCH } from '../events'
import { hasOrganizationScanRunner, organizationScanEventSchema, pendingOrganizationScans, processNextOrganizationScan } from '@/lib/server/organization-scan-worker'
import { recordOrganizationScanRecovery } from '@/lib/server/organization-scan-operations'

export const runOrganizationScanBatch = inngest.createFunction({
  id: 'organization-scan-batch', retries: 2, triggers: { event: ORGANIZATION_SCAN_BATCH },
  concurrency: [{ limit: 3, key: 'event.data.orgId' }, { limit: 8 }],
}, async ({ event, step }) => {
  const parsed = organizationScanEventSchema.safeParse(event.data)
  if (!parsed.success) return { skipped: 'invalid_event' }
  if (!hasOrganizationScanRunner()) return { skipped: 'runner_unavailable' }
  let processed = 0
  for (let index = 0; index < 50; index += 1) {
    const continued = await step.run(`target-${index}`, () => processNextOrganizationScan(parsed.data.orgId, parsed.data.batchId))
    if (!continued) break
    processed += 1
  }
  return { processed }
})

export const recoverOrganizationScans = inngest.createFunction({
  id: 'organization-scan-recovery', retries: 2, concurrency: 1, triggers: { cron: '* * * * *' },
}, async ({ step }) => {
  if (!hasOrganizationScanRunner()) return { skipped: 'runner_unavailable' }
  const due = await step.run('recover-and-dispatch', pendingOrganizationScans)
  if (due.length) await step.sendEvent('wake-batches', due.map((data) => ({ name: ORGANIZATION_SCAN_BATCH, data })))
  await step.run('record-recovery', recordOrganizationScanRecovery)
  return { dispatched: due.length }
})
