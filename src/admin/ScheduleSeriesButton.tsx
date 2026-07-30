'use client'

import { Button } from '@payloadcms/ui'

/** Entry point to the series generator, shown above the Class Instances list. */
export default function ScheduleSeriesButton() {
  return (
    <div style={{ marginBottom: 12 }}>
      <Button el="link" to="/admin/schedule-series" buttonStyle="secondary" size="small">
        Schedule a series…
      </Button>
    </div>
  )
}
