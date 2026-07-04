import { app, BrowserWindow, protocol, shell } from 'electron'
import { join } from 'path'
import { TabManager } from './tabs'
import { registerIpc } from './ipc'
import { loadEnv } from './env'
import { registerStartPage } from './startpage'
import { initBlocker } from './blocker'
import { startWatcher } from './watcher'
import { startMissions } from './missions'
import { startAutoUpdate } from './updater'
import * as store from './db/store'
import * as recall from './ai-engine/recall'
import { setApiKey } from './ai-engine/openai'

loadEnv()

// A key saved via the settings UI (userData) takes precedence over .env — this is
// how installed copies (no .env) get their key. Loaded once at startup.
const storedKey = store.getSetting('openaiApiKey')
if (storedKey) setApiKey(storedKey)

// 24x7 hardening: a stray exception or unhandled rejection anywhere in main must
// never take the whole browser down — log it and keep running.
process.on('uncaughtException', (err) => {
  console.error('[nori-main] uncaughtException:', err)
})
process.on('unhandledRejection', (reason) => {
  console.error('[nori-main] unhandledRejection:', reason)
})

// Present as plain Chrome — Google/Microsoft/etc. block OAuth when the UA says
// "Electron" (the "this browser may not be secure" wall). Applies to every
// webContents including auth popups.
app.userAgentFallback = `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${process.versions.chrome} Safari/537.36`

// Must run before app ready — lets nori://home behave like a normal secure page.
protocol.registerSchemesAsPrivileged([
  { scheme: 'nori', privileges: { standard: true, secure: true } }
])

function createWindow(): void {
  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 940,
    minHeight: 560,
    show: false,
    frame: false, // custom Nori titlebar drawn by the renderer
    backgroundColor: '#f6f3ec',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  })

  const tabs = new TabManager(win)
  registerIpc(win, tabs)

  win.once('ready-to-show', () => {
    win.show()
    tabs.createTab()
  })

  // Chrome UI itself should never navigate away or open OS windows.
  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url)
    return { action: 'deny' }
  })

  if (process.env['ELECTRON_RENDERER_URL']) {
    win.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

app.whenReady().then(() => {
  registerStartPage()
  initBlocker()
  createWindow()
  startWatcher(() => BrowserWindow.getAllWindows()[0] ?? null)
  startMissions(() => BrowserWindow.getAllWindows()[0] ?? null)
  startAutoUpdate()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

// Debounced JSON writes may still be pending — flush them before the process exits.
app.on('before-quit', () => {
  store.flush()
  recall.flush()
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
