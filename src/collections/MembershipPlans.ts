import type { CollectionConfig } from 'payload'
import { isAdminOrEditor } from '../access/isAdminOrEditor'

/**
 * Membership plans — VIEW ONLY in the admin. `square` plans are synced from
 * Square (the catalog webhook + startup sync); the `free` platform plan is
 * created automatically on startup (ensureFreePlan). Staff don't create or edit
 * plans by hand, so create/update/delete are disabled — the sync/seed use
 * `overrideAccess` to write. Assigning a plan to a member is what drives Square.
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
    create: () => false,
    update: () => false,
    delete: () => false,
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
