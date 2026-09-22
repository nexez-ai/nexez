import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const source = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')

describe('integration release metadata contracts', () => {
  it('keeps patched runtime dependencies aligned in both lockfiles', () => {
    const manifest = JSON.parse(source('package.json'))
    const lock = JSON.parse(source('package-lock.json'))
    const pnpm = source('pnpm-lock.yaml')
    expect(manifest.dependencies.next).toBe('16.3.5')
    expect(manifest.devDependencies['eslint-config-next']).toBe('16.3.5')
    expect(manifest.overrides.hono).toBe('4.13.8')
    expect(source('pnpm-workspace.yaml')).toContain('hono: 4.13.8')
    expect(source('pnpm-workspace.yaml')).toContain("  - '.'")
    for (const [name, version] of Object.entries({ next: '16.3.5', sharp: '0.35.4', hono: '4.13.8', 'fast-uri': '3.1.7', qs: '6.16.0' })) {
      expect(lock.packages[`node_modules/${name}`].version).toBe(version)
      expect(pnpm.includes(`${name}@${version}`)).toBe(true)
    }
    for (const vulnerable of ['hono@4.13.3', 'hono: 4.13.3', 'sharp@0.35.3', 'next@16.3.1', 'fast-uri@3.1.5', 'qs@6.15.3']) {
      expect(pnpm.includes(vulnerable), `Stale runtime dependency: ${vulnerable}`).toBe(false)
    }
  })

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
