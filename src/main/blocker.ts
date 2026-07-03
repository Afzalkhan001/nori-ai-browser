import { session } from 'electron'
import * as store from './db/store'

/**
 * Ad + tracker blocker. Domain-substring blocklist over webRequest —
 * compact but covers the heavy hitters. Never blocks main-frame loads.
 */

const BLOCKLIST = [
  'doubleclick.net',
  'googlesyndication.com',
  'googleadservices.com',
  'google-analytics.com',
  'googletagmanager.com',
  'adservice.google.',
  'adnxs.com',
  'taboola.com',
  'outbrain.com',
  'criteo.com',
  'criteo.net',
  'scorecardresearch.com',
  'quantserve.com',
  'moatads.com',
  'pubmatic.com',
  'rubiconproject.com',
  'openx.net',
  'adsafeprotected.com',
  'amazon-adsystem.com',
  'connect.facebook.net',
  'hotjar.com',
  'mouseflow.com',
  'fullstory.com',
  'segment.io',
  'mixpanel.com',
  'popads.net',
  'propellerads.com',
  'ads.yahoo.com',
  'adform.net',
  'smartadserver.com',
  'yieldmo.com',
  'sharethrough.com',
  'imasdk.googleapis.com',
  '2mdn.net',
  'innovid.com',
  'springserve.com',
  'ad.doubleclick.net',
  'securepubads.g.doubleclick.net',
  'tpc.googlesyndication.com'
]

let enabled = true
const counts = new Map<number, number>()

export function initBlocker(): void {
  enabled = store.getSetting('adblock') !== 'off'
  session.defaultSession.webRequest.onBeforeRequest((details, cb) => {
    if (!enabled || details.resourceType === 'mainFrame') {
      cb({})
      return
    }
    let host = ''
    try {
      host = new URL(details.url).hostname
    } catch {
      cb({})
      return
    }
    const blocked = BLOCKLIST.some((d) => host === d || host.endsWith('.' + d) || host.includes(d))
    if (blocked) {
      const id = details.webContentsId ?? -1
      counts.set(id, (counts.get(id) ?? 0) + 1)
      cb({ cancel: true })
    } else {
      cb({})
    }
  })
}

export function isEnabled(): boolean {
  return enabled
}

export function toggle(): boolean {
  enabled = !enabled
  store.setSetting('adblock', enabled ? 'on' : 'off')
  return enabled
}

export function blockedCount(webContentsId: number): number {
  return counts.get(webContentsId) ?? 0
}

export function resetCount(webContentsId: number): void {
  counts.set(webContentsId, 0)
}
