import { describe, expect, it } from 'vitest'
import { isValidResourceName } from '../validation.js'

describe('PostgREST resource-name validation', () => {
  it('does not reject names that require PostgreSQL identifier quoting', () => {
    expect(isValidResourceName('invoice-items')).toBe(true)
    expect(isValidResourceName('Order Items')).toBe(true)
    expect(isValidResourceName('München')).toBe(true)
  })

  it('rejects empty and whitespace-only resource names', () => {
    expect(isValidResourceName('')).toBe(false)
    expect(isValidResourceName('   ')).toBe(false)
  })

  it('rejects NUL-containing names', () => {
    expect(isValidResourceName('users\0archive')).toBe(false)
  })
})
