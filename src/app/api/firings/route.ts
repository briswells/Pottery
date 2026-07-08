import { getPayload } from 'payload'
import config from '@payload-config'
import { createPaidFiring } from '../../../services/firing'
import { chargeCard } from '../../../lib/payments'
import { sendEmail } from '../../../lib/email'
import { MAX_FIRING_PHOTOS, MAX_HALF_SHELVES, MAX_PHOTO_BYTES } from '../../../lib/firing-pricing'

function num(v: FormDataEntryValue | null): number | undefined {
  if (v == null || v === '') return undefined
  const n = Number(v)
  return Number.isFinite(n) ? n : undefined
}

export async function POST(req: Request) {
  // NOTE: this is a public, unauthenticated endpoint. We cap each photo at 10 MB
  // below, but req.formData() buffers the whole body first; rely on the host/proxy
  // request-size limit as the outer guard (add one explicitly if abuse appears).
  let form: FormData
  try {
    form = await req.formData()
  } catch {
    return Response.json({ error: 'Invalid form submission' }, { status: 400 })
  }

  const customerName = String(form.get('name') ?? '').trim()
  const customerEmail = String(form.get('email') ?? '').trim()
  const description = String(form.get('description') ?? '').trim()
  if (!customerName || !customerEmail || !description) {
    return Response.json({ error: 'Please provide your name, email, and a description.' }, { status: 400 })
  }
  const customerPhone = String(form.get('phone') ?? '').trim() || undefined
  const notes = String(form.get('notes') ?? '').trim() || undefined
  const halfShelves = num(form.get('halfShelves'))
  if (!Number.isInteger(halfShelves) || (halfShelves as number) < 1 || (halfShelves as number) > MAX_HALF_SHELVES) {
    return Response.json({ error: 'Choose between 1 and 8 half shelves' }, { status: 400 })
  }
  const stonewareConfirmed = String(form.get('stonewareConfirmed') ?? '') === 'true'
  const couponCode = String(form.get('couponCode') ?? '').trim() || undefined
  const sourceId = String(form.get('sourceId') ?? '').trim() || undefined

  const files = form.getAll('photos').filter((f): f is File => typeof f !== 'string' && f.size > 0)
  if (files.length < 1 || files.length > MAX_FIRING_PHOTOS) {
    return Response.json({ error: 'Please attach between 1 and 5 photos' }, { status: 400 })
  }
  for (const file of files) {
    if (!file.type.startsWith('image/')) {
      return Response.json({ error: 'Photos must be images.' }, { status: 400 })
    }
    if (file.size > MAX_PHOTO_BYTES) {
      return Response.json({ error: 'Each photo must be 10 MB or smaller.' }, { status: 400 })
    }
  }

  const payload = await getPayload({ config: await config })

  const photoIds: number[] = []
  try {
    for (const file of files) {
      const buffer = Buffer.from(await file.arrayBuffer())
      const media = await payload.create({
        collection: 'media',
        overrideAccess: true,
        data: { alt: `Firing request photo from ${customerName}` },
        file: { data: buffer, mimetype: file.type, name: file.name || 'firing-photo', size: file.size },
      })
      photoIds.push(media.id)
    }
  } catch (e) {
    for (const id of photoIds) {
      try { await payload.delete({ collection: 'media', id, overrideAccess: true }) } catch { /* best effort */ }
    }
    console.error('Firing photo upload failed:', e)
    return Response.json({ error: 'Could not upload your photos. Please try again.' }, { status: 500 })
  }

  try {
    const firing = await createPaidFiring(
      { payload, charge: chargeCard, sendEmail },
      {
        halfShelves: halfShelves as number,
        photoIds,
        sourceId,
        couponCode,
        customerName,
        customerEmail,
        customerPhone,
        description,
        notes,
        stonewareConfirmed,
      },
    )
    return Response.json({ ok: true, requestId: firing.id })
  } catch (e: any) {
    // Don't leave the just-uploaded photos orphaned if the paid request fails.
    for (const id of photoIds) {
      try { await payload.delete({ collection: 'media', id, overrideAccess: true }) } catch { /* best effort */ }
    }
    return Response.json({ error: e?.message ?? 'Firing request failed' }, { status: 402 })
  }
}
