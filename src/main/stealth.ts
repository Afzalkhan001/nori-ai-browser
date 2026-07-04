import { app, session } from 'electron'

/**
 * Make Nori look like the plain Chrome it actually is, so identity providers
 * (Google, Microsoft, Apple, GitHub…) don't throw the "this browser or app may
 * not be secure" wall at OAuth.
 *
 * Spoofing the User-Agent STRING alone is not enough: modern Chrome also sends
 * User-Agent Client Hints (`Sec-CH-UA*`) and Electron populates those with an
 * "Electron";v="33" brand that the UA override never touches. Providers read the
 * hints server-side and block. Here we rewrite the hint headers (and scrub any
 * stray "Electron" from the UA) on every outgoing request so the brand list is
 * pure Chromium/Google Chrome.
 */

const chromeFull = process.versions.chrome // e.g. "130.0.6723.137"
const chromeMajor = chromeFull.split('.')[0]

// GREASE-style brand lists with NO Electron entry — what real Chrome sends.
const SEC_CH_UA = `"Chromium";v="${chromeMajor}", "Google Chrome";v="${chromeMajor}", "Not?A_Brand";v="24"`
const SEC_CH_UA_FULL = `"Chromium";v="${chromeFull}", "Google Chrome";v="${chromeFull}", "Not?A_Brand";v="24.0.0.0"`

// A guaranteed-clean Chrome UA. Computed fresh (not from app.userAgentFallback,
// whose value at this module's import time may still be Electron's default —
// which also carries the "nori/x.y.z" app-name token, itself a red flag).
const CLEAN_UA = `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${chromeFull} Safari/537.36`

export function installUaHardening(): void {
  const ses = session.defaultSession

  // Belt: make the fallback AND session UA explicit and clean, so every request
  // and navigation carries the clean string regardless of import order.
  app.userAgentFallback = CLEAN_UA
  try {
    ses.setUserAgent(CLEAN_UA)
  } catch {
    /* older Electron — fallback already set globally */
  }

  let loggedAuth = false
  ses.webRequest.onBeforeSendHeaders((details, cb) => {
    const headers = details.requestHeaders
    for (const key of Object.keys(headers)) {
      const lk = key.toLowerCase()
      const val = String(headers[key] ?? '')
      // Any header that leaks the Electron brand → rewrite to Chrome equivalents.
      if (lk === 'sec-ch-ua') headers[key] = SEC_CH_UA
      else if (lk === 'sec-ch-ua-full-version-list') headers[key] = SEC_CH_UA_FULL
      else if (lk === 'sec-ch-ua-full-version') headers[key] = `"${chromeFull}"`
      else if (lk === 'user-agent' && /electron|nori\//i.test(val)) headers[key] = CLEAN_UA
    }
    // One-time proof during an OAuth attempt that the disguise is applied.
    if (!loggedAuth && /accounts\.google|login\.(microsoft|live)|appleid\.apple|github\.com\/login/.test(details.url)) {
      loggedAuth = true
      console.log('[nori-stealth] auth request cloaked — sec-ch-ua:', SEC_CH_UA, '| ua clean:', !/electron|nori\//i.test(String(headers['User-Agent'] || headers['user-agent'] || CLEAN_UA)))
    }
    cb({ requestHeaders: headers })
  })
}
