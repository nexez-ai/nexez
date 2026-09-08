// Event vocabulary for the Inngest job runner. Names + payload shapes live here
// (one place) so emitters and functions never drift; the builders are pure so
// they are unit-testable without a client.

import type { OutboundWebhookPayload } from '../webhooks'
import { freshnessLabel } from '../freshness'
import { appUrl } from '../site'

/** Durable owner/page outbound-webhook fan-out (replaces the inline best-effort path). */
export const OUTBOUND_WEBHOOKS_DISPATCH = 'nexez/outbound-webhooks.dispatch'
/** One stale-listing re-interview nudge email, processed durably per page. */
export const FRESHNESS_NUDGE = 'nexez/freshness.nudge'
/** Re-exercise the public agent feed surfaces (also runs on a schedule). */
export const FEED_REGENERATE = 'nexez/feed.regenerate'
/** Identifier-only event. Prospect origins and results stay in the database. */
export const ORGANIZATION_SCAN_BATCH = 'nexez/organization-scan.batch'

export type OutboundWebhooksDispatchData = {
  ownerId: string | null
  pageId: string | null
  payload: OutboundWebhookPayload
}

export type FreshnessNudgeData = {
  pageId: string
  ownerId: string
  contactEmail: string | null
  businessName: string
  listingName: string
  freshnessLabel: string
  reinterviewUrl: string
  editUrl: string
  priorNudgeCount: number
}

export type FeedRegenerateData = {
  /** Why the regeneration was requested (publish, manual, schedule, ...). */
  reason?: string
}

type FreshnessNudgePage = {
  id: string
  owner_id: string | null
  contact_email: string | null
  slug: string
  name: string | null
  updated_at?: string | null
  created_at?: string | null
}

/**
 * Project a stale page into the freshness-nudge event payload. Returns null for
 * ownerless pages (there is nobody to nudge). Pure: URLs come from lib/site's
 * deterministic host helpers and the label from lib/freshness.
 */
export function buildFreshnessNudgeData(page: FreshnessNudgePage, priorNudgeCount: number): FreshnessNudgeData | null {
  if (!page.owner_id) return null
  return {
    pageId: page.id,
    ownerId: page.owner_id,
    contactEmail: page.contact_email,
    businessName: page.name || page.slug,
    listingName: page.name || page.slug,
    freshnessLabel: freshnessLabel(page),
    reinterviewUrl: appUrl(`/create?reinterview=${page.id}`),
    editUrl: appUrl(`/dashboard/${page.id}`),
    priorNudgeCount,
  }
}
