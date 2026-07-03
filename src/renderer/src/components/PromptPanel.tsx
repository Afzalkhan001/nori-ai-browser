import { useState } from 'react'
import { useBrowser } from '../store/browser'
import { usePrompt } from '../store/prompt'

const TARGETS = ['React + Tailwind', 'Next.js project', 'Flutter', 'SwiftUI', 'Plain HTML/CSS']

/** Prompts — turn the current page into a copy-paste build prompt for AI coding tools. */
export default function PromptPanel() {
  const { activeTabId } = useBrowser()
  const tabId = activeTabId ?? ''
  const state = usePrompt((s) => s.byTab[tabId])
  const generate = usePrompt((s) => s.generate)
  const [copied, setCopied] = useState(false)

  const copy = async () => {
    if (!state?.text) return
    await navigator.clipboard.writeText(state.text)
    setCopied(true)
    setTimeout(() => setCopied(false), 1600)
  }

  if (!state) {
    return (
      <div className="flex flex-1 flex-col justify-end px-7 pb-8">
        <h2 className="font-serif-display fade-up text-[30px] italic leading-tight text-ink-900">
          Page to prompt
          <span className="text-moss-600">.</span>
        </h2>
        <p className="fade-up-1 mt-3 max-w-[270px] text-[12.5px] leading-relaxed text-ink-500">
          Turn this page into a build-ready prompt for Cursor, Claude or GPT — pick your target.
        </p>
        <div className="fade-up-2 mt-8">
          {TARGETS.map((t) => (
            <button
              key={t}
              onClick={() => generate(tabId, t)}
              className="sug-row hairline flex w-full items-center justify-between border-t py-3.5 text-left text-[12.5px] text-ink-700 last:border-b hover:text-ink-900"
            >
              <span>{t}</span>
              <span className="sug-arrow text-moss-600">→</span>
            </button>
          ))}
        </div>
      </div>
    )
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center justify-between px-7 pt-5 pb-3">
        <span className="micro-label">{state.target}</span>
        <div className="flex items-center gap-3">
          <button
            onClick={() => usePrompt.setState((s) => ({ byTab: { ...s.byTab, [tabId]: undefined as never } }))}
            className="text-[11px] text-ink-400 transition-colors hover:text-ink-900"
          >
            New
          </button>
          <button
            onClick={copy}
            disabled={!state.text || state.running}
            className={`rounded-lg px-3 py-1.5 text-[11px] tracking-[0.04em] transition-all duration-300 disabled:opacity-40 ${
              copied ? 'bg-moss-700 text-porcelain-50' : 'card text-ink-700 hover:text-ink-900'
            }`}
          >
            {copied ? 'Copied' : 'Copy'}
          </button>
        </div>
      </div>

      <div className="mx-5 mb-5 min-h-0 flex-1 overflow-y-auto rounded-xl bg-[#1e2420] p-5 shadow-[inset_0_1px_3px_rgba(0,0,0,0.3)]">
        {state.error ? (
          <p className="text-[12px] text-[#e8a29b]">⚠ {state.error}</p>
        ) : (
          <pre className="font-mono select-text text-[11.5px] leading-[1.65] whitespace-pre-wrap text-[#cfe0d4]">
            {state.text}
            {state.running && <span className="animate-pulse text-moss-300">▌</span>}
          </pre>
        )}
      </div>
    </div>
  )
}
