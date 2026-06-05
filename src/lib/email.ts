import { Resend } from 'resend'

export interface EmailInput { to: string; subject: string; html: string }

export async function sendEmail({ to, subject, html }: EmailInput): Promise<void> {
  const resend = new Resend(process.env.RESEND_API_KEY)
  await resend.emails.send({ from: process.env.EMAIL_FROM!, to, subject, html })
}
