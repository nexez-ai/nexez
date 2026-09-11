import type { Metadata } from 'next'
import Link from 'next/link'
import { cookies } from 'next/headers'
import { notFound, redirect } from 'next/navigation'
import { createClient } from '@/utils/supabase/server'
import { getOrganizationWorkspace, organizationSlugSchema } from '@/lib/server/organization-context'
import { representativeOrganizationReport, sparseOrganizationReport, zeroActivityOrganizationReport } from '@/lib/organization-report-examples'
import { OrganizationReport } from '@/components/organizations/OrganizationReport'
import { OrganizationWorkspaceNav } from '@/components/organizations/OrganizationWorkspaceNav'

export const metadata: Metadata = { title: 'Report examples', robots: { index: false, follow: false } }
export const dynamic = 'force-dynamic'

const examples = [
  { key: 'activity', label: 'Illustrative activity', report: representativeOrganizationReport },
  { key: 'missing', label: 'Missing sources', report: sparseOrganizationReport },
  { key: 'zero', label: 'Confirmed zero activity', report: zeroActivityOrganizationReport },
] as const

/** This entry point selects fixed synthetic fixtures only. It cannot accept
 * report data or merchant resource IDs, and never reads merchant sources. */
export default async function OrganizationReportExamples({ params, searchParams }: {
  params: Promise<{ orgSlug: string }>
  searchParams: Promise<{ example?: string | string[] }>
}) {
  const [{ orgSlug }, query] = await Promise.all([params, searchParams])
  if (!organizationSlugSchema.safeParse(orgSlug).success) notFound()
  const selected = examples.find(item => item.key === (query.example ?? 'activity'))
  if (!selected || selected.report.dataBasis !== 'synthetic_example') notFound()
  const path = `/console/${orgSlug}/report-examples`
  const supabase = createClient(await cookies())
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect(`/login?next=${encodeURIComponent(`${path}?example=${selected.key}`)}`)
  // Reauthorize at the leaf, including client navigation and RSC requests.
  const result = await getOrganizationWorkspace(supabase, { slug: orgSlug })
    .then(organization => ({ ok: true as const, organization }))
    .catch(() => ({ ok: false as const }))
  if (result.ok && !result.organization) notFound()

  return <main>
    <div className="mx-auto max-w-6xl px-5 pt-10">
      <Link href="/console" prefetch={false} className="text-sm text-[var(--fg-muted)] underline underline-offset-4">All workspaces</Link>
      {!result.ok ? <p role="alert" className="my-8">This workspace is temporarily unavailable. Please try again.</p> : <>
        <p className="mt-6 break-words text-sm font-medium text-[var(--fg-muted)]">{result.organization!.name}</p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight">Report examples</h1>
        <p className="mt-3 max-w-2xl text-[var(--fg-muted)]">Explore the report with illustrative activity, missing sources, or measured zero activity. Every example uses synthetic data.</p>
        <OrganizationWorkspaceNav slug={orgSlug} active="report-examples" />
        <nav aria-label="Report examples" className="mt-6 flex flex-wrap gap-3">
          {examples.map(item => <Link key={item.key} prefetch={false} href={`${path}?example=${item.key}`}
            aria-current={selected.key === item.key ? 'page' : undefined}
            className={`rounded-[var(--r-card)] border border-[var(--bd-10)] px-4 py-2 text-sm focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[var(--signal)] ${selected.key === item.key ? 'bg-[var(--ov-06)] font-semibold' : 'text-[var(--fg-muted)] hover:text-[var(--fg)]'}`}>{item.label}</Link>)}
        </nav>
      </>}
    </div>
    {result.ok && <OrganizationReport report={selected.report} />}
  </main>
}
