import { NextRequest } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import { docStore } from '@/lib/doc-store'

const MAX_TOOL_CALLS = 20
const MAX_READ_CHARS = 12000
const MAX_GREP_RESULTS = 30

// Tool implementations
function toolListFiles(): string {
  const names = docStore.names()
  if (!names.length) return 'No documents uploaded yet.'
  return names.join('\n')
}

function toolGrep(pattern: string): string {
  const docs = docStore.list()
  if (!docs.length) return 'No documents to search.'

  const results: string[] = []
  const re = new RegExp(pattern, 'gi')

  for (const doc of docs) {
    const lines = doc.content.split('\n')
    for (let i = 0; i < lines.length; i++) {
      if (re.test(lines[i])) {
        results.push(`${doc.name}:${i + 1}: ${lines[i].trim()}`)
        if (results.length >= MAX_GREP_RESULTS) return results.join('\n')
      }
      re.lastIndex = 0
    }
  }

  return results.length ? results.join('\n') : `No matches found for pattern: ${pattern}`
}

function toolReadFile(name: string, startLine?: number, endLine?: number): string {
  const doc = docStore.get(name)
  if (!doc) return `File not found: ${name}`

  const lines = doc.content.split('\n')
  const start = Math.max(0, (startLine ?? 1) - 1)
  const end = Math.min(lines.length, endLine ?? lines.length)
  const slice = lines.slice(start, end).join('\n')

  return slice.length > MAX_READ_CHARS
    ? slice.slice(0, MAX_READ_CHARS) + `\n[truncated — ${lines.length} total lines]`
    : slice
}

function dispatchTool(name: string, input: Record<string, unknown>): string {
  switch (name) {
    case 'list_files': return toolListFiles()
    case 'grep': return toolGrep(String(input.pattern ?? ''))
    case 'read_file': return toolReadFile(
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

const SYSTEM = `You are an expert research assistant with access to a knowledge base of documents.
Use your tools strategically to find the best answer:
1. Start by listing files to understand what's available
2. Use grep to quickly locate relevant sections
3. Use read_file to get full context where needed
4. Follow evidence trails across multiple documents if helpful

Always cite your sources: include the filename and a brief quote from where you found the answer.
Be concise but thorough. If information is not in the documents, say so clearly.`

export async function POST(req: NextRequest) {
  const { question } = await req.json()
  if (!question?.trim()) {
    return new Response(JSON.stringify({ error: 'No question provided' }), { status: 400 })
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

          // Emit assistant content — both text and tool calls
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

              const result = dispatchTool(block.name, block.input as Record<string, unknown>)
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
