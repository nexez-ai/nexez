import { describe, expect, it } from 'vitest'
import {
  buildLaunchAccessStartedEmail,
  buildPublishNudgeEmail,
  buildScanResultsEmail,
} from './email'
import { scanReadinessBand } from '../emails/templates'

const stripTags = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ')

describe('buildLaunchAccessStartedEmail', () => {
  const base = {
    businessName: 'Axle Plumbing Co.',
    listingName: 'Emergency Plumbing',
    durationLabel: '180 days',
    endsAt: '2027-02-24T00:00:00.000Z',
    dashboardUrl: 'https://app.nexez.ai/dashboard',
  }

  it('names the listing that started the grant in both parts', async () => {
    const mail = await buildLaunchAccessStartedEmail(base)
    expect(mail.text).toContain('Emergency Plumbing')
    expect(stripTags(mail.html)).toContain('Emergency Plumbing')
  })

  it('renders the end date as the same calendar day in html and text', async () => {
    // The expiry notice quotes this date months later from the same grant row. If
    // the two disagree by a day the merchant catches us being wrong about our own
    // billing, so both parts are formatted from one value in UTC.
    const mail = await buildLaunchAccessStartedEmail(base)
    expect(mail.text).toContain('February 24, 2027')
    expect(stripTags(mail.html)).toContain('February 24, 2027')
  })

  it('does not claim knowledge of stored cards or promise to downgrade a paid plan', async () => {
    const mail = await buildLaunchAccessStartedEmail(base)
    for (const part of [mail.text, stripTags(mail.html)]) {
      expect(part).toContain('No card is required for this promotion')
      expect(part).toContain('unless you choose a paid plan')
      expect(part).not.toContain('no card is on file')
      expect(part).not.toContain('moves to Free automatically')
    }
  })

  it('carries a working call to action', async () => {
    const mail = await buildLaunchAccessStartedEmail(base)
    expect(mail.html).toContain(base.dashboardUrl)
    expect(mail.text).toContain(base.dashboardUrl)
  })
})

describe('buildPublishNudgeEmail', () => {
  const base = {
    businessName: 'Axle Plumbing Co.',
    durationLabel: '180 days',
    publishUrl: 'https://app.nexez.ai/dashboard',
  }

  it('says the clock has not started, which is the whole point of the email', async () => {
    const mail = await buildPublishNudgeEmail(base)
    expect(mail.text).toContain('Time used: None')
    expect(stripTags(mail.html)).toContain('Time used')
  })

  it('falls back to a truthful hold when the campaign has no closing date', async () => {
    const mail = await buildPublishNudgeEmail({ ...base, reservedUntil: null })
    expect(mail.text).toContain('Subject to campaign availability')
    expect(mail.text).not.toContain('spot is still reserved')
  })

  it('formats a closing date rather than printing an ISO timestamp', async () => {
    const mail = await buildPublishNudgeEmail({ ...base, reservedUntil: '2026-09-09T00:00:00.000Z' })
    expect(mail.text).toContain('September 9, 2026')
    expect(mail.text).not.toContain('2026-09-09T')
  })

  it('does not promise activation from publication alone', async () => {
    const mail = await buildPublishNudgeEmail(base)
    for (const part of [mail.text, stripTags(mail.html)]) {
      expect(part).toContain('email and business identity are verified')
      expect(part).toContain('all qualification checks pass')
      expect(part).not.toMatch(/access begins immediately|clock starts only when your first listing goes live/i)
    }
  })
})

describe('buildScanResultsEmail', () => {
  const base = {
    domain: 'axleplumbing.com',
    score: 34,
    findings: [['Prices', 'Missing'], ['Booking path', 'Partial']] as Array<[string, string]>,
    claimUrl: 'https://app.nexez.ai/create?ref=scan',
    unsubscribeUrl: 'https://nexez.ai/api/scan/unsubscribe?t=token',
  }

  it('agrees with the badge the reader sees', async () => {
    // Subject and badge are both derived from the score. A "34/100" subject over an
    // "Easy to understand" badge is the failure this guards.
    const mail = await buildScanResultsEmail(base)
    const band = scanReadinessBand(base.score)
    expect(mail.subject).toContain('34/100')
    expect(mail.text).toContain(band.label.toLowerCase())
    expect(stripTags(mail.html)).toContain(band.label)
  })

  it('always carries an unsubscribe, because the recipient is not a user', async () => {
    const mail = await buildScanResultsEmail(base)
    expect(mail.html).toContain(base.unsubscribeUrl)
    expect(mail.text).toContain(base.unsubscribeUrl)
  })

  it('makes the public offer conditional and exact in both formats', async () => {
    const mail = await buildScanResultsEmail(base)
    for (const part of [mail.text, stripTags(mail.html)]) {
      expect(part).toContain('180 days of Nexez Launch')
      expect(part).toContain('Subject to campaign eligibility and availability')
      expect(part).toContain('all qualification checks pass')
      expect(part).toContain('does not renew into a paid subscription')
    }
  })

  it('never renders a broken score into a stranger inbox', async () => {
    const mail = await buildScanResultsEmail({ ...base, score: Number.NaN })
    expect(mail.subject).toContain('0/100')
    expect(mail.subject).not.toContain('NaN')
  })

  it('clamps a score outside the scale instead of quoting it', async () => {
    expect((await buildScanResultsEmail({ ...base, score: 140 })).subject).toContain('100/100')
    expect((await buildScanResultsEmail({ ...base, score: -20 })).subject).toContain('0/100')
  })

  it('lists every finding it was given', async () => {
    const mail = await buildScanResultsEmail(base)
    expect(mail.text).toContain('Prices: Missing')
    expect(mail.text).toContain('Booking path: Partial')
  })
})

describe('scanReadinessBand', () => {
  it('maps the scale onto three blunt states', () => {
    expect(scanReadinessBand(100).tone).toBe('positive')
    expect(scanReadinessBand(70).tone).toBe('positive')
    expect(scanReadinessBand(69).tone).toBe('caution')
    expect(scanReadinessBand(40).tone).toBe('caution')
    expect(scanReadinessBand(39).tone).toBe('danger')
    expect(scanReadinessBand(0).tone).toBe('danger')
  })
})
