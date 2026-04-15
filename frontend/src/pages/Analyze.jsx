import React, { useState, useRef, useCallback, useEffect } from 'react'
import { useDropzone } from 'react-dropzone'
import {
  Upload, Bot, User, Send, Loader2, Sparkles,
  BarChart2, FlaskConical, ChevronDown, ChevronUp, X
} from 'lucide-react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { uploadH5ad, analyzeChat } from '../api'
import toast from 'react-hot-toast'
import clsx from 'clsx'

const SUGGESTIONS = [
  'Show me a UMAP plot',
  'Plot the UMI count distribution',
  'Show top 20 highly expressed genes',
  'Generate a scatter plot of counts vs genes',
  'Show mitochondrial % distribution',
  'Show a violin plot of total counts',
  'Generate a gene expression heatmap',
  'What QC filters would you recommend?',
  'How many low-quality cells should I remove?',
  'What clustering resolution do you suggest?',
  'Explain the QC metrics for this dataset',
]

// ── QC Summary card ───────────────────────────────────────────────────────────
function QCSummary({ qc }) {
  const [expanded, setExpanded] = useState(false)
  const items = [
    { label: 'Total cells',          value: qc.n_cells?.toLocaleString() },
    { label: 'Total genes',          value: qc.n_genes?.toLocaleString() },
    { label: 'Median UMI / cell',    value: qc.median_counts?.toFixed(0) },
    { label: 'Median genes / cell',  value: qc.median_genes?.toFixed(0) },
    { label: 'Mean mito %',          value: `${qc.mean_pct_mt?.toFixed(1)}%` },
    { label: 'Cells >20% mito',      value: `${qc.pct_cells_high_mt?.toFixed(1)}%` },
  ]

  return (
    <div className="card mb-4">
      <button
        className="flex items-center justify-between w-full"
        onClick={() => setExpanded((e) => !e)}
      >
        <span className="font-semibold text-white flex items-center gap-2">
          <BarChart2 size={16} className="text-brand-400" />
          QC Summary
        </span>
        {expanded ? <ChevronUp size={16} className="text-gray-500" /> : <ChevronDown size={16} className="text-gray-500" />}
      </button>

      {expanded && (
        <div className="mt-4 grid grid-cols-3 gap-3">
          {items.map(({ label, value }) => (
            <div key={label} className="bg-gray-800 rounded-lg p-3">
              <p className="text-xs text-gray-500 mb-1">{label}</p>
              <p className="text-lg font-bold text-white">{value ?? '—'}</p>
            </div>
          ))}
          {qc.samples && (
            <div className="col-span-3 bg-gray-800 rounded-lg p-3">
              <p className="text-xs text-gray-500 mb-2">Cells per sample</p>
              <div className="flex flex-wrap gap-2">
                {Object.entries(qc.samples).map(([k, v]) => (
                  <span key={k} className="badge bg-brand-900/40 text-brand-300">
                    {k}: {v.toLocaleString()}
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ── QC Plots grid ─────────────────────────────────────────────────────────────
function QCPlots({ plots }) {
  const [selected, setSelected] = useState(null)
  return (
    <>
      <div className="grid grid-cols-2 gap-3 mb-4">
        {plots.map((p, i) => (
          <div
            key={i}
            className="card p-3 cursor-pointer hover:border-brand-600 transition-colors"
            onClick={() => setSelected(p)}
          >
            <p className="text-xs text-gray-500 mb-2">{p.title}</p>
            <img src={`data:image/png;base64,${p.image}`} alt={p.title} className="w-full rounded" />
          </div>
        ))}
      </div>

      {/* Lightbox */}
      {selected && (
        <div
          className="fixed inset-0 bg-black/80 z-50 flex items-center justify-center p-8"
          onClick={() => setSelected(null)}
        >
          <div className="relative max-w-4xl w-full" onClick={(e) => e.stopPropagation()}>
            <button
              className="absolute -top-8 right-0 text-gray-400 hover:text-white"
              onClick={() => setSelected(null)}
            >
              <X size={20} />
            </button>
            <p className="text-white font-medium mb-2">{selected.title}</p>
            <img src={`data:image/png;base64,${selected.image}`} alt={selected.title} className="w-full rounded-xl" />
          </div>
        </div>
      )}
    </>
  )
}

// ── Chat message ──────────────────────────────────────────────────────────────
function ChatMessage({ msg }) {
  const isUser = msg.role === 'user'
  return (
    <div className={`flex gap-3 msg-enter ${isUser ? 'flex-row-reverse' : ''}`}>
      <div className={`w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0 ${
        isUser ? 'bg-brand-600' : 'bg-gray-700'
      }`}>
        {isUser ? <User size={14} /> : <Bot size={14} className="text-brand-400" />}
      </div>
      <div className={`max-w-[80%] space-y-2 ${isUser ? 'items-end flex flex-col' : ''}`}>
        <div className={`rounded-xl px-4 py-3 text-sm ${
          isUser ? 'bg-brand-600/20 text-gray-100' : 'bg-gray-800 text-gray-200'
        }`}>
          {isUser ? (
            <p>{msg.content}</p>
          ) : (
            <ReactMarkdown
              remarkPlugins={[remarkGfm]}
              components={{
                code: ({ inline, children }) =>
                  inline
                    ? <code className="bg-gray-900 px-1 py-0.5 rounded text-xs font-mono text-green-400">{children}</code>
                    : <pre className="bg-gray-900 rounded-lg p-3 overflow-auto text-xs font-mono text-green-400 my-2 whitespace-pre-wrap">{children}</pre>,
                table: ({ children }) => <table className="text-xs border-collapse w-full my-2">{children}</table>,
                th: ({ children }) => <th className="border border-gray-700 px-2 py-1 text-left text-gray-400">{children}</th>,
                td: ({ children }) => <td className="border border-gray-700 px-2 py-1">{children}</td>,
              }}
            >
              {msg.content}
            </ReactMarkdown>
          )}
        </div>
        {/* Inline plot if present */}
        {msg.plot && (
          <div className="rounded-xl overflow-hidden border border-gray-700 max-w-lg">
            <p className="text-xs text-gray-500 px-3 py-1.5 bg-gray-800">{msg.plot_title}</p>
            <img src={`data:image/png;base64,${msg.plot}`} alt={msg.plot_title} className="w-full" />
          </div>
        )}
        <p className="text-xs text-gray-600 px-1">{new Date(msg.ts).toLocaleTimeString()}</p>
      </div>
    </div>
  )
}

// ── Upload dropzone ───────────────────────────────────────────────────────────
function UploadZone({ onUploaded }) {
  const [uploading, setUploading] = useState(false)
  const [progress, setProgress] = useState(0)

  const onDrop = useCallback(async (accepted) => {
    const file = accepted[0]
    if (!file) return
    setUploading(true)
    setProgress(0)
    try {
      const result = await uploadH5ad(file, setProgress)
      onUploaded(result)
      toast.success('h5ad loaded — QC computed!')
    } catch (err) {
      toast.error(err?.response?.data?.detail || 'Upload failed')
    } finally {
      setUploading(false)
    }
  }, [onUploaded])

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: {
      'application/octet-stream': ['.h5ad', '.h5'],
      'application/x-hdf5': ['.h5', '.h5ad'],
    },
    multiple: false,
    disabled: uploading,
  })

  return (
    <div className="flex-1 flex items-center justify-center p-8">
      <div className="max-w-lg w-full">
        <div className="text-center mb-8">
          <div className="w-16 h-16 rounded-2xl bg-brand-600/20 flex items-center justify-center mx-auto mb-4">
            <FlaskConical size={32} className="text-brand-400" />
          </div>
          <h1 className="text-2xl font-bold text-white mb-2">Analyze h5ad</h1>
          <p className="text-gray-500 text-sm">
            Upload an AnnData (.h5ad) file to get an instant QC report and chat with the AI agent to generate plots and analyze your scRNASeq data.
          </p>
        </div>

        <div
          {...getRootProps()}
          className={clsx(
            'border-2 border-dashed rounded-2xl p-12 text-center cursor-pointer transition-all',
            isDragActive ? 'border-brand-500 bg-brand-900/20' : 'border-gray-700 hover:border-gray-600 hover:bg-gray-800/30',
            uploading && 'pointer-events-none opacity-60'
          )}
        >
          <input {...getInputProps()} />
          {uploading ? (
            <div>
              <Loader2 size={32} className="animate-spin text-brand-400 mx-auto mb-3" />
              <p className="text-gray-400 text-sm">Uploading & computing QC… {progress}%</p>
              <div className="h-1.5 bg-gray-800 rounded-full mt-3 overflow-hidden">
                <div className="h-full bg-brand-500 rounded-full transition-all" style={{ width: `${progress}%` }} />
              </div>
            </div>
          ) : (
            <>
              <Upload size={32} className="text-gray-600 mx-auto mb-3" />
              <p className="text-gray-300 font-medium mb-1">
                {isDragActive ? 'Drop it here' : 'Drop your .h5 or .h5ad file here'}
              </p>
              <p className="text-gray-600 text-sm">or click to browse · supports 10x .h5 and AnnData .h5ad</p>
            </>
          )}
        </div>

        <p className="text-center text-xs text-gray-600 mt-4">
          Files are processed locally on the server — not sent to any external service
        </p>
      </div>
    </div>
  )
}

// ── Main page ─────────────────────────────────────────────────────────────────
export default function Analyze() {
  const [session, setSession] = useState(null)   // {session_id, qc, plots, filename}
  const [messages, setMessages] = useState([])
  const [input, setInput] = useState('')
  const [sending, setSending] = useState(false)
  const [activeTab, setActiveTab] = useState('qc')
  const bottomRef = useRef(null)
  const inputRef = useRef(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  const handleUploaded = (result) => {
    setSession(result)
    setActiveTab('qc')
    setMessages([{
      role: 'assistant',
      content: `I've loaded **${result.filename}** and computed QC metrics.\n\n` +
        `**Dataset:** ${result.qc.n_cells?.toLocaleString()} cells × ${result.qc.n_genes?.toLocaleString()} genes\n` +
        `**Median UMI/cell:** ${result.qc.median_counts?.toFixed(0)} | **Median genes/cell:** ${result.qc.median_genes?.toFixed(0)}\n` +
        `**Mean mito %:** ${result.qc.mean_pct_mt?.toFixed(1)}%\n\n` +
        `Ask me to generate plots, recommend QC filters, or analyze the data!`,
      ts: Date.now(),
    }])
  }

  const sendMessage = async (text) => {
    const msg = (text || input).trim()
    if (!msg || sending || !session) return
    setInput('')
    setActiveTab('chat')

    const userMsg = { role: 'user', content: msg, ts: Date.now() }
    setMessages((prev) => [...prev, userMsg])
    setSending(true)

    try {
      const history = messages.map((m) => ({ role: m.role, content: m.content }))
      const res = await analyzeChat(session.session_id, msg, history)
      setMessages((prev) => [...prev, {
        role: 'assistant',
        content: res.response,
        plot: res.plot || null,
        plot_title: res.plot_title || null,
        ts: Date.now(),
      }])
    } catch (err) {
      setMessages((prev) => [...prev, {
        role: 'assistant',
        content: `Error: ${err?.response?.data?.detail || 'Something went wrong'}`,
        ts: Date.now(),
      }])
    } finally {
      setSending(false)
      inputRef.current?.focus()
    }
  }

  const handleKey = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage() }
  }

  if (!session) return <UploadZone onUploaded={handleUploaded} />

  return (
    <div className="flex h-screen overflow-hidden">
      {/* Left: QC report */}
      <div className="w-[420px] flex-shrink-0 border-r border-gray-800 flex flex-col">
        {/* Header */}
        <div className="px-5 py-4 border-b border-gray-800 flex items-center justify-between">
          <div>
            <p className="font-semibold text-white text-sm truncate max-w-[280px]">{session.filename}</p>
            <p className="text-xs text-gray-500 mt-0.5">
              {session.qc.n_cells?.toLocaleString()} cells · {session.qc.n_genes?.toLocaleString()} genes
            </p>
          </div>
          <button
            onClick={() => { setSession(null); setMessages([]) }}
            className="text-gray-600 hover:text-gray-400 transition-colors"
            title="Load different file"
          >
            <X size={16} />
          </button>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-gray-800">
          {['qc', 'plots'].map((t) => (
            <button
              key={t}
              onClick={() => setActiveTab(t)}
              className={`flex-1 py-2.5 text-sm font-medium capitalize transition-colors border-b-2 -mb-px ${
                activeTab === t ? 'border-brand-500 text-brand-400' : 'border-transparent text-gray-500 hover:text-gray-300'
              }`}
            >
              {t === 'qc' ? 'QC Metrics' : 'QC Plots'}
            </button>
          ))}
        </div>

        <div className="flex-1 overflow-y-auto p-4">
          {activeTab === 'qc' && <QCSummary qc={session.qc} />}
          {activeTab === 'plots' && <QCPlots plots={session.plots} />}
        </div>
      </div>

      {/* Right: AI Chat */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Chat header */}
        <div className="px-6 py-4 border-b border-gray-800 flex items-center gap-3">
          <div className="w-8 h-8 rounded-full bg-brand-600/20 flex items-center justify-center">
            <Sparkles size={16} className="text-brand-400" />
          </div>
          <div>
            <h2 className="font-semibold text-white text-sm">scRNASeq AI Agent</h2>
            <p className="text-xs text-gray-500">Ask for plots, QC advice, or analysis guidance</p>
          </div>
        </div>

        {/* Messages */}
        <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
          {messages.map((msg, i) => <ChatMessage key={i} msg={msg} />)}
          {sending && (
            <div className="flex gap-3 msg-enter">
              <div className="w-7 h-7 rounded-full bg-gray-700 flex items-center justify-center">
                <Bot size={14} className="text-brand-400" />
              </div>
              <div className="bg-gray-800 rounded-xl px-4 py-3">
                <div className="flex gap-1 items-center">
                  {[0, 150, 300].map((d) => (
                    <span key={d} className="w-1.5 h-1.5 bg-brand-400 rounded-full animate-bounce"
                      style={{ animationDelay: `${d}ms` }} />
                  ))}
                </div>
              </div>
            </div>
          )}
          <div ref={bottomRef} />
        </div>

        {/* Suggestions */}
        {messages.length <= 1 && (
          <div className="px-6 pb-2">
            <p className="text-xs text-gray-600 mb-2">Try asking:</p>
            <div className="flex flex-wrap gap-2">
              {SUGGESTIONS.slice(0, 6).map((s) => (
                <button
                  key={s}
                  onClick={() => sendMessage(s)}
                  className="text-xs bg-gray-800 hover:bg-gray-700 text-gray-400 hover:text-gray-200 px-3 py-1.5 rounded-full transition-colors"
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Input */}
        <div className="px-6 py-4 border-t border-gray-800">
          <div className="flex gap-3 items-end">
            <textarea
              ref={inputRef}
              rows={1}
              className="input resize-none flex-1 py-3 max-h-32"
              placeholder="Ask for a plot, QC advice, or analysis…"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKey}
              onInput={(e) => {
                e.target.style.height = 'auto'
                e.target.style.height = Math.min(e.target.scrollHeight, 128) + 'px'
              }}
            />
            <button
              onClick={() => sendMessage()}
              disabled={!input.trim() || sending}
              className="btn-primary p-3 flex-shrink-0"
            >
              {sending ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />}
            </button>
          </div>
          <p className="text-xs text-gray-600 mt-2">Enter to send · Shift+Enter for new line</p>
        </div>
      </div>
    </div>
  )
}
