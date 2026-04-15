import React from 'react'
import clsx from 'clsx'

const STATUS = {
  PENDING:   { label: 'Pending',   cls: 'bg-yellow-900/40 text-yellow-400' },
  RUNNING:   { label: 'Running',   cls: 'bg-blue-900/40 text-blue-400'     },
  COMPLETED: { label: 'Completed', cls: 'bg-green-900/40 text-green-400'   },
  FAILED:    { label: 'Failed',    cls: 'bg-red-900/40 text-red-400'       },
  CANCELLED: { label: 'Cancelled', cls: 'bg-gray-800 text-gray-400'        },
}

export default function StatusBadge({ status }) {
  const s = STATUS[status] || STATUS.PENDING
  return (
    <span className={clsx('badge', s.cls)}>
      {s.label}
    </span>
  )
}
