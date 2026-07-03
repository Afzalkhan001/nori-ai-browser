import { useBrowser } from '../store/browser'
import { useAnalyze } from '../store/analyze'
import { useXray } from '../store/xray'
import { Markdown } from '../lib/markdown'

const VERDICT_STYLE: Record<string, string> = {
  supported: 'bg-[#4f8c5a]/15 text-[#3d6f47]',
  disputed: 'bg-[#be463c]/15 text-[#a03a31]',
  unverified: 'bg-[#c89628]/15 text-[#96701e]'
}

function XraySection({ tabId }: { tabId: string }) {
  const state = useXray((s) => s.byTab[tabId])
  const run = useXray((s) => s.run)

  return (
    <section className="mt-8 mb-4">
      <div className="mb-2.5 flex items-center justify-between">
        <div className="micro-label">X-ray — fact check</div>
        {state && !state.running && (
          <button
            onClick={() => run(tabId)}
            className="text-[11px] text-ink-400 transition-colors hover:text-ink-900"
          >
            Re-run
          </button>
        )}
      </div>

      {!state ? (
        <button
          onClick={() => run(tabId)}
          className="hairline sug-row flex w-full items-center justify-between rounded-xl border px-4 py-3 text-left text-[12.5px] text-ink-700 hover:text-ink-900"
        >
          <span>Verify this article’s claims against other sources</span>
          <span className="sug-arrow text-moss-600">→</span>
        </button>
      ) : (
        <div>
          {state.error && <p className="text-[12px] text-[#b4483f]">⚠ {state.error}</p>}
          {state.claims.map((c) => (
            <div key={c.idx} className="fade-up hairline border-t py-3 last:border-b">
              <div className="mb-1.5 flex items-start justify-between gap-3">
                <p className="min-w-0 text-[12.5px] leading-relaxed text-ink-900">{c.claim}</p>
                <span
                  className={`shrink-0 rounded-full px-2 py-0.5 text-[9.5px] font-semibold tracking-[0.08em] uppercase ${VERDICT_STYLE[c.verdict]}`}
                >
                  {c.verdict}
                </span>
              </div>
              <p className="text-[11.5px] leading-relaxed text-ink-500">{c.note}</p>
              {c.sources.length > 0 && (
                <div className="mt-1 flex flex-wrap gap-2">
                  {c.sources.map((s) => (
                    <button
                      key={s}
                      onClick={() => window.nori.tabs.create(s)}
                      className="max-w-[200px] truncate text-[10.5px] text-moss-700 underline decoration-moss-600/30 underline-offset-2"
                      title={s}
                    >
                      {(() => {
                        try {
                          return new URL(s).hostname.replace(/^www\./, '')
                        } catch {
                          return s
                        }
                      })()}
                    </button>
                  ))}
                </div>
              )}
            </div>
          ))}
          {state.running && (
            <div className="flex items-center gap-2 py-3">
              <span className="flex gap-1.5">
                <span className="dot h-1 w-1 rounded-full bg-moss-600" />
                <span className="dot h-1 w-1 rounded-full bg-moss-600" />
                <span className="dot h-1 w-1 rounded-full bg-moss-600" />
              </span>
              <span className="font-serif-display text-[12px] italic text-ink-500">
                Checking claim {state.claims.length + 1}
                {state.total ? ` of ${state.total}` : ''}…
              </span>
            </div>
          )}
          {!state.running && state.costUsd != null && (
            <p className="pt-2 text-[9.5px] tracking-[0.08em] text-ink-300">
              Highlights painted onto the page · {state.costUsd < 0.01 ? '<1¢' : `${Math.round(state.costUsd * 100)}¢`}
            </p>
          )}
        </div>
      )}
    </section>
  )
}

/** Analyze — free on-device facts rendered as editorial cards, then a streamed AI read. */
export default function AnalyzePanel() {
  const { activeTabId } = useBrowser()
  const tabId = activeTabId ?? ''
  const analysis = useAnalyze((s) => s.byTab[tabId])
  const run = useAnalyze((s) => s.run)

  if (!analysis) {
    return (
      <div className="flex flex-1 flex-col justify-end px-7 pb-8">
        <h2 className="font-serif-display fade-up text-[30px] italic leading-tight text-ink-900">
          Read the craft
          <span className="text-moss-600">.</span>
        </h2>
        <p className="fade-up-1 mt-3 max-w-[270px] text-[12.5px] leading-relaxed text-ink-500">
          Nori inspects the current page — framework, typography, palette, structure — and writes a
          designer’s read of it.
        </p>
        <button
          onClick={() => run(tabId)}
          className="fade-up-2 mt-8 flex h-10 w-full items-center justify-between rounded-xl bg-moss-700 px-4 text-[12.5px] tracking-[0.02em] text-porcelain-50 shadow-[0_2px_10px_rgba(52,80,62,0.35)] transition-all duration-300 hover:bg-moss-600"
        >
          <span>Analyze this page</span>
          <span>→</span>
        </button>
        <div className="fade-up-3">
          <XraySection tabId={tabId} />
        </div>
      </div>
    )
  }

  const { facts, narrative, running, error } = analysis

  return (
    <div className="min-h-0 flex-1 overflow-y-auto px-7 py-6">
      <div className="mb-5 flex items-center justify-between">
        <span className="micro-label">Analysis</span>
        <button
          onClick={() => run(tabId)}
          disabled={running}
          className="text-[11px] text-ink-400 transition-colors hover:text-ink-900 disabled:opacity-40"
        >
          Re-run
        </button>
      </div>

      {facts && (
        <div className="fade-up">
          {/* Stack */}
          {(facts.framework.length > 0 || facts.libraries.length > 0 || facts.generator) && (
            <section className="mb-6">
              <div className="micro-label mb-2.5">Stack</div>
              <div className="flex flex-wrap gap-1.5">
                {[...facts.framework, ...facts.libraries, facts.generator]
                  .filter(Boolean)
                  .map((t) => (
                    <span
                      key={t}
                      className="card rounded-lg px-2.5 py-1 text-[11.5px] text-ink-700"
                    >
                      {t}
                    </span>
                  ))}
              </div>
            </section>
          )}

          {/* Palette */}
          {facts.colors.length > 0 && (
            <section className="mb-6">
              <div className="micro-label mb-2.5">Palette</div>
              <div className="flex overflow-hidden rounded-lg shadow-[0_0_0_1px_rgba(33,33,29,0.08)]">
                {facts.colors.map((c) => (
                  <div
                    key={c.hex}
                    className="group relative h-9 flex-1"
                    style={{ backgroundColor: c.hex }}
                    title={c.hex}
                  />
                ))}
              </div>
              <div className="mt-1.5 flex justify-between">
                <span className="text-[10px] text-ink-400">{facts.colors[0]?.hex}</span>
                <span className="text-[10px] text-ink-400">
                  {facts.colors[facts.colors.length - 1]?.hex}
                </span>
              </div>
            </section>
          )}

          {/* Type */}
          {facts.fonts.length > 0 && (
            <section className="mb-6">
              <div className="micro-label mb-2.5">Typography</div>
              {facts.fonts.map((f, i) => (
                <div
                  key={f}
                  className="hairline flex items-baseline justify-between border-t py-2.5 last:border-b"
                >
                  <span className="text-[13px] text-ink-900" style={{ fontFamily: f }}>
                    {f}
                  </span>
                  <span className="text-[10px] text-ink-400">{i === 0 ? 'primary' : ''}</span>
                </div>
              ))}
            </section>
          )}

          {/* Structure */}
          <section className="mb-6">
            <div className="micro-label mb-2.5">Structure</div>
            <div className="grid grid-cols-5 gap-px overflow-hidden rounded-lg bg-ink-900/[0.08]">
              {(
                [
                  ['Links', facts.counts.links],
                  ['Buttons', facts.counts.buttons],
                  ['Forms', facts.counts.forms],
                  ['Media', facts.counts.images],
                  ['Headings', facts.counts.headings]
                ] as const
              ).map(([label, n]) => (
                <div key={label} className="bg-porcelain-50 px-1 py-2.5 text-center">
                  <div className="text-[14px] text-ink-900">{n}</div>
                  <div className="text-[9px] tracking-[0.1em] text-ink-400 uppercase">{label}</div>
                </div>
              ))}
            </div>
          </section>
        </div>
      )}

      {/* AI read */}
      <section>
        <div className="micro-label mb-2.5">
          <span className="text-moss-600">Nori’s read</span>
        </div>
        {error ? (
          <p className="text-[12.5px] text-[#b4483f]">⚠ {error}</p>
        ) : narrative ? (
          <div className="text-ink-900">
            <Markdown text={narrative} />
          </div>
        ) : running ? (
          <span className="flex gap-1.5 pt-1">
            <span className="dot h-1 w-1 rounded-full bg-moss-600" />
            <span className="dot h-1 w-1 rounded-full bg-moss-600" />
            <span className="dot h-1 w-1 rounded-full bg-moss-600" />
          </span>
        ) : null}
      </section>

      <XraySection tabId={tabId} />
    </div>
  )
}
