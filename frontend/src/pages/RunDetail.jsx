import React, { useEffect, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { RefreshCw, Terminal, BarChart2, StopCircle, ExternalLink } from 'lucide-react'
import { getRunStatus, getRunLogs, cancelRun } from '../api'
import { useStore } from '../store'
import StatusBadge from '../components/StatusBadge'
import toast from 'react-hot-toast'

const STEPS = [
  'Uploading files',
  'Creating samplesheet',
  'Submitting to HealthOmics',
  'FastQC',
  'Alignment',
  'MTX → h5ad conversion',
  'MultiQC report',
  'Completed',
]

export default function RunDetail() {
  const { runId } = useParams()
  const nav = useNavigate()
  const { runs, updateRun } = useStore()
  const [logs, setLogs] = useState('')
  const [tab, setTab] = useState('overview')

  const run = runs.find((r) => r.id === runId)

  const fetchStatus = async () => {
    try {
      const data = await getRunStatus(runId)
      updateRun(runId, data)
    } catch {
      toast.error('Failed to refresh status')
    }
  }

  const fetchLogs = async () => {
    try {
      const data = await getRunLogs(runId)
      setLogs(data.logs || '')
    } catch {
      setLogs('Could not load logs.')
    }
  }

  useEffect(() => {
    fetchStatus()
    const t = setInterval(() => {
      if (run?.status === 'RUNNING' || run?.status === 'PENDING') fetchStatus()
    }, 8000)
    return () => clearInterval(t)
  }, [runId])

  useEffect(() => {
    if (tab === 'logs') fetchLogs()
  }, [tab])

  const handleCancel = async () => {
    if (!confirm('Cancel this run?')) return
    try {
      await cancelRun(runId)
      updateRun(runId, { status: 'CANCELLED' })
      toast.success('Run cancelled')
    } catch {
      toast.error('Failed to cancel run')
    }
  }

  if (!run) {
    return (
      <div className="p-8 text-gray-500 flex items-center gap-2">
        <RefreshCw size={16} className="animate-spin" /> Loading…
      </div>
    )
  }

  const stepIndex = Math.floor(((run.progress || 0) / 100) * (STEPS.length - 1))

  return (
    <div className="p-8 max-w-5xl mx-auto">
      {/* Header */}
      <div className="flex items-start justify-between mb-6">
        <div>
          <div className="flex items-center gap-3 mb-1">
            <h1 className="text-2xl font-bold text-white">{run.name}</h1>
            <StatusBadge status={run.status} />
          </div>
          <p className="text-gray-500 text-sm">
            {run.aligner} · {run.protocol} · {run.genome} · {run.sample_count} sample{run.sample_count !== 1 ? 's' : ''}
          </p>
        </div>
        <div className="flex gap-2">
          {run.status === 'RUNNING' && (
            <button onClick={handleCancel} className="btn-secondary flex items-center gap-2 text-red-400 hover:text-red-300">
              <StopCircle size={14} />
              Cancel
            </button>
          )}
          {run.status === 'COMPLETED' && (
            <button onClick={() => nav(`/runs/${runId}/results`)} className="btn-primary flex items-center gap-2">
              <BarChart2 size={14} />
              View Results & AI Analysis
            </button>
          )}
          <button onClick={fetchStatus} className="btn-secondary flex items-center gap-2">
            <RefreshCw size={14} />
            Refresh
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 mb-6 border-b border-gray-800">
        {['overview', 'logs'].map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-4 py-2 text-sm font-medium capitalize transition-colors border-b-2 -mb-px ${
              tab === t ? 'border-brand-500 text-brand-400' : 'border-transparent text-gray-500 hover:text-gray-300'
            }`}
          >
            {t === 'logs' ? <span className="flex items-center gap-1"><Terminal size={12} />Logs</span> : 'Overview'}
          </button>
        ))}
      </div>

      {tab === 'overview' && (
        <div className="space-y-6">
          {/* Progress */}
          <div className="card">
            <div className="flex justify-between text-sm mb-3">
              <span className="text-gray-400">Pipeline Progress</span>
              <span className="text-white font-medium">{run.progress || 0}%</span>
            </div>
            <div className="h-2 bg-gray-800 rounded-full overflow-hidden mb-4">
              <div
                className="h-full bg-brand-500 rounded-full transition-all duration-700"
                style={{ width: `${run.progress || 0}%` }}
              />
            </div>

            {/* Steps */}
            <div className="space-y-2">
              {STEPS.map((step, i) => {
                const done = i < stepIndex
                const active = i === stepIndex && run.status === 'RUNNING'
                return (
                  <div key={step} className="flex items-center gap-3">
                    <div className={`w-5 h-5 rounded-full flex items-center justify-center flex-shrink-0 text-xs ${
                      done ? 'bg-green-500 text-white' :
                      active ? 'bg-brand-500 text-white' :
                      'bg-gray-800 text-gray-600'
                    }`}>
                      {done ? '✓' : i + 1}
                    </div>
                    <span className={`text-sm ${done ? 'text-gray-400' : active ? 'text-white' : 'text-gray-600'}`}>
                      {step}
                      {active && <span className="ml-2 text-brand-400 text-xs animate-pulse">running…</span>}
                    </span>
                  </div>
                )
              })}
            </div>
          </div>

          {/* Run metadata */}
          <div className="card">
            <h3 className="font-medium text-white mb-3">Run Details</h3>
            <dl className="grid grid-cols-2 gap-x-8 gap-y-2 text-sm">
              {[
                ['Run ID',       run.id],
                ['HealthOmics Run ID', run.healthomics_run_id || '—'],
                ['Aligner',      run.aligner],
                ['Protocol',     run.protocol],
                ['Genome',       run.genome],
                ['Output Dir',   run.outdir],
                ['Started',      run.created_at ? new Date(run.created_at).toLocaleString() : '—'],
                ['Finished',     run.finished_at ? new Date(run.finished_at).toLocaleString() : '—'],
              ].map(([k, v]) => (
                <div key={k} className="flex gap-2">
                  <dt className="text-gray-500 w-36 flex-shrink-0">{k}</dt>
                  <dd className="text-gray-200 truncate">{v}</dd>
                </div>
              ))}
            </dl>
          </div>
        </div>
      )}

      {tab === 'logs' && (
        <div className="card">
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-medium text-white">Pipeline Logs</h3>
            <button onClick={fetchLogs} className="btn-secondary text-xs py-1 flex items-center gap-1">
              <RefreshCw size={12} />
              Refresh
            </button>
          </div>
          <pre className="bg-gray-950 rounded-lg p-4 text-xs text-green-400 font-mono overflow-auto max-h-[60vh] whitespace-pre-wrap">
            {logs || 'No logs available yet.'}
          </pre>
        </div>
      )}
    </div>
  )
}
