import { useEffect, useState } from 'react'
import ProviderSetup from './ProviderSetup'

/**
 * First-run welcome. Prompts for an API key (recommended free providers) and
 * points power users to running from source for OAuth/dev features. Shows once,
 * only when no key is configured. Hides the native web view while open (same
 * trick the command palette uses) so it layers above the page.
 */
export default function WelcomeModal() {
  const [show, setShow] = useState(false)

  useEffect(() => {
    Promise.all([window.nori.ai.getStatus(), window.nori.settings.get('welcomeSeen')]).then(
      ([status, seen]) => {
        if (!status.hasKey && seen !== '1') setShow(true)
      }
    )
  }, [])

  useEffect(() => {
    window.nori.reader.setHidden(show) // detach native view so the overlay is visible
  }, [show])

  const dismiss = () => {
    window.nori.settings.set('welcomeSeen', '1')
    setShow(false)
  }

  if (!show) return null

  return (
    <div className="absolute inset-0 z-[60] flex items-center justify-center bg-ink-900/25 p-6 backdrop-blur-[2px]">
      <div className="fade-up max-h-[88vh] w-[452px] overflow-y-auto rounded-2xl bg-porcelain-50 p-6 shadow-[0_20px_70px_rgba(33,33,29,0.3),0_0_0_1px_rgba(33,33,29,0.08)]">
        <div className="micro-label mb-1 !text-moss-700">Welcome to</div>
        <h2 className="font-serif-display text-[30px] leading-none italic text-ink-900">
          Nori<span className="text-moss-600">.</span>
        </h2>
        <p className="mt-3 text-[12.5px] leading-relaxed text-ink-500">
          The AI browser that reads the web with you — and acts on it. To begin, connect an AI
          provider. A <span className="text-ink-700">free</span> key is all you need.
        </p>

        <div className="mt-4">
          <ProviderSetup
            onSaved={(hk) => {
              if (hk) dismiss()
            }}
          />
        </div>

        <div className="mt-4 rounded-xl border border-ink-900/[0.08] p-4">
          <div className="micro-label mb-1.5">For the full experience</div>
          <p className="text-[11.5px] leading-relaxed text-ink-500">
            Google / OAuth sign-in and the newest developer features run best from source. Clone
            and run Nori locally:
          </p>
          <div className="mt-2.5 overflow-x-auto rounded-lg bg-ink-900 px-3 py-2.5">
            <code className="font-mono text-[10.5px] whitespace-nowrap text-porcelain-100">
              git clone https://github.com/Afzalkhan001/nori-ai-browser
            </code>
          </div>
          <div className="mt-1.5 overflow-x-auto rounded-lg bg-ink-900 px-3 py-2.5">
            <code className="font-mono text-[10.5px] whitespace-nowrap text-porcelain-100">
              cd nori-ai-browser &amp;&amp; npm install &amp;&amp; npm run dev
            </code>
          </div>
          <a
            href="https://github.com/Afzalkhan001/nori-ai-browser"
            target="_blank"
            rel="noreferrer"
            className="mt-2.5 inline-block text-[11px] text-moss-700 transition-colors hover:text-moss-600"
          >
            View on GitHub →
          </a>
        </div>

        <button
          onClick={dismiss}
          className="mt-4 text-[11px] text-ink-400 transition-colors hover:text-ink-900"
        >
          Skip for now →
        </button>
      </div>
    </div>
  )
}
