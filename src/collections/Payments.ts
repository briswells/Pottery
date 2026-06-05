import type { CollectionConfig } from 'payload'
import { isAdmin } from '../access/isAdmin'

export const Payments: CollectionConfig = {
  slug: 'payments',
  admin: { group: 'Commerce', defaultColumns: ['type', 'amountCents', 'status', 'paidAt'], useAsTitle: 'squareId' },
  access: {
    read: isAdmin,
    create: () => false,   // only created server-side via local API (overrideAccess)
    update: () => false,
    delete: isAdmin,
  },
  fields: [
    { name: 'type', type: 'select', required: true, options: [
      { label: 'Booking', value: 'booking' },
      { label: 'Membership', value: 'membership' },
    ] },
    { name: 'booking', type: 'relationship', relationTo: 'bookings' },
    { name: 'amountCents', type: 'number', required: true },
    { name: 'squareId', type: 'text', required: true, index: true, admin: { description: 'Square payment or invoice id' } },
    { name: 'status', type: 'text', required: true },
    { name: 'paidAt', type: 'date' },
  ],
}
