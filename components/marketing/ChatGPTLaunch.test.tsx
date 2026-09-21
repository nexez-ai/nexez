import { readFileSync } from 'node:fs'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { ChatGPTInstallCard, ChatGPTLaunchAnnouncement } from './ChatGPTLaunch'
import { NEXEZ_BUYER_PLUGIN } from '../../lib/nexez-buyer-plugin'
import { appUrl } from '../../lib/site'

describe('published ChatGPT launch surfaces', () => {
  it('uses the approved public directory entry rather than a development connector', () => {
    expect(NEXEZ_BUYER_PLUGIN.directoryUrl).toBe(
      'https://chatgpt.com/plugins/plugin_asdk_app_6a9759b229008191bdb36577a8601b81',
    )
    expect(NEXEZ_BUYER_PLUGIN.version).toBe('0.1.0')
  })

  it.each([ChatGPTLaunchAnnouncement, ChatGPTInstallCard])('provides working buyer and merchant destinations', (Component) => {
    const html = renderToStaticMarkup(<Component />)
    expect(html).toContain(`href="${NEXEZ_BUYER_PLUGIN.directoryUrl}"`)
    expect(html).toContain(`href="${appUrl('/create')}"`)
    expect(html).toContain('target="_blank" rel="noopener noreferrer"')
    expect(html).toContain('(opens in a new tab)')
    expect(html).toContain('List your business')
    expect(html).toContain('src="/icon.svg"')
  })

  it('explains installation without promising purchases or guaranteed seller acceptance', () => {
    const html = renderToStaticMarkup(<ChatGPTInstallCard />)
    expect(html).toContain('id="chatgpt"')
    expect(html).toContain('aria-labelledby="chatgpt-install-title"')
    expect(html).toContain('Sign in if prompted.')
    expect(html).toContain(NEXEZ_BUYER_PLUGIN.safetyNote)
    expect(html).toContain('does not guarantee availability or seller acceptance')
  })

  it('keeps the announcement and install card wired into the public pages', () => {
    const home = readFileSync(new URL('../../app/page.tsx', import.meta.url), 'utf8')
    const agents = readFileSync(new URL('../../app/agents/page.tsx', import.meta.url), 'utf8')
    expect(home).toContain('<ChatGPTLaunchAnnouncement />')
    expect(agents).toContain('<ChatGPTInstallCard />')
    expect(agents).toContain('href="#chatgpt"')
    expect(agents).toContain('href="#install"')
  })
})
