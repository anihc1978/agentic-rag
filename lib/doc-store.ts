export interface Doc {
  name: string
  content: string
  size: number
  uploadedAt: number
}

// Module-level store — persists across warm serverless invocations
const store: Map<string, Doc> = new Map()

export const docStore = {
  add(doc: Doc) { store.set(doc.name, doc) },
  get(name: string) { return store.get(name) },
  list(): Doc[] { return Array.from(store.values()) },
  names(): string[] { return Array.from(store.keys()) },
  clear() { store.clear() },
  remove(name: string) { store.delete(name) },
}
