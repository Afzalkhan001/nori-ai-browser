import { useEffect, useRef, useState } from 'react'
import { useBrowser } from '../store/browser'
import { useChat } from '../store/chat'
import { Markdown } from '../lib/markdown'
import type { WatchItem } from '@shared/types'
import MissionsBlock from './MissionsBlock'

const SUGGESTIONS = [
  'Summarize this page and do the obvious next step',
  'Find the best-rated option here and open it for me',
  'Research this topic and save it as a PDF',
  'Where did I read about this before? Check my memory'
]

/** Editorial transcript chat — no bubbles, generous whitespace. */
export default function ChatPanel() {
  const { activeTabId, sidebarOpen } = useBrowser()
  const chatId = activeTabId ?? 'default'
  const { threads, streaming, steps, approval, loadThread, send, clear } = useChat()
  const messages = threads[chatId] ?? []
  const isStreaming = streaming[chatId] ?? false
  const liveSteps = steps[chatId] ?? []
  const pendingApproval = approval[chatId] ?? null

  const respond = (approved: boolean, all = false) => {
    if (!pendingApproval) return
    window.nori.ai.respondApproval(pendingApproval.requestId, approved, all)
    useChat.setState((s) => ({ approval: { ...s.approval, [chatId]: null } }))
  }
  const [input, setInput] = useState('')
  const [hasKey, setHasKey] = useState(true)
  const [keyInput, setKeyInput] = useState('')
  const [savingKey, setSavingKey] = useState(false)
  const [watches, setWatches] = useState<WatchItem[]>([])
  const [autopilot, setAutopilot] = useState(false)
  const scrollRef = useRef<HTMLDivElement>(null)

  const saveKey = async () => {
    const k = keyInput.trim()
    if (!k || savingKey) return
    setSavingKey(true)
    const status = await window.nori.ai.setKey(k)
    setHasKey(status.hasKey)
    setKeyInput('')
    setSavingKey(false)
  }

  useEffect(() => {
    window.nori.ai.getStatus().then((s) => setHasKey(s.hasKey))
    window.nori.watches.list().then(setWatches)
    window.nori.settings.get('autoApproveSubmits').then((v) => setAutopilot(v === '1'))
    return window.nori.watches.onUpdated(() => {
      window.nori.watches.list().then(setWatches)
    })
  }, [messages.length])

  const toggleAutopilot = () => {
    const next = !autopilot
    setAutopilot(next)
    window.nori.settings.set('autoApproveSubmits', next ? '1' : '0')
  }

  useEffect(() => {
    if (sidebarOpen) loadThread(chatId)
  }, [chatId, sidebarOpen, loadThread])

  useEffect(() => {
    const el = scrollRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [messages, isStreaming])

  const submit = (text?: string) => {
    const t = (text ?? input).trim()
    if (!t || isStreaming) return
    setInput('')
    send(chatId, t)
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {messages.length === 0 ? (
        <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-7 pb-8">
          <h2 className="font-serif-display fade-up mt-auto pt-6 text-[30px] italic leading-tight text-ink-900">
            Ask anything
            <span className="text-moss-600">.</span>
          </h2>
          <p className="fade-up-1 mt-3 max-w-[280px] text-[12.5px] leading-relaxed text-ink-500">
            Nori reads the web with you — and acts on it. Ask for anything: research, click
            through any site, fill forms, remember what you read, or just say the goal and
            watch it work.
          </p>
          <div className="fade-up-2 mt-8">
            {SUGGESTIONS.map((s) => (
              <button
                key={s}
                onClick={() => submit(s)}
                className="sug-row hairline flex w-full items-center justify-between border-t py-3.5 text-left text-[12.5px] text-ink-700 last:border-b hover:text-ink-900"
              >
                <span>{s}</span>
                <span className="sug-arrow text-moss-600">→</span>
              </button>
            ))}
          </div>
          {watches.length > 0 && (
            <div className="fade-up-3 mt-7">
              <div className="micro-label mb-2.5">Watching</div>
              <div className="flex flex-wrap gap-2">
                {watches.map((w) => (
                  <span
                    key={w.id}
                    className="card group flex items-center gap-1.5 rounded-full py-1.5 pr-2 pl-3 text-[11.5px] text-ink-700"
                  >
                    <button
                      onClick={() => {
                        window.nori.watches.markSeen(w.id)
                        setWatches((ws) => ws.map((x) => (x.id === w.id ? { ...x, unread: 0 } : x)))
                        submit(
                          `Catch me up on "${w.topic}" — find the latest articles and coverage from multiple outlets, with links.`
                        )
                      }}
                      className="flex cursor-pointer items-center gap-1.5 transition-colors hover:text-moss-700"
                    >
                      {w.topic}
                      {w.unread > 0 && (
                        <span className="flex h-4 min-w-4 items-center justify-center rounded-full bg-moss-700 px-1 text-[9px] font-semibold text-porcelain-50">
                          {w.unread}
                        </span>
                      )}
                    </button>
                    <button
                      onClick={async () => {
                        await window.nori.watches.remove(w.id)
                        setWatches((ws) => ws.filter((x) => x.id !== w.id))
                      }}
                      className="text-ink-300 transition-colors hover:text-ink-900"
                      title="Stop watching"
                    >
                      ×
                    </button>
                  </span>
                ))}
              </div>
            </div>
          )}
          <MissionsBlock />
          {!hasKey && (
            <div className="fade-up-3 card mt-6 rounded-xl p-4">
              <div className="micro-label mb-1.5 !text-moss-700">Connect OpenAI</div>
              <p className="mb-3 text-[11.5px] leading-relaxed text-ink-500">
                Paste your OpenAI API key to activate Nori. It’s stored locally on this device
                and never leaves it except to call OpenAI.
              </p>
              <div className="flex items-center gap-2">
                <input
                  type="password"
                  value={keyInput}
                  onChange={(e) => setKeyInput(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && saveKey()}
                  placeholder="sk-…"
                  spellCheck={false}
                  className="hairline min-w-0 flex-1 rounded-lg border bg-transparent px-3 py-2 text-[12px] text-ink-900 outline-none placeholder:text-ink-300 focus:border-moss-600/50"
                />
                <button
                  onClick={saveKey}
                  disabled={!keyInput.trim() || savingKey}
                  className={`shrink-0 rounded-lg px-3.5 py-2 text-[12px] transition-all duration-200 ${
                    keyInput.trim() && !savingKey
                      ? 'bg-moss-700 text-porcelain-50 hover:bg-moss-600 active:scale-[0.96]'
                      : 'bg-ink-900/[0.05] text-ink-300'
                  }`}
                >
                  {savingKey ? 'Saving…' : 'Save'}
                </button>
              </div>
              <a
                href="https://platform.openai.com/api-keys"
                target="_blank"
                rel="noreferrer"
                className="mt-2.5 inline-block text-[10.5px] text-ink-400 transition-colors hover:text-moss-700"
              >
                Get a key from platform.openai.com →
              </a>
            </div>
          )}
        </div>
      ) : (
        <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto px-7 py-6">
          <div className="mb-4 flex justify-end">
            <button
              onClick={() => clear(chatId)}
              className="text-[11px] text-ink-400 transition-colors hover:text-ink-900"
            >
              Clear conversation
            </button>
          </div>
          {messages.map((m) => (
            <div key={m.id} className="fade-up mb-7 last:mb-2">
              <div className="micro-label mb-2">
                {m.role === 'user' ? 'You' : <span className="text-moss-600">Nori</span>}
              </div>
              {m.content ? (
                m.role === 'user' ? (
                  <div className="select-text text-[13px] leading-[1.7] whitespace-pre-wrap text-ink-500">
                    {m.content}
                  </div>
                ) : (
                  <div className="text-ink-900">
                    <Markdown text={m.content} />
                    {m.costUsd != null && m.costUsd > 0 && (
                      <div className="mt-1.5 text-[9.5px] tracking-[0.08em] text-ink-300">
                        {m.costUsd < 0.01 ? '<1¢' : `${Math.round(m.costUsd * 100)}¢`}
                      </div>
                    )}
                  </div>
                )
              ) : (
                isStreaming && (
                  <div>
                    {liveSteps.map((label, j) => (
                      <div
                        key={j}
                        className={`fade-up flex items-center gap-2 py-1 text-[12px] ${
                          j === liveSteps.length - 1 ? 'text-ink-700' : 'text-ink-400'
                        }`}
                      >
                        <span
                          className={`h-1 w-1 rounded-full ${
                            j === liveSteps.length - 1 ? 'animate-pulse bg-moss-600' : 'bg-ink-300'
                          }`}
                        />
                        <span className="font-serif-display italic">{label}</span>
                      </div>
                    ))}
                    <span className="flex gap-1.5 pt-1.5">
                      <span className="dot h-1 w-1 rounded-full bg-moss-600" />
                      <span className="dot h-1 w-1 rounded-full bg-moss-600" />
                      <span className="dot h-1 w-1 rounded-full bg-moss-600" />
                    </span>
                  </div>
                )
              )}
            </div>
          ))}
        </div>
      )}

      {/* Approval gate — a committing action needs the user's explicit yes */}
      {pendingApproval && (
        <div className="fade-up mx-5 mb-3 rounded-xl border border-moss-600/30 bg-moss-700/[0.06] p-4">
          <div className="micro-label mb-2 !text-moss-700">Approval needed</div>
          <p className="text-[12.5px] leading-relaxed text-ink-900">{pendingApproval.summary}</p>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <button
              onClick={() => respond(true)}
              className="rounded-lg bg-moss-700 px-4 py-1.5 text-[12px] text-porcelain-50 shadow-[0_2px_10px_rgba(52,80,62,0.35)] transition-all duration-200 hover:bg-moss-600 active:scale-[0.96]"
            >
              Approve & submit
            </button>
            <button
              onClick={() => respond(true, true)}
              title="Auto-approve every remaining post in this batch"
              className="rounded-lg border border-moss-600/40 px-3 py-1.5 text-[12px] text-moss-700 transition-colors hover:bg-moss-700/[0.08]"
            >
              Approve all
            </button>
            <button
              onClick={() => {
                if (!autopilot) toggleAutopilot()
                respond(true, true)
              }}
              title="Turn on Autopilot — approve this and every future submission without asking (until you turn it off)"
              className="rounded-lg border border-moss-600/40 px-3 py-1.5 text-[12px] text-moss-700 transition-colors hover:bg-moss-700/[0.08]"
            >
              Always approve
            </button>
            <button
              onClick={() => respond(false)}
              className="rounded-lg px-3 py-1.5 text-[12px] text-ink-500 transition-colors hover:text-ink-900"
            >
              Deny
            </button>
          </div>
        </div>
      )}

      {/* Composer */}
      <div className="hairline shrink-0 border-t px-5 py-4">
        <div className="mb-2 flex items-center justify-end">
          <button
            onClick={toggleAutopilot}
            title={
              autopilot
                ? 'Autopilot is ON — Nori posts comments and submits forms without pausing for approval. Click to turn off.'
                : 'Autopilot is OFF — every submission waits for your approval. Turn on for unattended batch runs.'
            }
            className={`flex items-center gap-1.5 text-[10px] uppercase tracking-[0.14em] transition-colors duration-300 ${
              autopilot ? 'text-moss-700' : 'text-ink-300 hover:text-ink-500'
            }`}
          >
            <span
              className={`h-1.5 w-1.5 rounded-full transition-colors duration-300 ${
                autopilot ? 'animate-pulse bg-moss-600' : 'bg-ink-300'
              }`}
            />
            Autopilot {autopilot ? 'on' : 'off'}
          </button>
        </div>
        <div className="flex items-end gap-3">
          <textarea
            value={input}
            rows={1}
            spellCheck={false}
            onChange={(e) => {
              setInput(e.target.value)
              e.target.style.height = 'auto'
              e.target.style.height = `${Math.min(e.target.scrollHeight, 120)}px`
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                submit()
              }
            }}
            placeholder="Ask Nori…"
            className="max-h-[120px] min-w-0 flex-1 resize-none bg-transparent py-1 text-[13px] leading-relaxed text-ink-900 outline-none placeholder:font-serif-display placeholder:italic placeholder:text-ink-300"
          />
          <button
            onClick={() => submit()}
            disabled={!input.trim() || isStreaming}
            className={`mb-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full transition-all duration-300 active:scale-[0.92] ${
              input.trim() && !isStreaming
                ? 'bg-moss-700 text-porcelain-50 shadow-[0_2px_10px_rgba(52,80,62,0.35)]'
                : 'bg-ink-900/[0.05] text-ink-300'
            }`}
            title="Send"
          >
            <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
              <path d="M8 12.5v-9M4.5 7 8 3.5 11.5 7" />
            </svg>
          </button>
        </div>
      </div>
    </div>
  )
}
