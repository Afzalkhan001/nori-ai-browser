// Nori extension — background service worker.
// Holds the provider config, reads the active tab, and calls the AI provider.
// This is the extension analog of Nori's main process (src/main/ai-engine/openai.ts).

// Open the side panel when the toolbar icon is clicked.
chrome.runtime.onInstalled.addListener(() => {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {})
})

const DEFAULTS = {
  provider: 'openrouter',
  baseUrl: 'https://openrouter.ai/api/v1',
  model: 'openrouter/free',
  apiKey: ''
}

async function getConfig() {
  const stored = await chrome.storage.local.get('noriConfig')
  return { ...DEFAULTS, ...(stored.noriConfig || {}) }
}

// Grab the readable content of the active tab (runs in the page).
function extractPage() {
  const pick = (sel) => document.querySelector(sel)
  const main = pick('article') || pick('main') || document.body
  const text = (main?.innerText || document.body.innerText || '').replace(/\s+\n/g, '\n').trim()
  const headings = [...document.querySelectorAll('h1,h2,h3')].map((h) => h.innerText.trim()).filter(Boolean).slice(0, 20)
  return { title: document.title, url: location.href, headings, text: text.slice(0, 8000) }
}

async function readActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
  if (!tab || !tab.id || /^(chrome|edge|about|chrome-extension):/.test(tab.url || '')) {
    return { title: tab?.title || '', url: tab?.url || '', headings: [], text: '' }
  }
  try {
    const [res] = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: extractPage })
    return res.result
  } catch {
    return { title: tab.title || '', url: tab.url || '', headings: [], text: '' }
  }
}

const SYSTEM = `You are Nori, a concise, precise AI assistant living in the user's browser side panel.
When page context is provided, ground your answer in it and cite what's on the page. Use short
markdown. If the user asks you to do something you can't yet (click, fill, post), say so plainly.`

async function chat(question, history) {
  const cfg = await getConfig()
  if (!cfg.apiKey && cfg.provider !== 'ollama') {
    return { error: 'No API key set. Open settings in the panel and add one (OpenRouter is free).' }
  }
  const page = await readActiveTab()
  const context = page.text
    ? `Current page — ${page.title} (${page.url})\n${page.headings.join(' · ')}\n\n${page.text}`
    : 'No readable page is open (maybe a browser page).'

  const messages = [
    { role: 'system', content: SYSTEM },
    { role: 'system', content: `Context:\n${context}` },
    ...(history || []).slice(-8),
    { role: 'user', content: question }
  ]

  try {
    const res = await fetch(`${cfg.baseUrl.replace(/\/$/, '')}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${cfg.apiKey || 'ollama'}`,
        'HTTP-Referer': 'https://github.com/Afzalkhan001/nori-ai-browser',
        'X-Title': 'Nori'
      },
      body: JSON.stringify({ model: cfg.model, messages, max_tokens: 1200 })
    })
    const data = await res.json()
    if (data.error) return { error: data.error.message || 'Provider error.' }
    const answer = data.choices?.[0]?.message?.content
    if (!answer) return { error: 'No response from the model (it may be rate-limited — try again).' }
    return { answer }
  } catch (e) {
    return { error: 'Network error: ' + String(e).slice(0, 120) }
  }
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.type === 'getConfig') {
    getConfig().then(sendResponse)
    return true
  }
  if (msg.type === 'setConfig') {
    chrome.storage.local.set({ noriConfig: msg.cfg }).then(() => sendResponse({ ok: true }))
    return true
  }
  if (msg.type === 'chat') {
    chat(msg.question, msg.history).then(sendResponse)
    return true
  }
  return false
})
