import { protocol } from 'electron'

/**
 * nori://home — the editorial new-tab page. Self-contained HTML,
 * no network, matches the porcelain/ink/moss design system.
 */
const HOME_HTML = `<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<title>New Tab</title>
<style>
  :root {
    --porcelain: #f6f3ec;
    --ink: #21211d;
    --ink-500: #6f6d64;
    --ink-300: #b3b1a6;
    --moss: #34503e;
    --ease: cubic-bezier(0.22, 1, 0.36, 1);
  }
  * { margin: 0; padding: 0; box-sizing: border-box; }
  html, body { height: 100%; }
  body {
    background:
      radial-gradient(1200px 600px at 70% -10%, rgba(79,114,89,0.07), transparent 60%),
      var(--porcelain);
    color: var(--ink);
    font-family: 'Segoe UI Variable Text', 'Segoe UI', system-ui, sans-serif;
    display: flex;
    align-items: center;
    justify-content: center;
    user-select: none;
    overflow: hidden;
  }
  .wrap { width: min(560px, 86vw); text-align: center; }
  @keyframes up { from { opacity: 0; transform: translateY(14px); } to { opacity: 1; transform: none; } }
  .kicker {
    font-size: 10px; letter-spacing: 0.22em; text-transform: uppercase;
    color: var(--ink-300); animation: up 0.9s var(--ease) both;
  }
  h1 {
    font-family: Georgia, 'Times New Roman', serif;
    font-style: italic; font-weight: 400;
    font-size: clamp(38px, 6vw, 54px);
    letter-spacing: -0.01em;
    margin-top: 14px;
    animation: up 0.9s var(--ease) 0.08s both;
  }
  h1 .dot { color: var(--moss); font-style: normal; }
  form {
    margin-top: 40px; position: relative;
    animation: up 0.9s var(--ease) 0.16s both;
  }
  input {
    width: 100%; height: 54px;
    border: 1px solid rgba(33,33,29,0.1);
    border-radius: 16px;
    background: #fffefb;
    box-shadow: 0 2px 14px rgba(33,33,29,0.05);
    padding: 0 54px 0 22px;
    font-size: 15px; color: var(--ink);
    outline: none;
    transition: box-shadow 0.4s var(--ease), border-color 0.4s var(--ease);
  }
  input::placeholder { font-family: Georgia, serif; font-style: italic; color: var(--ink-300); }
  input:focus { border-color: rgba(64,96,75,0.5); box-shadow: 0 4px 24px rgba(33,33,29,0.09); }
  button {
    position: absolute; right: 9px; top: 9px;
    width: 36px; height: 36px; border: 0; border-radius: 50%;
    background: var(--moss); color: #faf8f4; cursor: pointer;
    font-size: 14px;
    transition: transform 0.3s var(--ease), background 0.3s var(--ease);
  }
  button:hover { background: #40604b; transform: translateX(2px); }
  .foot {
    margin-top: 64px; font-size: 11px; letter-spacing: 0.14em;
    text-transform: uppercase; color: var(--ink-300);
    animation: up 0.9s var(--ease) 0.24s both;
  }
</style>
</head>
<body>
  <div class="wrap">
    <div class="kicker" id="date"></div>
    <h1><span id="greet"></span><span class="dot">.</span></h1>
    <form id="f">
      <input id="q" placeholder="Search or enter address" autofocus spellcheck="false" autocomplete="off" />
      <button type="submit" aria-label="Go">→</button>
    </form>
    <div class="foot">Nori — your AI teammate</div>
  </div>
<script>
  const h = new Date().getHours()
  document.getElementById('greet').textContent =
    h < 5 ? 'Up late' : h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening'
  document.getElementById('date').textContent =
    new Date().toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })
  document.getElementById('f').addEventListener('submit', (e) => {
    e.preventDefault()
    const v = document.getElementById('q').value.trim()
    if (!v) return
    const isUrl = /^https?:\\/\\//i.test(v) || /^[\\w-]+(\\.[\\w-]+)+(:\\d+)?(\\/.*)?$/.test(v)
    location.href = isUrl ? (v.startsWith('http') ? v : 'https://' + v) : 'https://www.google.com/search?q=' + encodeURIComponent(v)
  })
</script>
</body>
</html>`

export function registerStartPage(): void {
  protocol.handle('nori', (req) => {
    const { host } = new URL(req.url)
    if (host === 'home') {
      return new Response(HOME_HTML, { headers: { 'content-type': 'text/html; charset=utf-8' } })
    }
    return new Response('Not found', { status: 404 })
  })
}

export const HOME_URL = 'nori://home'
