import type { CollectionConfig } from 'payload'
import { isAdmin } from '../access/isAdmin'
import { isAdminOrEditor } from '../access/isAdminOrEditor'

export const Members: CollectionConfig = {
  slug: 'members',
  auth: true, // foundation for the future member portal; staff-managed for now
  admin: {
    group: 'People',
    useAsTitle: 'name',
    defaultColumns: ['name', 'status', 'shelfLabel', 'subscriptionStatus', 'lastPaymentDate'],
  },
  access: {
    read: isAdminOrEditor,
    create: isAdminOrEditor,
    update: isAdminOrEditor,
    delete: isAdmin,
  },
  fields: [
    { name: 'name', type: 'text', required: true },
    // email/password are provided by `auth: true`
    { name: 'phone', type: 'text' },
    { name: 'status', type: 'select', required: true, defaultValue: 'active', options: [
      { label: 'Active', value: 'active' },
      { label: 'Past due', value: 'past_due' },
      { label: 'Paused', value: 'paused' },
      { label: 'Cancelled', value: 'cancelled' },
    ] },
    { name: 'joinedDate', type: 'date' },
    { name: 'shelfLabel', type: 'text', admin: { description: 'e.g. "Shelf B-12"' } },
    { name: 'notes', type: 'textarea' },
    // Square linkage
    { name: 'squareCustomerId', type: 'text', index: true, admin: { readOnly: true } },
    { name: 'squareSubscriptionId', type: 'text', index: true, admin: { readOnly: true } },
    { name: 'subscriptionStatus', type: 'text', admin: { readOnly: true } },
    { name: 'lastPaymentDate', type: 'date', admin: { readOnly: true } },
    { name: 'lastPaymentStatus', type: 'text', admin: { readOnly: true } },
  ],
}
