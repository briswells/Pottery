import type { CollectionConfig } from 'payload'
import { isAdmin } from '../access/isAdmin'
import { isAdminOrEditor } from '../access/isAdminOrEditor'

// Reusable location labels for shelves (e.g. "Back room", "Window wall").
export const ShelfTags: CollectionConfig = {
  slug: 'shelf-tags',
  labels: { singular: 'Shelf tag', plural: 'Shelf tags' },
  admin: { group: 'Studio', useAsTitle: 'name' },
  access: { read: isAdminOrEditor, create: isAdminOrEditor, update: isAdminOrEditor, delete: isAdmin },
  fields: [
    { name: 'name', type: 'text', required: true, unique: true },
  ],
}
