import { NextRequest } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'

const MAX_TOOL_CALLS = 20
const MAX_READ_CHARS = 12000
const MAX_GREP_RESULTS = 30
const MAX_PATTERN_LENGTH = 200
const MAX_GREP_BYTES = 2_000_000

interface Doc { name: string; content: string }

function toolListFiles(docs: Doc[]): string {
  if (!docs.length) return 'No documents uploaded yet.'
  return docs.map(d => d.name).join('\n')
}

function toolGrep(docs: Doc[], pattern: string): string {
  if (!docs.length) return 'No documents to search.'
  if (pattern.length > MAX_PATTERN_LENGTH) {
    return `Invalid pattern: too long (max ${MAX_PATTERN_LENGTH} characters).`
  }

  let re: RegExp
  try {
    re = new RegExp(pattern, 'gi')
  } catch {
    return `Invalid pattern: ${pattern}`
  }

  const results: string[] = []
  let bytesSearched = 0

  for (const doc of docs) {
    const lines = doc.content.split('\n')
    for (let i = 0; i < lines.length; i++) {
      bytesSearched += lines[i].length
      if (bytesSearched > MAX_GREP_BYTES) return results.join('\n')
      if (re.test(lines[i])) {
        results.push(`${doc.name}:${i + 1}: ${lines[i].trim()}`)
        if (results.length >= MAX_GREP_RESULTS) return results.join('\n')
      }
      re.lastIndex = 0
    }
  }

  return results.length ? results.join('\n') : `No matches found for pattern: ${pattern}`
}

function toolReadFile(docs: Doc[], name: string, startLine?: number, endLine?: number): string {
  const doc = docs.find(d => d.name === name)
  if (!doc) return `File not found: ${name}`

  const lines = doc.content.split('\n')
  const start = Math.max(0, (startLine ?? 1) - 1)
  const end = Math.min(lines.length, endLine ?? lines.length)
  const slice = lines.slice(start, end).join('\n')

  return slice.length > MAX_READ_CHARS
    ? slice.slice(0, MAX_READ_CHARS) + `\n[truncated — ${lines.length} total lines]`
    : slice
}

function dispatchTool(docs: Doc[], name: string, input: Record<string, unknown>): string {
  switch (name) {
    case 'list_files': return toolListFiles(docs)
    case 'grep': return toolGrep(docs, String(input.pattern ?? ''))
    case 'read_file': return toolReadFile(
      docs,
      String(input.filename ?? ''),
      input.start_line ? Number(input.start_line) : undefined,
      input.end_line ? Number(input.end_line) : undefined
    )
    default: return `Unknown tool: ${name}`
  }
}

const TOOLS: Anthropic.Tool[] = [
  {
    name: 'list_files',
    description: 'List all available documents in the knowledge base.',
    input_schema: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'grep',
    description: 'Search for a regex pattern across all documents. Returns matching lines with file name and line number.',
    input_schema: {
      type: 'object',
      properties: { pattern: { type: 'string', description: 'Regex pattern to search for' } },
      required: ['pattern'],
    },
  },
  {
    name: 'read_file',
    description: 'Read the content of a specific document. Optionally limit to a line range.',
    input_schema: {
      type: 'object',
      properties: {
        filename: { type: 'string', description: 'Exact filename to read' },
        start_line: { type: 'number', description: 'First line to read (1-indexed)' },
        end_line: { type: 'number', description: 'Last line to read (inclusive)' },
      },
      required: ['filename'],
    },
  },
]

const ALLOWED_ORIGINS = [
  'https://agentic-rag-roan.vercel.app',
  'http://localhost:3000',
  'http://localhost:3001',
]

// This project's deployment / preview aliases all share the agentic-rag-*.vercel.app prefix.
function isAllowedOrigin(origin: string): boolean {
  if (ALLOWED_ORIGINS.includes(origin)) return true
  return /^https:\/\/agentic-rag-[a-z0-9-]+\.vercel\.app$/.test(origin)
}

const SYSTEM = `You are an expert research assistant with access to a knowledge base of documents.
Use your tools strategically to find the best answer:
1. Start by listing files to understand what's available
2. Use grep to quickly locate relevant sections
3. Use read_file to get full context where needed
4. Follow evidence trails across multiple documents if helpful

Always cite your sources: include the filename and a brief quote from where you found the answer.
Be concise but thorough. If information is not in the documents, say so clearly.`

export async function POST(req: NextRequest) {
  const origin = req.headers.get('origin')
  if (origin && !isAllowedOrigin(origin)) {
    return new Response(JSON.stringify({ error: 'Origin not allowed' }), { status: 403 })
  }

  const { question, docs } = await req.json() as { question: string; docs: Doc[] }

  if (!question?.trim()) {
    return new Response(JSON.stringify({ error: 'No question provided' }), { status: 400 })
  }
  if (!docs?.length) {
    return new Response(JSON.stringify({ error: 'No documents provided' }), { status: 400 })
  }

  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! })
  const encoder = new TextEncoder()

  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: object) =>
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`))

      const messages: Anthropic.MessageParam[] = [
        { role: 'user', content: question }
      ]

      let toolCallCount = 0

      try {
        while (true) {
          const response = await anthropic.messages.create({
            model: 'claude-sonnet-4-6',
            max_tokens: 4096,
            system: SYSTEM,
            tools: TOOLS,
            messages,
          })

          for (const block of response.content) {
            if (block.type === 'text') {
              send({ type: 'text', text: block.text })
            } else if (block.type === 'tool_use') {
              send({ type: 'tool_call', tool: block.name, input: block.input })
            }
          }

          messages.push({ role: 'assistant', content: response.content })

          if (response.stop_reason === 'end_turn') break

          if (response.stop_reason === 'tool_use') {
            const toolResults: Anthropic.ToolResultBlockParam[] = []

            for (const block of response.content) {
              if (block.type !== 'tool_use') continue
              toolCallCount++
              if (toolCallCount > MAX_TOOL_CALLS) {
                toolResults.push({ type: 'tool_result', tool_use_id: block.id, content: 'Tool call limit reached.' })
                continue
              }
              const result = dispatchTool(docs, block.name, block.input as Record<string, unknown>)
              send({ type: 'tool_result', tool: block.name, result: result.slice(0, 500) })
              toolResults.push({ type: 'tool_result', tool_use_id: block.id, content: result })
            }

            messages.push({ role: 'user', content: toolResults })
          }

          if (toolCallCount >= MAX_TOOL_CALLS) break
        }
      } catch (err) {
        send({ type: 'error', message: err instanceof Error ? err.message : String(err) })
      }

      send({ type: 'done' })
      controller.close()
    }
  })

  return new Response(stream, {
    headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' }
  })
}
