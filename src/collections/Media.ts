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
    // Cap the stored original at 2048px. Our largest derivative is 1600px, so
    // there's no reason to keep (or process) a 6000px camera original.
    resizeOptions: { width: 2048, height: undefined, withoutEnlargement: true },
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
