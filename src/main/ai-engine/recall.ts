import { app } from 'electron'
import { mkdirSync } from 'fs'
import { join } from 'path'
import { atomicWrite, loadJson } from '../db/fsafe'
import { randomUUID } from 'crypto'
import type { WebContents } from 'electron'
import { embed } from './openai'
import { costUsd } from './cost'
import { scrapePage } from './scrape'
import * as store from '../db/store'

/**
 * Total Recall — a local semantic memory of everything the user reads.
 * Pages are embedded (text-embedding-3-small, ~free) and stored on disk.
 * Nothing ever leaves the machine except the embedding call itself.
 */

interface RecallEntry {
  id: string
  url: string
  title: string
  ts: number
  excerpt: string
  vector: number[]
}

const CAP = 5000
const MIN_TEXT = 600

let entries: RecallEntry[] | null = null
let filePath = ''
const recentUrls = new Map<string, number>() // url -> last captured ts

function load(): RecallEntry[] {
  if (entries) return entries
  const dir = join(app.getPath('userData'), 'nori-data')
  mkdirSync(dir, { recursive: true })
  filePath = join(dir, 'recall.json')
  entries = loadJson<RecallEntry[]>(filePath) ?? []
  return entries
}

let saveTimer: NodeJS.Timeout | null = null
function save(): void {
  if (saveTimer) clearTimeout(saveTimer)
  saveTimer = setTimeout(() => {
    saveTimer = null
    atomicWrite(filePath, JSON.stringify(load()))
  }, 500)
}

/** Write any pending debounced state NOW — called on app quit so nothing is lost. */
export function flush(): void {
  if (!saveTimer) return
  clearTimeout(saveTimer)
  saveTimer = null
  atomicWrite(filePath, JSON.stringify(load()))
}

export function isEnabled(): boolean {
  return store.getSetting('recall') !== 'off'
}

export function toggle(): boolean {
  const next = !isEnabled()
  store.setSetting('recall', next ? 'on' : 'off')
  return next
}

function skippable(url: string): boolean {
  if (!/^https?:\/\//.test(url)) return true
  return /google\.[a-z.]+\/(search|maps)|\/results\?search_query|duckduckgo\.com\/\?|bing\.com\/search/.test(
    url
  )
}

/** Capture the page into memory. Fire-and-forget; all failures are silent. */
export async function capturePage(wc: WebContents): Promise<void> {
  try {
    if (!isEnabled() || wc.isDestroyed()) return
    const url = wc.getURL()
    if (skippable(url)) return
    const last = recentUrls.get(url)
    if (last && Date.now() - last < 24 * 3600 * 1000) return
    const snap = await scrapePage(wc)
    if (!snap || snap.text.length < MIN_TEXT) return

    const doc = [snap.title, snap.headings.slice(0, 15).join('\n'), snap.text.slice(0, 4000)]
      .filter(Boolean)
      .join('\n\n')
    const { vector, inputTokens } = await embed(doc)
    store.logCost('text-embedding-3-small', inputTokens, 0, costUsd('text-embedding-3-small', inputTokens, 0), 'recall')

    const list = load()
    // Replace older capture of the same URL.
    const idx = list.findIndex((e) => e.url === url)
    if (idx !== -1) list.splice(idx, 1)
    list.push({
      id: randomUUID(),
      url,
      title: snap.title || url,
      ts: Date.now(),
      excerpt: snap.text.slice(0, 320).replace(/\s+/g, ' '),
      vector
    })
    if (list.length > CAP) list.splice(0, list.length - CAP)
    recentUrls.set(url, Date.now())
    save()
  } catch {
    // memory capture must never break browsing
  }
}

function cosine(a: number[], b: number[]): number {
  let dot = 0
  let na = 0
  let nb = 0
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i]
    na += a[i] * a[i]
    nb += b[i] * b[i]
  }
  return dot / (Math.sqrt(na) * Math.sqrt(nb) || 1)
}

export interface RecallHit {
  title: string
  url: string
  date: string
  excerpt: string
  score: number
}

/** Semantic search over browsing memory. */
export async function searchRecall(query: string, daysBack?: number): Promise<RecallHit[]> {
  const list = load()
  if (!list.length) return []
  const { vector, inputTokens } = await embed(query)
  store.logCost('text-embedding-3-small', inputTokens, 0, costUsd('text-embedding-3-small', inputTokens, 0), 'recall')
  const cutoff = daysBack ? Date.now() - daysBack * 24 * 3600 * 1000 : 0
  return list
    .filter((e) => e.ts >= cutoff)
    .map((e) => ({
      title: e.title,
      url: e.url,
      date: new Date(e.ts).toISOString().slice(0, 10),
      excerpt: e.excerpt,
      score: cosine(vector, e.vector)
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 8)
}

export function recallCount(): number {
  return load().length
}
