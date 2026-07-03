import { useEffect, useState } from 'react'
import { useBrowser } from '../store/browser'
import { useExtract } from '../store/extract'
import type { Playbook } from '@shared/types'

const EXAMPLES = [
  'All products with name and price',
  'People: name, role, company, contact',
  'Creators: name, handle, followers, niche'
]

const DEPTHS = [1, 3, 5, 10]

function domainOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return ''
  }
}

/** Extract — natural-language target → live table → CSV. Auto-paginates N pages deep. */
export default function ExtractPanel() {
  const { activeTabId } = useBrowser()
  const tab = useBrowser((s) => s.tabs.find((t) => t.id === s.activeTabId) ?? null)
  const tabId = activeTabId ?? ''
  const state = useExtract((s) => s.byTab[tabId])
  const { run, addPage, reset } = useExtract()
  const [target, setTarget] = useState('')
  const [depth, setDepth] = useState(1)
  const [exported, setExported] = useState(false)
  const [playbooks, setPlaybooks] = useState<Playbook[]>([])
  const [pbSaved, setPbSaved] = useState(false)

  const domain = domainOf(tab?.url ?? '')
  const sitePlaybooks = playbooks.filter((p) => p.domain === domain)

  useEffect(() => {
    window.nori.playbooks.list().then(setPlaybooks)
  }, [tabId])

  const doExport = async () => {
    if (!state?.rows.length) return
    await window.nori.extract.export(state.columns, state.rows, state.target)
    setExported(true)
    setTimeout(() => setExported(false), 1600)
  }

  const savePlaybook = async () => {
    if (!state || !domain) return
    await window.nori.playbooks.save(domain, state.target.slice(0, 40), state.target, state.columns)
    setPlaybooks(await window.nori.playbooks.list())
    setPbSaved(true)
    setTimeout(() => setPbSaved(false), 1600)
  }

  // ----- setup -----
  if (!state) {
    return (
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
        <div className="flex flex-1 flex-col justify-end px-7 pb-8">
          <h2 className="font-serif-display fade-up text-[30px] italic leading-tight text-ink-900">
            Page to table
            <span className="text-moss-600">.</span>
          </h2>
          <p className="fade-up-1 mt-3 max-w-[280px] text-[12.5px] leading-relaxed text-ink-500">
            Describe what you want — leads, products, creators — and Nori builds a table, following
            “next page” on its own.
          </p>

          {sitePlaybooks.length > 0 && (
            <div className="fade-up-1 mt-6">
              <div className="micro-label mb-2">Playbooks for {domain}</div>
              <div className="flex flex-wrap gap-2">
                {sitePlaybooks.map((p) => (
                  <span key={p.id} className="card group flex items-center gap-1.5 rounded-full py-1.5 pr-2 pl-3 text-[11.5px] text-ink-700">
                    <button
                      onClick={() => run(tabId, p.target, depth)}
                      className="cursor-pointer transition-colors hover:text-moss-700"
                    >
                      ▸ {p.name}
                    </button>
                    <button
                      onClick={async () => {
                        await window.nori.playbooks.delete(p.id)
                        setPlaybooks(await window.nori.playbooks.list())
                      }}
                      className="text-ink-300 transition-colors hover:text-ink-900"
                    >
                      ×
                    </button>
                  </span>
                ))}
              </div>
            </div>
          )}

          <div className="fade-up-2 mt-6">
            {EXAMPLES.map((e) => (
              <button
                key={e}
                onClick={() => setTarget(e)}
                className="sug-row hairline flex w-full items-center justify-between border-t py-3 text-left text-[12px] text-ink-500 last:border-b hover:text-ink-900"
              >
                <span>{e}</span>
                <span className="sug-arrow text-moss-600">↴</span>
              </button>
            ))}
          </div>

          {/* Depth */}
          <div className="fade-up-3 mt-5 flex items-center gap-3">
            <span className="micro-label">Pages deep</span>
            <div className="flex gap-1">
              {DEPTHS.map((d) => (
                <button
                  key={d}
                  onClick={() => setDepth(d)}
                  className={`h-7 w-9 rounded-lg text-[11.5px] transition-all duration-200 ${
                    depth === d
                      ? 'bg-moss-700 text-porcelain-50'
                      : 'bg-ink-900/[0.04] text-ink-500 hover:bg-ink-900/[0.07]'
                  }`}
                >
                  {d}
                </button>
              ))}
            </div>
          </div>

          <div className="fade-up-3 mt-4 flex items-end gap-3">
            <textarea
              value={target}
              rows={2}
              spellCheck={false}
              onChange={(e) => setTarget(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault()
                  if (target.trim()) run(tabId, target.trim(), depth)
                }
              }}
              placeholder="What should Nori extract?"
              className="min-w-0 flex-1 resize-none rounded-xl bg-ink-900/[0.04] p-3.5 text-[12.5px] leading-relaxed text-ink-900 outline-none placeholder:font-serif-display placeholder:italic placeholder:text-ink-300 focus:bg-ink-900/[0.06]"
            />
            <button
              onClick={() => target.trim() && run(tabId, target.trim(), depth)}
              disabled={!target.trim()}
              className={`mb-1 flex h-9 items-center rounded-xl px-4 text-[12px] transition-all duration-300 active:scale-[0.96] ${
                target.trim()
                  ? 'bg-moss-700 text-porcelain-50 shadow-[0_2px_10px_rgba(52,80,62,0.35)]'
                  : 'bg-ink-900/[0.05] text-ink-300'
              }`}
            >
              Extract
            </button>
          </div>
        </div>
      </div>
    )
  }

  // ----- table -----
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center justify-between px-6 pt-5 pb-3">
        <div className="min-w-0">
          <div className="micro-label truncate">{state.target}</div>
          <div className="mt-0.5 text-[11px] text-ink-400">
            {state.progress ?? `${state.rows.length} row${state.rows.length === 1 ? '' : 's'}`}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-3">
          <button
            onClick={() => reset(tabId)}
            className="text-[11px] text-ink-400 transition-colors hover:text-ink-900"
          >
            New
          </button>
          <button
            onClick={savePlaybook}
            disabled={!state.columns.length || !domain}
            className="text-[11px] text-ink-400 transition-colors hover:text-moss-700 disabled:opacity-40"
            title={`Save as a reusable playbook for ${domain}`}
          >
            {pbSaved ? 'Saved ✓' : 'Save playbook'}
          </button>
          <button
            onClick={doExport}
            disabled={!state.rows.length || state.running}
            className={`rounded-lg px-3 py-1.5 text-[11px] tracking-[0.04em] transition-all duration-300 disabled:opacity-40 ${
              exported ? 'bg-moss-700 text-porcelain-50' : 'card text-ink-700 hover:text-ink-900'
            }`}
          >
            {exported ? 'Saved' : 'Export CSV'}
          </button>
        </div>
      </div>

      {state.error && <p className="px-6 pb-2 text-[12px] text-[#b4483f]">⚠ {state.error}</p>}

      <div className="mx-4 mb-3 min-h-0 flex-1 overflow-auto rounded-xl shadow-[0_0_0_1px_rgba(33,33,29,0.08)]">
        <table className="w-full border-collapse text-[11.5px]">
          <thead className="sticky top-0">
            <tr className="bg-porcelain-200">
              {state.columns.map((c) => (
                <th
                  key={c}
                  className="px-3 py-2 text-left text-[9.5px] font-semibold tracking-[0.12em] whitespace-nowrap text-ink-500 uppercase"
                >
                  {c}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {state.rows.map((r, i) => (
              <tr key={i} className="odd:bg-white even:bg-porcelain-50">
                {r.map((cell, j) => (
                  <td key={j} className="max-w-[220px] truncate px-3 py-2 align-top text-ink-700" title={cell}>
                    {cell.startsWith('http') ? (
                      <button
                        onClick={() => window.nori.tabs.create(cell)}
                        className="cursor-pointer text-moss-600 underline decoration-moss-600/40"
                      >
                        link
                      </button>
                    ) : (
                      cell
                    )}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
        {state.running && (
          <div className="flex justify-center py-4">
            <span className="flex gap-1.5">
              <span className="dot h-1 w-1 rounded-full bg-moss-600" />
              <span className="dot h-1 w-1 rounded-full bg-moss-600" />
              <span className="dot h-1 w-1 rounded-full bg-moss-600" />
            </span>
          </div>
        )}
      </div>

      <div className="px-6 pb-4">
        <button
          onClick={() => addPage(tabId)}
          disabled={state.running}
          className="w-full rounded-xl border border-dashed border-ink-300 py-2.5 text-[12px] text-ink-500 transition-colors hover:border-moss-600 hover:text-moss-700 disabled:opacity-40"
        >
          + Add this page manually
        </button>
      </div>
    </div>
  )
}
