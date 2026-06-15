import type { CollectionConfig } from 'payload'
import { anyone } from '../access/anyone'
import { isAdminOrEditor } from '../access/isAdminOrEditor'
import { slugifyFromTitle } from '../hooks/slugify'

export const Classes: CollectionConfig = {
  slug: 'classes',
  admin: { useAsTitle: 'title', group: 'Studio', defaultColumns: ['title', 'status'] },
  access: {
    read: anyone,
    create: isAdminOrEditor,
    update: isAdminOrEditor,
    delete: isAdminOrEditor,
  },
  fields: [
    { name: 'title', type: 'text', required: true },
    {
      name: 'slug', type: 'text', unique: true, index: true,
      admin: { position: 'sidebar', description: 'Auto-filled from title; edit to override' },
      hooks: { beforeValidate: [slugifyFromTitle] },
    },
    { name: 'skillLevel', type: 'text' },
    { name: 'description', type: 'textarea' },
    { name: 'image', type: 'upload', relationTo: 'media', admin: { description: 'Title image; default for all instances' } },
    {
      name: 'defaultPriceCents',
      type: 'number',
      required: true,
      min: 0,
      label: 'Default price',
      admin: {
        description: 'Price in dollars, e.g. 220 for $220.00. Instances inherit this unless overridden.',
        components: {
          Field: '/admin/PriceField#PriceField',
          Cell: '/admin/PriceCell#PriceCell',
        },
      },
    },
    { name: 'defaultCapacity', type: 'number', required: true, min: 1, admin: { description: 'Instances inherit this unless overridden.' } },
    {
      name: 'status', type: 'select', defaultValue: 'active',
      options: [{ label: 'Active', value: 'active' }, { label: 'Archived', value: 'archived' }],
      admin: { position: 'sidebar' },
    },
  ],
}
