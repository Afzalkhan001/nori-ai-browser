import { useEffect, useState } from 'react'
import type { Agent, AgentSchedule } from '@shared/types'
import SkillsView from './SkillsView'

const EXAMPLES = [
  'Every morning, find new remote ML-engineer jobs and draft applications for me',
  'Watch these 3 competitors’ blogs and summarize anything new',
  'Track the price of this product and tell me when it drops'
]

/** Nori Agents — autonomous, acting, scheduled. The flagship panel. */
export default function AgentsPanel() {
  const [agents, setAgents] = useState<Agent[]>([])
  const [expanded, setExpanded] = useState<string | null>(null)
  const [steps, setSteps] = useState<Record<string, string>>({})
  const [view, setView] = useState<'agents' | 'skills'>('agents')
  const [adding, setAdding] = useState(false)
  const [name, setName] = useState('')
  const [goal, setGoal] = useState('')
  const [schedule, setSchedule] = useState<AgentSchedule>('daily')
  const [autopilot, setAutopilot] = useState(false)

  const refresh = () => window.nori.agents.list().then(setAgents)
  useEffect(() => {
    refresh()
    const offUpd = window.nori.agents.onUpdated(refresh)
    const offStep = window.nori.agents.onStep(({ agentId, label }) =>
      setSteps((s) => ({ ...s, [agentId]: label }))
    )
    return () => {
      offUpd()
      offStep()
    }
  }, [])

  const create = async () => {
    if (!goal.trim()) return
    await window.nori.agents.create(name.trim() || goal.trim().slice(0, 32), goal.trim(), schedule, autopilot)
    setName('')
    setGoal('')
    setAutopilot(false)
    setAdding(false)
    refresh()
  }

  const runningCount = agents.filter((a) => a.running).length

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* Header row */}
      <div className="flex shrink-0 items-center justify-between px-7 pt-5 pb-3">
        <div>
          <h2 className="font-serif-display text-[22px] italic leading-none text-ink-900">
            Agents<span className="text-moss-600">.</span>
          </h2>
          <p className="mt-1 text-[10.5px] tracking-[0.04em] text-ink-400">
            {agents.length === 0
              ? 'Autonomous. They act, on your schedule.'
              : `${agents.length} agent${agents.length === 1 ? '' : 's'}${
                  runningCount ? ` · ${runningCount} running` : ''
                }`}
          </p>
        </div>
        {view === 'agents' && (
          <button
            onClick={() => setAdding(!adding)}
            className="rounded-lg bg-moss-700 px-3 py-1.5 text-[11px] text-porcelain-50 transition-all duration-200 hover:bg-moss-600 active:scale-[0.96]"
          >
            {adding ? 'Cancel' : '+ New agent'}
          </button>
        )}
      </div>

      {/* Agents / Skills toggle */}
      <div className="flex shrink-0 items-center gap-4 px-7 pb-2">
        {(['agents', 'skills'] as const).map((v) => (
          <button
            key={v}
            onClick={() => setView(v)}
            className={`relative text-[10px] tracking-[0.12em] uppercase transition-colors duration-300 ${
              view === v ? 'text-ink-900' : 'text-ink-400 hover:text-ink-700'
            }`}
          >
            {v}
            <span
              className={`absolute inset-x-0 -bottom-1 h-px bg-moss-600 transition-transform duration-300 ${
                view === v ? 'scale-x-100' : 'scale-x-0'
              }`}
            />
          </button>
        ))}
      </div>

      {view === 'skills' && <SkillsView />}

      {view === 'agents' && (
      <div className="min-h-0 flex-1 overflow-y-auto px-7 pb-6">
        {/* Create form */}
        {adding && (
          <div className="fade-up card mb-4 rounded-xl p-4">
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Name (optional) — e.g. Job Hunter"
              spellCheck={false}
              className="mb-2 w-full rounded-lg bg-ink-900/[0.04] px-3 py-2 text-[12px] text-ink-900 outline-none placeholder:text-ink-300 focus:bg-ink-900/[0.06]"
            />
            <textarea
              value={goal}
              rows={3}
              autoFocus
              spellCheck={false}
              onChange={(e) => setGoal(e.target.value)}
              placeholder="What should this agent do? Describe the goal in plain words."
              className="w-full resize-none rounded-lg bg-ink-900/[0.04] p-3 text-[12px] leading-relaxed text-ink-900 outline-none placeholder:text-ink-300 focus:bg-ink-900/[0.06]"
            />
            <div className="mt-3 flex items-center justify-between">
              <div className="flex gap-1">
                {(['manual', 'daily', 'hourly'] as const).map((s) => (
                  <button
                    key={s}
                    onClick={() => setSchedule(s)}
                    className={`rounded-lg px-2.5 py-1 text-[10px] tracking-[0.06em] uppercase transition-all ${
                      schedule === s ? 'bg-moss-700 text-porcelain-50' : 'bg-ink-900/[0.04] text-ink-500'
                    }`}
                  >
                    {s}
                  </button>
                ))}
              </div>
              <button
                onClick={create}
                disabled={!goal.trim()}
                className="rounded-lg bg-moss-700 px-3.5 py-1.5 text-[11.5px] text-porcelain-50 transition-all active:scale-[0.96] disabled:opacity-40"
              >
                Create
              </button>
            </div>
            <button
              onClick={() => setAutopilot(!autopilot)}
              className="mt-3 flex items-center gap-2 text-[11px]"
              title="Autopilot lets this agent post/submit/buy on its own. Off = it prepares everything and holds the final step for you."
            >
              <span
                className={`flex h-4 w-7 items-center rounded-full px-0.5 transition-colors ${
                  autopilot ? 'bg-moss-600' : 'bg-ink-900/[0.12]'
                }`}
              >
                <span
                  className={`h-3 w-3 rounded-full bg-porcelain-50 transition-transform duration-200 ${
                    autopilot ? 'translate-x-3' : ''
                  }`}
                />
              </span>
              <span className={autopilot ? 'text-moss-700' : 'text-ink-400'}>
                Autopilot {autopilot ? 'on — acts on its own' : 'off — holds actions for you'}
              </span>
            </button>
          </div>
        )}

        {/* Empty state */}
        {agents.length === 0 && !adding && (
          <div className="fade-up pt-4">
            <p className="max-w-[300px] text-[12.5px] leading-relaxed text-ink-500">
              An agent pursues a goal for you — on its own, on a schedule, using the real browser.
              It researches, drafts, and acts (with your approval) and reports back.
            </p>
            <div className="mt-6">
              <div className="micro-label mb-2">Try one</div>
              {EXAMPLES.map((ex) => (
                <button
                  key={ex}
                  onClick={() => {
                    setGoal(ex)
                    setAdding(true)
                  }}
                  className="sug-row hairline flex w-full items-center justify-between border-t py-3 text-left text-[12px] text-ink-700 last:border-b hover:text-ink-900"
                >
                  <span className="pr-3">{ex}</span>
                  <span className="sug-arrow shrink-0 text-moss-600">→</span>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Agent list */}
        {agents.map((a) => {
          const open = expanded === a.id
          const latest = a.log[0]
          const pending = a.log.flatMap((r) => r.pending)
          return (
            <div key={a.id} className="hairline border-t last:border-b">
              <button
                onClick={() => {
                  setExpanded(open ? null : a.id)
                  if (!open && a.unread > 0) {
                    window.nori.agents.markSeen(a.id)
                    setAgents((xs) => xs.map((x) => (x.id === a.id ? { ...x, unread: 0 } : x)))
                  }
                }}
                className="flex w-full items-center gap-2 py-3 text-left"
              >
                <span
                  className={`h-1.5 w-1.5 shrink-0 rounded-full ${
                    a.running ? 'animate-pulse bg-moss-600' : a.enabled ? 'bg-moss-600/50' : 'bg-ink-300'
                  }`}
                />
                <span className="min-w-0 flex-1 truncate text-[12.5px] text-ink-800">{a.name}</span>
                {a.autopilot && (
                  <span className="shrink-0 text-[9px] tracking-[0.08em] text-moss-600 uppercase">auto</span>
                )}
                {a.unread > 0 && (
                  <span className="flex h-4 min-w-4 shrink-0 items-center justify-center rounded-full bg-moss-700 px-1 text-[9px] font-semibold text-porcelain-50">
                    {a.unread}
                  </span>
                )}
                <span className={`shrink-0 text-[10px] text-ink-300 transition-transform ${open ? 'rotate-90' : ''}`}>
                  →
                </span>
              </button>

              {/* Live step while running */}
              {a.running && steps[a.id] && (
                <div className="flex items-center gap-2 pb-2 pl-3.5 text-[11px] text-ink-500">
                  <span className="dot h-1 w-1 rounded-full bg-moss-600" />
                  <span className="font-serif-display italic">{steps[a.id]}</span>
                </div>
              )}

              {open && (
                <div className="fade-up pb-3 pl-3.5">
                  <p className="mb-2 text-[11.5px] leading-relaxed text-ink-500">{a.goal}</p>
                  <div className="mb-2.5 flex flex-wrap items-center gap-x-3 gap-y-1.5">
                    <span className="text-[10px] tracking-[0.1em] text-ink-400 uppercase">
                      {a.schedule} · {a.log.length} run{a.log.length === 1 ? '' : 's'}
                    </span>
                    {a.running ? (
                      <button
                        onClick={() => window.nori.agents.stopRun(a.id)}
                        className="text-[11px] text-[#b4483f] transition-colors hover:opacity-70"
                      >
                        Stop
                      </button>
                    ) : (
                      <button
                        onClick={() => window.nori.agents.runNow(a.id)}
                        className="text-[11px] text-moss-700 transition-colors hover:text-moss-600"
                      >
                        Run now
                      </button>
                    )}
                    <button
                      onClick={() => window.nori.agents.update(a.id, { autopilot: !a.autopilot })}
                      className={`text-[11px] transition-colors ${
                        a.autopilot ? 'text-moss-700 hover:text-moss-600' : 'text-ink-400 hover:text-ink-900'
                      }`}
                    >
                      Autopilot {a.autopilot ? 'on' : 'off'}
                    </button>
                    <button
                      onClick={() => window.nori.agents.update(a.id, { enabled: !a.enabled })}
                      className="text-[11px] text-ink-400 transition-colors hover:text-ink-900"
                    >
                      {a.enabled ? 'Pause' : 'Resume'}
                    </button>
                    <button
                      onClick={async () => {
                        await window.nori.agents.remove(a.id)
                        refresh()
                      }}
                      className="text-[11px] text-ink-400 transition-colors hover:text-ink-900"
                    >
                      Delete
                    </button>
                  </div>

                  {/* Pending approvals — the safety queue */}
                  {pending.length > 0 && (
                    <div className="mb-3 rounded-lg border border-moss-600/25 bg-moss-700/[0.05] p-2.5">
                      <div className="micro-label mb-1.5 !text-moss-700">
                        Waiting for you ({pending.length})
                      </div>
                      {pending.map((p) => (
                        <div key={p.id} className="mb-1.5 flex items-start gap-2 last:mb-0">
                          <span className="min-w-0 flex-1 text-[11.5px] leading-snug text-ink-700">
                            {p.description}
                            {p.url && (
                              <button
                                onClick={() => window.nori.tabs.create(p.url)}
                                className="ml-1 text-moss-700 underline decoration-moss-600/30 underline-offset-2 hover:text-moss-600"
                              >
                                open
                              </button>
                            )}
                          </span>
                          <button
                            onClick={() => window.nori.agents.dismissPending(a.id, p.id)}
                            className="shrink-0 text-[11px] text-ink-400 hover:text-ink-900"
                          >
                            ✕
                          </button>
                        </div>
                      ))}
                      {!a.autopilot && (
                        <p className="mt-1.5 text-[10px] leading-snug text-ink-400">
                          Turn on Autopilot to let this agent complete these itself.
                        </p>
                      )}
                    </div>
                  )}

                  {latest ? (
                    <>
                      <p className="text-[12px] leading-relaxed text-ink-700">{latest.summary}</p>
                      {latest.actionsTaken.length > 0 && (
                        <p className="mt-1.5 text-[11px] text-moss-700">
                          ✓ Done: {latest.actionsTaken.join(', ')}
                        </p>
                      )}
                      {latest.costUsd > 0 && (
                        <div className="mt-1.5 text-[9.5px] tracking-[0.08em] text-ink-300">
                          {latest.costUsd < 0.01 ? '<1¢' : `${Math.round(latest.costUsd * 100)}¢`} this run
                        </div>
                      )}
                    </>
                  ) : (
                    <p className="text-[11.5px] text-ink-400">
                      {a.running ? 'Working…' : a.schedule === 'manual' ? 'Press Run now to start.' : 'First run is scheduled.'}
                    </p>
                  )}
                </div>
              )}
            </div>
          )
        })}
      </div>
      )}
    </div>
  )
}
