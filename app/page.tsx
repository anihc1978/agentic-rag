'use client'

import { useState, useRef, useCallback } from 'react'
import {
  Search, Upload, FileText, Trash2, Loader2, Sparkles,
  ChevronDown, ChevronUp, List, Terminal, Eye, CheckCircle2, X, AlertCircle
} from 'lucide-react'
import { cn } from '@/lib/utils'

interface Doc { name: string; size: number; uploadedAt: number }

interface Step {
  type: 'tool_call' | 'tool_result' | 'text' | 'error'
  tool?: string
  input?: Record<string, unknown>
  result?: string
  text?: string
  message?: string
}

const TOOL_ICON: Record<string, React.ReactNode> = {
  list_files: <List className="h-3.5 w-3.5" />,
  grep: <Terminal className="h-3.5 w-3.5" />,
  read_file: <Eye className="h-3.5 w-3.5" />,
}

const TOOL_COLOR: Record<string, string> = {
  list_files: '#8b5cf6',
  grep: '#f59e0b',
  read_file: '#3b82f6',
}

function formatBytes(b: number) {
  if (b < 1024) return `${b} B`
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`
  return `${(b / (1024 * 1024)).toFixed(1)} MB`
}

export default function Home() {
  const [docs, setDocs] = useState<Doc[]>([])
  const [uploading, setUploading] = useState(false)
  const [question, setQuestion] = useState('')
  const [steps, setSteps] = useState<Step[]>([])
  const [answer, setAnswer] = useState('')
  const [searching, setSearching] = useState(false)
  const [stepsOpen, setStepsOpen] = useState(true)
  const [dragOver, setDragOver] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  const refreshDocs = useCallback(async () => {
    const res = await fetch('/api/docs')
    const data = await res.json()
    setDocs(data.docs ?? [])
  }, [])

  const uploadFiles = async (files: FileList | File[]) => {
    const arr = Array.from(files)
    if (!arr.length) return
    setUploading(true)
    const form = new FormData()
    arr.forEach(f => form.append('files', f))
    await fetch('/api/upload', { method: 'POST', body: form })
    await refreshDocs()
    setUploading(false)
  }

  const deleteDoc = async (name: string) => {
    await fetch(`/api/docs?name=${encodeURIComponent(name)}`, { method: 'DELETE' })
    setDocs(prev => prev.filter(d => d.name !== name))
  }

  const clearAll = async () => {
    await fetch('/api/docs', { method: 'DELETE' })
    setDocs([])
  }

  const search = async () => {
    const q = question.trim()
    if (!q || searching || !docs.length) return
    setSteps([])
    setAnswer('')
    setSearching(true)
    setStepsOpen(true)

    const res = await fetch('/api/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ question: q }),
    })

    if (!res.body) { setSearching(false); return }
    const reader = res.body.getReader()
    const dec = new TextDecoder()
    let buf = ''

    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      buf += dec.decode(value, { stream: true })
      const lines = buf.split('\n'); buf = lines.pop() ?? ''
      for (const line of lines) {
        if (!line.startsWith('data: ')) continue
        try {
          const event = JSON.parse(line.slice(6))
          if (event.type === 'done') break
          if (event.type === 'text') {
            setAnswer(prev => prev + event.text)
          } else {
            setSteps(prev => [...prev, event as Step])
          }
        } catch { /* ignore */ }
      }
    }
    setSearching(false)
  }

  return (
    <div className="min-h-screen" style={{ background: 'var(--bg)' }}>
      <header className="border-b px-6 py-4 flex items-center gap-3"
        style={{ borderColor: 'var(--border)', background: 'var(--bg-card)' }}>
        <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ background: 'rgba(16,185,129,0.15)' }}>
          <Search className="h-4 w-4" style={{ color: '#10b981' }} />
        </div>
        <div>
          <h1 className="font-bold text-sm leading-tight">Agentic RAG</h1>
          <p className="text-[11px]" style={{ color: 'var(--muted)' }}>Claude searches your docs using tools — no pre-embedding needed</p>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-4 py-8 space-y-6">

        {/* Upload zone */}
        <div
          onDragOver={e => { e.preventDefault(); setDragOver(true) }}
          onDragLeave={() => setDragOver(false)}
          onDrop={e => { e.preventDefault(); setDragOver(false); uploadFiles(e.dataTransfer.files) }}
          onClick={() => fileRef.current?.click()}
          className={cn(
            'rounded-xl border-2 border-dashed p-8 text-center cursor-pointer transition-colors',
            dragOver ? 'border-emerald-500 bg-emerald-500/5' : 'hover:border-emerald-500/50'
          )}
          style={{ borderColor: dragOver ? '#10b981' : 'var(--border)' }}>
          <input ref={fileRef} type="file" multiple accept=".pdf,.txt,.md,.html"
            className="hidden" onChange={e => e.target.files && uploadFiles(e.target.files)} />
          {uploading
            ? <div className="flex items-center justify-center gap-2" style={{ color: 'var(--muted)' }}>
                <Loader2 className="h-5 w-5 animate-spin" /><span className="text-sm">Processing…</span>
              </div>
            : <div className="space-y-1">
                <Upload className="h-7 w-7 mx-auto mb-2" style={{ color: '#10b981' }} />
                <p className="text-sm font-medium">Drop files here or click to upload</p>
                <p className="text-xs" style={{ color: 'var(--muted)' }}>PDF, TXT, Markdown, HTML</p>
              </div>
          }
        </div>

        {/* Doc list */}
        {docs.length > 0 && (
          <div className="rounded-xl border" style={{ background: 'var(--bg-card)', borderColor: 'var(--border)' }}>
            <div className="px-4 py-3 border-b flex items-center justify-between" style={{ borderColor: 'var(--border)' }}>
              <p className="text-sm font-semibold flex items-center gap-2">
                <FileText className="h-4 w-4" style={{ color: '#10b981' }} />
                Knowledge Base <span className="text-xs font-normal px-1.5 py-0.5 rounded-full"
                  style={{ background: 'rgba(16,185,129,0.1)', color: '#10b981' }}>{docs.length}</span>
              </p>
              <button onClick={clearAll} className="flex items-center gap-1 text-xs hover:opacity-70 transition-opacity"
                style={{ color: '#e74c3c' }}>
                <Trash2 className="h-3 w-3" />Clear all
              </button>
            </div>
            <div className="divide-y" style={{ '--tw-divide-opacity': 1 } as React.CSSProperties}>
              {docs.map(doc => (
                <div key={doc.name} className="px-4 py-2.5 flex items-center justify-between">
                  <div className="flex items-center gap-2.5 min-w-0">
                    <FileText className="h-3.5 w-3.5 shrink-0" style={{ color: 'var(--muted)' }} />
                    <span className="text-sm truncate">{doc.name}</span>
                    <span className="text-xs shrink-0" style={{ color: 'var(--muted)' }}>{formatBytes(doc.size)}</span>
                  </div>
                  <button onClick={() => deleteDoc(doc.name)} className="p-1 rounded hover:opacity-70 transition-opacity shrink-0 ml-2"
                    style={{ color: 'var(--muted)' }}>
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Question input */}
        <div className="rounded-xl border p-4 space-y-3" style={{ background: 'var(--bg-card)', borderColor: 'var(--border)' }}>
          <div className="flex gap-2">
            <input
              value={question}
              onChange={e => setQuestion(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && search()}
              placeholder={docs.length ? 'Ask anything about your documents…' : 'Upload documents first, then ask a question'}
              disabled={!docs.length || searching}
              className="flex-1 rounded-xl px-4 py-3 text-sm outline-none disabled:opacity-50"
              style={{ background: 'var(--bg-input)', border: '1px solid var(--border)', color: 'var(--text)' }}
            />
            <button onClick={search} disabled={!question.trim() || !docs.length || searching}
              className="flex items-center gap-2 px-5 py-3 rounded-xl text-sm font-semibold disabled:opacity-40 transition-opacity"
              style={{ background: '#10b981', color: '#fff' }}>
              {searching
                ? <><Loader2 className="h-4 w-4 animate-spin" />Searching…</>
                : <><Sparkles className="h-4 w-4" />Search</>}
            </button>
          </div>
          {docs.length > 0 && (
            <div className="flex flex-wrap gap-2">
              <span className="text-xs" style={{ color: 'var(--muted)' }}>Try:</span>
              {[
                'What are the main topics covered?',
                'Summarise the key findings',
                'What are the action items?',
              ].map(s => (
                <button key={s} onClick={() => setQuestion(s)}
                  className="text-xs px-2.5 py-1 rounded-full border hover:opacity-80 transition-opacity"
                  style={{ borderColor: 'var(--border)', color: 'var(--muted)' }}>{s}</button>
              ))}
            </div>
          )}
        </div>

        {/* Reasoning steps */}
        {steps.length > 0 && (
          <div className="rounded-xl border" style={{ background: 'var(--bg-card)', borderColor: 'var(--border)' }}>
            <button
              onClick={() => setStepsOpen(p => !p)}
              className="w-full px-4 py-3 flex items-center justify-between text-sm hover:opacity-80 transition-opacity">
              <span className="font-semibold flex items-center gap-2">
                <Terminal className="h-4 w-4" style={{ color: '#f59e0b' }} />
                Agent reasoning
                {searching && <Loader2 className="h-3.5 w-3.5 animate-spin ml-1" style={{ color: 'var(--muted)' }} />}
                <span className="text-xs font-normal px-1.5 py-0.5 rounded-full"
                  style={{ background: 'rgba(245,158,11,0.1)', color: '#f59e0b' }}>
                  {steps.length} steps
                </span>
              </span>
              {stepsOpen ? <ChevronUp className="h-4 w-4" style={{ color: 'var(--muted)' }} /> : <ChevronDown className="h-4 w-4" style={{ color: 'var(--muted)' }} />}
            </button>

            {stepsOpen && (
              <div className="border-t px-4 py-3 space-y-2" style={{ borderColor: 'var(--border)' }}>
                {steps.map((step, i) => (
                  <div key={i} className="text-xs rounded-lg p-2.5 space-y-1"
                    style={{ background: 'var(--bg-input)' }}>
                    {step.type === 'tool_call' && (
                      <div className="flex items-center gap-2 font-mono">
                        <span style={{ color: TOOL_COLOR[step.tool!] ?? '#6366f1' }}>
                          {TOOL_ICON[step.tool!] ?? <Terminal className="h-3.5 w-3.5" />}
                        </span>
                        <span style={{ color: TOOL_COLOR[step.tool!] ?? '#6366f1' }}>{step.tool}</span>
                        <span style={{ color: 'var(--muted)' }}>
                          {step.input && Object.entries(step.input).map(([k, v]) => `${k}="${v}"`).join(' ')}
                        </span>
                      </div>
                    )}
                    {step.type === 'tool_result' && (
                      <div>
                        <span className="flex items-center gap-1.5 mb-1" style={{ color: '#10b981' }}>
                          <CheckCircle2 className="h-3 w-3" />
                          <span className="font-semibold">Result from {step.tool}</span>
                        </span>
                        <pre className="whitespace-pre-wrap break-all leading-relaxed"
                          style={{ color: 'var(--muted)' }}>{step.result}</pre>
                      </div>
                    )}
                    {step.type === 'error' && (
                      <div className="flex items-center gap-1.5" style={{ color: '#e74c3c' }}>
                        <AlertCircle className="h-3 w-3" />
                        <span>{step.message}</span>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Final answer */}
        {answer && (
          <div className="rounded-xl border p-5" style={{ background: 'var(--bg-card)', borderColor: 'var(--border)' }}>
            <h2 className="text-sm font-semibold mb-3 flex items-center gap-2">
              <Sparkles className="h-4 w-4" style={{ color: '#10b981' }} />
              Answer
            </h2>
            <p className="text-sm leading-relaxed whitespace-pre-wrap" style={{ color: 'var(--muted)' }}>{answer}</p>
          </div>
        )}
      </main>
    </div>
  )
}
