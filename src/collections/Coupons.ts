import type { CollectionConfig, NumberFieldSingleValidation, RelationshipFieldSingleValidation } from 'payload'
import { isAdmin } from '../access/isAdmin'
import { isAdminOrEditor } from '../access/isAdminOrEditor'
import { uniqueFieldValidate } from '../lib/uniqueName'

const validatePercentOff: NumberFieldSingleValidation = (value, { siblingData }) => {
  const data = siblingData as { discountType?: string } | undefined
  return data?.discountType !== 'percent' || (typeof value === 'number' && value >= 1 && value <= 100)
    ? true
    : 'Enter a percent between 1 and 100.'
}

const validateAmountOffCents: NumberFieldSingleValidation = (value, { siblingData }) => {
  const data = siblingData as { discountType?: string } | undefined
  return data?.discountType !== 'fixed' || (typeof value === 'number' && value >= 1)
    ? true
    : 'Enter an amount greater than zero.'
}

const validateClass: RelationshipFieldSingleValidation = (value, { siblingData }) => {
  const data = siblingData as { appliesTo?: string } | undefined
  return data?.appliesTo !== 'class' || value != null ? true : 'Pick the class this code applies to.'
}

// Discount codes for class bookings. Redemption usage is DERIVED by counting
// paid/pending bookings that reference the coupon — there is no counter column.
export const Coupons: CollectionConfig = {
  slug: 'coupons',
  labels: { singular: 'Coupon', plural: 'Coupons' },
  admin: {
    group: 'Commerce',
    useAsTitle: 'code',
    defaultColumns: ['code', 'discountType', 'appliesTo', 'active', 'expiresAt'],
  },
  access: { read: isAdminOrEditor, create: isAdminOrEditor, update: isAdminOrEditor, delete: isAdmin },
  fields: [
    {
      name: 'code', type: 'text', required: true, unique: true, index: true,
      admin: { description: 'Customers enter this at checkout. Stored uppercase; entry is case-insensitive.' },
      hooks: { beforeValidate: [({ value }) => (typeof value === 'string' ? value.trim().toUpperCase() : value)] },
      validate: uniqueFieldValidate('coupons', 'code', 'A coupon with that code already exists.'),
    },
    {
      name: 'discountType', type: 'select', required: true, defaultValue: 'percent',
      options: [
        { label: 'Percent off', value: 'percent' },
        { label: 'Fixed amount off', value: 'fixed' },
      ],
    },
    {
      name: 'percentOff', type: 'number', min: 1, max: 100,
      admin: { condition: (data) => data?.discountType === 'percent', description: '1–100' },
      validate: validatePercentOff,
    },
    {
      name: 'amountOffCents', type: 'number', min: 1, label: 'Amount off',
      admin: {
        condition: (data) => data?.discountType === 'fixed',
        components: { Field: '/admin/PriceField#PriceField', Cell: '/admin/PriceCell#PriceCell' },
      },
      validate: validateAmountOffCents,
    },
    {
      // Not `required: true` — that makes the generated create type demand the field
      // even though defaultValue backfills it. The hook below closes the residual
      // gap (explicit null → 'all') so appliesTo is never null in practice.
      name: 'appliesTo', type: 'select', defaultValue: 'all',
      options: [
        { label: 'All classes', value: 'all' },
        { label: 'A specific class', value: 'class' },
        { label: 'Firings only', value: 'firing' },
      ],
      hooks: { beforeValidate: [({ value }) => value ?? 'all'] },
    },
    {
      name: 'class', type: 'relationship', relationTo: 'classes', hasMany: false,
      admin: { condition: (data) => data?.appliesTo === 'class', description: 'Covers every session of this class.' },
      validate: validateClass,
    },
    { name: 'active', type: 'checkbox', defaultValue: true },
    { name: 'expiresAt', type: 'date', admin: { description: 'Optional — code stops working after this date.' } },
    { name: 'maxRedemptions', type: 'number', min: 1, admin: { description: 'Optional — total uses allowed across all customers.' } },
    { name: 'onePerCustomer', type: 'checkbox', defaultValue: false, admin: { description: 'Each email can use this code once.' } },
  ],
}
