import React, { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Plus, RefreshCw, Activity, CheckCircle, XCircle, Clock } from 'lucide-react'
import { getRuns } from '../api'
import { useStore } from '../store'
import RunCard from '../components/RunCard'
import toast from 'react-hot-toast'

export default function Dashboard() {
  const nav = useNavigate()
  const { runs, setRuns } = useStore()
  const [loading, setLoading] = useState(true)

  const fetchRuns = async () => {
    try {
      const data = await getRuns()
      setRuns(data)
    } catch {
      toast.error('Failed to load runs')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchRuns()
    const t = setInterval(fetchRuns, 10000)
    return () => clearInterval(t)
  }, [])

  const stats = {
    total:     runs.length,
    running:   runs.filter((r) => r.status === 'RUNNING').length,
    completed: runs.filter((r) => r.status === 'COMPLETED').length,
    failed:    runs.filter((r) => r.status === 'FAILED').length,
  }

  return (
    <div className="p-8 max-w-5xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold text-white">Pipeline Runs</h1>
          <p className="text-gray-500 text-sm mt-1">nf-core/scrnaseq on AWS HealthOmics</p>
        </div>
        <div className="flex gap-2">
          <button onClick={fetchRuns} className="btn-secondary flex items-center gap-2">
            <RefreshCw size={14} />
            Refresh
          </button>
          <button onClick={() => nav('/runs/new')} className="btn-primary flex items-center gap-2">
            <Plus size={14} />
            New Run
          </button>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-4 gap-4 mb-8">
        {[
          { label: 'Total Runs',  value: stats.total,     icon: Activity,     color: 'text-gray-400' },
          { label: 'Running',     value: stats.running,   icon: Clock,        color: 'text-blue-400' },
          { label: 'Completed',   value: stats.completed, icon: CheckCircle,  color: 'text-green-400' },
          { label: 'Failed',      value: stats.failed,    icon: XCircle,      color: 'text-red-400' },
        ].map(({ label, value, icon: Icon, color }) => (
          <div key={label} className="card">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs text-gray-500">{label}</span>
              <Icon size={14} className={color} />
            </div>
            <p className="text-2xl font-bold text-white">{value}</p>
          </div>
        ))}
      </div>

      {/* Runs list */}
      {loading ? (
        <div className="flex items-center justify-center py-20 text-gray-500">
          <RefreshCw size={20} className="animate-spin mr-2" />
          Loading runs…
        </div>
      ) : runs.length === 0 ? (
        <div className="card text-center py-16">
          <p className="text-gray-500 mb-4">No pipeline runs yet.</p>
          <button onClick={() => nav('/runs/new')} className="btn-primary inline-flex items-center gap-2">
            <Plus size={14} />
            Start your first run
          </button>
        </div>
      ) : (
        <div className="space-y-3">
          {runs.map((run) => (
            <RunCard key={run.id} run={run} />
          ))}
        </div>
      )}
    </div>
  )
}
