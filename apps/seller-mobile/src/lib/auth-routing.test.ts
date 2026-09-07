import { describe, expect, it } from 'vitest'
import { authReturnPath } from './auth-routing'

describe('authReturnPath', () => {
  it.each([
    ['/overview', '/overview'],
    ['/settings', '/settings'],
    ['/intake?thread=untrusted', '/intake'],
    ['/intake?pageId=page_123&returnTo=https://attacker.example', '/intake?pageId=page_123'],
    ['/intake?pageId=page_123&pageId=page_456', '/intake'],
    ['/intake?pageId=page%2Fadmin', '/intake'],
    ['/intake?pageId=%252e%252e', '/intake'],
    ['/intake#ignored?pageId=page_123', '/intake'],
    ['/create', '/listing/create'],
    ['/listing/create', '/listing/create'],
    ['/listing/page_123/edit', '/listing/page_123/edit'],
    ['/listing/page_123/readiness/', '/listing/page_123/readiness'],
    ['/inbox/orders/order_123?returnTo=https://attacker.example', '/inbox/orders/order_123'],
    ['/inbox/negotiations/neg_123#ignored', '/inbox/negotiations/neg_123'],
    ['/notifications/settings', '/notifications/settings'],
    ['/tools/finance', '/tools/finance'],
  ])('preserves the local destination %s', (input, expected) => {
    expect(authReturnPath(input)).toBe(expected)
  })

  it.each([
    undefined,
    null,
    ['/tools/finance', '/overview'],
    { returnTo: '/tools/finance' },
    '',
    'https://attacker.example/tools/finance',
    'https://app.nexez.ai/tools/finance',
    'nexez-seller://tools/finance',
    '//attacker.example/tools/finance',
    '/\\attacker.example/tools/finance',
    'javascript:alert(1)',
    '/login?returnTo=/login',
    '/onboarding',
    '/admin',
    '/inbox/orders/../../settings',
    '/inbox/orders/order%2Fadmin',
    '/inbox/orders/%252e%252e',
    '/listing/page_123/unsupported',
    '/tools/finance\u0000',
  ])('fails closed for unsupported return target %j', (input) => {
    expect(authReturnPath(input)).toBe('/overview')
  })
})
