import { app } from 'electron'

/**
 * Auto-update via electron-updater + GitHub Releases. On launch (and every 6h)
 * Nori checks the repo's latest Release; a newer version downloads in the
 * background and installs on the next quit. electron-updater is optional at
 * runtime — a dev checkout without it (or a non-packaged run) simply no-ops.
 */
export function startAutoUpdate(): void {
  // Only packaged builds can self-update; dev runs have no installer to replace.
  if (!app.isPackaged) return
  let autoUpdater: import('electron-updater').AppUpdater
  try {
    // Lazy require so the dev build doesn't need the dependency installed.
    autoUpdater = require('electron-updater').autoUpdater
  } catch {
    console.log('[nori-update] electron-updater not installed — skipping auto-update')
    return
  }

  autoUpdater.autoDownload = true
  autoUpdater.autoInstallOnAppQuit = true
  autoUpdater.on('error', (err) => console.log('[nori-update] error:', String(err).slice(0, 200)))
  autoUpdater.on('update-available', (i) => console.log('[nori-update] update available:', i.version))
  autoUpdater.on('update-downloaded', (i) => console.log('[nori-update] downloaded, installs on quit:', i.version))

  const check = (): void => {
    autoUpdater.checkForUpdates().catch((err) => console.log('[nori-update] check failed:', String(err).slice(0, 160)))
  }
  check()
  setInterval(check, 6 * 60 * 60 * 1000)
}
