import { useEffect, useState } from 'react'
import { useBrowser } from '../store/browser'
import { useExtract } from '../store/extract'
import { useCompose } from '../store/compose'
import type { Artifact, CostSummary } from '@shared/types'

const TYPE_GLYPH: Record<string, string> = { pdf: '⎙', extract: '▦', compose: '✎' }

/** Library — everything Nori has produced, searchable, plus the spend dashboard. */
export default function LibraryPanel() {
  const { activeTabId, setSidebarMode } = useBrowser()
  const tabId = activeTabId ?? ''
  const [items, setItems] = useState<Artifact[]>([])
  const [query, setQuery] = useState('')
  const [cost, setCost] = useState<CostSummary | null>(null)
  const loadExtract = useExtract((s) => s.loadArtifact)

  const refresh = () => {
    window.nori.library.list().then(setItems)
    window.nori.library.costSummary().then(setCost)
  }
  useEffect(refresh, [])

  const filtered = query.trim()
    ? items.filter((a) => a.title.toLowerCase().includes(query.trim().toLowerCase()))
    : items

  const open = (a: Artifact) => {
    if (a.type === 'pdf' && a.meta.path) {
      window.nori.library.openPath(a.meta.path)
    } else if (a.type === 'extract' && a.data?.columns) {
      loadExtract(tabId, a.meta.target ?? a.title, a.data.columns, a.data.rows ?? [])
      setSidebarMode('extract')
    } else if (a.type === 'compose' && a.data?.text) {
      useCompose.setState((s) => ({
        byTab: {
          ...s.byTab,
          [tabId]: {
            format: a.meta.format ?? 'Content',
            text: a.data?.text ?? '',
            running: false,
            error: null
          }
        }
      }))
      setSidebarMode('compose')
    }
  }

  const maxSource = Math.max(...(cost?.bySource.map((s) => s.usd) ?? [0]), 0.000001)

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* Usage */}
      {cost && (
        <div className="hairline border-b px-6 py-4">
          <div className="micro-label mb-3">Usage</div>
          <div className="flex gap-6">
            {(
              [
                ['Today', cost.todayUsd],
                ['7 days', cost.weekUsd],
                ['All time', cost.totalUsd]
              ] as const
            ).map(([label, usd]) => (
              <div key={label}>
                <div className="font-serif-display text-[19px] text-ink-900">
                  ${usd < 0.005 && usd > 0 ? usd.toFixed(3) : usd.toFixed(2)}
                </div>
                <div className="text-[9.5px] tracking-[0.14em] text-ink-400 uppercase">{label}</div>
              </div>
            ))}
          </div>
          {cost.bySource.length > 0 && (
            <div className="mt-3 space-y-1.5">
              {cost.bySource.slice(0, 5).map((s) => (
                <div key={s.source} className="flex items-center gap-2">
                  <span className="w-14 text-[10px] tracking-[0.08em] text-ink-400 uppercase">
                    {s.source}
                  </span>
                  <div className="h-[3px] flex-1 overflow-hidden rounded-full bg-ink-900/[0.06]">
                    <div
                      className="h-full rounded-full bg-moss-600/70"
                      style={{ width: `${Math.max(4, (s.usd / maxSource) * 100)}%` }}
                    />
                  </div>
                  <span className="w-12 text-right text-[10px] text-ink-400">${s.usd.toFixed(2)}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Search */}
      <div className="px-6 pt-4 pb-2">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search your library…"
          spellCheck={false}
          className="h-8.5 w-full rounded-xl bg-ink-900/[0.04] px-3.5 text-[12px] text-ink-900 outline-none placeholder:font-serif-display placeholder:italic placeholder:text-ink-300 focus:bg-ink-900/[0.06]"
        />
      </div>

      {/* Artifacts */}
      <div className="min-h-0 flex-1 overflow-y-auto px-6 pb-4">
        {filtered.length === 0 ? (
          <p className="pt-6 text-center text-[12px] text-ink-400">
            {items.length === 0
              ? 'PDFs, extracts and content you create will collect here.'
              : 'Nothing matches.'}
          </p>
        ) : (
          filtered.map((a) => (
            <div
              key={a.id}
              className="group hairline flex items-center gap-3 border-t py-3 last:border-b"
            >
              <span className="w-5 text-center text-[14px] text-moss-600">
                {TYPE_GLYPH[a.type] ?? '·'}
              </span>
              <button onClick={() => open(a)} className="min-w-0 flex-1 cursor-pointer text-left">
                <div className="truncate text-[12.5px] text-ink-900 transition-colors group-hover:text-moss-900">
                  {a.title}
                </div>
                <div className="text-[10px] text-ink-400">
                  {a.type}
                  {a.meta.rowCount ? ` · ${a.meta.rowCount} rows` : ''} ·{' '}
                  {new Date(a.createdAt).toLocaleDateString(undefined, {
                    month: 'short',
                    day: 'numeric'
                  })}
                </div>
              </button>
              <button
                onClick={async () => {
                  await window.nori.library.delete(a.id)
                  refresh()
                }}
                className="text-ink-300 opacity-0 transition-all group-hover:opacity-100 hover:text-ink-900"
                title="Delete"
              >
                ×
              </button>
            </div>
          ))
        )}
      </div>
    </div>
  )
}
