import { describe, it, expect, vi } from 'vitest'

const syncMock = vi.hoisted(() => vi.fn(async () => undefined))
vi.mock('../../src/services/sync-square-plans', () => ({ syncSquarePlans: syncMock }))

import { handleCatalogVersionUpdated } from '../../src/app/api/webhooks/square/route'

describe('catalog.version.updated webhook', () => {
  it('triggers a plan sync', async () => {
    syncMock.mockClear()
    await handleCatalogVersionUpdated({} as any)
    expect(syncMock).toHaveBeenCalledTimes(1)
  })
})
