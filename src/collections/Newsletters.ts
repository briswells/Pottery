import type { CollectionConfig } from 'payload'
import { APIError } from 'payload'
import { isAdminOrEditor } from '../access/isAdminOrEditor'
import { newsletterEndpoints } from '../endpoints/newsletters'

/**
 * Studio newsletters composed in the admin and sent to the Kit mailing list
 * as broadcasts. Kit owns the subscriber list; this collection is the compose
 * surface and the send history. Sent newsletters are immutable.
 */
export const Newsletters: CollectionConfig = {
  slug: 'newsletters',
  admin: {
    useAsTitle: 'subject',
    group: 'Communications',
    defaultColumns: ['subject', 'status', 'sentAt', 'recipientCount'],
    description: 'Compose a newsletter, proof it with “Send test to me”, then send it to the mailing list.',
  },
  access: {
    read: isAdminOrEditor,
    create: isAdminOrEditor,
    update: isAdminOrEditor,
    delete: isAdminOrEditor,
  },
  endpoints: newsletterEndpoints,
  hooks: {
    beforeChange: [
      ({ originalDoc }) => {
        if (originalDoc?.status === 'sent') {
          throw new APIError('This newsletter has already been sent and can no longer be edited.', 400)
        }
      },
    ],
  },
  fields: [
    {
      name: 'sendPanel', type: 'ui',
      admin: { position: 'sidebar', components: { Field: '/admin/NewsletterSend#default' } },
    },
    {
      name: 'subject', type: 'text', required: true, admin: { description: 'The email subject line.' },
      // Duplicating a sent newsletter is the normal way to reuse one — retitle
      // the copy so it's obvious which doc is the fresh draft.
      hooks: { beforeDuplicate: [({ value }) => `Copy of ${value ?? ''}`] },
    },
    {
      name: 'body', type: 'richText', required: true,
      admin: { description: 'Headings, text, links, lists, and images all render inside the studio email template.' },
    },
    {
      name: 'status', type: 'select', defaultValue: 'draft',
      options: [
        { label: 'Draft', value: 'draft' },
        { label: 'Sent', value: 'sent' },
      ],
      admin: { position: 'sidebar', readOnly: true },
      // A duplicate of a sent newsletter must be born a fresh, editable draft —
      // without these resets the copy inherits 'sent' and is locked on arrival.
      hooks: { beforeDuplicate: [() => 'draft'] },
    },
    { name: 'sentAt', type: 'date', admin: { position: 'sidebar', readOnly: true, date: { displayFormat: 'MMM d, yyyy h:mm a' } }, hooks: { beforeDuplicate: [() => null] } },
    { name: 'kitBroadcastId', type: 'text', admin: { position: 'sidebar', readOnly: true }, hooks: { beforeDuplicate: [() => null] } },
    { name: 'recipientCount', type: 'number', admin: { position: 'sidebar', readOnly: true }, hooks: { beforeDuplicate: [() => null] } },
  ],
}
