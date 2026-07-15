'use client'

import { useState } from 'react'
import { Button, toast, useDocumentInfo, useFormFields, useFormModified } from '@payloadcms/ui'

/**
 * Sidebar panel on the newsletter edit view: "Send test to me" (Resend to the
 * logged-in admin) and "Send to subscribers" (Kit broadcast, confirm dialog
 * with the live subscriber count). Buttons hit the collection's custom
 * endpoints; the page reloads after a real send so the sent-lock shows.
 */
export default function NewsletterSend() {
  const { id } = useDocumentInfo()
  const modified = useFormModified()
  const status = useFormFields(([fields]) => fields?.status?.value as string | undefined)
  const subject = useFormFields(([fields]) => fields?.subject?.value as string | undefined)
  const sentAt = useFormFields(([fields]) => fields?.sentAt?.value as string | undefined)
  const recipientCount = useFormFields(([fields]) => fields?.recipientCount?.value as number | undefined)
  const [busy, setBusy] = useState(false)

  if (!id) {
    return <p style={{ fontSize: 13, color: 'var(--theme-elevation-500)' }}>Save the draft first to enable sending.</p>
  }

  if (status === 'sent') {
    const when = sentAt ? new Date(sentAt).toLocaleString() : 'earlier'
    return (
      <p style={{ fontSize: 13, color: 'var(--theme-elevation-500)' }}>
        Sent {when}
        {typeof recipientCount === 'number' ? ` to ${recipientCount} subscriber${recipientCount === 1 ? '' : 's'}` : ''}.
      </p>
    )
  }

  const saved = (): boolean => {
    if (modified) {
      toast.error('You have unsaved changes — save first so what you send is what you see.')
      return false
    }
    return true
  }

  const sendTest = async () => {
    if (!saved()) return
    setBusy(true)
    try {
      const res = await fetch(`/api/newsletters/${id}/test`, { method: 'POST' })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? 'Test send failed.')
      toast.success('Test email sent to your inbox.')
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Test send failed.')
    }
    setBusy(false)
  }

  const send = async () => {
    if (!saved()) return
    setBusy(true)
    try {
      const countRes = await fetch('/api/newsletters/subscriber-count')
      const countData = await countRes.json().catch(() => ({}))
      const total: number | null = countRes.ok ? (countData.total ?? null) : null
      const who = total == null ? 'all subscribers' : `${total} subscriber${total === 1 ? '' : 's'}`
      if (!window.confirm(`Send “${subject ?? 'this newsletter'}” to ${who}? This cannot be undone.`)) {
        setBusy(false)
        return
      }
      const res = await fetch(`/api/newsletters/${id}/send`, { method: 'POST' })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? 'Send failed.')
      toast.success('Newsletter sent!')
      window.location.reload()
      return
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Send failed.')
    }
    setBusy(false)
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 16 }}>
      <Button buttonStyle="secondary" size="small" onClick={sendTest} disabled={busy}>
        Send test to me
      </Button>
      <Button size="small" onClick={send} disabled={busy}>
        Send to subscribers
      </Button>
    </div>
  )
}
