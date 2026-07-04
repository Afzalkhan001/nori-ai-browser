import { BrowserWindow } from 'electron'
import { randomUUID } from 'crypto'
import { IPC, type Agent, type AgentPendingAction, type AgentRunLog } from '@shared/types'
import { streamChat, type ChatTurn } from './openai'
import { costUsd } from './cost'
import { AGENT_TOOLS, executeTool, stepLabel, type AgentCtx } from './agent'
import * as store from '../db/store'

/**
 * Autonomous ACTING agents. Unlike Missions (read-only research), an Agent runs
 * the FULL browser toolset — navigate, click, fill, submit — to actually get
 * things done, on a schedule or on demand, in a hidden window that shares the
 * user's session (so it's logged in wherever they are).
 *
 * SAFETY: a committing action (submit/post/pay/order/delete) only executes when
 * the agent is on Autopilot. Otherwise it is HELD: the agent does everything else
 * (research, draft, prepare) and queues the action for the user to approve later.
 * There is no human at the screen during a scheduled run, so we never guess.
 */

// Agents run the full toolset MINUS things that only make sense with the user's
// live tabs or that would let an agent spawn more background work.
const AGENT_RUNNER_TOOLS = AGENT_TOOLS.filter(
  (t) => !['list_tabs', 'read_tab', 'create_mission', 'watch_topic'].includes(t.function.name)
)

const COMMITTING_CLICK =
  /\b(buy|pay|order|checkout|purchase|place\s?order|subscribe|donate|confirm|delete|remove|unsubscribe|book\s?now|pay\s?now|send|post|publish)\b/i

function isCommitting(name: string, args: Record<string, unknown>): boolean {
  if (name === 'submit_form') return true
  if (name === 'click' && COMMITTING_CLICK.test(String(args.target ?? ''))) return true
  return false
}

const CHECK_INTERVAL = 15 * 60 * 1000
const HOURLY_DUE = 55 * 60 * 1000
const DAILY_DUE = 22 * 3600 * 1000
const MAX_ROUNDS = 40 // hard cap on tool rounds per run (runaway guard)
const COST_CAP_USD = 0.6 // abort a single run if it gets this expensive

const AGENT_SYSTEM = `You are one of Nori's autonomous Agents — you pursue a standing GOAL on
the user's behalf, on your own, using real browser tools (search_web, navigate, read_page,
click, scroll, wait, read_form, fill_form, submit_form, find_posts, save_pdf, search_history).
You control a real browser tab that shares the user's logged-in session.

Operate autonomously and decisively:
1. Plan the concrete steps to achieve the goal, then DO them with tools — navigate, read_page
   to see the state, click/scroll/fill to act, read_page again to verify each step, adapt when
   the page differs. Loop until the goal is met or you've genuinely exhausted options.
2. Use search_history to recall what you (or the user) already saw on past runs — avoid
   repeating work and build on prior findings.
3. HONESTY: never claim you did something unless the tool returned success. Report only real
   results with real links you actually saw.
4. COMMITTING ACTIONS: if you try to submit/post/pay/order/delete and you are NOT on Autopilot,
   the tool will tell you it was HELD for the user's approval. That is expected — do NOT retry
   it. Instead do everything else you can (gather the info, draft the content, get right up to
   the final step) and clearly describe in your report what is queued for their approval.
5. REFUSE illegal or offensive-security tasks.

When finished, write a SHORT plain-language report of what you accomplished this run: what you
found or did, concrete links, and anything waiting on the user. This report is what they read.`

// Runs currently in flight, so the scheduler and "run now" never double-run one,
// and so a stop request can interrupt the loop.
const active = new Set<string>()
const stopping = new Set<string>()
let getWin: (() => BrowserWindow | null) | null = null

export function isAgentRunning(id: string): boolean {
  return active.has(id)
}

export function stopAgentRun(id: string): void {
  if (active.has(id)) stopping.add(id)
}

function emitUpdated(): void {
  const win = getWin?.()
  if (win && !win.isDestroyed()) win.webContents.send(IPC.AgentUpdated)
}

/** Execute one full autonomous run of an agent. Safe to call for scheduled or manual runs. */
export async function runAgent(agentId: string): Promise<void> {
  const agent = store.listAgents().find((a) => a.id === agentId)
  if (!agent || active.has(agentId)) return
  active.add(agentId)
  store.updateAgent(agentId, { running: true })
  emitUpdated()

  const win = getWin?.()
  const emitStep = (label: string): void => {
    if (win && !win.isDestroyed()) win.webContents.send(IPC.AgentStep, { agentId, label })
  }

  const hidden = new BrowserWindow({
    show: false,
    webPreferences: { sandbox: true, contextIsolation: true }
  })

  const steps: string[] = []
  const actionsTaken: string[] = []
  const pending: AgentPendingAction[] = []
  let totalIn = 0
  let totalOut = 0
  let model = ''
  let summary = ''

  try {
    const ctx: AgentCtx = { getWc: () => hidden.webContents, tabs: undefined as never }
    const turns: ChatTurn[] = [
      { role: 'system', content: `${AGENT_SYSTEM}\n\nTODAY: ${new Date().toDateString()}` },
      {
        role: 'user',
        content: `AGENT: ${agent.name}\nGOAL: ${agent.goal}\nAutopilot: ${
          agent.autopilot ? 'ON — you MAY take committing actions.' : 'OFF — committing actions will be HELD for the user.'
        }\n\nBegin. Work autonomously toward the goal now.`
      }
    ]

    for (let round = 0; round < MAX_ROUNDS; round++) {
      if (stopping.has(agentId)) {
        summary = summary || 'Run stopped by the user.'
        break
      }
      if (costUsd(model || 'gpt-4o-mini', totalIn, totalOut) > COST_CAP_USD) {
        summary = summary || 'Reached this run’s cost limit; stopping.'
        break
      }
      const lastRound = round === MAX_ROUNDS - 1
      const result = await streamChat(
        'smart',
        turns,
        () => {},
        undefined,
        lastRound ? undefined : AGENT_RUNNER_TOOLS
      )
      totalIn += result.inputTokens
      totalOut += result.outputTokens
      model = result.model
      if (result.text) summary = result.text

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
          /* tool reports the error */
        }
        const label = stepLabel(tc.name, args)
        steps.push(label)
        emitStep(label)

        // SAFETY GATE: hold committing actions unless the agent is on Autopilot.
        if (isCommitting(tc.name, args) && !agent.autopilot) {
          const desc = String(args.summary ?? args.target ?? 'a committing action')
          pending.push({
            id: randomUUID(),
            ts: Date.now(),
            description: desc.slice(0, 160),
            url: hidden.webContents.getURL()
          })
          turns.push({
            role: 'tool',
            content: JSON.stringify({
              ok: false,
              held: true,
              message:
                'HELD FOR APPROVAL — this committing action was NOT performed because this agent is not on Autopilot. Do NOT retry it. Continue with everything else, then report it as queued for the user.'
            }),
            tool_call_id: tc.id
          })
          continue
        }

        const output = await executeTool(tc.name, args, ctx)
        if (isCommitting(tc.name, args)) {
          try {
            if (JSON.parse(output)?.ok === true) actionsTaken.push(String(args.summary ?? args.target ?? 'action'))
          } catch {
            /* ignore */
          }
        }
        turns.push({ role: 'tool', content: output, tool_call_id: tc.id })
      }
    }

    const usd = costUsd(model, totalIn, totalOut)
    store.logCost(model, totalIn, totalOut, usd, 'agents')
    const entry: AgentRunLog = {
      ts: Date.now(),
      ok: true,
      summary: summary || `Completed ${steps.length} steps.`,
      steps: steps.slice(-20),
      actionsTaken,
      pending,
      costUsd: usd
    }
    store.appendAgentLog(agentId, entry)
  } catch (err) {
    store.appendAgentLog(agentId, {
      ts: Date.now(),
      ok: false,
      summary: `Run failed: ${err instanceof Error ? err.message : 'unknown error'}`.slice(0, 200),
      steps: steps.slice(-20),
      actionsTaken,
      pending,
      costUsd: costUsd(model, totalIn, totalOut)
    })
  } finally {
    active.delete(agentId)
    stopping.delete(agentId)
    if (!hidden.isDestroyed()) hidden.destroy()
    emitUpdated()
  }
}

async function checkDue(): Promise<void> {
  const now = Date.now()
  for (const a of store.listAgents()) {
    if (!a.enabled || a.schedule === 'manual' || active.has(a.id)) continue
    const due = a.schedule === 'hourly' ? HOURLY_DUE : DAILY_DUE
    if (now - a.lastRunAt >= due) {
      await runAgent(a.id) // one at a time — they share the machine
    }
  }
}

export function startAgents(getMainWin: () => BrowserWindow | null): void {
  getWin = getMainWin
  setTimeout(() => {
    checkDue().catch(() => {})
  }, 60 * 1000)
  setInterval(() => {
    checkDue().catch(() => {})
  }, CHECK_INTERVAL)
}
