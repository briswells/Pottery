import { Resend } from 'resend'

export interface EmailInput { to: string; subject: string; html: string }

let resend: Resend | null = null
function getResend(): Resend {
  if (!resend) resend = new Resend(process.env.RESEND_API_KEY)
  return resend
}

export async function sendEmail({ to, subject, html }: EmailInput): Promise<void> {
  // Resend resolves with { data, error } instead of throwing on API errors,
  // so surface a failure explicitly rather than reporting a false success.
  const { error } = await getResend().emails.send({ from: process.env.EMAIL_FROM!, to, subject, html })
  if (error) throw new Error(`Email send failed: ${error.message}`)
}
