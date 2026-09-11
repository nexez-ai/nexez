// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { renderToStaticMarkup } from 'react-dom/server'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { OrganizationReport } from './OrganizationReport'
import { representativeOrganizationReport, sparseOrganizationReport, zeroActivityOrganizationReport } from '@/lib/organization-report-examples'
import { REPORT_MISSING_STATES, REPORT_MISSING_COPY } from '@/lib/organization-reports'

afterEach(cleanup)

describe('organization report presentation', () => {
  it('separates readiness measures, data scope, synthetic evidence and financial disclosure', () => {
    render(<OrganizationReport report={representativeOrganizationReport} />)
    expect(screen.getByText('Illustrative example')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Current listing readiness' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Website agent readiness' })).toBeInTheDocument()
    expect(screen.getByText(/Whole merchant account/)).toBeInTheDocument()
    expect(screen.getByText(/ownership not independently verified/)).toBeInTheDocument()
    expect(screen.getByText(/server-verified means/i)).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Financial summary is off' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Attribution is unavailable' })).toBeInTheDocument()
    expect(screen.getByRole('region', { name: 'Prioritized action' })).toHaveTextContent('Answer the first buyer questions')
    expect(screen.queryByRole('link')).not.toBeInTheDocument()
  })

  it.each(REPORT_MISSING_STATES)('renders %s without manufacturing a numeric result', state => {
    render(<OrganizationReport report={{ ...sparseOrganizationReport, traffic: { state } }} />)
    const traffic = screen.getByRole('region', { name: 'Recorded traffic' })
    expect(traffic).toHaveTextContent(REPORT_MISSING_COPY[state].label)
    expect(traffic.querySelector('dd')).toBeNull()
  })

  it('renders actual zeros as available values without claiming 100 percent verified traffic', () => {
    render(<OrganizationReport report={zeroActivityOrganizationReport} />)
    const traffic = screen.getByRole('region', { name: 'Recorded traffic' })
    expect(Array.from(traffic.querySelectorAll('dd'), value => value.textContent)).toEqual(['0', '0'])
    expect(traffic).not.toHaveTextContent('100%')
    expect(traffic).not.toHaveTextContent('Collection not started')
  })

  it('shows partial collection with exact coverage boundaries', () => {
    const report = structuredClone(representativeOrganizationReport)
    if (report.traffic.state !== 'available') throw new Error('Missing traffic fixture')
    report.traffic.coverage = { state: 'partial', from: '2026-08-12T00:00:00.000Z', toExclusive: '2026-09-01T00:00:00.000Z' }
    render(<OrganizationReport report={report} />)
    expect(screen.getByRole('region', { name: 'Source coverage' })).toHaveTextContent('Partial collection')
    expect(screen.getByRole('region', { name: 'Source coverage' })).toHaveTextContent('Aug 12, 2026')
    expect(screen.getByRole('region', { name: 'Recorded traffic' })).toHaveTextContent('Partial collection.')
  })

  it.each([
    { ...representativeOrganizationReport, draft: 'private-marker' },
    { ...representativeOrganizationReport, period: { ...representativeOrganizationReport.period, from: 'private-marker' } },
  ])('rejects malformed reports without exposing their private content: %#', report => {
    render(<OrganizationReport report={report} />)
    expect(screen.getByRole('status')).toHaveTextContent('Report unavailable')
    expect(document.body.textContent).not.toContain('private-marker')
    expect(screen.queryByRole('region', { name: 'Live order counts' })).not.toBeInTheDocument()
  })

  it('escapes source text in the static report', () => {
    const report = { ...representativeOrganizationReport, scope: { ...representativeOrganizationReport.scope, merchantName: '<script>example-only</script>' } }
    const html = renderToStaticMarkup(<OrganizationReport report={report} />)
    expect(html).not.toContain('<script>example-only</script>')
    expect(html).toContain('&lt;script&gt;example-only&lt;/script&gt;')
  })

  it('renders reproducible local examples using the same component', () => {
    const examples = [representativeOrganizationReport, sparseOrganizationReport, zeroActivityOrganizationReport]
    const reports = examples.map(report => renderToStaticMarkup(<OrganizationReport report={report} />))
    expect(reports.every(html => html.includes('Every merchant, observation and activity count below is synthetic.'))).toBe(true)
    const output = process.env.ORGANIZATION_REPORT_PREVIEW_DIR
    if (!output) return
    mkdirSync(output, { recursive: true })
    const css = readFileSync(join(process.cwd(), 'components/organizations/organization-report.css'), 'utf8')
    const labels = ['Illustrative activity', 'Missing sources', 'Confirmed zero activity']
    const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Nexez report contract examples</title><style>
      :root { color-scheme: light; --fg:#171717; --fg-muted:#606060; --bg:#fafafa; --fill-1:#f0f0f0; --line-soft:#dedede; }
      :root[data-theme="dark"] { color-scheme: dark; --fg:#fafafa; --fg-muted:#a1a1aa; --bg:#111111; --fill-1:#1b1b1b; --line-soft:#333333; }
      body { margin:0; background:var(--bg); } .example-tools { display:flex; flex-wrap:wrap; gap:8px; padding:16px 24px; border-bottom:1px solid var(--line-soft); font:13px Arial,sans-serif; }
      .example-tools button { padding:10px 14px; color:var(--fg); background:var(--bg); border:1px solid var(--line-soft); border-radius:8px; cursor:pointer; } .example-tools button[aria-pressed="true"] { background:var(--fg); color:var(--bg); } button:focus-visible { outline:2px solid var(--fg); outline-offset:3px; }
      ${css}</style></head><body><nav class="example-tools" aria-label="Report examples">${labels.map((label, index) => `<button type="button" data-example="${index}" aria-pressed="${index === 0}">${label}</button>`).join('')}<button type="button" id="theme">Toggle theme</button></nav>${reports.map((report, index) => `<main data-report="${index}" ${index === 0 ? '' : 'hidden'}>${report}</main>`).join('')}<script>
      document.querySelectorAll('[data-example]').forEach(button => button.addEventListener('click', () => { document.querySelectorAll('[data-example]').forEach(other => other.setAttribute('aria-pressed', String(other === button))); document.querySelectorAll('[data-report]').forEach(report => { report.hidden = report.dataset.report !== button.dataset.example; }); })); document.getElementById('theme').addEventListener('click', () => { document.documentElement.dataset.theme = document.documentElement.dataset.theme === 'dark' ? '' : 'dark'; });
      </script></body></html>`
    writeFileSync(join(output, 'index.html'), html)
    writeFileSync(join(output, 'examples.json'), JSON.stringify(examples, null, 2) + '\n')
  })
})
