// Nori side panel — chat UI + provider settings. Talks to background.js.

const PRESETS = {
  openrouter: { label: 'OpenRouter — free', baseUrl: 'https://openrouter.ai/api/v1', model: 'openrouter/free', keyUrl: 'https://openrouter.ai/keys', note: 'Free tool-capable models. $0, no hardware. Recommended.' },
  groq: { label: 'Groq — free, fast', baseUrl: 'https://api.groq.com/openai/v1', model: 'llama-3.3-70b-versatile', keyUrl: 'https://console.groq.com/keys', note: 'Very fast free tier.' },
  gemini: { label: 'Google Gemini — free', baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai/', model: 'gemini-2.0-flash', keyUrl: 'https://aistudio.google.com/apikey', note: 'Generous free tier.' },
  openai: { label: 'OpenAI — paid', baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o-mini', keyUrl: 'https://platform.openai.com/api-keys', note: 'Best quality. Requires credits.' },
  ollama: { label: 'Ollama — local, no key', baseUrl: 'http://localhost:11434/v1', model: 'llama3.1', keyUrl: '', note: 'Runs on your machine. Needs Ollama installed.' }
}

const $ = (id) => document.getElementById(id)
const log = $('log')
const q = $('q')
const send = $('send')
let history = []
let busy = false

// ---- settings ----
const provSel = $('provider')
Object.entries(PRESETS).forEach(([k, p]) => {
  const o = document.createElement('option')
  o.value = k
  o.textContent = p.label
  provSel.appendChild(o)
})

function applyPreset(k) {
  const p = PRESETS[k]
  $('model').value = p.model
  $('provNote').textContent = p.note
  $('keyLink').innerHTML = p.keyUrl ? `<a href="${p.keyUrl}" target="_blank">Get a free key →</a>` : 'No key needed — runs locally.'
}
provSel.addEventListener('change', () => applyPreset(provSel.value))

async function loadConfig() {
  const cfg = await chrome.runtime.sendMessage({ type: 'getConfig' })
  provSel.value = PRESETS[cfg.provider] ? cfg.provider : 'openrouter'
  applyPreset(provSel.value)
  $('apiKey').value = cfg.apiKey || ''
  $('model').value = cfg.model || PRESETS[provSel.value].model
  return cfg
}

$('save').addEventListener('click', async () => {
  const provider = provSel.value
  const cfg = {
    provider,
    baseUrl: PRESETS[provider].baseUrl,
    model: $('model').value.trim() || PRESETS[provider].model,
    apiKey: $('apiKey').value.trim()
  }
  await chrome.runtime.sendMessage({ type: 'setConfig', cfg })
  $('settings').classList.remove('show')
  $('log').style.display = 'flex'
  render()
})

$('gear').addEventListener('click', () => {
  const s = $('settings')
  const showing = s.classList.toggle('show')
  $('log').style.display = showing ? 'none' : 'flex'
})

// ---- chat ----
const SUGGESTIONS = ['Summarize this page', 'Explain this simply', 'Key takeaways as bullets', 'Any red flags here?']

function render() {
  log.innerHTML = ''
  if (history.length === 0) {
    const e = document.createElement('div')
    e.className = 'empty'
    e.innerHTML =
      '<h2>Ask about this page.</h2><div>Nori reads what you\'re looking at and answers — grounded in the page.</div><div style="margin-top:18px"></div>'
    const holder = document.createElement('div')
    SUGGESTIONS.forEach((s) => {
      const b = document.createElement('div')
      b.className = 'sug'
      b.innerHTML = `<span>${s}</span><span>→</span>`
      b.onclick = () => ask(s)
      holder.appendChild(b)
    })
    e.appendChild(holder)
    log.appendChild(e)
    return
  }
  history.forEach((m) => {
    const d = document.createElement('div')
    d.className = 'msg ' + (m.role === 'user' ? 'you' : 'nori')
    d.innerHTML = `<div class="who">${m.role === 'user' ? 'You' : 'Nori'}</div><div class="body"></div>`
    d.querySelector('.body').textContent = m.content
    log.appendChild(d)
  })
  if (busy) {
    const d = document.createElement('div')
    d.className = 'msg nori'
    d.innerHTML = '<div class="who">Nori</div><div class="body serif" style="color:var(--ink-400)">Reading the page…</div>'
    log.appendChild(d)
  }
  log.scrollTop = log.scrollHeight
}

async function ask(text) {
  const question = (text || q.value).trim()
  if (!question || busy) return
  history.push({ role: 'user', content: question })
  q.value = ''
  q.style.height = 'auto'
  busy = true
  render()
  updateSend()
  const res = await chrome.runtime.sendMessage({ type: 'chat', question, history: history.slice(0, -1) })
  busy = false
  history.push({ role: 'assistant', content: res.error ? '⚠ ' + res.error : res.answer })
  render()
  updateSend()
}

function updateSend() {
  send.disabled = busy || !q.value.trim()
}
q.addEventListener('input', () => {
  q.style.height = 'auto'
  q.style.height = Math.min(q.scrollHeight, 120) + 'px'
  updateSend()
})
q.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault()
    ask()
  }
})
send.addEventListener('click', () => ask())

// ---- boot ----
loadConfig().then((cfg) => {
  if (!cfg.apiKey && cfg.provider !== 'ollama') {
    $('settings').classList.add('show')
    $('log').style.display = 'none'
  }
  render()
})
