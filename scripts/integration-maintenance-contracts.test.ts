import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const source = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')

describe('integration release metadata contracts', () => {
  it('keeps official JavaScript SDK pins and reported versions aligned', () => {
    for (const path of ['scripts/certify-a2a-sdk-interop.mjs', 'scripts/canary-a2a.mjs']) {
      expect(source(path)).toContain("const SDK_VERSION = '1.2.0'")
    }
    for (const path of ['.github/workflows/a2a-sdk-interop.yml', '.github/workflows/a2a-production-canary.yml']) {
      const pins = [...source(path).matchAll(/@a2a-js\/sdk@([\d.]+)/g)].map((match) => match[1])
      expect(pins.length).toBeGreaterThan(0)
      expect(new Set(pins)).toEqual(new Set(['1.2.0']))
    }
  })

  it('keeps official Python SDK pins and the runtime version assertion aligned', () => {
    expect(source('scripts/certify-a2a-python-interop.py')).toContain('SDK_VERSION = "1.1.5"')
    const pins = [...source('.github/workflows/a2a-python-interop.yml').matchAll(/a2a-sdk==([\d.]+)/g)].map((match) => match[1])
    expect(pins).toEqual(['1.1.5', '1.1.5'])
  })

  it('names Seller Hub accurately and gates release configuration and platform parity', () => {
    const workflow = source('.github/workflows/seller-mobile.yml')
    expect(workflow).toMatch(/^name: Nexez Seller Hub\n/)
    expect(workflow).not.toContain('Nexxi Mobile')
    expect(workflow).not.toContain('nexxi-mobile')
    expect(workflow).toContain('npm run check:release-config')
    expect(workflow).toContain('npm run check:mobile-platform-contracts')
    expect(workflow).toContain('npm run bundle:web')
    expect(workflow).toContain('workflow_dispatch:')
  })
})
