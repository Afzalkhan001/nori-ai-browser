import type { WebContents } from 'electron'

/**
 * Extracts a compact, LLM-friendly snapshot of the page by executing a
 * script inside the tab's webContents. Pure read — no page mutation.
 */
const EXTRACT_SCRIPT = `(() => {
  const meta = (name) =>
    document.querySelector('meta[name="' + name + '"], meta[property="' + name + '"]')?.content ?? ''
  const headings = [...document.querySelectorAll('h1, h2, h3')]
    .slice(0, 40)
    .map((h) => h.tagName + ': ' + h.textContent.trim().replace(/\\s+/g, ' '))
    .filter((t) => t.length > 4)
  // Meaningful links so an agent can navigate deeper (skip nav junk & dupes).
  // Descriptive link texts (product titles, article headlines) rank first.
  const seen = new Set()
  const all = []
  for (const a of document.querySelectorAll('a[href]')) {
    if (all.length >= 120) break
    const text = (a.textContent ?? '').trim().replace(/\\s+/g, ' ')
    let href = a.href
    if (!text || text.length < 3 || text.length > 160) continue
    if (!/^https?:/.test(href)) continue
    href = href.split('#')[0]
    if (seen.has(href)) continue
    seen.add(href)
    all.push({ text: text.slice(0, 110), href })
  }
  const descriptive = all.filter((l) => l.text.length >= 12)
  const short = all.filter((l) => l.text.length < 12)
  const links = [...descriptive, ...short].slice(0, 40)
  return {
    url: location.href,
    title: document.title,
    description: meta('description') || meta('og:description'),
    headings,
    links,
    text: document.body?.innerText?.replace(/\\n{3,}/g, '\\n\\n') ?? ''
  }
})()`

export interface PageSnapshot {
  url: string
  title: string
  description: string
  headings: string[]
  links: { text: string; href: string }[]
  text: string
}

export async function scrapePage(wc: WebContents): Promise<PageSnapshot | null> {
  try {
    return (await wc.executeJavaScript(EXTRACT_SCRIPT, true)) as PageSnapshot
  } catch {
    return null // e.g. chrome:// pages, PDFs, crashed renderer
  }
}

/** Reader-mode extraction: the main article content, not the chrome. */
const READER_SCRIPT = `(() => {
  const meta = (name) =>
    document.querySelector('meta[name="' + name + '"], meta[property="' + name + '"]')?.content ?? ''
  const root =
    document.querySelector('article') ??
    document.querySelector('main') ??
    document.querySelector('[role="main"]') ??
    document.body
  const title =
    document.querySelector('h1')?.innerText?.trim() || document.title
  return {
    title,
    url: location.href,
    byline: meta('author') || meta('article:author') || '',
    text: (root?.innerText ?? '').replace(/\\n{3,}/g, '\\n\\n')
  }
})()`

export async function readerExtract(
  wc: WebContents
): Promise<{ title: string; url: string; byline: string; text: string } | null> {
  try {
    return await wc.executeJavaScript(READER_SCRIPT, true)
  } catch {
    return null
  }
}

export function snapshotToContext(snap: PageSnapshot, withLinks = false): string {
  return [
    `URL: ${snap.url}`,
    `Title: ${snap.title}`,
    snap.description && `Description: ${snap.description}`,
    snap.headings.length && `Headings:\n${snap.headings.join('\n')}`,
    withLinks &&
      snap.links.length &&
      `Links on this page (you can navigate to any of these):\n${snap.links
        .map((l) => `- ${l.text} → ${l.href}`)
        .join('\n')}`,
    `Page text:\n${snap.text}`
  ]
    .filter(Boolean)
    .join('\n\n')
}
