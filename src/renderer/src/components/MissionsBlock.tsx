import { useEffect, useState } from 'react'
import type { Mission } from '@shared/types'

/** Standing goals — shown in the chat empty state. Local render, zero tokens. */
export default function MissionsBlock() {
  const [missions, setMissions] = useState<Mission[]>([])
  const [expanded, setExpanded] = useState<string | null>(null)
  const [adding, setAdding] = useState(false)
  const [goal, setGoal] = useState('')
  const [schedule, setSchedule] = useState<'hourly' | 'daily'>('daily')
  const [runningId, setRunningId] = useState<string | null>(null)

  const refresh = () => window.nori.missions.list().then(setMissions)
  useEffect(() => {
    refresh()
    return window.nori.missions.onUpdated(() => {
      refresh()
      setRunningId(null)
    })
  }, [])

  const create = async () => {
    if (!goal.trim()) return
    await window.nori.missions.create(goal.trim(), schedule)
    setGoal('')
    setAdding(false)
    refresh()
  }

  return (
    <div className="fade-up-3 mt-7">
      <div className="mb-2.5 flex items-center justify-between">
        <span className="micro-label">Missions</span>
        <button
          onClick={() => setAdding(!adding)}
          className="text-[11px] text-ink-400 transition-colors hover:text-moss-700"
        >
          {adding ? 'Cancel' : '+ New mission'}
        </button>
      </div>

      {adding && (
        <div className="fade-up mb-3">
          <textarea
            value={goal}
            rows={2}
            spellCheck={false}
            autoFocus
            onChange={(e) => setGoal(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                create()
              }
            }}
            placeholder="e.g. Keep looking for 2BHK flats under 25k in Hyderabad"
            className="w-full resize-none rounded-xl bg-ink-900/[0.04] p-3 text-[12px] leading-relaxed text-ink-900 outline-none placeholder:text-ink-300 focus:bg-ink-900/[0.06]"
          />
          <div className="mt-2 flex items-center justify-between">
            <div className="flex gap-1">
              {(['daily', 'hourly'] as const).map((s) => (
                <button
                  key={s}
                  onClick={() => setSchedule(s)}
                  className={`rounded-lg px-2.5 py-1 text-[10.5px] tracking-[0.06em] uppercase transition-all ${
                    schedule === s
                      ? 'bg-moss-700 text-porcelain-50'
                      : 'bg-ink-900/[0.04] text-ink-500'
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
              Start mission
            </button>
          </div>
        </div>
      )}

      {missions.map((m) => {
        const open = expanded === m.id
        const latest = m.log[0]
        return (
          <div key={m.id} className="hairline border-t last:border-b">
            <button
              onClick={() => {
                setExpanded(open ? null : m.id)
                if (!open && m.unread > 0) {
                  window.nori.missions.markSeen(m.id)
                  setMissions((ms) => ms.map((x) => (x.id === m.id ? { ...x, unread: 0 } : x)))
                }
              }}
              className="flex w-full items-center gap-2 py-3 text-left"
            >
              <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${runningId === m.id ? 'animate-pulse bg-moss-600' : 'bg-moss-600/50'}`} />
              <span className="min-w-0 flex-1 truncate text-[12.5px] text-ink-700">{m.goal}</span>
              {m.unread > 0 && (
                <span className="flex h-4 min-w-4 shrink-0 items-center justify-center rounded-full bg-moss-700 px-1 text-[9px] font-semibold text-porcelain-50">
                  {m.unread}
                </span>
              )}
              <span className={`shrink-0 text-[10px] text-ink-300 transition-transform ${open ? 'rotate-90' : ''}`}>
                →
              </span>
            </button>

            {open && (
              <div className="fade-up pb-3 pl-3.5">
                <div className="mb-2 flex items-center gap-3">
                  <span className="text-[10px] tracking-[0.1em] text-ink-400 uppercase">
                    {m.schedule} · {m.log.length} update{m.log.length === 1 ? '' : 's'}
                  </span>
                  <button
                    onClick={async () => {
                      setRunningId(m.id)
                      await window.nori.missions.runNow(m.id)
                      setRunningId(null)
                      refresh()
                    }}
                    disabled={runningId === m.id}
                    className="text-[11px] text-moss-700 transition-colors hover:text-moss-600 disabled:opacity-50"
                  >
                    {runningId === m.id ? 'Running…' : 'Run now'}
                  </button>
                  <button
                    onClick={async () => {
                      await window.nori.missions.remove(m.id)
                      refresh()
                    }}
                    className="text-[11px] text-ink-400 transition-colors hover:text-ink-900"
                  >
                    Delete
                  </button>
                </div>
                {latest ? (
                  <>
                    <p className="mb-1.5 text-[12px] leading-relaxed text-ink-500">{latest.summary}</p>
                    {latest.items.slice(0, 6).map((it) => (
                      <button
                        key={it.url}
                        onClick={() => window.nori.tabs.create(it.url)}
                        className="block w-full truncate py-1 text-left text-[12px] text-moss-700 underline decoration-moss-600/30 underline-offset-2 hover:text-moss-600"
                        title={it.url}
                      >
                        {it.title || it.url}
                      </button>
                    ))}
                  </>
                ) : (
                  <p className="text-[11.5px] text-ink-400">No findings yet — first run is coming.</p>
                )}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}
