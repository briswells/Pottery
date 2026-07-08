import type { CollectionConfig, CheckboxFieldValidation, UploadFieldManyValidation } from 'payload'
import { isAdmin } from '../access/isAdmin'
import { isAdminOrEditor } from '../access/isAdminOrEditor'
import { setFiringCompletedAt } from '../hooks/setFiringCompletedAt'

const validateStonewareConfirmed: CheckboxFieldValidation = (value) =>
  value === true || 'You must confirm your pieces are stoneware.'

const validatePhotos: UploadFieldManyValidation = (value) => {
  const arr = Array.isArray(value) ? value : []
  return arr.length <= 5 || 'At most 5 photos.'
}

export const FiringRequests: CollectionConfig = {
  slug: 'firing-requests',
  admin: {
    group: 'Studio',
    useAsTitle: 'name',
    defaultColumns: ['name', 'halfShelves', 'status', 'amountCents', 'paidAt'],
  },
  access: {
    read: isAdminOrEditor,
    create: () => false, // created server-side only
    update: isAdminOrEditor,
    delete: isAdmin,
  },
  hooks: {
    beforeChange: [setFiringCompletedAt],
  },
  fields: [
    { name: 'name', type: 'text', required: true },
    { name: 'person', type: 'relationship', relationTo: 'people', hasMany: false, admin: { description: 'The person who requested this firing.' } },
    { name: 'email', type: 'email', required: true },
    { name: 'phone', type: 'text' },
    { name: 'description', type: 'textarea', required: true },
    { name: 'notes', type: 'textarea', admin: { description: 'Customer notes' } },
    { name: 'halfShelves', type: 'number', required: true, min: 1, max: 8, admin: { description: 'Number of half-shelves reserved (11″×22″×6″ each).' } },
    {
      name: 'amountCents',
      type: 'number',
      required: true,
      label: 'Amount',
      admin: {
        components: {
          Field: '/admin/PriceField#PriceField',
          Cell: '/admin/PriceCell#PriceCell',
        },
      },
    },
    {
      name: 'discountCents', type: 'number', label: 'Discount',
      admin: {
        description: 'Coupon discount applied. Original price = amount + discount.',
        components: { Field: '/admin/PriceField#PriceField', Cell: '/admin/PriceCell#PriceCell' },
      },
    },
    { name: 'coupon', type: 'relationship', relationTo: 'coupons', hasMany: false },
    { name: 'squarePaymentId', type: 'text', index: true },
    { name: 'stonewareConfirmed', type: 'checkbox', required: true, validate: validateStonewareConfirmed, admin: { description: 'Customer confirmed all pieces are stoneware (cone 10 safe).' } },
    {
      name: 'photos', type: 'upload', relationTo: 'media', hasMany: true, validate: validatePhotos,
      admin: { description: 'Up to 5 photos of the work being fired.' },
    },
    {
      name: 'status', type: 'select', defaultValue: 'pending',
      options: [
        { label: 'Pending', value: 'pending' },
        { label: 'Paid', value: 'paid' },
        { label: 'Completed', value: 'completed' },
        { label: 'Cancelled', value: 'cancelled' },
        { label: 'Refunded', value: 'refunded' },
      ],
    },
    { name: 'paidAt', type: 'date', admin: { readOnly: true } },
    {
      name: 'completedAt', type: 'date',
      admin: { readOnly: true, description: 'Set when marked Completed. Attached photos are auto-deleted 2 weeks after this.' },
    },
  ],
}
