import type { CollectionConfig } from 'payload'
import { isAdmin } from '../access/isAdmin'
import { isAdminOrEditor } from '../access/isAdminOrEditor'
import { uniqueNameValidate } from '../lib/uniqueName'
import { naturalSortKey } from '../lib/naturalSort'

// A physical studio shelf. `assignedMember` is the occupancy source of truth,
// maintained by the People `syncShelfAssignment` hook — not edited directly.
// The "unassigned shelves" display is this list filtered to assignedMember empty.
export const Shelves: CollectionConfig = {
  slug: 'shelves',
  labels: { singular: 'Shelf', plural: 'Shelves' },
  // Order lists by the natural-sort key so "1, 2, 10, B-12" sorts correctly
  // (numbers numerically and ahead of letters) instead of lexicographically.
  defaultSort: 'sortKey',
  admin: {
    group: 'Studio',
    useAsTitle: 'name',
    defaultColumns: ['name', 'tag', 'assignedMember'],
    description: 'Filter by "Assigned Member → exists: No" to see currently-unassigned shelves.',
  },
  access: { read: isAdminOrEditor, create: isAdminOrEditor, update: isAdminOrEditor, delete: isAdmin },
  fields: [
    {
      name: 'name', type: 'text', required: true, unique: true,
      admin: { description: 'Free-form shelf number/name, e.g. "B-12".' },
      validate: uniqueNameValidate('shelves', 'shelf'),
    },
    { name: 'tag', type: 'relationship', relationTo: 'shelf-tags', hasMany: false },
    {
      name: 'assignedMember', type: 'relationship', relationTo: 'people', hasMany: false,
      admin: { readOnly: true, description: 'Set automatically from the member\'s page.' },
    },
    // Derived natural-sort key; hidden from editors, kept in sync from `name`.
    {
      name: 'sortKey', type: 'text', index: true,
      admin: { hidden: true, readOnly: true },
      hooks: {
        beforeChange: [({ siblingData }) => naturalSortKey(String(siblingData?.name ?? ''))],
      },
    },
  ],
}
