import type { WebContents } from 'electron'

/**
 * Thin Chrome DevTools Protocol wrapper over webContents.debugger — the same
 * engine Playwright/Puppeteer use. This replaces coordinate-simulated clicks
 * (sendInputEvent at a guessed pixel) with DOM-direct actions:
 *   - Input.insertText types into the FOCUSED element (emoji-safe, no coords)
 *   - element geometry comes from the browser, not renderer math
 * so the whole scroll/offset/0px/shadow-DOM failure class disappears.
 */

const attached = new WeakSet<WebContents>()

export function ensureAttached(wc: WebContents): boolean {
  if (attached.has(wc)) return true
  try {
    wc.debugger.attach('1.3')
    attached.add(wc)
    wc.once('destroyed', () => attached.delete(wc))
    // If devtools opens (or another client attaches), forget our state.
    wc.debugger.on('detach', () => attached.delete(wc))
    return true
  } catch (err) {
    // Already attached by us, or attach failed — treat "already attached" as ok.
    if (String(err).includes('already attached')) {
      attached.add(wc)
      return true
    }
    return false
  }
}

async function send<T = unknown>(
  wc: WebContents,
  method: string,
  params?: Record<string, unknown>
): Promise<T> {
  return (await wc.debugger.sendCommand(method, params)) as T
}

/** Evaluate an expression in the page; returns the value (JSON-serializable). */
export async function evaluate<T = unknown>(wc: WebContents, expression: string): Promise<T> {
  const res = await send<{ result: { value?: T }; exceptionDetails?: unknown }>(
    wc,
    'Runtime.evaluate',
    {
      expression,
      returnByValue: true,
      awaitPromise: true,
      userGesture: true // lets pages treat focus()/click() as user-initiated
    }
  )
  return res.result?.value as T
}

/** Type text into the currently focused element — the reliable primitive. */
export async function insertText(wc: WebContents, text: string): Promise<void> {
  await send(wc, 'Input.insertText', { text })
}

/**
 * Empty the focused (or [data-nori-target]) editor before typing, so insertText
 * (which APPENDS at the caret) can never stack onto a stale draft or a prior
 * attempt. Handles contenteditable (Draft.js/Lexical/ProseMirror) + textarea/input,
 * with a CDP select-all+Delete belt, and verifies empty (up to 3 tries).
 */
export async function clearFocused(wc: WebContents): Promise<boolean> {
  const findExpr = `(() => {
    const deep=()=>{let a=document.activeElement;while(a&&a.shadowRoot&&a.shadowRoot.activeElement)a=a.shadowRoot.activeElement;return a};
    let el=deep();
    if(!el||!(el.isContentEditable||el.getAttribute('role')==='textbox'||el.tagName==='TEXTAREA'||el.tagName==='INPUT')){let t=null;const w=(r)=>{try{for(const e of r.querySelectorAll('*')){if(e.getAttribute&&e.getAttribute('data-nori-target'))t=e;if(e.shadowRoot)w(e.shadowRoot)}}catch(e){}};w(document);if(t)el=t}
    return el;
  })`
  for (let i = 0; i < 3; i++) {
    await evaluate(wc, `((find)=>{ const el=find(); if(!el)return; try{el.focus()}catch(e){}
      if(el.tagName==='TEXTAREA'||el.tagName==='INPUT'){ const d=Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el),'value'); d&&d.set?d.set.call(el,''):(el.value=''); el.dispatchEvent(new Event('input',{bubbles:true})); }
      else { try{ const r=document.createRange(); r.selectNodeContents(el); const s=getSelection(); s.removeAllRanges(); s.addRange(r); document.execCommand('delete',false,null); }catch(e){} }
    })(${findExpr})`)
    // Belt: CDP-level Ctrl/Cmd+A then Delete for editors that ignore execCommand.
    const mod = process.platform === 'darwin' ? 4 : 2
    for (const type of ['rawKeyDown', 'keyUp'] as const)
      await send(wc, 'Input.dispatchKeyEvent', { type, modifiers: mod, windowsVirtualKeyCode: 65, code: 'KeyA', key: 'a' })
    for (const type of ['rawKeyDown', 'keyUp'] as const)
      await send(wc, 'Input.dispatchKeyEvent', { type, windowsVirtualKeyCode: 46, code: 'Delete', key: 'Delete' })
    const empty = await evaluate<boolean>(
      wc,
      `((find)=>{ const el=find(); return !el || (((el.innerText||el.value||'')+'').trim()===''); })(${findExpr})`
    )
    if (empty) return true
  }
  return false
}

/**
 * Select-all in the focused editor (Ctrl/Cmd+A). Followed by insertText, this ATOMICALLY
 * replaces the editor's content in one step — no separate clear that could steal focus.
 */
export async function selectAll(wc: WebContents): Promise<void> {
  const mac = process.platform === 'darwin'
  await pressKey(wc, { key: 'a', code: 'KeyA', keyCode: 65, ctrl: !mac, meta: mac })
}

/** Focus the [data-nori-target] element from JS (backup for CDP click focus). */
export async function focusMarked(wc: WebContents): Promise<boolean> {
  return evaluate<boolean>(
    wc,
    `(() => { let el=null; const w=(r)=>{try{for(const e of r.querySelectorAll('*')){if(e.getAttribute&&e.getAttribute('data-nori-target'))el=e;if(e.shadowRoot)w(e.shadowRoot)}}catch(e){}}; w(document); if(!el)return false; try{el.focus()}catch(e){} const deep=()=>{let a=document.activeElement;while(a&&a.shadowRoot&&a.shadowRoot.activeElement)a=a.shadowRoot.activeElement;return a}; return deep()===el })()`
  )
}

/** Send a real key chord via CDP (used for select-all etc. from callers). */
export async function pressKey(
  wc: WebContents,
  opts: { key: string; code: string; keyCode: number; ctrl?: boolean; meta?: boolean }
): Promise<void> {
  let modifiers = 0
  if (opts.ctrl) modifiers |= 2
  if (opts.meta) modifiers |= 4
  for (const type of ['rawKeyDown', 'keyUp'] as const)
    await send(wc, 'Input.dispatchKeyEvent', {
      type,
      modifiers,
      windowsVirtualKeyCode: opts.keyCode,
      code: opts.code,
      key: opts.key
    })
}

/**
 * Click the element previously tagged with data-nori-target, using geometry the
 * BROWSER computes (getContentQuads) rather than renderer coordinates. Falls back
 * to a scripted .click() if quads are unavailable (e.g. inline/zero-box elements).
 */
export async function clickMarked(wc: WebContents): Promise<boolean> {
  try {
    const doc = await send<{ root: { nodeId: number } }>(wc, 'DOM.getDocument', { depth: -1, pierce: true })
    const q = await send<{ nodeId: number }>(wc, 'DOM.querySelector', {
      nodeId: doc.root.nodeId,
      selector: '[data-nori-target]'
    })
    if (!q.nodeId) return false
    const boxes = await send<{ quads: number[][] }>(wc, 'DOM.getContentQuads', { nodeId: q.nodeId })
    const quad = boxes.quads?.[0]
    if (!quad) throw new Error('no quads')
    // quad = [x1,y1, x2,y2, x3,y3, x4,y4] → center
    const cx = (quad[0] + quad[2] + quad[4] + quad[6]) / 4
    const cy = (quad[1] + quad[3] + quad[5] + quad[7]) / 4
    await send(wc, 'Input.dispatchMouseEvent', { type: 'mouseMoved', x: cx, y: cy })
    await send(wc, 'Input.dispatchMouseEvent', { type: 'mousePressed', x: cx, y: cy, button: 'left', clickCount: 1 })
    await send(wc, 'Input.dispatchMouseEvent', { type: 'mouseReleased', x: cx, y: cy, button: 'left', clickCount: 1 })
    return true
  } catch {
    // Fallback: scripted click on the marked element (works for most buttons).
    return evaluate<boolean>(
      wc,
      `(() => { const el = document.querySelector('[data-nori-target]') || (function(){let r=null;const w=(rt)=>{for(const e of rt.querySelectorAll('*')){if(e.getAttribute&&e.getAttribute('data-nori-target')){r=e;return}if(e.shadowRoot)w(e.shadowRoot)}};w(document);return r})(); if(!el)return false; el.click(); return true })()`
    )
  }
}

/**
 * Submit the focused composer via Ctrl/Cmd+Enter — routes through the editor's own
 * keydown handler (X, Reddit, LinkedIn, Slack all commit on this), bypassing all
 * button hit-testing. This is the most reliable submit for React/Draft.js composers.
 */
export async function submitViaKeyboard(wc: WebContents): Promise<void> {
  const mod = process.platform === 'darwin' ? 4 : 2 // 4=Meta(Cmd), 2=Ctrl
  await send(wc, 'Input.dispatchKeyEvent', {
    type: 'keyDown',
    modifiers: mod,
    windowsVirtualKeyCode: 13,
    nativeVirtualKeyCode: 13,
    code: 'Enter',
    key: 'Enter',
    text: '\r'
  })
  await send(wc, 'Input.dispatchKeyEvent', {
    type: 'keyUp',
    modifiers: mod,
    windowsVirtualKeyCode: 13,
    nativeVirtualKeyCode: 13,
    code: 'Enter',
    key: 'Enter'
  })
}

/**
 * clickMarked with a COMPLETE pointer+mouse sequence: settle after move, `buttons`
 * bitmask (1 on press / 0 on release), and pointerType — the well-formed event
 * React/Draft.js buttons require. Fallback also fires pointerdown/up + requestSubmit.
 */
export async function clickMarkedFull(wc: WebContents): Promise<boolean> {
  try {
    const doc = await send<{ root: { nodeId: number } }>(wc, 'DOM.getDocument', { depth: -1, pierce: true })
    const q = await send<{ nodeId: number }>(wc, 'DOM.querySelector', {
      nodeId: doc.root.nodeId,
      selector: '[data-nori-target]'
    })
    if (!q.nodeId) return false
    const boxes = await send<{ quads: number[][] }>(wc, 'DOM.getContentQuads', { nodeId: q.nodeId })
    const quad = boxes.quads?.[0]
    if (!quad) throw new Error('no quads')
    const cx = (quad[0] + quad[2] + quad[4] + quad[6]) / 4
    const cy = (quad[1] + quad[3] + quad[5] + quad[7]) / 4
    await send(wc, 'Input.dispatchMouseEvent', { type: 'mouseMoved', x: cx, y: cy, buttons: 0, pointerType: 'mouse' })
    await new Promise((r) => setTimeout(r, 60))
    await send(wc, 'Input.dispatchMouseEvent', { type: 'mousePressed', x: cx, y: cy, button: 'left', buttons: 1, clickCount: 1, pointerType: 'mouse' })
    await new Promise((r) => setTimeout(r, 30))
    await send(wc, 'Input.dispatchMouseEvent', { type: 'mouseReleased', x: cx, y: cy, button: 'left', buttons: 0, clickCount: 1, pointerType: 'mouse' })
    return true
  } catch {
    return evaluate<boolean>(
      wc,
      `(() => { let r=document.querySelector('[data-nori-target]'); if(!r){const w=(rt)=>{for(const e of rt.querySelectorAll('*')){if(e.getAttribute&&e.getAttribute('data-nori-target')){r=e;return}if(e.shadowRoot)w(e.shadowRoot)}};w(document)} if(!r)return false; try{r.dispatchEvent(new MouseEvent('pointerdown',{bubbles:true,cancelable:true}))}catch(e){} try{r.dispatchEvent(new MouseEvent('pointerup',{bubbles:true,cancelable:true}))}catch(e){} r.click(); if(r.form&&r.form.requestSubmit){try{r.form.requestSubmit(r)}catch(e){}} return true })()`
    )
  }
}

export async function detach(wc: WebContents): Promise<void> {
  try {
    if (attached.has(wc)) {
      wc.debugger.detach()
      attached.delete(wc)
    }
  } catch {
    // ignore
  }
}
