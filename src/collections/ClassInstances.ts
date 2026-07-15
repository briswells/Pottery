import type { CollectionConfig, Access, Where } from 'payload'
import { isAdminOrEditor } from '../access/isAdminOrEditor'
import { DAYS_OF_WEEK } from '../lib/studio'
import { applyClassDefaults } from '../hooks/applyClassDefaults'
import { blockInstanceDeleteWithBookings } from '../hooks/blockInstanceDeleteWithBookings'

const timeValidate = (val: unknown) =>
  (typeof val === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(val)) ||
  'Use 24-hour HH:MM, e.g. 18:00'

/**
 * Read access: admins/editors see everything; an instructor sees only their own
 * instances (so the admin list IS their class list); the public sees published only.
 */
const readAccess: Access = ({ req: { user } }): boolean | Where => {
  if (user && user.collection === 'users') {
    if (user.roles?.some((r) => r === 'admin' || r === 'editor')) return true
    if (user.roles?.includes('instructor')) return { instructor: { equals: user.id } } satisfies Where
  }
  return { status: { equals: 'published' } } satisfies Where
}

export const ClassInstances: CollectionConfig = {
  slug: 'class-instances',
  admin: {
    useAsTitle: 'label',
    group: 'Studio',
    defaultColumns: ['label', 'instructor', 'startDate', 'endDate', 'status'],
    // Completed (past) instances are hidden from the admin list to keep it
    // focused on what's upcoming. Their rosters stay reachable via Bookings
    // and the instructors' My Classes view.
    baseListFilter: () => ({ status: { not_equals: 'completed' } }),
  },
  access: {
    read: readAccess,
    create: isAdminOrEditor,
    update: isAdminOrEditor,
    delete: isAdminOrEditor,
  },
  hooks: { beforeValidate: [applyClassDefaults], beforeDelete: [blockInstanceDeleteWithBookings] },
  fields: [
    { name: 'class', type: 'relationship', relationTo: 'classes', required: true },
    {
      name: 'autofill', type: 'ui',
      admin: { components: { Field: '/admin/ClassInstanceAutofill#ClassInstanceAutofill' } },
    },
    {
      name: 'label', type: 'text', label: 'Title',
      admin: { description: 'Auto-filled from the class — edit to tell concurrent runs apart, e.g. add “ — Tuesday Nights”.' },
    },
    { name: 'instructor', type: 'relationship', relationTo: 'users', required: true },
    // displayFormat keeps the admin list from tacking a meaningless "12:00 AM"
    // onto these date-only fields — the session time lives in startTime/endTime.
    { name: 'startDate', type: 'date', required: true, admin: { date: { pickerAppearance: 'dayOnly', displayFormat: 'MMM d, yyyy' }, description: 'First (or only) meeting date' } },
    { name: 'startTime', type: 'text', required: true, validate: timeValidate, admin: { description: '24-hour HH:MM, e.g. 18:00' } },
    { name: 'endTime', type: 'text', required: true, validate: timeValidate, admin: { description: '24-hour HH:MM, e.g. 20:00' } },
    {
      name: 'daysOfWeek', type: 'select', hasMany: true, options: [...DAYS_OF_WEEK],
      admin: { description: 'Which days the class meets (multi-week courses).' },
    },
    {
      name: 'numberOfClasses', type: 'number', min: 1,
      admin: { description: 'For a multi-week course, how many sessions it runs (inherited from the class). Fills in the end date automatically — set this OR an end date, not both.' },
    },
    {
      name: 'endDate', type: 'date',
      admin: {
        date: { pickerAppearance: 'dayOnly', displayFormat: 'MMM d, yyyy' },
        description: 'Last meeting date. Leave blank for a single-day class, or set "Number of classes" instead and this fills in automatically.',
      },
    },
    {
      name: 'skipDates', type: 'array',
      labels: { singular: 'Skip date', plural: 'Skip dates' },
      fields: [{ name: 'date', type: 'date', required: true, admin: { date: { pickerAppearance: 'dayOnly', displayFormat: 'MMM d, yyyy' } } }],
      admin: { description: 'Dates to exclude (e.g. holidays).' },
    },
    { name: 'capacity', type: 'number', min: 1, admin: { description: 'Defaults from the class if left blank.' } },
    {
      name: 'priceCents', type: 'number', min: 0, label: 'Price',
      admin: {
        description: 'Defaults from the class if left blank. Price in dollars.',
        components: { Field: '/admin/PriceField#PriceField', Cell: '/admin/PriceCell#PriceCell' },
      },
    },
    { name: 'image', type: 'upload', relationTo: 'media', admin: { description: 'Optional; falls back to the class image.' } },
    { name: 'location', type: 'text', admin: { description: 'Optional; falls back to the studio address.' } },
    {
      name: 'status', type: 'select', defaultValue: 'draft',
      options: [
        { label: 'Draft', value: 'draft' },
        { label: 'Published', value: 'published' },
        { label: 'Cancelled', value: 'cancelled' },
        { label: 'Completed', value: 'completed' },
      ],
      admin: { position: 'sidebar', description: 'Only Published instances appear on the website.' },
    },
    {
      name: 'roster', type: 'join', collection: 'bookings', on: 'classInstance',
      admin: { defaultColumns: ['customerName', 'customerEmail', 'status'], description: 'Everyone enrolled in this instance.' },
    },
  ],
}
