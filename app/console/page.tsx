import type { Metadata } from 'next'
import Link from 'next/link'
import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { createClient } from '@/utils/supabase/server'
import { listOrganizationWorkspaces, organizationSlugSchema } from '@/lib/server/organization-context'

export const metadata: Metadata = { title: 'Workspaces', robots: { index: false, follow: false } }
export const dynamic = 'force-dynamic'

export default async function OrganizationDirectory({ searchParams }: { searchParams: Promise<{ cursor?: string }> }) {
  const supabase = createClient(await cookies())
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login?next=%2Fconsole')
  const { cursor } = await searchParams
  const afterSlug = organizationSlugSchema.safeParse(cursor).success ? cursor! : null
  const directory = await listOrganizationWorkspaces(supabase, afterSlug).catch(() => null)

  return (
    <main className="mx-auto w-full max-w-4xl px-5 py-12">
      <p className="text-sm font-medium text-[var(--fg-muted)]">Organization console</p>
      <h1 className="mt-2 text-3xl font-semibold tracking-tight">Your workspaces</h1>
      <p className="mt-3 text-[var(--fg-muted)]">Choose a workspace to continue your agency&apos;s work.</p>
      {!directory ? (
        <p role="alert" className="mt-8 rounded-[var(--r-card)] border border-[var(--bd-10)] bg-[var(--ov-03)] p-6">Workspaces are temporarily unavailable. Please try again.</p>
      ) : directory.organizations.length === 0 ? (
        <div className="mt-8 rounded-[var(--r-card)] border border-[var(--bd-10)] bg-[var(--ov-03)] p-6">
          <h2 className="font-semibold">{afterSlug ? 'No more workspaces' : 'No workspaces yet'}</h2>
          <p className="mt-2 text-sm text-[var(--fg-muted)]">{afterSlug ? 'Return to the first page to choose a workspace.' : 'Your pilot contact will let you know when your organization workspace is available.'}</p>
          {afterSlug && <Link href="/console" className="mt-4 inline-block text-sm underline underline-offset-4">All workspaces</Link>}
        </div>
      ) : (
        <>
          <ul className="mt-8 grid gap-4 sm:grid-cols-2">
            {directory.organizations.map((organization) => (
              <li key={organization.id}>
                <Link prefetch={false} href={`/console/${organization.slug}/scans`} className="block rounded-[var(--r-card)] border border-[var(--bd-10)] bg-[var(--ov-03)] p-6 transition-colors hover:bg-[var(--ov-06)] focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[var(--signal)]">
                  <h2 className="break-words font-semibold">{organization.name}</h2>
                  <p className="mt-2 text-sm capitalize text-[var(--fg-muted)]">{organization.role}</p>
                  <p className="mt-5 text-sm">Open workspace &rarr;</p>
                </Link>
                <Link prefetch={false} href={`/console/${organization.slug}/report-examples`} className="mt-3 inline-block text-sm underline underline-offset-4">View report examples</Link>
              </li>
            ))}
          </ul>
          {directory.nextCursor && <Link prefetch={false} href={`/console?cursor=${encodeURIComponent(directory.nextCursor)}`} className="mt-6 inline-block text-sm underline underline-offset-4">More workspaces</Link>}
        </>
      )}
    </main>
  )
}
