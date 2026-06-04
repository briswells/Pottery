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
  ],
}
