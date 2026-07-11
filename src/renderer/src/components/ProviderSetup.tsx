import { useEffect, useState } from 'react'

interface Preset {
  label: string
  baseUrl: string
  fast: string
  smart: string
  embed: string
  keyUrl: string
  note: string
  needsKey: boolean
}

// OpenRouter first — the free, no-hardware path. Models chosen for tool-calling.
const PRESETS: Record<string, Preset> = {
  openrouter: {
    label: 'OpenRouter — free',
    baseUrl: 'https://openrouter.ai/api/v1',
    fast: 'openrouter/free',
    smart: 'openrouter/free',
    embed: '',
    keyUrl: 'https://openrouter.ai/keys',
    note: 'Free tool-capable models (auto-routed to dodge rate limits). $0, no hardware.',
    needsKey: true
  },
  groq: {
    label: 'Groq — free, fast',
    baseUrl: 'https://api.groq.com/openai/v1',
    fast: 'llama-3.1-8b-instant',
    smart: 'llama-3.3-70b-versatile',
    embed: '',
    keyUrl: 'https://console.groq.com/keys',
    note: 'Very fast free tier. No embeddings (Recall stays off).',
    needsKey: true
  },
  gemini: {
    label: 'Google Gemini — free',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai/',
    fast: 'gemini-2.0-flash',
    smart: 'gemini-2.0-flash',
    embed: 'text-embedding-004',
    keyUrl: 'https://aistudio.google.com/apikey',
    note: 'Free chat AND embeddings — Recall keeps working.',
    needsKey: true
  },
  openai: {
    label: 'OpenAI — paid, best quality',
    baseUrl: '',
    fast: 'gpt-4o-mini',
    smart: 'gpt-4o',
    embed: 'text-embedding-3-small',
    keyUrl: 'https://platform.openai.com/api-keys',
    note: 'Most reliable agents. Requires paid credits.',
    needsKey: true
  },
  ollama: {
    label: 'Ollama — local, no key',
    baseUrl: 'http://localhost:11434/v1',
    fast: 'llama3.1',
    smart: 'llama3.1',
    embed: 'nomic-embed-text',
    keyUrl: '',
    note: 'Runs on your machine, fully private. Needs Ollama installed + a capable PC.',
    needsKey: false
  }
}

export default function ProviderSetup({ onSaved }: { onSaved: (hasKey: boolean) => void }) {
  const [provider, setProvider] = useState<string>('openrouter')
  const [fast, setFast] = useState('')
  const [smart, setSmart] = useState('')
  const [embed, setEmbed] = useState('')
  const [baseUrl, setBaseUrl] = useState('')
  const [key, setKey] = useState('')
  const [advanced, setAdvanced] = useState(false)
  const [saving, setSaving] = useState(false)

  const applyPreset = (p: string) => {
    setProvider(p)
    const preset = PRESETS[p]
    setBaseUrl(preset.baseUrl)
    setFast(preset.fast)
    setSmart(preset.smart)
    setEmbed(preset.embed)
  }

  useEffect(() => {
    window.nori.ai.getConfig().then((c) => {
      const p = PRESETS[c.provider] ? c.provider : 'openrouter'
      setProvider(p)
      // Reflect saved values if present, else the preset's defaults.
      const preset = PRESETS[p]
      setBaseUrl(c.baseUrl || preset.baseUrl)
      setFast(c.fastModel || preset.fast)
      setSmart(c.smartModel || preset.smart)
      setEmbed(c.embedModel || preset.embed)
    })
  }, [])

  const preset = PRESETS[provider]

  const save = async () => {
    if (saving) return
    if (preset.needsKey && !key.trim()) return
    setSaving(true)
    const status = await window.nori.ai.setProvider({
      provider,
      apiKey: key.trim() || undefined,
      baseUrl,
      fastModel: fast,
      smartModel: smart,
      embedModel: embed
    })
    setSaving(false)
    setKey('')
    onSaved(status.hasKey)
  }

  return (
    <div className="fade-up card rounded-xl p-4">
      <div className="micro-label mb-1.5 !text-moss-700">Connect an AI provider</div>
      <p className="mb-3 text-[11.5px] leading-relaxed text-ink-500">
        Nori works with any provider — pick a free one to run at no cost. Your key is stored
        locally on this device and never leaves it except to call the provider.
      </p>

      <select
        value={provider}
        onChange={(e) => applyPreset(e.target.value)}
        className="mb-2 w-full rounded-lg bg-ink-900/[0.04] px-3 py-2 text-[12px] text-ink-900 outline-none focus:bg-ink-900/[0.06]"
      >
        {Object.entries(PRESETS).map(([k, p]) => (
          <option key={k} value={k}>
            {p.label}
          </option>
        ))}
      </select>
      <p className="mb-3 text-[10.5px] leading-snug text-ink-400">{preset.note}</p>

      {preset.needsKey && (
        <div className="flex items-center gap-2">
          <input
            type="password"
            value={key}
            onChange={(e) => setKey(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && save()}
            placeholder={provider === 'openrouter' ? 'sk-or-v1-…' : 'Paste your API key'}
            spellCheck={false}
            className="hairline min-w-0 flex-1 rounded-lg border bg-transparent px-3 py-2 text-[12px] text-ink-900 outline-none placeholder:text-ink-300 focus:border-moss-600/50"
          />
          <button
            onClick={save}
            disabled={saving || (preset.needsKey && !key.trim())}
            className={`shrink-0 rounded-lg px-3.5 py-2 text-[12px] transition-all duration-200 ${
              !saving && (!preset.needsKey || key.trim())
                ? 'bg-moss-700 text-porcelain-50 hover:bg-moss-600 active:scale-[0.96]'
                : 'bg-ink-900/[0.05] text-ink-300'
            }`}
          >
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      )}
      {!preset.needsKey && (
        <button
          onClick={save}
          disabled={saving}
          className="w-full rounded-lg bg-moss-700 px-3.5 py-2 text-[12px] text-porcelain-50 transition-all hover:bg-moss-600 active:scale-[0.98] disabled:opacity-50"
        >
          {saving ? 'Saving…' : 'Use Ollama (local)'}
        </button>
      )}

      <div className="mt-2.5 flex items-center justify-between">
        {preset.keyUrl ? (
          <a
            href={preset.keyUrl}
            target="_blank"
            rel="noreferrer"
            className="text-[10.5px] text-ink-400 transition-colors hover:text-moss-700"
          >
            Get a free key →
          </a>
        ) : (
          <span />
        )}
        <button
          onClick={() => setAdvanced(!advanced)}
          className="text-[10.5px] text-ink-400 transition-colors hover:text-ink-700"
        >
          {advanced ? 'Hide models' : 'Models'}
        </button>
      </div>

      {advanced && (
        <div className="fade-up mt-3 flex flex-col gap-2 border-t border-ink-900/[0.06] pt-3">
          {[
            ['Base URL', baseUrl, setBaseUrl],
            ['Fast model', fast, setFast],
            ['Smart model', smart, setSmart],
            ['Embed model (Recall)', embed, setEmbed]
          ].map(([label, val, setter]) => (
            <label key={label as string} className="flex flex-col gap-1">
              <span className="text-[9.5px] tracking-[0.08em] text-ink-400 uppercase">{label as string}</span>
              <input
                value={val as string}
                onChange={(e) => (setter as (v: string) => void)(e.target.value)}
                spellCheck={false}
                className="rounded-lg bg-ink-900/[0.04] px-3 py-1.5 text-[11.5px] text-ink-900 outline-none focus:bg-ink-900/[0.06]"
              />
            </label>
          ))}
        </div>
      )}
    </div>
  )
}
