import { describe, it, expect } from 'vitest'
import { friendlyChargeError } from '../../src/lib/payments'

// Shapes mirror the Square SDK's thrown SquareError: decline details live in an
// `errors` array (sometimes only inside a JSON `body`), and `message` is the raw
// "Status code: 400 Body: {...}" dump that must NEVER reach a customer.
describe('friendlyChargeError', () => {
  it('maps a postal-code (AVS) decline', () => {
    const e = { message: 'Status code: 400 Body: {...}', errors: [{ code: 'ADDRESS_VERIFICATION_FAILURE' }] }
    expect(friendlyChargeError(e)).toMatch(/postal code/i)
  })

  it('maps a CVV decline', () => {
    const e = { errors: [{ code: 'CVV_FAILURE' }] }
    expect(friendlyChargeError(e)).toMatch(/security code/i)
  })

  it('finds the code inside a JSON body string', () => {
    const e = { body: JSON.stringify({ errors: [{ code: 'INSUFFICIENT_FUNDS' }] }) }
    expect(friendlyChargeError(e)).toMatch(/insufficient funds/i)
  })

  it('falls back to a generic decline message and never echoes the raw error', () => {
    const raw = 'Status code: 400 Body: {"payment":{"card_details":{"fingerprint":"sq-1-secret"}}}'
    const msg = friendlyChargeError({ message: raw })
    expect(msg).toMatch(/could not be processed|declined/i)
    expect(msg).not.toContain('Status code')
    expect(msg).not.toContain('fingerprint')
  })
})
