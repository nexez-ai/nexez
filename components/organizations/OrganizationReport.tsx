import { getReadinessCriteria } from '@/lib/agent-page'
import { SCAN_CHECK_COPY } from '@/lib/organization-scans'
import { organizationReportSchema, REPORT_METRIC_DEFINITIONS, REPORT_MISSING_COPY, reportPriorityAction, type OrganizationReportMetric, type ReportMissingState } from '@/lib/organization-reports'
import './organization-report.css'

function date(value: string) {
  return new Intl.DateTimeFormat('en-US', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'UTC' }).format(new Date(value)) + ' UTC'
}

function Missing({ state }: { state: ReportMissingState }) {
  const copy = REPORT_MISSING_COPY[state]
  return <div className="org-report-missing"><strong>{copy.label}</strong><p>{copy.detail}</p></div>
}

function Freshness({ metric }: { metric: OrganizationReportMetric }) {
  if (metric.state !== 'available') return null
  return <>
    {'coverage' in metric && metric.coverage.state === 'partial' && <p className="org-report-note"><strong>Partial collection.</strong> These counts cover {date(metric.coverage.from)} to {date(metric.coverage.toExclusive)} (end exclusive); they do not represent complete monthly collection.</p>}
    <p className="org-report-note">Observed {date(metric.observedAt)}</p>
  </>
}

/** Presentation only, with no queries, permissions, downloads or mutations.
 * No production route mounts it until the source and consent boundaries exist. */
export function OrganizationReport({ report }: { report: unknown }) {
  const parsed = organizationReportSchema.safeParse(report)
  if (!parsed.success) return <article className="org-report" role="status"><h1>Report unavailable</h1><p>The report data could not be verified. No results are shown.</p></article>
  const data = parsed.data
  const action = reportPriorityAction(data)
  const criteriaCopy = getReadinessCriteria({})
  const month = new Intl.DateTimeFormat('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(data.period.from))
  return <article className="org-report">
    {data.dataBasis === 'synthetic_example' && <aside className="org-report-example"><strong>Illustrative example</strong><span>Every merchant, observation and activity count below is synthetic.</span></aside>}
    <header className="org-report-header">
      <p className="org-report-eyebrow">Nexez · Merchant report</p>
      <h1>{data.scope.merchantName}</h1>
      <p className="org-report-subtitle">A clear baseline. One useful next step.</p>
      <dl className="org-report-meta"><div><dt>Activity period</dt><dd>{month} · UTC calendar month</dd></div><div><dt>Generated</dt><dd>{date(data.generatedAt)}</dd></div></dl>
      <p className="org-report-note">Listing and website readiness are observations at the times shown. Activity counts cover the completed month.</p>
    </header>

    <section className="org-report-action" aria-label="Prioritized action"><span className="org-report-step">01</span><div><p className="org-report-eyebrow">Suggested next step</p><h2>{action.title}</h2><p>{action.detail}</p></div></section>

    <div className="org-report-grid">
      <section className="org-report-card" aria-label="Current listing readiness">
        <p className="org-report-eyebrow">Selected Nexez listing</p><h2>Current listing readiness</h2>
        {data.listing.state === 'available' ? <>
          <p className="org-report-score">{data.listing.value.readiness.score}<span>/ 100</span></p>
          <p>{data.listing.value.readiness.criteria.filter(item => item.met).length} of {data.listing.value.readiness.criteria.length} criteria met · {data.listing.value.isPublished ? 'Published' : 'Private listing'}</p>
          <p className="org-report-description">{data.listing.value.description || 'No description recorded.'}</p>
          <ul className="org-report-criteria">{data.listing.value.readiness.criteria.map(criterion => <li key={criterion.id} data-met={criterion.met}><span aria-hidden="true">{criterion.met ? '✓' : '○'}</span><span>{criteriaCopy.find(item => item.id === criterion.id)?.label}</span><span className="org-report-note">{criterion.met ? 'Met' : 'Missing'}</span></li>)}</ul>
          <p className="org-report-note">Nexez Agent-Ready {data.listing.value.readiness.standardVersion}. This is the current score, not a historical trend.</p>
        </> : <Missing state={data.listing.state} />}
        <Freshness metric={data.listing} />
      </section>

      <section className="org-report-card" aria-label="Website agent readiness">
        <p className="org-report-eyebrow">Approved website observation</p><h2>Website agent readiness</h2>
        {data.website.state === 'available' ? <>
          <p className="org-report-score">{data.website.value.result.score.toLocaleString('en-US', { maximumFractionDigits: 1 })}<span>/ 100</span></p>
          <p className="org-report-origin">{data.website.value.origin}</p>
          <p className="org-report-note">{data.website.value.associationMethod === 'domain_verified' ? 'Domain ownership verified' : 'Website selected by the merchant; ownership not independently verified'}</p>
          <ul className="org-report-findings">{data.website.value.result.checks.filter(item => item.status !== 'pass').slice(0, 4).map(item => <li key={item.id}><strong>{SCAN_CHECK_COPY[item.id].label}</strong><span>{SCAN_CHECK_COPY[item.id].action}</span></li>)}</ul>
          <p className="org-report-note">Website rubric {data.website.value.result.version} · One baseline, no trend. This public-site score is separate from listing readiness.</p>
        </> : <Missing state={data.website.state} />}
        <Freshness metric={data.website} />
      </section>
    </div>

    <div className="org-report-grid">
      <section className="org-report-card" aria-label="Recorded traffic">
        <p className="org-report-eyebrow">Selected listing · {month}</p><h2>Recorded traffic</h2>
        {data.traffic.state === 'available' ? <>
          <dl className="org-report-counts"><div><dt>Total visits</dt><dd>{data.traffic.value.totalVisits.toLocaleString('en-US')}</dd></div><div><dt>Detected AI-agent visits</dt><dd>{data.traffic.value.detectedAiVisits.toLocaleString('en-US')}</dd></div></dl>
          <p>Ingestion coverage: {data.traffic.value.verifiedServerVisits} server-verified, {data.traffic.value.unverifiedClientVisits} client-unverified, {data.traffic.value.legacyUnverifiedVisits} legacy-unverified.</p>
          <p className="org-report-note">Server-verified means the recording came from a trusted server path. It does not verify the agent's identity or attribute a sale.</p>
        </> : <Missing state={data.traffic.state} />}
        <Freshness metric={data.traffic} />
      </section>

      <section className="org-report-card" aria-label="Live order counts">
        <p className="org-report-eyebrow">Whole merchant account · {month}</p><h2>Live order counts</h2>
        {data.orders.state === 'available' ? <>
          <p className="org-report-score">{data.orders.value.eligibleLiveOrders.toLocaleString('en-US')}<span>orders</span></p>
          <dl className="org-report-statuses">{Object.entries(data.orders.value.byPaymentStatus).map(([status, total]) => <div key={status}><dt>{({ paid: 'Paid', refunded: 'Refunded', disputed: 'Open dispute', dispute_won: 'Dispute won' })[status]}</dt><dd>{total}</dd></div>)}</dl>
          <p className="org-report-note">Excluded: {data.orders.value.excludedTestOrders} test-mode, {data.orders.value.excludedUnknownModeOrders} unknown-mode, {data.orders.value.excludedUnsupportedStatusOrders} unsupported-status orders.</p>
          <p className="org-report-note">Orders created in this month, with payment status known at observation time. These are counts, not amounts or fulfillment status.</p>
        </> : <Missing state={data.orders.state} />}
        <Freshness metric={data.orders} />
      </section>
    </div>

    <section className="org-report-card" aria-label="Source coverage"><h2>Source coverage</h2><div className="org-report-table-wrap"><table><thead><tr><th scope="col">Source</th><th scope="col">Status</th><th scope="col">Period and freshness</th></tr></thead><tbody>
      {(['listing', 'website', 'traffic', 'orders'] as const).map(key => {
        const metric = data[key]
        const names = { listing: 'Nexez listing', website: 'Merchant website baseline', traffic: 'Nexez recorded visits', orders: 'Live checkout orders' }
        return <tr key={key}><th scope="row">{names[key]}<small>{REPORT_METRIC_DEFINITIONS[key].version}</small></th><td>{metric.state === 'available' ? ('coverage' in metric && metric.coverage.state === 'partial' ? 'Partial collection' : 'Available') : REPORT_MISSING_COPY[metric.state].label}</td><td>{metric.state === 'available' ? <>{'coverage' in metric && <span>{date(metric.coverage.from)} to {date(metric.coverage.toExclusive)} (end exclusive)<br /></span>}Observed {date(metric.observedAt)}</> : 'No value reported'}</td></tr>
      })}
    </tbody></table></div></section>

    <div className="org-report-grid org-report-limits"><section><h2>Financial summary is off</h2><p>Financial amounts require an agreed disclosure policy and separate merchant permission. No totals, fees or payouts are included.</p></section><section><h2>Attribution is unavailable</h2><p>This report does not connect visits to orders. A website observation or readiness score cannot establish sales impact.</p></section></div>
    <footer className="org-report-note">Report contract {data.schemaVersion} · Scope: selected listing and its approved website, plus explicitly scoped merchant-account order counts.</footer>
  </article>
}
