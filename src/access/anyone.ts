import type { Access } from 'payload'

/** Public read access. */
export const anyone: Access = () => true
