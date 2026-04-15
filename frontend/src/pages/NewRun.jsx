import React, { useState, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { useDropzone } from 'react-dropzone'
import { Upload, X, Plus, ChevronDown, Info, Loader2 } from 'lucide-react'
import { createRun } from '../api'
import { useStore } from '../store'
import toast from 'react-hot-toast'
import clsx from 'clsx'

const ALIGNERS = ['simpleaf', 'star', 'kallisto', 'cellranger', 'cellrangerarc', 'cellrangermulti']
const PROTOCOLS = ['auto', '10XV1', '10XV2', '10XV3', '10XV4', 'dropseq', 'smartseq']
const GENOMES = ['GRCh38', 'GRCh37', 'GRCm38', 'GRCm39', 'custom']

// One sample row
function SampleRow({ sample, onChange, onRemove, index }) {
  return (
    <div className="grid grid-cols-12 gap-2 items-start">
      <div className="col-span-3">
        <input
          className="input text-sm"
          placeholder="Sample name"
          value={sample.name}
          onChange={(e) => onChange(index, 'name', e.target.value)}
        />
      </div>
      <div className="col-span-3">
        <FileCell
          label="R1 .fastq.gz"
          file={sample.fastq1}
          onChange={(f) => onChange(index, 'fastq1', f)}
        />
      </div>
      <div className="col-span-3">
        <FileCell
          label="R2 .fastq.gz"
          file={sample.fastq2}
          onChange={(f) => onChange(index, 'fastq2', f)}
        />
      </div>
      <div className="col-span-2">
        <input
          className="input text-sm"
          placeholder="Expected cells"
          type="number"
          value={sample.expected_cells}
          onChange={(e) => onChange(index, 'expected_cells', e.target.value)}
        />
      </div>
      <div className="col-span-1 flex justify-end pt-1">
        <button onClick={() => onRemove(index)} className="text-gray-600 hover:text-red-400 transition-colors">
          <X size={16} />
        </button>
      </div>
    </div>
  )
}

function FileCell({ label, file, onChange }) {
  const onDrop = useCallback((accepted) => { if (accepted[0]) onChange(accepted[0]) }, [onChange])
  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: { 'application/gzip': ['.gz'], 'application/octet-stream': ['.fastq.gz', '.fq.gz'] },
    multiple: false,
  })

  return (
    <div
      {...getRootProps()}
      className={clsx(
        'border border-dashed rounded-lg px-2 py-1.5 text-xs cursor-pointer transition-colors',
        isDragActive ? 'border-brand-500 bg-brand-900/20' : 'border-gray-700 hover:border-gray-600',
        file ? 'text-green-400' : 'text-gray-500'
      )}
    >
      <input {...getInputProps()} />
      <div className="flex items-center gap-1 truncate">
        <Upload size={10} className="flex-shrink-0" />
        <span className="truncate">{file ? file.name : label}</span>
      </div>
    </div>
  )
}

const emptySample = () => ({ name: '', fastq1: null, fastq2: null, expected_cells: '' })

export default function NewRun() {
  const nav = useNavigate()
  const { addRun } = useStore()

  const [runName, setRunName]     = useState('')
  const [aligner, setAligner]     = useState('simpleaf')
  const [protocol, setProtocol]   = useState('10XV3')
  const [genome, setGenome]       = useState('GRCh38')
  const [outdir, setOutdir]       = useState('s3://my-bucket/scrnaseq-results')
  const [skipFastqc, setSkipFastqc]       = useState(false)
  const [skipCellbender, setSkipCellbender] = useState(false)
  const [samples, setSamples]     = useState([emptySample()])
  const [submitting, setSubmitting] = useState(false)

  const updateSample = (i, key, val) =>
    setSamples((prev) => prev.map((s, idx) => (idx === i ? { ...s, [key]: val } : s)))

  const removeSample = (i) =>
    setSamples((prev) => prev.filter((_, idx) => idx !== i))

  const addSample = () => setSamples((prev) => [...prev, emptySample()])

  const valid =
    runName.trim() &&
    outdir.trim() &&
    samples.length > 0 &&
    samples.every((s) => s.name && s.fastq1 && s.fastq2)

  const handleSubmit = async () => {
    if (!valid) return
    setSubmitting(true)
    try {
      const fd = new FormData()
      fd.append('name', runName)
      fd.append('aligner', aligner)
      fd.append('protocol', protocol)
      fd.append('genome', genome)
      fd.append('outdir', outdir)
      fd.append('skip_fastqc', skipFastqc)
      fd.append('skip_cellbender', skipCellbender)

      const meta = samples.map((s) => ({
        name: s.name,
        expected_cells: s.expected_cells || null,
      }))
      fd.append('samples_meta', JSON.stringify(meta))

      samples.forEach((s, i) => {
        fd.append(`fastq1_${i}`, s.fastq1)
        fd.append(`fastq2_${i}`, s.fastq2)
      })

      const run = await createRun(fd)
      addRun(run)
      toast.success('Pipeline run submitted!')
      nav(`/runs/${run.id}`)
    } catch (err) {
      toast.error(err?.response?.data?.detail || 'Failed to submit run')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="p-8 max-w-4xl mx-auto">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-white">New Pipeline Run</h1>
        <p className="text-gray-500 text-sm mt-1">Configure and launch nf-core/scrnaseq on AWS HealthOmics</p>
      </div>

      <div className="space-y-6">
        {/* Basic settings */}
        <div className="card">
          <h2 className="font-semibold text-white mb-4">Run Settings</h2>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="label">Run Name *</label>
              <input className="input" placeholder="e.g. PBMC_10x_v3_run1" value={runName} onChange={(e) => setRunName(e.target.value)} />
            </div>
            <div>
              <label className="label">Output Directory (S3) *</label>
              <input className="input" placeholder="s3://bucket/path" value={outdir} onChange={(e) => setOutdir(e.target.value)} />
            </div>
            <div>
              <label className="label">Aligner</label>
              <select className="input" value={aligner} onChange={(e) => setAligner(e.target.value)}>
                {ALIGNERS.map((a) => <option key={a}>{a}</option>)}
              </select>
            </div>
            <div>
              <label className="label">Protocol</label>
              <select className="input" value={protocol} onChange={(e) => setProtocol(e.target.value)}>
                {PROTOCOLS.map((p) => <option key={p}>{p}</option>)}
              </select>
            </div>
            <div>
              <label className="label">Reference Genome</label>
              <select className="input" value={genome} onChange={(e) => setGenome(e.target.value)}>
                {GENOMES.map((g) => <option key={g}>{g}</option>)}
              </select>
            </div>
            <div className="flex flex-col justify-end gap-2">
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="checkbox" className="rounded" checked={skipFastqc} onChange={(e) => setSkipFastqc(e.target.checked)} />
                <span className="text-sm text-gray-400">Skip FastQC</span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="checkbox" className="rounded" checked={skipCellbender} onChange={(e) => setSkipCellbender(e.target.checked)} />
                <span className="text-sm text-gray-400">Skip Cellbender</span>
              </label>
            </div>
          </div>
        </div>

        {/* Samples */}
        <div className="card">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-semibold text-white">Samples</h2>
            <button onClick={addSample} className="btn-secondary flex items-center gap-1 text-sm py-1.5">
              <Plus size={14} />
              Add Sample
            </button>
          </div>

          <div className="space-y-3">
            {/* Header */}
            <div className="grid grid-cols-12 gap-2 text-xs text-gray-500 px-0">
              <div className="col-span-3">Sample Name</div>
              <div className="col-span-3">Read 1 (R1)</div>
              <div className="col-span-3">Read 2 (R2)</div>
              <div className="col-span-2">Expected Cells</div>
            </div>

            {samples.map((s, i) => (
              <SampleRow
                key={i}
                index={i}
                sample={s}
                onChange={updateSample}
                onRemove={removeSample}
              />
            ))}
          </div>

          <div className="mt-3 flex items-start gap-2 text-xs text-gray-500 bg-gray-800/50 rounded-lg p-3">
            <Info size={12} className="mt-0.5 flex-shrink-0 text-brand-400" />
            <span>Files are uploaded to S3 and a samplesheet CSV is auto-generated. Multiple rows with the same sample name will be concatenated.</span>
          </div>
        </div>

        {/* Submit */}
        <div className="flex justify-end gap-3">
          <button onClick={() => nav('/dashboard')} className="btn-secondary">Cancel</button>
          <button
            onClick={handleSubmit}
            disabled={!valid || submitting}
            className="btn-primary flex items-center gap-2 min-w-32 justify-center"
          >
            {submitting ? <Loader2 size={14} className="animate-spin" /> : null}
            {submitting ? 'Submitting…' : 'Launch Pipeline'}
          </button>
        </div>
      </div>
    </div>
  )
}
