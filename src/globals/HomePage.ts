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
    {
      name: 'visitCardImage', type: 'upload', relationTo: 'media',
      label: '“Visit the studio” card image',
      admin: { description: 'Images for the three “What we offer” cards at the top of the homepage. Each card is independent — if left blank, it falls back to a story-section or gallery image.' },
    },
    { name: 'classCardImage', type: 'upload', relationTo: 'media', label: '“Take a class” card image' },
    { name: 'memberCardImage', type: 'upload', relationTo: 'media', label: '“Become a member” card image' },
    { name: 'sections', type: 'array', maxRows: 6, labels: { singular: 'Section', plural: 'Sections' }, fields: [
      { name: 'heading', type: 'text', required: true },
      { name: 'body', type: 'textarea', required: true },
      { name: 'image', type: 'upload', relationTo: 'media' },
    ] },
    // Retired: the gallery is now driven by the per-image “Include in gallery”
    // checkbox on Media. Kept (hidden) so existing data isn’t dropped; the
    // values were backfilled into that checkbox by migration.
    { name: 'gallery', type: 'upload', relationTo: 'media', hasMany: true, admin: { hidden: true } },
  ],
}
