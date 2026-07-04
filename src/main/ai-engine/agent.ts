import type { WebContents } from 'electron'
import type { ToolDef } from './openai'
import { scrapePage, snapshotToContext } from './scrape'
import { trimToBudget } from './cost'
import { savePdf } from '../pdf'
import * as store from '../db/store'
import { searchRecall } from './recall'
import * as cdp from './cdp'
import type { TabManager } from '../tabs'

// ---------- CDP-based reliable input (no coordinates) ----------

// Shared JS helpers injected into each expression: shadow-piercing walk, search
// exclusion, comment scoring, deep active element.
const JS_HELPERS = `
  const clearMarks = (root) => { try { for (const e of root.querySelectorAll('[data-nori-target]')) e.removeAttribute('data-nori-target') } catch(e){} try { for (const e of root.querySelectorAll('*')) if (e.shadowRoot) clearMarks(e.shadowRoot) } catch(e){} };
  const metaOf = (el) => ((el.getAttribute && (el.getAttribute('aria-label')||el.getAttribute('placeholder')||el.getAttribute('data-placeholder'))||'') + ' ' + (el.name||'') + ' ' + (el.id||'')).toLowerCase();
  const searchy = (el) => { let p = el; for (let i=0;i<8&&p;i++){ const tag=(p.tagName||'').toLowerCase(); const cls=((p.className&&p.className.toString?p.className.toString():'')+' '+(p.id||'')+' '+metaOf(p)).toLowerCase(); const role=p.getAttribute?(p.getAttribute('role')||''):''; if(tag.includes('search')||/(^|[^a-z])search([^a-z]|$)/.test(cls)||role==='search')return true; p=p.parentElement||(p.getRootNode&&p.getRootNode().host)||null } return false };
  const isEditor = (el) => el.isContentEditable || el.getAttribute('role')==='textbox' || el.tagName==='TEXTAREA';
  const deepActive = () => { let a=document.activeElement; while(a&&a.shadowRoot&&a.shadowRoot.activeElement) a=a.shadowRoot.activeElement; return a };
  const walkAll = (fn) => { const w=(root)=>{ let ns; try{ns=root.querySelectorAll('*')}catch(e){return} for(const el of ns){ fn(el); if(el.shadowRoot) w(el.shadowRoot) } }; w(document) };
  const commentScore = (el) => { let s=0; if(/comment|conversation|reply|thought|mind/.test(metaOf(el)))s+=6; let p=el; for(let i=0;i<8&&p;i++){ const cls=((p.className&&p.className.toString?p.className.toString():'')+' '+(p.tagName||'')).toLowerCase(); if(/comment|composer|conversation/.test(cls)){s+=4;break} p=p.parentElement||(p.getRootNode&&p.getRootNode().host)||null } if(el.isContentEditable)s+=1; return s };
  const visBtn = (el) => { const r=el.getBoundingClientRect(); return r.width>6&&r.height>6 };
  // STRICT submit-button test: whole-word match (so "See new posts" / "Everyone can
  // reply" are rejected) + known platform button ids. This was the last bug.
  const isSubmitBtn = (b) => {
    if(!visBtn(b))return false;
    const tid=((b.getAttribute&&b.getAttribute('data-testid'))||'').toLowerCase();
    if(/tweetbutton/.test(tid))return true; // X reply/post button
    if(tid==='comment-submit-button'||b.id==='submit-button')return true; // reddit/yt
    const t=(b.innerText||b.value||'').trim();
    const a=((b.getAttribute&&b.getAttribute('aria-label'))||'').trim();
    const blob=(t+' '+a).toLowerCase();
    if(/search|cancel|see new|everyone can|who can|schedule|draft|add (a )?(photo|image|emoji|gif|media|poll)|grok|settings|upload|attach/.test(blob))return false;
    const words=/^(reply|post|comment|publish|submit|send|tweet)( |$)/i;
    return words.test(t) || words.test(a);
  };
`

// Find the comment editor (shadow-aware, never search), expand a collapsed composer
// if needed, focus it, mark it. Returns {found, focused, expanded}. NO coordinates.
const FILL_FOCUS_EXPR = `(async () => {
  ${JS_HELPERS}
  const sleep = (ms) => new Promise(r=>setTimeout(r,ms))
  clearMarks(document)
  const collect = () => { const eds=[]; walkAll((el)=>{ if(isEditor(el)&&!searchy(el)) eds.push(el) }); eds.sort((a,b)=>commentScore(b)-commentScore(a)); return eds }
  let editors = collect()
  // If no comment-like editor, click a visible "Join the conversation" placeholder to reveal it.
  if (!editors.length || commentScore(editors[0]) < 1) {
    let ph=null; walkAll((el)=>{ if(ph)return; if(searchy(el))return; const t=((el.innerText||'')+'').trim().slice(0,50); if(t.length>3&&t.length<50&&/join the conversation|add a (public )?comment|write a comment|start the conversation|leave a comment|what are your thoughts|write a reply/i.test(t)) ph=el })
    if (ph) { try{ph.scrollIntoView({block:'center'})}catch(e){} ph.click(); await sleep(1000); editors = collect() }
  }
  const el = editors[0]
  if (!el) return { found:false }
  el.setAttribute('data-nori-target','1')
  try { el.scrollIntoView({block:'center'}) } catch(e){}
  await sleep(200)
  try { el.focus() } catch(e){}
  await sleep(60)
  return { found:true, focused: deepActive()===el, tag: el.tagName, score: commentScore(el) }
})()`

// Read the MARKED editor's text (falls back to the focused editor). Anchoring on the
// mark — not deepActive() — is critical: on X focus leaves the box after insert, so a
// deepActive-first read returns '' and falsely drives a re-insert. Full text + length
// so callers can verify equality with the intended value (no truncation).
const ACTIVE_READBACK_EXPR = `(() => {
  ${JS_HELPERS}
  let el=null; walkAll((e)=>{ if(!el && e.getAttribute && e.getAttribute('data-nori-target')) el=e })
  if(!el){ const a=deepActive(); if(a&&isEditor(a)) el=a }
  const text = el ? ((el.innerText||el.value||'')+'').trim() : ''
  return { text: text.slice(0,2000), len: text.length, activeIsEditor: (()=>{const a=deepActive();return a?isEditor(a):false})() }
})()`

// Find the post/comment button (shadow-aware, never search/cancel), mark + scroll it.
const SUBMIT_FIND_EXPR = `(() => {
  ${JS_HELPERS}
  clearMarks(document)
  let btn=null; walkAll((el)=>{ if(!btn && (el.tagName==='BUTTON'||el.getAttribute('role')==='button'||(el.tagName==='INPUT'&&el.type==='submit')) && isSubmitBtn(el)) btn=el })
  if(!btn) return { found:false }
  btn.setAttribute('data-nori-target','1')
  try { btn.scrollIntoView({block:'center'}) } catch(e){}
  const disabled = btn.disabled || btn.getAttribute('aria-disabled')==='true'
  return { found:true, disabled, label:(btn.innerText||btn.value||btn.getAttribute('aria-label')||'post').trim().slice(0,30) }
})()`

// Shadow-aware editor text + submit-enabled state (for pre/post verification).
const STATE_EXPR = `(() => {
  ${JS_HELPERS}
  let text='', submitBtn=null, hasEditor=false
  walkAll((el)=>{ if(isEditor(el)){ hasEditor=true; const t=(el.innerText||el.value||'').trim(); if(t&&!text)text=t.slice(0,2000) } if(!submitBtn&&(el.tagName==='BUTTON'||el.getAttribute('role')==='button'||(el.tagName==='INPUT'&&el.type==='submit'))&&isSubmitBtn(el))submitBtn=el })
  const submitEnabled = submitBtn ? !(submitBtn.disabled||submitBtn.getAttribute('aria-disabled')==='true') : false
  return { text, len: text.length, hasEditor, submitFound: !!submitBtn, submitEnabled, submitLabel: submitBtn?(submitBtn.innerText||submitBtn.value||submitBtn.getAttribute('aria-label')||'post').trim().slice(0,30):'' }
})()`

export interface AgentCtx {
  getWc: () => WebContents | null
  tabs: TabManager
}

// Last successfully-verified fill per webContents — lets submit_form confirm the
// composer still holds exactly what we typed, even if the model omits expectedText.
const lastFillByWc = new Map<number, string>()

// Canonical post ids visited per webContents — a batch of N must reach N distinct posts.
const visitedByWc = new Map<number, Set<string>>()
function markVisited(wcId: number, key: string): void {
  let s = visitedByWc.get(wcId)
  if (!s) {
    s = new Set()
    visitedByWc.set(wcId, s)
  }
  s.add(key)
}
function wasVisited(wcId: number, key: string): boolean {
  return visitedByWc.get(wcId)?.has(key) ?? false
}

/** Canonical post-id key — mirrors FIND_POSTS_SCRIPT canon() so navigate can verify it landed. */
function canonKey(raw: string): string {
  try {
    const u = new URL(raw)
    const host = u.hostname.replace(/^www\./, '')
    if (/(^|\.)(twitter|x)\.com$/.test(host)) {
      const m = u.pathname.match(/\/status\/(\d+)/)
      if (m) return 'x:' + m[1]
    }
    if (/(^|\.)reddit\.com$/.test(host)) {
      const m = u.pathname.match(/\/comments\/([a-z0-9]+)/i)
      if (m) return 'reddit:' + m[1]
    }
    if (/(^|\.)youtube\.com$/.test(host)) {
      const v = u.searchParams.get('v')
      if (v) return 'yt:' + v
      const s = u.pathname.match(/\/shorts\/([\w-]+)/)
      if (s) return 'yt:' + s[1]
    }
    return u.origin + u.pathname.replace(/\/$/, '')
  } catch {
    return raw
  }
}

/**
 * Nori's hands — tools the chat agent can call to act in the browser.
 * navigate/read work on the tab the chat belongs to, so the user
 * literally watches Nori browse.
 */

export const AGENT_TOOLS: ToolDef[] = [
  {
    type: 'function',
    function: {
      name: 'search_web',
      description: `Search the web (Google) and get the results page: titles, snippets and LINKS you can then navigate to. The fastest way to find anything. Use focused queries; run several different queries for research tasks.`,
      parameters: {
        type: 'object',
        properties: { query: { type: 'string', description: 'Search query' } },
        required: ['query']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'navigate',
      description: `Navigate the user's current browser tab to a URL and wait for it to load.
For searches use search URLs directly, e.g.
https://www.google.com/search?q=..., https://www.youtube.com/results?search_query=...,
https://www.google.com/maps/search/... Returns the loaded page's url and title.`,
      parameters: {
        type: 'object',
        properties: { url: { type: 'string', description: 'Absolute http(s) URL' } },
        required: ['url']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'read_page',
      description:
        'Read the current page of the tab: title, headings, visible text AND the links on it (which you can navigate to next). Use after navigate, or to look at what the user is seeing.',
      parameters: { type: 'object', properties: {} }
    }
  },
  {
    type: 'function',
    function: {
      name: 'list_tabs',
      description:
        "List all of the user's open browser tabs (id, title, url). Use for multi-tab research or when the user says 'my open tabs', 'all these tabs', 'compare these'.",
      parameters: { type: 'object', properties: {} }
    }
  },
  {
    type: 'function',
    function: {
      name: 'read_tab',
      description:
        'Read a specific open tab by its id (from list_tabs) without switching to it: title, headings, text and links.',
      parameters: {
        type: 'object',
        properties: { tabId: { type: 'string', description: 'Tab id from list_tabs' } },
        required: ['tabId']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'search_history',
      description: `Semantic search over the user's OWN browsing memory (pages they actually visited). Use whenever they ask "where did I see/read…", "that article about X from last week", or want to revisit something. Returns title, url, date and excerpt.`,
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'What to look for' },
          daysBack: { type: 'number', description: 'Optional: only look this many days back' }
        },
        required: ['query']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'watch_topic',
      description:
        "Save a topic to the user's watchlist so they can catch up on new coverage later. Use when the user says 'track this', 'watch this topic', 'keep me updated on X'.",
      parameters: {
        type: 'object',
        properties: { topic: { type: 'string', description: 'Short topic phrase to track' } },
        required: ['topic']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'find_posts',
      description: `Extract real, individual POST/tweet URLs from the current page (a search results, timeline, subreddit or profile page). Returns each post's link + a text snippet. Use this to get actual posts to open — do NOT guess post URLs or open profiles. Works for X (tweet /status/ links), Reddit (/comments/ permalinks), YouTube (/watch), etc.`,
      parameters: { type: 'object', properties: {} }
    }
  },
  {
    type: 'function',
    function: {
      name: 'create_mission',
      description: `Create a standing MISSION Nori pursues automatically on a schedule (background research with dedupe + notification badges). Use when the user says "keep looking for X", "keep me posted on Y", "check every day for Z".`,
      parameters: {
        type: 'object',
        properties: {
          goal: { type: 'string', description: 'The standing goal, phrased concretely' },
          schedule: { type: 'string', enum: ['hourly', 'daily'], description: 'How often to check' }
        },
        required: ['goal']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'read_form',
      description:
        'List the fillable form fields on the current page: index, label, type, current value, options. Always call this before filling a form.',
      parameters: { type: 'object', properties: {} }
    }
  },
  {
    type: 'function',
    function: {
      name: 'fill_form',
      description: `Fill form fields on the current page by index (from read_form). Only use values the user gave you or that are clearly correct — NEVER invent personal data; ask the user for missing details instead. Does not submit.`,
      parameters: {
        type: 'object',
        properties: {
          fields: {
            type: 'array',
            description: 'Fields to set',
            items: {
              type: 'object',
              properties: {
                index: { type: 'number', description: 'Field index from read_form' },
                value: { type: 'string', description: 'Value to enter' }
              },
              required: ['index', 'value']
            }
          }
        },
        required: ['fields']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'submit_form',
      description: `Submit the filled form / click its submit button. This ALWAYS pauses for the user's explicit approval before anything is sent — describe in "summary" exactly what will be submitted and where. Pass the EXACT text you filled as expectedText so submission is blocked if the composer got garbled.`,
      parameters: {
        type: 'object',
        properties: {
          summary: {
            type: 'string',
            description: 'Human-readable description of what is being submitted, for the approval card'
          },
          expectedText: {
            type: 'string',
            description: 'The exact comment/reply text that must currently be in the composer. Submit is blocked unless it matches.'
          }
        },
        required: ['summary']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'save_pdf',
      description: `Create a beautifully formatted PDF report from markdown and save it to the user's Downloads folder. Use when the user asks for a PDF, report or document. Write complete, well-organized markdown content (headings, lists, bold). Returns the saved file path.`,
      parameters: {
        type: 'object',
        properties: {
          title: { type: 'string', description: 'Short report title' },
          markdown: { type: 'string', description: 'Full report body in markdown' }
        },
        required: ['title', 'markdown']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'click',
      description: `Click ANY element on the current page by describing it in plain words — a button, link, tab, menu item, toggle, checkbox, "Next", "Add to cart", "Accept all", a result row, etc. This is how you operate a site like a human: open menus, expand sections, advance multi-step flows, dismiss dialogs. After clicking, call read_page to see what changed. For anything that PLACES AN ORDER, PAYS, POSTS, SENDS or DELETES, describe that clearly in "target" — those clicks pause for the user's approval.`,
      parameters: {
        type: 'object',
        properties: {
          target: {
            type: 'string',
            description: 'Plain-language description of the element to click, e.g. "the Sign in button", "Next", "the first search result", "Accept cookies".'
          }
        },
        required: ['target']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'scroll',
      description: `Scroll the current page. Use to reveal content below the fold, load more items (infinite feeds), or bring a section into view before reading/clicking. Direction "down"/"up"/"top"/"bottom", or pass "toText" to scroll a specific piece of visible text into view.`,
      parameters: {
        type: 'object',
        properties: {
          direction: { type: 'string', enum: ['down', 'up', 'top', 'bottom'], description: 'Where to scroll' },
          toText: { type: 'string', description: 'Optional: scroll until this text is visible' }
        }
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'wait',
      description: `Pause briefly to let the page finish loading, an animation settle, or new content appear after a click. Give seconds (max 10). Use sparingly — only when the page needs a moment.`,
      parameters: {
        type: 'object',
        properties: { seconds: { type: 'number', description: 'Seconds to wait (1–10)' } },
        required: ['seconds']
      }
    }
  }
]

/** Human-readable step label shown in the sidebar while a tool runs. */
export function stepLabel(name: string, args: Record<string, unknown>): string {
  switch (name) {
    case 'search_web':
      return `Searching “${String(args.query ?? '').slice(0, 60)}”…`
    case 'navigate': {
      try {
        return `Opening ${new URL(String(args.url)).hostname.replace(/^www\./, '')}…`
      } catch {
        return 'Navigating…'
      }
    }
    case 'read_page':
      return 'Reading the page…'
    case 'list_tabs':
      return 'Looking at your open tabs…'
    case 'read_tab':
      return 'Reading a tab…'
    case 'watch_topic':
      return 'Adding to your watchlist…'
    case 'search_history':
      return 'Searching your reading memory…'
    case 'find_posts':
      return 'Finding actual posts on this page…'
    case 'create_mission':
      return 'Setting up your mission…'
    case 'read_form':
      return 'Reading the form…'
    case 'fill_form':
      return 'Filling in the fields…'
    case 'submit_form':
      return 'Waiting for your approval…'
    case 'save_pdf':
      return 'Preparing your PDF…'
    case 'click':
      return `Clicking “${String(args.target ?? '').slice(0, 50)}”…`
    case 'scroll':
      return 'Scrolling the page…'
    case 'wait':
      return 'Waiting a moment…'
    default:
      return 'Working…'
  }
}

// ----- form scripts -----

// Shared field selector — includes rich-text comment/post boxes (contenteditable, role=textbox).
const FIELD_SEL =
  'input:not([type=hidden]), textarea, select, [contenteditable="true"], [contenteditable=""], [role="textbox"]'

// ----- trusted input — real Chromium input events (what Playwright/Puppeteer use).
// Synthetic JS clicks/execCommand are ignored by apps like YouTube; these are not.

const pause = (ms: number) => new Promise((r) => setTimeout(r, ms))
const alog = (...a: unknown[]) => console.log('[nori-automate]', ...a)

/** Whitespace-normalized compare key — used to verify a fill EQUALS the intended text. */
const norm = (s: string): string => (s || '').replace(/\s+/g, ' ').trim()

/**
 * Poll an async producer until a condition holds or timeout. Replaces fixed pauses +
 * blind retries in the fill/verify path — we wait for the SAME insert to reconcile in
 * the SPA rather than firing a second insert on a lagging read (the interleaving bug).
 */
async function pollUntil<T>(
  produce: () => Promise<T>,
  ok: (v: T) => boolean,
  timeoutMs = 4000,
  intervalMs = 150
): Promise<T> {
  const deadline = Date.now() + timeoutMs
  let v = await produce()
  while (!ok(v) && Date.now() < deadline) {
    await pause(intervalMs)
    v = await produce()
  }
  return v
}

async function trustedClick(wc: WebContents, x: number, y: number): Promise<void> {
  x = Math.round(x)
  y = Math.round(y)
  wc.focus() // keyboard/mouse events are only reliably delivered to a focused webContents
  await pause(30)
  wc.sendInputEvent({ type: 'mouseMove', x, y })
  await pause(40)
  wc.sendInputEvent({ type: 'mouseDown', x, y, button: 'left', clickCount: 1 })
  await pause(60)
  wc.sendInputEvent({ type: 'mouseUp', x, y, button: 'left', clickCount: 1 })
  await pause(140)
  alog('click', x, y)
}

async function trustedType(wc: WebContents, text: string): Promise<void> {
  wc.focus()
  await pause(30)
  for (const ch of text.replace(/\r?\n/g, ' ')) {
    // keyDown + char + keyUp — some editors listen for keydown, not just char.
    wc.sendInputEvent({ type: 'keyDown', keyCode: ch })
    wc.sendInputEvent({ type: 'char', keyCode: ch })
    wc.sendInputEvent({ type: 'keyUp', keyCode: ch })
    await pause(18)
  }
  alog('typed', JSON.stringify(text.slice(0, 40)))
}

/** Collect fillable fields; if none writable, locate (and surface) a collapsed comment placeholder. */
const COLLECT_FIELDS_SCRIPT = `(async () => {
  const SEL = '${FIELD_SEL}'
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
  const collect = () => {
    const fields = []
    const els = [...document.querySelectorAll(SEL)]
    let idx = 0
    for (const el of els) {
      if (fields.length >= 40) break
      const style = getComputedStyle(el)
      if (style.display === 'none' || style.visibility === 'hidden') { idx++; continue }
      const isCE = el.isContentEditable || el.getAttribute('role') === 'textbox'
      let label = ''
      if (el.id) label = document.querySelector('label[for="' + el.id + '"]')?.innerText ?? ''
      if (!label) label = el.closest('label')?.innerText ?? ''
      label = (label || el.getAttribute('aria-label') || el.getAttribute('data-placeholder') || el.getAttribute('aria-placeholder') || el.getAttribute('placeholder') || el.placeholder || el.name || '').trim().replace(/\\s+/g, ' ').slice(0, 60)
      // Rich-text boxes often have no label — but if it sits inside a comment
      // composer, say so, so the agent knows this IS the comment box.
      if (isCE && !label) {
        const composerAncestor = el.closest('ytd-comment-simplebox-renderer, shreddit-composer, [slot*="comment"], [class*="comment" i], form')
        label = composerAncestor ? 'comment box' : 'text editor'
      }
      const f = {
        index: idx,
        tag: el.tagName.toLowerCase(),
        type: isCE ? 'richtext' : (el.type ?? ''),
        label,
        value: el.tagName === 'SELECT' ? (el.selectedOptions[0]?.text ?? '') : (isCE ? (el.innerText ?? '') : (el.value ?? '')).slice(0, 60)
      }
      if (el.tagName === 'SELECT') f.options = [...el.options].slice(0, 12).map((o) => o.text.trim().slice(0, 40))
      fields.push(f)
      idx++
    }
    return fields
  }
  const vis = (el) => {
    const r = el.getBoundingClientRect()
    return r.width > 4 && r.height > 4
  }
  // A real message/comment target — NOT a search box or a junk share textarea.
  const isCommentTarget = (el) => {
    if (!vis(el)) return false
    if (el.isContentEditable || el.getAttribute('role') === 'textbox') return true
    if (el.tagName === 'TEXTAREA') {
      const l = (el.getAttribute('aria-label') || el.placeholder || el.name || '').toLowerCase()
      return /comment|reply|message|post|thought|caption|tweet|write/.test(l)
    }
    return false
  }
  // Cross-platform comment composers: YouTube, Reddit, X/Twitter, LinkedIn, FB, blogs.
  const findComposer = () => {
    const known = document.querySelector([
      'ytd-comment-simplebox-renderer #placeholder-area',
      '#simplebox-placeholder',
      'ytd-comment-simplebox-renderer',                 // YouTube
      'shreddit-composer, [slot="comment-composer"]',   // Reddit new
      'div[data-testid="comment"] textarea, [name="comment"]', // Reddit old / forms
      '[data-testid="tweetTextarea_0"]',                // X / Twitter
      '.ql-editor[data-placeholder], .comments-comment-box__form div[role="textbox"]', // LinkedIn
      'div[aria-label*="comment" i][role="textbox"], div[aria-label*="Add a comment" i]', // FB / generic
      'form textarea[name*="comment" i], textarea#comment, textarea[placeholder*="comment" i]' // blogs / WP / Disqus
    ].join(', '))
    if (known && vis(known)) return known
    return [...document.querySelectorAll('div,span,p,[role="button"],button')].find((e) => {
      const t = (e.innerText || e.getAttribute('aria-label') || e.getAttribute('placeholder') || '').trim().slice(0, 60)
      return t.length < 50 && vis(e) &&
        /add a (public )?comment|write a comment|start the conversation|leave a comment|add a comment|join the conversation|post your reply|what are your thoughts|write a reply/i.test(t)
    })
  }

  let fields = collect()
  const hasComment = [...document.querySelectorAll(SEL)].some(isCommentTarget)
  let placeholder = null

  // No usable comment box yet — comments are lazy-rendered far below. Scroll to summon them.
  if (!hasComment) {
    let composer = findComposer()
    for (let i = 0; i < 7 && !composer; i++) {
      window.scrollBy(0, Math.round(window.innerHeight * 0.9))
      await sleep(650)
      composer = findComposer()
    }
    if (composer) {
      composer.scrollIntoView({ block: 'center' })
      await sleep(500)
      const r = composer.getBoundingClientRect()
      if (r.width > 4 && r.height > 4) placeholder = { x: r.left + r.width / 2, y: r.top + r.height / 2 }
      fields = collect() // may now include the (still-collapsed) box
    }
  }
  // Page-level blockers: archived/locked posts have NO comment box by design.
  let blocked = null
  try {
    const bodyText = (document.body.innerText || '').slice(0, 8000)
    const m = bodyText.match(/archived post[^.\\n]*|new comments cannot be posted[^.\\n]*|comments are locked[^.\\n]*|comments are disabled[^.\\n]*|comment section is closed[^.\\n]*|turned off comment[^.\\n]*|comments have been turned off[^.\\n]*/i)
    if (m) blocked = m[0].trim().slice(0, 90)
  } catch (e) {}
  return JSON.stringify({ fields, placeholder, hasComment, blocked })
})()`

/** Scroll a field into view and return its viewport-center coords + kind. */
function locateFieldScript(index: number): string {
  return `(async () => {
    const els = [...document.querySelectorAll('${FIELD_SEL}')]
    const el = els[${index}]
    if (!el) return JSON.stringify({ found: false })
    document.querySelectorAll('[data-nori-target]').forEach((m) => m.removeAttribute('data-nori-target'))
    el.setAttribute('data-nori-target', '1')
    // Click coords from the element itself, or its nearest sized ancestor — collapsed
    // comment boxes are 0px tall, but their visible container is clickable.
    const sizedRect = () => {
      let t = el, r = el.getBoundingClientRect()
      for (let i = 0; i < 6 && (r.width < 20 || r.height < 12); i++) {
        t = t.parentElement || (t.getRootNode && t.getRootNode().host)
        if (!t || !t.getBoundingClientRect) break
        r = t.getBoundingClientRect()
      }
      return r
    }
    el.scrollIntoView({ block: 'center' })
    await new Promise((r) => setTimeout(r, 300))
    let r = sizedRect()
    // scrollIntoView often fails on 0px collapsed boxes — FORCE it into the viewport
    // and re-read, so the click never fires off-screen (was landing at y=-3500).
    for (let tries = 0; tries < 3 && (r.top < 80 || r.top > innerHeight - 90); tries++) {
      window.scrollBy(0, Math.round(r.top - innerHeight / 2))
      await new Promise((r) => setTimeout(r, 280))
      r = sizedRect()
    }
    const isCE = el.isContentEditable || el.getAttribute('role') === 'textbox'
    const kind = isCE ? 'richtext' : el.tagName === 'SELECT' ? 'select'
      : (el.type === 'checkbox' || el.type === 'radio') ? 'toggle' : 'text'
    // Clamp strictly inside the viewport — a click can never go off-screen.
    const x = Math.max(6, Math.min(r.left + Math.min(r.width / 2, 180), innerWidth - 6))
    const y = Math.max(6, Math.min(r.top + Math.min(r.height / 2, 16), innerHeight - 6))
    return JSON.stringify({ found: true, kind, x, y, rawTop: Math.round(r.top) })
  })()`
}

/** Native-setter fill for standard inputs/selects/toggles (works fine there). */
function fillNativeScript(index: number, value: string): string {
  return `JSON.stringify(((index, value) => {
    const els = [...document.querySelectorAll('${FIELD_SEL}')]
    const el = els[index]
    if (!el) return { ok: false, error: 'no such field' }
    const setNative = (e, v) => {
      const proto = e.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype
        : e.tagName === 'SELECT' ? HTMLSelectElement.prototype : HTMLInputElement.prototype
      const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set
      if (setter) setter.call(e, v); else e.value = v
      e.dispatchEvent(new Event('input', { bubbles: true }))
      e.dispatchEvent(new Event('change', { bubbles: true }))
    }
    try {
      if (el.tagName === 'SELECT') {
        const opt = [...el.options].find((o) =>
          o.text.trim().toLowerCase() === value.trim().toLowerCase() ||
          o.value.toLowerCase() === value.trim().toLowerCase())
        if (!opt) return { ok: false, error: 'option not found' }
        setNative(el, opt.value)
      } else if (el.type === 'checkbox' || el.type === 'radio') {
        const want = ['true', 'yes', 'on', '1', 'checked'].includes(value.toLowerCase())
        if (el.checked !== want) el.click()
      } else {
        el.focus()
        setNative(el, value)
      }
      return { ok: true }
    } catch (e) { return { ok: false, error: String(e).slice(0, 80) } }
  })(${index}, ${JSON.stringify(value)}))`
}

/** Read back what a field actually contains — the source of truth for honesty. */
function readBackScript(index: number): string {
  return `JSON.stringify((() => {
    const els = [...document.querySelectorAll('${FIELD_SEL}')]
    const el = els[${index}]
    if (!el) return { value: '' }
    const isCE = el.isContentEditable || el.getAttribute('role') === 'textbox'
    return { value: (isCE ? (el.innerText ?? '') : (el.value ?? '')).trim().slice(0, 120) }
  })())`
}

const FIND_SUBMIT_SCRIPT = `(async () => {
  const vis = (el) => {
    const r = el.getBoundingClientRect()
    return r.width > 6 && r.height > 6 && r.bottom > 0 && r.top < innerHeight + 600
  }
  const match = (b) => {
    if (!vis(b)) return false
    const t = (b.innerText || b.value || '').trim()
    const a = (b.getAttribute && b.getAttribute('aria-label')) || ''
    if (/search/i.test(t) || /search/i.test(a)) return false // never the search button
    return /^(submit|apply|send|sign up|register|continue|next|post|comment|reply|publish)\\b/i.test(t) ||
           /post comment|add comment|comment|reply|publish|submit|send/i.test(a)
  }
  // YouTube wraps its real button in a renderer element — reach the actual visible <button>.
  let btn = document.querySelector('#submit-button button')
  if (btn && !vis(btn)) btn = null
  if (!btn) { const f = document.querySelector('form button[type="submit"], form input[type="submit"]'); if (f && vis(f)) btn = f }
  if (!btn) btn = [...document.querySelectorAll('button, input[type="submit"], [role="button"]')].find(match)
  if (!btn) return JSON.stringify({ found: false, error: 'No visible submit/post button found.' })
  const disabled = btn.disabled || btn.getAttribute('aria-disabled') === 'true'
  btn.scrollIntoView({ block: 'center' })
  await new Promise((r) => setTimeout(r, 400))
  const r = btn.getBoundingClientRect()
  return JSON.stringify({
    found: true, disabled,
    label: (btn.innerText || btn.value || btn.getAttribute('aria-label') || 'submit').trim().slice(0, 40),
    x: r.left + r.width / 2, y: r.top + r.height / 2
  })
})()`

/** Current text in the page's comment/rich-text editor — the honesty anchor for submit. */
const EDITOR_TEXT_SCRIPT = `JSON.stringify((() => {
  const el = document.querySelector('#contenteditable-root, [contenteditable="true"], [role="textbox"]')
  const ta = [...document.querySelectorAll('textarea')].find((t) => {
    const l = ((t.getAttribute('aria-label') || t.placeholder || '') + '').toLowerCase()
    return /comment|reply|message|post|thought|caption|write/.test(l) && t.value.trim()
  })
  const text = el ? (el.innerText || '').trim() : (ta ? ta.value.trim() : '')
  return { text: text.slice(0, 120), hasEditor: !!(el || ta) }
})())`

// Pierces shadow DOM, finds the comment editor (NEVER a search box), marks it, and
// returns CLICK coords derived from its nearest sized ancestor — because collapsed
// comment boxes (Reddit "Join the conversation") have zero height until clicked.
const FOCUS_EDITOR_SCRIPT = `(async () => {
  const onScreen = (el) => { const r = el.getBoundingClientRect(); return r.bottom > -300 && r.top < innerHeight + 800 }
  const isEditor = (el) => el.isContentEditable || el.getAttribute('role') === 'textbox' || el.tagName === 'TEXTAREA'
  const metaOf = (el) => ((el.getAttribute && (el.getAttribute('aria-label') || el.getAttribute('placeholder') || el.getAttribute('data-placeholder')) || '') + ' ' + (el.name || '') + ' ' + (el.id || '')).toLowerCase()
  const searchy = (el) => {
    let p = el
    for (let i = 0; i < 8 && p; i++) {
      const tag = (p.tagName || '').toLowerCase()
      const cls = ((p.className && p.className.toString ? p.className.toString() : '') + ' ' + (p.id || '') + ' ' + metaOf(p)).toLowerCase()
      const role = p.getAttribute ? (p.getAttribute('role') || '') : ''
      if (tag.includes('search') || /(^|[^a-z])search([^a-z]|$)/.test(cls) || role === 'search') return true
      p = p.parentElement || (p.getRootNode && p.getRootNode().host) || null
    }
    return false
  }
  // Coords to click: the element itself if it has size, else nearest sized ancestor.
  const clickPoint = (el) => {
    let p = el
    for (let i = 0; i < 6 && p; i++) {
      const r = p.getBoundingClientRect ? p.getBoundingClientRect() : null
      if (r && r.width > 20 && r.height > 12) return { x: r.left + Math.min(r.width / 2, 180), y: r.top + Math.min(r.height / 2, 16) }
      p = p.parentElement || (p.getRootNode && p.getRootNode().host) || null
    }
    const r = el.getBoundingClientRect()
    return { x: r.left + 10, y: r.top + 10 }
  }
  const editors = []
  const marked = []
  const walk = (root) => {
    let nodes; try { nodes = root.querySelectorAll('*') } catch (e) { return }
    for (const el of nodes) {
      if (el.getAttribute && el.getAttribute('data-nori-target')) marked.push(el)
      if (isEditor(el) && onScreen(el) && !searchy(el)) editors.push(el)
      if (el.shadowRoot) walk(el.shadowRoot)
    }
  }
  walk(document)
  for (const m of marked) m.removeAttribute('data-nori-target')
  const score = (el) => {
    let s = 0
    if (/comment|conversation|reply|thought|mind/.test(metaOf(el))) s += 6
    let p = el
    for (let i = 0; i < 8 && p; i++) {
      const cls = ((p.className && p.className.toString ? p.className.toString() : '') + ' ' + (p.tagName || '')).toLowerCase()
      if (/comment|composer|conversation/.test(cls)) { s += 4; break }
      p = p.parentElement || (p.getRootNode && p.getRootNode().host) || null
    }
    if (el.isContentEditable) s += 1
    return s
  }
  editors.sort((a, b) => score(b) - score(a))
  const el = editors[0]
  if (!el) return JSON.stringify({ found: false })
  el.setAttribute('data-nori-target', '1')
  el.scrollIntoView({ block: 'center' })
  await new Promise((r) => setTimeout(r, 350))
  const pt = clickPoint(el)
  return JSON.stringify({ found: true, score: score(el), x: pt.x, y: pt.y })
})()`

// Is the marked editor actually focused? If not, force-focus it. Never type blind.
const ENSURE_FOCUS_SCRIPT = `JSON.stringify((() => {
  const deepActive = () => {
    let a = document.activeElement
    while (a && a.shadowRoot && a.shadowRoot.activeElement) a = a.shadowRoot.activeElement
    return a
  }
  let target = null
  const walk = (root) => {
    let ns; try { ns = root.querySelectorAll('[data-nori-target]') } catch (e) { return }
    if (ns.length) target = ns[0]
    let all; try { all = root.querySelectorAll('*') } catch (e) { return }
    for (const el of all) if (el.shadowRoot && !target) walk(el.shadowRoot)
  }
  walk(document)
  if (!target) return { ok: false, error: 'target lost' }
  let a = deepActive()
  if (a === target) return { ok: true }
  try { target.focus() } catch (e) {}
  a = deepActive()
  return { ok: a === target, refocused: true }
})())`

// Finds the post/comment button (shadow-aware, never search), scrolls it on-screen,
// and returns viewport-clamped click coords. Same off-screen guard as the editor.
const SUBMIT_LOCATE_SCRIPT = `(async () => {
  const vis = (el) => { const r = el.getBoundingClientRect(); return r.width > 6 && r.height > 6 }
  const isSubmit = (b) => {
    if (!vis(b)) return false
    const t = (b.innerText || b.value || '').trim()
    const a = (b.getAttribute && b.getAttribute('aria-label')) || ''
    if (/search|cancel/i.test(t) || /search|cancel/i.test(a)) return false
    return /^(post|comment|reply|publish|submit|send)\\b/i.test(t) || /post comment|add comment|comment|reply|publish|submit|send/i.test(a)
  }
  let btn = null
  const walk = (root) => {
    let ns; try { ns = root.querySelectorAll('*') } catch (e) { return }
    for (const el of ns) {
      if (!btn && (el.tagName === 'BUTTON' || el.getAttribute('role') === 'button' || (el.tagName === 'INPUT' && el.type === 'submit')) && isSubmit(el)) btn = el
      if (el.shadowRoot) walk(el.shadowRoot)
    }
  }
  walk(document)
  if (!btn) return JSON.stringify({ found: false })
  const disabled = btn.disabled || btn.getAttribute('aria-disabled') === 'true'
  btn.scrollIntoView({ block: 'center' })
  await new Promise((r) => setTimeout(r, 300))
  let r = btn.getBoundingClientRect()
  for (let t = 0; t < 3 && (r.top < 80 || r.top > innerHeight - 90); t++) {
    window.scrollBy(0, Math.round(r.top - innerHeight / 2))
    await new Promise((r) => setTimeout(r, 260))
    r = btn.getBoundingClientRect()
  }
  return JSON.stringify({
    found: true, disabled,
    label: (btn.innerText || btn.value || btn.getAttribute('aria-label') || 'post').trim().slice(0, 30),
    x: Math.max(6, Math.min(r.left + r.width / 2, innerWidth - 6)),
    y: Math.max(6, Math.min(r.top + r.height / 2, innerHeight - 6))
  })
})()`

// Shadow-aware state read: the MARKED editor's text (never the search box) + the
// nearest enabled post/comment button. Button-enabled doubles as the truth proxy
// when the editor's content is unreadable.
const RICHTEXT_VERIFY_SCRIPT = `JSON.stringify((() => {
  const vis = (el) => { const r = el.getBoundingClientRect(); return r.width > 6 && r.height > 6 && r.bottom > -200 && r.top < innerHeight + 600 }
  const isSubmit = (b) => {
    if (!vis(b)) return false
    const t = (b.innerText || b.value || '').trim()
    const a = (b.getAttribute && b.getAttribute('aria-label')) || ''
    if (/search|cancel/i.test(t) || /search|cancel/i.test(a)) return false
    return /^(post|comment|reply|publish|submit|send)\\b/i.test(t) || /post comment|add comment|comment|reply|publish|submit|send/i.test(a)
  }
  let target = null, submitBtn = null, anyEditor = false
  const walk = (root) => {
    let ns; try { ns = root.querySelectorAll('*') } catch (e) { return }
    for (const el of ns) {
      if (!target && el.getAttribute && el.getAttribute('data-nori-target')) target = el
      if (el.isContentEditable || el.getAttribute('role') === 'textbox' || el.tagName === 'TEXTAREA') anyEditor = true
      if (!submitBtn && (el.tagName === 'BUTTON' || el.getAttribute('role') === 'button' || (el.tagName === 'INPUT' && el.type === 'submit')) && isSubmit(el)) submitBtn = el
      if (el.shadowRoot) walk(el.shadowRoot)
    }
  }
  walk(document)
  const text = target ? ((target.innerText || target.value || '') + '').trim().slice(0, 80) : ''
  const submitEnabled = submitBtn ? !(submitBtn.disabled || submitBtn.getAttribute('aria-disabled') === 'true') : false
  const sr = submitBtn ? submitBtn.getBoundingClientRect() : null
  return {
    text, hasEditor: !!target || anyEditor, targetFound: !!target,
    submitFound: !!submitBtn, submitEnabled,
    submitX: sr ? sr.left + sr.width / 2 : 0,
    submitY: sr ? sr.top + sr.height / 2 : 0,
    submitLabel: submitBtn ? (submitBtn.innerText || submitBtn.value || submitBtn.getAttribute('aria-label') || 'post').trim().slice(0, 30) : ''
  }
})())`

// Deterministic post-URL extraction — canonical individual posts only, deduped by
// post id (so /photo/1, /analytics, /likes variants of one tweet collapse to one).
const FIND_POSTS_SCRIPT = `JSON.stringify((() => {
  const out=[]; const seen=new Set(); const byAuthor={};
  // The logged-in user's own handle (X account switcher) — NEVER target own posts/replies.
  let self=''; try{ const sw=document.querySelector('[data-testid="SideNav_AccountSwitcher_Button"]'); const m=((sw&&sw.innerText)||'').match(/@([A-Za-z0-9_]+)/); if(m) self=m[1].toLowerCase() }catch(e){}
  // Canonicalize + classify. Returns {id,url} for a real post, null for profiles /
  // photo viewer / analytics / likes / retweets / quotes / nav.
  const canon=(raw)=>{
    if(!raw) return null;
    let u; try{ u=new URL(raw, location.href) }catch(e){ return null }
    const host=u.hostname.replace(/^www\\./,''); const p=u.pathname;
    if(/(^|\\.)(twitter|x)\\.com$/.test(host)){
      const m=p.match(/^\\/([^\\/]+)\\/status\\/(\\d+)/);
      if(!m) return null;
      if(/^(i|home|search|notifications|messages|explore|settings)$/i.test(m[1])) return null;
      return { id:'x:'+m[2], url:'https://x.com/'+m[1]+'/status/'+m[2], author:m[1] };
    }
    if(/(^|\\.)reddit\\.com$/.test(host)){
      const m=p.match(/\\/r\\/([^\\/]+)\\/comments\\/([a-z0-9]+)(?:\\/([^\\/]+))?/i);
      if(!m) return null;
      const slug=m[3]&&!/^comment/i.test(m[3])?('/'+m[3]):'';
      return { id:'reddit:'+m[2], url:'https://www.reddit.com/r/'+m[1]+'/comments/'+m[2]+slug+'/' };
    }
    if(/(^|\\.)youtube\\.com$/.test(host)){
      const v=u.searchParams.get('v'); if(v) return { id:'yt:'+v, url:'https://www.youtube.com/watch?v='+v };
      const sm=p.match(/^\\/shorts\\/([\\w-]+)/); if(sm) return { id:'yt:'+sm[1], url:'https://www.youtube.com/shorts/'+sm[1] };
      return null;
    }
    const clean=u.origin+p.replace(/\\/$/,''); return { id:'g:'+clean, url:clean };
  };
  // "1.2K" / "3,400" / "2M" → number.
  const num=(s)=>{ if(!s)return 0; s=(''+s).replace(/,/g,''); const m=s.match(/([\\d.]+)\\s*([KM])?/i); if(!m)return 0; let n=parseFloat(m[1]); const u=m[2]||''; if(/k/i.test(u))n*=1000; if(/m/i.test(u))n*=1e6; return Math.round(n) };
  // Max 2 posts per author — hashtag feeds are flooded by single affiliate/deal
  // accounts posting every minute; a batch must spread across GENUINE authors.
  const push=(raw,text,extra)=>{ const c=canon(raw); if(!c) return; if(seen.has(c.id)) return; const a=(c.author||'').toLowerCase(); if(a&&self&&a===self) return; if(a&&(byAuthor[a]||0)>=2) return; seen.add(c.id); if(a) byAuthor[a]=(byAuthor[a]||0)+1; out.push(Object.assign({ id:c.id, url:c.url, author:c.author||undefined, text:(text||'').trim().replace(/\\s+/g,' ').slice(0,200) }, extra||{})); };
  // X: read whole tweet ARTICLES (not bare links) — text, engagement counts and the
  // Ad/Promoted marker — so posts can be quality-ranked below.
  for(const art of document.querySelectorAll('article')){
    if(out.length>=25)break;
    const a=art.querySelector('a[href*="/status/"]'); if(!a)continue;
    const promoted=[...art.querySelectorAll('span')].some(s=>{const t=(s.innerText||'').trim();return t==='Ad'||t==='Promoted'});
    const grp=art.querySelector('[role="group"]'); const gl=(grp&&grp.getAttribute('aria-label'))||'';
    const g=(re)=>{const m=gl.match(re);return m?num(m[1]):0};
    const replies=g(/([\\d.,]+\\s*[KM]?)\\s*repl/i), reposts=g(/([\\d.,]+\\s*[KM]?)\\s*(repost|retweet)/i), likes=g(/([\\d.,]+\\s*[KM]?)\\s*like/i);
    push(a.href, (art.innerText||''), { replies, likes, reposts, promoted });
  }
  if(out.length<20) for(const a of document.querySelectorAll('a[href*="/status/"]')){ if(out.length>=25)break; const art=a.closest('article'); push(a.href, art?art.innerText:a.textContent); }
  if(out.length<20) for(const a of document.querySelectorAll('a[href*="/comments/"]')){ if(out.length>=20)break; push(a.href, a.textContent); }
  if(out.length<20) for(const a of document.querySelectorAll('a#video-title, a[href*="/watch?v="], a[href*="/shorts/"]')){ if(out.length>=20)break; push(a.href, a.textContent||a.title); }
  if(!out.length) for(const a of document.querySelectorAll('article a[href^="http"], a[href*="/p/"], a[href*="/post/"]')){ if(out.length>=15)break; const t=(a.textContent||'').trim(); if(t.length>15) push(a.href, t); }
  // ----- SELECTION ENGINE: score genuine conversation UP, affiliate spam DOWN -----
  const dealRe=/(\\d+\\s*%\\s*off|coupon|promo code|discount|price drop|loot|buy now|shop now|limited time|link in bio|order now|lowest price|flash sale|₹\\s*\\d|rs\\.?\\s*\\d)/i;
  const authRe=/(deal|offer|loot|discount|promo|sale|coupon|price|shopping|bargain)/i;
  for(const p of out){
    let s=0; const t=p.text||''; const tags=(t.match(/#\\w+/g)||[]).length;
    s+=Math.min(p.replies||0,10)*2;          // real conversation
    s+=Math.min((p.likes||0)/5,10);          // resonance
    s+=Math.min(p.reposts||0,5);
    if(t.length>100)s+=2;                    // substance
    if(/\\?/.test(t))s+=2;                   // invites replies
    if(tags>=3)s-=6; else s-=tags;           // hashtag stuffing
    if(dealRe.test(t))s-=8;                  // product-pushing language
    if(p.author&&authRe.test(p.author))s-=6; // deal-bot handle
    if(p.promoted)s-=100;                    // paid ad — never engage
    p.score=Math.round(s*10)/10;
    if(s<=-6||p.promoted)p.spam=true;
  }
  out.sort((a,b)=>(b.score||0)-(a.score||0));
  const good=out.filter(p=>!p.spam);
  return (good.length>=3?good:out).slice(0,15);
})())`

/** Find the best clickable element matching a plain-language target; mark + scroll it. */
function clickFindScript(target: string): string {
  return `JSON.stringify((() => {
    const want = ${JSON.stringify(target.toLowerCase().trim())};
    const norm = (s) => (s || '').replace(/\\s+/g, ' ').trim().toLowerCase();
    const vis = (el) => { const r = el.getBoundingClientRect(); return r.width > 2 && r.height > 2 && r.bottom > -50 && r.top < innerHeight + 2500; };
    const clickable = (el) => {
      const tag = el.tagName;
      if (tag === 'BUTTON' || tag === 'A' || tag === 'SUMMARY') return true;
      if (tag === 'INPUT' && /^(submit|button|checkbox|radio|image)$/i.test(el.type || '')) return true;
      const role = (el.getAttribute && el.getAttribute('role')) || '';
      if (/^(button|link|menuitem|menuitemcheckbox|tab|option|checkbox|switch|radio)$/i.test(role)) return true;
      if (el.getAttribute && el.getAttribute('onclick')) return true;
      try { if (el.tabIndex >= 0 && /pointer/.test(getComputedStyle(el).cursor)) return true; } catch (e) {}
      return false;
    };
    const labelOf = (el) => norm(el.innerText || el.value || (el.getAttribute && (el.getAttribute('aria-label') || el.getAttribute('title') || el.getAttribute('placeholder'))) || '');
    const cands = [];
    const walk = (root) => { let ns; try { ns = root.querySelectorAll('*') } catch (e) { return } for (const el of ns) { if (clickable(el) && vis(el)) cands.push(el); if (el.shadowRoot) walk(el.shadowRoot); } };
    walk(document);
    const score = (el) => {
      const t = labelOf(el);
      if (!t) return 0;
      let s = 0;
      if (t === want) s = 100;
      else if (t.startsWith(want) || want.startsWith(t)) s = 80;
      else if (t.includes(want) || want.includes(t)) s = 60;
      else { const ww = want.split(' ').filter(Boolean); const overlap = ww.filter((w) => w.length > 1 && t.includes(w)).length; s = ww.length ? (overlap / ww.length) * 45 : 0; }
      if (t.length < 40) s += 5;
      if (el.tagName === 'BUTTON' || (el.getAttribute && el.getAttribute('role') === 'button')) s += 4;
      const r = el.getBoundingClientRect(); if (r.top >= 0 && r.top < innerHeight) s += 3;
      return s;
    };
    let best = null, bestScore = 0;
    for (const el of cands) { const s = score(el); if (s > bestScore) { bestScore = s; best = el; } }
    if (!best || bestScore < 20) return { found: false };
    try { for (const m of document.querySelectorAll('[data-nori-target]')) m.removeAttribute('data-nori-target'); } catch (e) {}
    best.setAttribute('data-nori-target', '1');
    try { best.scrollIntoView({ block: 'center' }) } catch (e) {}
    const label = labelOf(best).slice(0, 60);
    const committing = /\\b(buy|pay|order|checkout|purchase|place\\s?order|subscribe|donate|confirm|delete|remove|unsubscribe|book\\s?now|pay\\s?now)\\b/i.test(label);
    return { found: true, label, score: Math.round(bestScore), committing };
  })())`
}

/** Scroll the page; optionally until a piece of text is in view. */
function scrollScript(direction: string, toText?: string): string {
  return `JSON.stringify((() => {
    const want = ${JSON.stringify((toText || '').toLowerCase().trim())};
    if (want) {
      const all = document.querySelectorAll('body *');
      for (const el of all) { const t = (el.innerText || '').toLowerCase(); if (t && t.includes(want) && el.getBoundingClientRect().height < 800) { el.scrollIntoView({ block: 'center' }); return { ok: true, to: 'text' }; } }
      return { ok: false, note: 'text not found on page' };
    }
    const dir = ${JSON.stringify(direction || 'down')};
    if (dir === 'top') window.scrollTo(0, 0);
    else if (dir === 'bottom') window.scrollTo(0, document.body.scrollHeight);
    else window.scrollBy(0, Math.round(innerHeight * 0.85) * (dir === 'up' ? -1 : 1));
    return { ok: true, scrollY: Math.round(window.scrollY) };
  })())`
}

function waitForLoad(wc: WebContents, timeoutMs = 12000): Promise<void> {
  return new Promise((resolve) => {
    let settled = false
    const done = () => {
      if (settled) return
      settled = true
      // small settle delay so SPAs (YouTube etc.) render their results
      setTimeout(resolve, 1600)
    }
    wc.once('did-stop-loading', done)
    setTimeout(done, timeoutMs)
  })
}

export async function executeTool(
  name: string,
  args: Record<string, unknown>,
  ctx: AgentCtx
): Promise<string> {
  try {
    // Resolve at execution time — the agent always works in the tab the
    // user is currently looking at, even if they switched mid-run.
    const wc = ctx.getWc()
    switch (name) {
      case 'list_tabs':
        return JSON.stringify(ctx.tabs.listTabs())
      case 'read_tab': {
        const twc = ctx.tabs.getWebContents(String(args.tabId ?? ''))
        if (!twc || twc.isDestroyed()) return JSON.stringify({ error: 'No such tab.' })
        const snap = await scrapePage(twc)
        if (!snap) return JSON.stringify({ error: 'Could not read that tab.' })
        return trimToBudget(snapshotToContext(snap, true), 3500)
      }
      case 'watch_topic': {
        const w = store.addWatch(String(args.topic ?? ''))
        return JSON.stringify({ ok: true, watching: w.topic })
      }
      case 'find_posts': {
        if (!wc || wc.isDestroyed()) return JSON.stringify({ error: 'No active tab.' })
        // X/Reddit lazy-load results — scroll + retry until real posts render.
        let arr: unknown[] = []
        for (let r = 0; r < 5 && arr.length < 5; r++) {
          if (r > 0) {
            await wc.executeJavaScript('window.scrollBy(0, 900)', true).catch(() => {})
            await pause(1300)
          }
          const posts = await wc.executeJavaScript(FIND_POSTS_SCRIPT, true).catch(() => '[]')
          try {
            const next = JSON.parse(posts) as unknown[]
            if (next.length > arr.length) arr = next
          } catch {
            /* keep */
          }
        }
        // Scroll back to top so subsequent reads start clean.
        await wc.executeJavaScript('window.scrollTo(0,0)', true).catch(() => {})
        // EXCLUDE already-visited posts so the batch never loops on the same tweets
        // (prevents churn AND double-commenting on one post).
        const before = arr.length
        arr = arr.filter((p) => {
          const id = (p as { id?: string }).id
          return !id || !wasVisited(wc.id, id)
        })
        alog('find_posts: found', arr.length, 'of', before, 'fresh', JSON.stringify(arr.slice(0, 3)))
        return JSON.stringify(
          arr.length
            ? {
                posts: arr,
                note: 'These are REAL individual posts, RANKED BEST-FIRST by a genuine-conversation score (engagement up, deal-spam/hashtag-stuffing/promoted down; capped 2 per author). Fields: score (higher = more worth engaging), spam:true = affiliate/promo junk — SKIP those unless nothing else remains. Work through the ranked list top-to-bottom, ONE AT A TIME; never revisit an id. Open a url directly (do NOT append /photo or /analytics), then read_form → draft a relevant reply → fill_form → submit_form → next.'
              }
            : {
                posts: [],
                note: 'Still no posts. Make sure you are on a results page like x.com/search?q=<terms>&f=live (the Latest tab), or a subreddit. Then call find_posts again.'
              }
        )
      }
      case 'search_history': {
        const hits = await searchRecall(
          String(args.query ?? ''),
          typeof args.daysBack === 'number' ? args.daysBack : undefined
        )
        if (!hits.length)
          return JSON.stringify({ empty: true, note: 'No matching pages in browsing memory yet.' })
        return JSON.stringify(hits)
      }
      case 'create_mission': {
        const goal = String(args.goal ?? '').trim()
        if (!goal) return JSON.stringify({ error: 'Mission goal required.' })
        const schedule = args.schedule === 'hourly' ? 'hourly' : 'daily'
        const m = store.addMission(goal, schedule)
        return JSON.stringify({ ok: true, mission: m.goal, schedule: m.schedule })
      }
      case 'read_form': {
        if (!wc || wc.isDestroyed()) return JSON.stringify({ error: 'No active tab.' })
        // HARD GUARD: never hand the agent a composer on the user's OWN post — a batch
        // must never degenerate into the account replying to itself.
        const selfCheck = (await wc
          .executeJavaScript(
            `JSON.stringify((()=>{ try{ const m=location.pathname.match(/^\\/([^/]+)\\/status\\//); if(!m||!/(^|\\.)x\\.com$|(^|\\.)twitter\\.com$/.test(location.hostname)) return {self:false}; const author=m[1].toLowerCase(); const sw=document.querySelector('[data-testid="SideNav_AccountSwitcher_Button"]'); const hm=((sw&&sw.innerText)||'').match(/@([A-Za-z0-9_]+)/); const h=hm?hm[1].toLowerCase():''; return { self: !!h && h===author }; }catch(e){ return {self:false} } })())`,
            true
          )
          .then((r: string) => JSON.parse(r) as { self: boolean })
          .catch(() => ({ self: false })))
        if (selfCheck.self) {
          alog('read_form: BLOCKED — this is the logged-in user\'s OWN post')
          return JSON.stringify({
            fields: [],
            pageBlocked: 'This is the user\'s OWN post/reply — NEVER comment on your own posts. Skip it and go to the NEXT candidate post.'
          })
        }
        let out = JSON.parse(await wc.executeJavaScript(COLLECT_FIELDS_SCRIPT, true)) as {
          fields: { type: string; tag: string; label?: string }[]
          placeholder: { x: number; y: number } | null
          blocked: string | null
        }
        // On social post pages the composer is lazy-rendered — if empty, wait & retry
        // (X/Reddit SPAs need a moment after navigate before the reply box exists).
        const url = wc.getURL()
        const isPostPage = /\/status\/\d+|\/comments\/|reddit\.com\/r\/[^/]+\/comments|\/watch\?v=|\/posts?\/|instagram\.com\/p\//.test(url)
        // X/Reddit lazy-render the composer — poll longer before giving up, and scroll
        // once mid-way in case it's below the fold.
        for (let r = 0; isPostPage && out.fields.length === 0 && !out.blocked && r < 6; r++) {
          if (r === 2) await wc.executeJavaScript('window.scrollBy(0, 400)', true).catch(() => {})
          await pause(1500)
          out = JSON.parse(await wc.executeJavaScript(COLLECT_FIELDS_SCRIPT, true))
        }
        alog('read_form: initial fields', out.fields.length, 'placeholder', out.placeholder, 'blocked', out.blocked, 'isPost', isPostPage)
        if (out.blocked) {
          return JSON.stringify({
            fields: out.fields,
            pageBlocked: out.blocked,
            note: 'Commenting is DISABLED on this page (archived/locked). Do not try to comment here — navigate to a different post and continue.'
          })
        }
        // Collapsed comment editor: open it with a REAL click, then re-collect.
        if (out.placeholder) {
          await trustedClick(wc, out.placeholder.x, out.placeholder.y)
          await pause(1200)
          out = JSON.parse(await wc.executeJavaScript(COLLECT_FIELDS_SCRIPT, true))
          alog('read_form: after opening editor, fields', out.fields.length)
        }
        alog('read_form: returning', JSON.stringify(out.fields.map((f) => ({ i: (f as { index?: number }).index, t: f.type, l: f.label }))))
        return JSON.stringify({ fields: out.fields, note: 'index refers to position among matching fields' })
      }
      case 'fill_form': {
        if (!wc || wc.isDestroyed()) return JSON.stringify({ error: 'No active tab.' })
        const fields = (Array.isArray(args.fields) ? args.fields : []) as {
          index: number
          value: string
        }[]
        const results: unknown[] = []
        for (const f of fields) {
          const idx = Number(f.index)
          const value = String(f.value ?? '')
          const loc = JSON.parse(await wc.executeJavaScript(locateFieldScript(idx), true)) as {
            found: boolean
            kind?: string
            x?: number
            y?: number
          }
          if (!loc.found) {
            results.push({ index: idx, ok: false, error: 'no such field' })
            continue
          }
          if (loc.kind === 'richtext') {
            // RELIABLE PATH: CDP DevTools Protocol — no coordinates, no OS clicks.
            const useCdp = cdp.ensureAttached(wc)
            if (useCdp) {
              const foc = (await cdp.evaluate(wc, FILL_FOCUS_EXPR)) as {
                found: boolean
                focused?: boolean
                score?: number
                tag?: string
              }
              alog('fill richtext[cdp]: find', JSON.stringify(foc))
              if (!foc.found) {
                results.push({ index: idx, ok: false, error: 'no comment editor found on the page' })
                continue
              }
              // Each attempt is ATOMIC and focus-preserving: real click + JS focus →
              // select-all → insertText (REPLACES the whole selection in one step) →
              // poll until readback EQUALS the intended text. select-all+replace means
              // there's no separate clear to steal focus, and text can never stack.
              const expected = norm(value)
              let back = { text: '', len: 0 } as { text: string; len: number }
              let ok = false
              for (let attempt = 0; attempt < 4 && !ok; attempt++) {
                await cdp.clickMarked(wc) // focus/expand facade composers
                await pause(280)
                await cdp.focusMarked(wc) // belt: guarantee the editor holds focus
                await pause(100)
                await cdp.selectAll(wc) // select existing content (draft/prior attempt)
                await pause(80)
                await cdp.insertText(wc, value) // replaces the selection — atomic
                back = await pollUntil(
                  () => cdp.evaluate(wc, ACTIVE_READBACK_EXPR) as Promise<{ text: string; len: number }>,
                  (b) => norm(b.text) === expected,
                  4000,
                  150
                )
                ok = norm(back.text) === expected
                // If somehow over-appended, hard-clear before the next attempt.
                if (!ok && back.len > expected.length + 4) {
                  await cdp.clearFocused(wc)
                  await pause(150)
                }
                alog('fill richtext[cdp]: attempt', attempt, 'ok', ok, JSON.stringify(back))
              }
              if (ok) lastFillByWc.set(wc.id, value)
              // FIX 4 — equality gate: doubled/interleaved/partial text is NOT success.
              results.push({
                index: idx,
                ok,
                valueNow: back.text.slice(0, 200),
                ...(ok
                  ? {}
                  : {
                      error:
                        'fill did not match the intended text (garbled/partial/could-not-verify) — do NOT claim success; editor was cleared for retry.'
                    })
              })
              continue
            }

            // FALLBACK (CDP unavailable): legacy coordinate path — same discipline:
            // clear before typing, insert once, poll until it EQUALS the value.
            alog('fill richtext: CDP unavailable, using fallback')
            const expectedFb = norm(value)
            const clearScript = `(() => { const el=document.querySelector('[data-nori-target]')||document.activeElement; if(!el)return; try{el.focus()}catch(e){} if(el.tagName==='TEXTAREA'||el.tagName==='INPUT'){const d=Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el),'value');d&&d.set?d.set.call(el,''):(el.value='');el.dispatchEvent(new Event('input',{bubbles:true}))} else {try{const r=document.createRange();r.selectNodeContents(el);const s=getSelection();s.removeAllRanges();s.addRange(r);document.execCommand('delete',false,null)}catch(e){}} })()`
            await trustedClick(wc, loc.x!, loc.y!)
            await pause(700)
            wc.focus()
            await pause(80)
            await wc.executeJavaScript(clearScript, true).catch(() => {})
            await pause(120)
            try {
              wc.insertText(value)
            } catch {
              await trustedType(wc, value)
            }
            const v = await pollUntil(
              () =>
                wc.executeJavaScript(RICHTEXT_VERIFY_SCRIPT, true).then(
                  (r) => JSON.parse(r) as { text: string; submitEnabled: boolean }
                ),
              (r) => norm(r.text) === expectedFb,
              4000,
              200
            )
            const ok = norm(v.text) === expectedFb
            results.push({
              index: idx,
              ok,
              valueNow: v.text,
              ...(ok ? {} : { error: 'fill did not match intended text — do not claim success' })
            })
          } else {
            const res = JSON.parse(await wc.executeJavaScript(fillNativeScript(idx, value), true))
            results.push({ index: idx, ...res })
          }
        }
        return JSON.stringify({ results })
      }
      case 'submit_form': {
        if (!wc || wc.isDestroyed()) return JSON.stringify({ error: 'No active tab.' })
        // Approval already granted by the chat loop before this executes.
        const useCdp = cdp.ensureAttached(wc)

        // FIX 6 — settle the pre-snapshot so a lagging empty read can't poison the
        // cleared/equality checks.
        const pre = (await pollUntil(
          () =>
            cdp.evaluate(wc, STATE_EXPR) as Promise<{
              text: string
              hasEditor: boolean
              submitFound: boolean
              submitEnabled: boolean
              submitLabel: string
            }>,
          (s) => !s.hasEditor || s.text.length > 0 || s.submitEnabled,
          2500,
          150
        )) as {
          text: string
          hasEditor: boolean
          submitFound: boolean
          submitEnabled: boolean
          submitLabel: string
        }
        alog('submit[cdp]: pre', JSON.stringify(pre), 'cdp', useCdp)

        // FIX 5 — never post garbled/stale text: the composer must currently hold
        // EXACTLY the intended reply (from expectedText, or the last verified fill).
        const expectedSubmit = norm(String(args.expectedText ?? lastFillByWc.get(wc.id) ?? ''))
        if (pre.hasEditor && expectedSubmit && norm(pre.text) !== expectedSubmit) {
          return JSON.stringify({
            ok: false,
            error: `The composer does not currently hold the intended reply (it shows "${pre.text.slice(0, 60)}"). It may be garbled, partial or stale — do NOT post. Re-run fill_form for this post.`
          })
        }

        const found = (await cdp.evaluate(wc, SUBMIT_FIND_EXPR)) as {
          found: boolean
          disabled?: boolean
          label?: string
        }
        if (!found.found)
          return JSON.stringify({ ok: false, error: 'No visible post/comment button found.' })
        if (found.disabled) {
          return JSON.stringify({
            ok: false,
            error: pre.hasEditor
              ? `The "${found.label}" button is disabled — the comment text did not register. Do NOT claim it posted; re-run fill_form.`
              : `The "${found.label}" button is disabled — you may need to be logged in. Do not claim it posted.`
          })
        }

        // MULTI-STRATEGY submit — try in reliability order, verify the composer
        // ACTUALLY emptied after each, stop on first success. A post clears the
        // composer (or removes it); we poll for THAT — NOT the button's enabled state,
        // which flips instantly on click, before the text clears (that early-exit was
        // giving false negatives: replies posted but reported as failed).
        const clearedAfter = async (): Promise<boolean> => {
          if (norm(pre.text).length === 0) return false
          const s = (await pollUntil(
            () =>
              cdp.evaluate(wc, STATE_EXPR) as Promise<{
                text: string
                submitFound: boolean
                submitEnabled: boolean
              }>,
            (v) => norm(v.text) === '' || !v.submitFound, // composer emptied OR removed
            4500,
            200
          )) as { text: string; submitFound: boolean; submitEnabled: boolean }
          const posted = norm(s.text) === '' || !s.submitFound
          alog('submit[cdp]: clearedAfter', posted, JSON.stringify(s))
          return posted
        }

        const label = found.label
        let posted = false

        if (pre.hasEditor) {
          // STRATEGY A — Ctrl/Cmd+Enter. Re-mark+focus the EDITOR first (SUBMIT_FIND_EXPR
          // marked the BUTTON), then send the committing key chord into the composer.
          await cdp.evaluate(wc, FILL_FOCUS_EXPR)
          await pause(120)
          await cdp.focusMarked(wc)
          await pause(80)
          await cdp.submitViaKeyboard(wc)
          posted = await clearedAfter()
          alog('submit[cdp]: strategy A keyboard', posted)

          // STRATEGY B — full CDP mouse click (buttons bitmask + settle) on the button.
          if (!posted) {
            await cdp.evaluate(wc, SUBMIT_FIND_EXPR)
            await pause(120)
            await cdp.clickMarkedFull(wc)
            posted = await clearedAfter()
            alog('submit[cdp]: strategy B click', posted)
          }

          // STRATEGY C — scripted pointer events + .click() + form.requestSubmit.
          if (!posted) {
            await cdp.evaluate(wc, SUBMIT_FIND_EXPR)
            await pause(120)
            await cdp.evaluate(
              wc,
              `(() => { let el=document.querySelector('[data-nori-target]'); if(!el){const w=(rt)=>{for(const e of rt.querySelectorAll('*')){if(e.getAttribute&&e.getAttribute('data-nori-target')){el=e;return}if(e.shadowRoot)w(e.shadowRoot)}};w(document)} if(!el)return false; try{el.dispatchEvent(new MouseEvent('pointerdown',{bubbles:true,cancelable:true}))}catch(e){} try{el.dispatchEvent(new MouseEvent('pointerup',{bubbles:true,cancelable:true}))}catch(e){} el.click(); if(el.form&&el.form.requestSubmit){try{el.form.requestSubmit(el)}catch(e){}} return true })()`
            )
            posted = await clearedAfter()
            alog('submit[cdp]: strategy C scripted', posted)
          }
        } else {
          // No editor (pure button flow) — one full click, can't auto-verify.
          await cdp.clickMarkedFull(wc)
          await pause(2000)
          return JSON.stringify({
            ok: true,
            clicked: label,
            note: `Clicked "${label}". Could not auto-verify — ask the user to confirm.`
          })
        }

        if (posted) {
          lastFillByWc.delete(wc.id)
          await pause(6000) // anti-spam pacing between batch replies
        }
        return JSON.stringify({
          ok: posted,
          clicked: label,
          note: posted
            ? `Posted — the composer cleared after "${label}".`
            : `Tried keyboard, full click and scripted submit on "${label}" but the text is still in the box — it did NOT post. Report honestly; do not claim success.`
        })
      }
      case 'search_web': {
        if (!wc || wc.isDestroyed()) return JSON.stringify({ error: 'No active tab.' })
        const q = String(args.query ?? '').trim()
        if (!q) return JSON.stringify({ error: 'Empty query.' })
        wc.loadURL(`https://www.google.com/search?q=${encodeURIComponent(q)}`).catch(() => {})
        await waitForLoad(wc)
        const snap = await scrapePage(wc)
        if (!snap) return JSON.stringify({ error: 'Could not read results.' })
        return trimToBudget(snapshotToContext(snap, true), 4000)
      }
      case 'navigate': {
        if (!wc || wc.isDestroyed()) return JSON.stringify({ error: 'No active tab.' })
        const url = String(args.url ?? '')
        if (!/^https?:\/\//i.test(url)) return JSON.stringify({ error: 'URL must be http(s).' })
        const want = canonKey(url)
        const already = wasVisited(wc.id, want)
        wc.loadURL(url).catch(() => {})
        await waitForLoad(wc)
        let landed = canonKey(wc.getURL()) === want
        if (!landed) {
          // SPA router kept the old view — force a genuine document load.
          try {
            wc.stop()
          } catch {
            /* ignore */
          }
          wc.loadURL(url, { extraHeaders: 'pragma: no-cache\n' }).catch(() => {})
          await waitForLoad(wc)
          landed = canonKey(wc.getURL()) === want
        }
        if (!landed) {
          return JSON.stringify({
            ok: false,
            url: wc.getURL(),
            intended: url,
            landedAsRequested: false,
            error: `The site kept the previous view (SPA router intercepted the navigation) — you did NOT reach ${url}. Skip this post and go to the NEXT one; do not re-issue the same navigate.`
          })
        }
        markVisited(wc.id, want)
        return JSON.stringify({
          ok: true,
          url: wc.getURL(),
          title: wc.getTitle(),
          landedAsRequested: true,
          alreadyVisited: already
        })
      }
      case 'read_page': {
        if (!wc || wc.isDestroyed()) return JSON.stringify({ error: 'No active tab.' })
        const snap = await scrapePage(wc)
        if (!snap) return JSON.stringify({ error: 'Could not read this page.' })
        return trimToBudget(snapshotToContext(snap, true), 4000)
      }
      case 'save_pdf': {
        const title = String(args.title ?? 'Nori Report')
        const path = await savePdf(title, String(args.markdown ?? ''))
        store.addArtifact({ type: 'pdf', title, meta: { path } })
        return JSON.stringify({ ok: true, savedTo: path })
      }
      case 'click': {
        if (!wc || wc.isDestroyed()) return JSON.stringify({ error: 'No active tab.' })
        const target = String(args.target ?? '').trim()
        if (!target) return JSON.stringify({ error: 'Describe what to click.' })
        const found = JSON.parse(await wc.executeJavaScript(clickFindScript(target), true)) as {
          found: boolean
          label?: string
          committing?: boolean
        }
        if (!found.found) {
          return JSON.stringify({
            ok: false,
            error: `Could not find anything matching "${target}" to click. Call read_page to see the real labels, or scroll to reveal it first.`
          })
        }
        await pause(200)
        const useCdp = cdp.ensureAttached(wc)
        let clicked = false
        if (useCdp) clicked = await cdp.clickMarked(wc)
        if (!clicked) {
          clicked = await wc
            .executeJavaScript(
              `(() => { const el = document.querySelector('[data-nori-target]'); if (!el) return false; el.click(); return true })()`,
              true
            )
            .catch(() => false)
        }
        await pause(600)
        alog('click:', target, '-> label', found.label, 'ok', clicked)
        return JSON.stringify({
          ok: clicked,
          clickedLabel: found.label,
          note: clicked
            ? 'Clicked. Call read_page to see what changed (a menu opened, page advanced, etc.).'
            : 'The click may not have registered — try describing the element differently or read_page first.'
        })
      }
      case 'scroll': {
        if (!wc || wc.isDestroyed()) return JSON.stringify({ error: 'No active tab.' })
        const res = await wc.executeJavaScript(
          scrollScript(String(args.direction ?? 'down'), args.toText ? String(args.toText) : undefined),
          true
        )
        await pause(700) // let lazy content load in
        return res
      }
      case 'wait': {
        const secs = Math.max(1, Math.min(10, Number(args.seconds) || 2))
        await pause(secs * 1000)
        return JSON.stringify({ ok: true, waited: secs })
      }
      default:
        return JSON.stringify({ error: `Unknown tool: ${name}` })
    }
  } catch (err) {
    return JSON.stringify({ error: err instanceof Error ? err.message : 'Tool failed.' })
  }
}
