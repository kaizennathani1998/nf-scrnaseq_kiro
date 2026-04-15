import React, { useEffect, useState, useRef } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { Send, Bot, User, Loader2, BarChart2, FileText, Download, ArrowLeft, Sparkles } from 'lucide-react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { getRunOutputs, chatWithAgent } from '../api'
import { useStore } from '../store'
import toast from 'react-hot-toast'

// Suggested prompts for scRNASeq analysis
const SUGGESTIONS = [
  'Summarize the QC metrics for all samples',
  'How many cells passed filtering per sample?',
  'What are the top highly variable genes?',
  'Generate a UMAP plot description based on the data',
  'Identify potential doublets or low-quality cells',
  'Compare gene expression across samples',
  'What clustering resolution would you recommend?',
  'Describe the cell type composition',
]

function ChatMessage({ msg }) {
  const isUser = msg.role === 'user'
  return (
    <div className={`flex gap-3 msg-enter ${isUser ? 'flex-row-reverse' : ''}`}>
      <div className={`w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0 ${
        isUser ? 'bg-brand-600' : 'bg-gray-700'
      }`}>
        {isUser ? <User size={14} /> : <Bot size={14} className="text-brand-400" />}
      </div>
      <div className={`max-w-[80%] rounded-xl px-4 py-3 text-sm ${
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
                  : <pre className="bg-gray-900 rounded-lg p-3 overflow-auto text-xs font-mono text-green-400 my-2">{children}</pre>,
              table: ({ children }) => <table className="text-xs border-collapse w-full my-2">{children}</table>,
              th: ({ children }) => <th className="border border-gray-700 px-2 py-1 text-left text-gray-400">{children}</th>,
              td: ({ children }) => <td className="border border-gray-700 px-2 py-1">{children}</td>,
            }}
          >
            {msg.content}
          </ReactMarkdown>
        )}
        <p className="text-xs text-gray-600 mt-1">{new Date(msg.ts).toLocaleTimeString()}</p>
      </div>
    </div>
  )
}

function OutputFile({ file }) {
  return (
    <div className="flex items-center justify-between py-2 px-3 rounded-lg hover:bg-gray-800 group">
      <div className="flex items-center gap-2 min-w-0">
        <FileText size={14} className="text-gray-500 flex-shrink-0" />
        <span className="text-sm text-gray-300 truncate">{file.name}</span>
        <span className="text-xs text-gray-600">{file.size}</span>
      </div>
      <a
        href={file.url}
        target="_blank"
        rel="noreferrer"
        className="text-gray-600 hover:text-brand-400 opacity-0 group-hover:opacity-100 transition-all"
      >
        <Download size={14} />
      </a>
    </div>
  )
}

export default function Results() {
  const { runId } = useParams()
  const nav = useNavigate()
  const { runs, chatMessages, addMessage } = useStore()
  const run = runs.find((r) => r.id === runId)
  const messages = chatMessages[runId] || []

  const [outputs, setOutputs] = useState(null)
  const [input, setInput] = useState('')
  const [sending, setSending] = useState(false)
  const [activeTab, setActiveTab] = useState('chat')
  const bottomRef = useRef(null)
  const inputRef = useRef(null)

  useEffect(() => {
    getRunOutputs(runId)
      .then(setOutputs)
      .catch(() => toast.error('Failed to load outputs'))
  }, [runId])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  // Auto-greet
  useEffect(() => {
    if (messages.length === 0 && run) {
      addMessage(runId, {
        role: 'assistant',
        content: `Hi! I've analyzed the **${run.name}** pipeline results. I have access to the h5ad count matrices, QC metrics, and MultiQC report.\n\nWhat would you like to explore? You can ask me about cell counts, QC metrics, gene expression, or I can help you plan downstream analysis.`,
        ts: Date.now(),
      })
    }
  }, [run])

  const sendMessage = async (text) => {
    const msg = text || input.trim()
    if (!msg || sending) return
    setInput('')

    addMessage(runId, { role: 'user', content: msg, ts: Date.now() })
    setSending(true)

    try {
      const history = messages.map((m) => ({ role: m.role, content: m.content }))
      const res = await chatWithAgent(runId, msg, history)
      addMessage(runId, { role: 'assistant', content: res.response, ts: Date.now() })
    } catch (err) {
      addMessage(runId, {
        role: 'assistant',
        content: `Sorry, I encountered an error: ${err?.response?.data?.detail || 'Unknown error'}`,
        ts: Date.now(),
      })
    } finally {
      setSending(false)
      inputRef.current?.focus()
    }
  }

  const handleKey = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      sendMessage()
    }
  }

  // Group outputs by category
  const outputGroups = outputs
    ? Object.entries(
        outputs.files.reduce((acc, f) => {
          const cat = f.category || 'Other'
          acc[cat] = acc[cat] || []
          acc[cat].push(f)
          return acc
        }, {})
      )
    : []

  return (
    <div className="flex h-screen overflow-hidden">
      {/* Left panel: outputs */}
      <div className="w-72 flex-shrink-0 border-r border-gray-800 flex flex-col bg-gray-900">
        <div className="px-4 py-4 border-b border-gray-800">
          <button
            onClick={() => nav(`/runs/${runId}`)}
            className="flex items-center gap-1 text-xs text-gray-500 hover:text-gray-300 mb-3 transition-colors"
          >
            <ArrowLeft size={12} />
            Back to run
          </button>
          <h2 className="font-semibold text-white text-sm">{run?.name}</h2>
          <p className="text-xs text-gray-500 mt-0.5">Pipeline outputs</p>
        </div>

        <div className="flex-1 overflow-y-auto px-3 py-3">
          {!outputs ? (
            <div className="flex items-center gap-2 text-gray-500 text-sm py-4 px-2">
              <Loader2 size={14} className="animate-spin" />
              Loading outputs…
            </div>
          ) : outputGroups.length === 0 ? (
            <p className="text-gray-600 text-sm px-2 py-4">No output files found.</p>
          ) : (
            outputGroups.map(([cat, files]) => (
              <div key={cat} className="mb-4">
                <p className="text-xs font-medium text-gray-500 uppercase tracking-wider px-3 mb-1">{cat}</p>
                {files.map((f) => <OutputFile key={f.name} file={f} />)}
              </div>
            ))
          )}
        </div>

        {/* QC summary */}
        {outputs?.qc_summary && (
          <div className="border-t border-gray-800 px-4 py-3">
            <p className="text-xs font-medium text-gray-500 uppercase tracking-wider mb-2">QC Summary</p>
            <div className="space-y-1">
              {Object.entries(outputs.qc_summary).map(([k, v]) => (
                <div key={k} className="flex justify-between text-xs">
                  <span className="text-gray-500">{k}</span>
                  <span className="text-gray-300 font-medium">{v}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Right panel: AI chat */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Chat header */}
        <div className="px-6 py-4 border-b border-gray-800 flex items-center gap-3">
          <div className="w-8 h-8 rounded-full bg-brand-600/20 flex items-center justify-center">
            <Sparkles size={16} className="text-brand-400" />
          </div>
          <div>
            <h2 className="font-semibold text-white text-sm">AI Analysis Agent</h2>
            <p className="text-xs text-gray-500">Powered by Amazon Bedrock · HealthOmics MCP</p>
          </div>
        </div>

        {/* Messages */}
        <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
          {messages.map((msg, i) => (
            <ChatMessage key={i} msg={msg} />
          ))}
          {sending && (
            <div className="flex gap-3 msg-enter">
              <div className="w-7 h-7 rounded-full bg-gray-700 flex items-center justify-center">
                <Bot size={14} className="text-brand-400" />
              </div>
              <div className="bg-gray-800 rounded-xl px-4 py-3">
                <div className="flex gap-1 items-center">
                  <span className="w-1.5 h-1.5 bg-brand-400 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                  <span className="w-1.5 h-1.5 bg-brand-400 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                  <span className="w-1.5 h-1.5 bg-brand-400 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
                </div>
              </div>
            </div>
          )}
          <div ref={bottomRef} />
        </div>

        {/* Suggestions */}
        {messages.length <= 1 && (
          <div className="px-6 pb-2">
            <p className="text-xs text-gray-600 mb-2">Suggested questions:</p>
            <div className="flex flex-wrap gap-2">
              {SUGGESTIONS.slice(0, 4).map((s) => (
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
              placeholder="Ask about your scRNASeq results…"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKey}
              style={{ height: 'auto', minHeight: '44px' }}
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
