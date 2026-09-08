import type { Metadata } from 'next'
import Link from 'next/link'
import { cookies } from 'next/headers'
import { notFound, redirect } from 'next/navigation'
import { createClient } from '@/utils/supabase/server'
import { getOrganizationWorkspace, organizationSlugSchema } from '@/lib/server/organization-context'
import { OrganizationScanWorkspace } from '@/components/organizations/OrganizationScanWorkspace'

export const metadata: Metadata = { title: 'Website scans', robots: { index: false, follow: false } }
export const dynamic = 'force-dynamic'

export default async function OrganizationScans({ params }: { params: Promise<{ orgSlug: string }> }) {
  const { orgSlug } = await params
  if (!organizationSlugSchema.safeParse(orgSlug).success) notFound()
  const supabase = createClient(await cookies())
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect(`/login?next=${encodeURIComponent(`/console/${orgSlug}/scans`)}`)
  // Check at the leaf on every request; layout checks alone do not protect RSC.
  const result = await getOrganizationWorkspace(supabase, { slug: orgSlug })
    .then((organization) => ({ ok: true as const, organization }))
    .catch(() => ({ ok: false as const }))
  if (result.ok && !result.organization) notFound()

  return (
    <main className="mx-auto w-full max-w-4xl px-5 py-12">
      <Link href="/console" prefetch={false} className="text-sm text-[var(--fg-muted)] underline underline-offset-4">All workspaces</Link>
      {!result.ok ? (
        <p role="alert" className="mt-8 rounded-[var(--r-card)] border border-[var(--bd-10)] bg-[var(--ov-03)] p-6">This workspace is temporarily unavailable. Please try again.</p>
      ) : (
        <>
          <p className="mt-8 break-words text-sm font-medium text-[var(--fg-muted)]">{result.organization!.name}</p>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight">Website scans</h1>
          <OrganizationScanWorkspace key={result.organization!.id} orgId={result.organization!.id} orgSlug={orgSlug}
            batchLimit={result.organization!.scanAccess.maxTargetsPerBatch ?? 50} dailyLimit={result.organization!.scanAccess.maxTargetsPerDay ?? 250} />
        </>
      )}
    </main>
  )
}
