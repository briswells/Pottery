import type { CollectionConfig } from 'payload'
import { isAdmin } from '../access/isAdmin'
import { isAdminOrEditor } from '../access/isAdminOrEditor'

/**
 * Membership plans. `square` plans mirror Square subscription plan variations
 * (kept in sync — their identifying fields are read-only here). `free` plans are
 * platform-only: assigning one creates a member with no Square subscription.
 */
export const MembershipPlans: CollectionConfig = {
  slug: 'membership-plans',
  admin: {
    group: 'Studio',
    useAsTitle: 'name',
    defaultColumns: ['name', 'kind', 'priceCents', 'cadence', 'active'],
  },
  access: {
    read: isAdminOrEditor,
    create: isAdminOrEditor,
    update: isAdminOrEditor,
    delete: isAdmin,
  },
  fields: [
    { name: 'name', type: 'text', required: true },
    {
      name: 'kind',
      type: 'select',
      required: true,
      defaultValue: 'square',
      options: [
        { label: 'Square (billed)', value: 'square' },
        { label: 'Free (no billing)', value: 'free' },
      ],
    },
    {
      name: 'squarePlanVariationId',
      type: 'text',
      index: true,
      admin: { readOnly: true, description: 'Synced from Square; empty for Free plans.' },
    },
    {
      name: 'priceCents',
      type: 'number',
      admin: {
        readOnly: true,
        description: 'Synced from Square.',
        components: { Cell: '/admin/PriceCell#PriceCell' },
      },
    },
    { name: 'cadence', type: 'text', admin: { readOnly: true, description: 'e.g. MONTHLY (synced).' } },
    {
      name: 'active',
      type: 'checkbox',
      defaultValue: true,
      admin: { description: 'Square plans removed from Square are set inactive by sync.' },
    },
  ],
}
