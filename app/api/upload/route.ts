import { NextRequest, NextResponse } from 'next/server'

async function extractText(file: File): Promise<string> {
  const buffer = Buffer.from(await file.arrayBuffer())

  if (file.name.endsWith('.pdf')) {
    const pdfParse = require('pdf-parse') as (b: Buffer) => Promise<{ text: string }>
    const result = await pdfParse(buffer)
    return result.text
  }

  if (file.name.endsWith('.html') || file.name.endsWith('.htm')) {
    const { load } = await import('cheerio')
    const $ = load(buffer.toString('utf-8'))
    $('script, style').remove()
    return $('body').text().replace(/\s+/g, ' ').trim()
  }

  return buffer.toString('utf-8')
}

export async function POST(req: NextRequest) {
  const form = await req.formData()
  const files = form.getAll('files') as File[]

  if (!files.length) {
    return NextResponse.json({ error: 'No files provided' }, { status: 400 })
  }

  const results = []
  for (const file of files) {
    try {
      const content = await extractText(file)
      results.push({ name: file.name, content, size: file.size, ok: true })
    } catch (e) {
      results.push({ name: file.name, content: '', size: file.size, ok: false, error: String(e) })
    }
  }

  return NextResponse.json({ results })
}
