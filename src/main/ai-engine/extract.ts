import { app, shell } from 'electron'
import { writeFileSync } from 'fs'
import { join } from 'path'
import type { WebContents } from 'electron'
import { completeChat } from './openai'
import { costUsd, trimToBudget } from './cost'
import { scrapePage, snapshotToContext } from './scrape'
import * as store from '../db/store'

export interface ExtractResult {
  columns: string[]
  rows: string[][]
}

const SYSTEM = `You are Nori's data-extraction engine. Given page content and a target
description, return ONLY strict JSON: {"columns": ["..."], "rows": [["..."]]}.
Rules:
- columns: concise headers matching the fields the user wants. Include a "Source"
  column with the item's URL when links are available on the page.
- rows: ONLY real items found in the page content. Empty string for unknown cells.
  Never invent data. Skip navigation/ads/unrelated items.
- FILTERS: if the target contains a constraint (e.g. "under 1000", "in Hyderabad"),
  extract ALL items of the base entity type, include the constraint attribute as a
  column (e.g. Price), and keep only rows that clearly satisfy it — but if the
  attribute is missing or ambiguous for an item, INCLUDE the item anyway rather
  than dropping it. Never return empty columns because a filter is hard to verify.
- E-commerce/listing pages: item name + price (with currency symbol) + link is the
  default schema when the user says "products".
- If specific columns are requested (prior schema), use exactly those columns in
  that order.
- If you truly find zero items of the requested type, still return the natural
  columns for the target with "rows": [].`

/** Tolerantly pull {columns, rows} out of whatever JSON shape the model returned. */
function coerceTable(parsed: unknown): ExtractResult {
  const tryShape = (o: unknown): ExtractResult | null => {
    if (!o || typeof o !== 'object') return null
    const obj = o as Record<string, unknown>
    if (Array.isArray(obj.columns)) {
      return {
        columns: (obj.columns as unknown[]).map(String),
        rows: Array.isArray(obj.rows)
          ? (obj.rows as unknown[])
              .filter(Array.isArray)
              .map((r) => (r as unknown[]).map((c) => String(c ?? '')))
          : []
      }
    }
    return null
  }
  const direct = tryShape(parsed)
  if (direct) return direct
  // nested one level (e.g. {"table": {...}} or {"data": {...}})
  if (parsed && typeof parsed === 'object') {
    for (const v of Object.values(parsed as Record<string, unknown>)) {
      const nested = tryShape(v)
      if (nested) return nested
    }
  }
  return { columns: [], rows: [] }
}

async function extractOnce(
  pageContext: string,
  target: string,
  priorColumns?: string[],
  relaxNote?: string
): Promise<ExtractResult> {
  const user = [
    `Target: ${target}`,
    relaxNote ?? '',
    priorColumns?.length
      ? `Prior schema — use EXACTLY these columns: ${JSON.stringify(priorColumns)}`
      : '',
    `Page:\n${pageContext}`
  ]
    .filter(Boolean)
    .join('\n\n')

  const res = await completeChat(
    'smart',
    [
      { role: 'system', content: SYSTEM },
      { role: 'user', content: user }
    ],
    true
  )
  store.logCost(
    res.model,
    res.inputTokens,
    res.outputTokens,
    costUsd(res.model, res.inputTokens, res.outputTokens),
    'extract'
  )
  try {
    return coerceTable(JSON.parse(res.text))
  } catch {
    return { columns: [], rows: [] }
  }
}

/** Extract structured rows from the given page for a natural-language target. */
export async function runExtract(
  wc: WebContents,
  target: string,
  priorColumns?: string[]
): Promise<ExtractResult> {
  const snap = await scrapePage(wc)
  if (!snap) throw new Error('Could not read this page.')
  const pageContext = trimToBudget(snapshotToContext(snap, true), 8000)

  let table = await extractOnce(pageContext, target, priorColumns)

  // Relaxed retry — a strict filter or odd phrasing shouldn't yield nothing.
  if (!table.columns.length || !table.rows.length) {
    table = await extractOnce(
      pageContext,
      target,
      priorColumns,
      'NOTE: your first pass found nothing. Ignore any hard-to-verify constraints in the target and extract ALL items of the base entity type present on the page (with name, key attributes like price, and link). Include the constraint attribute as a column so the user can filter.'
    )
  }
  if (!table.columns.length) {
    throw new Error(
      'Could not find structured items on this page. Try scrolling results into view or rephrasing (e.g. "products: name, price, link").'
    )
  }
  return table
}

/** Find and follow the "next page" control. Returns false when there is no next page. */
const NEXT_SCRIPT = `(() => {
  const rel = document.querySelector('a[rel~="next"]')
  if (rel && rel.href) return rel.href
  const texts = ['next', 'next page', 'older', 'more results', '›', '»', '→', '>', 'load more', 'show more']
  const cands = [...document.querySelectorAll('a, button')].filter((e) => {
    const t = (e.innerText || '').trim().toLowerCase()
    const a = (e.getAttribute('aria-label') || '').toLowerCase()
    return texts.includes(t) || a.includes('next page') || a === 'next'
  })
  const link = cands.find((e) => e.tagName === 'A' && e.href)
  if (link) return link.href
  if (cands[0]) { cands[0].click(); return 'CLICKED' }
  return null
})()`

function waitLoaded(wc: WebContents, timeoutMs = 12000): Promise<void> {
  return new Promise((resolve) => {
    let done = false
    const finish = () => {
      if (done) return
      done = true
      setTimeout(resolve, 1500)
    }
    wc.once('did-stop-loading', finish)
    setTimeout(finish, timeoutMs)
  })
}

/**
 * Auto-paginate: extract, follow "next", repeat up to maxPages.
 * Rows are deduped across pages; progress reported per page.
 */
export async function runExtractAuto(
  wc: WebContents,
  target: string,
  maxPages: number,
  onProgress: (page: number, total: number, rowCount: number) => void
): Promise<ExtractResult> {
  let columns: string[] = []
  const rows: string[][] = []
  const seen = new Set<string>()

  for (let page = 1; page <= maxPages; page++) {
    const table = await runExtract(wc, target, columns.length ? columns : undefined)
    if (!columns.length) columns = table.columns
    for (const r of table.rows) {
      const key = JSON.stringify(r)
      if (!seen.has(key)) {
        seen.add(key)
        rows.push(r)
      }
    }
    onProgress(page, maxPages, rows.length)
    if (page === maxPages) break

    const next = (await wc.executeJavaScript(NEXT_SCRIPT, true).catch(() => null)) as string | null
    if (!next) break
    if (next !== 'CLICKED') wc.loadURL(next).catch(() => {})
    await waitLoaded(wc)
  }
  return { columns, rows }
}

/** Write rows to a CSV in Downloads; returns the path. */
export function exportCsv(columns: string[], rows: string[][], name: string): string {
  const esc = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v)
  const csv = [columns.map(esc).join(','), ...rows.map((r) => r.map(esc).join(','))].join('\r\n')
  const safe = name.replace(/[<>:"/\\|?*]+/g, '').slice(0, 50).trim() || 'Extract'
  const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-')
  const file = join(app.getPath('downloads'), `Nori — ${safe} — ${stamp}.csv`)
  // BOM so Excel opens UTF-8 correctly
  writeFileSync(file, '﻿' + csv, 'utf8')
  shell.showItemInFolder(file)
  return file
}
