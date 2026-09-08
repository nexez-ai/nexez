// Every Inngest function the serve route registers. New background jobs (the
// batch-scan harness, future email/report jobs) get added here.

import { dispatchOutboundWebhooks } from './outbound-webhooks'
import { processFreshnessNudge } from './freshness-nudge'
import { regenerateFeeds } from './feed-regenerate'
import { runOrganizationScanBatch, recoverOrganizationScans } from './organization-scans'

export const inngestFunctions = [dispatchOutboundWebhooks, processFreshnessNudge, regenerateFeeds, runOrganizationScanBatch, recoverOrganizationScans]
