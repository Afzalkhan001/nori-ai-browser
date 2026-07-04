import { useEffect, useState } from 'react'
import type { Skill, SkillRunResult } from '@shared/types'

/** Teachable Skills — reusable, parameterized procedures agents and you can run. */
export default function SkillsView() {
  const [skills, setSkills] = useState<Skill[]>([])
  const [expanded, setExpanded] = useState<string | null>(null)
  const [adding, setAdding] = useState(false)
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [procedure, setProcedure] = useState('')
  const [paramsCsv, setParamsCsv] = useState('')
  const [autopilot, setAutopilot] = useState(false)

  // Per-skill run state: filled params, live step, result, running flag.
  const [runVals, setRunVals] = useState<Record<string, Record<string, string>>>({})
  const [step, setStep] = useState<Record<string, string>>({})
  const [result, setResult] = useState<Record<string, SkillRunResult>>({})
  const [running, setRunning] = useState<Record<string, boolean>>({})

  const refresh = () => window.nori.skills.list().then(setSkills)
  useEffect(() => {
    refresh()
    const offUpd = window.nori.skills.onUpdated(refresh)
    const offStep = window.nori.skills.onStep(({ skillId, label }) =>
      setStep((s) => ({ ...s, [skillId]: label }))
    )
    return () => {
      offUpd()
      offStep()
    }
  }, [])

  const create = async () => {
    if (!procedure.trim()) return
    const params = paramsCsv
      .split(',')
      .map((p) => p.trim())
      .filter(Boolean)
      .map((p) => ({ name: p, label: p }))
    await window.nori.skills.create(name.trim() || 'Skill', description.trim(), procedure.trim(), params, autopilot)
    setName('')
    setDescription('')
    setProcedure('')
    setParamsCsv('')
    setAutopilot(false)
    setAdding(false)
    refresh()
  }

  const run = async (skill: Skill) => {
    const vals = runVals[skill.id] ?? {}
    setRunning((r) => ({ ...r, [skill.id]: true }))
    setResult((r) => ({ ...r, [skill.id]: undefined as never }))
    const res = await window.nori.skills.run(skill.id, vals)
    setResult((r) => ({ ...r, [skill.id]: res }))
    setRunning((r) => ({ ...r, [skill.id]: false }))
    setStep((s) => ({ ...s, [skill.id]: '' }))
  }

  return (
    <div className="min-h-0 flex-1 overflow-y-auto px-7 pb-6">
      <div className="flex items-center justify-between py-3">
        <span className="micro-label">Skills</span>
        <button
          onClick={() => setAdding(!adding)}
          className="text-[11px] text-ink-400 transition-colors hover:text-moss-700"
        >
          {adding ? 'Cancel' : '+ New skill'}
        </button>
      </div>

      {adding && (
        <div className="fade-up card mb-4 rounded-xl p-4">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Skill name — e.g. Apply to a job"
            spellCheck={false}
            className="mb-2 w-full rounded-lg bg-ink-900/[0.04] px-3 py-2 text-[12px] text-ink-900 outline-none placeholder:text-ink-300 focus:bg-ink-900/[0.06]"
          />
          <input
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="One line: what it does"
            spellCheck={false}
            className="mb-2 w-full rounded-lg bg-ink-900/[0.04] px-3 py-2 text-[12px] text-ink-900 outline-none placeholder:text-ink-300 focus:bg-ink-900/[0.06]"
          />
          <textarea
            value={procedure}
            rows={4}
            spellCheck={false}
            onChange={(e) => setProcedure(e.target.value)}
            placeholder={'The steps, in plain words. Use {braces} for parameters.\ne.g. Go to {url}, click Apply, fill name={name} and email={email}, then submit.'}
            className="w-full resize-none rounded-lg bg-ink-900/[0.04] p-3 text-[12px] leading-relaxed text-ink-900 outline-none placeholder:text-ink-300 focus:bg-ink-900/[0.06]"
          />
          <input
            value={paramsCsv}
            onChange={(e) => setParamsCsv(e.target.value)}
            placeholder="Parameters, comma-separated — e.g. url, name, email"
            spellCheck={false}
            className="mt-2 w-full rounded-lg bg-ink-900/[0.04] px-3 py-2 text-[12px] text-ink-900 outline-none placeholder:text-ink-300 focus:bg-ink-900/[0.06]"
          />
          <div className="mt-3 flex items-center justify-between">
            <button
              onClick={() => setAutopilot(!autopilot)}
              className="flex items-center gap-2 text-[11px]"
              title="Autopilot lets a direct run complete committing steps (submit/pay/post) on its own."
            >
              <span className={`flex h-4 w-7 items-center rounded-full px-0.5 transition-colors ${autopilot ? 'bg-moss-600' : 'bg-ink-900/[0.12]'}`}>
                <span className={`h-3 w-3 rounded-full bg-porcelain-50 transition-transform duration-200 ${autopilot ? 'translate-x-3' : ''}`} />
              </span>
              <span className={autopilot ? 'text-moss-700' : 'text-ink-400'}>Autopilot {autopilot ? 'on' : 'off'}</span>
            </button>
            <button
              onClick={create}
              disabled={!procedure.trim()}
              className="rounded-lg bg-moss-700 px-3.5 py-1.5 text-[11.5px] text-porcelain-50 transition-all active:scale-[0.96] disabled:opacity-40"
            >
              Save skill
            </button>
          </div>
        </div>
      )}

      {skills.length === 0 && !adding && (
        <p className="fade-up max-w-[300px] pt-2 text-[12.5px] leading-relaxed text-ink-500">
          Teach Nori a repeatable task once — in plain words, with {'{'}parameters{'}'} — and run it
          anytime, or let an agent invoke it. Your automations live on your machine.
        </p>
      )}

      {skills.map((sk) => {
        const open = expanded === sk.id
        const vals = runVals[sk.id] ?? {}
        const res = result[sk.id]
        const busy = running[sk.id]
        return (
          <div key={sk.id} className="hairline border-t last:border-b">
            <button
              onClick={() => setExpanded(open ? null : sk.id)}
              className="flex w-full items-center gap-2 py-3 text-left"
            >
              <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${busy ? 'animate-pulse bg-moss-600' : 'bg-moss-600/50'}`} />
              <span className="min-w-0 flex-1 truncate text-[12.5px] text-ink-800">{sk.name}</span>
              {sk.autopilot && <span className="shrink-0 text-[9px] tracking-[0.08em] text-moss-600 uppercase">auto</span>}
              {sk.runCount > 0 && <span className="shrink-0 text-[10px] text-ink-300">{sk.runCount}×</span>}
              <span className={`shrink-0 text-[10px] text-ink-300 transition-transform ${open ? 'rotate-90' : ''}`}>→</span>
            </button>

            {open && (
              <div className="fade-up pb-3 pl-3.5">
                {sk.description && <p className="mb-2 text-[11.5px] leading-relaxed text-ink-500">{sk.description}</p>}
                {sk.params.map((p) => (
                  <input
                    key={p.name}
                    value={vals[p.name] ?? ''}
                    onChange={(e) =>
                      setRunVals((rv) => ({ ...rv, [sk.id]: { ...(rv[sk.id] ?? {}), [p.name]: e.target.value } }))
                    }
                    placeholder={p.label}
                    spellCheck={false}
                    className="mb-1.5 w-full rounded-lg bg-ink-900/[0.04] px-3 py-1.5 text-[12px] text-ink-900 outline-none placeholder:text-ink-300 focus:bg-ink-900/[0.06]"
                  />
                ))}
                <div className="mt-1 flex items-center gap-3">
                  <button
                    onClick={() => run(sk)}
                    disabled={busy}
                    className="rounded-lg bg-moss-700 px-3 py-1.5 text-[11px] text-porcelain-50 transition-all active:scale-[0.96] disabled:opacity-50"
                  >
                    {busy ? 'Running…' : 'Run'}
                  </button>
                  <button
                    onClick={() => window.nori.skills.update(sk.id, { autopilot: !sk.autopilot })}
                    className={`text-[11px] transition-colors ${sk.autopilot ? 'text-moss-700 hover:text-moss-600' : 'text-ink-400 hover:text-ink-900'}`}
                  >
                    Autopilot {sk.autopilot ? 'on' : 'off'}
                  </button>
                  <button
                    onClick={async () => {
                      await window.nori.skills.remove(sk.id)
                      refresh()
                    }}
                    className="text-[11px] text-ink-400 transition-colors hover:text-ink-900"
                  >
                    Delete
                  </button>
                </div>

                {busy && step[sk.id] && (
                  <div className="mt-2 flex items-center gap-2 text-[11px] text-ink-500">
                    <span className="dot h-1 w-1 rounded-full bg-moss-600" />
                    <span className="font-serif-display italic">{step[sk.id]}</span>
                  </div>
                )}

                {res && (
                  <div className="fade-up mt-2.5">
                    <p className="text-[12px] leading-relaxed text-ink-700">{res.summary}</p>
                    {res.actionsTaken.length > 0 && (
                      <p className="mt-1.5 text-[11px] text-moss-700">✓ Done: {res.actionsTaken.join(', ')}</p>
                    )}
                    {res.pending.length > 0 && (
                      <p className="mt-1.5 text-[11px] text-ink-500">
                        {res.pending.length} action{res.pending.length === 1 ? '' : 's'} held for your approval (turn on Autopilot to auto-complete).
                      </p>
                    )}
                    {res.costUsd > 0 && (
                      <div className="mt-1.5 text-[9.5px] tracking-[0.08em] text-ink-300">
                        {res.costUsd < 0.01 ? '<1¢' : `${Math.round(res.costUsd * 100)}¢`}
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}
