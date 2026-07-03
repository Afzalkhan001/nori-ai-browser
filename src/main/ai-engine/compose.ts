import type { BrowserWindow, WebContents } from 'electron'
import { IPC } from '@shared/types'
import { streamChat } from './openai'
import { costUsd, trimToBudget } from './cost'
import { scrapePage } from './scrape'
import * as store from '../db/store'

/**
 * Content Studio — turns the current page into platform-ready content.
 * Brand voice (if saved in settings) shapes every output.
 */

const FORMAT_SPECS: Record<string, string> = {
  'X thread': `A punchy X (Twitter) thread: 5-8 numbered tweets, each under 280 chars.
Tweet 1 is a scroll-stopping hook. Last tweet is a soft CTA. No hashtag spam (max 2 total).`,
  'LinkedIn post': `A LinkedIn post: strong first line (it gets truncated — make them click "see more"),
short paragraphs, a concrete insight or story, ends with a question or CTA. 120-220 words. No emoji walls.`,
  'Instagram caption': `An Instagram caption: hook line, 2-3 short lines of value or story, line-break rhythm,
CTA, then 5-8 relevant niche hashtags on the last line.`,
  'YouTube script': `A YouTube video script outline: title options (3), a 15-second cold-open hook,
sectioned talking points with timestamps, and an outro CTA. Keep it tight.`,
  'Blog outline': `An SEO-aware blog post outline: proposed title + meta description,
H2/H3 structure with a one-line brief per section, target keyword suggestions, FAQ section.`,
  Newsletter: `A newsletter issue: subject line options (3), preview text, a warm intro,
the core insight distilled from the page, one actionable takeaway, sign-off.`,
  'SEO brief': `An SEO content brief to OUTRANK this page: target keyword + secondary keywords
inferred from the content, search intent, proposed title tag + meta description, H2/H3 outline
that covers gaps the source misses, FAQ questions, internal/external link suggestions, word-count target.`
}

export const COMPOSE_FORMATS = Object.keys(FORMAT_SPECS)

export async function compose(
  win: BrowserWindow,
  tabId: string,
  wc: WebContents,
  format: string,
  instructions: string
): Promise<void> {
  try {
    const snap = await scrapePage(wc)
    const voice = store.getSetting('brandVoice') ?? ''
    const spec = FORMAT_SPECS[format] ?? `Content in the format: ${format}`

    const system = `You are Nori's content studio — a sharp, taste-driven content writer.
Create exactly what is asked, ready to paste. Output ONLY the content itself
(markdown allowed), no preamble or commentary.

Format spec:
${spec}
${voice ? `\nBrand voice — match this in every line:\n${voice}` : ''}`

    const user = [
      snap
        ? `Source page:\nURL: ${snap.url}\nTitle: ${snap.title}\n\n${trimToBudget(snap.text, 3000)}`
        : 'No page context available — work from the instructions alone.',
      instructions ? `Extra instructions from the user:\n${instructions}` : ''
    ]
      .filter(Boolean)
      .join('\n\n')

    const result = await streamChat(
      'fast',
      [
        { role: 'system', content: system },
        { role: 'user', content: user }
      ],
      (delta) => {
        if (!win.isDestroyed()) win.webContents.send(IPC.ComposeChunk, { tabId, delta })
      }
    )
    const usd = costUsd(result.model, result.inputTokens, result.outputTokens)
    store.logCost(result.model, result.inputTokens, result.outputTokens, usd, 'compose')
    store.addArtifact({
      type: 'compose',
      title: `${format} — ${snap?.title?.slice(0, 60) ?? 'page'}`,
      meta: { format, url: snap?.url },
      data: { text: result.text }
    })
    if (!win.isDestroyed()) win.webContents.send(IPC.ComposeDone, { tabId, costUsd: usd })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Compose failed.'
    if (!win.isDestroyed()) win.webContents.send(IPC.ComposeError, { tabId, message })
  }
}
