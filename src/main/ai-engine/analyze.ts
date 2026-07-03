import type { BrowserWindow, WebContents } from 'electron'
import { IPC, type PageFacts } from '@shared/types'
import { streamChat } from './openai'
import { costUsd, trimToBudget } from './cost'
import { scrapePage } from './scrape'
import * as store from '../db/store'

/**
 * On-device detection — framework fingerprints, fonts, palette, structure.
 * Runs inside the page for free; OpenAI is only used for the narrative.
 */
const FACTS_SCRIPT = `(() => {
  const fw = []
  const libs = []
  const has = (sel) => !!document.querySelector(sel)

  // Framework fingerprints
  if (window.__NEXT_DATA__ || has('#__next')) fw.push('Next.js')
  if (window.__NUXT__ || has('#__nuxt')) fw.push('Nuxt')
  if (window.__remixContext) fw.push('Remix')
  if (has('[ng-version]')) fw.push('Angular ' + (document.querySelector('[ng-version]')?.getAttribute('ng-version') ?? ''))
  if (window.__VUE__ || has('[data-v-app]')) fw.push('Vue')
  if (!fw.some(f => f.startsWith('Next'))) {
    const el = [...document.querySelectorAll('body *')].slice(0, 120)
    if (el.some(e => Object.keys(e).some(k => k.startsWith('__reactFiber') || k.startsWith('__reactContainer')))) fw.push('React')
  } else { fw.push('React') }
  if ([...document.querySelectorAll('[class]')].slice(0, 200).some(e => /(^|\\s)svelte-/.test(e.className))) fw.push('Svelte')

  // Libraries / platforms
  if (window.jQuery) libs.push('jQuery ' + (window.jQuery.fn?.jquery ?? ''))
  if (window.Shopify) libs.push('Shopify')
  if (has('link[href*="wp-content"], link[href*="wp-includes"]')) libs.push('WordPress')
  if (window.wixBiSession) libs.push('Wix')
  if (window.Webflow) libs.push('Webflow')
  if (window.gsap) libs.push('GSAP')
  if (window.THREE) libs.push('Three.js')
  if (window.Swiper || has('.swiper')) libs.push('Swiper')
  if (window.bootstrap || has('link[href*="bootstrap"]')) libs.push('Bootstrap')
  // Tailwind heuristic: utility-class density
  const cls = [...document.querySelectorAll('body [class]')].slice(0, 300).map(e => typeof e.className === 'string' ? e.className : '').join(' ')
  if ((cls.match(/(^|\\s)(flex|grid|items-center|justify-|px-|py-|mt-|mb-|text-(sm|lg|xl)|rounded)/g) ?? []).length > 25) libs.push('Tailwind CSS')

  // Typography — sample computed fonts
  const fontCount = {}
  const sample = [document.body, ...document.querySelectorAll('h1,h2,h3,p,a,span,button')]
  for (const el of [...sample].slice(0, 250)) {
    if (!el) continue
    const f = getComputedStyle(el).fontFamily.split(',')[0].replace(/["']/g, '').trim()
    if (f) fontCount[f] = (fontCount[f] ?? 0) + 1
  }
  const fonts = Object.entries(fontCount).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([f]) => f)

  // Palette — sample backgrounds and text colors
  const colorCount = {}
  const toHex = (rgb) => {
    const m = rgb.match(/rgba?\\((\\d+),\\s*(\\d+),\\s*(\\d+)(?:,\\s*([\\d.]+))?\\)/)
    if (!m) return null
    if (m[4] !== undefined && parseFloat(m[4]) < 0.5) return null
    return '#' + [m[1], m[2], m[3]].map(n => (+n).toString(16).padStart(2, '0')).join('')
  }
  for (const el of [...document.querySelectorAll('body, body *')].slice(0, 800)) {
    const cs = getComputedStyle(el)
    for (const c of [cs.backgroundColor, cs.color]) {
      const hex = toHex(c)
      if (hex) colorCount[hex] = (colorCount[hex] ?? 0) + 1
    }
  }
  const colors = Object.entries(colorCount).sort((a, b) => b[1] - a[1]).slice(0, 8)
    .map(([hex, count]) => ({ hex, count }))

  return {
    url: location.href,
    title: document.title,
    framework: [...new Set(fw)],
    libraries: [...new Set(libs)],
    fonts,
    colors,
    counts: {
      links: document.querySelectorAll('a').length,
      buttons: document.querySelectorAll('button, [role="button"]').length,
      forms: document.querySelectorAll('form').length,
      images: document.querySelectorAll('img, svg').length,
      headings: document.querySelectorAll('h1,h2,h3').length
    },
    generator: document.querySelector('meta[name="generator"]')?.content ?? ''
  }
})()`

export async function getFacts(wc: WebContents): Promise<PageFacts | null> {
  try {
    return (await wc.executeJavaScript(FACTS_SCRIPT, true)) as PageFacts
  } catch {
    return null
  }
}

const SYNTH_PROMPT = `You are Nori's website analysis engine, writing for developers and designers.
Given detection facts and page text, write a tight analysis with these sections
(markdown headers exactly as shown, keep the whole thing under 300 words):

## Stack
What it's built with and your confidence; infer beyond the raw fingerprints when sensible.

## Design
Typography system, palette character, layout approach — as a designer would describe it.

## Notables
2-4 sharp observations: UX patterns, SEO/accessibility issues, performance hints.`

export async function synthesize(win: BrowserWindow, tabId: string, wc: WebContents): Promise<void> {
  try {
    const [facts, snap] = await Promise.all([getFacts(wc), scrapePage(wc)])
    const context = [
      `Detection facts:\n${JSON.stringify(facts, null, 1)}`,
      snap ? `Page text (excerpt):\n${trimToBudget(snap.text, 2500)}` : ''
    ]
      .filter(Boolean)
      .join('\n\n')

    const result = await streamChat(
      'smart',
      [
        { role: 'system', content: SYNTH_PROMPT },
        { role: 'user', content: context }
      ],
      (delta) => {
        if (!win.isDestroyed()) win.webContents.send(IPC.AnalyzeChunk, { tabId, delta })
      }
    )
    const usd = costUsd(result.model, result.inputTokens, result.outputTokens)
    store.logCost(result.model, result.inputTokens, result.outputTokens, usd, 'analyze')
    if (!win.isDestroyed()) win.webContents.send(IPC.AnalyzeDone, { tabId, costUsd: usd })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Analysis failed.'
    if (!win.isDestroyed()) win.webContents.send(IPC.AnalyzeError, { tabId, message })
  }
}
