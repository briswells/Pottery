import type { CollectionConfig } from 'payload'
import { isAdmin } from '../access/isAdmin'
import { isAdminOrEditor } from '../access/isAdminOrEditor'
import { sendFiringInvoice } from '../hooks/sendFiringInvoice'

export const FiringRequests: CollectionConfig = {
  slug: 'firing-requests',
  admin: {
    group: 'Studio',
    useAsTitle: 'name',
    defaultColumns: ['name', 'status', 'quotedPriceCents', 'invoicedAt', 'paidAt'],
  },
  access: {
    read: isAdminOrEditor,
    create: () => false, // created server-side via /api/firings (overrideAccess)
    update: isAdminOrEditor,
    delete: isAdmin,
  },
  hooks: {
    afterChange: [sendFiringInvoice],
  },
  fields: [
    { name: 'name', type: 'text', required: true },
    { name: 'email', type: 'email', required: true },
    { name: 'phone', type: 'text' },
    { name: 'description', type: 'textarea', required: true },
    { name: 'heightIn', type: 'number', admin: { description: 'Height in inches' } },
    { name: 'widthIn', type: 'number', admin: { description: 'Width in inches' } },
    { name: 'depthIn', type: 'number', admin: { description: 'Depth in inches' } },
    { name: 'quantity', type: 'number', defaultValue: 1, min: 1 },
    { name: 'photo', type: 'upload', relationTo: 'media' },
    { name: 'notes', type: 'textarea', admin: { description: 'Customer notes' } },
    {
      name: 'status', type: 'select', required: true, defaultValue: 'submitted',
      options: [
        { label: 'Submitted', value: 'submitted' },
        { label: 'Approved (send invoice)', value: 'approved' },
        { label: 'Invoiced', value: 'invoiced' },
        { label: 'Invoice failed', value: 'invoice_failed' },
        { label: 'Paid', value: 'paid' },
        { label: 'Completed', value: 'completed' },
        { label: 'Cancelled', value: 'cancelled' },
      ],
    },
    { name: 'quotedPriceCents', type: 'number', min: 0, admin: { description: 'Price in cents, set by staff (e.g. 4500 = $45.00). Set this, then status → Approved to send the invoice.' } },
    { name: 'adminNotes', type: 'textarea' },
    { name: 'squareCustomerId', type: 'text', admin: { readOnly: true } },
    { name: 'squareInvoiceId', type: 'text', index: true, admin: { readOnly: true } },
    { name: 'squareInvoiceUrl', type: 'text', admin: { readOnly: true } },
    { name: 'invoicedAt', type: 'date', admin: { readOnly: true } },
    { name: 'paidAt', type: 'date', admin: { readOnly: true } },
    { name: 'lastInvoiceError', type: 'text', admin: { readOnly: true } },
  ],
}
