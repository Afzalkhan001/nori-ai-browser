import { useEffect, useMemo, useRef, useState } from 'react'
import { create } from 'zustand'
import { useBrowser, type SidebarMode } from '../store/browser'
import { useChat } from '../store/chat'
import { useReader } from '../store/reader'
import { useAnalyze } from '../store/analyze'
import { useCompose } from '../store/compose'

interface PaletteStore {
  open: boolean
  setOpen: (open: boolean) => void
}

export const usePalette = create<PaletteStore>((set) => ({
  open: false,
  setOpen: (open) => set({ open })
}))

interface Command {
  label: string
  hint: string
  run: () => void
}

/** Ctrl+K — every Nori action, one keystroke away. */
export default function CommandPalette() {
  const { open, setOpen } = usePalette()
  const [query, setQuery] = useState('')
  const [sel, setSel] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const { activeTabId, setSidebarMode, toggleSidebar } = useBrowser()
  const reader = useReader()

  // Hide the native web view while open so the overlay is visible.
  useEffect(() => {
    if (!reader.open) window.nori.reader.setHidden(open)
    if (open) {
      setQuery('')
      setSel(0)
      requestAnimationFrame(() => inputRef.current?.focus())
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  const commands = useMemo<Command[]>(() => {
    const tabId = activeTabId ?? ''
    const mode = (m: SidebarMode) => () => setSidebarMode(m)
    const ask = (text: string) => () => {
      setSidebarMode('chat')
      useChat.getState().send(tabId, text)
    }
    return [
      { label: 'New tab', hint: 'Ctrl+T', run: () => window.nori.tabs.create() },
      { label: 'Close tab', hint: 'Ctrl+W', run: () => tabId && window.nori.tabs.close(tabId) },
      { label: 'Toggle Assist sidebar', hint: 'Ctrl+E', run: toggleSidebar },
      { label: 'Summarize this page', hint: 'AI', run: ask('Summarize this page') },
      {
        label: 'Find more coverage of this story',
        hint: 'AI',
        run: ask('Find more coverage of this story from other outlets, with links.')
      },
      {
        label: 'Research this topic → PDF report',
        hint: 'AI',
        run: ask('Research this topic thoroughly and make me a PDF report.')
      },
      {
        label: 'Analyze this page',
        hint: 'AI',
        run: () => {
          setSidebarMode('analyze')
          useAnalyze.getState().run(tabId)
        }
      },
      { label: 'Open Chat', hint: 'Mode', run: mode('chat') },
      { label: 'Open Prompts', hint: 'Mode', run: mode('prompts') },
      { label: 'Open Extract', hint: 'Mode', run: mode('extract') },
      { label: 'Open Library', hint: 'Mode', run: mode('library') },
      ...['X thread', 'LinkedIn post', 'Instagram caption', 'YouTube script', 'Blog outline', 'Newsletter', 'SEO brief'].map(
        (f) => ({
          label: `Compose: ${f}`,
          hint: 'AI',
          run: () => {
            setSidebarMode('compose')
            useCompose.getState().generate(tabId, f, '')
          }
        })
      ),
      {
        label: 'X-ray: fact-check this page',
        hint: 'AI',
        run: () => {
          setSidebarMode('analyze')
          import('../store/xray').then(({ useXray }) => useXray.getState().run(tabId))
        }
      },
      {
        label: 'What was I reading yesterday?',
        hint: 'Recall',
        run: ask('What was I reading yesterday? Search my browsing memory and give me links.')
      },
      {
        label: 'Toggle Recall memory',
        hint: 'Recall',
        run: () => window.nori.recall.toggle()
      },
      { label: 'Reader mode', hint: 'View', run: () => reader.toggle() },
      {
        label: 'Toggle ad blocker',
        hint: 'Shield',
        run: () => window.nori.blocker.toggle()
      },
      { label: 'Zoom in', hint: 'Ctrl +', run: () => window.nori.zoom('in') },
      { label: 'Zoom out', hint: 'Ctrl −', run: () => window.nori.zoom('out') },
      { label: 'Reset zoom', hint: 'Ctrl 0', run: () => window.nori.zoom('reset') }
    ]
  }, [activeTabId, setSidebarMode, toggleSidebar, reader])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return commands
    return commands
      .map((c) => ({ c, score: c.label.toLowerCase().indexOf(q) }))
      .filter((x) => x.score >= 0)
      .sort((a, b) => a.score - b.score)
      .map((x) => x.c)
  }, [commands, query])

  useEffect(() => setSel(0), [query])

  if (!open) return null

  const runSel = (cmd?: Command) => {
    const c = cmd ?? filtered[sel]
    if (!c) return
    setOpen(false)
    // let the view re-attach before actions that need it
    setTimeout(() => c.run(), 60)
  }

  return (
    <div
      className="absolute inset-0 z-50 flex items-start justify-center bg-ink-900/10 pt-[12vh] backdrop-blur-[2px]"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) setOpen(false)
      }}
    >
      <div className="fade-up w-[520px] overflow-hidden rounded-2xl bg-porcelain-50 shadow-[0_18px_60px_rgba(33,33,29,0.25),0_0_0_1px_rgba(33,33,29,0.08)]">
        <input
          ref={inputRef}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') setOpen(false)
            else if (e.key === 'ArrowDown') {
              e.preventDefault()
              setSel((s) => Math.min(s + 1, filtered.length - 1))
            } else if (e.key === 'ArrowUp') {
              e.preventDefault()
              setSel((s) => Math.max(s - 1, 0))
            } else if (e.key === 'Enter') runSel()
          }}
          placeholder="What would you like to do?"
          spellCheck={false}
          className="hairline w-full border-b bg-transparent px-6 py-4 text-[15px] text-ink-900 outline-none placeholder:font-serif-display placeholder:italic placeholder:text-ink-300"
        />
        <div className="max-h-[46vh] overflow-y-auto py-2">
          {filtered.length === 0 ? (
            <p className="px-6 py-4 text-[12.5px] text-ink-400">No matching command.</p>
          ) : (
            filtered.map((c, i) => (
              <button
                key={c.label}
                onClick={() => runSel(c)}
                onMouseEnter={() => setSel(i)}
                className={`flex w-full items-center justify-between px-6 py-2.5 text-left transition-colors duration-100 ${
                  i === sel ? 'bg-moss-700/[0.07]' : ''
                }`}
              >
                <span className={`text-[13px] ${i === sel ? 'text-ink-900' : 'text-ink-700'}`}>
                  {c.label}
                </span>
                <span className="micro-label">{c.hint}</span>
              </button>
            ))
          )}
        </div>
        <div className="hairline flex items-center justify-between border-t px-6 py-2.5">
          <span className="text-[10px] text-ink-400">↑↓ navigate · ↵ run · esc close</span>
          <span className="font-serif-display text-[11px] italic text-ink-400">Nori</span>
        </div>
      </div>
    </div>
  )
}
