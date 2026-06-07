'use client'
import React, { useEffect, useState } from 'react'
import { FieldError, FieldLabel, useField } from '@payloadcms/ui'
import { centsToDollars, dollarsToCents } from '../lib/format'

type PriceFieldProps = {
  path: string
  readOnly?: boolean
  field?: {
    label?: string | false
    required?: boolean
    admin?: { description?: unknown }
  }
}

export const PriceField: React.FC<PriceFieldProps> = ({ field, path, readOnly }) => {
  const { value, setValue, showError } = useField<number | undefined>({ path })

  // Local text state so partial input like "45." is preserved while typing.
  const [text, setText] = useState<string>(value == null ? '' : centsToDollars(value))

  // Re-sync display when the stored value changes from outside (e.g. form reset),
  // but never clobber in-progress typing whose parsed value already matches.
  useEffect(() => {
    setText((prev) => {
      if (dollarsToCents(prev) === (value ?? null)) return prev
      return value == null ? '' : centsToDollars(value)
    })
  }, [value])

  const label = field?.label
  const required = field?.required
  const description = field?.admin?.description

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    // Allow only digits + a single dot, max 2 decimals.
    const raw = e.target.value.replace(/[^0-9.]/g, '')
    const firstDot = raw.indexOf('.')
    const next =
      firstDot === -1
        ? raw
        : `${raw.slice(0, firstDot)}.${raw.slice(firstDot + 1).replace(/\./g, '').slice(0, 2)}`
    setText(next)
    setValue(dollarsToCents(next) ?? undefined)
  }

  const handleBlur = () => setText(value == null ? '' : centsToDollars(value))

  return (
    <div className="field-type number">
      {label !== false && <FieldLabel label={label} required={required} path={path} />}
      <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
        <span
          aria-hidden="true"
          style={{ position: 'absolute', left: 10, opacity: 0.7, pointerEvents: 'none' }}
        >
          $
        </span>
        <input
          type="text"
          inputMode="decimal"
          aria-label={typeof label === 'string' ? label : 'Price'}
          disabled={readOnly}
          value={text}
          onChange={handleChange}
          onBlur={handleBlur}
          style={{ paddingLeft: 22, width: '100%' }}
        />
      </div>
      {showError && <FieldError path={path} />}
      {typeof description === 'string' && (
        <div className="field-description">{description}</div>
      )}
    </div>
  )
}
