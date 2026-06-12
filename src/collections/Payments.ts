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
      { label: 'Firing', value: 'firing' },
    ] },
    { name: 'member', type: 'relationship', relationTo: 'people', admin: { description: 'Set for membership payments' } },
    { name: 'booking', type: 'relationship', relationTo: 'bookings', admin: { description: 'Set for class booking payments' } },
    { name: 'firingRequest', type: 'relationship', relationTo: 'firing-requests', admin: { description: 'Set for firing payments' } },
    {
      name: 'amountCents',
      type: 'number',
      required: true,
      label: 'Amount',
      admin: {
        components: {
          Field: '/admin/PriceField#PriceField',
          Cell: '/admin/PriceCell#PriceCell',
        },
      },
    },
    { name: 'squareId', type: 'text', required: true, index: true, admin: { description: 'Square payment or invoice id' } },
    { name: 'status', type: 'text', required: true, admin: { description: 'Mirrors the raw Square payment/invoice status (e.g. COMPLETED).' } },
    { name: 'paidAt', type: 'date' },
  ],
}
