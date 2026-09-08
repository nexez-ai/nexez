import { describe, expect, it } from 'vitest'
import {
  PUBLIC_IDENTIFIER_MAX as platformMax,
  PUBLIC_IDENTIFIER_MIN as platformMin,
  RESERVED_PUBLIC_IDENTIFIERS as platformReserved,
  normalizePublicIdentifier as normalizePlatform,
  publicIdentifierDatabaseMessage as platformDatabaseMessage,
  validatePublicIdentifier as validatePlatform,
} from './public-identifier'
import {
  PUBLIC_IDENTIFIER_MAX as mobileMax,
  PUBLIC_IDENTIFIER_MIN as mobileMin,
  RESERVED_PUBLIC_IDENTIFIERS as mobileReserved,
  normalizePublicIdentifier as normalizeMobile,
  publicIdentifierDatabaseMessage as mobileDatabaseMessage,
  validatePublicIdentifier as validateMobile,
} from '../apps/seller-mobile/src/lib/public-identifier'

describe('seller mobile public identifier parity', () => {
  it('keeps limits and reserved names identical to the platform', () => {
    expect({ min: mobileMin, max: mobileMax }).toEqual({ min: platformMin, max: platformMax })
    expect([...mobileReserved].sort()).toEqual([...platformReserved].sort())
  })

  it.each([
    '',
    'old',
    'fresh-shop',
    'Fresh Shop',
    'checkout',
    'console',
    'xn--merchant',
    'nexez-partner',
    'partner-nexez',
    'a'.repeat(63),
    'a'.repeat(64),
  ])('keeps normalization and validation identical for %s', (value) => {
    expect(normalizeMobile(value)).toBe(normalizePlatform(value))
    expect(validateMobile(value)).toEqual(validatePlatform(value))
    expect(validateMobile(value, { current: value })).toEqual(validatePlatform(value, { current: value }))
  })

  it.each([
    [{ message: 'PUBLIC_IDENTIFIER_REQUIRED' }],
    [{ message: 'PUBLIC_IDENTIFIER_RESERVED' }],
    [{ message: 'PUBLIC_IDENTIFIER_TAKEN' }],
    [{ code: '23505', message: 'pages_slug_key' }],
    [{ code: '23505', message: 'unrelated_key' }],
  ])('keeps database error mapping identical for %o', (error) => {
    expect(mobileDatabaseMessage(error)).toBe(platformDatabaseMessage(error))
  })
})
