import { BrowserWindow } from 'electron'
import { IPC } from '@shared/types'
import * as store from './db/store'

/**
 * Scheduled topic watcher — every 30 min, quietly checks Google News results
 * for each watched topic in a hidden window, diffs against seen URLs, and
 * badges the watch chips. Zero AI tokens — pure scrape + diff.
 */

const CHECK_INTERVAL = 30 * 60 * 1000
const FIRST_CHECK_DELAY = 25 * 1000

const RESULTS_SCRIPT = `(() => {
  const out = []
  for (const h3 of document.querySelectorAll('a h3')) {
    const a = h3.closest('a')
    if (!a || !a.href) continue
    const title = (h3.innerText || '').trim()
    if (title.length > 15) out.push({ title: title.slice(0, 140), url: a.href.split('#')[0] })
    if (out.length >= 10) break
  }
  return out
})()`

let mainWin: (() => BrowserWindow | null) | null = null
let running = false

async function checkAll(): Promise<void> {
  if (running) return
  running = true
  try {
    const watches = store.listWatches()
    if (!watches.length) return
    const hidden = new BrowserWindow({
      show: false,
      webPreferences: { sandbox: true, contextIsolation: true }
    })
    try {
      let anyNew = false
      for (const w of watches) {
        try {
          await hidden.loadURL(
            `https://www.google.com/search?q=${encodeURIComponent(w.topic)}&tbm=nws`
          )
          await new Promise((r) => setTimeout(r, 1800))
          const items = (await hidden.webContents.executeJavaScript(RESULTS_SCRIPT, true)) as {
            title: string
            url: string
          }[]
          if (!items?.length) continue
          const fresh = items.filter((i) => !w.seenUrls.includes(i.url))
          if (fresh.length) {
            anyNew = true
            store.updateWatch(w.id, {
              items,
              unread: Math.min(w.unread + fresh.length, 20)
            })
          }
        } catch {
          // one topic failing shouldn't stop the rest
        }
      }
      if (anyNew) {
        const win = mainWin?.()
        if (win && !win.isDestroyed()) win.webContents.send(IPC.WatchUpdated)
      }
    } finally {
      hidden.destroy()
    }
  } finally {
    running = false
  }
}

export function startWatcher(getWin: () => BrowserWindow | null): void {
  mainWin = getWin
  setTimeout(checkAll, FIRST_CHECK_DELAY)
  setInterval(checkAll, CHECK_INTERVAL)
}
