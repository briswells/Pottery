import type { CollectionConfig } from 'payload'
import { isAdmin } from '../access/isAdmin'

export const Bookings: CollectionConfig = {
  slug: 'bookings',
  admin: { group: 'Commerce', useAsTitle: 'customerEmail', defaultColumns: ['customerName', 'class', 'status', 'amountCents'] },
  access: {
    read: isAdmin,
    create: () => false,   // created server-side only
    update: isAdmin,
    delete: isAdmin,
  },
  fields: [
    { name: 'class', type: 'relationship', relationTo: 'classes', required: true },
    { name: 'person', type: 'relationship', relationTo: 'people', hasMany: false, admin: { description: 'The person who made this booking.' } },
    { name: 'customerName', type: 'text', required: true },
    { name: 'customerEmail', type: 'email', required: true },
    { name: 'customerPhone', type: 'text' },
    { name: 'status', type: 'select', required: true, defaultValue: 'pending', options: [
      { label: 'Pending', value: 'pending' },
      { label: 'Paid', value: 'paid' },
      { label: 'Cancelled', value: 'cancelled' },
      { label: 'Refunded', value: 'refunded' },
    ] },
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
    { name: 'squarePaymentId', type: 'text', index: true },
  ],
}
