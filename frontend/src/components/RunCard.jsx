import React from 'react'
import { useNavigate } from 'react-router-dom'
import { Clock, ChevronRight, Cpu } from 'lucide-react'
import StatusBadge from './StatusBadge'

export default function RunCard({ run }) {
  const nav = useNavigate()
  const created = new Date(run.created_at).toLocaleString()

  return (
    <div
      className="card hover:border-gray-700 cursor-pointer transition-colors group"
      onClick={() => nav(`/runs/${run.id}`)}
    >
      <div className="flex items-start justify-between">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <h3 className="font-semibold text-white truncate">{run.name}</h3>
            <StatusBadge status={run.status} />
          </div>
          <div className="flex items-center gap-4 text-xs text-gray-500">
            <span className="flex items-center gap-1">
              <Cpu size={12} />
              {run.aligner}
            </span>
            <span className="flex items-center gap-1">
              <Clock size={12} />
              {created}
            </span>
            <span>{run.sample_count} sample{run.sample_count !== 1 ? 's' : ''}</span>
          </div>
        </div>
        <ChevronRight size={16} className="text-gray-600 group-hover:text-gray-400 transition-colors mt-1 flex-shrink-0" />
      </div>

      {run.status === 'RUNNING' && (
        <div className="mt-3">
          <div className="flex justify-between text-xs text-gray-500 mb-1">
            <span>Progress</span>
            <span>{run.progress || 0}%</span>
          </div>
          <div className="h-1.5 bg-gray-800 rounded-full overflow-hidden">
            <div
              className="h-full bg-brand-500 rounded-full transition-all duration-500"
              style={{ width: `${run.progress || 0}%` }}
            />
          </div>
        </div>
      )}
    </div>
  )
}
