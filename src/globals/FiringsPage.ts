import type { GlobalConfig } from 'payload'
import { anyone } from '../access/anyone'
import { isAdminOrEditor } from '../access/isAdminOrEditor'

export const FiringsPage: GlobalConfig = {
  slug: 'firings-page',
  admin: { group: 'Pages' },
  access: { read: anyone, update: isAdminOrEditor },
  fields: [
    { name: 'headline', type: 'text', required: true, defaultValue: 'Custom Cone 10 Firings' },
    { name: 'intro', type: 'textarea', defaultValue: "Bring us your work and we’ll fire it to Cone 10. Tell us about your piece below and we’ll quote a price based on its size." },
    {
      name: 'image', type: 'upload', relationTo: 'media',
      admin: { description: 'Shown under the intro — e.g. a photo of the kiln or fired work.' },
    },
    {
      name: 'steps', type: 'array', labels: { singular: 'Step', plural: 'Steps' },
      fields: [{ name: 'step', type: 'text', required: true }],
      defaultValue: [
        { step: 'Tell us about your piece — size, quantity, and a photo if you have one.' },
        { step: 'We review the size and email you a Square invoice with the price.' },
        { step: "Pay online, drop off your work, and we’ll fire it to Cone 10." },
      ],
    },
    { name: 'pricingNote', type: 'text', defaultValue: "Price is quoted by size after we see your piece — you’re never charged up front." },
  ],
}
