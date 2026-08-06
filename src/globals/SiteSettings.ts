import type { GlobalConfig } from 'payload'
import { anyone } from '../access/anyone'
import { isAdminOrEditor } from '../access/isAdminOrEditor'

export const SiteSettings: GlobalConfig = {
  slug: 'site-settings',
  admin: { group: 'Settings' },
  access: { read: anyone, update: isAdminOrEditor },
  fields: [
    { name: 'studioName', type: 'text', required: true, defaultValue: 'Portside Pottery' },
    { name: 'phone', type: 'text' },
    { name: 'email', type: 'email' },
    { name: 'addressLine', type: 'text' },
    { name: 'hours', type: 'array', fields: [
      { name: 'days', type: 'text' },
      { name: 'time', type: 'text' },
    ] },
    { name: 'socials', type: 'array', fields: [
      { name: 'platform', type: 'text' },
      { name: 'url', type: 'text' },
    ] },
    { name: 'logo', type: 'upload', relationTo: 'media' },
    {
      name: 'favicon', type: 'upload', relationTo: 'media',
      admin: { description: 'Browser tab icon for the public site. Use a square image — a .png, .svg, or .ico works best.' },
    },
    {
      name: 'newsletterInNav', type: 'checkbox', defaultValue: false,
      admin: {
        position: 'sidebar',
        description: 'Show “Newsletter” in the site menu.',
      },
    },
  ],
}
