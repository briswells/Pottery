import type { CollectionConfig, FieldAccess } from 'payload'
import { isAdmin } from '../access/isAdmin'
import { isAdminOrEditor } from '../access/isAdminOrEditor'
import { anyone } from '../access/anyone'

/** Field-level access: only admins may update the roles field. */
const adminOnlyField: FieldAccess = ({ req: { user } }) =>
  Boolean(user?.roles?.includes('admin'))

export const Users: CollectionConfig = {
  slug: 'users',
  auth: true,
  admin: { useAsTitle: 'name', group: 'People' },
  access: {
    read: anyone,
    create: isAdmin,
    update: isAdminOrEditor,
    delete: isAdmin,
  },
  fields: [
    { name: 'name', type: 'text', required: true },
    {
      name: 'roles',
      type: 'select',
      hasMany: true,
      defaultValue: ['editor'],
      options: [
        { label: 'Admin', value: 'admin' },
        { label: 'Editor', value: 'editor' },
      ],
      saveToJWT: true,
      access: { update: adminOnlyField },
      validate: (val: unknown) =>
        (Array.isArray(val) && val.length > 0) || 'At least one role is required.',
    },
    { name: 'title', type: 'text', admin: { description: 'Shown on the Meet the Staff page' } },
    { name: 'bio', type: 'textarea' },
    { name: 'photo', type: 'upload', relationTo: 'media' },
    { name: 'showOnStaffPage', type: 'checkbox', defaultValue: false },
    { name: 'order', type: 'number', defaultValue: 0, admin: { description: 'Sort order on the Staff page' } },
  ],
}
