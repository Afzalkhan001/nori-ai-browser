import { BrowserWindow } from 'electron'
import { IPC, type MissionLogEntry } from '@shared/types'
import { streamChat, type ChatTurn } from './ai-engine/openai'
import { costUsd } from './ai-engine/cost'
import { executeTool, AGENT_TOOLS } from './ai-engine/agent'
import * as store from './db/store'

/**
 * Missions — standing goals Nori pursues on a schedule in a hidden window.
 * Read-only tools, gpt-4o-mini, results deduped against everything already seen.
 */

const CHECK_INTERVAL = 15 * 60 * 1000
const HOURLY_DUE = 55 * 60 * 1000
const DAILY_DUE = 22 * 3600 * 1000
const MAX_ROUNDS = 6

const RUNNER_TOOLS = AGENT_TOOLS.filter((t) =>
  ['search_web', 'navigate', 'read_page'].includes(t.function.name)
)

const RUNNER_PROMPT = `You are Nori's mission runner — a background research agent.
You are given a standing MISSION and a list of result URLs already reported before.
Use search_web / navigate / read_page (2-4 searches from different angles) to find
CURRENT results for the mission. Focus on concrete items (listings, articles,
announcements, postings) with real URLs you actually saw.

When done, reply with ONLY strict JSON:
{"summary": "<1-2 sentence update>", "items": [{"title": "...", "url": "..."}]}
- items: up to 8 NEW findings (exclude anything in the already-seen list).
- If nothing new, return {"summary": "Nothing new.", "items": []}.`

let running = false
let getWin: (() => BrowserWindow | null) | null = null

function coerce(text: string): { summary: string; items: { title: string; url: string }[] } {
  try {
    const m = text.match(/\{[\s\S]*\}/)
    const parsed = JSON.parse(m ? m[0] : text)
    return {
      summary: String(parsed.summary ?? ''),
      items: Array.isArray(parsed.items)
        ? parsed.items
            .filter((i: unknown) => i && typeof i === 'object')
            .map((i: { title?: unknown; url?: unknown }) => ({
              title: String(i.title ?? '').slice(0, 140),
              url: String(i.url ?? '')
            }))
            .filter((i: { url: string }) => /^https?:\/\//.test(i.url))
        : []
    }
  } catch {
    return { summary: text.slice(0, 200), items: [] }
  }
}

export async function runMission(missionId: string): Promise<void> {
  const mission = store.listMissions().find((m) => m.id === missionId)
  if (!mission) return

  const hidden = new BrowserWindow({
    show: false,
    webPreferences: { sandbox: true, contextIsolation: true }
  })
  try {
    const ctx = { getWc: () => hidden.webContents, tabs: undefined as never }
    const today = new Date().toDateString()
    const turns: ChatTurn[] = [
      { role: 'system', content: `${RUNNER_PROMPT}\n\nTODAY'S DATE: ${today}. Never put a past year into search queries; judge freshness against today.` },
      {
        role: 'user',
        content: `MISSION: ${mission.goal}\n\nAlready seen (do not re-report):\n${
          mission.seenUrls.slice(-60).join('\n') || '(nothing yet)'
        }`
      }
    ]

    let totalIn = 0
    let totalOut = 0
    let finalText = ''
    let model = ''
    for (let round = 0; round <= MAX_ROUNDS; round++) {
      const lastRound = round === MAX_ROUNDS
      const result = await streamChat(
        'fast',
        turns,
        () => {},
        undefined,
        lastRound ? undefined : RUNNER_TOOLS
      )
      totalIn += result.inputTokens
      totalOut += result.outputTokens
      model = result.model
      finalText = result.text
      if (result.toolCalls.length === 0) break
      turns.push({
        role: 'assistant',
        content: result.text || null,
        tool_calls: result.toolCalls.map((tc) => ({
          id: tc.id,
          type: 'function' as const,
          function: { name: tc.name, arguments: tc.arguments }
        }))
      })
      for (const tc of result.toolCalls) {
        let args: Record<string, unknown> = {}
        try {
          args = JSON.parse(tc.arguments || '{}')
        } catch {
          // malformed args reported back by the tool itself
        }
        const output = await executeTool(tc.name, args, ctx)
        turns.push({ role: 'tool', content: output, tool_call_id: tc.id })
      }
    }
    store.logCost(model, totalIn, totalOut, costUsd(model, totalIn, totalOut), 'missions')

    const { summary, items } = coerce(finalText)
    const fresh = items.filter((i) => !mission.seenUrls.includes(i.url))
    if (fresh.length > 0) {
      const entry: MissionLogEntry = { ts: Date.now(), summary, items: fresh }
      store.appendMissionLog(mission.id, entry, fresh.map((i) => i.url))
      const win = getWin?.()
      if (win && !win.isDestroyed()) win.webContents.send(IPC.MissionUpdated)
    } else {
      store.updateMission(mission.id, { lastRunAt: Date.now() })
    }
  } catch (err) {
    // Log it — a silently failing mission is indistinguishable from "nothing new".
    console.log('[nori-mission]', mission.goal.slice(0, 60), 'run failed:', String(err).slice(0, 200))
    store.updateMission(mission.id, { lastRunAt: Date.now() })
  } finally {
    hidden.destroy()
  }
}

async function checkAll(): Promise<void> {
  if (running) return
  running = true
  try {
    const now = Date.now()
    for (const m of store.listMissions()) {
      const due = m.schedule === 'hourly' ? HOURLY_DUE : DAILY_DUE
      if (now - m.lastRunAt >= due) {
        await runMission(m.id) // one at a time
      }
    }
  } finally {
    running = false
  }
}

export function startMissions(getMainWin: () => BrowserWindow | null): void {
  getWin = getMainWin
  setTimeout(checkAll, 45 * 1000)
  setInterval(checkAll, CHECK_INTERVAL)
}
