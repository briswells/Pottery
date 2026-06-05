import { getPayload } from 'payload'
import config from '@payload-config'
import { sendEmail } from '../../../lib/email'

const MAX_PHOTO_BYTES = 10 * 1024 * 1024 // 10 MB

function num(v: FormDataEntryValue | null): number | undefined {
  if (v == null || v === '') return undefined
  const n = Number(v)
  return Number.isFinite(n) ? n : undefined
}

export async function POST(req: Request) {
  // NOTE: this is a public, unauthenticated endpoint. We cap the photo at 10 MB
  // below, but req.formData() buffers the whole body first; rely on the host/proxy
  // request-size limit as the outer guard (add one explicitly if abuse appears).
  let form: FormData
  try {
    form = await req.formData()
  } catch {
    return Response.json({ error: 'Invalid form submission' }, { status: 400 })
  }

  const name = String(form.get('name') ?? '').trim()
  const email = String(form.get('email') ?? '').trim()
  const description = String(form.get('description') ?? '').trim()
  if (!name || !email || !description) {
    return Response.json({ error: 'Please provide your name, email, and a description.' }, { status: 400 })
  }
  const phone = String(form.get('phone') ?? '').trim() || undefined
  const notes = String(form.get('notes') ?? '').trim() || undefined

  const payload = await getPayload({ config: await config })

  let photoId: number | undefined
  const file = form.get('photo')
  if (file && typeof file !== 'string' && file.size > 0) {
    if (!file.type.startsWith('image/')) {
      return Response.json({ error: 'Photo must be an image.' }, { status: 400 })
    }
    if (file.size > MAX_PHOTO_BYTES) {
      return Response.json({ error: 'Photo must be 10 MB or smaller.' }, { status: 400 })
    }
    const buffer = Buffer.from(await file.arrayBuffer())
    const media = await payload.create({
      collection: 'media',
      overrideAccess: true,
      data: { alt: `Firing request photo from ${name}` },
      file: { data: buffer, mimetype: file.type, name: file.name || 'firing-photo', size: file.size },
    })
    photoId = media.id
  }

  let request
  try {
    request = await payload.create({
      collection: 'firing-requests',
      overrideAccess: true,
      data: {
        name, email, phone, description, notes,
        heightIn: num(form.get('heightIn')),
        widthIn: num(form.get('widthIn')),
        depthIn: num(form.get('depthIn')),
        quantity: num(form.get('quantity')) ?? 1,
        photo: photoId,
        status: 'submitted',
      },
    })
  } catch (e) {
    // Don't leave the just-uploaded photo orphaned if the request fails to save.
    if (photoId) {
      try { await payload.delete({ collection: 'media', id: photoId, overrideAccess: true }) } catch { /* best effort */ }
    }
    console.error('Firing request create failed:', e)
    return Response.json({ error: 'Could not save your request. Please try again.' }, { status: 500 })
  }

  const dims = [num(form.get('heightIn')), num(form.get('widthIn')), num(form.get('depthIn'))]
    .map((d) => (d == null ? '?' : d)).join(' × ')
  try {
    await sendEmail({
      to: email,
      subject: 'We received your Cone 10 firing request',
      html: `<p>Thanks, ${name}! We received your firing request and will review the size, then email you a Square invoice with the price. You're not charged anything yet.</p>`,
    })
  } catch (e) { console.error('Firing confirmation email failed:', e) }
  try {
    if (process.env.STAFF_NOTIFY_EMAIL) {
      await sendEmail({
        to: process.env.STAFF_NOTIFY_EMAIL,
        subject: `New Cone 10 firing request from ${name}`,
        html: `<p>${name} (${email}${phone ? `, ${phone}` : ''}) requested a firing.</p>
<p><strong>Piece:</strong> ${description}<br/><strong>Size (in):</strong> ${dims}, qty ${num(form.get('quantity')) ?? 1}</p>
<p>Review it in the admin and set a price, then mark it Approved to send the invoice.</p>`,
      })
    }
  } catch (e) { console.error('Firing staff-notify email failed:', e) }

  return Response.json({ ok: true, requestId: request.id })
}
