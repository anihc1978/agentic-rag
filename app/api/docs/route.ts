import { NextRequest, NextResponse } from 'next/server'
import { docStore } from '@/lib/doc-store'

export async function GET() {
  const docs = docStore.list().map(({ name, size, uploadedAt }) => ({ name, size, uploadedAt }))
  return NextResponse.json({ docs })
}

export async function DELETE(req: NextRequest) {
  const name = req.nextUrl.searchParams.get('name')
  if (name) {
    docStore.remove(name)
  } else {
    docStore.clear()
  }
  return NextResponse.json({ ok: true })
}
