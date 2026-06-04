import type { CollectionConfig } from 'payload'
import { anyone } from '../access/anyone'
import { isAdminOrEditor } from '../access/isAdminOrEditor'
import { slugifyFromTitle } from '../hooks/slugify'

export const Classes: CollectionConfig = {
  slug: 'classes',
  admin: { useAsTitle: 'title', group: 'Studio', defaultColumns: ['title', 'category', 'startDate', 'status'] },
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
    {
      name: 'category', type: 'select', required: true,
      options: [
        { label: 'Wheel-throwing series', value: 'wheel-series' },
        { label: 'Day camp', value: 'day-camp' },
        { label: 'Raku', value: 'raku' },
        { label: 'Daytime multi-week', value: 'daytime-multiweek' },
      ],
    },
    { name: 'skillLevel', type: 'text' },
    { name: 'description', type: 'textarea' },
    { name: 'image', type: 'upload', relationTo: 'media' },
    { name: 'priceCents', type: 'number', required: true, min: 0, admin: { description: 'Price in cents, e.g. 22000 = $220.00' } },
    { name: 'capacity', type: 'number', required: true, min: 1 },
    { name: 'startDate', type: 'date' },
    { name: 'scheduleText', type: 'text', required: true, admin: { description: 'e.g. "Tuesdays 6–8pm for 6 weeks"' } },
    { name: 'instructor', type: 'relationship', relationTo: 'users' },
    {
      name: 'status', type: 'select', defaultValue: 'active',
      options: [{ label: 'Active', value: 'active' }, { label: 'Archived', value: 'archived' }],
      admin: { position: 'sidebar' },
    },
  ],
}
