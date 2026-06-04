import type { GlobalConfig } from 'payload'
import { anyone } from '../access/anyone'
import { isAdminOrEditor } from '../access/isAdminOrEditor'

export const MembershipPage: GlobalConfig = {
  slug: 'membership-page',
  admin: { group: 'Pages' },
  access: { read: anyone, update: isAdminOrEditor },
  fields: [
    { name: 'headline', type: 'text', required: true, defaultValue: 'Become a member at Portside Pottery' },
    { name: 'intro', type: 'textarea' },
    { name: 'priceLabel', type: 'text', required: true, defaultValue: '$200 / month' },
    { name: 'benefits', type: 'array', fields: [
      { name: 'item', type: 'text', required: true },
    ] },
  ],
}
