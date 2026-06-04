import type { GlobalConfig } from 'payload'
import { anyone } from '../access/anyone'
import { isAdminOrEditor } from '../access/isAdminOrEditor'

export const HomePage: GlobalConfig = {
  slug: 'home-page',
  admin: { group: 'Pages' },
  access: { read: anyone, update: isAdminOrEditor },
  fields: [
    { name: 'heroKicker', type: 'text', defaultValue: "Vancouver's Community Pottery" },
    { name: 'heroHeadline', type: 'text', required: true, defaultValue: 'Where clay meets community' },
    { name: 'heroSubtext', type: 'textarea' },
    { name: 'heroImage', type: 'upload', relationTo: 'media' },
    { name: 'sections', type: 'array', maxRows: 6, labels: { singular: 'Section', plural: 'Sections' }, fields: [
      { name: 'heading', type: 'text', required: true },
      { name: 'body', type: 'textarea', required: true },
      { name: 'image', type: 'upload', relationTo: 'media' },
    ] },
    { name: 'gallery', type: 'upload', relationTo: 'media', hasMany: true },
  ],
}
