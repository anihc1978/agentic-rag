# Agentic RAG

> Retrieval-augmented Q&A where Claude *searches* your documents with tools instead of relying on pre-built embeddings.

**🔗 Live demo:** https://agentic-rag-roan.vercel.app

Upload a set of documents (PDF, TXT, Markdown, HTML) and ask a question. Instead of chunking and embedding everything up front, Claude is given a small toolbox — `list_files`, `grep`, and `read_file` — and runs an agentic tool-call loop to navigate the corpus the way a developer would: list what's there, grep for relevant lines, then read the surrounding context. Every tool call and result is streamed to the UI in real time, so you can watch the model's reasoning trail before the cited answer arrives.

## Features

- **Agentic tool-use retrieval** — Claude decides which documents to open and what to search for, looping over `list_files` → `grep` → `read_file` until it has enough evidence (no vector database or pre-embedding step).
- **Live streamed reasoning** — each tool call, tool result, and answer token is pushed to the browser over Server-Sent Events and rendered as a collapsible "Agent reasoning" timeline.
- **Multi-format ingestion** — uploads are parsed server-side: PDFs via `pdf-parse`, HTML via `cheerio` (scripts/styles stripped), and plain text/Markdown directly.
- **Cited answers** — the system prompt requires Claude to name the source file and quote the passage it drew from, and to say so plainly when the answer isn't in the docs.
- **Drag-and-drop knowledge base** — manage an in-session document list (add, remove, clear) with file sizes and dedup by filename.
- **Hardened API route** — origin allow-list, a hard cap of 20 tool calls per request, and bounded grep (pattern length, result count, bytes scanned) to keep runaway loops in check.

## How it works

The frontend is a Next.js (App Router) client component that uploads files to `POST /api/upload`, which extracts plain text and returns it; the extracted documents live in React state and are sent along with each question. `POST /api/search` runs the agent: it calls the Anthropic Messages API (`@anthropic-ai/sdk`, model `claude-sonnet-4-6`) with the three retrieval tools and loops — dispatching each `tool_use` block against the in-memory documents and feeding the results back — until the model returns `end_turn` or hits the tool-call ceiling. The route returns a `ReadableStream` of Server-Sent Events (`text`, `tool_call`, `tool_result`, `done`), which the client parses incrementally to render reasoning steps and the streaming answer. The `ANTHROPIC_API_KEY` is read from `process.env` inside the server route only and is never exposed to the browser.

## Tech stack

- **Framework:** Next.js 16 (App Router, Route Handlers) on React 19
- **Language:** TypeScript
- **AI:** Anthropic Claude (`claude-sonnet-4-6`) via `@anthropic-ai/sdk`, driven in a tool-use loop with `list_files` / `grep` / `read_file`
- **Document parsing:** `pdf-parse` (PDF), `cheerio` (HTML)
- **UI:** Tailwind CSS v4, `lucide-react` icons
- **Storage:** in-session React state (no database; documents are sent with each request)
- **Hosting:** Vercel

## Running locally

```bash
npm install
npm run dev
```

Then open http://localhost:3000.

## Environment variables

| Variable | Purpose |
|---|---|
| `ANTHROPIC_API_KEY` | Server-side key for the Anthropic Messages API. Used only inside the `/api/search` route handler; never sent to the client. |

---
*Part of my AI engineering portfolio — built by Eduardo San Martin ([github.com/anihc1978](https://github.com/anihc1978)).*
