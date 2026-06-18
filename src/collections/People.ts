import type { CollectionConfig } from 'payload'
import { isAdmin } from '../access/isAdmin'
import { isAdminOrEditor } from '../access/isAdminOrEditor'
import { cancelSquareSubscription } from '../hooks/cancelSquareSubscription'
import { cancelSquareSubscriptionOnDelete } from '../hooks/cancelSquareSubscriptionOnDelete'
import { reconcileMemberSubscription } from '../hooks/reconcileMemberSubscription'
import { syncShelfAssignment } from '../hooks/syncShelfAssignment'

// One record per human. Everyone who interacts with the studio (class booking,
// firing request, membership) is a Person; "being a member" means having a `plan`.
// Still the auth collection (local strategy disabled — no member login yet).
export const People: CollectionConfig = {
  slug: 'people',
  labels: { singular: 'Person', plural: 'People' },
  auth: { disableLocalStrategy: { enableFields: true, optionalPassword: true } },
  admin: {
    group: 'People',
    useAsTitle: 'name',
    defaultColumns: ['name', 'plan', 'status', 'shelf', 'subscriptionStatus'],
  },
  access: {
    read: isAdminOrEditor,
    create: isAdminOrEditor,
    update: isAdminOrEditor,
    delete: isAdmin,
  },
  hooks: {
    afterChange: [reconcileMemberSubscription, cancelSquareSubscription, syncShelfAssignment],
    beforeDelete: [cancelSquareSubscriptionOnDelete],
  },
  fields: [
    { name: 'name', type: 'text', required: true },
    {
      name: 'plan',
      type: 'relationship',
      relationTo: 'membership-plans',
      hasMany: false,
      admin: { description: 'Assign a plan to make this person a member; leave empty for a non-member contact.' },
    },
    // email is provided by the auth config (local login disabled — see `auth` above)
    { name: 'phone', type: 'text' },
    {
      name: 'status',
      type: 'select',
      required: true,
      defaultValue: 'none',
      label: 'Membership status',
      admin: { condition: (data) => Boolean(data?.plan) },
      options: [
        { label: 'Not a member', value: 'none' },
        { label: 'Active', value: 'active' },
        { label: 'Past due', value: 'past_due' },
        { label: 'Paused', value: 'paused' },
        { label: 'Cancelled', value: 'cancelled' },
      ],
    },
    { name: 'joinedDate', type: 'date' },
    {
      name: 'shelf', type: 'relationship', relationTo: 'shelves', hasMany: false,
      admin: { condition: (data) => Boolean(data?.plan) },
      filterOptions: ({ id }) => {
        const clauses: Record<string, unknown>[] = [{ assignedMember: { exists: false } }]
        if (id) clauses.push({ assignedMember: { equals: id } })
        return { or: clauses }
      },
    },
    { name: 'notes', type: 'textarea' },
    // Square linkage
    { name: 'squareCustomerId', type: 'text', index: true, admin: { readOnly: true } },
    { name: 'squareSubscriptionId', type: 'text', index: true, admin: { readOnly: true, condition: (data) => Boolean(data?.plan) } },
    { name: 'subscriptionStatus', type: 'text', admin: { readOnly: true, condition: (data) => Boolean(data?.plan) } },
    { name: 'lastPaymentDate', type: 'date', admin: { readOnly: true, condition: (data) => Boolean(data?.plan) } },
    { name: 'lastPaymentStatus', type: 'text', admin: { readOnly: true, condition: (data) => Boolean(data?.plan) } },
    // Internal: single-use, expiring token for passwordless self-serve cancellation.
    { name: 'cancelTokenHash', type: 'text', admin: { hidden: true } },
    { name: 'cancelTokenExpiresAt', type: 'date', admin: { hidden: true } },
  ],
}
