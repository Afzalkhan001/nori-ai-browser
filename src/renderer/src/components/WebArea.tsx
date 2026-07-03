import { useEffect, useRef } from 'react'
import { useReader } from '../store/reader'
import { IconClose } from './Icons'

/**
 * The floating web canvas. The native WebContentsView is positioned exactly
 * over the inner rounded card; its corners are rounded main-side. The card's
 * shadow bleeds around the view — the Arc-style framed look.
 */
export default function WebArea() {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    const report = () => {
      const r = el.getBoundingClientRect()
      window.nori.layout.setWebArea({ x: r.x, y: r.y, width: r.width, height: r.height })
    }
    const ro = new ResizeObserver(report)
    ro.observe(el)
    report()
    window.addEventListener('resize', report)
    return () => {
      ro.disconnect()
      window.removeEventListener('resize', report)
    }
  }, [])

  const reader = useReader()

  return (
    <div className="min-w-0 flex-1">
      <div
        ref={ref}
        className="relative h-full w-full overflow-hidden rounded-[12px] bg-white shadow-[0_2px_18px_rgba(33,33,29,0.10),0_0_0_1px_rgba(33,33,29,0.06)]"
      >
        {/* Reader mode — visible because the native view is detached while open */}
        {reader.open && reader.data && (
          <div className="absolute inset-0 overflow-y-auto bg-porcelain-50">
            <button
              onClick={() => reader.close()}
              className="fixed top-[70px] right-[440px] z-10 flex h-8 w-8 items-center justify-center rounded-full bg-white text-ink-500 shadow-[0_2px_10px_rgba(33,33,29,0.12)] transition-colors hover:text-ink-900"
              title="Close reader"
            >
              <IconClose />
            </button>
            <article className="mx-auto max-w-[680px] px-8 py-16">
              <div className="micro-label fade-up">
                {(() => {
                  try {
                    return new URL(reader.data.url).hostname.replace(/^www\./, '')
                  } catch {
                    return 'Article'
                  }
                })()}
                {reader.data.byline ? ` — ${reader.data.byline}` : ''}
              </div>
              <h1 className="font-serif-display fade-up-1 mt-4 text-[34px] leading-[1.2] text-ink-900">
                {reader.data.title}
              </h1>
              <div className="fade-up-2 mt-8 space-y-5">
                {reader.data.text
                  .split(/\n{2,}/)
                  .filter((p) => p.trim().length > 2)
                  .slice(0, 400)
                  .map((p, i) => (
                    <p key={i} className="select-text text-[15.5px] leading-[1.85] text-ink-700">
                      {p.trim()}
                    </p>
                  ))}
              </div>
              <div className="micro-label mt-14 pb-6 text-center">Nori Reader</div>
            </article>
          </div>
        )}
      </div>
    </div>
  )
}
