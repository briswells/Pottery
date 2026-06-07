'use client'
import { useEffect, useState } from 'react'

export function WalletButtons({
  payments,
  priceCents,
  referenceId,
  disabled,
  onToken,
  onError,
}: {
  payments: any
  priceCents: number
  referenceId: string
  disabled?: boolean
  onToken: (sourceId: string) => void | Promise<void>
  onError: (msg: string) => void
}) {
  const [shown, setShown] = useState({ apple: false, google: false, cashapp: false })

  useEffect(() => {
    let cancelled = false
    const cleanups: Array<() => void> = []

    const makeRequest = () =>
      payments.paymentRequest({
        countryCode: 'US',
        currencyCode: 'USD',
        total: { amount: (priceCents / 100).toFixed(2), label: 'Portside Pottery' },
      })

    async function initApplePay() {
      try {
        // Apple Pay is NOT attached: we render a pre-styled #apple-pay-button div
        // (see the -apple-pay-button CSS) and call tokenize() on click. Google Pay
        // and Cash App Pay, by contrast, render their own button via .attach().
        const applePay = await payments.applePay(makeRequest())
        if (cancelled) return
        const btn = document.getElementById('apple-pay-button')
        if (!btn) return
        const handler = async (e: Event) => {
          e.preventDefault()
          try {
            const result = await applePay.tokenize()
            if (result.status === 'OK') await onToken(result.token)
            else onError('Apple Pay was not completed.')
          } catch {
            onError('Apple Pay was not completed.')
          }
        }
        btn.addEventListener('click', handler)
        cleanups.push(() => btn.removeEventListener('click', handler))
        setShown((s) => ({ ...s, apple: true }))
      } catch {
        /* Apple Pay unsupported (non-Safari/device/account) — skip its button. */
      }
    }

    async function initGooglePay() {
      try {
        const googlePay = await payments.googlePay(makeRequest())
        if (cancelled) return
        // buttonSizeMode 'fill' stretches the button to its container width so it
        // lines up with Apple Pay / Cash App Pay instead of sizing to its label.
        await googlePay.attach('#google-pay-button', { buttonSizeMode: 'fill' })
        const btn = document.getElementById('google-pay-button')
        const handler = async (e: Event) => {
          e.preventDefault()
          try {
            const result = await googlePay.tokenize()
            if (result.status === 'OK') await onToken(result.token)
            else onError('Google Pay was not completed.')
          } catch {
            onError('Google Pay was not completed.')
          }
        }
        btn?.addEventListener('click', handler)
        cleanups.push(() => {
          btn?.removeEventListener('click', handler)
          googlePay.destroy?.()
        })
        setShown((s) => ({ ...s, google: true }))
      } catch {
        /* Google Pay unsupported — skip. */
      }
    }

    async function initCashAppPay() {
      try {
        const cashAppPay = await payments.cashAppPay(makeRequest(), {
          redirectURL: window.location.href,
          referenceId,
        })
        if (cancelled) {
          cashAppPay.destroy?.()
          return
        }
        const listener = (event: any) => {
          const tr = event?.detail?.tokenResult
          if (tr?.status === 'OK') void onToken(tr.token)
          else onError('Cash App Pay was not completed.')
        }
        cashAppPay.addEventListener('ontokenization', listener)
        // width 'full' + semiround corners makes it match the full-width,
        // rounded-rectangle shape of the Apple Pay / Google Pay buttons.
        await cashAppPay.attach('#cash-app-pay', { shape: 'semiround', width: 'full' })
        cleanups.push(() => cashAppPay.destroy?.())
        setShown((s) => ({ ...s, cashapp: true }))
      } catch {
        /* Cash App Pay unsupported — skip. */
      }
    }

    void initApplePay()
    void initGooglePay()
    void initCashAppPay()

    return () => {
      cancelled = true
      cleanups.forEach((fn) => fn())
    }
  }, [payments, priceCents, referenceId, onToken, onError])

  return (
    <div
      style={{
        display: 'grid',
        gap: 8,
        // While a booking is in flight, dim + block the wallets so a second tap
        // can't start another charge (completeBooking also guards this centrally).
        opacity: disabled ? 0.5 : 1,
        pointerEvents: disabled ? 'none' : 'auto',
      }}
    >
      <div id="apple-pay-button" style={{ display: shown.apple ? 'block' : 'none' }} />
      <div id="google-pay-button" style={{ display: shown.google ? 'block' : 'none' }} />
      <div id="cash-app-pay" style={{ display: shown.cashapp ? 'block' : 'none' }} />
    </div>
  )
}
