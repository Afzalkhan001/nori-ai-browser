import { useEffect, useState } from 'react'
import { useBrowser } from '../store/browser'
import { useCompose } from '../store/compose'
import { Markdown } from '../lib/markdown'

const FORMATS = [
  'X thread',
  'LinkedIn post',
  'Instagram caption',
  'YouTube script',
  'Blog outline',
  'Newsletter',
  'SEO brief'
]

/** Content Studio — the current page becomes platform-ready content, in your brand voice. */
export default function ComposePanel() {
  const { activeTabId } = useBrowser()
  const tabId = activeTabId ?? ''
  const state = useCompose((s) => s.byTab[tabId])
  const { generate, reset } = useCompose()
  const [instructions, setInstructions] = useState('')
  const [voice, setVoice] = useState('')
  const [voiceOpen, setVoiceOpen] = useState(false)
  const [voiceSaved, setVoiceSaved] = useState(false)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    window.nori.settings.get('brandVoice').then((v) => setVoice(v ?? ''))
  }, [])

  const saveVoice = async () => {
    await window.nori.settings.set('brandVoice', voice)
    setVoiceSaved(true)
    setTimeout(() => setVoiceSaved(false), 1600)
  }

  const copy = async () => {
    if (!state?.text) return
    await navigator.clipboard.writeText(state.text)
    setCopied(true)
    setTimeout(() => setCopied(false), 1600)
  }

  // ----- picker -----
  if (!state) {
    return (
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
        <div className="flex flex-1 flex-col justify-end px-7 pb-6">
          <h2 className="font-serif-display fade-up text-[30px] italic leading-tight text-ink-900">
            Write it once
            <span className="text-moss-600">.</span>
          </h2>
          <p className="fade-up-1 mt-3 max-w-[270px] text-[12.5px] leading-relaxed text-ink-500">
            Turn this page into content for every platform — in your brand voice.
          </p>

          <div className="fade-up-2 mt-7">
            {FORMATS.map((f) => (
              <button
                key={f}
                onClick={() => generate(tabId, f, instructions)}
                className="sug-row hairline flex w-full items-center justify-between border-t py-3 text-left text-[12.5px] text-ink-700 last:border-b hover:text-ink-900"
              >
                <span>{f}</span>
                <span className="sug-arrow text-moss-600">→</span>
              </button>
            ))}
          </div>

          <input
            value={instructions}
            onChange={(e) => setInstructions(e.target.value)}
            placeholder="Optional: angle, audience, campaign…"
            spellCheck={false}
            className="fade-up-3 mt-5 h-9 rounded-xl bg-ink-900/[0.04] px-3.5 text-[12px] text-ink-900 outline-none placeholder:text-ink-300 focus:bg-ink-900/[0.06]"
          />

          {/* Brand voice */}
          <button
            onClick={() => setVoiceOpen(!voiceOpen)}
            className="fade-up-3 mt-4 flex items-center gap-2 text-left"
          >
            <span className="micro-label">Brand voice</span>
            <span className={`text-[10px] text-ink-400 transition-transform duration-300 ${voiceOpen ? 'rotate-90' : ''}`}>
              →
            </span>
            {voice && !voiceOpen && <span className="h-1 w-1 rounded-full bg-moss-600" />}
          </button>
          {voiceOpen && (
            <div className="fade-up mt-2.5">
              <textarea
                value={voice}
                onChange={(e) => setVoice(e.target.value)}
                rows={4}
                spellCheck={false}
                placeholder="Describe your brand's tone, or paste 2-3 example posts you love…"
                className="w-full resize-none rounded-xl bg-ink-900/[0.04] p-3.5 text-[12px] leading-relaxed text-ink-900 outline-none placeholder:text-ink-300 focus:bg-ink-900/[0.06]"
              />
              <button
                onClick={saveVoice}
                className={`mt-2 rounded-lg px-3 py-1.5 text-[11px] tracking-[0.04em] transition-all duration-300 ${
                  voiceSaved ? 'bg-moss-700 text-porcelain-50' : 'card text-ink-700 hover:text-ink-900'
                }`}
              >
                {voiceSaved ? 'Saved' : 'Save voice'}
              </button>
            </div>
          )}
        </div>
      </div>
    )
  }

  // ----- output -----
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center justify-between px-7 pt-5 pb-3">
        <span className="micro-label">{state.format}</span>
        <div className="flex items-center gap-3">
          <button
            onClick={() => generate(tabId, state.format, instructions)}
            disabled={state.running}
            className="text-[11px] text-ink-400 transition-colors hover:text-ink-900 disabled:opacity-40"
          >
            Regenerate
          </button>
          <button
            onClick={() => reset(tabId)}
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

      <div className="min-h-0 flex-1 overflow-y-auto px-7 pb-6">
        {state.error ? (
          <p className="text-[12.5px] text-[#b4483f]">⚠ {state.error}</p>
        ) : state.text ? (
          <div className="fade-up text-ink-900">
            <Markdown text={state.text} />
            {state.running && <span className="animate-pulse text-moss-600">▌</span>}
          </div>
        ) : (
          <span className="flex gap-1.5 pt-1">
            <span className="dot h-1 w-1 rounded-full bg-moss-600" />
            <span className="dot h-1 w-1 rounded-full bg-moss-600" />
            <span className="dot h-1 w-1 rounded-full bg-moss-600" />
          </span>
        )}
      </div>
    </div>
  )
}
