import type { Metadata } from 'next'
import Link from 'next/link'
import { cookies } from 'next/headers'
import { notFound, redirect } from 'next/navigation'
import { z } from 'zod'
import { createClient } from '@/utils/supabase/server'
import { getOrganizationWorkspace, organizationSlugSchema } from '@/lib/server/organization-context'
import { readScanWorkspace, OrganizationScanError } from '@/lib/server/organization-scans'
import { OrganizationScanWorkspace } from '@/components/organizations/OrganizationScanWorkspace'

export const metadata: Metadata = { title: 'Scan results', robots: { index: false, follow: false } }
export const dynamic = 'force-dynamic'

export default async function ScanBatchPage({ params }: { params: Promise<{ orgSlug: string; batchId: string }> }) {
  const { orgSlug, batchId } = await params
  if (!organizationSlugSchema.safeParse(orgSlug).success || !z.uuid().safeParse(batchId).success) notFound()
  const client = createClient(await cookies())
  const { data: { user } } = await client.auth.getUser()
  if (!user) redirect(`/login?next=${encodeURIComponent(`/console/${orgSlug}/scans/${batchId}`)}`)
  const context = await getOrganizationWorkspace(client, { slug: orgSlug }).then((org) => ({ ok: true as const, org })).catch(() => ({ ok: false as const }))
  if (!context.ok) return <main className="mx-auto max-w-4xl px-5 py-12"><p role="alert">Scans are temporarily unavailable. Please try again.</p></main>
  if (!context.org) notFound()
  const org = context.org
  try { await readScanWorkspace(client, org.id, batchId.toLowerCase()) }
  catch (error) {
    if (error instanceof OrganizationScanError && error.status === 404) notFound()
    return <main className="mx-auto max-w-4xl px-5 py-12"><p role="alert">Scans are temporarily unavailable. Please try again.</p></main>
  }
  return <main className="mx-auto w-full max-w-4xl px-5 py-12">
    <Link href={`/console/${orgSlug}/scans`} prefetch={false} className="text-sm text-[var(--fg-muted)] underline underline-offset-4">All batches</Link>
    <p className="mt-8 break-words text-sm text-[var(--fg-muted)]">{org.name}</p>
    <h1 className="mt-2 text-3xl font-semibold tracking-tight">Website scan results</h1>
    <OrganizationScanWorkspace key={`${org.id}:${batchId}`} orgId={org.id} orgSlug={orgSlug} batchId={batchId.toLowerCase()}
      batchLimit={org.scanAccess.maxTargetsPerBatch ?? 50} dailyLimit={org.scanAccess.maxTargetsPerDay ?? 250} />
  </main>
}
