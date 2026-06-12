'use client'
import { useState } from 'react'

export function ConfirmCancelButton({ token }: { token: string }) {
  const [state, setState] = useState<'idle' | 'busy' | 'done' | 'error'>('idle')

  async function cancel() {
    setState('busy')
    try {
      const res = await fetch('/api/membership/cancel/confirm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token }),
      })
      const data = await res.json()
      setState(data.ok ? 'done' : 'error')
    } catch {
      setState('error')
    }
  }

  if (state === 'done')
    return <p style={{ marginTop: 16 }}>Your membership has been cancelled, effective at the end of your current billing period.</p>
  if (state === 'error')
    return <p style={{ marginTop: 16 }}>That link is no longer valid. Please request a new one.</p>

  return (
    <button className="pp-btn" onClick={cancel} disabled={state === 'busy'} style={{ marginTop: 16 }}>
      {state === 'busy' ? 'Cancelling…' : 'Yes, cancel my membership'}
    </button>
  )
}
