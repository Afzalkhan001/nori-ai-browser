import { useEffect, useRef, useState } from 'react'
import { useBrowser } from '../store/browser'
import { useReader } from '../store/reader'
import {
  IconBack,
  IconBook,
  IconClose,
  IconForward,
  IconLock,
  IconReload,
  IconShield,
  IconSparkle
} from './Icons'

/** Domain shown when idle; full URL only while editing. nori:// pages show nothing. */
function displayLabel(url: string): string {
  if (!url || url.startsWith('nori://')) return ''
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return url
  }
}

/** Safari-style toolbar — nav left, centered omnibox, actions right. */
export default function AddressBar() {
  const { activeTabId, sidebarOpen, toggleSidebar } = useBrowser()
  const tab = useBrowser((s) => s.tabs.find((t) => t.id === s.activeTabId) ?? null)
  const [input, setInput] = useState('')
  const [focused, setFocused] = useState(false)
  const [blockerOn, setBlockerOn] = useState(true)
  const inputRef = useRef<HTMLInputElement>(null)
  const reader = useReader()

  useEffect(() => {
    window.nori.blocker.get().then(setBlockerOn)
    const focus = () => inputRef.current?.focus()
    window.addEventListener('nori:focus-omnibox', focus)
    return () => window.removeEventListener('nori:focus-omnibox', focus)
  }, [])

  // Leaving the page closes reader mode.
  useEffect(() => {
    if (reader.open) reader.close()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab?.url, activeTabId])

  useEffect(() => {
    if (!focused) setInput(displayLabel(tab?.url ?? ''))
  }, [tab?.url, focused])

  const submit = () => {
    if (!activeTabId || !input.trim()) return
    window.nori.tabs.navigate(activeTabId, input)
    inputRef.current?.blur()
  }

  const isSecure = tab?.url.startsWith('https://')
  const isHome = !tab?.url || tab.url.startsWith('nori://')

  const navBtn =
    'flex h-8 w-8 items-center justify-center rounded-lg transition-colors duration-200 disabled:opacity-25 text-ink-700 hover:bg-ink-900/[0.05] disabled:hover:bg-transparent'

  return (
    <div className="relative flex h-[50px] items-center bg-porcelain-100 px-3">
      {/* Left — navigation */}
      <div className="flex w-52 shrink-0 items-center gap-0.5">
        <button
          className={navBtn}
          disabled={!tab?.canGoBack}
          onClick={() => activeTabId && window.nori.tabs.goBack(activeTabId)}
          title="Back"
        >
          <IconBack />
        </button>
        <button
          className={navBtn}
          disabled={!tab?.canGoForward}
          onClick={() => activeTabId && window.nori.tabs.goForward(activeTabId)}
          title="Forward"
        >
          <IconForward />
        </button>
        <button
          className={navBtn}
          onClick={() =>
            activeTabId &&
            (tab?.isLoading
              ? window.nori.tabs.stop(activeTabId)
              : window.nori.tabs.reload(activeTabId))
          }
          title={tab?.isLoading ? 'Stop' : 'Reload'}
        >
          {tab?.isLoading ? <IconClose className="h-3.5 w-3.5" /> : <IconReload />}
        </button>
      </div>

      {/* Center — omnibox */}
      <div className="flex min-w-0 flex-1 justify-center">
        <div
          className={`flex h-[34px] items-center gap-2 rounded-xl px-3.5 transition-all duration-400 [transition-timing-function:cubic-bezier(0.22,1,0.36,1)] ${
            focused
              ? 'card w-full max-w-[640px] shadow-[0_2px_14px_rgba(33,33,29,0.08),0_0_0_1px_rgba(64,96,75,0.4)]'
              : 'w-full max-w-[420px] bg-ink-900/[0.035] hover:bg-ink-900/[0.06]'
          }`}
        >
          {!focused && !isHome && (
            <span className={isSecure ? 'shrink-0 text-moss-600' : 'shrink-0 text-ink-400'}>
              <IconLock />
            </span>
          )}
          <input
            ref={inputRef}
            value={input}
            spellCheck={false}
            onChange={(e) => setInput(e.target.value)}
            onFocus={(e) => {
              setFocused(true)
              setInput(tab?.url && !tab.url.startsWith('nori://') ? tab.url : '')
              requestAnimationFrame(() => e.target.select())
            }}
            onBlur={() => setFocused(false)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') submit()
              if (e.key === 'Escape') inputRef.current?.blur()
            }}
            placeholder="Search or enter address"
            className={`min-w-0 flex-1 bg-transparent text-[12.5px] text-ink-900 outline-none placeholder:text-ink-300 ${
              focused ? 'text-left' : 'text-center'
            }`}
          />
        </div>
      </div>

      {/* Right — actions */}
      <div className="flex w-52 shrink-0 items-center justify-end gap-1">
        {/* Ad blocker */}
        <button
          onClick={async () => setBlockerOn(await window.nori.blocker.toggle())}
          title={blockerOn ? `Ad blocker on — ${tab?.blockedCount ?? 0} blocked here` : 'Ad blocker off'}
          className={`flex h-8 items-center gap-1 rounded-lg px-2 transition-colors duration-200 ${
            blockerOn ? 'text-moss-700 hover:bg-moss-700/[0.08]' : 'text-ink-300 hover:bg-ink-900/[0.05]'
          }`}
        >
          <IconShield className="h-3.5 w-3.5" />
          {blockerOn && (tab?.blockedCount ?? 0) > 0 && (
            <span className="text-[10px] tabular-nums">{tab?.blockedCount}</span>
          )}
        </button>
        {/* Reader mode */}
        <button
          onClick={() => reader.toggle()}
          title="Reader mode"
          className={`flex h-8 w-8 items-center justify-center rounded-lg transition-colors duration-200 ${
            reader.open
              ? 'bg-moss-700/10 text-moss-700'
              : 'text-ink-500 hover:bg-ink-900/[0.05] hover:text-ink-900'
          } ${isHome ? 'pointer-events-none opacity-30' : ''}`}
        >
          <IconBook className="h-3.5 w-3.5" />
        </button>
        <button
          onClick={toggleSidebar}
          title="Nori Assist (Ctrl+E)"
          className={`flex h-[34px] items-center gap-2 rounded-xl px-4 text-[12px] tracking-[0.02em] transition-all duration-300 active:scale-[0.96] ${
            sidebarOpen
              ? 'bg-moss-700 text-porcelain-50 shadow-[0_2px_10px_rgba(52,80,62,0.35)]'
              : 'text-moss-700 hover:bg-moss-700/[0.08]'
          }`}
        >
          <IconSparkle className="h-3.5 w-3.5" />
          <span>Assist</span>
        </button>
      </div>

      {tab?.isLoading && (
        <div className="loading-line absolute inset-x-0 -bottom-px h-px overflow-hidden" />
      )}
    </div>
  )
}
