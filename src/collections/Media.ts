import type { CollectionConfig } from 'payload'
import { anyone } from '../access/anyone'
import { isAdminOrEditor } from '../access/isAdminOrEditor'

export const Media: CollectionConfig = {
  slug: 'media',
  access: {
    read: anyone,
    create: isAdminOrEditor,
    update: isAdminOrEditor,
    delete: isAdminOrEditor,
  },
  upload: {
    staticDir: 'media',
    imageSizes: [
      { name: 'card', width: 768, height: undefined },
      { name: 'hero', width: 1600, height: undefined },
    ],
    mimeTypes: ['image/*'],
  },
  fields: [
    { name: 'alt', type: 'text', required: true, admin: { description: 'Accessibility description' } },
  ],
}
