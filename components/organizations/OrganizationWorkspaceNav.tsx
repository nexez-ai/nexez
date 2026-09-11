import Link from 'next/link'

export function OrganizationWorkspaceNav({ slug, active }: { slug: string; active: 'scans' | 'report-examples' }) {
  return <nav aria-label="Workspace sections" className="mt-6 flex flex-wrap gap-3">
    {([{ key: 'scans', label: 'Website scans' }, { key: 'report-examples', label: 'Report examples' }] as const).map(item => (
      <Link key={item.key} prefetch={false} href={`/console/${slug}/${item.key}`}
        aria-current={active === item.key ? 'page' : undefined}
        className={`rounded-[var(--r-card)] border border-[var(--bd-10)] px-4 py-2 text-sm focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[var(--signal)] ${active === item.key ? 'bg-[var(--ov-06)] font-semibold' : 'text-[var(--fg-muted)] hover:text-[var(--fg)]'}`}>
        {item.label}
      </Link>
    ))}
  </nav>
}
