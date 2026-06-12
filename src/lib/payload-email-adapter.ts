import type { EmailAdapter, SendEmailOptions } from 'payload'
import type { CreateEmailOptions } from 'resend'
import { getResend } from './email'

export interface ResendAdapterOptions {
  defaultFromAddress: string
  defaultFromName: string
}

/** Minimal structural form of nodemailer's Address (avoids a deep type import). */
type MailAddress = { name?: string; address: string }

/** Format a single sender/recipient (string or Address object) for Resend. */
function formatAddress(value: string | MailAddress | undefined): string | undefined {
  if (!value) return undefined
  if (typeof value === 'string') return value
  return value.name ? `${value.name} <${value.address}>` : value.address
}

/** Normalize nodemailer-style to/cc/bcc (string | Address | array) to a string list. */
function formatList(value: SendEmailOptions['to'] | SendEmailOptions['cc']): string[] | undefined {
  if (!value) return undefined
  const arr = Array.isArray(value) ? value : [value]
  const out = arr.map((v) => formatAddress(v as string | MailAddress)).filter((v): v is string => Boolean(v))
  return out.length ? out : undefined
}

/**
 * Payload email adapter that delegates to the app's shared Resend client
 * (src/lib/email.ts), so Payload's transactional mail — admin forgot-password,
 * email verification — goes through the same provider as the rest of the app.
 * `from` falls back to the configured default when Payload doesn't supply one.
 */
export const resendEmailAdapter =
  (opts: ResendAdapterOptions): EmailAdapter =>
  () => ({
    name: 'resend',
    defaultFromName: opts.defaultFromName,
    defaultFromAddress: opts.defaultFromAddress,
    async sendEmail(message) {
      const from = formatAddress(message.from) ?? `${opts.defaultFromName} <${opts.defaultFromAddress}>`
      const html = message.html != null ? String(message.html) : undefined
      const text = message.text != null ? String(message.text) : undefined
      const payload = {
        from,
        to: formatList(message.to) ?? [],
        subject: message.subject ?? '',
        ...(html ? { html } : {}),
        ...(text ? { text } : {}),
        ...(formatList(message.cc) ? { cc: formatList(message.cc) } : {}),
        ...(formatList(message.bcc) ? { bcc: formatList(message.bcc) } : {}),
        ...(formatList(message.replyTo) ? { replyTo: formatList(message.replyTo) } : {}),
      } as CreateEmailOptions
      // Resend resolves with { data, error } instead of throwing on API errors.
      const { data, error } = await getResend().emails.send(payload)
      if (error) throw new Error(`Payload email send failed: ${error.message}`)
      return data
    },
  })

/** Split an EMAIL_FROM value ("Name <addr>" or "addr") into name + address parts. */
export function parseFromAddress(raw: string | undefined): { defaultFromName: string; defaultFromAddress: string } {
  const fallbackName = 'Portside Pottery'
  const value = (raw ?? '').trim()
  const match = value.match(/^\s*(.*?)\s*<\s*([^>]+)\s*>\s*$/)
  if (match) return { defaultFromName: match[1] || fallbackName, defaultFromAddress: match[2] }
  return { defaultFromName: fallbackName, defaultFromAddress: value }
}
