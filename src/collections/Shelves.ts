import type { CollectionConfig, CollectionBeforeDeleteHook } from 'payload'
import { isAdmin } from '../access/isAdmin'
import { isAdminOrEditor } from '../access/isAdminOrEditor'

const clearMemberOnShelfDelete: CollectionBeforeDeleteHook = async ({ req, id }) => {
  await req.payload.update({
    collection: 'people', where: { shelf: { equals: id } },
    overrideAccess: true, context: { fromShelfSync: true }, data: { shelf: null },
    req,
  })
}

// A physical studio shelf. `assignedMember` is the occupancy source of truth,
// maintained by the People `syncShelfAssignment` hook — not edited directly.
// The "unassigned shelves" display is this list filtered to assignedMember empty.
export const Shelves: CollectionConfig = {
  slug: 'shelves',
  labels: { singular: 'Shelf', plural: 'Shelves' },
  admin: {
    group: 'Studio',
    useAsTitle: 'name',
    defaultColumns: ['name', 'tag', 'assignedMember'],
    description: 'Filter by "Assigned Member → exists: No" to see currently-unassigned shelves.',
  },
  access: { read: isAdminOrEditor, create: isAdminOrEditor, update: isAdminOrEditor, delete: isAdmin },
  hooks: { beforeDelete: [clearMemberOnShelfDelete] },
  fields: [
    { name: 'name', type: 'text', required: true, unique: true, admin: { description: 'Free-form shelf number/name, e.g. "B-12".' } },
    { name: 'tag', type: 'relationship', relationTo: 'shelf-tags', hasMany: false },
    {
      name: 'assignedMember', type: 'relationship', relationTo: 'people', hasMany: false,
      admin: { readOnly: true, description: 'Set automatically from the member\'s page.' },
    },
  ],
}
