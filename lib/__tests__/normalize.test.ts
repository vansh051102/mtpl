import { normalizeEmail, normalizePhone } from '../normalize'

describe('normalizeEmail', () => {
  it('lowercases and trims', () => {
    expect(normalizeEmail('  John.Doe@Example.COM ')).toBe('john.doe@example.com')
  })
  it('handles null/undefined', () => {
    expect(normalizeEmail(null)).toBe('')
    expect(normalizeEmail(undefined)).toBe('')
  })
})

describe('normalizePhone', () => {
  it('parses a valid Indian landline to E.164', () => {
    expect(normalizePhone(' (022) 4567-8900 ')).toBe('+912245678900')
  })
  it('assumes India as the default region for a bare mobile number', () => {
    expect(normalizePhone('9876543210')).toBe('+919876543210')
    expect(normalizePhone('09876543210')).toBe('+919876543210')
  })
  it('keeps an explicit country code', () => {
    expect(normalizePhone('+91 98765 43210')).toBe('+919876543210')
    expect(normalizePhone('+1 202-555-0173')).toBe('+12025550173')
  })
  it('a bare mobile number and its +91-prefixed form dedupe equal', () => {
    expect(normalizePhone('9876543210')).toBe(normalizePhone('+91 98765 43210'))
  })
  it('two formats of the same number collapse equal', () => {
    expect(normalizePhone('+91-98765-43210')).toBe(normalizePhone('+91 98765 43210'))
  })
  it('falls back to stripped digits when unparseable as a phone number', () => {
    expect(normalizePhone('12345')).toBe('12345')
  })
  it('handles empty', () => {
    expect(normalizePhone('')).toBe('')
    expect(normalizePhone(null)).toBe('')
  })
})
