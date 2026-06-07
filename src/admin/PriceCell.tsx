'use client'
import React from 'react'
import { usd } from '../lib/format'

type PriceCellProps = { cellData?: number | null }

export const PriceCell: React.FC<PriceCellProps> = ({ cellData }) => {
  if (typeof cellData !== 'number' || !Number.isFinite(cellData)) return <span />
  return <span>{usd(cellData)}</span>
}
