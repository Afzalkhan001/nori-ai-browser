import { BrowserWindow, WebContentsView } from 'electron'
import type { BrowserState, TabState, WebAreaBounds } from '@shared/types'
import { IPC } from '@shared/types'
import * as blocker from './blocker'
import { capturePage } from './ai-engine/recall'
import { injectMainWorldStealth } from './stealth'

/**
 * YouTube ad neutralizer — network blocking can't stop YT video ads (they're
 * served from googlevideo.com like the videos themselves), so we do what
 * Brave-style scriptlets do: detect the player's ad state, mute + jump to the
 * ad's end + click Skip, and cosmetically hide display ads.
 */
const YT_AD_CSS = `
  #masthead-ad, #player-ads, ytd-display-ad-renderer, ytd-ad-slot-renderer,
  ytd-in-feed-ad-layout-renderer, ytd-promoted-sparkles-web-renderer,
  ytd-banner-promo-renderer, .ytp-ad-overlay-container, .ytp-ad-text-overlay,
  ytd-rich-item-renderer:has(ytd-ad-slot-renderer),
  ytd-search-pyv-renderer, ytd-promoted-video-renderer {
    display: none !important;
  }
`

const YT_AD_SKIP = `(() => {
  if (window.__noriYtSkip) return
  window.__noriYtSkip = true
  setInterval(() => {
    try {
      const p = document.querySelector('.html5-video-player')
      const v = p && p.querySelector('video')
      if (!p || !v) return
      const inAd = p.classList.contains('ad-showing') || p.classList.contains('ad-interrupting')
      if (inAd) {
        if (!v.muted) { v.muted = true; window.__noriAdMuted = true }
        v.playbackRate = 16
        if (isFinite(v.duration) && v.duration > 0.5) { try { v.currentTime = v.duration } catch (e) {} }
        const skip = document.querySelector('.ytp-skip-ad-button, .ytp-ad-skip-button, .ytp-ad-skip-button-modern, .ytp-ad-skip-button-slot button')
        if (skip) skip.click()
      } else if (window.__noriAdMuted) {
        v.muted = false
        v.playbackRate = 1
        window.__noriAdMuted = false
      }
    } catch (e) {}
  }, 400)
})()`

/** Best-effort cookie-consent dismissal, injected after page load. */
const COOKIE_DISMISS = `(() => {
  try {
    const clickSels = [
      '#onetrust-reject-all-handler', '#onetrust-accept-btn-handler',
      '.cc-dismiss', '.cc-deny', '#didomi-notice-disagree-button',
      'button[aria-label*="Reject" i]', 'button[aria-label*="dismiss" i]',
      '[data-testid="cookie-policy-manage-dialog-decline-button"]'
    ]
    for (const s of clickSels) {
      const el = document.querySelector(s)
      if (el) { el.click(); break }
    }
    const hideSels = ['#onetrust-consent-sdk', '.cc-window', '#didomi-host']
    for (const s of hideSels) {
      const el = document.querySelector(s)
      if (el) el.style.setProperty('display', 'none', 'important')
    }
  } catch {}
})()`

import { HOME_URL } from './startpage'

const NEW_TAB_URL = HOME_URL

let nextTabId = 1

interface Tab {
  id: string
  view: WebContentsView
  faviconUrl: string | null
}

/**
 * Owns all WebContentsViews for one window. The renderer draws the chrome
 * (tab bar, address bar, sidebar) and reports the rectangle left over for
 * web content; we keep the active view sized to that rectangle.
 */
export class TabManager {
  private tabs: Tab[] = []
  private activeTabId: string | null = null
  private webArea: WebAreaBounds = { x: 0, y: 88, width: 1200, height: 600 }
  private readerHidden = false

  constructor(private win: BrowserWindow) {}

  createTab(url: string = NEW_TAB_URL): string {
    const id = String(nextTabId++)
    const view = new WebContentsView({
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true
      }
    })
    view.setBackgroundColor('#ffffff')
    // Rounded web canvas (Arc-style frame). Guarded — API is newer Electron.
    const v = view as unknown as { setBorderRadius?: (r: number) => void }
    if (typeof v.setBorderRadius === 'function') v.setBorderRadius(12)
    const tab: Tab = { id, view, faviconUrl: null }
    this.tabs.push(tab)
    this.wireEvents(tab)
    injectMainWorldStealth(view.webContents) // arm client-side OAuth disguise before first load
    view.webContents.loadURL(url).catch(() => {}) // load failures surface in the tab itself
    this.activateTab(id)
    return id
  }

  closeTab(id: string): void {
    const idx = this.tabs.findIndex((t) => t.id === id)
    if (idx === -1) return
    const [tab] = this.tabs.splice(idx, 1)
    if (this.activeTabId === id) {
      const next = this.tabs[idx] ?? this.tabs[idx - 1] ?? null
      this.activeTabId = null
      if (next) this.activateTab(next.id)
    }
    this.win.contentView.removeChildView(tab.view)
    tab.view.webContents.close()
    if (this.tabs.length === 0) this.createTab()
    else this.emitState()
  }

  activateTab(id: string): void {
    const tab = this.get(id)
    if (!tab) return
    this.readerHidden = false // switching tabs exits reader mode
    // Detach all views, attach only the active one — cheap tab switching.
    for (const t of this.tabs) {
      if (t.id !== id) this.win.contentView.removeChildView(t.view)
    }
    this.win.contentView.addChildView(tab.view)
    this.activeTabId = id
    this.applyBounds()
    this.emitState()
  }

  /** Reader mode: detach the native view so the renderer overlay is visible. */
  setReaderHidden(hidden: boolean): void {
    this.readerHidden = hidden
    const tab = this.get(this.activeTabId ?? '')
    if (!tab) return
    if (hidden) {
      this.win.contentView.removeChildView(tab.view)
    } else {
      this.win.contentView.addChildView(tab.view)
      this.applyBounds()
    }
  }

  navigate(id: string, input: string): void {
    const tab = this.get(id)
    if (!tab) return
    tab.view.webContents.loadURL(toUrl(input)).catch(() => {})
  }

  goBack(id: string): void {
    this.get(id)?.view.webContents.navigationHistory.goBack()
  }

  goForward(id: string): void {
    this.get(id)?.view.webContents.navigationHistory.goForward()
  }

  reload(id: string): void {
    this.get(id)?.view.webContents.reload()
  }

  stop(id: string): void {
    this.get(id)?.view.webContents.stop()
  }

  setWebArea(bounds: WebAreaBounds): void {
    this.webArea = bounds
    this.applyBounds()
  }

  getActiveWebContents() {
    return this.get(this.activeTabId ?? '')?.view.webContents ?? null
  }

  getWebContents(tabId: string) {
    return this.get(tabId)?.view.webContents ?? null
  }

  listTabs(): { id: string; title: string; url: string; active: boolean }[] {
    return this.tabs.map((t) => ({
      id: t.id,
      title: t.view.webContents.getTitle() || 'New Tab',
      url: t.view.webContents.getURL(),
      active: t.id === this.activeTabId
    }))
  }

  private applyBounds(): void {
    const tab = this.get(this.activeTabId ?? '')
    if (!tab) return
    tab.view.setBounds({
      x: Math.round(this.webArea.x),
      y: Math.round(this.webArea.y),
      width: Math.round(this.webArea.width),
      height: Math.round(this.webArea.height)
    })
  }

  private get(id: string): Tab | undefined {
    return this.tabs.find((t) => t.id === id)
  }

  private wireEvents(tab: Tab): void {
    const wc = tab.view.webContents
    const emit = () => this.emitState()
    // Self-healing: a crashed/OOM-killed renderer otherwise leaves a dead view
    // until the user manually reloads — reload it automatically.
    wc.on('render-process-gone', (_e, details) => {
      console.log('[nori-tabs] renderer gone on tab', tab.id, '-', details.reason)
      if (details.reason !== 'clean-exit' && details.reason !== 'killed') {
        setTimeout(() => {
          if (!wc.isDestroyed()) wc.reload()
        }, 1000)
      }
    })
    wc.on('unresponsive', () => console.log('[nori-tabs] tab', tab.id, 'unresponsive'))
    wc.on('responsive', () => console.log('[nori-tabs] tab', tab.id, 'responsive again'))
    wc.on('page-title-updated', emit)
    wc.on('did-start-loading', emit)
    wc.on('did-stop-loading', emit)
    wc.on('did-navigate', () => {
      blocker.resetCount(wc.id) // fresh count per page
      emit()
    })
    wc.on('did-navigate-in-page', emit)
    wc.on('did-finish-load', () => {
      wc.executeJavaScript(COOKIE_DISMISS, true).catch(() => {})
      // YouTube ad neutralizer (persists across YT's SPA navigation).
      if (blocker.isEnabled() && /(^|\.)youtube\.com$/.test(new URL(wc.getURL() || 'http://x').hostname)) {
        wc.insertCSS(YT_AD_CSS).catch(() => {})
        wc.executeJavaScript(YT_AD_SKIP, true).catch(() => {})
      }
      // Total Recall: remember this page after it settles (fire-and-forget).
      setTimeout(() => {
        if (!wc.isDestroyed()) capturePage(wc)
      }, 3000)
      emit()
    })
    wc.on('page-favicon-updated', (_e, favicons) => {
      tab.faviconUrl = favicons[0] ?? null
      emit()
    })
    // target=_blank links → new Nori tabs. BUT login/OAuth popups must open as
    // real popup windows with the opener relationship intact, or the auth
    // handshake (postMessage back to the page) breaks.
    wc.setWindowOpenHandler(({ url, features }) => {
      // Popups carry window features (width/height); auth URLs are recognized by host.
      const isAuthPopup =
        (features && /(width|height|popup)=/i.test(features)) ||
        /accounts\.google\.|appleid\.apple\.|facebook\.com\/(v\d|dialog|login)|login\.(microsoft|live)\.|github\.com\/login|oauth|\/signin|\/sign_in|\/login|auth\?/i.test(
          url
        )
      if (isAuthPopup) {
        return {
          action: 'allow',
          overrideBrowserWindowOptions: {
            width: 520,
            height: 660,
            autoHideMenuBar: true,
            webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true }
          }
        }
      }
      this.createTab(url)
      return { action: 'deny' }
    })
    // Arm the OAuth disguise on auth popups the instant they're created, before
    // they navigate to the provider's sign-in page.
    wc.on('did-create-window', (childWin) => {
      try {
        injectMainWorldStealth(childWin.webContents)
      } catch {
        /* non-fatal */
      }
    })
  }

  private snapshot(): BrowserState {
    const tabs: TabState[] = this.tabs.map((t) => {
      const wc = t.view.webContents
      return {
        id: t.id,
        url: wc.getURL(),
        title: wc.getTitle() || 'New Tab',
        faviconUrl: t.faviconUrl,
        isLoading: wc.isLoading(),
        canGoBack: wc.navigationHistory.canGoBack(),
        canGoForward: wc.navigationHistory.canGoForward(),
        blockedCount: blocker.blockedCount(wc.id)
      }
    })
    return { tabs, activeTabId: this.activeTabId }
  }

  emitState(): void {
    if (this.win.isDestroyed()) return
    this.win.webContents.send(IPC.BrowserStateChanged, this.snapshot())
  }
}

/** Turn address-bar input into a URL: bare domains get https://, everything else becomes a search. */
function toUrl(input: string): string {
  const trimmed = input.trim()
  if (/^https?:\/\//i.test(trimmed)) return trimmed
  if (/^[\w-]+(\.[\w-]+)+(:\d+)?(\/.*)?$/.test(trimmed)) return `https://${trimmed}`
  if (trimmed === 'localhost' || /^localhost:\d+/.test(trimmed)) return `http://${trimmed}`
  return `https://www.google.com/search?q=${encodeURIComponent(trimmed)}`
}
