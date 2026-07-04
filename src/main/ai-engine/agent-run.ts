import { BrowserWindow } from 'electron'
import { randomUUID } from 'crypto'
import {
  IPC,
  type AgentPendingAction,
  type AgentRunLog,
  type SkillRunResult
} from '@shared/types'
import { streamChat, type ChatTurn } from './openai'
import { costUsd } from './cost'
import { AGENT_TOOLS, executeTool, stepLabel, type AgentCtx } from './agent'
import * as store from '../db/store'

/**
 * Autonomous ACTING runs. Unlike Missions (read-only research), a run drives the
 * FULL browser toolset — navigate, click, fill, submit — in a hidden window that
 * shares the user's session (so it's logged in wherever they are). Two callers:
 *   • Agents  — a standing goal, on a schedule or on demand.
 *   • Skills  — a reusable, parameterized procedure invoked directly or by an agent.
 *
 * SAFETY: a committing action (submit/post/pay/order/delete) only executes when
 * Autopilot is on. Otherwise it's HELD — the run does everything else and queues
 * the action for the user. No human is at the screen during scheduled runs, so we
 * never guess.
 */

// The full toolset minus things tied to the user's live tabs or that spawn more
// background work. run_skill IS included so agents can compose skills.
const RUNNER_TOOLS = AGENT_TOOLS.filter(
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
const MAX_ROUNDS = 40
const COST_CAP_USD = 0.6

const BASE_SYSTEM = `You are one of Nori's autonomous workers — you pursue a GOAL on the user's
behalf using real browser tools (search_web, navigate, read_page, click, scroll, wait,
read_form, fill_form, submit_form, find_posts, save_pdf, search_history, run_skill). You
control a real browser tab that shares the user's logged-in session.

Operate autonomously and decisively:
1. Plan the concrete steps, then DO them with tools — navigate, read_page to see state,
   click/scroll/fill to act, read_page again to verify, adapt when the page differs. Loop
   until the goal is met or you've genuinely exhausted options.
2. Use search_history to recall what was seen before; use run_skill to invoke a saved skill.
3. HONESTY: never claim you did something unless the tool returned success. Report only real
   results with real links you actually saw.
4. COMMITTING ACTIONS: if you try to submit/post/pay/order/delete and Autopilot is OFF, the
   tool will say it was HELD for the user's approval. That is expected — do NOT retry it. Do
   everything else, then describe in your report what is queued.
5. REFUSE illegal or offensive-security tasks.

When finished, write a SHORT plain-language report of what you accomplished: what you found or
did, concrete links, and anything waiting on the user. This report is what they read.`

interface RunOutcome {
  summary: string
  steps: string[]
  actionsTaken: string[]
  pending: AgentPendingAction[]
  costUsd: number
}

const active = new Set<string>()
const stopping = new Set<string>()
let getWin: (() => BrowserWindow | null) | null = null

export function isAgentRunning(id: string): boolean {
  return active.has(id)
}
export function stopAgentRun(id: string): void {
  if (active.has(id)) stopping.add(id)
}
function emitUpdated(channel: string): void {
  const win = getWin?.()
  if (win && !win.isDestroyed()) win.webContents.send(channel)
}

/** A one-line catalog of saved skills, injected so a run can invoke them. */
function skillsCatalog(): string {
  const skills = store.listSkills()
  if (!skills.length) return ''
  const lines = skills
    .slice(0, 30)
    .map((s) => `- "${s.name}"${s.params.length ? ` (params: ${s.params.map((p) => p.name).join(', ')})` : ''}: ${s.description || s.procedure.slice(0, 80)}`)
    .join('\n')
  return `\n\nSAVED SKILLS you may invoke with run_skill(name, params):\n${lines}`
}

/** The shared acting loop. Returns the run outcome; persistence is the caller's job. */
async function executeRun(opts: {
  runId: string
  goal: string
  autopilot: boolean
  emitStep: (label: string) => void
}): Promise<RunOutcome> {
  const { runId, goal, autopilot, emitStep } = opts
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
      {
        role: 'system',
        content: `${BASE_SYSTEM}\n\nTODAY: ${new Date().toDateString()}${skillsCatalog()}`
      },
      {
        role: 'user',
        content: `GOAL:\n${goal}\n\nAutopilot: ${
          autopilot ? 'ON — you MAY take committing actions.' : 'OFF — committing actions will be HELD for the user.'
        }\n\nBegin. Work autonomously toward the goal now.`
      }
    ]

    for (let round = 0; round < MAX_ROUNDS; round++) {
      if (stopping.has(runId)) {
        summary = summary || 'Run stopped by the user.'
        break
      }
      if (costUsd(model || 'gpt-4o-mini', totalIn, totalOut) > COST_CAP_USD) {
        summary = summary || 'Reached this run’s cost limit; stopping.'
        break
      }
      const lastRound = round === MAX_ROUNDS - 1
      const result = await streamChat('smart', turns, () => {}, undefined, lastRound ? undefined : RUNNER_TOOLS)
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

        if (isCommitting(tc.name, args) && !autopilot) {
          const desc = String(args.summary ?? args.target ?? 'a committing action')
          pending.push({ id: randomUUID(), ts: Date.now(), description: desc.slice(0, 160), url: hidden.webContents.getURL() })
          turns.push({
            role: 'tool',
            content: JSON.stringify({
              ok: false,
              held: true,
              message:
                'HELD FOR APPROVAL — this committing action was NOT performed because Autopilot is off. Do NOT retry it. Continue with everything else, then report it as queued for the user.'
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
  } finally {
    if (!hidden.isDestroyed()) hidden.destroy()
  }

  return {
    summary: summary || `Completed ${steps.length} steps.`,
    steps: steps.slice(-20),
    actionsTaken,
    pending,
    costUsd: costUsd(model, totalIn, totalOut)
  }
}

/** Execute one full autonomous run of a stored agent. */
export async function runAgent(agentId: string): Promise<void> {
  const agent = store.listAgents().find((a) => a.id === agentId)
  if (!agent || active.has(agentId)) return
  active.add(agentId)
  store.updateAgent(agentId, { running: true })
  emitUpdated(IPC.AgentUpdated)

  const win = getWin?.()
  const emitStep = (label: string): void => {
    if (win && !win.isDestroyed()) win.webContents.send(IPC.AgentStep, { agentId, label })
  }

  try {
    const out = await executeRun({
      runId: agentId,
      goal: `AGENT: ${agent.name}\n${agent.goal}`,
      autopilot: agent.autopilot,
      emitStep
    })
    store.logCost('gpt-4o', 0, 0, out.costUsd, 'agents')
    const entry: AgentRunLog = { ts: Date.now(), ok: true, ...out }
    store.appendAgentLog(agentId, entry)
  } catch (err) {
    store.appendAgentLog(agentId, {
      ts: Date.now(),
      ok: false,
      summary: `Run failed: ${err instanceof Error ? err.message : 'unknown error'}`.slice(0, 200),
      steps: [],
      actionsTaken: [],
      pending: [],
      costUsd: 0
    })
  } finally {
    active.delete(agentId)
    stopping.delete(agentId)
    emitUpdated(IPC.AgentUpdated)
  }
}

/** Run a saved skill directly with the given params; resolves with the result. */
export async function runSkill(skillId: string, params: Record<string, string>): Promise<SkillRunResult> {
  const skill = store.listSkills().find((s) => s.id === skillId)
  if (!skill) return { ok: false, summary: 'No such skill.', actionsTaken: [], pending: [], costUsd: 0 }
  if (active.has(skillId)) return { ok: false, summary: 'This skill is already running.', actionsTaken: [], pending: [], costUsd: 0 }
  active.add(skillId)

  const win = getWin?.()
  const emitStep = (label: string): void => {
    if (win && !win.isDestroyed()) win.webContents.send(IPC.SkillStep, { skillId, label })
  }

  // Substitute {param} placeholders with the user's values.
  let procedure = skill.procedure
  for (const p of skill.params) {
    const v = params[p.name] ?? ''
    procedure = procedure.replaceAll(`{${p.name}}`, v)
  }
  const paramList = skill.params.map((p) => `${p.name} = ${params[p.name] ?? '(unset)'}`).join('\n')

  try {
    const out = await executeRun({
      runId: skillId,
      goal: `SKILL: ${skill.name}\n${skill.description}\n\nSTEPS:\n${procedure}${paramList ? `\n\nVALUES:\n${paramList}` : ''}`,
      autopilot: skill.autopilot,
      emitStep
    })
    store.logCost('gpt-4o', 0, 0, out.costUsd, 'skills')
    store.touchSkill(skillId)
    emitUpdated(IPC.SkillUpdated)
    return { ok: true, ...out }
  } catch (err) {
    return {
      ok: false,
      summary: `Skill failed: ${err instanceof Error ? err.message : 'unknown error'}`.slice(0, 200),
      actionsTaken: [],
      pending: [],
      costUsd: 0
    }
  } finally {
    active.delete(skillId)
    stopping.delete(skillId)
  }
}

async function checkDue(): Promise<void> {
  const now = Date.now()
  for (const a of store.listAgents()) {
    if (!a.enabled || a.schedule === 'manual' || active.has(a.id)) continue
    const due = a.schedule === 'hourly' ? HOURLY_DUE : DAILY_DUE
    if (now - a.lastRunAt >= due) {
      await runAgent(a.id)
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
