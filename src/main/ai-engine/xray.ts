import { BrowserWindow, type WebContents } from 'electron'
import { IPC, type XrayVerdict } from '@shared/types'
import { completeChat } from './openai'
import { costUsd, trimToBudget } from './cost'
import { readerExtract, scrapePage, snapshotToContext } from './scrape'
import * as store from '../db/store'

/**
 * X-ray — fact-check the article the user is reading. Claims are verified via
 * background searches in a hidden window (never hijacks the reading tab), then
 * highlighted directly inside the live page.
 */

const CLAIMS_PROMPT = `Extract the checkable factual claims from this article.
Return ONLY strict JSON: {"claims": [{"claim": "...", "sentence": "..."}]}
Rules:
- Up to 5 claims. Choose specific, verifiable statements (numbers, events, named
  facts) — not opinions or predictions.
- "sentence" must be the VERBATIM sentence from the article containing the claim
  (exact characters, so it can be located in the page).`

const VERDICT_PROMPT = `You are a strict fact-check assistant. Given a claim and search
results, judge it. Return ONLY strict JSON:
{"verdict": "supported" | "disputed" | "unverified", "note": "<one line>", "sources": ["url1", "url2"]}
- supported: independent sources clearly corroborate it.
- disputed: credible sources contradict it.
- unverified: not enough evidence in these results.
- sources: up to 2 URLs from the results you actually relied on.`

function waitLoaded(wc: WebContents, ms = 10000): Promise<void> {
  return new Promise((resolve) => {
    let done = false
    const finish = () => {
      if (done) return
      done = true
      setTimeout(resolve, 1500)
    }
    wc.once('did-stop-loading', finish)
    setTimeout(finish, ms)
  })
}

/** Wrap the claim sentences in colored <mark> elements inside the live page. */
function highlightScript(
  marks: { sentence: string; verdict: XrayVerdict; note: string; source: string }[]
): string {
  return `((marks) => {
    document.querySelectorAll('mark[data-nori]').forEach((m) => {
      m.replaceWith(...m.childNodes)
    })
    const colors = {
      supported: 'rgba(79, 140, 90, 0.28)',
      disputed: 'rgba(190, 70, 60, 0.25)',
      unverified: 'rgba(200, 150, 40, 0.25)'
    }
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT)
    const nodes = []
    while (walker.nextNode()) nodes.push(walker.currentNode)
    let count = 0
    for (const m of marks) {
      const needle = m.sentence.trim().slice(0, 120)
      if (needle.length < 20) continue
      for (const node of nodes) {
        const i = node.textContent.indexOf(needle)
        if (i === -1) continue
        try {
          const range = document.createRange()
          range.setStart(node, i)
          range.setEnd(node, Math.min(i + m.sentence.trim().length, node.textContent.length))
          const mark = document.createElement('mark')
          mark.setAttribute('data-nori', m.verdict)
          mark.style.cssText = 'background:' + colors[m.verdict] + ';border-bottom:2px dotted rgba(33,33,29,0.4);border-radius:2px;color:inherit;'
          mark.title = '[Nori X-ray: ' + m.verdict.toUpperCase() + '] ' + m.note + (m.source ? ' — ' + m.source : '')
          range.surroundContents(mark)
          count++
        } catch {}
        break
      }
    }
    return count
  })(${JSON.stringify(marks)})`
}

export async function runXray(win: BrowserWindow, tabId: string, wc: WebContents): Promise<void> {
  const hidden = new BrowserWindow({
    show: false,
    webPreferences: { sandbox: true, contextIsolation: true }
  })
  try {
    const article = await readerExtract(wc)
    if (!article || article.text.trim().length < 400) {
      throw new Error('This page doesn’t look like a readable article.')
    }

    // 1) Extract claims (smart — precision matters here)
    const claimsRes = await completeChat(
      'smart',
      [
        { role: 'system', content: CLAIMS_PROMPT },
        { role: 'user', content: `Title: ${article.title}\n\n${trimToBudget(article.text, 3000)}` }
      ],
      true
    )
    store.logCost(claimsRes.model, claimsRes.inputTokens, claimsRes.outputTokens, costUsd(claimsRes.model, claimsRes.inputTokens, claimsRes.outputTokens), 'xray')
    let claims: { claim: string; sentence: string }[] = []
    try {
      const parsed = JSON.parse(claimsRes.text)
      claims = Array.isArray(parsed.claims) ? parsed.claims.slice(0, 5) : []
    } catch {
      claims = []
    }
    if (!claims.length) throw new Error('No checkable claims found in this article.')

    // 2) Verify each claim via background search
    const marks: { sentence: string; verdict: XrayVerdict; note: string; source: string }[] = []
    let totalUsd = 0
    for (let i = 0; i < claims.length; i++) {
      const c = claims[i]
      let verdict: XrayVerdict = 'unverified'
      let note = 'Could not verify.'
      let sources: string[] = []
      try {
        hidden.webContents
          .loadURL(`https://www.google.com/search?q=${encodeURIComponent(c.claim.slice(0, 90))}`)
          .catch(() => {})
        await waitLoaded(hidden.webContents)
        const snap = await scrapePage(hidden.webContents)
        if (snap) {
          const vRes = await completeChat(
            'fast',
            [
              { role: 'system', content: VERDICT_PROMPT },
              {
                role: 'user',
                content: `Claim: ${c.claim}\n\nSearch results:\n${trimToBudget(snapshotToContext(snap, true), 3000)}`
              }
            ],
            true
          )
          const usd = costUsd(vRes.model, vRes.inputTokens, vRes.outputTokens)
          totalUsd += usd
          store.logCost(vRes.model, vRes.inputTokens, vRes.outputTokens, usd, 'xray')
          try {
            const p = JSON.parse(vRes.text)
            if (['supported', 'disputed', 'unverified'].includes(p.verdict)) verdict = p.verdict
            note = String(p.note ?? '').slice(0, 160)
            sources = Array.isArray(p.sources)
              ? p.sources.filter((s: unknown) => typeof s === 'string' && s.startsWith('http')).slice(0, 2)
              : []
          } catch {
            // keep unverified
          }
        }
      } catch {
        // claim stays unverified
      }
      marks.push({ sentence: c.sentence, verdict, note, source: sources[0] ?? '' })
      if (!win.isDestroyed()) {
        win.webContents.send(IPC.XrayClaim, {
          tabId,
          idx: i + 1,
          total: claims.length,
          claim: c.claim,
          verdict,
          note,
          sources
        })
      }
    }

    // 3) Paint the verdicts into the live page
    if (!wc.isDestroyed()) {
      await wc.executeJavaScript(highlightScript(marks), true).catch(() => {})
    }
    if (!win.isDestroyed()) win.webContents.send(IPC.XrayDone, { tabId, costUsd: totalUsd })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'X-ray failed.'
    if (!win.isDestroyed()) win.webContents.send(IPC.XrayError, { tabId, message })
  } finally {
    hidden.destroy()
  }
}
