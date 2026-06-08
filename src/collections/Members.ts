import type { CollectionConfig } from 'payload'
import { isAdmin } from '../access/isAdmin'
import { isAdminOrEditor } from '../access/isAdminOrEditor'
import { cancelSquareSubscription } from '../hooks/cancelSquareSubscription'
import { provisionSquareSubscription } from '../hooks/provisionSquareSubscription'

export const Members: CollectionConfig = {
  slug: 'members',
  // No member login yet: disable the local (email/password) strategy so no password
  // is required and the login UI is hidden. enableFields keeps the email + auth
  // columns so the DB/types don't change (no migration). optionalPassword makes
  // password non-required. Re-enable a strategy later for a member portal.
  auth: { disableLocalStrategy: { enableFields: true, optionalPassword: true } },
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
  hooks: { afterChange: [provisionSquareSubscription, cancelSquareSubscription] },
  fields: [
    { name: 'name', type: 'text', required: true },
    // email is provided by the auth config (local login disabled — see `auth` above)
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
