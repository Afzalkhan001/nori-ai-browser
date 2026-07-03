import { useEffect, useState } from 'react'
import { useBrowser } from '../store/browser'
import { IconClose, IconGlobe, IconMaximize, IconMinimize, IconPlus, IconRestore } from './Icons'

/** Frameless titlebar — wordmark, quiet card tabs, hairline window controls. */
export default function TitleBar() {
  const { tabs, activeTabId } = useBrowser()
  const [maximized, setMaximized] = useState(false)

  useEffect(() => {
    window.nori.win.isMaximized().then(setMaximized)
    return window.nori.win.onMaximizedChanged(setMaximized)
  }, [])

  return (
    <div className="drag flex h-11 items-stretch bg-porcelain-100 pl-4">
      {/* Wordmark */}
      <div className="flex items-center pr-5">
        <span className="font-serif-display text-[16px] italic text-ink-900">Nori</span>
      </div>

      {/* Tabs */}
      <div className="no-drag flex min-w-0 flex-1 items-center gap-1.5 overflow-x-auto">
        {tabs.map((tab) => {
          const active = tab.id === activeTabId
          return (
            <div
              key={tab.id}
              onClick={() => window.nori.tabs.activate(tab.id)}
              onAuxClick={(e) => {
                if (e.button === 1) window.nori.tabs.close(tab.id)
              }}
              className={`group flex h-8 w-52 min-w-0 shrink-0 cursor-default items-center gap-2.5 rounded-lg px-3 transition-all duration-300 ${
                active ? 'card text-ink-900' : 'text-ink-500 hover:bg-ink-900/[0.04]'
              }`}
            >
              {tab.isLoading ? (
                <span className="h-3 w-3 shrink-0 animate-spin rounded-full border border-moss-600 border-t-transparent" />
              ) : tab.url.startsWith('nori://') ? (
                <span className="font-serif-display w-3.5 shrink-0 text-center text-[12px] italic leading-none text-moss-600">
                  N
                </span>
              ) : tab.faviconUrl ? (
                <img
                  src={tab.faviconUrl}
                  className="h-3.5 w-3.5 shrink-0 rounded-[3px] opacity-90"
                  alt=""
                />
              ) : (
                <IconGlobe className="h-3.5 w-3.5 shrink-0 text-ink-300" />
              )}
              <span className="min-w-0 flex-1 truncate text-[12px] tracking-[0.01em]">
                {tab.title}
              </span>
              <button
                onClick={(e) => {
                  e.stopPropagation()
                  window.nori.tabs.close(tab.id)
                }}
                className="flex h-4 w-4 shrink-0 items-center justify-center rounded text-ink-400 opacity-0 transition-all duration-200 hover:text-ink-900 group-hover:opacity-100"
              >
                <IconClose />
              </button>
            </div>
          )
        })}
        <button
          onClick={() => window.nori.tabs.create()}
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-ink-400 transition-colors duration-200 hover:bg-ink-900/[0.05] hover:text-ink-900"
          title="New tab (Ctrl+T)"
        >
          <IconPlus />
        </button>
      </div>

      {/* Window controls */}
      <div className="no-drag flex items-stretch">
        <button
          onClick={() => window.nori.win.minimize()}
          className="flex w-11 items-center justify-center text-ink-500 transition-colors hover:bg-ink-900/[0.05] hover:text-ink-900"
        >
          <IconMinimize />
        </button>
        <button
          onClick={() => window.nori.win.maximizeToggle()}
          className="flex w-11 items-center justify-center text-ink-500 transition-colors hover:bg-ink-900/[0.05] hover:text-ink-900"
        >
          {maximized ? <IconRestore /> : <IconMaximize />}
        </button>
        <button
          onClick={() => window.nori.win.close()}
          className="flex w-11 items-center justify-center text-ink-500 transition-colors hover:bg-[#b4483f] hover:text-white"
        >
          <IconClose />
        </button>
      </div>
    </div>
  )
}
