import type { BrowserWindow, WebContents } from 'electron'
import { IPC } from '@shared/types'
import { streamChat } from './openai'
import { costUsd, trimToBudget } from './cost'
import { getFacts } from './analyze'
import { scrapePage } from './scrape'
import * as store from '../db/store'

export const PROMPT_TARGETS = [
  'React + Tailwind',
  'Next.js project',
  'Flutter',
  'SwiftUI',
  'Plain HTML/CSS'
] as const

const SYSTEM = `You are Nori's prompt engineer. Given a webpage's detected stack, design
facts and content, write ONE excellent, copy-paste-ready build prompt for an AI coding
tool (Cursor / Claude / GPT). The prompt must direct the tool to recreate the page's
layout and design language for the requested target framework.

Rules:
- Output ONLY the prompt text itself — no preamble, no closing remarks.
- Structure it with short sections: Goal, Tech stack, Layout, Design system
  (typography, exact hex colors), Components, Behavior, Quality bar.
- Be specific: use the detected fonts and hex values verbatim.
- Keep it under 450 words.`

export async function generatePrompt(
  win: BrowserWindow,
  tabId: string,
  wc: WebContents,
  target: string
): Promise<void> {
  try {
    const [facts, snap] = await Promise.all([getFacts(wc), scrapePage(wc)])
    const context = [
      `Target: ${target}`,
      `Detection facts:\n${JSON.stringify(facts, null, 1)}`,
      snap ? `Page content (excerpt):\n${trimToBudget(snap.text, 1800)}` : ''
    ]
      .filter(Boolean)
      .join('\n\n')

    const result = await streamChat(
      'smart',
      [
        { role: 'system', content: SYSTEM },
        { role: 'user', content: context }
      ],
      (delta) => {
        if (!win.isDestroyed()) win.webContents.send(IPC.PromptChunk, { tabId, delta })
      }
    )
    const usd = costUsd(result.model, result.inputTokens, result.outputTokens)
    store.logCost(result.model, result.inputTokens, result.outputTokens, usd, 'prompts')
    if (!win.isDestroyed()) win.webContents.send(IPC.PromptDone, { tabId, costUsd: usd })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Prompt generation failed.'
    if (!win.isDestroyed()) win.webContents.send(IPC.PromptError, { tabId, message })
  }
}
